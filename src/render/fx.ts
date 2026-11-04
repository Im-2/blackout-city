// Pixel-cube particles (one InstancedMesh), hack beams, shockwave rings.
import * as THREE from 'three';
import { basicMat } from './patch';

const MAX = 700;

interface P {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number; size: number; grow: number;
  g: number; drag: number;
  r: number; gc: number; b: number;
  spin: number;
}

export type FxKind = 'spark' | 'smoke' | 'debris' | 'hack' | 'glass' | 'dust' | 'fire' | 'money' | 'steam' | 'rain' | 'paint';

export class Fx {
  mesh: THREE.InstancedMesh;
  private ps: P[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  beams: { line: THREE.Line; t: number; max: number; from: THREE.Vector3; to: THREE.Vector3 }[] = [];
  rings: { mesh: THREE.Mesh; t: number; max: number; r0: number; r1: number }[] = [];
  private ringGeo = new THREE.RingGeometry(0.92, 1, 48).rotateX(-Math.PI / 2);

  constructor(private scene: THREE.Scene, private overlay: THREE.Scene) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), basicMat({ color: 0xffffff }), MAX);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  spawn(kind: FxKind, pos: THREE.Vector3, count: number, dir?: THREE.Vector3, power = 1, color?: string) {
    for (let i = 0; i < count; i++) {
      if (this.ps.length >= MAX) this.ps.shift();
      const R = () => Math.random() * 2 - 1;
      const p: P = { x: pos.x, y: pos.y, z: pos.z, vx: R(), vy: Math.random(), vz: R(), life: 0, max: 1, size: 0.1, grow: 0, g: -9, drag: 1, r: 1, gc: 1, b: 1, spin: R() * 8 };
      const d = dir ?? this.v.set(0, 0, 0);
      switch (kind) {
        case 'spark': {
          const sp = 6 * power;
          p.vx = R() * sp + d.x * 4; p.vy = Math.random() * sp; p.vz = R() * sp + d.z * 4;
          p.max = 0.35 + Math.random() * 0.3; p.size = 0.07; p.g = -14;
          this.c.set(Math.random() < 0.6 ? '#ffd27a' : '#fff4c0'); break;
        }
        case 'hack': {
          const sp = 4 * power;
          p.vx = R() * sp; p.vy = Math.random() * sp * 0.8; p.vz = R() * sp;
          p.max = 0.5 + Math.random() * 0.5; p.size = 0.1; p.g = -2; p.drag = 3;
          this.c.set(Math.random() < 0.7 ? '#46e6ff' : '#e0ffff'); break;
        }
        case 'smoke': {
          p.vx = R() * 0.6 + d.x; p.vy = 1 + Math.random() * 1.5; p.vz = R() * 0.6 + d.z;
          p.max = 1.2 + Math.random(); p.size = 0.35; p.grow = 0.9; p.g = 0.5; p.drag = 1.5;
          const g = 0.25 + Math.random() * 0.2; this.c.setRGB(g, g, g * 1.05); break;
        }
        case 'fire': {
          p.vx = R() * 0.5; p.vy = 1.5 + Math.random() * 2; p.vz = R() * 0.5;
          p.max = 0.4 + Math.random() * 0.4; p.size = 0.3; p.grow = -0.5; p.g = 2;
          this.c.set(Math.random() < 0.5 ? '#ff7a1a' : '#ffc040'); break;
        }
        case 'debris': {
          const sp = 5 * power;
          p.vx = R() * sp + d.x * sp; p.vy = 2 + Math.random() * sp; p.vz = R() * sp + d.z * sp;
          p.max = 0.9 + Math.random() * 0.6; p.size = 0.12 + Math.random() * 0.12; p.g = -18;
          this.c.set(Math.random() < 0.5 ? '#3a3a3a' : '#6a6660'); break;
        }
        case 'glass': {
          const sp = 4 * power;
          p.vx = R() * sp + d.x * 3; p.vy = 1 + Math.random() * sp; p.vz = R() * sp + d.z * 3;
          p.max = 0.7; p.size = 0.07; p.g = -16;
          this.c.set('#9fc4d0'); break;
        }
        case 'dust': {
          p.vx = R() * 1.5 + d.x; p.vy = Math.random() * 0.8; p.vz = R() * 1.5 + d.z;
          p.max = 0.6 + Math.random() * 0.5; p.size = 0.2; p.grow = 0.6; p.g = 0.3; p.drag = 2.5;
          this.c.set('#6e6a62'); break;
        }
        case 'steam': {
          p.vx = R() * 0.3 + 0.4; p.vy = 1.2 + Math.random() * 0.8; p.vz = R() * 0.3 + 0.2;
          p.max = 1.6 + Math.random(); p.size = 0.3; p.grow = 1.1; p.g = 0.4; p.drag = 1.2;
          const g = 0.2 + Math.random() * 0.08; this.c.setRGB(g, g, g * 1.04); break;
        }
        case 'paint': {
          const sp = 3 * power;
          p.vx = R() * sp; p.vy = Math.random() * sp; p.vz = R() * sp;
          p.max = 0.8; p.size = 0.12; p.g = -6; p.drag = 2;
          this.c.set('#c96a3a'); break;
        }
        case 'money': {
          p.vx = R() * 2; p.vy = 2 + Math.random() * 3; p.vz = R() * 2;
          p.max = 1.4; p.size = 0.12; p.g = -4; p.drag = 1.8;
          this.c.set(Math.random() < 0.5 ? '#7fae5a' : '#d9b04a'); break;
        }
      }
      if (color) this.c.set(color);
      p.r = this.c.r; p.gc = this.c.g; p.b = this.c.b;
      this.ps.push(p);
    }
  }

  /** Cyan "data beam" from a to b drawn on top of everything (overlay). */
  beam(from: THREE.Vector3, to: THREE.Vector3, color = '#46e6ff') {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) pts.push(new THREE.Vector3());
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, depthTest: false }));
    line.frustumCulled = false;
    this.overlay.add(line);
    this.beams.push({ line, t: 0, max: 0.45, from: from.clone(), to: to.clone() });
  }

  ring(pos: THREE.Vector3, r1: number, color = '#46e6ff', dur = 0.9) {
    const mesh = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.rings.push({ mesh, t: 0, max: dur, r0: 0.5, r1 });
  }

  update(dt: number) {
    let n = 0;
    for (let i = this.ps.length - 1; i >= 0; i--) {
      const p = this.ps[i];
      p.life += dt;
      if (p.life >= p.max) { this.ps.splice(i, 1); continue; }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vz *= k; p.vy = p.vy * k + p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.05) { p.y = 0.05; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
    }
    for (const p of this.ps) {
      const f = p.life / p.max;
      const sz = Math.max(0.001, p.size * (1 + p.grow * f * 3) * (p.grow >= 0 ? 1 - f * 0.4 : 1 - f));
      this.e.set(p.life * p.spin, p.life * p.spin * 0.7, 0);
      this.q.setFromEuler(this.e);
      this.m.compose(this.v.set(p.x, p.y, p.z), this.q, this.s.set(sz, sz, sz));
      this.mesh.setMatrixAt(n, this.m);
      this.c.setRGB(p.r, p.gc, p.b);
      this.mesh.setColorAt(n, this.c);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.t += dt;
      const f = Math.min(1, b.t / (b.max * 0.5));
      const pos = b.line.geometry.attributes.position as THREE.BufferAttribute;
      for (let j = 0; j <= 12; j++) {
        const t = (j / 12) * f;
        const jit = j > 0 && j < 12 ? 0.25 : 0;
        pos.setXYZ(j,
          b.from.x + (b.to.x - b.from.x) * t + (Math.random() - 0.5) * jit,
          b.from.y + (b.to.y - b.from.y) * t + Math.sin(t * Math.PI) * 1.2 + (Math.random() - 0.5) * jit,
          b.from.z + (b.to.z - b.from.z) * t + (Math.random() - 0.5) * jit);
      }
      pos.needsUpdate = true;
      (b.line.material as THREE.LineBasicMaterial).opacity = 1 - Math.max(0, (b.t - b.max * 0.5) / (b.max * 0.5));
      if (b.t >= b.max) { this.overlay.remove(b.line); b.line.geometry.dispose(); this.beams.splice(i, 1); }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const f = r.t / r.max;
      const s = r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - f, 3));
      r.mesh.scale.set(s, 1, s);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - f;
      if (f >= 1) { this.scene.remove(r.mesh); this.rings.splice(i, 1); }
    }
  }
}
