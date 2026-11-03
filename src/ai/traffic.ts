// Civilian traffic: follows right-hand lanes on the road graph, obeys signals,
// keeps distance, crashes for real (same physics as the player).
import * as THREE from 'three';
import { PAL } from '../core/palette';
import { Rng, clamp, wrapAngle } from '../core/math';
import { LANE, PITCH, ROAD_HALF, lanePoint, HALF } from '../world/layout';
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
}

const T0 = (ROAD_HALF + 2.5) / PITCH;
const T1 = 1 - (ROAD_HALF + 3.8) / PITCH;

/** Shared lane-following helpers (used by traffic + police path mode). */
export function edgePoints(g: Game, a: number, b: number, offset = LANE): Pt[] {
  const A = g.city.graph.nodes[a], B = g.city.graph.nodes[b];
  const pts: Pt[] = [];
  for (let i = 0; i <= 8; i++) pts.push(lanePoint(A.x, A.z, B.x, B.z, T0 + (T1 - T0) * (i / 8), offset));
  return pts;
}

export function turnPoints(g: Game, a: number, b: number, c: number, offset = LANE): Pt[] {
  const N = g.city.graph.nodes;
  const A = N[a], B = N[b], C = N[c];
  const p0 = lanePoint(A.x, A.z, B.x, B.z, T1, offset);
  const p2 = lanePoint(B.x, B.z, C.x, C.z, T0, offset);
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
  const opts = n.edges.map((e) => g.city.graph.other(g.city.graph.edges[e], b)).filter((x) => x !== a);
  if (!opts.length) return a;
  return opts[Math.floor(rng() * opts.length)];
}

/** Steering toward a point: returns steer in -1..1 (positive = right). */
export function steerTo(v: Vehicle, x: number, z: number, gain = 2.2) {
  const want = Math.atan2(x - v.pos.x, z - v.pos.z);
  const diff = wrapAngle(want - v.heading);
  return { steer: clamp(-diff * gain, -1, 1), diff };
}

const CIV_COUNT = 18;

export class Traffic {
  cars: Vehicle[] = [];
  private rng = new Rng(99);

  constructor(private g: Game) {}

  reset() {
    for (const v of this.cars) this.g.removeVehicle(v);
    this.cars = [];
    for (let i = 0; i < CIV_COUNT; i++) this.spawn(true);
  }

  private spawn(anywhere: boolean) {
    const g = this.g;
    const r = this.rng;
    const kind: CarKind = r.chance(0.15) ? 'taxi' : r.chance(0.1) ? 'van' : 'sedan';
    const color = kind === 'taxi' ? '#c4a03c' : kind === 'van' ? r.pick(['#cfccc4', '#b9a98a', '#6e6a62']) : r.pick(PAL.carColors);
    const v = new Vehicle(kind, color, g.col);
    v.driver = 'traffic';
    v.ai = { a: 0, b: 0, c: 0, phase: 'edge', pts: [], idx: 0, cruise: r.range(9, 12.5), crashedT: 0, stuckT: 0, honkT: 0 } as DriveAI;
    if (!this.place(v, anywhere)) return;
    g.addVehicle(v);
    this.cars.push(v);
  }

  private place(v: Vehicle, anywhere: boolean): boolean {
    const g = this.g;
    const P = g.player.worldPos;
    for (let tries = 0; tries < 30; tries++) {
      const e = this.rng.pick(g.city.graph.edges);
      const flip = this.rng.chance(0.5);
      const a = flip ? e.b : e.a, b = flip ? e.a : e.b;
      const pts = edgePoints(g, a, b);
      const k = this.rng.int(1, 6);
      const p = pts[k];
      const d = Math.hypot(p.x - P.x, p.z - P.z);
      if (!anywhere && (d < 80 || d > 170)) continue;
      if (anywhere && d < 25) continue;
      if (!anywhere && g.isVisible(p.x, 1, p.z) && d < 140) continue;
      if (g.vehicles.some((o) => o !== v && Math.hypot(o.pos.x - p.x, o.pos.z - p.z) < 9)) continue;
      const ai = v.ai as DriveAI;
      ai.a = a; ai.b = b; ai.c = pickNext(g, a, b, () => this.rng.next());
      ai.phase = 'edge'; ai.pts = pts; ai.idx = k + 1; ai.crashedT = 0; ai.stuckT = 0;
      const n = pts[k + 1];
      v.place(p.x, p.z, Math.atan2(n.x - p.x, n.z - p.z));
      v.hp = 100; v.wrecked = false;
      v.vx = Math.sin(v.heading) * ai.cruise * 0.8;
      v.vz = Math.cos(v.heading) * ai.cruise * 0.8;
      return true;
    }
    return false;
  }

