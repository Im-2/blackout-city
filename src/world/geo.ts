// Minimal geometry builder: axis-aligned boxes/quads with world-scaled UVs and
// vertex colours, merged into one BufferGeometry per material bucket.
import * as THREE from 'three';
import { hexToRgb } from '../core/math';

export interface BoxOpts {
  /** metres per texture repeat (u, v); default 1x1 -> one repeat per metre */
  tile?: [number, number];
  /** UV offset (in repeats) to vary identical facades */
  uvOffset?: [number, number];
  color?: string | [number, number, number];
  /** skip faces: px nx py ny pz nz */
  skip?: Partial<Record<'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz', boolean>>;
  /** multiply colour on vertical faces facing away from the sun for cheap AO */
  shadeSides?: boolean;
}

export class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  skinIndex: number[] | null = null;
  private curBone = 0;

  get empty() {
    return this.idx.length === 0;
  }

  /** Enable rigid skinning: subsequent geometry binds to `bone`. */
  bone(i: number) {
    if (!this.skinIndex) this.skinIndex = [];
    this.curBone = i;
    return this;
  }

  quad(
    p0: number[], p1: number[], p2: number[], p3: number[],
    n: number[], u0: number, v0: number, u1: number, v1: number, c: [number, number, number],
  ) {
    const b = this.pos.length / 3;
    this.pos.push(...p0, ...p1, ...p2, ...p3);
    for (let i = 0; i < 4; i++) {
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(c[0], c[1], c[2]);
      if (this.skinIndex) this.skinIndex.push(this.curBone, 0, 0, 0);
    }
    this.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }

  /** Axis-aligned box from min/max corners. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, o: BoxOpts = {}) {
    const [tu, tv] = o.tile ?? [1, 1];
    const [ou, ov] = o.uvOffset ?? [0, 0];
    const c = typeof o.color === 'string' ? hexToRgb(o.color) : (o.color ?? [1, 1, 1]);
    const s = o.skip ?? {};
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;
    const sh = (m: number): [number, number, number] => (o.shadeSides ? [c[0] * m, c[1] * m, c[2] * m] : c);
    // +Z (front)
    if (!s.pz) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], ou, ov, ou + w / tu, ov + h / tv, sh(1));
    // -Z
    if (!s.nz) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], ou, ov, ou + w / tu, ov + h / tv, sh(0.92));
    // +X
    if (!s.px) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], ou, ov, ou + d / tu, ov + h / tv, sh(0.96));
    // -X
    if (!s.nx) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], ou, ov, ou + d / tu, ov + h / tv, sh(0.9));
    // +Y
    if (!s.py) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], ou, ov, ou + w / tu, ov + d / tv, c);
    // -Y
    if (!s.ny) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], 0, 0, w / tu, d / tv, sh(0.7));
    return this;
  }

  /** Box by centre + size. */
  cbox(cx: number, cy: number, cz: number, w: number, h: number, d: number, o: BoxOpts = {}) {
    return this.box(cx - w / 2, cy - h / 2, cz - d / 2, cx + w / 2, cy + h / 2, cz + d / 2, o);
  }

  /** Horizontal quad at height y (facing up). */
  floor(x0: number, z0: number, x1: number, z1: number, y: number, o: BoxOpts = {}) {
    const [tu, tv] = o.tile ?? [1, 1];
    const c = typeof o.color === 'string' ? hexToRgb(o.color) : (o.color ?? [1, 1, 1]);
    this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], x0 / tu, -z1 / tv, x1 / tu, -z0 / tv, c);
    return this;
  }

  /** Append another builder's geometry transformed by a matrix. */
  append(other: GeoBuilder, m: THREE.Matrix4) {
    const b = this.pos.length / 3;
    const v = new THREE.Vector3();
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    for (let i = 0; i < other.pos.length; i += 3) {
      v.set(other.pos[i], other.pos[i + 1], other.pos[i + 2]).applyMatrix4(m);
      this.pos.push(v.x, v.y, v.z);
      v.set(other.nor[i], other.nor[i + 1], other.nor[i + 2]).applyMatrix3(nm).normalize();
      this.nor.push(v.x, v.y, v.z);
    }
    this.uv.push(...other.uv);
    this.col.push(...other.col);
    for (const i of other.idx) this.idx.push(i + b);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.skinIndex) {
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skinIndex, 4));
      const w = new Float32Array(this.skinIndex.length);
      for (let i = 0; i < w.length; i += 4) w[i] = 1;
      g.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4));
    }
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
