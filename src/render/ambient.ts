// Ambient life: pigeon flocks that scatter, steam from street vents,
// newspapers tumbling in the wind, litter on the sidewalks.
import * as THREE from 'three';
import { Rng } from '../core/math';
import { GeoBuilder } from '../world/geo';
import { worldMat } from './patch';
import { texNoise } from '../assets/textures';
import { BLOCKS, blockBounds, CURB_H } from '../world/layout';
import type { Game } from '../core/game';

interface Pigeon { hx: number; hz: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; flyT: number; heading: number; t: number; }
interface Paper { x: number; y: number; z: number; rx: number; rz: number; t: number; }

export class Ambient {
  private pigeons: Pigeon[] = [];
  private pigeonMesh: THREE.InstancedMesh;
  private papers: Paper[] = [];
  private paperMesh: THREE.InstancedMesh;
  private rng = new Rng(31);
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private steamT = 0;
  private wind = new THREE.Vector2(1.6, 0.7);

  constructor(private g: Game) {
    const mat = worldMat({ map: texNoise(), vertexColors: true });
    // pigeon: body + head + tail, wings flap via scale trick (separate instance not needed)
    const pg = new GeoBuilder();
    pg.cbox(0, 0.1, 0, 0.12, 0.1, 0.2, { color: '#7a7c84', shadeSides: true });
    pg.cbox(0, 0.17, 0.11, 0.07, 0.07, 0.07, { color: '#5a6a72' });
    pg.cbox(0, 0.16, 0.155, 0.03, 0.02, 0.03, { color: '#c08a4a' });
    pg.cbox(0, 0.11, -0.13, 0.08, 0.03, 0.08, { color: '#4a4c54' });
    pg.cbox(0.09, 0.12, 0, 0.08, 0.02, 0.12, { color: '#6a6c74' });
    pg.cbox(-0.09, 0.12, 0, 0.08, 0.02, 0.12, { color: '#6a6c74' });
    const MAXP = 90;
    this.pigeonMesh = new THREE.InstancedMesh(pg.build(), mat, MAXP);
    this.pigeonMesh.frustumCulled = false;
    g.scene.add(this.pigeonMesh);

    const paper = new GeoBuilder();
    paper.box(-0.22, 0, -0.16, 0.22, 0.01, 0.16, { color: '#d8d4c4' });
    paper.box(-0.18, 0.011, -0.1, 0.0, 0.012, 0.1, { color: '#9a968a' });
    this.paperMesh = new THREE.InstancedMesh(paper.build(), mat, 14);
    this.paperMesh.frustumCulled = false;
    g.scene.add(this.paperMesh);

    // litter: static instanced scraps
    const lit = new GeoBuilder();
    lit.box(-0.08, 0, -0.06, 0.08, 0.01, 0.06, { color: '#ffffff' });
    const nL = 320;
    const litter = new THREE.InstancedMesh(lit.build(), mat, nL);
    const c = new THREE.Color();
    for (let i = 0; i < nL; i++) {
      const bi = this.rng.int(0, BLOCKS - 1), bj = this.rng.int(0, BLOCKS - 1);
      const b = blockBounds(bi, bj);
      const edge = this.rng.int(0, 3);
      const t = this.rng.next();
      const x = edge < 2 ? b.x0 + (b.x1 - b.x0) * t : edge === 2 ? b.x0 + this.rng.range(0.2, 3.6) : b.x1 - this.rng.range(0.2, 3.6);
      const z = edge >= 2 ? b.z0 + (b.z1 - b.z0) * t : edge === 0 ? b.z0 + this.rng.range(0.2, 3.6) : b.z1 - this.rng.range(0.2, 3.6);
      this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.rng.range(0, 6));
      const sc = this.rng.range(0.6, 1.6);
      this.m.compose(this.v.set(x, CURB_H + 0.005, z), this.q, this.s.set(sc, 1, sc));
      litter.setMatrixAt(i, this.m);
      litter.setColorAt(i, c.set(this.rng.pick(['#c8c3b5', '#9b3b2f', '#c4a03c', '#5a6a72', '#e6e0d4', '#6b4a30'])));
    }
    litter.receiveShadow = true;
    g.scene.add(litter);
  }

  reset() {
    const g = this.g;
    const dens = g.quality.p.ambient;
    this.pigeons = [];
    // flocks near plazas, parks and food carts
    const spots = [...g.street.carts.map((c) => ({ x: c.x + 2.5, z: c.z + 1.5 })), ...g.street.chatSpots.slice(0, 6), ...g.city.benches.slice(0, 6)];
    let n = 0;
    for (const s of spots) {
      if (n > 85 * dens) break;
      const k = this.rng.int(3, 7);
      for (let i = 0; i < k; i++, n++) {
        const x = s.x + this.rng.range(-2.5, 2.5), z = s.z + this.rng.range(-2.5, 2.5);
        this.pigeons.push({ hx: x, hz: z, x, y: CURB_H, z, vx: 0, vy: 0, vz: 0, flyT: 0, heading: this.rng.range(0, 6.28), t: this.rng.range(0, 10) });
      }
    }
    this.papers = [];
    for (let i = 0; i < Math.round(14 * dens); i++) this.papers.push({ x: 0, y: 0.2, z: 0, rx: 0, rz: 0, t: 999 });
  }

  update(dt: number) {
    const g = this.g;
    const P = g.player.worldPos;
    const fast = g.player.vehicle ? g.player.vehicle.speedAbs : g.player.speed;
    // pigeons
    let i = 0;
    for (const p of this.pigeons) {
      p.t += dt;
      const d = Math.hypot(P.x - p.x, P.z - p.z);
      const scare = (d < (fast > 4 ? 9 : 4.5)) || (g.vehicles.some((v) => v.speedAbs > 5 && Math.abs(v.pos.x - p.x) < 4 && Math.abs(v.pos.z - p.z) < 4));
      if (p.flyT <= 0 && scare) {
        p.flyT = this.rng.range(5, 9);
        const a = Math.atan2(p.x - P.x, p.z - P.z) + this.rng.range(-0.8, 0.8);
        p.vx = Math.sin(a) * 6; p.vz = Math.cos(a) * 6; p.vy = this.rng.range(4, 6);
        p.heading = a;
        if (i % 4 === 0) g.audio.flutter(this.v.set(p.x, 1, p.z));
      }
      if (p.flyT > 0) {
        p.flyT -= dt;
        if (p.flyT > 2) { p.x += p.vx * dt; p.z += p.vz * dt; p.y = Math.min(14, p.y + p.vy * dt); p.vy *= 0.98; }
        else {
          // glide back home
          p.x += (p.hx - p.x) * dt * 1.2; p.z += (p.hz - p.z) * dt * 1.2; p.y += (CURB_H - p.y) * dt * 1.6;
          p.heading = Math.atan2(p.hx - p.x, p.hz - p.z);
          if (p.flyT <= 0) { p.y = CURB_H; }
        }
      } else if (Math.sin(p.t * 0.7 + p.hx) > 0.7) {
        p.heading += dt * 2;
        p.x += Math.sin(p.heading) * dt * 0.3; p.z += Math.cos(p.heading) * dt * 0.3;
      }
      if (d > 120) continue;
      const flying = p.flyT > 2 || p.y > CURB_H + 0.05;
      const peck = !flying && Math.sin(p.t * 6 + p.hz) > 0.6 ? 0.35 : 0;
      this.e.set(peck, p.heading, 0);
      this.q.setFromEuler(this.e);
      const flap = flying ? 1 + Math.sin(p.t * 40) * 0.8 : 1;
      this.m.compose(this.v.set(p.x, p.y, p.z), this.q, this.s.set(flap, 1, 1));
      this.pigeonMesh.setMatrixAt(i++, this.m);
    }
    this.pigeonMesh.count = i;
    this.pigeonMesh.instanceMatrix.needsUpdate = true;

    // newspapers tumble along the wind near the player
    let k = 0;
    for (const p of this.papers) {
      p.t += dt;
      if (p.t > 9 || Math.hypot(p.x - P.x, p.z - P.z) > 45) {
        const a = this.rng.range(0, Math.PI * 2), r = this.rng.range(8, 30);
        p.x = P.x + Math.cos(a) * r; p.z = P.z + Math.sin(a) * r; p.y = 0.2; p.t = 0;
      }
      const gust = 0.6 + Math.sin(p.t * 1.3 + p.x) * 0.6;
      p.x += this.wind.x * gust * dt; p.z += this.wind.y * gust * dt;
      p.y = 0.08 + Math.abs(Math.sin(p.t * 2.1 + p.z)) * 0.6 * gust;
      p.rx += dt * 3 * gust; p.rz += dt * 2.2 * gust;
      this.e.set(p.rx, p.t, p.rz);
      this.q.setFromEuler(this.e);
      this.m.compose(this.v.set(p.x, p.y + 0.1, p.z), this.q, this.s.set(1, 1, 1));
      this.paperMesh.setMatrixAt(k++, this.m);
    }
    this.paperMesh.count = k;
    this.paperMesh.instanceMatrix.needsUpdate = true;

    // steam from vents near the player
    this.steamT -= dt;
    if (this.steamT <= 0) {
      this.steamT = 0.12;
      for (const v of g.street.vents) {
        if (Math.hypot(v.x - P.x, v.z - P.z) > 70) continue;
        g.fx.spawn('steam', this.v.set(v.x + this.rng.range(-0.4, 0.4), 0.1, v.z + this.rng.range(-0.3, 0.3)), 1);
      }
    }
  }
}
