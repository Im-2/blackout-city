// Stunt ramps and jump spots in Park & Waterfront, on blocks reserved for them.
// A ramp is a walkable surface plus low collider slices, so you can ride up it but
// not through its side.
import * as THREE from 'three';
import { GeoBuilder } from '../world/geo';
import { Kit } from '../world/interior';
import { CURB_H, blockBounds, surfaces } from '../world/layout';
import { worldMaterials } from '../world/materials';
import type { Game } from '../core/game';

export class Stunts {
  private b = new GeoBuilder();

  constructor(private g: Game) {}

  /** wedge across (x0..x1, z0..z1), rising from h0 to h1 along `axis` in + direction */
  private ramp(x0: number, z0: number, x1: number, z1: number, axis: 'x' | 'z', h0: number, h1: number) {
    const g = this.g, b = this.b;
    surfaces.push({ x0, z0, x1, z1, h0, h1, axis });
    const len = axis === 'x' ? x1 - x0 : z1 - z0;
    const n = Math.max(2, Math.round(len / 2));
    const at = (t: number) => h0 + (h1 - h0) * t;
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n, y0 = at(t0), y1 = at(t1);
      const c: [number, number, number] = i % 2 ? [0.85, 0.47, 0.16] : [0.9, 0.78, 0.29];
      if (axis === 'z') {
        const a = z0 + len * t0, e = z0 + len * t1;
        b.quad([x0, y1, e], [x1, y1, e], [x1, y0, a], [x0, y0, a], [0, 1, 0], x0, a, x1, e, c);
        const s: [number, number, number] = [0.32, 0.31, 0.3];
        b.quad([x1, 0, a], [x1, 0, e], [x1, y1, e], [x1, y0, a], [1, 0, 0], a, 0, e, y1, s);
        b.quad([x0, 0, e], [x0, 0, a], [x0, y0, a], [x0, y1, e], [-1, 0, 0], a, 0, e, y1, s);
      } else {
        const a = x0 + len * t0, e = x0 + len * t1;
        b.quad([a, y0, z1], [e, y1, z1], [e, y1, z0], [a, y0, z0], [0, 1, 0], a, z0, e, z1, c);
        const s: [number, number, number] = [0.32, 0.31, 0.3];
        b.quad([a, 0, z1], [e, 0, z1], [e, y1, z1], [a, y0, z1], [0, 0, 1], a, 0, e, y1, s);
        b.quad([e, 0, z0], [a, 0, z0], [a, y0, z0], [e, y1, z0], [0, 0, -1], a, 0, e, y1, s);
      }
    }
    // the tall end's face
    const top = Math.max(h0, h1), low = h1 > h0 ? 1 : 0;
    if (axis === 'z') {
      const z = low ? z1 : z0;
      b.quad(low ? [x1, 0, z] : [x0, 0, z], low ? [x0, 0, z] : [x1, 0, z], low ? [x0, top, z] : [x1, top, z], low ? [x1, top, z] : [x0, top, z], [0, 0, low ? 1 : -1], 0, 0, 1, 1, [0.32, 0.31, 0.3]);
    } else {
      const x = low ? x1 : x0;
      b.quad(low ? [x, 0, z1] : [x, 0, z0], low ? [x, 0, z0] : [x, 0, z1], low ? [x, top, z0] : [x, top, z1], low ? [x, top, z1] : [x, top, z0], [low ? 1 : -1, 0, 0], 0, 0, 1, 1, [0.32, 0.31, 0.3]);
    }
    // collider slices just under the surface
    const step = 0.6;
    for (let s = 0; s < len - 0.001; s += step) {
      const e = Math.min(len, s + step);
      const h = Math.max(at(s / len), at(e / len)) - 0.08;
      if (h < 0.35) continue;
      if (axis === 'z') g.col.add(x0, 0, z0 + s, x1, h, z0 + e, false, 'ramp');
      else g.col.add(x0 + s, 0, z0, x0 + e, h, z1, false, 'ramp');
    }
  }

  private floor(bi: number, bj: number, color: string) {
    const lot = blockBounds(bi, bj);
    this.b.box(lot.x0 + 4, CURB_H - 0.02, lot.z0 + 4, lot.x1 - 4, CURB_H + 0.012, lot.z1 - 4, { color, skip: { ny: true } });
    return lot;
  }

  private tyres(x: number, z: number) {
    for (let i = 0; i < 3; i++) this.b.cbox(x, CURB_H + 0.14 + i * 0.26, z, 0.9, 0.24, 0.9, { color: i % 2 ? '#e6e0d4' : '#1e1e20', shadeSides: true });
    this.g.col.addCentered(x, z, 0.9, 0.9, 0.9, 0, false, 'tyres');
  }

  private cone(x: number, z: number) {
    this.b.cbox(x, CURB_H + 0.3, z, 0.22, 0.6, 0.22, { color: '#d8782a' });
    this.b.cbox(x, CURB_H + 0.02, z, 0.42, 0.04, 0.42, { color: '#3a3c3e' });
  }

  build() {
    const g = this.g;
    const signs = new Kit(g.col);

    // Run-ups: every block in these rows has a clear path through its middle, so the
    // main ramps line up with the path in the next block along.

    // ---- Stunt Park, block (6,10): the big gap can be ridden from either side
    {
      const L = this.floor(6, 10, '#6e6b64');
      const cx = (L.x0 + L.x1) / 2, cz = (L.z0 + L.z1) / 2, W = 5;
      this.ramp(cx - 15, cz - W, cx - 5, cz + W, 'x', CURB_H, 2.0);
      this.ramp(cx + 5, cz - W, cx + 15, cz + W, 'x', 2.0, CURB_H);
      // side kickers off Shore-side, either end
      for (const x of [L.x0 + 8, L.x1 - 8]) this.ramp(x - 3, L.z1 - 13, x + 3, L.z1 - 5, 'z', 1.3, CURB_H);
      // rollers to link wheelies along the north side
      for (const x of [cx - 12, cx - 3, cx + 6]) {
        this.ramp(x, L.z0 + 6, x + 2.5, L.z0 + 12, 'x', CURB_H, 0.42);
        this.ramp(x + 2.5, L.z0 + 6, x + 5, L.z0 + 12, 'x', 0.42, CURB_H);
      }
      for (const [x, z] of [[L.x0 + 5, L.z0 + 5], [L.x1 - 5, L.z0 + 5], [L.x0 + 5, L.z1 - 3], [L.x1 - 5, L.z1 - 3]]) this.tyres(x, z);
      for (let i = 0; i < 5; i++) { this.cone(cx - 3 + i * 1.5, cz - W - 1); this.cone(cx - 3 + i * 1.5, cz + W + 1); }
      // welcome arch
      for (const x of [L.x0 + 3, L.x1 - 3]) this.b.cbox(x, 3.2, L.z0 + 2.8, 0.25, 6.4, 0.25, { color: '#3a3c3e' });
      signs.sign('STUNT PARK', cx, 5.8, L.z0 + 2.8, Math.PI, 12, 1.6, '#d8782a', '#fff1c0');
      // the scoreboard
      this.b.box(L.x0 + 14, CURB_H, L.z0 + 3.2, L.x0 + 18, CURB_H + 2.4, L.z0 + 3.5, { color: '#2a2c30', shadeSides: true });
      signs.sign('HIGH SCORES', L.x0 + 16, CURB_H + 1.8, L.z0 + 3.54, 0, 3.6, 0.6, '#1e2a36', '#ffd27a');
      g.col.add(L.x0 + 14, 0, L.z0 + 3.2, L.x0 + 18, 2.6, L.z0 + 3.5, false, 'board');
      g.interactables.push({ pos: new THREE.Vector3(L.x0 + 16, CURB_H, L.z0 + 4.4), radius: 1.8, label: 'Read the high scores', enabled: () => !g.player.vehicle, action: () => g.homeUi.open(['records'], 'HIGH SCORES') });
      g.activities.add({ id: 'stunt-park', name: 'Stunt Park', type: 'stunt', x: cx, z: L.z0 + 2, pin: true, intro: 'Ride the park path from the west or east for a run-up at the big gap. Hold F to wheelie, F + S to stoppie. In the air, A/D spins and F + W or S flips. Chain tricks and land straight.' });
    }

    // ---- Long Jump, block (4,10): run up the path from the west, distance boards after
    {
      const L = this.floor(4, 10, '#566a38');
      const cz = (L.z0 + L.z1) / 2;
      this.ramp(L.x0 + 5, cz - 4, L.x0 + 17, cz + 4, 'x', CURB_H, 2.6);
      this.b.box(L.x0 + 5, CURB_H, cz - 4.2, L.x1 - 4, CURB_H + 0.012, cz + 4.2, { color: '#8a8478' });
      for (let i = 1; i <= 4; i++) {
        const x = L.x0 + 17 + i * 5;
        this.b.box(x, CURB_H + 0.012, cz - 4.2, x + 0.25, CURB_H + 0.02, cz + 4.2, { color: '#e6e0d4' });
      }
      signs.sign('LONG JUMP', L.x0 + 3, 4.6, cz, -Math.PI / 2, 6, 1.1, '#2f3b4d', '#ffd27a');
      for (const z of [cz - 3.2, cz + 3.2]) this.b.cbox(L.x0 + 3, 2.2, z, 0.2, 4.4, 0.2, { color: '#3a3c3e' });
      g.activities.add({ id: 'long-jump', name: 'Long Jump', type: 'stunt', tag: 'J', x: L.x0 + 2, z: cz, intro: 'One long ramp and distance boards. Come along the park path from the west, flat out. Air time scores.' });
    }

    // ---- Shore Leap, block (3,11): run up the path from the north, fly at the highway
    {
      const L = this.floor(3, 11, '#566a38');
      const cx = (L.x0 + L.x1) / 2;
      this.ramp(cx - 4, L.z0 + 12, cx + 4, L.z0 + 24, 'z', CURB_H, 2.4);
      for (let i = 0; i < 3; i++) { this.cone(cx - 5, L.z0 + 4 + i * 4); this.cone(cx + 5, L.z0 + 4 + i * 4); }
      signs.sign('SHORE LEAP', cx, 3.8, L.z0 + 2.8, Math.PI, 6, 1.1, '#2f3b4d', '#ffd27a');
      for (const x of [cx - 3.2, cx + 3.2]) this.b.cbox(x, 1.8, L.z0 + 2.8, 0.2, 3.6, 0.2, { color: '#3a3c3e' });
      g.activities.add({ id: 'shore-leap', name: 'Shore Leap', type: 'stunt', tag: 'J', x: cx, z: L.z0 + 2, intro: 'This one points at the highway. Come down the park path from the north and mind the traffic when you land. Spin on the way over for the big numbers.' });
    }

    const m = new THREE.Mesh(this.b.build(), worldMaterials().props);
    m.castShadow = true;
    m.receiveShadow = true;
    g.scene.add(m);
    signs.finish(g.scene);
    return this;
  }
}
