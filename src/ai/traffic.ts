// Civilian traffic: right-hand lanes on the road graph, signals, lane changes,
// jams + honking, panic swerves, pulling over for sirens, emergency runs and
// city buses that stop at bus stops. Same physics as the player.
import * as THREE from 'three';
import { PAL } from '../core/palette';
import { Rng, clamp, wrapAngle } from '../core/math';
import { LANE, PITCH, ROAD_HALF, lanePoint, HALF, RING } from '../world/layout';
import { DISTRICTS, District, districtAt } from '../map/districts';

export { districtAt };
export type { District };
import { Vehicle } from '../vehicles/vehicle';
import type { CarKind } from '../vehicles/carMesh';
import type { Game } from '../core/game';

interface Pt { x: number; z: number; }
export interface DriveAI {
  a: number;
  b: number;
  c: number;
  phase: 'edge' | 'turn';
  pts: Pt[];
  idx: number;
  cruise: number;
  crashedT: number;
  stuckT: number;
  honkT: number;
  blockedT: number;
  lane: number; // lane offset from road centre
  laneCD: number;
  route?: number[]; // bus loop
  routeI?: number;
  stopT: number;
  stopCD: number;
  emergency: boolean;
  panicT: number;
}

const T0 = (ROAD_HALF + 2.5) / PITCH;
const T1 = 1 - (ROAD_HALF + 3.8) / PITCH;
const OUTER = 5.0;

/** Shared lane-following helpers (used by traffic + police path mode). */
export function edgePoints(g: Game, a: number, b: number, offset = LANE): Pt[] {
  const A = g.city.graph.nodes[a], B = g.city.graph.nodes[b];
  const pts: Pt[] = [];
  for (let i = 0; i <= 8; i++) pts.push(lanePoint(A.x, A.z, B.x, B.z, T0 + (T1 - T0) * (i / 8), offset));
  return pts;
}

export function turnPoints(g: Game, a: number, b: number, c: number, offset = LANE, offset2 = offset): Pt[] {
  const N = g.city.graph.nodes;
  const A = N[a], B = N[b], C = N[c];
  const p0 = lanePoint(A.x, A.z, B.x, B.z, T1, offset);
  const p2 = lanePoint(B.x, B.z, C.x, C.z, T0, offset2);
  const dAx = Math.sign(B.x - A.x);
  let p1: Pt;
  const straight = Math.sign(C.x - B.x) === dAx && Math.sign(C.z - B.z) === Math.sign(B.z - A.z);
  if (straight) p1 = { x: (p0.x + p2.x) / 2, z: (p0.z + p2.z) / 2 };
  else if (dAx !== 0) p1 = { x: p2.x, z: p0.z };
  else p1 = { x: p0.x, z: p2.z };
  const pts: Pt[] = [];
  for (let i = 1; i <= 6; i++) {
    const t = i / 6, u = 1 - t;
    pts.push({ x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, z: u * u * p0.z + 2 * u * t * p1.z + t * t * p2.z });
  }
  return pts;
}

export function pickNext(g: Game, a: number, b: number, rng: () => number): number {
  const n = g.city.graph.nodes[b];
  const opts = n.edges.filter((e) => !g.city.graph.edges[e].closed).map((e) => g.city.graph.other(g.city.graph.edges[e], b)).filter((x) => x !== a);
  if (!opts.length) return a;
  return opts[Math.floor(rng() * opts.length)];
}

/** Steering toward a point: returns steer in -1..1 (positive = right). */
export function steerTo(v: Vehicle, x: number, z: number, gain = 2.2) {
  const want = Math.atan2(x - v.pos.x, z - v.pos.z);
  const diff = wrapAngle(want - v.heading);
  return { steer: clamp(-diff * gain, -1, 1), diff };
}

export function pickKind(rng: Rng, d: District): CarKind {
  const w = DISTRICTS[d].traffic;
  let k = rng.next() * w.reduce((s, x) => s + x[1], 0);
  for (const [kind, wt] of w) { k -= wt; if (k <= 0) return kind; }
  return 'sedan';
}

