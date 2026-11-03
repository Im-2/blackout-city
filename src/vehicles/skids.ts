// Skid marks: ring buffer of instanced dark quads laid behind sliding rear wheels.
import * as THREE from 'three';
import type { Vehicle } from './vehicle';

const MAX = 900;

export class Skids {
  mesh: THREE.InstancedMesh;
  private i = 0;
  private last = new Map<number, [number, number, number, number] | null>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x141414, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.frustumCulled = false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let k = 0; k < MAX; k++) this.mesh.setMatrixAt(k, zero);
    scene.add(this.mesh);
  }

  update(vs: Vehicle[]) {
    let dirty = false;
    for (const v of vs) {
      if (!v.skidding || v.pos.y > 0.1) { this.last.set(v.id, null); continue; }
      const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
      const rx = Math.cos(v.heading), rz = -Math.sin(v.heading);
      const back = -v.parts.dims.wheelBase / 2, tr = v.parts.dims.track / 2;
      const lx = v.pos.x + fx * back + rx * tr, lz = v.pos.z + fz * back + rz * tr;
      const qx = v.pos.x + fx * back - rx * tr, qz = v.pos.z + fz * back - rz * tr;
      const prev = this.last.get(v.id);
      if (prev) {
        this.seg(prev[0], prev[1], lx, lz);
        this.seg(prev[2], prev[3], qx, qz);
        dirty = true;
      }
      this.last.set(v.id, [lx, lz, qx, qz]);
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }

  private seg(x0: number, z0: number, x1: number, z1: number) {
    const dx = x1 - x0, dz = z1 - z0;
    const L = Math.hypot(dx, dz);
    if (L < 0.05 || L > 4) return;
    this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(dx, dz));
    this.m.compose(this.v.set((x0 + x1) / 2, 0.025, (z0 + z1) / 2), this.q, this.s.set(0.28, 1, L + 0.05));
    this.mesh.setMatrixAt(this.i, this.m);
    this.i = (this.i + 1) % MAX;
  }
}
