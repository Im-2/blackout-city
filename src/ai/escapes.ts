// ESCAPE OPTIONS beyond "drive away": subway (gates, platforms, trains),
// sewer manholes, hiding spots (dumpsters, van cargo), decoys (billboards,
// delivery drones), hackable bollard barriers, and a HUD list of what's
// nearby. Police adapt to the player's favourite escapes.
import * as THREE from 'three';
import { PAL } from '../core/palette';
import { Rng } from '../core/math';
import { Kit } from '../world/interior';
import { GeoBuilder } from '../world/geo';
import { worldMaterials } from '../world/materials';
import { CURB_H, blockBounds, roadCoord, PITCH } from '../world/layout';
import { basicMat } from '../render/patch';
import type { Game } from '../core/game';
import type { Interactable } from '../player/player';

export interface Station { name: string; entrance: THREE.Vector3; platform: THREE.Vector3; heading: number; trainT: number; train: THREE.Group; doorsOpen: boolean; }
interface Manhole { pos: THREE.Vector3; pair: number; name: string; }
interface Billboard { pos: THREE.Vector3; mesh: THREE.Mesh; tex: THREE.CanvasTexture; ctx: CanvasRenderingContext2D; flashT: number; scroll: number; }
interface Drone { group: THREE.Group; center: THREE.Vector3; r: number; t: number; speed: number; decoyT: number; vel: THREE.Vector3; }
interface Bollards { mesh: THREE.InstancedMesh; boxes: import('../world/collision').AABB[]; upT: number; h: number; x: number; z: number; axis: 'x' | 'z'; }

const UG = -8; // underground floor height
const CEIL = 4.2;

export class Escapes {
  stations: Station[] = [];
  manholes: Manhole[] = [];
  billboards: Billboard[] = [];
  drones: Drone[] = [];
  bollards: Bollards[] = [];
  dumpsters: THREE.Vector3[] = [];
  ceiling = UG + CEIL;
  private rng = new Rng(616);
  private posted = false;
  private wasHot = false;
  private t = 0;
  private vanSpot: Interactable | null = null;
  private tickerT = 0;
  /** stations only render while the player is underground */
  private undergroundGroups: THREE.Object3D[] = [];

  constructor(private g: Game) {}

  build() {
    this.buildSubway();
    this.buildSewers();
    this.buildDumpsters();
    this.buildBillboards();
    this.buildDrones();
    this.buildBollards();
    return this;
  }

