// HACKER MODE: hold Q/Tab -> slow-mo + cyan vision, every hackable in range
// gets an outline + icon. Hacks cost energy, have cooldowns and big feedback.
import * as THREE from 'three';
import { damp } from '../core/math';
import { worldUniforms, MAX_BLACKOUTS } from '../render/patch';
import { BLOCKS, PITCH } from '../world/layout';
import type { Game } from '../core/game';
import type { Vehicle } from '../vehicles/vehicle';

export type HackKind = 'signal' | 'camera' | 'door' | 'lamp' | 'power' | 'alarm';

export interface Hackable {
  kind: HackKind;
  label: string;
  pos: THREE.Vector3;
  size: THREE.Vector3;
  range: number;
  available: () => boolean;
  act: (alt: boolean) => string;
  ref?: unknown;
}

export const HACK_INFO: Record<HackKind, { cost: number; cd: number; tag: string; name: string }> = {
  signal: { cost: 20, cd: 3, tag: 'SIG', name: 'Traffic light' },
  camera: { cost: 15, cd: 1.5, tag: 'CAM', name: 'Camera' },
  door: { cost: 25, cd: 2, tag: 'DOOR', name: 'Door' },
  lamp: { cost: 8, cd: 0.6, tag: 'LMP', name: 'Street lamp' },
  power: { cost: 40, cd: 8, tag: 'PWR', name: 'Power box' },
  alarm: { cost: 12, cd: 2, tag: 'ALM', name: 'Car alarm' },
};

interface Blackout { x: number; z: number; r: number; t: number; dur: number; s: number; block: number; }

const MAX_ICONS = 28;

export class HackSystem {
  active = false;
  blend = 0;
  energy = 100;
  cooldowns: Record<HackKind, number> = { signal: 0, camera: 0, door: 0, lamp: 0, power: 0, alarm: 0 };
  hackables: Hackable[] = [];
  selected: Hackable | null = null;
  used = 0;
  blackouts: Blackout[] = [];
  private lampQueue: { t: number; i: number }[] = [];
  private outlines: THREE.LineSegments[] = [];
  private icons: HTMLDivElement[] = [];
  private iconLayer: HTMLDivElement;
  private carHackables = new Map<Vehicle, Hackable>();
  private v = new THREE.Vector3();
  private time = 0;

