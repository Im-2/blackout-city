// Arcade car physics: bicycle-ish yaw model with lateral grip, handbrake
// drift, collision vs AABBs (3 circles), damage, lights.
import * as THREE from 'three';
import { buildCar, CarKind, CarParts, LABELS, repaint } from './carMesh';
import { clamp, damp } from '../core/math';
import { surfaceHeight } from '../world/layout';
import type { Collision } from '../world/collision';

export interface CarParams {
  maxSpeed: number;
  accel: number;
  brake: number;
  reverse: number;
  grip: number;
  driftGrip: number;
  steerRate: number;
  mass: number;
}

const P = (maxSpeed: number, accel: number, brake: number, grip: number, driftGrip: number, steerRate: number, mass: number, reverse = 8): CarParams => ({ maxSpeed, accel, brake, reverse, grip, driftGrip, steerRate, mass });
// per-vehicle tuning: top speed m/s, accel, brake, grip, handbrake grip, steer rate, mass
export const PARAMS: Record<CarKind, CarParams> = {
  bicycle: P(10.5, 6, 14, 14, 4, 3.4, 0.25, 2),
  scooter: P(17, 9, 20, 13, 3.5, 3.2, 0.35, 3),
  motorbike: P(40, 21, 30, 12, 2.5, 3.0, 0.45, 4),
  policemoto: P(41, 21, 30, 12, 2.5, 3.0, 0.5, 4),
  sedan: P(31, 13, 30, 9, 1.4, 2.3, 1),
  taxi: P(31, 13, 30, 9, 1.4, 2.3, 1),
  hatchback: P(28, 14, 30, 9.5, 1.5, 2.5, 0.85),
  sports: P(44, 21, 36, 11, 1.7, 2.5, 1.0),
  muscle: P(42, 22, 30, 8, 1.1, 2.2, 1.25),
  pickup: P(30, 13, 28, 8, 1.3, 2.0, 1.5),
  suv: P(31, 14, 28, 8.5, 1.4, 2.1, 1.6),
  police: P(36, 17, 34, 10, 1.6, 2.5, 1.25, 10),
  van: P(25, 9, 24, 8, 1.5, 1.9, 1.8),
  foodtruck: P(22, 7, 22, 7.5, 1.5, 1.7, 2.2),
  boxtruck: P(23, 7, 22, 7, 1.4, 1.6, 2.8),
  garbage: P(20, 6, 20, 7, 1.4, 1.5, 3.2),
  bus: P(21, 6, 20, 7, 1.4, 1.3, 3.6),
  ambulance: P(32, 13, 28, 8.5, 1.5, 2.0, 1.9),
  firetruck: P(27, 9, 24, 7.5, 1.4, 1.5, 3.4),
  swat: P(29, 12, 26, 8, 1.5, 1.9, 2.6),
};

export type Driver = 'none' | 'player' | 'traffic' | 'cop';

export interface ImpactEvent { v: Vehicle; other: Vehicle | null; impact: number; x: number; y: number; z: number; nx: number; nz: number; }

let nextId = 1;

export class Vehicle {
  id = nextId++;
  parts: CarParts;
  pos = new THREE.Vector3();
  heading = 0;
  vx = 0;
  vz = 0;
  yawRate = 0;
  spin = 0;
  p: CarParams;
  throttle = 0;
  steer = 0;
  handbrake = false;
  driver: Driver = 'none';
  hp = 100;
  wrecked = false;
  alarmT = 0;
  siren = false;
  isCop: boolean;
  isGetaway = false;
  parked = false;
  /** per-frame derived */
  speed = 0; // signed forward speed
  slip = 0;
  skidding = false;
  private grip = 9;
  private roll = 0;
  private pitch = 0;
  private wheelRot = 0;
  private steerVis = 0;
  private prevVf = 0;
  lastImpact = 0;
  /** controller-owned scratch */
  ai: any = null;
  radius: number;
  circleOffsets: number[];
  sirenPhase = Math.random() * 10;

  color: string;
  get label() { return LABELS[this.kind]; }
  two: boolean;
  /** parked vehicles need a lock-pick (hold E) or a quiet hack */
  locked = false;
  boost = false;
  /** 0..1 rain wetness (less grip) */
  wet = 0;
  isEmergency: boolean;
  private lean = 0;

