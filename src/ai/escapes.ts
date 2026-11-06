// ESCAPE OPTIONS beyond "drive away" (the metro has its own file, world/metro.ts):
// sewer manholes, hiding spots (dumpsters, van cargo), decoys (billboards,
// delivery drones), hackable bollard barriers, and a HUD list of what's
// nearby. Police adapt to the player's favourite escapes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PAL } from '../core/palette';
import { Rng } from '../core/math';
import { Kit } from '../world/interior';
import { GeoBuilder } from '../world/geo';
import { worldMaterials } from '../world/materials';
import { CURB_H, blockBounds, roadCoord, PITCH } from '../world/layout';
import { basicMat } from '../render/patch';
import type { Game } from '../core/game';
import type { Interactable } from '../player/player';

interface Manhole { pos: THREE.Vector3; pair: number; name: string; }
export interface Billboard { pos: THREE.Vector3; mesh: THREE.Mesh; tex: THREE.CanvasTexture; ctx: CanvasRenderingContext2D; flashT: number; scroll: number; msg?: string; msgT: number; }
interface Drone { group: THREE.Group; center: THREE.Vector3; r: number; t: number; speed: number; decoyT: number; vel: THREE.Vector3; }
interface Bollards { mesh: THREE.InstancedMesh; boxes: import('../world/collision').AABB[]; upT: number; h: number; x: number; z: number; axis: 'x' | 'z'; }

const UG = -8; // nothing's down here now; the sums for it stay out of the way
const CEIL = 4.2;

export class Escapes {
  get stations() { return this.g.metro.stations; }
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

  constructor(private g: Game) {}

  build() {
    this.buildSewers();
    this.buildDumpsters();
    this.buildBillboards();
    this.buildDrones();
    this.buildBollards();
    return this;
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
      if (x > -46 && x < -10 && z > 44 && z < 50) continue; // keep the home's door and driveway clear
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
      // a screen on each side of the backing, one draw call
      const face = new THREE.PlaneGeometry(8, 3).translate(0, 0, 0.12);
      const mesh = new THREE.Mesh(mergeGeometries([face, face.clone().rotateY(Math.PI)]), basicMat({ map: tex }));
      const ox = Math.sin(h) * 6, oz = Math.cos(h) * 6;
      mesh.position.set(x + ox, 8.5, z + oz);
      mesh.rotation.y = h + Math.PI;
      g.scene.add(mesh);
      const back = new GeoBuilder();
      back.cbox(x + ox, 8.5, z + oz, Math.abs(Math.cos(h)) * 8.4 + 0.2, 3.4, Math.abs(Math.sin(h)) * 8.4 + 0.2, { color: '#2a2a2a' });
      back.cbox(x + ox, 3.5, z + oz, 0.4, 7, 0.4, { color: PAL.metal });
      g.scene.add(new THREE.Mesh(back.build(), worldMaterials().props));
      g.col.addCentered(x + ox, z + oz, 0.5, 0.5, 7, 0, false, 'pole');
      const bb: Billboard = { pos: mesh.position, mesh, tex, ctx, flashT: 0, scroll: Math.random() * 400, msgT: 0 };
      this.billboards.push(bb);
      g.hack.hackables.push({
        kind: 'billboard', label: 'Billboard', pos: mesh.position, size: new THREE.Vector3(8.2, 3.2, 0.6), range: 60,
        available: () => bb.flashT <= 0,
        act: () => {
          bb.flashT = 10;
          g.peds.lure(new THREE.Vector3(mesh.position.x, 0, mesh.position.z), 40);
          g.police.lure(new THREE.Vector3(mesh.position.x, 0, mesh.position.z));
          g.audio.hackBlip();
          g.pranks.openBillboard(bb);
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
    // billboards: news ticker / hijack flash
    this.tickerT -= dt;
    if (this.tickerT <= 0) {
      this.tickerT = 0.12;
      for (const b of this.billboards) {
        if (b.pos.distanceTo(g.player.worldPos) > 170) continue;
        const c = b.ctx;
        if (b.msgT > 0) {
          // your message, in the biggest letters that fit
          b.msgT -= 0.12;
          const on = Math.floor(b.msgT * 2) % 2 === 0;
          c.fillStyle = on ? '#0a1218' : '#1a0f24';
          c.fillRect(0, 0, 128, 48);
          c.fillStyle = on ? '#46e6ff' : '#ff7ab8';
          c.textAlign = 'center';
          const words = (b.msg ?? '').split(' ');
          const mid = Math.ceil(words.length / 2);
          const l1 = words.slice(0, mid).join(' '), l2 = words.slice(mid).join(' ');
          c.font = `bold ${Math.min(18, Math.floor(190 / Math.max(l1.length, l2.length, 8)))}px monospace`;
          c.fillText(l1, 64, l2 ? 21 : 29);
          if (l2) c.fillText(l2, 64, 39);
        } else if (b.flashT > 0) {
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