  // ------------------------------------------------------------------ subway
  private buildSubway() {
    const g = this.g;
    const defs: [string, number, number][] = [
      ['Union Sq', -98, 9.2],
      ['Foundry', 66, -47.2],
      ['Harbor', 121, 121],
      ['Old Town', -250, 65],
      ['Northside', 25, -271],
    ];
    const ext = new GeoBuilder();
    defs.forEach(([name, x, z], i) => {
      // street kiosk: railings, stair hole, sign post
      ext.box(x - 1.6, CURB_H, z - 1.2, x + 1.6, CURB_H + 0.02, z + 1.2, { color: '#2a2a2a' });
      for (const sx of [-1.6, 1.6]) ext.box(x + sx - 0.06, CURB_H, z - 1.2, x + sx + 0.06, CURB_H + 1.0, z + 1.2, { color: '#4a5b39' });
      ext.box(x - 1.6, CURB_H, z + 1.14, x + 1.6, CURB_H + 1.0, z + 1.26, { color: '#4a5b39' });
      ext.cbox(x - 2.0, CURB_H + 1.6, z - 1.2, 0.12, 3.2, 0.12, { color: PAL.metal });
      ext.cbox(x - 2.0, CURB_H + 3.3, z - 1.2, 0.7, 0.7, 0.12, { color: '#2f5a8a' });
      g.col.add(x - 1.7, 0, z + 1.1, x + 1.7, 1.1, z + 1.3, false, 'rail');
      const sk = new Kit(g.col);
      sk.sign('M', x - 2.0, CURB_H + 3.3, z - 1.27, Math.PI, 0.6, 0.6, '#2f5a8a', '#ffffff');
      sk.sign(`METRO · ${name.toUpperCase()}`, x, CURB_H + 1.4, z - 1.3, Math.PI, 3, 0.5, '#1e2a36', '#ffd27a');
      sk.finish(g.scene);
      // underground platform room directly below
      const k = new Kit(g.col);
      const px0 = x - 14, px1 = x + 14, pz0 = z - 3, pz1 = z + 9;
      k.room(px0, pz0, px1, pz1, { y: UG, h: CEIL, floor: '#8a857c', floor2: '#7a756c', wall: '#c8c3b5' });
      // track pit + rails along the far side
      k.props.box(px0, UG - 0.06, z + 5.5, px1, UG - 0.04, pz1, { color: '#2a2a28' });
      for (const rz of [6.4, 8.0]) k.props.box(px0, UG - 0.03, z + rz, px1, UG + 0.02, z + rz + 0.1, { color: '#8a8a84' });
      k.props.box(px0, UG, z + 5.3, px1, UG + 0.01, z + 5.5, { color: PAL.laneYellow });
      k.solid(px0, UG, z + 5.5, px1, UG + 2.2, z + 5.7, false); // platform edge
      // turnstiles (hackable) + stairs block
      const gate: import('../world/collision').AABB[] = [];
      for (let gx = x - 4; gx <= x + 4; gx += 1.6) if (Math.abs(gx - x) > 0.5) gate.push(k.block(gx - 0.1, UG, z + 1.6, gx + 0.1, UG + 1.05, z + 2.0, '#5a5f64'));
      const flap = k.solid(x - 0.7, UG, z + 1.6, x + 0.7, UG + 1.05, z + 2.0, false);
      k.block(x - 1.6, UG, pz0 + 0.2, x + 1.6, UG + 3.8, z - 0.2, '#7a766d', true);
      k.sign(`${name.toUpperCase()} STATION`, x, UG + 3.2, z + 5.2, 0, 5, 0.6, '#2f5a8a', '#ffffff');
      for (let bx = px0 + 3; bx < px1 - 2; bx += 7) k.block(bx, UG, z + 3.2, bx + 2, UG + 0.5, z + 3.8, '#6b4a30');
      k.finish(g.scene);
      this.undergroundGroups.push(k.group);
      // the train
      const train = new THREE.Group();
      const tb = new GeoBuilder();
      for (let c = 0; c < 3; c++) {
        const cx = c * 9.6;
        tb.box(cx - 4.6, 0.2, -1.4, cx + 4.6, 3.2, 1.4, { color: '#c8c3b5', shadeSides: true });
        tb.box(cx - 4.6, 1.4, -1.42, cx + 4.6, 2.4, 1.42, { color: PAL.carGlass, skip: { py: true, ny: true, pz: true, nz: true } });
        tb.box(cx - 4.6, 0.7, -1.43, cx + 4.6, 0.95, 1.43, { color: '#2f5a8a', skip: { py: true, ny: true } });
      }
      const tm = new THREE.Mesh(tb.build(), worldMaterials().props);
      train.add(tm);
      const tg = new GeoBuilder();
      for (let c = 0; c < 3; c++) tg.box(c * 9.6 - 4.4, 1.5, -1.44, c * 9.6 + 4.4, 2.3, 1.44, { color: '#e8d8a8', skip: { py: true, ny: true, pz: true, nz: true } });
      train.add(new THREE.Mesh(tg.build(), basicMat({ vertexColors: true })));
      train.position.set(px1 + 40, UG, z + 7.2);
      g.scene.add(train);
      this.undergroundGroups.push(train);
      const st: Station = { name, entrance: new THREE.Vector3(x, CURB_H, z), platform: new THREE.Vector3(x, UG, z + 3), heading: 0, trainT: i * 9, train, doorsOpen: false };
      this.stations.push(st);
      let gateOpen = false;
      g.hack.hackables.push({
        kind: 'subway', label: 'Metro turnstiles', pos: new THREE.Vector3(x, UG + 0.8, z + 1.8), size: new THREE.Vector3(9, 1.1, 0.6), range: 14,
        available: () => !gateOpen,
        act: () => { gateOpen = true; flap.enabled = false; for (const b of gate) b.enabled = false; setTimeout(() => { gateOpen = false; flap.enabled = true; for (const b of gate) b.enabled = true; }, 20000); return 'TURNSTILES OPEN — 20s'; },
      });
      g.interactables.push(
        { pos: st.entrance.clone(), radius: 2.2, label: `Enter metro (${name})`, enabled: () => !g.player.vehicle && g.player.pos.y > -1, action: () => { g.fadeTeleport(x, UG, z + 0.6, 0, `${name.toUpperCase()} STATION`); } },
        { pos: new THREE.Vector3(x, UG, z + 0.6), radius: 1.8, label: 'Exit to the street', enabled: () => true, action: () => g.fadeTeleport(x, CURB_H, z - 2.2, Math.PI, 'STREET LEVEL') },
        {
          pos: new THREE.Vector3(x, UG, z + 4.6), radius: 7, label: 'Board train',
          enabled: () => st.doorsOpen && g.player.pos.z > z + 2.1,
          action: () => this.ride(st),
        },
      );
    });
    g.scene.add(new THREE.Mesh(ext.build(), worldMaterials().props));
  }