export function colorFor(rng: Rng, kind: CarKind): string {
  switch (kind) {
    case 'taxi': return '#c4a03c';
    case 'bus': return '#3f7b88';
    case 'ambulance': return '#e6e4dc';
    case 'firetruck': return '#a8261e';
    case 'garbage': return '#e6e0d4';
    case 'boxtruck': return rng.pick(['#cfccc4', '#2f3b4d', '#9b3b2f']);
    case 'van': case 'foodtruck': return rng.pick(['#cfccc4', '#b9a98a', '#6e6a62', '#c96a3a']);
    case 'sports': return rng.pick(['#9b3b2f', '#c4a03c', '#1c1c1e', '#3f7b88', '#d8782a']);
    case 'muscle': return rng.pick(['#7a1c1c', '#2f3b4d', '#1c1c1e', '#5b6433']);
    case 'bicycle': case 'scooter': case 'motorbike': return rng.pick(['#9b3b2f', '#2f3b4d', '#c4a03c', '#1c1c1e', '#3f7b88', '#cfccc4']);
    default: return rng.pick(PAL.carColors);
  }
}

// Bus loops (node ids are resolved at reset): ring roads around downtown
const BUS_LOOPS: [number, number][][] = [
  [[4, 4], [8, 4], [8, 8], [4, 8]],
  [[5, 5], [5, 7], [7, 7], [7, 5]],
  [[1, 1], [5, 1], [5, 5], [1, 5]],
  [[1, 7], [5, 7], [5, 10], [1, 10]],
];

export class Traffic {
  cars: Vehicle[] = [];
  private rng = new Rng(99);
  private emergencyT = 25;
  private busT = 0;

  constructor(private g: Game) {}

  get target() {
    return Math.round(this.g.quality.p.traffic * (this.g.world.rushHour ? 1.3 : 1));
  }

  reset() {
    for (const v of this.cars) this.g.removeVehicle(v);
    this.cars = [];
    for (let i = 0; i < this.target; i++) this.spawn(true);
    // buses on their loops
    this.busT = 0;
    this.emergencyT = 20;
  }

  private makeAI(cruise: number): DriveAI {
    return { a: 0, b: 0, c: 0, phase: 'edge', pts: [], idx: 0, cruise, crashedT: 0, stuckT: 0, honkT: 0, blockedT: 0, lane: LANE, laneCD: 0, stopT: 0, stopCD: 0, emergency: false, panicT: 0 };
  }

  private spawn(anywhere: boolean, forced?: CarKind): Vehicle | null {
    const g = this.g;
    const r = this.rng;
    // pick location first so the district decides the vehicle
    const loc = this.findSpot(anywhere);
    if (!loc) return null;
    let kind = forced ?? pickKind(r, districtAt(loc.x, loc.z));
    if (!forced && this.g.world.rushHour && r.chance(0.3)) kind = 'sedan';
    const v = new Vehicle(kind, colorFor(r, kind), g.col);
    v.driver = 'traffic';
    const two = v.two;
    v.ai = this.makeAI(kind === 'bicycle' ? r.range(5, 7) : two ? r.range(10, 14) : v.p.mass > 2 ? r.range(8, 10) : r.range(9.5, 13));
    this.apply(v, loc);
    g.addVehicle(v);
    this.cars.push(v);
    return v;
  }

  private findSpot(anywhere: boolean) {
    const g = this.g;
    const P = g.player.worldPos;
    const edges = g.chunks.nearEdges.length ? g.chunks.nearEdges : g.city.graph.edges;
    for (let tries = 0; tries < 30; tries++) {
      const e = this.rng.pick(edges);
      if (e.closed) continue;
      const flip = this.rng.chance(0.5);
      const a = flip ? e.b : e.a, b = flip ? e.a : e.b;
      const pts = edgePoints(g, a, b);
      const k = this.rng.int(1, 6);
      const p = pts[k];
      const d = Math.hypot(p.x - P.x, p.z - P.z);
      if (!anywhere && (d < 75 || d > 170)) continue;
      if (anywhere && d < 25) continue;
      if (!anywhere && g.isVisible(p.x, 1, p.z) && d < 140) continue;
      if (g.vehicles.some((o) => Math.hypot(o.pos.x - p.x, o.pos.z - p.z) < 10)) continue;
      return { a, b, pts, k, x: p.x, z: p.z };
    }
    return null;
  }

