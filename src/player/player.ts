// On-foot player controller: camera-relative movement, run, vault, interact,
// enter/exit vehicles. Slightly weighty but responsive.
import * as THREE from 'three';
import { clamp, damp, dampAngle } from '../core/math';
import { groundHeight, surfaceHeight, CURB_H } from '../world/layout';
import { createCharacter } from '../characters/loader';
import { PLAYER_SKIN } from '../characters/skins';
import type { CharacterView, AnimState } from '../characters/rig';
import type { Vehicle } from '../vehicles/vehicle';
import type { Game } from '../core/game';

const WALK = 3.3, RUN = 6.7, R = 0.34;

export interface Interactable {
  pos: THREE.Vector3;
  radius: number;
  label: string;
  enabled: () => boolean;
  action: () => void;
}

export class Player {
  view: CharacterView;
  pos = new THREE.Vector3();
  vx = 0;
  vz = 0;
  vy = 0;
  heading = Math.PI;
  state: AnimState = 'idle';
  vehicle: Vehicle | null = null;
  grounded = true;
  busted = false;
  /** hiding in a dumpster / van / wardrobe */
  hidden = false;
  knockT = 0;
  private vault: { t: number; dur: number; from: THREE.Vector3; to: THREE.Vector3; top: number } | null = null;
  focus: Interactable | Vehicle | null = null;
  focusLabel = '';

  constructor(private g: Game) {
    this.view = createCharacter('player', PLAYER_SKIN);
    g.scene.add(this.view.root);
  }

  /** Disguises: rebuild the character with a new outfit. */
  setSkin(skin: import('../characters/skins').Skin) {
    const parent = this.view.root.parent;
    const pos = this.view.root.position.clone(), rot = this.view.root.rotation.y;
    parent?.remove(this.view.root);
    this.view = createCharacter('player', skin);
    (parent ?? this.g.scene).add(this.view.root);
    this.view.root.position.copy(pos);
    this.view.root.rotation.y = rot;
  }

  spawn(x: number, z: number, heading: number) {
    this.exitVehicle(true);
    this.pos.set(x, Math.max(groundHeight(x, z), this.g.col.groundUnder(x, z, R, 1.5)), z);
    this.travel = null;
    this.hidden = false;
    this.view.root.visible = true;
    this.heading = heading;
    this.vx = this.vz = this.vy = 0;
    this.busted = false;
    this.knockT = 0;
    this.vault = null;
    this.syncView();
  }

  get speed() {
    return Math.hypot(this.vx, this.vz);
  }

  /** Position used by AI/cameras (vehicle if driving). */
  get worldPos(): THREE.Vector3 {
    return this.vehicle ? this.vehicle.pos : this.pos;
  }

  private travel: { kind: 'climb' | 'zip'; t: number; dur: number; from: THREE.Vector3; to: THREE.Vector3; heading: number } | null = null;

  /** fire escapes: up or down a ladder */
  climb(L: { x: number; z: number; top: number; heading: number; topX: number; topZ: number }, up: boolean) {
    const a = new THREE.Vector3(L.x, CURB_H, L.z), b = new THREE.Vector3(L.topX, L.top, L.topZ);
    this.travel = { kind: 'climb', t: 0, dur: Math.max(1.2, L.top / 7), from: up ? a : b, to: up ? b : a, heading: L.heading + Math.PI };
    if (up) this.g.save.escape('rooftop');
  }

  zipline(z: { a: THREE.Vector3; b: THREE.Vector3 }) {
    const d = z.a.distanceTo(z.b);
    this.travel = { kind: 'zip', t: 0, dur: d / 16, from: z.a.clone(), to: z.b.clone(), heading: Math.atan2(z.b.x - z.a.x, z.b.z - z.a.z) };
    this.g.audio.whoosh();
    this.g.save.escape('rooftop');
  }

  hide(pos: THREE.Vector3) {
    this.hidden = true;
    this.pos.copy(pos);
    this.view.root.visible = false;
    this.vx = this.vz = 0;
    this.g.save.escape('hide');
    this.g.hud.toast('HIDDEN — PRESS E TO COME OUT', 'cool');
  }