  private ride(from: Station) {
    const g = this.g;
    const i = this.stations.indexOf(from);
    const to = this.stations[(i + 1) % this.stations.length];
    g.audio.train(g.player.pos);
    g.save.escape('subway');
    g.fadeTeleport(to.platform.x, UG, to.platform.z + 1.2, Math.PI, `RODE THE METRO → ${to.name.toUpperCase()}`);
    // the police lose the trail at the origin station
    const p = g.police;
    if (p.heat > 0) {
      p.lastSeenT = Math.max(p.lastSeenT, 12);
      p.lastKnown.copy(from.entrance);
      p.progress = Math.max(0, p.progress - 0.5);
      g.hud.hint('The cops are still watching the station you left.');
    }
  }

  // ------------------------------------------------------------------ sewers
  private buildSewers() {
    const g = this.g;
    const spots: [number, number, string][] = [
      [-60, -30, 'Bank alley'], [130, 130, 'Harbor yards'],
      [10, -100, 'Foundry St'], [-120, 90, 'Mill St'],
      [-30, 60, 'Canal St'], [104, -20, 'Lantern Ave'],
      [-228, 60, 'Old Town'], [224, -30, 'Pier Ave'],
      [-60, -220, 'Northside'], [60, 280, 'Shore Rd'],
    ];
    const b = new GeoBuilder();
    spots.forEach(([x, z, name], i) => {
      b.box(x - 0.55, 0, z - 0.55, x + 0.55, 0.03, z + 0.55, { color: '#2a2a28' });
      for (let k = -0.4; k < 0.45; k += 0.2) b.box(x - 0.45, 0.03, z + k, x + 0.45, 0.04, z + k + 0.08, { color: '#4a4844' });
      this.manholes.push({ pos: new THREE.Vector3(x, 0, z), pair: i % 2 ? i - 1 : i + 1, name });
    });
    g.scene.add(new THREE.Mesh(b.build(), worldMaterials().props));
    for (const m of this.manholes) {
      g.interactables.push({
        pos: m.pos, radius: 1.6, label: `Drop into the sewer → ${this.manholes[m.pair].name}`, enabled: () => !g.player.vehicle,
        action: () => {
          const to = this.manholes[m.pair];
          g.save.escape('sewer');
          g.fadeTeleport(to.pos.x + 1.2, to.pos.y, to.pos.z, 0, `SEWER → ${to.name.toUpperCase()}`);
          if (g.police.heat > 0) { g.police.lastSeenT = Math.max(g.police.lastSeenT, 10); g.police.lastKnown.copy(m.pos); }
        },
      });
    }
  }