  private apply(v: Vehicle, loc: { a: number; b: number; pts: Pt[]; k: number }) {
    const ai = v.ai as DriveAI;
    ai.a = loc.a; ai.b = loc.b; ai.c = ai.route ? this.nextOnRoute(ai) : pickNext(this.g, loc.a, loc.b, () => this.rng.next());
    ai.phase = 'edge'; ai.pts = loc.pts; ai.idx = loc.k + 1; ai.crashedT = 0; ai.stuckT = 0; ai.lane = LANE;
    const p = loc.pts[loc.k], n = loc.pts[loc.k + 1];
    v.place(p.x, p.z, Math.atan2(n.x - p.x, n.z - p.z));
    v.hp = 100; v.wrecked = false;
    v.vx = Math.sin(v.heading) * ai.cruise * 0.8;
    v.vz = Math.cos(v.heading) * ai.cruise * 0.8;
  }

  private spawnBus(loop: [number, number][]) {
    const g = this.g;
    const route = loop.flatMap(([i, j], idx) => {
      // expand corners into the full node path between them
      const [ni, nj] = loop[(idx + 1) % loop.length];
      return g.city.graph.path(g.city.graph.node(i, j).id, g.city.graph.node(ni, nj).id).slice(0, -1);
    });
    // join the loop at a stop that's near the player but out of sight
    const P = g.player.worldPos;
    const N = g.city.graph.nodes;
    const idx = route.findIndex((n, i) => {
      const nb = N[route[(i + 1) % route.length]];
      const d = Math.hypot(N[n].x - P.x, N[n].z - P.z);
      return d > 70 && d < 170 && !g.isVisible(N[n].x, 2, N[n].z) && g.city.graph.edgeBetween(n, nb.id) !== undefined;
    });
    if (idx < 0) return;
    const v = new Vehicle('bus', '#3f7b88', g.col);
    v.driver = 'traffic';
    const ai = this.makeAI(8.5);
    ai.route = route;
    ai.routeI = (idx + 1) % route.length;
    v.ai = ai;
    const a = route[idx], b = route[ai.routeI];
    const pts = edgePoints(g, a, b);
    if (g.vehicles.some((o) => Math.hypot(o.pos.x - pts[3].x, o.pos.z - pts[3].z) < 12)) return;
    this.apply(v, { a, b, pts, k: 2 });
    g.addVehicle(v);
    this.cars.push(v);
  }

  private nextOnRoute(ai: DriveAI) {
    const r = ai.route!;
    ai.routeI = (ai.routeI! + 1) % r.length;
    return r[ai.routeI];
  }

  /** an ambulance or fire truck tearing through town with sirens on */
  private spawnEmergency() {
    const kind: CarKind = this.rng.chance(0.55) ? 'ambulance' : 'firetruck';
    const v = this.spawn(false, kind);
    if (!v) return;
    const ai = v.ai as DriveAI;
    ai.emergency = true;
    ai.cruise = kind === 'ambulance' ? 17 : 14;
    v.siren = true;
  }