  update(dt: number) {
    const g = this.g;
    const inp = g.input;
    if (g.travel.open) { this.view.update(dt, 'idle', 0); return; }
    if (this.hidden) {
      if (inp.pressed('KeyE') || inp.pressed('Space')) { this.hidden = false; this.view.root.visible = true; }
      return;
    }
    if (this.travel) {
      const t = this.travel;
      t.t += dt;
      const f = Math.min(1, t.t / t.dur);
      if (t.kind === 'climb') {
        // up the ladder first, then step onto the roof (or reverse)
        const up = t.to.y > t.from.y;
        const k = up ? Math.min(1, f / 0.85) : Math.max(0, (f - 0.15) / 0.85);
        this.pos.set(up && f > 0.85 ? THREE.MathUtils.lerp(t.from.x, t.to.x, (f - 0.85) / 0.15) : !up && f < 0.15 ? THREE.MathUtils.lerp(t.from.x, t.to.x, f / 0.15) : up ? t.from.x : t.to.x,
          THREE.MathUtils.lerp(t.from.y, t.to.y, k),
          up && f > 0.85 ? THREE.MathUtils.lerp(t.from.z, t.to.z, (f - 0.85) / 0.15) : !up && f < 0.15 ? THREE.MathUtils.lerp(t.from.z, t.to.z, f / 0.15) : up ? t.from.z : t.to.z);
        this.view.update(dt, 'climb', 0);
      } else {
        this.pos.lerpVectors(t.from, t.to, f * f * (1.6 - 0.6 * f));
        this.view.update(dt, 'handsup', 0);
        g.camRig.fovKick = Math.max(g.camRig.fovKick, 6);
      }
      this.heading = t.heading;
      if (f >= 1) { this.travel = null; this.vy = 0; this.pos.copy(t.to); }
      this.syncView();
      return;
    }
    if (this.vehicle) {
      this.focus = null;
      this.focusLabel = '';
      this.drive(dt);
      return;
    }
    if (this.busted) {
      this.state = 'cuffed';
      this.vx = this.vz = 0;
      this.view.update(dt, this.state, 0);
      this.syncView();
      return;
    }
    if (this.knockT > 0) {
      this.knockT -= dt;
      this.vx = damp(this.vx, 0, 4, dt);
      this.vz = damp(this.vz, 0, 4, dt);
      this.pos.x += this.vx * dt;
      this.pos.z += this.vz * dt;
      this.collide();
      this.view.update(dt, 'fall', 0);
      this.syncView();
      return;
    }

    if (this.vault) {
      const v = this.vault;
      v.t += dt;
      const f = Math.min(1, v.t / v.dur);
      this.pos.lerpVectors(v.from, v.to, f);
      this.pos.y = THREE.MathUtils.lerp(v.from.y, v.to.y, f) + Math.sin(f * Math.PI) * (v.top - Math.min(v.from.y, v.to.y) + 0.25);
      this.view.update(dt, 'vault', 0);
      if (f >= 1) { this.vault = null; this.vy = 0; }
      this.syncView();
      return;
    }

    // movement input relative to camera yaw
    const cy = g.camRig.yaw;
    const fx = Math.sin(cy), fz = Math.cos(cy);
    const rx = -Math.cos(cy), rz = Math.sin(cy);
    const ia = inp.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
    const ib = inp.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
    let mx = fx * ia + rx * ib, mz = fz * ia + rz * ib;
    const ml = Math.hypot(mx, mz);
    if (ml > 1e-3) { mx /= ml; mz /= ml; }
    const hacking = g.hack.active;
    const run = inp.isDown('ShiftLeft', 'ShiftRight') && !hacking;
    const top = ml > 0 ? (run ? RUN : WALK) * (hacking ? 0.5 : 1) * (g.heist.hasLoot ? 0.92 : 1) : 0;
    const lambda = ml > 0 ? (this.grounded ? 9 : 2.5) : this.grounded ? 12 : 1;
    this.vx = damp(this.vx, mx * top, lambda, dt);
    this.vz = damp(this.vz, mz * top, lambda, dt);

    if (ml > 0.1) this.heading = dampAngle(this.heading, Math.atan2(mx, mz), 12, dt);
    else if (hacking) this.heading = dampAngle(this.heading, cy, 10, dt);

    // jump / vault
    if (inp.pressed('Space') && this.grounded) {
      if (!this.tryVault()) {
        this.vy = 5.2;
        this.grounded = false;
      }
    }

    // integrate
    this.pos.x += this.vx * dt;
    this.pos.z += this.vz * dt;
    this.vy -= 24 * dt;
    this.pos.y += this.vy * dt;
    this.collide();

    const sp = this.speed;
    this.state = !this.grounded ? 'vault' : hacking && sp < 0.5 ? 'hack' : sp > 4.6 ? 'run' : sp > 0.4 ? 'walk' : g.heist.hasLoot ? 'carry' : 'idle';
    this.view.update(dt, this.state, sp);
    this.syncView();
    this.updateFocus();
    if (inp.pressed('KeyE') && !g.hack.active) this.interact();
    this.updatePick(dt);
  }

