// Everything that moves on the harbour: waves, the drawbridge, marinas and their boats,
// wakes, and what happens to you and your car when you end up in the drink.
import * as THREE from 'three';
import { Kit } from './interior';
import { GeoBuilder } from './geo';
import { BRIDGE, BRIDGE_H, CURB_H, HALF, isWater, LAGOON, ROAD_HALF, SEA_LIMIT, SHORE, surfaces, Surface } from './layout';
import { worldMaterials } from './materials';
import { texWaves } from '../assets/textures';
import { worldMat } from '../render/patch';
import { EAST_PIER, CARGO_PIER, VILLA_JETTY, BOARDWALK } from './waterfront';
import { Vehicle } from '../vehicles/vehicle';
import type { CarKind } from '../vehicles/carMesh';
import type { AABB } from './collision';
import type { REdge } from './layout';
import type { Game } from '../core/game';

interface BoatSpot { x: number; z: number; heading: number; kind: CarKind; color: string; price: number; locked: boolean; landing: { x: number; y: number; z: number }; v: Vehicle | null; taken: boolean; }

/** seconds the drawbridge stays up on its own */
const UP_TIME = 32;
const LEAF_TIME = 4;

type BridgeState = 'down' | 'closing-road' | 'rising' | 'up' | 'lowering';

export class Drawbridge {
  state: BridgeState = 'down';
  private t = 0;
  private upT = 0;
  private leaves: THREE.Group[] = [];
  private booms: THREE.Mesh[] = [];
  private stops: AABB[] = [];
  private gate!: AABB;
  private deck: Surface;
  private angle = 0;
  edge!: REdge;
  readonly a = BRIDGE.x0;
  readonly b = BRIDGE.x1;

  constructor(private g: Game) {
    const zn = HALF - ROAD_HALF, zs = HALF + ROAD_HALF;
    this.deck = { x0: this.a, z0: zn, x1: this.b, z1: zs, h0: BRIDGE_H };
  }

  get open() { return this.state !== 'down'; }
  /** nothing can cross by road, and tall boats can pass */
  get raised() { return this.state === 'rising' || this.state === 'up'; }

  build() {
    const g = this.g;
    const zn = HALF - ROAD_HALF, zs = HALF + ROAD_HALF, mid = (this.a + this.b) / 2, half = (this.b - this.a) / 2;
    this.edge = g.city.graph.edgeBetween(g.city.graph.node(5, 12).id, g.city.graph.node(6, 12).id)!;
    surfaces.push(this.deck);
    // the leaves hinge at each end of the span
    for (const dir of [1, -1]) {
      const b = new GeoBuilder();
      const u0 = dir > 0 ? 0 : -half, u1 = dir > 0 ? half : 0;
      b.box(u0, -1.6, -ROAD_HALF, u1, -0.02, ROAD_HALF, { color: '#3a4048', shadeSides: true }); // heavy girders: tall boats can't get under
      b.box(u0, -0.02, -ROAD_HALF, u1, 0.02, ROAD_HALF, { color: '#34322e' });
      b.box(u0, 0.02, -0.15, u1, 0.03, 0.15, { color: '#c4a03c' });
      for (const z of [-ROAD_HALF, ROAD_HALF - 0.15]) b.box(u0, 0, z, u1, 0.9, z + 0.15, { color: '#c9552a' });
      for (let u = u0 + 1; u < u1; u += 3) b.box(u, 0.03, -3.6, u + 1.5, 0.04, -3.45, { color: '#c8c3b5' }), b.box(u, 0.03, 3.45, u + 1.5, 0.04, 3.6, { color: '#c8c3b5' });
      const m = new THREE.Mesh(b.build(), worldMaterials().props);
      m.castShadow = true;
      const pivot = new THREE.Group();
      pivot.position.set(dir > 0 ? this.a : this.b, BRIDGE_H, HALF);
      pivot.add(m);
      g.scene.add(pivot);
      this.leaves.push(pivot);
    }
    // rails along the sides while it's down, and stops at the ends when it isn't
    for (const [z0, z1] of [[zn - 0.2, zn], [zs, zs + 0.2]]) g.col.add(this.a, BRIDGE_H, z0, this.b, BRIDGE_H + 1.2, z1, false, 'rail');
    for (const x of [this.a - 1.2, this.b + 1]) {
      const s = g.col.add(x, 0, zn, x + 0.2, BRIDGE_H + 3, zs, true, 'barrier');
      s.enabled = false;
      this.stops.push(s);
      const bb = new GeoBuilder();
      for (let i = 0; i < 7; i++) bb.box(i * 2, -0.12, -0.08, i * 2 + 2, 0.12, 0.08, { color: i % 2 ? '#e8e4d8' : '#c0281e' });
      const boom = new THREE.Mesh(bb.build(), worldMaterials().props);
      boom.position.set(x + 0.1, BRIDGE_H + 1.1, zn + 0.2);
      boom.rotation.set(0, -Math.PI / 2, 0);
      boom.rotation.order = 'YXZ';
      g.scene.add(boom);
      this.booms.push(boom);
      // post lights
      const p = new Kit(g.col);
      p.props.cbox(x + 0.1, BRIDGE_H + 0.6, zn + 0.2, 0.3, 1.2, 0.3, { color: '#3a3c3e' });
      p.glow.cbox(x + 0.1, BRIDGE_H + 1.4, zn + 0.2, 0.25, 0.25, 0.25, { color: '#c0281e' });
      p.finish(g.scene);
    }
    this.gate = g.col.add(this.a, -0.5, HALF - 0.6, this.b, 1, HALF + 0.6, false, 'bridge');
    // the sign
    const signs = new Kit(g.col);
    signs.sign('SHORE ROAD BRIDGE', mid, 11.5, HALF - 8, Math.PI, 12, 1.1, '#2f3b4d', '#ffd27a');
    signs.sign('SHORE ROAD BRIDGE', mid, 11.5, HALF + 8, 0, 12, 1.1, '#2f3b4d', '#ffd27a');
    signs.finish(g.scene);
    g.hack.hackables.push({
      kind: 'bridge', label: 'Drawbridge', pos: new THREE.Vector3(mid, 9, HALF), size: new THREE.Vector3(this.b - this.a, 16, 16), range: 110,
      available: () => this.state === 'down' || this.state === 'up',
      act: () => {
        if (this.state === 'down') { this.raise(); return 'BRIDGE GOING UP: CARS STOP, BOATS PASS'; }
        this.lower();
        return 'BRIDGE COMING DOWN';
      },
    });
  }