  // ------------------------------------------------------------------ hiding
  private buildDumpsters() {
    const g = this.g;
    const b = new GeoBuilder();
    for (let i = 0; i < 40; i++) {
      const bi = this.rng.int(0, 11), bj = this.rng.int(0, 11);
      const bb = blockBounds(bi, bj);
      const x = this.rng.range(bb.x0 + 6, bb.x1 - 6), z = bb.z1 - 3.4;
      if (g.col.query(x - 1.2, z - 0.8, x + 1.2, z + 0.8).length) continue;
      b.box(x - 1.0, CURB_H, z - 0.6, x + 1.0, CURB_H + 1.3, z + 0.6, { color: this.rng.pick(['#2f4a5a', '#3f5a34', '#5a3a2a']), shadeSides: true });
      b.box(x - 1.05, CURB_H + 1.3, z - 0.65, x + 1.05, CURB_H + 1.38, z + 0.65, { color: '#2a2a2a' });
      g.col.add(x - 1.0, 0, z - 0.6, x + 1.0, CURB_H + 1.38, z + 0.6, false, 'dumpster');
      const p = new THREE.Vector3(x, CURB_H, z - 1.2);
      this.dumpsters.push(p);
      g.interactables.push({ pos: p, radius: 1.6, label: 'Hide in dumpster', enabled: () => !g.player.vehicle && !g.player.hidden, action: () => g.player.hide(p) });
    }
    const m = new THREE.Mesh(b.build(), worldMaterials().props);
    m.castShadow = true;
    g.scene.add(m);
  }