  constructor(public kind: CarKind, color: string, public col: Collision) {
    this.color = color;
    this.parts = buildCar(kind, color);
    this.p = { ...PARAMS[kind] };
    this.isCop = kind === 'police' || kind === 'swat' || kind === 'policemoto';
    this.isEmergency = this.isCop || kind === 'ambulance' || kind === 'firetruck';
    this.two = this.parts.dims.two;
    const d = this.parts.dims;
    this.radius = this.two ? 0.42 : d.wid / 2;
    if (this.two) this.circleOffsets = [-d.len / 2 + 0.45, d.len / 2 - 0.45];
    else {
      const half = d.len / 2 - this.radius;
      const n = Math.max(2, Math.round((2 * half) / (this.radius * 1.6)) + 1);
      this.circleOffsets = Array.from({ length: n }, (_, i) => -half + (2 * half * i) / (n - 1));
    }
    this.grip = this.p.grip;
  }

  respray(color: string) {
    this.color = color;
    repaint(this.parts, this.kind, color);
  }

  get object() {
    return this.parts.root;
  }

  tune(kind: 'getaway', level = 0) {
    if (kind === 'getaway') {
      this.p.maxSpeed = 38 + level * 2.5;
      this.p.accel = 17 + level * 2;
      this.p.grip = 9.5 + level * 0.4;
      this.p.steerRate = 2.5;
      this.isGetaway = true;
    }
  }

  place(x: number, z: number, heading: number) {
    this.pos.set(x, surfaceHeight(x, z, 0.2), z);
    this.heading = heading;
    this.vx = this.vz = this.yawRate = this.spin = 0;
    this.sync();
  }

  get fwdX() { return Math.sin(this.heading); }
  get fwdZ() { return Math.cos(this.heading); }
  get speedAbs() { return Math.hypot(this.vx, this.vz); }

  update(dt: number, impacts: ImpactEvent[]) {
    const p = this.p;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const rx = Math.cos(this.heading), rz = -Math.sin(this.heading);
    let vf = this.vx * fx + this.vz * fz;
    let vs = this.vx * rx + this.vz * rz;

    let thr = this.wrecked ? 0 : this.throttle;
    let steer = this.wrecked ? 0 : this.steer;
    const hb = this.handbrake;
    let braking = false;

    // longitudinal
    let a = 0;
    const boost = this.boost && thr > 0 && (this.two || this.kind === 'sports' || this.kind === 'muscle') && this.kind !== 'bicycle';
    const maxS = p.maxSpeed * (boost ? 1.15 : 1);
    if (thr > 0) {
      if (vf < -0.8) { a = p.brake * thr; braking = true; }
      else a = p.accel * (boost ? 1.5 : 1) * thr * (1 - Math.pow(clamp(vf / maxS, 0, 1), 2));
    } else if (thr < 0) {
      if (vf > 0.8) { a = p.brake * thr; braking = true; }
      else a = vf > -p.reverse ? p.accel * 0.7 * thr : 0;
    }
    vf += a * dt;
    const coast = thr === 0 ? 0.45 : 0.08;
    vf -= vf * coast * dt;
    if (Math.abs(vf) < 0.05 && thr === 0) vf = 0;
    if (hb) vf -= Math.sign(vf) * Math.min(Math.abs(vf), (this.two ? 18 : 7) * dt);

    // lateral grip (smooth recovery after a drift)
    const tgtGrip = hb && !this.two ? p.driftGrip : p.grip * (1 - 0.3 * clamp(Math.abs(vf) / p.maxSpeed, 0, 1) * Math.abs(steer));
    this.grip = tgtGrip < this.grip ? damp(this.grip, tgtGrip, 14, dt) : damp(this.grip, tgtGrip, 2.2, dt);
    if (this.wrecked) this.grip = 6;
    vs *= Math.exp(-this.grip * (1 - this.wet * 0.18) * dt);

    // yaw
    const sp = Math.abs(vf);
    const rate = p.steerRate * clamp(sp / 4, 0, 1) / (1 + sp / 45);
    const target = -steer * rate * Math.sign(vf || 1) * (hb ? 1.55 : 1);
    this.yawRate = damp(this.yawRate, target, 9, dt);
    this.spin *= Math.exp(-1.8 * dt);
    if (Math.abs(this.spin) < 0.01) this.spin = 0;

    // recompose in old basis, then rotate the car
    this.vx = fx * vf + rx * vs;
    this.vz = fz * vf + rz * vs;
    this.heading += (this.yawRate + this.spin) * dt;

    this.pos.x += this.vx * dt;
    this.pos.z += this.vz * dt;
    const gy = surfaceHeight(this.pos.x, this.pos.z, this.pos.y);
    this.pos.y = gy > this.pos.y ? damp(this.pos.y, gy, 18, dt) : Math.max(gy, this.pos.y - 9 * dt);

    this.speed = vf;
    this.slip = Math.abs(vs);
    const decel = (this.prevVf - vf) / Math.max(dt, 1e-4);
    this.skidding = (this.slip > 2.6 && sp > 4) || (hb && sp > 7) || (braking && sp > 12 && decel > 18);
    this.prevVf = vf;

    this.collideStatic(impacts);

    // visuals
    if (this.two) {
      // lean into turns, wheelie on boost
      this.lean = damp(this.lean, clamp(this.yawRate * sp * 0.045, -0.65, 0.65), 7, dt);
      this.roll = this.lean;
      this.pitch = damp(this.pitch, boost && sp < 22 && this.kind !== 'scooter' ? -0.42 : clamp(-a * 0.006, -0.08, 0.08), 5, dt);
    } else {
      this.roll = damp(this.roll, clamp(-vs * 0.025 - this.yawRate * sp * 0.006, -0.12, 0.12), 6, dt);
      this.pitch = damp(this.pitch, clamp(-a * 0.004, -0.06, 0.06), 6, dt);
    }
    this.wheelRot += (vf * dt) / this.parts.dims.wheelR;
    this.steerVis = damp(this.steerVis, -steer * 0.5, 12, dt);
    if (this.alarmT > 0) this.alarmT -= dt;
    this.sync(braking || (thr < 0 && vf > 0.5) || hb);
    void thr; void steer;
  }