  raise() {
    this.state = 'closing-road';
    this.t = 0;
    this.setRoad(false);
    this.g.audio.alarmBell(2);
  }

  lower() {
    this.state = 'lowering';
    this.t = 0;
    this.g.audio.pop();
  }

  private setRoad(open: boolean) {
    const g = this.g;
    this.edge.closed = !open;
    for (const s of this.stops) s.enabled = !open;
    // the police think again as soon as the road changes
    for (const u of g.police.units) { const ai = u.ai as { repathT?: number }; if (ai) ai.repathT = 0; }
    if (!open) g.hud.hint('Police and traffic have to go round by Shore Rd.');
  }

  /** room before the bridge for a vehicle heading at it, or null if there's nothing to stop for */
  holdDist(v: Vehicle) {
    if (!this.open) return null;
    if (Math.abs(v.pos.z - HALF) > ROAD_HALF + 1) return null;
    const fx = Math.sin(v.heading);
    if (fx > 0.3 && v.pos.x < this.a) { const d = this.a - v.pos.x; return d < 60 ? d - 4 : null; }
    if (fx < -0.3 && v.pos.x > this.b) { const d = v.pos.x - this.b; return d < 60 ? d - 4 : null; }
    return null;
  }

  update(dt: number) {
    const g = this.g;
    if (this.state === 'closing-road') {
      this.t += dt;
      const clear = !g.vehicles.some((v) => v.pos.x > this.a && v.pos.x < this.b && Math.abs(v.pos.z - HALF) < ROAD_HALF + 1 && v.pos.y > 0);
      if (this.t > 1.2 && (clear || this.t > 5)) {
        this.state = 'rising';
        this.t = 0;
        const i = surfaces.indexOf(this.deck);
        if (i >= 0) surfaces.splice(i, 1);
        this.gate.enabled = false;
        this.upT = UP_TIME;
      }
    } else if (this.state === 'rising') {
      this.angle = Math.min(1, this.angle + dt / LEAF_TIME);
      if (this.angle >= 1) this.state = 'up';
    } else if (this.state === 'up') {
      this.upT -= dt;
      if (this.upT <= 0) this.lower();
    } else if (this.state === 'lowering') {
      this.angle = Math.max(0, this.angle - dt / LEAF_TIME);
      if (this.angle <= 0) {
        this.state = 'down';
        surfaces.push(this.deck);
        this.gate.enabled = true;
        this.setRoad(true);
      }
    }
    const a = this.angle * 1.25;
    this.leaves[0].rotation.z = a;
    this.leaves[1].rotation.z = -a;
    const boomUp = this.state === 'down' ? 1 : 0;
    for (const b of this.booms) b.rotation.x = THREE.MathUtils.damp(b.rotation.x, boomUp * -1.3, 5, dt);
  }