  update(dt: number) {
    const g = this.g;
    const P = g.player.worldPos;
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const v = this.cars[i];
      if (v.driver !== 'traffic') { this.cars.splice(i, 1); continue; } // carjacked
      const d = Math.hypot(v.pos.x - P.x, v.pos.z - P.z);
      const ai = v.ai as DriveAI;
      const out = Math.abs(v.pos.x) > HALF + 12 || Math.abs(v.pos.z) > HALF + 12;
      if (d > 185 || (ai.crashedT > 10 && d > 60 && !g.isVisible(v.pos.x, 1, v.pos.z)) || out) {
        if (ai.route || ai.emergency || this.cars.length > this.target + 2) {
          if (!g.isVisible(v.pos.x, 1, v.pos.z) || d > 200) { g.removeVehicle(v); this.cars.splice(i, 1); continue; }
        } else {
          const loc = this.findSpot(false);
          if (loc) this.apply(v, loc);
        }
      }
      if (!ai.route && !ai.emergency && this.cars.length > this.target + 4 && d > 50 && !g.isVisible(v.pos.x, 1, v.pos.z)) { g.removeVehicle(v); this.cars.splice(i, 1); continue; }
      this.drive(v, dt);
    }
    const civ = this.cars.filter((v) => !(v.ai as DriveAI).route && !(v.ai as DriveAI).emergency).length;
    if (civ < this.target) this.spawn(false);
    this.busT -= dt;
    if (this.busT <= 0) {
      this.busT = 3;
      if (this.cars.filter((v) => (v.ai as DriveAI).route).length < 2) this.spawnBus(this.rng.pick(BUS_LOOPS));
    }
    this.emergencyT -= dt;
    if (this.emergencyT <= 0) {
      this.emergencyT = this.rng.range(35, 60);
      if (!this.cars.some((v) => (v.ai as DriveAI).emergency)) this.spawnEmergency();
    }
  }

  private advance(v: Vehicle, ai: DriveAI) {
    const g = this.g;
    while (ai.idx < ai.pts.length && Math.hypot(ai.pts[ai.idx].x - v.pos.x, ai.pts[ai.idx].z - v.pos.z) < (v.two ? 3 : 4.5)) ai.idx++;
    if (ai.idx >= ai.pts.length) {
      if (ai.phase === 'edge') {
        ai.phase = 'turn';
        ai.pts = turnPoints(g, ai.a, ai.b, ai.c, ai.lane, LANE);
        ai.lane = LANE;
      } else {
        ai.phase = 'edge';
        ai.a = ai.b; ai.b = ai.c;
        ai.c = ai.route ? this.nextOnRoute(ai) : pickNext(g, ai.a, ai.b, () => this.rng.next());
        ai.pts = edgePoints(g, ai.a, ai.b, ai.lane);
      }
      ai.idx = 0;
    }
  }

  private drive(v: Vehicle, dt: number) {
    const g = this.g;
    const ai = v.ai as DriveAI;
    if (v.wrecked) { v.throttle = 0; v.handbrake = true; ai.crashedT += dt; v.siren = false; return; }
    if (v.lastImpact > 6.5) { ai.crashedT = Math.max(ai.crashedT, 0.01); v.lastImpact = 0; if (this.rng.chance(0.5)) g.audio.horn(v.pos); }
    if (ai.crashedT > 0) {
      ai.crashedT += dt;
      v.throttle = 0; v.steer = 0; v.handbrake = ai.crashedT < 4;
      if (ai.crashedT > 5) {
        const p = ai.pts[Math.min(ai.idx, ai.pts.length - 1)];
        if (Math.hypot(p.x - v.pos.x, p.z - v.pos.z) < 9) ai.crashedT = 0;
      }
      return;
    }
    v.handbrake = false;
    ai.laneCD -= dt;
    ai.stopCD -= dt;
    this.advance(v, ai);
    const tp = ai.pts[Math.min(ai.idx, ai.pts.length - 1)];
    let { steer, diff } = steerTo(v, tp.x, tp.z);
    // the ring is a highway: everyone but cyclists opens up
    const onRing = ai.phase === 'edge' && g.city.graph.edgeBetween(ai.a, ai.b)?.name === RING;
    const cruise = onRing && v.p.maxSpeed > 12 ? Math.min(v.p.maxSpeed * 0.85, ai.cruise * 2) : ai.cruise;
    let want = ai.phase === 'turn' && Math.abs(diff) > 0.25 ? Math.min(ai.cruise, 6.5) : cruise;
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);

    // signals (emergency vehicles run them)
    if (ai.phase === 'edge' && !ai.emergency) {
      const B = g.city.graph.nodes[ai.b];
      const e = g.city.graph.edgeBetween(ai.a, ai.b)!;
      if (B.hasLight) {
        const light = g.signals.state(ai.b, e.axis);
        const stop = ai.pts[ai.pts.length - 1];
        const ds = Math.hypot(stop.x - v.pos.x, stop.z - v.pos.z);
        const override = g.signals.nodes[ai.b].override;
        if (override === 'green') want = ai.cruise * 1.35; // chaos: everyone floors it
        else if ((light === 'red' || (light === 'yellow' && ds > 10)) && ds < 26) want = Math.min(want, Math.max(0, (ds - 1.5) * 0.7));
      }
    }
    // bus stops
    if (ai.route && ai.phase === 'edge') {
      if (ai.stopT > 0) { ai.stopT -= dt; want = 0; if (ai.stopT <= 0) ai.stopCD = 8; }
      else if (ai.stopCD <= 0) for (const s of g.street.busStops) {
        const dx = s.x - v.pos.x, dz = s.z - v.pos.z;
        const along = dx * fx + dz * fz;
        if (along > 0 && along < 12 && Math.abs(dx * fz - dz * fx) < 9) { want = Math.min(want, Math.max(0, (along - 1) * 0.8)); if (along < 2.5) ai.stopT = 4; }
      }
    }
    // keep distance from whatever is ahead (in our lane)
    let blocker: Vehicle | null = null;
    for (const o of g.vehicles) {
      if (o === v) continue;
      const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z;
      const along = dx * fx + dz * fz;
      const reach = 16 + v.parts.dims.len * 0.5;
      if (along < 0 || along > reach) continue;
      const lat = Math.abs(dx * fz - dz * fx);
      if (lat > (v.two ? 1.2 : 2.0) + (o.two ? 0 : 0.2)) continue;
      const gap = v.parts.dims.len / 2 + o.parts.dims.len / 2 + 2.5;
      const w = Math.max(0, (along - gap) * 0.9);
      if (w < want) { want = w; blocker = o; }
    }
    // jams: honk, then try the other lane
    if (blocker && want < 1.5 && ai.phase === 'edge') {
      ai.blockedT += dt;
      ai.honkT -= dt;
      if (ai.blockedT > 3 && ai.honkT < 0 && Math.hypot(v.pos.x - g.player.worldPos.x, v.pos.z - g.player.worldPos.z) < 70) { g.audio.horn(v.pos); ai.honkT = this.rng.range(2.5, 6); }
      if (ai.blockedT > 1.2 && ai.laneCD <= 0 && ai.idx < ai.pts.length - 2) this.tryLaneChange(v, ai);
    } else ai.blockedT = Math.max(0, ai.blockedT - dt * 2);

    // sirens behind us: pull over to the curb and slow down
    if (!ai.emergency) {
      for (const o of g.vehicles) {
        if (!o.siren || o === v) continue;
        const dx = v.pos.x - o.pos.x, dz = v.pos.z - o.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 32) continue;
        const behind = (dx * fx + dz * fz) / (d || 1);
        if (behind > 0.4) {
          const rx = -fz, rz = fx; // right of travel
          // aim a few metres right of the lane point
          const s2 = steerTo(v, tp.x + rx * 2.6, tp.z + rz * 2.6);
          steer = s2.steer;
          want = Math.min(want, 3);
        }
      }
    }

    // panic: a fast car coming straight at us -> swerve and brake
    const pv = g.player.vehicle;
    if (pv && pv !== v) {
      const dx = pv.pos.x - v.pos.x, dz = pv.pos.z - v.pos.z;
      const d = Math.hypot(dx, dz);
      const closing = -((pv.vx - v.vx) * dx + (pv.vz - v.vz) * dz) / (d || 1);
      if (d < 18 && closing > 12 && (dx * fx + dz * fz) / (d || 1) > 0.7) ai.panicT = 1.2;
    }
    if (ai.panicT > 0) {
      ai.panicT -= dt;
      steer = clamp(steer + 0.8, -1, 1);
      want = Math.min(want, 2);
      ai.honkT -= dt;
      if (ai.honkT < 0) { g.audio.horn(v.pos); ai.honkT = 2; }
    }

    v.steer = steer;
    const err = want - v.speed;
    v.throttle = clamp(err * 0.45, -1, 1);
    if (want < 0.3 && v.speed < 0.6) v.throttle = 0;
    if (want > 3 && v.speed < 0.5) ai.stuckT += dt; else ai.stuckT = 0;
    if (ai.stuckT > 6) ai.crashedT = 0.01;
  }

  private tryLaneChange(v: Vehicle, ai: DriveAI) {
    const g = this.g;
    ai.laneCD = 3;
    const target = ai.lane === LANE ? OUTER : LANE;
    const pts = edgePoints(g, ai.a, ai.b, target);
    // is the target lane clear ~15 m around us?
    const p = pts[Math.min(ai.idx + 1, pts.length - 1)];
    for (const o of g.vehicles) {
      if (o === v) continue;
      if (Math.hypot(o.pos.x - p.x, o.pos.z - p.z) < 9) return;
    }
    ai.lane = target;
    ai.pts = pts;
    ai.blockedT = 0;
  }

  /** debug / clip helper */
  spawnKindNear(kind: CarKind) {
    return this.spawn(true, kind);
  }
}

export const _tmp = new THREE.Vector3();