  private collideStatic(impacts: ImpactEvent[]) {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const c = { x: 0, z: 0 };
    for (const off of this.circleOffsets) {
      c.x = this.pos.x + fx * off;
      c.z = this.pos.z + fz * off;
      const ox = c.x, oz = c.z;
      const res = this.col.resolveCircle(c, this.radius, this.pos.y, 0.5, this.pos.y + Math.min(1.6, this.parts.dims.h));
      if (!res.hits) continue;
      this.pos.x += c.x - ox;
      this.pos.z += c.z - oz;
      const vn = this.vx * res.nx + this.vz * res.nz;
      if (vn < 0) {
        const e = 0.25;
        this.vx -= (1 + e) * vn * res.nx;
        this.vz -= (1 + e) * vn * res.nz;
        // scrape friction
        this.vx *= 0.92;
        this.vz *= 0.92;
        const impact = -vn;
        // torque from off-centre hit: hitting with the nose spins the car
        const cross = fx * res.nz - fz * res.nx;
        this.spin -= clamp(cross * off * impact * 0.09, -4, 4);
        if (impact > 2) impacts.push({ v: this, other: null, impact, x: c.x - res.nx * this.radius, y: this.pos.y + 0.7, z: c.z - res.nz * this.radius, nx: res.nx, nz: res.nz });
        this.damage(Math.max(0, impact - 7) * 2.2);
      }
    }
  }

  damage(amt: number) {
    if (amt <= 0 || this.wrecked) return;
    this.hp -= amt;
    if (this.hp <= 0) {
      this.hp = 0;
      this.wrecked = true;
      this.siren = false;
    }
  }