  private collide() {
    const g = this.g;
    const feet = this.pos.y;
    g.col.resolveCircle(this.pos, R, feet, 0.45, feet + 1.7);
    // vehicles push the player
    for (const v of g.vehicles) {
      const dx0 = this.pos.x - v.pos.x, dz0 = this.pos.z - v.pos.z;
      if (dx0 * dx0 + dz0 * dz0 > 16) continue;
      for (const c of v.circles(this.circ)) {
        let dx = this.pos.x - c.x, dz = this.pos.z - c.z;
        const d = Math.hypot(dx, dz);
        const r = v.radius + R;
        if (d < r && d > 1e-4) {
          dx /= d; dz /= d;
          this.pos.x += dx * (r - d);
          this.pos.z += dz * (r - d);
          const vs = v.speedAbs;
          if (vs > 7 && this.knockT <= 0) {
            this.knockT = 1.4;
            this.vx = v.vx * 0.6 + dx * 4;
            this.vz = v.vz * 0.6 + dz * 4;
            g.camRig.addShake(0.5);
            g.audio.thud(0.6);
          }
        }
      }
    }
    // ground
    const base = surfaceHeight(this.pos.x, this.pos.z, feet, 0.46);
    const top = g.col.groundUnder(this.pos.x, this.pos.z, R, feet + 0.46);
    const ground = Math.max(base, top);
    if (this.pos.y <= ground + 0.02 || (this.grounded && this.vy <= 0 && this.pos.y - ground < 0.35)) {
      this.pos.y = ground;
      this.vy = 0;
      this.grounded = true;
    } else this.grounded = false;
  }
  private circ: { x: number; z: number; off: number }[] = [];

  /** Vault a low obstacle in front (counter, planter, bench, hood). */
  private tryVault(): boolean {
    const g = this.g;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const feet = this.pos.y;
    const boxes = g.col.query(this.pos.x + fx * 1.0 - 0.4, this.pos.z + fz * 1.0 - 0.4, this.pos.x + fx * 1.0 + 0.4, this.pos.z + fz * 1.0 + 0.4);
    for (const b of boxes) {
      const h = b.maxY - feet;
      if (h < 0.45 || h > 1.45) continue;
      // depth along facing direction
      const depth = Math.abs(fx) > Math.abs(fz) ? b.maxX - b.minX : b.maxZ - b.minZ;
      if (depth > 3.2) continue;
      const dist = 1.0 + depth + 0.6;
      const to = new THREE.Vector3(this.pos.x + fx * dist, 0, this.pos.z + fz * dist);
      // landing must be clear
      const probe = { x: to.x, z: to.z };
      const res = g.col.resolveCircle(probe, R, feet - 0.5, 0.45, feet + 1.7);
      if (res.hits && res.depth > 0.25) continue;
      to.y = Math.max(groundHeight(to.x, to.z), g.col.groundUnder(to.x, to.z, R, feet + 0.46));
      this.vault = { t: 0, dur: 0.48, from: this.pos.clone(), to, top: b.maxY };
      g.audio.whoosh();
      return true;
    }
    return false;
  }

  private updateFocus() {
    const g = this.g;
    let best: Interactable | Vehicle | null = null;
    let bd = Infinity;
    for (const it of g.interactables) {
      if (!it.enabled()) continue;
      const d = it.pos.distanceTo(this.pos);
      if (d < it.radius && d < bd) { bd = d; best = it; }
    }
    if (!best)
      for (const v of g.vehicles) {
        if (v.wrecked || v.driver === 'player') continue;
        const d = Math.hypot(v.pos.x - this.pos.x, v.pos.z - this.pos.z);
        if (d < 3.9 && d < bd) { bd = d; best = v; }
      }
    this.focus = best;
    if (!best) this.focusLabel = '';
    else if ('action' in best) this.focusLabel = best.label;
    else this.focusLabel = best.locked ? `Hold E: pick lock — ${best.label}` : best.isCop ? `Steal ${best.label.toLowerCase()}` : best.driver === 'traffic' ? `Carjack ${best.label.toLowerCase()}` : best.isGetaway ? 'Drive getaway car' : `${best.two ? 'Ride' : 'Drive'} ${best.label.toLowerCase()}`;
  }