  constructor(private g: Game) {
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    for (let i = 0; i < MAX_ICONS; i++) {
      const l = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: '#46e6ff', transparent: true, depthTest: false }));
      l.visible = false;
      l.frustumCulled = false;
      g.post.overlay.add(l);
      this.outlines.push(l);
    }
    this.iconLayer = document.createElement('div');
    this.iconLayer.className = 'hack-icons';
    g.hud.root.appendChild(this.iconLayer);
    for (let i = 0; i < MAX_ICONS; i++) {
      const d = document.createElement('div');
      d.className = 'hack-icon';
      d.style.display = 'none';
      this.iconLayer.appendChild(d);
      this.icons.push(d);
    }
  }

  build() {
    const g = this.g;
    // traffic lights (one hackable per intersection)
    for (const n of g.city.graph.nodes) {
      if (!n.hasLight) continue;
      this.hackables.push({
        kind: 'signal', label: 'Traffic lights', pos: new THREE.Vector3(n.x, 4.6, n.z), size: new THREE.Vector3(15, 1.8, 15), range: 45,
        available: () => !g.signals.nodes[n.id].override,
        act: (alt) => {
          g.signals.hack(n.id, alt ? 'red' : 'green', 12);
          for (const h of g.city.signalHeads) if (h.node === n.id) g.fx.spawn('hack', h.pos, 8);
          return alt ? 'ALL RED — GRIDLOCK' : 'ALL GREEN — CHAOS';
        },
      });
    }
    // security cameras
    for (const c of g.cameras.cams) {
      this.hackables.push({
        kind: 'camera', label: c.bank ? 'Bank camera' : 'Street camera', pos: c.pos, size: new THREE.Vector3(0.7, 0.7, 0.9), range: 40, ref: c,
        available: () => !g.cameras.isOffline(c),
        act: () => {
          g.cameras.blind(c, 20);
          g.fx.spawn('spark', c.pos, 14);
          return 'CAMERA BLINDED — 20s';
        },
      });
    }
    // bank doors
    for (const d of g.bank.doors) {
      const isVault = d.name === 'Vault door';
      this.hackables.push({
        kind: 'door', label: d.name, pos: d.pos, size: new THREE.Vector3(isVault ? 1 : 2.4, 3, isVault ? 3.2 : 0.8), range: isVault ? 12 : 30, ref: d,
        available: () => d.locked && (!isVault || g.bank.isInside(g.player.worldPos.x, g.player.worldPos.z)),
        act: () => {
          g.bank.openDoor(d);
          g.audio.unlock();
          g.heist.onDoorHacked(d);
          return `${d.name.toUpperCase()} UNLOCKED`;
        },
      });
    }
    // street lamps
    for (const l of g.city.lamps) {
      this.hackables.push({
        kind: 'lamp', label: 'Street lamp', pos: new THREE.Vector3(l.x, 5.8, l.z), size: new THREE.Vector3(0.7, 0.5, 1.0), range: 30, ref: l,
        available: () => !l.dead && !this.blockDark(l.block),
        act: () => {
          l.dead = true;
          g.city.setLamp(l.index, false);
          const p = new THREE.Vector3(l.x, 5.7, l.z);
          g.fx.spawn('spark', p, 22, undefined, 1.3);
          g.fx.spawn('glass', p, 10);
          g.post.triggerFlash('#fff1c0', 0.25);
          this.addBlackout(l.x, l.z, 11, 30, -1);
          g.peds.panic(p, 9);
          g.audio.pop();
          return 'LAMP OVERLOADED';
        },
      });
    }
    // power boxes -> block blackout
    for (const b of g.city.powerBoxes) {
      this.hackables.push({
        kind: 'power', label: 'Power box', pos: new THREE.Vector3(b.x, 0.9, b.z), size: new THREE.Vector3(0.9, 1.6, 1.3), range: 40, ref: b,
        available: () => !this.blockDark(b.block),
        act: () => {
          this.powerCut(b.block, b.x, b.z);
          return 'BLACKOUT — BLOCK DARK 25s';
        },
      });
    }
  }

  reset() {
    for (const k of Object.keys(this.cooldowns) as HackKind[]) this.cooldowns[k] = 0;
    this.energy = 100;
    this.used = 0;
    this.active = false;
    this.blend = 0;
    for (const b of this.blackouts) if (b.block >= 0) this.restoreBlock(b.block);
    this.blackouts = [];
    this.lampQueue = [];
    for (const l of this.g.city.lamps) if (l.dead) { l.dead = false; this.g.city.setLamp(l.index, true); }
    this.writeUniforms();
  }

  private blockDark(block: number) {
    return this.blackouts.some((b) => b.block === block);
  }

  isBlackedOut(x: number, z: number) {
    for (const b of this.blackouts) if (b.s > 0.5 && Math.hypot(x - b.x, z - b.z) < b.r - 2) return true;
    return false;
  }

  addBlackout(x: number, z: number, r: number, dur: number, block: number) {
    if (this.blackouts.length >= MAX_BLACKOUTS) this.blackouts.shift();
    this.blackouts.push({ x, z, r, t: 0, dur, s: 0, block });
  }

  private powerCut(block: number, bx: number, bz: number) {
    const g = this.g;
    const c = g.city.blockCenter(block);
    this.addBlackout(c.x, c.z, PITCH * 0.62, 25, block);
    g.city.setBlockPower(block, false);
    // lamps die in a ripple from the power box
    for (const l of g.city.lamps) {
      if (l.block !== block || l.dead) continue;
      this.lampQueue.push({ t: 0.15 + Math.hypot(l.x - bx, l.z - bz) * 0.018, i: l.index });
    }
    g.fx.ring(new THREE.Vector3(bx, 0.3, bz), PITCH * 0.7, '#46e6ff', 1.1);
    g.fx.spawn('spark', new THREE.Vector3(bx, 1.2, bz), 30, undefined, 1.4);
    g.post.blackoutPulse = 1;
    g.post.triggerFlash('#0a1830', 0.8);
    g.camRig.addShake(0.35);
    g.camRig.fovKick = -7;
    g.hitstop(0.12);
    g.audio.powerDown();
    g.peds.panic(new THREE.Vector3(c.x, 0, c.z), 30, true);
  }

  private restoreBlock(block: number) {
    const g = this.g;
    g.city.setBlockPower(block, true);
    for (const l of g.city.lamps) if (l.block === block && !l.dead) g.city.setLamp(l.index, true);
  }

  private carHackable(v: Vehicle): Hackable {
    let h = this.carHackables.get(v);
    if (!h) {
      h = {
        kind: 'alarm', label: 'Car alarm', pos: v.pos, size: new THREE.Vector3(2.2, 1.7, 4.6), range: 40, ref: v,
        available: () => v.alarmT <= 0 && v.driver === 'none' && !v.wrecked,
        act: () => {
          const g = this.g;
          v.alarmT = 12;
          g.peds.lure(v.pos.clone(), 45);
          g.police.lure(v.pos.clone());
          g.guards.lure(v.pos.clone());
          g.audio.carAlarm(v);
          return 'CAR ALARM — DISTRACTION';
        },
      };
      this.carHackables.set(v, h);
    }
    return h;
  }

  update(realDt: number, dt: number) {
    const g = this.g;
    this.time += realDt;
    const inp = g.input;
    const want = (inp.isDown('KeyQ', 'Tab') && g.state === 'playing' && !g.player.busted);
    if (want && !this.active) g.audio.hackOn();
    this.active = want;
    this.blend = damp(this.blend, this.active ? 1 : 0, 10, realDt);
    g.post.hack = this.blend;

    this.energy = Math.min(100, this.energy + dt * 6.5);
    for (const k of Object.keys(this.cooldowns) as HackKind[]) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);

    this.updateBlackouts(dt);

    // gather candidates
    const P = g.player.worldPos;
    const cam = g.camera;
    const cands: { h: Hackable; sx: number; sy: number; sd: number; d: number }[] = [];
    if (this.active) {
      const list = this.hackables.concat(g.vehicles.filter((v) => v.driver === 'none' && !v.wrecked).map((v) => this.carHackable(v)));
      const aspect = cam.aspect;
      for (const h of list) {
        const d = h.pos.distanceTo(P);
        if (d > h.range) continue;
        this.v.copy(h.pos).project(cam);
        if (this.v.z > 1 || this.v.z < -1 || Math.abs(this.v.x) > 1.1 || Math.abs(this.v.y) > 1.1) continue;
        cands.push({ h, sx: this.v.x, sy: this.v.y, sd: Math.hypot(this.v.x * aspect, this.v.y), d });
      }
      cands.sort((a, b) => a.d - b.d);
      cands.length = Math.min(cands.length, MAX_ICONS);
      let best: (typeof cands)[0] | null = null;
      for (const c of cands) if (c.sd < 0.5 && (!best || c.sd < best.sd)) best = c;
      this.selected = best?.h ?? null;
    } else this.selected = null;

    this.drawIcons(cands);

    // execute
    if (this.active && this.selected) {
      const alt = inp.clicked(2);
      if (inp.clicked(0) || inp.pressed('KeyE') || alt) this.execute(this.selected, alt);
    }
  }

  private execute(h: Hackable, alt: boolean) {
    const g = this.g;
    const info = HACK_INFO[h.kind];
    if (!h.available()) { g.hud.toast('ALREADY HACKED', 'dim'); g.audio.deny(); return; }
    if (this.cooldowns[h.kind] > 0) { g.hud.toast(`${info.tag} COOLDOWN`, 'dim'); g.audio.deny(); return; }
    if (this.energy < info.cost) { g.hud.toast('NOT ENOUGH ENERGY', 'dim'); g.audio.deny(); return; }
    this.energy -= info.cost;
    this.cooldowns[h.kind] = info.cd;
    this.used++;
    const from = g.player.vehicle ? g.player.vehicle.pos.clone().setY(1.6) : g.player.pos.clone().setY(g.player.pos.y + 1.4);
    g.fx.beam(from, h.pos);
    g.fx.spawn('hack', h.pos, 18);
    g.post.triggerFlash('#46e6ff', 0.3);
    g.camRig.fovKick = Math.min(g.camRig.fovKick, -4);
    g.camRig.addShake(0.12);
    g.hitstop(0.06);
    g.audio.hackBlip();
    const msg = h.act(alt);
    g.hud.toast(msg, 'hack');
    g.heist.stats.hacks++;
  }

  private updateBlackouts(dt: number) {
    const g = this.g;
    for (let i = this.lampQueue.length - 1; i >= 0; i--) {
      const q = this.lampQueue[i];
      q.t -= dt;
      if (q.t <= 0) {
        g.city.setLamp(q.i, false);
        const l = g.city.lamps[q.i];
        g.fx.spawn('spark', new THREE.Vector3(l.x, 5.7, l.z), 6);
        this.lampQueue.splice(i, 1);
      }
    }
    for (let i = this.blackouts.length - 1; i >= 0; i--) {
      const b = this.blackouts[i];
      b.t += dt;
      const fadeIn = Math.min(1, b.t / 0.9);
      const flicker = b.t < 0.9 ? (Math.sin(b.t * 40) > 0 ? 1 : 0.5) : 1;
      const fadeOut = Math.min(1, (b.dur - b.t) / 1.2);
      // power flickers back on near the end
      const endFlicker = b.dur - b.t < 2.2 && Math.sin(b.t * 30) > 0.6 ? 0.6 : 1;
      b.s = Math.max(0, fadeIn * flicker * fadeOut * endFlicker);
      if (b.t >= b.dur) {
        if (b.block >= 0) this.restoreBlock(b.block);
        this.blackouts.splice(i, 1);
      }
    }
    this.writeUniforms();
  }

  private writeUniforms() {
    const u = worldUniforms.uBlack.value;
    for (let i = 0; i < MAX_BLACKOUTS; i++) {
      const b = this.blackouts[i];
      if (b) u[i].set(b.x, b.z, b.r, b.s);
      else u[i].set(0, 0, 0, 0);
    }
  }

  private drawIcons(cands: { h: Hackable; sx: number; sy: number; d: number }[]) {
    const g = this.g;
    const W = innerWidth, H = innerHeight;
    const pulse = 0.6 + Math.sin(this.time * 10) * 0.4;
    for (let i = 0; i < MAX_ICONS; i++) {
      const el = this.icons[i];
      const ol = this.outlines[i];
      const c = cands[i];
      if (!c || !this.active) { el.style.display = 'none'; ol.visible = false; continue; }
      const info = HACK_INFO[c.h.kind];
      const sel = c.h === this.selected;
      const avail = c.h.available();
      const cd = this.cooldowns[c.h.kind];
      const x = (c.sx * 0.5 + 0.5) * W, y = (-c.sy * 0.5 + 0.5) * H;
      el.style.display = 'block';
      el.style.transform = `translate(${x | 0}px, ${y | 0}px) translate(-50%, -50%)`;
      el.className = 'hack-icon' + (sel ? ' sel' : '') + (avail ? '' : ' off') + ` k-${c.h.kind}`;
      const extra = sel
        ? `<div class="hl">${c.h.label}</div><div class="hc">${!avail ? (c.h.kind === 'door' ? 'UNLOCKED' : c.h.kind === 'camera' ? 'BLINDED' : c.h.kind === 'signal' ? 'HACKED' : 'OFFLINE') : cd > 0 ? `COOLDOWN ${cd.toFixed(1)}s` : this.energy < info.cost ? 'LOW ENERGY' : `[LMB] HACK · ${info.cost}⚡${c.h.kind === 'signal' ? ' · [RMB] ALL RED' : ''}`}</div>`
        : '';
      const html = `<div class="ht">${info.tag}</div>${extra}`;
      if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; }
      ol.visible = true;
      ol.position.copy(c.h.pos);
      ol.scale.copy(c.h.size);
      if (c.h.kind === 'alarm') ol.position.y = c.h.pos.y + 0.8;
      if (c.h.kind === 'alarm') ol.rotation.y = (c.h.ref as Vehicle).heading; else ol.rotation.y = 0;
      const m = ol.material as THREE.LineBasicMaterial;
      m.color.set(!avail ? '#3a5560' : sel ? '#ffffff' : '#46e6ff');
      m.opacity = sel ? pulse : 0.75;
    }
    void g;
    void BLOCKS;
  }
}