  reset() {
    this.state = 'down';
    this.angle = 0;
    this.t = 0;
    if (!surfaces.includes(this.deck)) surfaces.push(this.deck);
    this.gate.enabled = true;
    this.edge.closed = false;
    for (const s of this.stops) s.enabled = false;
  }
}

export class Water {
  bridge: Drawbridge;
  spots: BoatSpot[] = [];
  private landings: { x: number; y: number; z: number }[] = [];
  private tex!: THREE.CanvasTexture;
  private waveT = 0;
  private wakeT = 0;
  private sinkT = 0;
  private hintT = 0;
  private fishT = 0;
  private sailors: THREE.InstancedMesh | null = null;
  private dummy = new THREE.Object3D();

  constructor(private g: Game) {
    this.bridge = new Drawbridge(g);
  }

  build() {
    const g = this.g;
    this.tex = texWaves();
    (g.city.water.material as THREE.Material).dispose();
    g.city.water.material = worldMat({ map: this.tex, color: 0xffffff });
    this.bridge.build();
    const blue = '#3f7b88', red = '#9b3b2f', cream = '#e6dcc0';
    const add = (x: number, z: number, heading: number, kind: CarKind, color: string, price: number, landing: { x: number; y: number; z: number }, locked = true) => {
      this.spots.push({ x, z, heading, kind, color, price, locked, landing, v: null, taken: false });
      this.landings.push(landing);
    };
    const quayY = CURB_H;
    // the lagoon, along its north quay
    add(LAGOON.x0 + 7, LAGOON.z0 + 1.5, Math.PI / 2, 'jetski', red, 60, { x: LAGOON.x0 + 7, y: quayY, z: LAGOON.z0 - 1.4 });
    add(LAGOON.x0 + 17, LAGOON.z0 + 1.9, Math.PI / 2, 'speedboat', cream, 150, { x: LAGOON.x0 + 17, y: quayY, z: LAGOON.z0 - 1.4 });
    add(LAGOON.x0 + 27, LAGOON.z0 + 1.5, Math.PI / 2, 'jetski', blue, 60, { x: LAGOON.x0 + 27, y: quayY, z: LAGOON.z0 - 1.4 });
    // the docks marina, on both sides of its pier
    const pz = (EAST_PIER.z0 + EAST_PIER.z1) / 2, py = EAST_PIER.h;
    add(358, EAST_PIER.z1 + 2.6, Math.PI / 2, 'speedboat', red, 150, { x: 358, y: py, z: pz });
    add(370, EAST_PIER.z1 + 2.4, Math.PI / 2, 'jetski', cream, 60, { x: 370, y: py, z: pz });
    add(380, EAST_PIER.z1 + 2.6, Math.PI / 2, 'speedboat', blue, 150, { x: 380, y: py, z: pz });
    add(365, EAST_PIER.z0 - 2.6, Math.PI / 2, 'speedboat', '#2f3b4d', 150, { x: 365, y: py, z: pz });
    // a police launch, tied up at the cargo pier: steal at your own risk
    add(375, CARGO_PIER.z0 - 3, Math.PI / 2, 'policeboat', '#1c1c1e', 0, { x: 375, y: CARGO_PIER.h, z: CARGO_PIER.z0 + 1.2 });
    // more places you can step ashore
    this.landings.push({ x: VILLA_JETTY.x0 + 4, y: VILLA_JETTY.h, z: VILLA_JETTY.z1 - 2 }, { x: -94, y: BOARDWALK.h, z: BOARDWALK.z1 - 2 }, { x: -60, y: BOARDWALK.h, z: BOARDWALK.z1 - 2 }, { x: -120, y: BOARDWALK.h, z: BOARDWALK.z1 - 2 });

    const sign = new Kit(g.col);
    sign.sign('HARBOUR MARINA', LAGOON.x1 + 1.5, CURB_H + 3, (LAGOON.z0 + LAGOON.z1) / 2, -Math.PI / 2, 5, 0.9, '#2f4a6a', '#fff1d0');
    sign.sign('DOCKS MARINA', 389, EAST_PIER.h + 3.5, EAST_PIER.z0 + 4, -Math.PI / 2, 4, 0.8, '#2f4a6a', '#fff1d0');
    sign.finish(g.scene);

    const rentIntro = 'Rent a jet ski ($60) or a speedboat ($150). Press E on the one you want. Broke? Hold E and pick the lock.';
    g.activities.add({ id: 'marina-harbour', name: 'Harbour Marina', type: 'marina', icon: 'boat', x: (LAGOON.x0 + LAGOON.x1) / 2, z: LAGOON.z0 - 1.4, category: 'service', color: '#6ad0e8', intro: rentIntro, short: 'Tap ACTION on a boat to rent it. Broke? Hold to pick the lock.' });
    g.activities.add({ id: 'marina-docks', name: 'Docks Marina', type: 'marina', icon: 'boat', x: 368, z: pz, category: 'service', color: '#6ad0e8', intro: rentIntro, short: 'Tap ACTION on a boat to rent it. Broke? Hold to pick the lock.' });
    g.activities.add({ id: 'bridge', name: 'Shore Road Bridge', type: 'marina', icon: 'bridge', x: (BRIDGE.x0 + BRIDGE.x1) / 2, z: HALF - ROAD_HALF - 2, category: 'service', color: '#ffb84a', intro: 'A drawbridge you can hack. Raise it and cars stop while boats go through. A speedboat can\'t get under it when it\'s down, a jet ski can.', short: 'Hack it: cars stop, boats pass.' });

    // a few anchored yachts out in the bay
    const b = new GeoBuilder();
    b.box(-1.1, -0.2, -3.2, 1.1, 0.9, 3.2, { color: '#e8e4d8', shadeSides: true });
    b.box(-0.8, 0.9, -1.2, 0.8, 1.6, 1.4, { color: '#3e5870', shadeSides: true });
    b.cbox(0, 5.2, 0, 0.1, 8, 0.1, { color: '#3a3c3e' });
    this.sailors = new THREE.InstancedMesh(b.build(), worldMaterials().props, 7);
    this.sailors.frustumCulled = false;
    g.scene.add(this.sailors);
    return this;
  }