  /** lock-pick progress 0..1 while E is held next to a locked vehicle */
  pick = 0;
  private pickTarget: Vehicle | null = null;

  private updatePick(dt: number) {
    const g = this.g;
    const t = this.pickTarget;
    if (!t) return;
    const near = Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z) < 4.2;
    if (!g.input.isDown('KeyE') || !near || this.speed > 1 || t.driver !== 'none') { this.pickTarget = null; this.pick = 0; return; }
    this.pick += dt / 1.4;
    this.heading = Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
    if (this.pick >= 1) {
      this.pickTarget = null;
      this.pick = 0;
      t.locked = false;
      g.audio.unlock();
      g.peds.witnessCrime(this.pos, 'car theft', 1);
      if (Math.random() < 0.25 && !t.two) { t.alarmT = 8; g.audio.carAlarm(t); g.hud.toast('CAR ALARM!', 'heat'); }
      this.enterVehicle(t);
    }
  }

  private interact() {
    const f = this.focus;
    if (!f) return;
    if ('action' in f) f.action();
    else if (f.locked) { this.pickTarget = f; this.pick = 0; }
    else this.enterVehicle(f);
  }

  enterVehicle(v: Vehicle) {
    const g = this.g;
    if (v.driver === 'traffic' || v.driver === 'cop') g.onCarjack(v);
    v.driver = 'player';
    v.siren = false;
    v.parked = false;
    v.alarmT = 0;
    this.vehicle = v;
    this.vx = this.vz = 0;
    v.locked = false;
    v.object.add(this.view.root);
    const d = v.parts.dims;
    // two-wheelers: rider sits on top (visible); cars: driver seat on the left
    if (d.two) this.view.root.position.set(0, d.wheelR + d.seatY, d.seatZ);
    else this.view.root.position.set(d.wid > 2.1 ? 0.55 : 0.38, d.seatY, d.seatZ);
    this.view.root.rotation.set(0, 0, 0);
    if (!d.two) g.audio.door();
    g.onEnterVehicle(v);
  }

  exitVehicle(force = false) {
    const v = this.vehicle;
    if (!v) return;
    if (!force && v.speedAbs > 6) return;
    const g = this.g;
    v.driver = 'none';
    v.throttle = 0;
    v.steer = 0;
    v.handbrake = true;
    v.object.remove(this.view.root);
    g.scene.add(this.view.root);
    this.vehicle = null;
    // driver door is on the car's left (+x local)
    const lx = Math.cos(v.heading), lz = -Math.sin(v.heading);
    for (const side of [1, -1]) {
      const x = v.pos.x + lx * 1.7 * side, z = v.pos.z + lz * 1.7 * side;
      const probe = { x, z };
      const res = g.col.resolveCircle(probe, R, 0.2, 0.45, 1.8);
      if (!res.hits || side === -1) {
        this.pos.set(probe.x, groundHeight(probe.x, probe.z), probe.z);
        break;
      }
    }
    this.heading = v.heading;
    this.vx = this.vz = this.vy = 0;
    if (!force) g.audio.door();
    this.syncView();
  }

  /** thrown off a bike/scooter on a hard hit */
  thrownOff(vx: number, vz: number) {
    if (!this.vehicle) return;
    this.exitVehicle(true);
    this.knockT = 1.6;
    this.vx = vx * 0.6;
    this.vz = vz * 0.6;
    this.g.camRig.addShake(0.6);
    this.g.hud.toast('THROWN OFF!', 'heat');
  }

  private drive(dt: number) {
    const g = this.g;
    const v = this.vehicle!;
    const inp = g.input;
    if (this.busted) {
      v.throttle = 0; v.steer = 0; v.handbrake = true;
      this.view.update(dt, v.two ? 'ride' : 'drive', 0);
      return;
    }
    v.throttle = inp.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
    v.steer = inp.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
    v.handbrake = inp.isDown('Space');
    v.boost = inp.isDown('ShiftLeft', 'ShiftRight');
    this.pos.copy(v.pos);
    this.heading = v.heading;
    this.view.update(dt, v.two ? 'ride' : 'drive', Math.abs(v.speed));
    if (inp.pressed('KeyE') && !g.hack.active) {
      if (g.carAction) g.carAction.action();
      else this.exitVehicle();
    }
    void clamp;
  }

  private syncView() {
    if (this.vehicle) return;
    this.view.root.position.copy(this.pos);
    this.view.root.rotation.y = this.heading;
  }
}
