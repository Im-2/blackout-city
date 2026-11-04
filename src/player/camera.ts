// Third-person camera: shoulder cam on foot, chase cam in cars with
// speed pull-back, FOV kick, trauma shake and wall collision.
import * as THREE from 'three';
import { clamp, damp, dampAngle, wrapAngle } from '../core/math';
import type { Game } from '../core/game';

const SENS = 0.0024;

export class CameraRig {
  yaw = Math.PI;
  pitch = -0.18;
  carView = 0;
  trauma = 0;
  fovKick = 0;
  private freeLook = 0;
  private dist = 4.2;
  private fov = 62;
  private target = new THREE.Vector3();
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private lead = new THREE.Vector3();
  private shakeT = 0;
  private wasCar = false;
  cinematic = false;

  constructor(private cam: THREE.PerspectiveCamera) {}

  addShake(a: number) {
    this.trauma = Math.min(1, this.trauma + a);
  }

  /** world-space forward of the camera on the ground plane */
  get forwardX() { return Math.sin(this.yaw); }
  get forwardZ() { return Math.cos(this.yaw); }

  snapBehind(heading: number) {
    this.yaw = heading;
  }

  update(dt: number, g: Game) {
    const inp = g.input;
    const v = g.player.vehicle;
    const mx = inp.lookX * SENS, my = inp.lookY * SENS;
    if (inp.pressed('carCamera') && v) this.carView = (this.carView + 1) % 3;
    this.shakeT += dt;

    let wantDist: number, height: number, fovTarget = 62, shoulder = 0;
    const rx0 = -Math.cos(this.yaw), rz0 = Math.sin(this.yaw);
    const tgt = this.target;
    if (v) {
      if (!this.wasCar) { this.yaw = v.heading; this.pitch = -0.12; }
      if (Math.abs(mx) + Math.abs(my) > 0.0005) this.freeLook = 1.6;
      this.freeLook -= dt;
      this.yaw -= mx;
      this.pitch = clamp(this.pitch - my, -0.9, 0.35);
      const sp = Math.abs(v.speed);
      if (this.freeLook <= 0) {
        // follow the velocity direction a little so drifts show the car's flank
        const velYaw = sp > 3 ? Math.atan2(v.vx, v.vz) : v.heading;
        const backwards = v.speed < -2;
        const desired = backwards ? v.heading : v.heading + wrapAngle(velYaw - v.heading) * 0.35;
        this.yaw = dampAngle(this.yaw, desired, 4.5, dt);
        this.pitch = damp(this.pitch, -0.14, 2, dt);
      }
      const views = [
        { d: 6.4, h: 1.9 },
        { d: 10.5, h: 3.6 },
        { d: 4.6, h: 0.9 },
      ];
      const vw = views[this.carView];
      wantDist = vw.d + sp * 0.07;
      height = vw.h;
      fovTarget = 64 + Math.min(16, sp * 0.42);
      tgt.set(v.pos.x, v.pos.y + 1.2, v.pos.z);
      this.lead.set(v.vx * 0.12, 0, v.vz * 0.12);
    } else {
      this.yaw -= mx;
      this.pitch = clamp(this.pitch - my, -1.15, 0.55);
      const p = g.player;
      const running = p.state === 'run';
      wantDist = running ? 4.7 : 4.1;
      if (g.hack.active) { wantDist = 3.3; fovTarget = 56; }
      height = 0;
      shoulder = 0.55;
      tgt.set(p.pos.x, p.pos.y + 1.55, p.pos.z);
      this.lead.set(0, 0, 0);
      if (g.ceilingAt(p.pos.x, p.pos.z, p.pos.y) < 50) wantDist = Math.min(wantDist, g.home.inHouse ? 2.7 : 3.4);
      // the shoulder offset must not start behind a wall
      const side = g.col.raycast(tgt.x, tgt.y, tgt.z, rx0, 0, rz0, shoulder + 0.25, true);
      if (side !== Infinity) shoulder = Math.max(0, side - 0.25);
    }
    this.wasCar = !!v;
    this.dist = damp(this.dist, wantDist, 5, dt);
    this.fovKick = damp(this.fovKick, 0, 4, dt);
    this.fov = damp(this.fov, fovTarget + this.fovKick, 6, dt);

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const fx = Math.sin(this.yaw) * cp, fy = sp, fz = Math.cos(this.yaw) * cp;
    const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
    const base = this.look.set(tgt.x + rx * shoulder, tgt.y + height, tgt.z + rz * shoulder);
    // desired camera pos
    let dx = -fx, dy = -fy, dz = -fz;
    const L = Math.hypot(dx, dy, dz);
    dx /= L; dy /= L; dz /= L;
    let dist = this.dist;
    const hit = g.col.raycast(base.x, base.y, base.z, dx, dy, dz, dist + 0.3);
    // on foot it may come right in rather than end up behind the wall
    if (hit !== Infinity) dist = Math.max(v ? 0.6 : 0.1, hit - 0.3);
    this.pos.set(base.x + dx * dist, base.y + dy * dist, base.z + dz * dist);
    if (!v) this.pos.y = Math.min(this.pos.y, g.ceilingAt(g.player.pos.x, g.player.pos.z, g.player.pos.y) - 0.4);
    this.pos.y = Math.max(this.pos.y, g.player.pos.y < -2 ? g.player.pos.y + 0.4 : 0.4);
    // keep the near plane off the walls in tight rooms
    if (g.home.inside) g.col.resolveCircle(this.pos, 0.2, this.pos.y - 0.1, 0, this.pos.y + 0.1, 0, true);
    // camera jammed against the player: don't film the inside of their head
    if (!g.player.hidden) g.player.view.root.visible = !!v || Math.hypot(this.pos.x - g.player.pos.x, this.pos.z - g.player.pos.z) > 0.55;

    // shake
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const s = this.trauma * this.trauma;
    const t = this.shakeT * 30;
    const ox = (Math.sin(t * 1.1) + Math.sin(t * 2.3)) * 0.18 * s;
    const oy = (Math.sin(t * 1.7) + Math.sin(t * 3.1)) * 0.18 * s;

    this.cam.position.set(this.pos.x + ox, this.pos.y + oy, this.pos.z);
    this.cam.lookAt(base.x + fx * 4 + this.lead.x + ox * 0.5, base.y + fy * 4 + oy * 0.5, base.z + fz * 4 + this.lead.z);
    this.cam.rotation.z += (Math.sin(t * 0.9) * 0.02 * s);
    if (Math.abs(this.cam.fov - this.fov) > 0.01) {
      this.cam.fov = this.fov;
      this.cam.updateProjectionMatrix();
    }
  }
}