  reset() {
    for (const s of this.spots) { s.v = null; s.taken = false; }
    this.bridge.reset();
    this.fishT = 0;
  }

  /** the nearest place to step off a boat, within reach */
  landingNear(x: number, z: number, reach = 7.5) {
    let best: { x: number; y: number; z: number } | null = null, bd = reach;
    for (const l of this.landings) { const d = Math.hypot(l.x - x, l.z - z); if (d < bd) { bd = d; best = l; } }
    return best;
  }

  /** dragged out of the water: whatever's closest */
  nearestLanding(x: number, z: number) {
    let best = this.landings[0], bd = Infinity;
    for (const l of this.landings) { const d = Math.hypot(l.x - x, l.z - z); if (d < bd) { bd = d; best = l; } }
    // the seawall may well be closer than any pier
    const wx = Math.min(x, SHORE - 2.5), wz = Math.min(z, SHORE - 2.5);
    if (!isWater(wx, wz) && Math.hypot(wx - x, wz - z) < bd) return { x: wx, y: CURB_H, z: wz };
    return best;
  }

  private streamBoats(P: THREE.Vector3) {
    const g = this.g;
    for (const s of this.spots) {
      const d = Math.hypot(s.x - P.x, s.z - P.z);
      if (s.v && !g.vehicles.includes(s.v)) { s.v = null; s.taken = false; }
      if (s.v && d > 230 && s.v.driver === 'none') { g.removeVehicle(s.v); s.v = null; s.taken = false; continue; }
      if (!s.v && d < 170) {
        const v = new Vehicle(s.kind, s.color, g.col);
        v.place(s.x, s.z, s.heading);
        v.locked = s.locked;
        if (s.price) v.rental = s.price;
        g.addVehicle(v);
        s.v = v;
      }
    }
  }

