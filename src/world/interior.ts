// Modular interior kit: rooms with door gaps, props, shelves, counters, stairs,
// colliders and walkable surfaces. Everything a kit builds is tracked so the
// whole interior can be streamed out (meshes disposed, colliders removed).
import * as THREE from 'three';
import { GeoBuilder } from './geo';
import { worldMaterials } from './materials';
import { Collision, AABB } from './collision';
import { surfaces, Surface } from './layout';
import { basicMat } from '../render/patch';

export type Side = 'n' | 's' | 'e' | 'w';
export interface DoorGap { side: Side; at: number; w: number; h?: number; }

export interface RoomOpts {
  y?: number; // floor height
  h?: number; // wall height
  wall?: string;
  floor?: string;
  floor2?: string; // checker
  doors?: DoorGap[];
  ceiling?: boolean;
  skip?: Side[]; // walls provided elsewhere (e.g. exterior shell)
  t?: number; // wall thickness
}

/** Collects geometry + colliders for one interior; `dispose()` undoes it all. */
export class Kit {
  props = new GeoBuilder();
  glow = new GeoBuilder();
  group = new THREE.Group();
  boxes: AABB[] = [];
  surfs: Surface[] = [];
  private built = false;

  constructor(private col: Collision) {}

  solid(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, occluder = true, tag = 'interior') {
    const b = this.col.add(x0, y0, z0, x1, y1, z1, occluder, tag);
    this.boxes.push(b);
    return b;
  }

  /** a box that is drawn and collides */
  block(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: string, occluder = false) {
    this.props.box(x0, y0, z0, x1, y1, z1, { color, shadeSides: true });
    return this.solid(x0, y0, z0, x1, y1, z1, occluder);
  }

  surface(s: Surface) {
    surfaces.push(s);
    this.surfs.push(s);
  }

