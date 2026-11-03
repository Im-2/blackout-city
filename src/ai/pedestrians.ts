// Sidewalk crowds: walk block loops, panic from sirens/fast cars/hacks,
// get knocked by cars, get lured by car alarms.
import * as THREE from 'three';
import { Rng, damp, dampAngle } from '../core/math';
import { createCharacter } from '../characters/loader';
import { pedestrianSkin } from '../characters/skins';
import type { CharacterView, AnimState } from '../characters/rig';
import { groundHeight } from '../world/layout';
import type { Game } from '../core/game';

interface Ped {
  view: CharacterView;
  pos: THREE.Vector3;
  heading: number;
  loop: number;
  t: number; // param along loop perimeter
  dir: 1 | -1;
  speed: number;
  state: 'walk' | 'idle' | 'panic' | 'handsup' | 'lured' | 'knocked' | 'return';
  timer: number;
  vx: number;
  vz: number;
  goal: THREE.Vector3 | null;
  anim: AnimState;
}

const COUNT = 30;

export class Pedestrians {
  peds: Ped[] = [];
  private rng = new Rng(77);

  constructor(private g: Game) {}

  reset() {
    for (const p of this.peds) this.g.scene.remove(p.view.root);
    this.peds = [];
    const loops = this.g.city.pedLoops;
    for (let i = 0; i < COUNT; i++) {
      const skin = pedestrianSkin(this.rng, i);
      const view = createCharacter(i % 2 ? 'pedestrian2' : 'pedestrian1', skin);
      this.g.scene.add(view.root);
      // bias crowds toward the bank area and the centre
      const li = i < 8 ? [8, 13, 14, 7, 19, 15, 20, 9][i] : this.rng.int(0, loops.length - 1);
      const p: Ped = { view, pos: new THREE.Vector3(), heading: 0, loop: li, t: this.rng.next(), dir: this.rng.chance(0.5) ? 1 : -1, speed: this.rng.range(1.1, 1.6), state: 'walk', timer: this.rng.range(3, 12), vx: 0, vz: 0, goal: null, anim: 'walk' };
      this.loopPos(p, p.pos);
      this.peds.push(p);
    }
  }

  private loopPos(p: Ped, out: THREE.Vector3) {
    const L = this.g.city.pedLoops[p.loop];
    const w = L.x1 - L.x0, h = L.z1 - L.z0;
    const per = 2 * (w + h);
    let s = (((p.t % 1) + 1) % 1) * per;
    let x: number, z: number;
    if (s < w) { x = L.x0 + s; z = L.z0; }
    else if ((s -= w) < h) { x = L.x1; z = L.z0 + s; }
    else if ((s -= h) < w) { x = L.x1 - s; z = L.z1; }
    else { s -= w; x = L.x0; z = L.z1 - s; }
    return out.set(x, 0.15, z);
  }

  private perimeter(p: Ped) {
    const L = this.g.city.pedLoops[p.loop];
    return 2 * (L.x1 - L.x0 + L.z1 - L.z0);
  }

  /** scare everyone near a point */
  panic(pos: THREE.Vector3, radius: number, handsUp = false) {
    for (const p of this.peds) {
      if (p.state === 'knocked') continue;
      if (p.pos.distanceTo(pos) < radius) {
        p.state = handsUp ? 'handsup' : 'panic';
        p.timer = handsUp ? 2.5 : this.rng.range(3, 5);
        const dx = p.pos.x - pos.x, dz = p.pos.z - pos.z;
        const l = Math.hypot(dx, dz) || 1;
        p.goal = new THREE.Vector3(p.pos.x + (dx / l) * 14, 0, p.pos.z + (dz / l) * 14);
      }
    }
  }

  lure(pos: THREE.Vector3, radius = 40) {
    for (const p of this.peds) {
      if (p.state === 'knocked' || p.state === 'panic') continue;
      if (p.pos.distanceTo(pos) < radius) {
        p.state = 'lured';
        p.timer = this.rng.range(8, 12);
        const a = this.rng.range(0, Math.PI * 2);
        p.goal = new THREE.Vector3(pos.x + Math.cos(a) * 4, 0, pos.z + Math.sin(a) * 4);
      }
    }
  }

  /** a ped flees from a carjacked car */
  ejectDriver(pos: THREE.Vector3) {
    const p = this.peds.reduce((best, q) => (q.pos.distanceTo(this.g.player.pos) > best.pos.distanceTo(this.g.player.pos) ? q : best), this.peds[0]);
    if (!p) return;
    p.pos.copy(pos);
    p.state = 'panic';
    p.timer = 5;
    p.goal = new THREE.Vector3(pos.x + (Math.random() - 0.5) * 30, 0, pos.z + (Math.random() - 0.5) * 30);
  }