  update(dt: number, realDt: number) {
    const g = this.g;
    this.bridge.update(dt);
    // pixel waves, in steps
    this.waveT -= realDt;
    if (this.waveT <= 0) {
      this.waveT = 0.14;
      this.tex.offset.x = (this.tex.offset.x + 1 / 64) % 1;
      this.tex.offset.y = (this.tex.offset.y + 1 / 128) % 1;
    }
    const P = g.player.worldPos, pv = g.player.vehicle;
    this.streamBoats(P);

    if (this.sailors) {
      const t = g.time;
      for (let i = 0; i < 7; i++) {
        const x = -280 + i * 110, z = 405 + ((i * 37) % 40);
        this.dummy.position.set(x, -1.5 + Math.sin(t * 0.8 + i) * 0.08, z);
        this.dummy.rotation.set(Math.sin(t * 0.6 + i) * 0.03, i * 1.3, Math.cos(t * 0.5 + i) * 0.05);
        this.dummy.updateMatrix();
        this.sailors.setMatrixAt(i, this.dummy.matrix);
      }
      this.sailors.instanceMatrix.needsUpdate = true;
    }

    // wakes
    this.wakeT -= realDt;
    if (this.wakeT <= 0) {
      this.wakeT = 0.05;
      for (const v of g.vehicles) {
        if (!v.boat || v.speedAbs < 4 || Math.hypot(v.pos.x - P.x, v.pos.z - P.z) > 120) continue;
        const L = v.parts.dims.len / 2;
        g.fx.spawn('wake', new THREE.Vector3(v.pos.x - v.fwdX * L, -1.35, v.pos.z - v.fwdZ * L), v === pv ? 3 : 2, undefined, Math.min(1.6, v.speedAbs / 18));
      }
    }

    // anything that isn't a boat, in the water
    for (const v of g.vehicles) {
      if (v.sunk) continue;
      if (v.boat ? v.wrecked : v.pos.y < -0.7 && isWater(v.pos.x, v.pos.z)) {
        v.sunk = true;
        v.wrecked = true;
        v.siren = false;
        const sp = new THREE.Vector3(v.pos.x, -1.2, v.pos.z);
        if (Math.hypot(sp.x - P.x, sp.z - P.z) < 100) { g.fx.spawn('wake', sp, 30, undefined, 2.4); g.audio.crash(10, sp); }
        if (v === pv) { this.sinkT = 1.3; g.hud.toast(v.boat ? 'SUNK!' : 'YOUR RIDE IS IN THE HARBOUR', 'heat'); }
      }
    }
    if (this.sinkT > 0) {
      this.sinkT -= realDt;
      if (this.sinkT <= 0 && pv?.sunk) {
        const P0 = pv.pos, land = this.nearestLanding(P0.x, P0.z), lost = pv;
        g.player.exitVehicle(true);
        g.player.spawn(land.x, land.z, g.player.heading);
        g.player.pos.y = land.y;
        g.camRig.snapBehind(g.player.heading);
        g.hud.hint('Fished out and dripping. The vehicle is gone.');
        // a rental stays lost: its spot restocks once you're away
        lost.driver === 'none' && g.removeVehicle(lost);
      }
    }
    // you, on foot, in the water
    if (!pv && !g.fading && g.player.pos.y < -0.3 && isWater(g.player.pos.x, g.player.pos.z)) {
      this.fishT += realDt;
      if (this.fishT > 0.6) {
        this.fishT = 0;
        const l = this.nearestLanding(g.player.pos.x, g.player.pos.z);
        g.fadeTeleport(l.x, l.y, l.z, g.player.heading, 'FISHED OUT');
        g.fx.spawn('wake', new THREE.Vector3(g.player.pos.x, -1.2, g.player.pos.z), 14, undefined, 1.6);
      }
    }

    // at a boat's controls
    if (pv?.boat && !pv.sunk) {
      this.hintT -= realDt;
      const land = this.landingNear(pv.pos.x, pv.pos.z);
      if (land && pv.speedAbs < 6 && !g.carAction) g.carAction = { label: 'Step ashore', action: () => g.player.exitVehicle() };
      const off = Math.max(pv.pos.x, pv.pos.z) - SEA_LIMIT;
      if (off > -8 && this.hintT <= 0) { g.hud.hint('Open sea. The coast guard turns you back from here.'); this.hintT = 10; }
      const near = Math.abs(pv.pos.z - HALF) < 40 && pv.pos.x > BRIDGE.x0 - 10 && pv.pos.x < BRIDGE.x1 + 10;
      if (near && !this.bridge.raised && pv.kind !== 'jetski' && this.hintT <= 0) { g.hud.hint('Too tall to get under. Hack the bridge to raise it.'); this.hintT = 8; }
    }
  }
}
