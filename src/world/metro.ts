// The elevated metro. One loop over the streets, carried on portal frames that stand
// on the kerbs, so traffic runs underneath untouched. Trains are instanced cars on a
// spline, on a schedule, and you can see them from anywhere. Riding one, the car you're
// in is swapped for a real interior; everyone else just sees the train go by.
import * as THREE from 'three';
import { Kit } from './interior';
import { GeoBuilder } from './geo';
import { CURB_H, METRO_LINE, METRO_RAIL, surfaces } from './layout';
import { homeMaterial, makeBake } from './home';
import { worldMaterials } from './materials';
import { basicMat } from '../render/patch';
import { RigCharacter } from '../characters/rig';
import { makePedSkin } from '../characters/pedTypes';
import { COP_SKIN } from '../characters/skins';
import { Rng, clamp } from '../core/math';
import type { Game } from '../core/game';

const FLOOR = METRO_RAIL + 0.35;
const CARS = 4, TRAINS = 3, CAR_LEN = 12, CAR_GAP = 1, CAR_WID = 2.7;
const VMAX = 22, VCORNER = 11, ACCEL = 2.4;
const DWELL = 9, FARE = 5, GATE_TIME = 20;
const STOP_TIME = 12;
const CORNER_R = 12;
const COUNT = CARS * TRAINS;
/** three doors a side, two leaves each */
const DOOR_Z = [-4, 0, 4];

export interface Station { name: string; entrance: THREE.Vector3; platform: THREE.Vector3; heading: number; s: number; side: number; gateT: number; cx: number; cz: number; tx: number; tz: number; nx: number; nz: number; }

interface Train {
  s: number; v: number;
  next: number;
  dwell: number;
  stopT: number;
  /** 0 shut, 1 open */
  doors: number;
  pos: THREE.Vector3;
  arrived: boolean;
}

const STOPS: [string, number, number, number][] = [
  // name, x, z on the line, and which side the platform and stairs are on (+1 or -1 along the normal)
  ['Northside', 28, -280, 1],
  ['Foundry', 56, -140, 1],
  ['Harbor', 168, 84, 1],
  ['Southgate', 28, 168, 1],
  ['Canal St', -112, 84, 1],
  ['Old Town', -196, 0, 1],
];

export class Metro {
  stations: Station[] = [];
  trains: Train[] = [];
  /** one point per metre round the loop */
  private px: number[] = [];
  private pz: number[] = [];
  private limit: number[] = [];
  private len = 0;
  private bodies!: THREE.InstancedMesh;
  private lights!: THREE.InstancedMesh;
  private leaves!: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private one = new THREE.Vector3(1, 1, 1);
  private zero = new THREE.Vector3(0, 0, 0);
  private rng = new Rng(4242);
  // the carriage you're riding in
  private inside!: THREE.Group;
  private insideLeft!: THREE.Mesh;
  private insideRight!: THREE.Mesh;
  private riding: { train: Train; car: number } | null = null;
  private lookYaw = 0;
  private lookPitch = 0;
  private cop: RigCharacter | null = null;
  private copZ = 0;
  private passengers: RigCharacter[] = [];
  /** a cop's hand is on your shoulder */
  copClose = false;

  constructor(private g: Game) {}