  // ------------------------------------------------------------------ decoys
  private buildBillboards() {
    const g = this.g;
    const spots: [number, number, number][] = [[-224, 9, 0], [224, -66, 0], [0, -224, Math.PI], [-112, 234, Math.PI], [-56, -9, 0], [0, 46, Math.PI], [56, -66, 0], [-112, 66, Math.PI], [112, 9, 0], [9, -112, Math.PI / 2]];
    for (const [x, z, h] of spots) {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 48;
      const ctx = c.getContext('2d')!;
      const tex = new THREE.CanvasTexture(c);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(8, 3), basicMat({ map: tex }));
      const ox = Math.sin(h) * 6, oz = Math.cos(h) * 6;
      mesh.position.set(x + ox, 8.5, z + oz);
      mesh.rotation.y = h + Math.PI;
      g.scene.add(mesh);
      const back = new GeoBuilder();
      back.cbox(x + ox, 8.5, z + oz - Math.cos(h) * 0.1, Math.abs(Math.cos(h)) * 8.4 + 0.2, 3.4, Math.abs(Math.sin(h)) * 8.4 + 0.2, { color: '#2a2a2a' });
      back.cbox(x + ox, 3.5, z + oz, 0.4, 7, 0.4, { color: PAL.metal });
      g.scene.add(new THREE.Mesh(back.build(), worldMaterials().props));
      g.col.addCentered(x + ox, z + oz, 0.5, 0.5, 7, 0, false, 'pole');
      const bb: Billboard = { pos: mesh.position, mesh, tex, ctx, flashT: 0, scroll: Math.random() * 400 };
      this.billboards.push(bb);
      g.hack.hackables.push({
        kind: 'billboard', label: 'Billboard', pos: mesh.position, size: new THREE.Vector3(8.2, 3.2, 0.6), range: 60,
        available: () => bb.flashT <= 0,
        act: () => {
          bb.flashT = 10;
          g.peds.lure(new THREE.Vector3(mesh.position.x, 0, mesh.position.z), 40);
          g.police.lure(new THREE.Vector3(mesh.position.x, 0, mesh.position.z));
          g.audio.hackBlip();
          return 'BILLBOARD HIJACKED — EVERYONE LOOKS UP';
        },
      });
    }
  }

  private buildDrones() {
    const g = this.g;
    for (let i = 0; i < 4; i++) {
      const grp = new THREE.Group();
      const b = new GeoBuilder();
      b.cbox(0, 0, 0, 0.5, 0.18, 0.5, { color: '#d8d6cf', shadeSides: true });
      b.cbox(0, -0.25, 0, 0.35, 0.3, 0.35, { color: '#c96a3a' }); // parcel
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { b.cbox(sx * 0.4, 0.05, sz * 0.4, 0.06, 0.06, 0.06, { color: '#2a2a2a' }); b.cbox(sx * 0.4, 0.1, sz * 0.4, 0.4, 0.02, 0.06, { color: '#1a1a1a' }); }
      grp.add(new THREE.Mesh(b.build(), worldMaterials().props));
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), basicMat({ color: '#46e6ff' }));
      led.position.y = -0.1;
      grp.add(led);
      g.scene.add(grp);
      const c = new THREE.Vector3(roadCoord(4 + i) + PITCH / 2, 18 + i * 2, roadCoord(4 + ((i * 2) % 4)) + PITCH / 2);
      const d: Drone = { group: grp, center: c, r: 30 + i * 8, t: i * 2, speed: 0.12 + i * 0.02, decoyT: 0, vel: new THREE.Vector3() };
      this.drones.push(d);
      g.hack.hackables.push({
        kind: 'drone', label: 'Delivery drone', pos: grp.position, size: new THREE.Vector3(1.1, 0.7, 1.1), range: 55,
        available: () => d.decoyT <= 0,
        act: () => {
          d.decoyT = 10;
          const away = new THREE.Vector3(grp.position.x - g.player.worldPos.x, 0, grp.position.z - g.player.worldPos.z).normalize();
          d.vel.copy(away).multiplyScalar(14);
          d.vel.y = -1.2;
          return 'DRONE HIJACKED — COPS CHASE THE DECOY';
        },
      });
    }
  }

  private buildBollards() {
    const g = this.g;
    const G = g.city.graph;
    const picks = [G.edges.find((e) => e.name === 'Union Blvd' && G.nodes[e.a].i === 6), G.edges.find((e) => e.name === 'Main Ave' && G.nodes[e.a].j === 7), G.edges.find((e) => e.name === 'Kettle Ave' && G.nodes[e.a].j === 4)];
    for (const e of picks) {
      if (!e) continue;
      const A = G.nodes[e.a], B = G.nodes[e.b];
      const x = (A.x + B.x) / 2, z = (A.z + B.z) / 2;
      const n = 6;
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 1.0, 0.4).translate(0, 0.5, 0), worldMaterials().props.clone(), n);
      (im.material as THREE.MeshLambertMaterial).vertexColors = false;
      (im.material as THREE.MeshLambertMaterial).color.set('#d8b020');
      im.material.onBeforeCompile = worldMaterials().props.onBeforeCompile;
      const boxes: import('../world/collision').AABB[] = [];
      for (let k = 0; k < n; k++) {
        const off = -5.6 + k * 2.24; // 2.24 m spacing: bikes slip through, cars don't
        const bx = e.axis === 'x' ? x : x + off, bz = e.axis === 'x' ? z + off : z;
        const box = g.col.add(bx - 0.2, 0, bz - 0.2, bx + 0.2, 1.0, bz + 0.2, false, 'bollard');
        box.enabled = false;
        boxes.push(box);
        im.setMatrixAt(k, new THREE.Matrix4().makeTranslation(bx, -1, bz));
      }
      g.scene.add(im);
      const bl: Bollards = { mesh: im, boxes, upT: 0, h: -1, x, z, axis: e.axis };
      this.bollards.push(bl);
      g.hack.hackables.push({
        kind: 'bollard', label: `Bollards — ${e.name}`, pos: new THREE.Vector3(x, 0.6, z), size: new THREE.Vector3(e.axis === 'x' ? 1 : 13, 1.2, e.axis === 'x' ? 13 : 1), range: 60,
        available: () => bl.upT <= 0,
        act: () => { bl.upT = 15; return `BOLLARDS UP ON ${e.name.toUpperCase()} — CHASE SPLIT`; },
      });
    }
  }

  // ------------------------------------------------------------------ runtime
  reset() {
    this.posted = false;
    this.wasHot = false;
    for (const b of this.bollards) { b.upT = 0; }
    for (const d of this.drones) d.decoyT = 0;
  }

  /** nearest escape options for the HUD */
  options(): { label: string; d: number }[] {
    const g = this.g;
    const P = g.player.worldPos;
    const out: { label: string; d: number }[] = [];
    const near = (label: string, pts: THREE.Vector3[] | { x: number; z: number }[]) => {
      let best = Infinity;
      for (const p of pts) best = Math.min(best, Math.hypot(p.x - P.x, p.z - P.z));
      if (best < 170) out.push({ label, d: best });
    };
    near('METRO', this.stations.map((s) => s.entrance));
    near('SEWER', this.manholes.map((m) => m.pos));
    if (!g.player.vehicle) near('HIDE', this.dumpsters);
    near('ROOFTOP', g.buildings.ladders.map((l) => ({ x: l.x, z: l.z })));
    if (g.player.vehicle) near('RESPRAY', [{ x: 17, z: 94 }]);
    near('SAFEHOUSE', [{ x: -28, z: 46 }]);
    return out.sort((a, b) => a.d - b.d).slice(0, 3);
  }

  update(dt: number) {
    const g = this.g;
    this.t += dt;
    const under = g.player.pos.y < -2;
    for (const o of this.undergroundGroups) o.visible = under;
    // trains: arrive, stop with doors open, leave
    for (const s of this.stations) {
      s.trainT = (s.trainT + dt) % 30;
      const t = s.trainT;
      let x: number;
      if (t < 4) x = 50 - (t / 4) * 50 * (2 - t / 4);
      else if (t < 13) x = 0;
      else if (t < 17) x = -Math.pow((t - 13) / 4, 2) * 60;
      else x = 70;
      s.doorsOpen = t >= 4 && t < 13;
      s.train.position.x = s.entrance.x - 9.6 + x;
      if (t > 3.9 && t < 4.0 && g.player.pos.y < -2 && Math.hypot(g.player.pos.x - s.entrance.x, g.player.pos.z - s.entrance.z) < 30) g.audio.train(g.player.pos);
    }
    // billboards: news ticker / hijack flash
    this.tickerT -= dt;
    if (this.tickerT <= 0) {
      this.tickerT = 0.12;
      for (const b of this.billboards) {
        if (b.pos.distanceTo(g.player.worldPos) > 170) continue;
        const c = b.ctx;
        if (b.flashT > 0) {
          b.flashT -= 0.12;
          const on = Math.floor(b.flashT * 6) % 2 === 0;
          c.fillStyle = on ? '#46e6ff' : '#0a1218';
          c.fillRect(0, 0, 128, 48);
          c.fillStyle = on ? '#0a1218' : '#46e6ff';
          c.font = 'bold 16px monospace';
          c.textAlign = 'center';
          c.fillText('LOOK UP!', 64, 22);
          c.font = 'bold 11px monospace';
          c.fillText('CUT THE POWER', 64, 38);
        } else {
          b.scroll += 3;
          c.fillStyle = '#1e2a36';
          c.fillRect(0, 0, 128, 48);
          c.fillStyle = '#c4a03c';
          c.fillRect(0, 0, 128, 14);
          c.fillStyle = '#1e2a36';
          c.font = 'bold 11px monospace';
          c.textAlign = 'left';
          c.fillText('CITY NEWS 24', 4, 11);
          c.fillStyle = '#e8e2d0';
          c.font = 'bold 14px monospace';
          const text = g.news.ticker;
          const w = text.length * 8.4;
          c.fillText(text, 128 - (b.scroll % (w + 128)), 34);
        }
        b.tex.needsUpdate = true;
      }
    }
    // drones: lazy circles, or flee as decoys (police follow them)
    for (const d of this.drones) {
      if (d.decoyT > 0) {
        d.decoyT -= dt;
        d.group.position.addScaledVector(d.vel, dt);
        d.group.position.y = Math.max(6, d.group.position.y);
        if (g.police.heat > 0 && g.police.lastSeenT > 1.5) g.police.lastKnown.set(d.group.position.x, 0, d.group.position.z);
        if (d.decoyT <= 0) d.t = Math.atan2(d.group.position.z - d.center.z, d.group.position.x - d.center.x) / d.speed;
      } else {
        d.t += dt;
        const a = d.t * d.speed;
        const tx = d.center.x + Math.cos(a) * d.r, tz = d.center.z + Math.sin(a) * d.r;
        d.group.position.x += (tx - d.group.position.x) * Math.min(1, dt * 0.8);
        d.group.position.z += (tz - d.group.position.z) * Math.min(1, dt * 0.8);
        d.group.position.y += (d.center.y + Math.sin(this.t + d.r) * 1.2 - d.group.position.y) * Math.min(1, dt);
      }
      d.group.rotation.y += dt * 0.6;
      (d.group.children[1] as THREE.Mesh).visible = Math.sin(this.t * 8 + d.r) > 0;
    }
    // bollards
    const m = new THREE.Matrix4();
    for (const b of this.bollards) {
      if (b.upT > 0) b.upT -= dt;
      const want = b.upT > 0 ? 0 : -1;
      if (Math.abs(b.h - want) > 0.001) {
        b.h += Math.sign(want - b.h) * Math.min(Math.abs(want - b.h), dt * 3);
        b.boxes.forEach((box, k) => {
          box.enabled = b.h > -0.4;
          m.makeTranslation((box.minX + box.maxX) / 2, b.h, (box.minZ + box.maxZ) / 2);
          b.mesh.setMatrixAt(k, m);
        });
        b.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    // hide in the cargo area of a parked van
    const P = g.player.pos;
    let van = null as null | import('../vehicles/vehicle').Vehicle;
    if (!g.player.vehicle) for (const v of g.vehicles) if ((v.kind === 'van' || v.kind === 'boxtruck') && v.driver === 'none' && Math.hypot(v.pos.x - P.x, v.pos.z - P.z) < 4.2) { van = v; break; }
    if (van && !this.vanSpot) {
      const v = van;
      this.vanSpot = { pos: v.pos, radius: 4.2, label: "Hide in the van's cargo area", enabled: () => !g.player.hidden, action: () => g.player.hide(v.pos.clone().setY(v.pos.y + 0.5)) };
      g.interactables.push(this.vanSpot);
    } else if (!van && this.vanSpot) {
      const i = g.interactables.indexOf(this.vanSpot);
      if (i >= 0) g.interactables.splice(i, 1);
      this.vanSpot = null;
    }
    // ADAPTIVE: post officers at the escapes the player keeps using
    const hot = g.police.heat > 0;
    if (hot && !this.wasHot) this.adapt();
    this.wasHot = hot;
  }

  private adapt() {
    const g = this.g;
    const e = g.save.data.escapes;
    const notes: string[] = [];
    if ((e.subway ?? 0) >= 2) {
      for (const s of this.stations) {
        const o = g.police.spawnOfficer(s.entrance.x + 2, s.entrance.z - 2, Math.PI, null);
        o.post = s.entrance.clone().add(new THREE.Vector3(2.2, 0, -2));
      }
      notes.push('the SUBWAY');
    }
    if ((e.sewer ?? 0) >= 2) {
      for (const m of this.manholes.slice(0, 4)) { const o = g.police.spawnOfficer(m.pos.x + 1.5, m.pos.z, 0, null); o.post = m.pos.clone().add(new THREE.Vector3(1.5, 0, 0)); }
      notes.push('the SEWERS');
    }
    if ((e.garage ?? 0) >= 2) notes.push('the PARKING GARAGE');
    if ((e.rooftop ?? 0) >= 2) { g.police.airWatch = true; notes.push('the ROOFTOPS (air unit)'); }
    if ((e.hide ?? 0) >= 2) { g.police.searchHides = true; notes.push('DUMPSTERS'); }
    if (notes.length) g.hud.hint(`Police are watching ${notes.join(', ')}`);
  }
}