  update(dt: number) {
    const g = this.g;
    const P = g.player.worldPos;
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const v = this.cars[i];
      if (v.driver !== 'traffic') {
        // carjacked: no longer ours
        this.cars.splice(i, 1);
        continue;
      }
      const d = Math.hypot(v.pos.x - P.x, v.pos.z - P.z);
      const ai = v.ai as DriveAI;
      if (d > 185 || (ai.crashedT > 10 && d > 60 && !g.isVisible(v.pos.x, 1, v.pos.z)) || Math.abs(v.pos.x) > HALF + 12 || Math.abs(v.pos.z) > HALF + 12) {
        if (!this.place(v, false)) continue;
      }
      this.drive(v, dt);
    }
    while (this.cars.length < CIV_COUNT) {
      const before = this.cars.length;
      this.spawn(false);
      if (this.cars.length === before) break;
    }
  }

  private drive(v: Vehicle, dt: number) {
    const g = this.g;
    const ai = v.ai as DriveAI;
    if (v.wrecked) { v.throttle = 0; v.handbrake = true; ai.crashedT += dt; return; }
    if (v.lastImpact > 6.5) { ai.crashedT = Math.max(ai.crashedT, 0.01); v.lastImpact = 0; }
    if (ai.crashedT > 0) {
      ai.crashedT += dt;
      v.throttle = 0; v.steer = 0; v.handbrake = ai.crashedT < 4;
      v.alarmT = Math.max(v.alarmT, 0);
      if (ai.crashedT > 5) {
        // try to resume if still roughly on the route
        const p = ai.pts[Math.min(ai.idx, ai.pts.length - 1)];
        if (Math.hypot(p.x - v.pos.x, p.z - v.pos.z) < 9) { ai.crashedT = 0; }
      }
      return;
    }
    v.handbrake = false;
    // advance waypoints
    while (ai.idx < ai.pts.length && Math.hypot(ai.pts[ai.idx].x - v.pos.x, ai.pts[ai.idx].z - v.pos.z) < 4.5) ai.idx++;
    if (ai.idx >= ai.pts.length) {
      if (ai.phase === 'edge') {
        ai.phase = 'turn';
        ai.pts = turnPoints(g, ai.a, ai.b, ai.c);
      } else {
        ai.phase = 'edge';
        ai.a = ai.b; ai.b = ai.c;
        ai.c = pickNext(g, ai.a, ai.b, () => this.rng.next());
        ai.pts = edgePoints(g, ai.a, ai.b);
      }
      ai.idx = 0;
    }
    const tp = ai.pts[Math.min(ai.idx, ai.pts.length - 1)];
    const { steer, diff } = steerTo(v, tp.x, tp.z);
    v.steer = steer;
    let want = ai.phase === 'turn' && Math.abs(diff) > 0.25 ? Math.min(ai.cruise, 6.5) : ai.cruise;

    // signals (only while on the edge approaching node b)
    if (ai.phase === 'edge') {
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
    // keep distance from whatever is ahead
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    for (const o of g.vehicles) {
      if (o === v) continue;
      const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z;
      const along = dx * fx + dz * fz;
      if (along < 0 || along > 16) continue;
      const lat = Math.abs(dx * fz - dz * fx);
      if (lat > 2.0) continue;
      want = Math.min(want, Math.max(0, (along - 6) * 0.9));
    }
    // pedestrians/player on foot in the lane
    if (!g.player.vehicle) {
      const dx = g.player.pos.x - v.pos.x, dz = g.player.pos.z - v.pos.z;
      const along = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
      if (along > 0 && along < 12 && lat < 1.8) {
        want = Math.min(want, Math.max(0, (along - 4) * 0.8));
        ai.honkT -= dt;
        if (ai.honkT < 0 && along < 9) { g.audio.horn(v.pos); ai.honkT = 3; }
      }
    }
    const err = want - v.speed;
    v.throttle = clamp(err * 0.45, -1, 1);
    if (want < 0.3 && v.speed < 0.6) v.throttle = 0;
    // stuck recovery
    if (want > 3 && v.speed < 0.5) ai.stuckT += dt; else ai.stuckT = 0;
    if (ai.stuckT > 4) ai.crashedT = 0.01;
  }
}

export const _tmp = new THREE.Vector3();