  /** Axis-aligned room: floor, optional ceiling, four walls with door gaps. */
  room(x0: number, z0: number, x1: number, z1: number, o: RoomOpts = {}) {
    const y = o.y ?? 0.15, h = o.h ?? 3.6, t = o.t ?? 0.3;
    const wall = o.wall ?? '#b3a58c';
    const g = this.props;
    // floor (checker optional)
    if (o.floor2) {
      for (let x = x0; x < x1; x += 1.5)
        for (let z = z0; z < z1; z += 1.5) {
          const odd = (Math.round((x - x0) / 1.5) + Math.round((z - z0) / 1.5)) % 2;
          g.box(x, y - 0.05, z, Math.min(x + 1.5, x1), y, Math.min(z + 1.5, z1), { color: odd ? o.floor2 : o.floor ?? '#8a857c', skip: { ny: true } });
        }
    } else g.box(x0, y - 0.05, z0, x1, y, z1, { color: o.floor ?? '#8a857c', skip: { ny: true } });
    if (y > 0.2) {
      this.surface({ x0, z0, x1, z1, h0: y });
      this.solid(x0, y - 0.3, z0, x1, y - 0.05, z1, false, 'floor');
    }
    if (o.ceiling !== false) {
      const c = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(Math.PI / 2).translate((x0 + x1) / 2, y + h, (z0 + z1) / 2), worldMaterials().props);
      const col = new THREE.Color('#8c8576');
      const n = c.geometry.attributes.position.count;
      c.geometry.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => [col.r, col.g, col.b][i % 3]), 3));
      c.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
      this.group.add(c);
      // a few ceiling lights
      for (let x = x0 + 2.5; x < x1 - 1; x += 5) for (let z = z0 + 2.5; z < z1 - 1; z += 5) this.glow.cbox(x, y + h - 0.03, z, 1.4, 0.04, 0.4, { color: '#f0d9a0' });
    }
    const doors = o.doors ?? [];
    const sides: [Side, number, number, number][] = [
      ['n', x0, x1, z0], ['s', x0, x1, z1], ['w', z0, z1, x0], ['e', z0, z1, x1],
    ];
    for (const [side, a0, a1, fixed] of sides) {
      if (o.skip?.includes(side)) continue;
      const gaps = doors.filter((d) => d.side === side).sort((p, q) => p.at - q.at);
      let cur = a0;
      const seg = (s0: number, s1: number, yb = y, yt = y + h) => {
        if (s1 - s0 < 0.01) return;
        if (side === 'n' || side === 's') this.block(s0, yb, fixed - t / 2, s1, yt, fixed + t / 2, wall, true);
        else this.block(fixed - t / 2, yb, s0, fixed + t / 2, yt, s1, wall, true);
      };
      for (const d of gaps) {
        seg(cur, d.at - d.w / 2);
        seg(d.at - d.w / 2, d.at + d.w / 2, y + (d.h ?? 2.6), y + h); // lintel
        cur = d.at + d.w / 2;
      }
      seg(cur, a1);
    }
  }

  shelf(x0: number, z0: number, x1: number, z1: number, y = 0.15, h = 1.8, goods = true) {
    this.block(x0, y, z0, x1, y + h, z1, '#5a5f64', h > 1.6);
    if (!goods) return;
    const cols = ['#9b3b2f', '#c4a03c', '#3f7b88', '#d8d0bc', '#4f9a2e', '#c96a3a'];
    const along = x1 - x0 > z1 - z0;
    for (let lv = 0.35; lv < h - 0.1; lv += 0.45)
      for (let s = 0; s < (along ? x1 - x0 : z1 - z0) - 0.2; s += 0.32) {
        const c = cols[Math.floor((s * 7 + lv * 13) % cols.length)];
        if (along) {
          this.props.box(x0 + s + 0.05, y + lv, z0 - 0.04, x0 + s + 0.27, y + lv + 0.3, z0, { color: c });
          this.props.box(x0 + s + 0.05, y + lv, z1, x0 + s + 0.27, y + lv + 0.3, z1 + 0.04, { color: c });
        } else {
          this.props.box(x0 - 0.04, y + lv, z0 + s + 0.05, x0, y + lv + 0.3, z0 + s + 0.27, { color: c });
          this.props.box(x1, y + lv, z0 + s + 0.05, x1 + 0.04, y + lv + 0.3, z0 + s + 0.27, { color: c });
        }
      }
  }

  counter(x0: number, z0: number, x1: number, z1: number, y = 0.15, color = '#5b4330') {
    this.block(x0, y, z0, x1, y + 1.05, z1, color);
    this.props.box(x0 - 0.05, y + 1.05, z0 - 0.05, x1 + 0.05, y + 1.12, z1 + 0.05, { color: '#3b2c20' });
  }

  /** visual stairs only (players use ladders/elevators); kept for set dressing */
  stairs(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, steps = 10) {
    const dz = (z1 - z0) / steps, dy = (y1 - y0) / steps;
    for (let i = 0; i < steps; i++) this.props.box(x0, y0, z0 + dz * i, x1, y0 + dy * (i + 1), z0 + dz * (i + 1), { color: '#7a766d', shadeSides: true });
    this.surface({ x0, z0, x1, z1, h0: y0, h1: y1, axis: 'z' });
  }

  sign(text: string, x: number, y: number, z: number, heading: number, w = 6, h = 1.1, bg = '#1e2a36', fg = '#ffd27a') {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 24;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 128, 24);
    ctx.fillStyle = fg;
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 13);
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), basicMat({ map: tex }));
    m.position.set(x, y, z);
    m.rotation.y = heading;
    this.group.add(m);
    return m;
  }

  finish(scene: THREE.Scene) {
    if (this.built) return;
    this.built = true;
    if (!this.props.empty) {
      const m = new THREE.Mesh(this.props.build(), worldMaterials().props);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }
    if (!this.glow.empty) this.group.add(new THREE.Mesh(this.glow.build(), worldMaterials().glow));
    scene.add(this.group);
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.group);
    this.group.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
    for (const b of this.boxes) this.col.remove(b);
    for (const s of this.surfs) { const i = surfaces.indexOf(s); if (i >= 0) surfaces.splice(i, 1); }
    this.boxes = [];
    this.surfs = [];
  }
}