  sync(braking = false) {
    const r = this.parts.root;
    r.position.copy(this.pos);
    r.rotation.y = this.heading;
    // wheelie lifts the front around the rear axle
    const back = this.two ? this.parts.dims.wheelBase / 2 : 0;
    this.parts.body.rotation.set(this.pitch, 0, this.roll);
    this.parts.body.position.set(0, this.two ? Math.sin(-Math.min(0, this.pitch)) * back : 0, 0);
    const w = this.parts.wheels;
    for (let i = 0; i < w.length; i++) {
      const wheel = w[i];
      wheel.rotation.y = i < (this.two ? 1 : 2) ? this.steerVis : 0;
      wheel.rotation.z = this.two ? -this.roll : 0;
      wheel.children[0].rotation.x = this.wheelRot;
    }
    if (this.two && w[0]) w[0].position.y = this.parts.dims.wheelR + this.parts.body.position.y * 2;
    const bm = this.parts.brake.material as THREE.MeshBasicMaterial;
    bm.color.set(braking ? '#ff3a2a' : this.driver === 'none' && !this.isCop ? '#5a1410' : '#b8231c');
    const alarmOn = this.alarmT > 0 && Math.sin(this.alarmT * 14) > 0;
    this.parts.head.visible = this.driver !== 'none' || alarmOn || this.isCop || this.isEmergency;
    if (alarmOn) bm.color.set('#ff8a40');
    if (this.parts.red && this.parts.blue) {
      const on = this.siren;
      this.sirenPhase += 0.016 * 9;
      const ph = Math.sin(this.sirenPhase) > 0;
      this.parts.red.visible = !on || ph;
      this.parts.blue.visible = !on || !ph;
      (this.parts.red.material as THREE.MeshBasicMaterial).color.set(on ? '#ff2a1a' : '#6a2020');
      (this.parts.blue.material as THREE.MeshBasicMaterial).color.set(on ? '#2a6aff' : '#20306a');
    }
  }

  /** world-space circle centres (for car-car and car-ped checks) */
  circles(out: { x: number; z: number; off: number }[]) {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    out.length = 0;
    for (const off of this.circleOffsets) out.push({ x: this.pos.x + fx * off, z: this.pos.z + fz * off, off });
    return out;
  }
}

/** Resolve car-vs-car contacts with impulses (spin-outs emerge from off-centre hits). */
export function collideVehicles(vs: Vehicle[], impacts: ImpactEvent[]) {
  const ca: { x: number; z: number; off: number }[] = [], cb: { x: number; z: number; off: number }[] = [];
  for (let i = 0; i < vs.length; i++) {
    const A = vs[i];
    for (let j = i + 1; j < vs.length; j++) {
      const B = vs[j];
      const dx0 = A.pos.x - B.pos.x, dz0 = A.pos.z - B.pos.z;
      if (dx0 * dx0 + dz0 * dz0 > 49) continue;
      A.circles(ca);
      B.circles(cb);
      const r = A.radius + B.radius;
      for (const a of ca)
        for (const b of cb) {
          let dx = a.x - b.x, dz = a.z - b.z;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r || d2 < 1e-6) continue;
          const d = Math.sqrt(d2);
          dx /= d; dz /= d;
          const pen = r - d;
          const ia = 1 / A.p.mass, ib = 1 / B.p.mass;
          const sum = ia + ib;
          A.pos.x += dx * pen * (ia / sum);
          A.pos.z += dz * pen * (ia / sum);
          B.pos.x -= dx * pen * (ib / sum);
          B.pos.z -= dz * pen * (ib / sum);
          const vn = (A.vx - B.vx) * dx + (A.vz - B.vz) * dz;
          if (vn >= 0) continue;
          const e = 0.35;
          const jimp = (-(1 + e) * vn) / sum;
          A.vx += jimp * ia * dx; A.vz += jimp * ia * dz;
          B.vx -= jimp * ib * dx; B.vz -= jimp * ib * dz;
          // spin from off-centre contact
          const afx = Math.sin(A.heading), afz = Math.cos(A.heading);
          const bfx = Math.sin(B.heading), bfz = Math.cos(B.heading);
          A.spin += clamp((afz * dx - afx * dz) * a.off * jimp * ia * 0.16, -5, 5);
          B.spin -= clamp((bfz * dx - bfx * dz) * b.off * jimp * ib * 0.16, -5, 5);
          const impact = -vn;
          A.damage(Math.max(0, impact - 6) * 1.6 * (B.p.mass / A.p.mass));
          B.damage(Math.max(0, impact - 6) * 1.6 * (A.p.mass / B.p.mass));
          if (impact > 2.5) impacts.push({ v: A, other: B, impact, x: (a.x + b.x) / 2, y: A.pos.y + 0.7, z: (a.z + b.z) / 2, nx: dx, nz: dz });
        }
    }
  }
}