  update(dt: number) {
    const g = this.g;
    const P = g.player.worldPos;
    const tmp = new THREE.Vector3();
    for (const p of this.peds) {
      const d = p.pos.distanceTo(P);
      const near = d < 120;
      p.view.root.visible = near;
      if (!near) {
        // cheap far update: advance along loop only
        p.t += (p.dir * p.speed * dt) / this.perimeter(p);
        if (p.state === 'walk') this.loopPos(p, p.pos);
        continue;
      }
      // threats: fast cars, sirens nearby
      for (const v of g.vehicles) {
        const vd = Math.hypot(v.pos.x - p.pos.x, v.pos.z - p.pos.z);
        if (vd < 2.0 && v.speedAbs > 5 && p.state !== 'knocked') {
          p.state = 'knocked';
          p.timer = 3;
          p.vx = v.vx * 0.6 + (p.pos.x - v.pos.x) * 2;
          p.vz = v.vz * 0.6 + (p.pos.z - v.pos.z) * 2;
          g.audio.thud(0.5);
          g.fx.spawn('dust', p.pos.clone().setY(0.5), 6);
          if (v.driver === 'player') { g.camRig.addShake(0.15); g.onPedHit(p.pos); }
        } else if (vd < 9 && v.speedAbs > 12 && v.driver === 'player' && (p.state === 'walk' || p.state === 'idle')) {
          this.panic(p.pos, 0.1);
        }
      }
      let speed = 0, tx = p.pos.x, tz = p.pos.z;
      p.timer -= dt;
      switch (p.state) {
        case 'walk': {
          p.t += (p.dir * p.speed * dt) / this.perimeter(p);
          this.loopPos(p, tmp);
          tx = tmp.x; tz = tmp.z;
          speed = p.speed;
          if (p.timer < 0) { p.state = 'idle'; p.timer = this.rng.range(1.5, 4); }
          break;
        }
        case 'idle':
          if (p.timer < 0) { p.state = 'walk'; p.timer = this.rng.range(6, 16); if (this.rng.chance(0.2)) p.dir = p.dir === 1 ? -1 : 1; }
          break;
        case 'panic': case 'handsup':
          if (p.goal && p.state === 'panic') { tx = p.goal.x; tz = p.goal.z; speed = 5.2; }
          if (p.timer < 0) { p.state = 'return'; p.timer = 10; }
          break;
        case 'lured':
          if (p.goal) { tx = p.goal.x; tz = p.goal.z; speed = Math.hypot(tx - p.pos.x, tz - p.pos.z) > 1 ? 2.8 : 0; }
          if (p.timer < 0) { p.state = 'return'; p.timer = 10; }
          break;
        case 'knocked':
          p.vx = damp(p.vx, 0, 3, dt); p.vz = damp(p.vz, 0, 3, dt);
          p.pos.x += p.vx * dt; p.pos.z += p.vz * dt;
          if (p.timer < 0) { p.state = 'panic'; p.timer = 3; p.goal = new THREE.Vector3(p.pos.x + (Math.random() - 0.5) * 20, 0, p.pos.z + (Math.random() - 0.5) * 20); }
          break;
        case 'return': {
          this.loopPos(p, tmp);
          tx = tmp.x; tz = tmp.z; speed = 1.8;
          if (Math.hypot(tx - p.pos.x, tz - p.pos.z) < 1 || p.timer < 0) { p.state = 'walk'; p.pos.copy(tmp); }
          break;
        }
      }
      if (p.state !== 'knocked') {
        const dx = tx - p.pos.x, dz = tz - p.pos.z;
        const dl = Math.hypot(dx, dz);
        if (dl > 0.05 && speed > 0) {
          const step = Math.min(dl, speed * dt);
          p.pos.x += (dx / dl) * step;
          p.pos.z += (dz / dl) * step;
          p.heading = dampAngle(p.heading, Math.atan2(dx, dz), 10, dt);
        } else speed = 0;
        if (p.state !== 'walk') g.col.resolveCircle(p.pos, 0.3, p.pos.y, 0.45, p.pos.y + 1.7);
      }
      p.pos.y = groundHeight(p.pos.x, p.pos.z);
      p.anim = p.state === 'knocked' ? 'fall' : p.state === 'handsup' ? 'handsup' : p.state === 'panic' ? 'panic' : speed > 4 ? 'run' : speed > 0.3 ? 'walk' : 'idle';
      // only animate characters close enough to matter
      if (d < 70) p.view.update(dt, p.anim, speed);
      p.view.root.position.copy(p.pos);
      p.view.root.rotation.y = p.heading;
    }
  }
}
