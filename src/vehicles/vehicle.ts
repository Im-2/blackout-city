// Arcade car physics: bicycle-ish yaw model with lateral grip, handbrake
// drift, collision vs AABBs (3 circles), damage, lights.
import * as THREE from 'three';
import { BOATS, buildCar, CarKind, CarParts, LABELS, repaint } from './carMesh';
import { clamp, damp, wrapAngle } from '../core/math';
import { SEA_LIMIT, surfaceHeight, WATER_Y } from '../world/layout';
import { aiVehicleDurability, crashDamage, impactDamage, landingDamage, playerVehicleDurability } from './damage';
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
  // on water `grip` is how hard it holds a line: low, so they drift
  jetski: P(30, 24, 9, 2.4, 0.9, 3.2, 0.32, 5),
  speedboat: P(36, 17, 8, 1.7, 0.7, 2.1, 1.1, 5),
  policeboat: P(34, 15, 9, 2, 0.8, 2.1, 1.6, 5),
};

export type Driver = 'none' | 'player' | 'traffic' | 'cop' | 'racer';

const GRAVITY = 20;

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
  /** 0 = wrecked, 1 = perfect */
  health = 1;
  /** mission vehicles with health of their own */
  private maxOverride: number | null = null;
  wrecked = false;
  /** seconds until another hit counts in full, and how hard the last one was */
  private hitT = 0;
  private lastHit = 0;
  alarmT = 0;
  siren = false;
  isCop: boolean;
  isGetaway = false;
  /** floats, and can't leave the water */
  boat: boolean;
  /** gone under: lost */
  sunk = false;
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
  /** one of the collectable rare cars */
  rareId?: string;
  /** rent instead of stealing (price in $) */
  rental?: number;
  /** two-wheelers: 1 = lean back for a wheelie, -1 = lean forward for a stoppie */
  trick = 0;
  /** airborne off a ramp or a drop */
  air = false;
  vy = 0;
  private climb = 0;
  private airT = 0;
  private airYaw = 0;
  private waveT = 0;
  private flip = 0;
  /** set on touchdown, consumed by the trick system */
  landed: { time: number; yaw: number; flip: number; flipLeft: number } | null = null;

  constructor(public kind: CarKind, color: string, public col: Collision) {
    this.color = color;
    this.parts = buildCar(kind, color);
    this.p = { ...PARAMS[kind] };
    this.isCop = kind === 'police' || kind === 'swat' || kind === 'policemoto' || kind === 'policeboat';
    this.boat = BOATS.includes(kind);
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

  /** which damage table applies: who's driving right now */
  get durability() { return this.driver === 'player' ? playerVehicleDurability : aiVehicleDurability; }
  get maxHp() { return this.maxOverride ?? this.durability.health[this.kind]; }
  set maxHp(n: number) { this.maxOverride = n; }
  get hp() { return this.health * this.maxHp; }
  set hp(n: number) { this.health = Math.max(0, n / this.maxHp); }

  /** engine output: normal until badly hurt, then fading a little */
  private get power() {
    const h = this.health, D = this.durability;
    return h >= D.limpBelow ? 1 : D.limpFloor + (1 - D.limpFloor) * (h / D.limpBelow);
  }

  repair() {
    this.health = 1;
    this.wrecked = false;
    this.sunk = false;
    this.hitT = this.lastHit = 0;
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
    this.pos.set(x, this.boat ? WATER_Y : surfaceHeight(x, z, 0.2), z);
    this.heading = heading;
    this.sunk = false;
    this.vx = this.vz = this.yawRate = this.spin = 0;
    this.vy = this.climb = this.flip = 0;
    this.air = false;
    this.landed = null;
    this.sync();
  }

  get fwdX() { return Math.sin(this.heading); }
  get fwdZ() { return Math.cos(this.heading); }
  get speedAbs() { return Math.hypot(this.vx, this.vz); }
  get wheelie() { return !this.air && this.pitch < -0.3; }
  get stoppie() { return !this.air && this.pitch > 0.25; }
  get bodyPitch() { return this.pitch; }
  get bodyRoll() { return this.roll; }

  /** ballistic: momentum carries you, the controls spin and flip two-wheelers */
  private updateAir(dt: number, impacts: ImpactEvent[]) {
    const two = this.two;
    const spinRate = two ? 6.2 : 0.8;
    const dYaw = -(this.wrecked ? 0 : this.steer) * spinRate * dt;
    this.heading += dYaw;
    this.airYaw += dYaw;
    // flips need the trick key: everyone leaves a ramp with the throttle held
    if (two && !this.wrecked && this.trick) this.flip += this.throttle * 6 * dt;
    this.airT += dt;
    this.vy -= GRAVITY * dt;
    this.pos.x += this.vx * dt;
    this.pos.z += this.vz * dt;
    this.pos.y += this.vy * dt;
    this.wheelRot += (this.speed * dt) / this.parts.dims.wheelR;
    this.roll = damp(this.roll, 0, 6, dt);
    this.pitch = damp(this.pitch, 0, 6, dt);
    const gy = surfaceHeight(this.pos.x, this.pos.z, this.pos.y);
    if (this.pos.y <= gy) {
      const impact = -this.vy;
      this.pos.y = gy;
      this.air = false;
      this.vy = this.climb = 0;
      this.landed = { time: this.airT, yaw: this.airYaw, flip: this.flip, flipLeft: wrapAngle(this.flip) };
      this.flip = 0;
      this.yawRate = 0;
      this.vx *= 0.97;
      this.vz *= 0.97;
      this.damage(landingDamage(this.durability, impact));
      if (impact > 6) impacts.push({ v: this, other: null, impact: impact * 0.5, x: this.pos.x, y: this.pos.y, z: this.pos.z, nx: 0, nz: 0 });
    }
    this.collideStatic(impacts);
    this.sync();
  }

  update(dt: number, impacts: ImpactEvent[]) {
    if (this.hitT > 0) this.hitT -= dt;
    if (this.sunk) { this.pos.y = Math.max(-7, this.pos.y - dt * 1.1); this.vx *= Math.exp(-dt * 2); this.vz *= Math.exp(-dt * 2); this.pos.x += this.vx * dt; this.pos.z += this.vz * dt; this.sync(); return; }
    if (this.boat) { this.updateBoat(dt, impacts); return; }
    if (this.air) { this.updateAir(dt, impacts); return; }
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
    const power = this.power;
    const maxS = p.maxSpeed * (boost ? 1.15 : 1) * power;
    if (thr > 0) {
      if (vf < -0.8) { a = p.brake * thr; braking = true; }
      else a = p.accel * power * (boost ? 1.5 : 1) * thr * (1 - Math.pow(clamp(vf / maxS, 0, 1), 2));
    } else if (thr < 0) {
      if (vf > 0.8) { a = p.brake * thr; braking = true; }
      else a = vf > -p.reverse ? p.accel * 0.7 * thr : 0;
    }
    // nose down on a stoppie: you ride the front brake, you don't stamp on it
    if (this.trick < 0 && braking) a *= 0.3;
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
    const prevY = this.pos.y;
    const gy = surfaceHeight(this.pos.x, this.pos.z, this.pos.y);
    if (gy > this.pos.y) this.pos.y = gy - this.pos.y > 0.2 ? gy : damp(this.pos.y, gy, 18, dt);
    else if (this.pos.y - gy > 0.3) {
      // the ground fell away: off a ramp or a ledge
      this.air = true;
      this.vy = Math.max(0, this.climb);
      this.airT = this.airYaw = this.flip = 0;
      this.landed = null;
    } else this.pos.y = Math.max(gy, this.pos.y - 9 * dt);
    this.climb = damp(this.climb, (this.pos.y - prevY) / Math.max(dt, 1e-4), 25, dt);

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
      const lean = this.trick > 0 && sp > 1.5 ? -0.62 : this.trick < 0 && sp > 2.5 ? 0.46 : boost && sp < 22 && this.kind !== 'scooter' ? -0.42 : clamp(-a * 0.006, -0.08, 0.08);
      this.pitch = damp(this.pitch, lean, 5, dt);
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

  /** no wheels, no road: it slides, leans into turns, lifts its nose and bobs */
  private updateBoat(dt: number, impacts: ImpactEvent[]) {
    const p = this.p;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const rx = Math.cos(this.heading), rz = -Math.sin(this.heading);
    let vf = this.vx * fx + this.vz * fz;
    let vs = this.vx * rx + this.vz * rz;
    const thr = this.wrecked ? 0 : this.throttle;
    const steer = this.wrecked ? 0 : this.steer;
    const boost = this.boost && thr > 0 && this.two;
    const power = this.power;
    const maxS = p.maxSpeed * (boost ? 1.15 : 1) * power;
    let a = 0;
    if (thr > 0) a = p.accel * power * (boost ? 1.4 : 1) * thr * (1 - Math.pow(clamp(vf / maxS, 0, 1), 2));
    else if (thr < 0) a = vf > 0.5 ? p.brake * thr : vf > -p.reverse ? p.accel * 0.45 * thr : 0;
    vf += a * dt;
    vf -= vf * (thr === 0 ? 0.5 : 0.1) * dt; // water slows you without the engine
    if (Math.abs(vf) < 0.03 && thr === 0) vf = 0;
    vs *= Math.exp(-(this.handbrake ? p.driftGrip : p.grip) * dt);
    const sp = Math.abs(vf);
    const rate = p.steerRate * clamp(sp / 5, 0.2, 1) / (1 + sp / 70);
    const target = -steer * rate * (vf < -0.5 ? -1 : 1) * (this.handbrake ? 1.5 : 1);
    this.yawRate = damp(this.yawRate, target, 5, dt);
    this.spin *= Math.exp(-2.4 * dt);
    if (Math.abs(this.spin) < 0.01) this.spin = 0;
    this.vx = fx * vf + rx * vs;
    this.vz = fz * vf + rz * vs;
    this.heading += (this.yawRate + this.spin) * dt;
    this.pos.x += this.vx * dt;
    this.pos.z += this.vz * dt;
    // the coast guard's line: a current that pushes you back
    if (this.pos.x > SEA_LIMIT) this.vx -= (this.pos.x - SEA_LIMIT) * 3 * dt;
    if (this.pos.z > SEA_LIMIT) this.vz -= (this.pos.z - SEA_LIMIT) * 3 * dt;
    this.waveT += dt;
    const chop = 0.05 + Math.min(0.06, sp * 0.003);
    this.pos.y = WATER_Y + Math.sin(this.waveT * 2.1 + this.id) * chop + Math.min(0.22, sp * 0.012);
    this.speed = vf;
    this.slip = Math.abs(vs);
    this.skidding = false;
    this.collideStatic(impacts);
    this.roll = damp(this.roll, clamp(this.yawRate * sp * (this.two ? 0.05 : 0.03), -0.5, 0.5) + Math.sin(this.waveT * 1.4 + this.id) * 0.025, 5, dt);
    this.pitch = damp(this.pitch, -clamp(sp * 0.012, 0, 0.26) + Math.sin(this.waveT * 1.7 + this.id * 2) * 0.02, 4, dt);
    if (this.alarmT > 0) this.alarmT -= dt;
    this.sync(false);
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
        const D = this.durability;
        this.damage(impactDamage(D, impact) * (res.solid ? 1 : D.lightObject));
      }
    }
  }

  damage(amt: number) {
    if (amt <= 0 || this.wrecked) return;
    // one scrape can't count over and over: inside the cooldown only the extra force of a harder hit lands
    const felt = this.hitT > 0 ? amt - this.lastHit : amt;
    this.lastHit = this.hitT > 0 ? Math.max(this.lastHit, amt) : amt;
    this.hitT = this.durability.cooldown;
    if (felt <= 0) return;
    this.hp -= felt;
    if (this.health <= 0) {
      this.health = 0;
      this.wrecked = true;
      this.siren = false;
    }
  }

  sync(braking = false) {
    const r = this.parts.root;
    r.position.copy(this.pos);
    r.rotation.order = 'YXZ';
    r.rotation.y = this.heading;
    r.rotation.x = this.flip;
    // wheelie lifts the front around the rear axle, stoppie the rear around the front
    const back = this.two ? this.parts.dims.wheelBase / 2 : 0;
    this.parts.body.rotation.set(this.pitch, 0, this.roll);
    this.parts.body.position.set(0, this.two ? Math.abs(Math.sin(this.pitch)) * back : 0, 0);
    const w = this.parts.wheels;
    for (let i = 0; i < w.length; i++) {
      const wheel = w[i];
      wheel.rotation.y = i < (this.two ? 1 : 2) ? this.steerVis : 0;
      wheel.rotation.z = this.two ? -this.roll : 0;
      wheel.children[0].rotation.x = this.wheelRot;
    }
    if (this.two && w[0]) w[0].position.y = this.parts.dims.wheelR + (this.pitch < 0 ? this.parts.body.position.y * 2 : 0);
    if (this.two && w[1]) w[1].position.y = this.parts.dims.wheelR + (this.pitch > 0 ? this.parts.body.position.y * 2 : 0);
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

  private lodLevel = 0;

  /** 0 near: everything; 1 mid: no hubs/lights; 2 far: body only. Saves ~8 draw calls per car. */
  setLod(level: number) {
    if (level === this.lodLevel) return;
    this.lodLevel = level;
    for (const w of this.parts.wheels) {
      w.visible = level < 2;
      w.children[0].children[0].visible = level === 0;
    }
    this.parts.brake.visible = level < 2;
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
      if (Math.abs(A.pos.y - B.pos.y) > 1.4) continue; // a boat under a pier, a car on a deck
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
          A.damage(crashDamage(A.durability, impact, A.p.mass, B.p.mass, B.isCop && !A.isCop));
          B.damage(crashDamage(B.durability, impact, B.p.mass, A.p.mass, A.isCop && !B.isCop));
          if (impact > 2.5) impacts.push({ v: A, other: B, impact, x: (a.x + b.x) / 2, y: A.pos.y + 0.7, z: (a.z + b.z) / 2, nx: dx, nz: dz });
        }
    }
  }
}