  // ------------------------------------------------------------------ the line
  private buildSpline() {
    const out: [number, number, boolean][] = [];
    const n = METRO_LINE.length;
    for (let i = 0; i < n; i++) {
      const a = METRO_LINE[i], b = METRO_LINE[(i + 1) % n], c = METRO_LINE[(i + 2) % n];
      const lab = Math.hypot(b[0] - a[0], b[1] - a[1]), lbc = Math.hypot(c[0] - b[0], c[1] - b[1]);
      const d0 = [(b[0] - a[0]) / lab, (b[1] - a[1]) / lab], d1 = [(c[0] - b[0]) / lbc, (c[1] - b[1]) / lbc];
      const sx = a[0] + d0[0] * CORNER_R, sz = a[1] + d0[1] * CORNER_R;
      const ex = b[0] - d0[0] * CORNER_R, ez = b[1] - d0[1] * CORNER_R;
      out.push([sx, sz, false], [ex, ez, false]);
      for (let t = 1 / 10; t < 1; t += 1 / 10) {
        const p0 = [ex, ez], p2 = [b[0] + d1[0] * CORNER_R, b[1] + d1[1] * CORNER_R];
        const u = 1 - t;
        out.push([u * u * p0[0] + 2 * u * t * b[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * b[1] + t * t * p2[1], true]);
      }
    }
    // resample at one metre
    let total = 0;
    const L: number[] = [];
    for (let i = 0; i < out.length; i++) {
      const p = out[i], q = out[(i + 1) % out.length];
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      L.push(d);
      total += d;
    }
    const N = Math.floor(total);
    this.len = N;
    const scale = total / N;
    let seg = 0, along = 0;
    for (let k = 0; k < N; k++) {
      const want = k * scale;
      while (along + L[seg] < want && seg < out.length - 1) { along += L[seg]; seg++; }
      const t = (want - along) / (L[seg] || 1);
      const p = out[seg], q = out[(seg + 1) % out.length];
      this.px.push(p[0] + (q[0] - p[0]) * t);
      this.pz.push(p[1] + (q[1] - p[1]) * t);
      this.limit.push(p[2] || q[2] ? VCORNER : VMAX);
    }
    // brake for corners: walk back round the loop twice
    for (let pass = 0; pass < 2; pass++)
      for (let k = N - 1; k >= 0; k--) {
        const nextV = this.limit[(k + 1) % N];
        this.limit[k] = Math.min(this.limit[k], Math.sqrt(nextV * nextV + 2 * ACCEL));
      }
  }

  private at(s: number) {
    const N = this.len;
    const w = ((s % N) + N) % N;
    const i = Math.floor(w), f = w - i, j = (i + 1) % N;
    return { x: this.px[i] + (this.px[j] - this.px[i]) * f, z: this.pz[i] + (this.pz[j] - this.pz[i]) * f };
  }

  private nearestS(x: number, z: number) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.len; i++) { const d = Math.hypot(this.px[i] - x, this.pz[i] - z); if (d < bd) { bd = d; best = i; } }
    return best;
  }

  /** ahead-of-it distance round the loop */
  private ahead(from: number, to: number) { return ((to - from) % this.len + this.len) % this.len; }

  // ------------------------------------------------------------------ building it
  build() {
    this.buildSpline();
    this.buildViaduct();
    this.buildStations();
    this.buildCars();
    this.buildInterior();
    this.reset();
    return this;
  }

  private buildViaduct() {
    const g = this.g, b = new GeoBuilder();
    const n = METRO_LINE.length, beam = '#4a4c50', rail = '#8a8a84', steel = '#3a3c40';
    const Y = METRO_RAIL;
    const ax = (x: number) => ((x % 56) + 56) % 56;
    for (let i = 0; i < n; i++) {
      const a = METRO_LINE[i], c = METRO_LINE[(i + 1) % n];
      const alongX = a[0] !== c[0];
      const lo = Math.min(alongX ? a[0] : a[1], alongX ? c[0] : c[1]) + CORNER_R, hi = Math.max(alongX ? a[0] : a[1], alongX ? c[0] : c[1]) - CORNER_R;
      const fix = alongX ? a[1] : a[0];
      const box = (u0: number, y0: number, v0: number, u1: number, y1: number, v1: number, color: string) => {
        if (alongX) b.box(u0, y0, fix + v0, u1, y1, fix + v1, { color, shadeSides: true });
        else b.box(fix + v0, y0, u0, fix + v1, y1, u1, { color, shadeSides: true });
      };
      box(lo, Y - 0.75, -1.8, hi, Y - 0.05, 1.8, beam);
      for (const v of [-0.75, 0.75]) box(lo, Y - 0.05, v - 0.06, hi, Y + 0.02, v + 0.06, rail);
      // portal frames: columns on the kerbs, clear of every lane, none in a junction
      for (let u = Math.ceil(lo); u < hi; u++) {
        const r = ax(u);
        if (r !== 16 && r !== 40) continue;
        for (const v of [-6.95, 6.95]) {
          box(u - 0.25, 0, v - 0.25, u + 0.25, Y - 0.75, v + 0.25, steel);
          if (alongX) g.col.addCentered(u, fix + v, 0.5, 0.5, Y - 0.75, 0, false, 'pier');
          else g.col.addCentered(fix + v, u, 0.5, 0.5, Y - 0.75, 0, false, 'pier');
        }
        box(u - 0.3, Y - 1.45, -7.2, u + 0.3, Y - 0.75, 7.2, steel);
      }
    }
    // the corners: short pieces following the curve, and a column on the outside
    for (let i = 0; i < this.len; i += 2) {
      if (this.limit[i] >= VMAX && this.limit[(i + 8) % this.len] >= VMAX) continue;
      const x = this.px[i], z = this.pz[i];
      if (!METRO_LINE.some(([cx, cz]) => Math.hypot(cx - x, cz - z) < CORNER_R + 3)) continue;
      b.cbox(x, Y - 0.4, z, 3.6, 0.7, 3.6, { color: beam, shadeSides: true });
      b.cbox(x, Y - 0.02, z, 2, 0.08, 2, { color: rail });
    }
    const m = new THREE.Mesh(b.build(), worldMaterials().props);
    m.castShadow = true;
    m.receiveShadow = true;
    g.scene.add(m);
  }

  private buildStations() {
    const g = this.g, b = new GeoBuilder(), signs = new Kit(g.col);
    for (const [name, x, z, side] of STOPS) {
      const s0 = this.nearestS(x, z);
      const p = this.at(s0), q = this.at(s0 + 2);
      const tx = Math.sign(Math.round(q.x - p.x)), tz = Math.sign(Math.round(q.z - p.z));
      const alongX = tx !== 0;
      // the right-hand normal to the direction of travel, times the chosen side
      const nx = -tz * side, nz = tx * side;
      const heading = Math.atan2(tx, tz);
      const HL = 27, inner = 1.95, outer = 6.4;
      const rect = (u0: number, v0: number, u1: number, v1: number) => {
        const ax = x + tx * u0 + nx * v0, az = z + tz * u0 + nz * v0, bx = x + tx * u1 + nx * v1, bz = z + tz * u1 + nz * v1;
        return { x0: Math.min(ax, bx), z0: Math.min(az, bz), x1: Math.max(ax, bx), z1: Math.max(az, bz) };
      };
      const deck = rect(-HL, inner, HL, outer);
      b.box(deck.x0, METRO_RAIL - 0.4, deck.z0, deck.x1, FLOOR - 0.02, deck.z1, { color: '#6e6b65', shadeSides: true });
      b.box(deck.x0, FLOOR - 0.02, deck.z0, deck.x1, FLOOR, deck.z1, { color: '#8a857c' });
      const edge = rect(-HL, inner, HL, inner + 0.3);
      b.box(edge.x0, FLOOR, edge.z0, edge.x1, FLOOR + 0.01, edge.z1, { color: '#e6c84a' });
      surfaces.push({ x0: deck.x0, z0: deck.z0, x1: deck.x1, z1: deck.z1, h0: FLOOR });
      g.col.add(deck.x0, FLOOR - 0.4, deck.z0, deck.x1, FLOOR - 0.02, deck.z1, false, 'floor');
      // don't walk onto the track, or off the edge
      const inr = rect(-HL, inner - 0.12, HL, inner); g.col.add(inr.x0, FLOOR, inr.z0, inr.x1, FLOOR + 2.4, inr.z1, false, 'rail');
      const otr = rect(-HL, outer, HL, outer + 0.12); g.col.add(otr.x0, FLOOR, otr.z0, otr.x1, FLOOR + 1.2, otr.z1, false, 'rail');
      for (const u of [-HL - 0.12, HL]) { const e = rect(u, inner, u + 0.12, outer); g.col.add(e.x0, FLOOR, e.z0, e.x1, FLOOR + 1.2, e.z1, false, 'rail'); }
      b.box(otr.x0, FLOOR + 1, otr.z0, otr.x1, FLOOR + 1.08, otr.z1, { color: '#3a3c40' });
      // canopy, its posts, the lights, benches
      const roof = rect(-HL + 2, inner + 0.5, HL - 2, outer + 0.2);
      b.box(roof.x0, FLOOR + 3.3, roof.z0, roof.x1, FLOOR + 3.5, roof.z1, { color: '#2f5a8a', shadeSides: true });
      for (let u = -HL + 4; u < HL - 3; u += 10) {
        const c = rect(u - 0.1, outer - 0.2, u + 0.1, outer);
        b.box(c.x0, FLOOR, c.z0, c.x1, FLOOR + 3.3, c.z1, { color: '#3a3c40' });
        const lamp = rect(u - 1, outer - 2.5, u + 1, outer - 2.3);
        signs.glow.box(lamp.x0, FLOOR + 3.22, lamp.z0, lamp.x1, FLOOR + 3.3, lamp.z1, { color: '#ffe8b8' });
        const bench = rect(u + 2, outer - 0.9, u + 4.2, outer - 0.3);
        b.box(bench.x0, FLOOR, bench.z0, bench.x1, FLOOR + 0.48, bench.z1, { color: '#6b4a30', shadeSides: true });
        g.col.add(bench.x0, FLOOR, bench.z0, bench.x1, FLOOR + 0.48, bench.z1, false, 'prop');
      }
      const facing = heading + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
      const sn = rect(-3, outer - 0.25, 3, outer - 0.2);
      signs.sign(name.toUpperCase(), (sn.x0 + sn.x1) / 2, FLOOR + 2.6, (sn.z0 + sn.z1) / 2, facing + Math.PI, 5, 0.7, '#2f5a8a', '#ffffff');
      // the stair tower on the pavement, a footbridge to the platform, the kiosk at its foot
      const su = 16, sv = 9.2;
      const tw = rect(su - 1.1, sv - 1.3, su + 1.1, sv + 1.3);
      b.box(tw.x0, CURB_H, tw.z0, tw.x1, FLOOR + 3, tw.z1, { color: '#4a5b64', shadeSides: true });
      for (let y = 1; y < FLOOR; y += 2.2) b.box(tw.x0 - 0.02, y, tw.z0 - 0.02, tw.x1 + 0.02, y + 0.15, tw.z1 + 0.02, { color: '#2f5a8a' });
      g.col.add(tw.x0, 0, tw.z0, tw.x1, FLOOR + 3, tw.z1, true, 'building');
      const br = rect(su - 1, outer, su + 1, sv - 1.3);
      b.box(br.x0, FLOOR - 0.3, br.z0, br.x1, FLOOR, br.z1, { color: '#6e6b65', shadeSides: true });
      b.box(br.x0, FLOOR + 2.4, br.z0, br.x1, FLOOR + 2.6, br.z1, { color: '#2f5a8a' });
      const kx = x + tx * (su - 3) + nx * 9, kz = z + tz * (su - 3) + nz * 9;
      b.box(kx - 1.3, CURB_H, kz - 1.3, kx + 1.3, CURB_H + 0.02, kz + 1.3, { color: '#2a2a2a' });
      for (const sv2 of [-1, 1]) {
        const g0 = alongX ? [kx - 1.3, kz + sv2 * 1.1, kx + 1.3, kz + sv2 * 1.2] : [kx + sv2 * 1.1, kz - 1.3, kx + sv2 * 1.2, kz + 1.3];
        b.box(g0[0], CURB_H, g0[1], g0[2], CURB_H + 1, g0[3], { color: '#4a5b39' });
      }
      const fx = x + tx * (su - 5.5) + nx * 9, fz = z + tz * (su - 5.5) + nz * 9;
      b.cbox(fx, CURB_H + 1.8, fz, 0.12, 3.6, 0.12, { color: '#3a3c40' });
      b.cbox(fx, CURB_H + 3.7, fz, 0.7, 0.7, 0.12, { color: '#2f5a8a' });
      g.col.addCentered(fx, fz, 0.2, 0.2, 3.6, 0, false, 'pole');
      signs.sign('M', fx, CURB_H + 3.7, fz + 0.07, 0, 0.6, 0.6, '#2f5a8a', '#ffffff');

      const entrance = new THREE.Vector3(kx, CURB_H, kz);
      const pu = su, pv = outer - 0.9;
      const top = new THREE.Vector3(x + tx * pu + nx * pv, FLOOR, z + tz * pu + nz * pv);
      const st: Station = { name, entrance, platform: top, heading, s: (s0 + (CARS * (CAR_LEN + CAR_GAP) - CAR_GAP) / 2) % this.len, side, gateT: 0, cx: x, cz: z, tx, tz, nx, nz };
      this.stations.push(st);
      g.interactables.push(
        {
          pos: entrance, radius: 2.4,
          get label() { return st.gateT > 0 ? `Metro: through the open gate` : `Metro: $${FARE} to the platform (${name})`; },
          enabled: () => !g.player.vehicle,
          action: () => {
            if (st.gateT <= 0) {
              if (g.save.data.cash < FARE) { g.hud.toast(`NEED $${FARE}, OR HACK THE GATE`, 'dim'); g.audio.deny(); return; }
              g.save.data.cash -= FARE;
              g.audio.cash();
            }
            // a few steps along from the stairs, so the first thing to do here is get on
            g.fadeTeleport(top.x - tx * 6, FLOOR, top.z - tz * 6, heading, `${name.toUpperCase()} STATION`);
          },
        },
        { pos: top, radius: 1.8, label: 'Stairs to the street', enabled: () => !g.player.vehicle && Math.abs(g.player.pos.y - FLOOR) < 1.5, action: () => g.fadeTeleport(kx, CURB_H, kz, heading + Math.PI, 'STREET LEVEL') },
        {
          pos: new THREE.Vector3(x + nx * 4, FLOOR, z + nz * 4), radius: HL + 2,
          get label() { const t = g.metro.trainAt(st); return t ? `Board: next stop ${g.metro.stations[t.next].name}` : 'Waiting for a train'; },
          enabled: () => !g.player.vehicle && Math.abs(g.player.pos.y - FLOOR) < 1.5 && !!g.metro.trainAt(st),
          action: () => g.metro.board(st),
        },
      );
      g.hack.hackables.push({
        kind: 'subway', label: 'Metro gate', pos: entrance.clone().setY(1), size: new THREE.Vector3(3, 1.4, 3), range: 18,
        available: () => st.gateT <= 0,
        act: () => { st.gateT = GATE_TIME; return `GATE OPEN — ${GATE_TIME}s`; },
      });
    }
    const m = new THREE.Mesh(b.build(), worldMaterials().props);
    m.castShadow = true;
    m.receiveShadow = true;
    g.scene.add(m);
    signs.finish(g.scene);
  }

  private buildCars() {
    const g = this.g;
    const L = CAR_LEN / 2, W = CAR_WID / 2;
    const b = new GeoBuilder();
    b.box(-W, 0.25, -L, W, 3.2, L, { color: '#c8c3b5', shadeSides: true });
    b.box(-W - 0.01, 0.8, -L, W + 0.01, 1.05, L, { color: '#2f5a8a' });
    b.box(-W + 0.15, 3.2, -L + 0.3, W - 0.15, 3.45, L - 0.3, { color: '#8a8a84', shadeSides: true });
    b.box(-W, 0, -L + 0.8, W, 0.25, -L + 3, { color: '#1e1e20' });
    b.box(-W, 0, L - 3, W, 0.25, L - 0.8, { color: '#1e1e20' });
    this.bodies = new THREE.InstancedMesh(b.build(), worldMaterials().props, COUNT);
    this.bodies.castShadow = true;
    this.bodies.frustumCulled = false;
    g.scene.add(this.bodies);
    // windows, lit
    const w = new GeoBuilder();
    for (const [a, c] of [[-5.6, -4.8], [-3.2, -0.8], [0.8, 3.2], [4.8, 5.6]]) for (const x of [-W - 0.02, W]) w.box(x, 1.5, a, x + 0.02, 2.5, c, { color: '#e8d8a8' });
    w.box(-W + 0.3, 1.6, L, W - 0.3, 2.5, L + 0.02, { color: '#fff1c0' });
    this.lights = new THREE.InstancedMesh(w.build(), basicMat({ vertexColors: true }), COUNT);
    this.lights.frustumCulled = false;
    g.scene.add(this.lights);
    // door leaves
    const d = new GeoBuilder();
    d.box(-0.03, 0.3, -0.48, 0.03, 2.75, 0.48, { color: '#2f5a8a', shadeSides: true });
    d.box(-0.04, 1.5, -0.32, 0.04, 2.45, 0.32, { color: '#3a4a58' });
    this.leaves = new THREE.InstancedMesh(d.build(), worldMaterials().props, COUNT * 12);
    this.leaves.frustumCulled = false;
    g.scene.add(this.leaves);
  }

  private buildInterior() {
    const g = this.g;
    const L = CAR_LEN / 2 - 0.05, W = CAR_WID / 2 - 0.08, H = 2.7;
    const b = new GeoBuilder();
    const wall = '#c8c3b5', dark = '#3a4048', seat = '#2f5a8a';
    b.box(-W, 0.25, -L, W, 0.3, L, { color: '#6a6660' });
    b.box(-W, 0.3 + H, -L, W, 0.35 + H, L, { color: '#d8d4c8' });
    // walls: below the windows, above them, and between the doors. Window strips are real gaps
    for (const x of [-W - 0.04, W]) {
      b.box(x, 0.3, -L, x + 0.04, 1.45, L, { color: wall });
      b.box(x, 2.55, -L, x + 0.04, 0.3 + H, L, { color: wall });
      for (const [a, c] of [[-L, -5.6], [-4.8, -4.8 + 0.3], [-3.5, -3.2], [-0.8, -0.5], [0.5, 0.8], [3.2, 3.5], [4.5, 4.8], [5.6, L]]) b.box(x, 1.45, a, x + 0.04, 2.55, c, { color: wall });
    }
    for (const z of [-L - 0.04, L]) b.box(-W, 0.3, z, W, 0.3 + H, z + 0.04, { color: dark });
    // long benches between the doors, poles down the middle, adverts
    for (const [a, c] of [[-3.2, -0.8], [0.8, 3.2]]) for (const x of [-W, W - 0.55]) {
      b.box(x, 0.3, a, x + 0.55, 0.75, c, { color: seat });
    }
    for (const z of [-5, -2, 2, 5]) b.cbox(0, 1.6, z, 0.06, 2.6, 0.06, { color: '#c4a03c' });
    for (const [z, c] of [[-2, '#c9552a'], [2, '#3f7b88']] as [number, string][]) for (const x of [-W - 0.04, W - 0.02]) b.box(x, 2.56, z - 0.9, x + 0.06, 2.92, z + 0.9, { color: c });
    makeBake([
      { x: 0, y: 2.8, z: -3, c: [1, 0.95, 0.8], reach: 7, rect: [-5, -8, 5, 8] },
      { x: 0, y: 2.8, z: 3, c: [1, 0.95, 0.8], reach: 7, rect: [-5, -8, 5, 8] },
    ])(b);
    const mat = homeMaterial();
    this.inside = new THREE.Group();
    this.inside.add(new THREE.Mesh(b.build(), mat));
    const strip = new GeoBuilder();
    strip.box(-0.15, 0.3 + H - 0.02, -L + 0.5, 0.15, 0.3 + H, L - 0.5, { color: '#fff8e0' });
    this.inside.add(new THREE.Mesh(strip.build(), basicMat({ vertexColors: true })));
    const leaf = (sign: number) => {
      const d = new GeoBuilder();
      for (const z of DOOR_Z) for (const x of [-W - 0.06, W + 0.02]) {
        d.box(x, 0.3, z + sign * 0.02, x + 0.04, 2.75, z + sign * 0.92, { color: '#2f5a8a' });
      }
      makeBake([{ x: 0, y: 2.8, z: 0, c: [1, 0.95, 0.8], reach: 9, rect: [-5, -8, 5, 8] }])(d);
      return new THREE.Mesh(d.build(), mat);
    };
    this.insideLeft = leaf(-1);
    this.insideRight = leaf(1);
    this.inside.add(this.insideLeft, this.insideRight);
    this.inside.visible = false;
    g.scene.add(this.inside);
  }

  // ------------------------------------------------------------------ running
  reset() {
    const n = this.stations.length;
    this.trains = [];
    for (let i = 0; i < TRAINS; i++) {
      const k = Math.floor((i * n) / TRAINS);
      const st = this.stations[k];
      const t: Train = { s: st.s, v: 0, next: (k + 1) % n, dwell: DWELL * (0.3 + i * 0.25), stopT: 0, doors: 0, pos: new THREE.Vector3(), arrived: true };
      this.trains.push(t);
      if (!this.hacked[i]) {
        this.hacked[i] = true;
        this.g.hack.hackables.push({
          kind: 'train', label: 'Metro train', pos: t.pos, size: new THREE.Vector3(5, 3.4, 5), range: 110,
          available: () => this.trains[i].stopT <= 0,
          act: () => { const tr = this.trains[i]; tr.stopT = STOP_TIME; return tr.dwell > 0 ? 'DOORS HELD — TRAIN WAITING' : 'EMERGENCY BRAKE — TRAIN STOPPED'; },
        });
      } else {
        const h = this.g.hack.hackables.filter((x) => x.kind === 'train')[i];
        if (h) h.pos = t.pos;
      }
    }
    for (const s of this.stations) s.gateT = 0;
    if (this.riding) this.endRide();
    this.copClose = false;
  }
  private hacked: boolean[] = [];

  /** the train standing at this platform with its doors open, if there is one */
  trainAt(st: Station) {
    const i = this.stations.indexOf(st);
    return this.trains.find((t) => t.dwell > 0 && t.doors > 0.9 && t.next === (i + 1) % this.stations.length && t.arrived) ?? null;
  }

  private place(s: number, i: number) {
    // a car's heading comes from its two bogies, so it takes corners properly
    const c = s - CAR_LEN / 2 - i * (CAR_LEN + CAR_GAP);
    const a = this.at(c + 4.5), b = this.at(c - 4.5);
    return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, heading: Math.atan2(a.x - b.x, a.z - b.z) };
  }

  update(dt: number) {
    const g = this.g;
    for (const st of this.stations) if (st.gateT > 0) st.gateT -= dt;
    const P = g.player.worldPos;
    for (const t of this.trains) this.run(t, dt, P);
    // instances
    let leaf = 0;
    const yFloor = METRO_RAIL;
    for (let ti = 0; ti < TRAINS; ti++) {
      const t = this.trains[ti];
      for (let c = 0; c < CARS; c++) {
        const p = this.place(t.s, c);
        this.q.setFromAxisAngle(this.up, p.heading);
        const hide = this.riding && this.riding.train === t && this.riding.car === c;
        this.m.compose(this.v.set(p.x, yFloor, p.z), this.q, hide ? this.zero : this.one);
        const k = ti * CARS + c;
        this.bodies.setMatrixAt(k, this.m);
        this.lights.setMatrixAt(k, this.m);
        if (c === 0) { t.pos.set(p.x, yFloor + 2, p.z); }
        const fx = Math.sin(p.heading), fz = Math.cos(p.heading), rx = Math.cos(p.heading), rz = -Math.sin(p.heading);
        const open = t.doors * 0.95;
        for (const dz of DOOR_Z) for (const side of [-1, 1]) for (const dir of [-1, 1]) {
          const lz = dz + dir * (0.48 + open), lx = side * (CAR_WID / 2 + 0.02);
          this.m.compose(this.v.set(p.x + fx * lz + rx * lx, yFloor, p.z + fz * lz + rz * lx), this.q, hide ? this.zero : this.one);
          this.leaves.setMatrixAt(leaf++, this.m);
        }
      }
    }
    this.bodies.instanceMatrix.needsUpdate = true;
    this.lights.instanceMatrix.needsUpdate = true;
    this.leaves.instanceMatrix.needsUpdate = true;
    if (this.riding) this.updateRide(dt);
  }

  private run(t: Train, dt: number, P: THREE.Vector3) {
    const g = this.g;
    const open = t.dwell > 0.9 && t.dwell < DWELL - 0.6 && t.arrived;
    t.doors = clamp(t.doors + (open ? dt : -dt) * 1.6, 0, 1);
    if (t.stopT > 0) t.stopT -= dt;
    if (t.dwell > 0) {
      t.v = 0;
      if (t.stopT <= 0) t.dwell -= dt;
      if (t.dwell <= 0) {
        t.dwell = 0;
        t.arrived = false;
        if (this.riding?.train === t) g.hud.toast(`NEXT: ${this.stations[t.next].name.toUpperCase()}`, 'hack');
      }
      return;
    }
    if (t.stopT > 0) { t.v = Math.max(0, t.v - 7 * dt); t.s += t.v * dt; return; }
    const st = this.stations[t.next];
    const dist = this.ahead(t.s, st.s);
    let want = Math.min(this.limit[Math.floor(((t.s % this.len) + this.len) % this.len)], Math.sqrt(2 * ACCEL * Math.max(0, dist)) + 0.35);
    // keep clear of a train stopped ahead
    for (const o of this.trains) {
      if (o === t) continue;
      const gap = this.ahead(t.s, o.s) - CARS * (CAR_LEN + CAR_GAP);
      if (gap > 0 && gap < 90) want = Math.min(want, Math.sqrt(2 * ACCEL * Math.max(0, gap - 20)));
    }
    t.v = want > t.v ? Math.min(want, t.v + ACCEL * dt) : Math.max(want, t.v - ACCEL * 2 * dt);
    t.s += t.v * dt;
    if (dist < 0.5 && t.v < 1.5) {
      t.s = st.s;
      t.v = 0;
      t.dwell = DWELL;
      t.arrived = true;
      t.next = (t.next + 1) % this.stations.length;
      if (Math.hypot(t.pos.x - P.x, t.pos.z - P.z) < 70) g.audio.train(t.pos);
    }
  }

  // ------------------------------------------------------------------ riding
  board(st: Station) {
    const g = this.g, t = this.trainAt(st);
    if (!t) return;
    const P = g.player.pos;
    let car = 0, bd = Infinity;
    for (let c = 0; c < CARS; c++) { const p = this.place(t.s, c); const d = Math.hypot(p.x - P.x, p.z - P.z); if (d < bd) { bd = d; car = c; } }
    this.riding = { train: t, car };
    g.player.aboard = true;
    g.player.hidden = true;
    this.lookYaw = 0;
    this.lookPitch = -0.05;
    this.inside.visible = true;
    g.audio.door();
    g.save.escape('subway');
    this.fillCarriage();
    // who saw you get on?
    const pol = g.police;
    if (pol.heat > 0) {
      const seen = pol.lastSeenT < 2;
      const near = pol.officers.some((o) => Math.hypot(o.pos.x - P.x, o.pos.z - P.z) < 45);
      if (seen && near && pol.heat >= 2 && this.rng.next() < 0.55) {
        this.cop = new RigCharacter(COP_SKIN);
        this.copZ = -CAR_LEN / 2 + 1;
        this.inside.add(this.cop.root);
        g.hud.hint('A cop got on your train. Get off before they reach you.');
        g.audio.alarmBell(1);
      } else {
        pol.lastSeenT = Math.max(pol.lastSeenT, 12);
        pol.lastKnown.copy(st.entrance);
        pol.progress = Math.max(0, pol.progress - 0.5);
        g.hud.hint('They saw nothing. The search stays at the station you left.');
      }
    }
  }

  private fillCarriage() {
    const g = this.g;
    if (!this.passengers.length) for (let i = 0; i < 3; i++) this.passengers.push(new RigCharacter(makePedSkin(i % 2 ? 'office' : 'local', this.rng)));
    const seats: [number, number, number][] = [[-CAR_WID / 2 + 0.38, 1.4, Math.PI / 2], [CAR_WID / 2 - 0.38, 1.6, -Math.PI / 2], [-CAR_WID / 2 + 0.38, 2.8, Math.PI / 2]];
    this.passengers.forEach((r, i) => {
      r.root.position.set(seats[i][0], 0.3, seats[i][1]);
      r.root.rotation.y = seats[i][2];
      if (!r.root.parent) this.inside.add(r.root);
      r.update(0.016, 'sit', 0);
    });
    void g;
  }

  private updateRide(dt: number) {
    const g = this.g, rd = this.riding!, t = rd.train;
    // something else put you somewhere (a bust, a restart): just tidy up
    if (!g.player.aboard) { this.endRide(); return; }
    const p = this.place(t.s, rd.car);
    this.inside.position.set(p.x, METRO_RAIL, p.z);
    this.inside.rotation.y = p.heading;
    const open = t.doors * 0.95;
    this.insideLeft.position.z = -open;
    this.insideRight.position.z = open;
    if (this.inside.children.length) for (const r of this.passengers) r.update(dt, 'sit', 0);
    // you, by a pole
    const fx = Math.sin(p.heading), fz = Math.cos(p.heading), rx = Math.cos(p.heading), rz = -Math.sin(p.heading);
    const lx = 0.45, lz = 0.2;
    g.player.pos.set(p.x + fx * lz + rx * lx, METRO_RAIL + 0.3, p.z + fz * lz + rz * lx);
    g.player.heading = p.heading;
    // the cop walks down the carriage
    this.copClose = false;
    if (this.cop) {
      this.copZ = Math.min(lz - 0.7, this.copZ + dt * 0.9);
      this.cop.root.position.set(0.2, 0.3, this.copZ);
      this.cop.update(dt, lz - this.copZ > 0.75 ? 'walk' : 'idle', 0.9);
      if (lz - this.copZ < 1.5) this.copClose = true;
    }
    g.player.focusLabel = t.doors > 0.9 && t.arrived && t.dwell > 0 ? `Get off at ${this.stations[(t.next - 1 + this.stations.length) % this.stations.length].name}` : `Next stop: ${this.stations[t.next].name}`;
    // no cop on board: they're losing you all the time you ride
    if (!this.cop && g.police.heat > 0) g.police.lastSeenT = Math.max(g.police.lastSeenT, 6);
  }

  /** true while the player may step off here */
  get canGetOff() {
    const t = this.riding?.train;
    return !!t && t.doors > 0.9 && t.arrived && t.dwell > 0;
  }

  getOff() {
    if (!this.riding || !this.canGetOff) { this.g.audio.deny(); return; }
    const g = this.g, { train, car } = this.riding;
    const st = this.stations[(train.next - 1 + this.stations.length) % this.stations.length];
    const p = this.place(train.s, car);
    // onto the platform opposite your door
    const along = clamp((p.x - st.cx) * st.tx + (p.z - st.cz) * st.tz, -24, 24);
    this.endRide();
    g.player.aboard = false;
    g.player.hidden = false;
    g.player.vx = g.player.vz = 0;
    g.player.pos.set(st.cx + st.tx * along + st.nx * 3.4, FLOOR, st.cz + st.tz * along + st.nz * 3.4);
    g.camRig.snapBehind(g.player.heading);
    g.audio.door();
    if (g.police.heat > 0) g.hud.hint('Off the train. Stairs to the street are along the platform.');
  }

  private endRide() {
    this.riding = null;
    this.inside.visible = false;
    this.copClose = false;
    if (this.cop) { this.inside.remove(this.cop.root); this.cop = null; }
  }

  /** runs after the normal camera: you're looking down the carriage */
  camera() {
    if (!this.riding) return;
    const g = this.g, inp = g.input;
    this.lookYaw = clamp(this.lookYaw - inp.lookX * 0.0028, -2.4, 2.4);
    this.lookPitch = clamp(this.lookPitch - inp.lookY * 0.0028, -0.6, 0.5);
    const i = this.inside;
    const h = i.rotation.y;
    const fx = Math.sin(h), fz = Math.cos(h);
    const c = g.camera;
    c.position.set(i.position.x - fx * 3.4, i.position.y + 1.9, i.position.z - fz * 3.4);
    const a = h + this.lookYaw;
    c.lookAt(c.position.x + Math.sin(a) * Math.cos(this.lookPitch), c.position.y + Math.sin(this.lookPitch), c.position.z + Math.cos(a) * Math.cos(this.lookPitch));
  }
}
