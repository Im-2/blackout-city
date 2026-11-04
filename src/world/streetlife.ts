// Street furniture that gives the crowd things to do: food carts, ATMs,
// bus stops, cell towers (hackable), steam vents, chat/busker spots.
import * as THREE from 'three';
import { PAL } from '../core/palette';
import { Rng } from '../core/math';
import { GeoBuilder } from './geo';
import { BLOCKS, CURB_H, blockBounds, BANK_BLOCK } from './layout';
import type { City } from './city';
import { districtOfBlock } from '../map/districts';
import type { Collision } from './collision';

export interface Spot { x: number; z: number; heading: number; }
export interface CartSpot extends Spot { queue: Spot[]; kind: 'food' | 'coffee'; }

export class StreetLife {
  carts: CartSpot[] = [];
  atms: (Spot & { queue: Spot[] })[] = [];
  busStops: Spot[] = [];
  towers: { x: number; z: number; disabledT: number }[] = [];
  vents: { x: number; z: number }[] = [];
  chatSpots: Spot[] = [];
  buskerSpots: Spot[] = [];
  guardSpots: Spot[] = [];
  group = new THREE.Group();
  private g!: GeoBuilder;
  private rng = new Rng(2024);

  constructor(private city: City, private col: Collision) {}

  build() {
    const r = this.rng;
    const reserved = (bi: number, bj: number) => (bi === BANK_BLOCK[0] && bj === BANK_BLOCK[1]) || this.city.reserved.has(bj * BLOCKS + bi);
    for (let bj = 0; bj < BLOCKS; bj++)
      for (let bi = 0; bi < BLOCKS; bi++) {
        const b = blockBounds(bi, bj);
        const L = b.x1 - b.x0;
        if (!reserved(bi, bj) && r.chance(0.32)) this.cart(b.x0 + L * r.range(0.35, 0.65), b.z1 - 2.6, 0);
        if (r.chance(0.5)) this.chatSpots.push({ x: b.x0 + L * r.range(0.2, 0.8), z: b.z0 + 2.2, heading: 0 });
        if (r.chance(0.5)) this.chatSpots.push({ x: b.x1 - 2.2, z: b.z0 + L * r.range(0.2, 0.8), heading: 0 });
        if (r.chance(0.18)) this.buskerSpots.push({ x: b.x0 + 2.4, z: b.z0 + 2.4, heading: Math.PI * 0.75 });
        if (r.chance(0.35)) this.vents.push({ x: b.x0 + L * r.range(0.2, 0.8), z: b.z0 - 3.5 });
        // bus stop on the south curb of every other block
        if ((bi + bj) % 2 === 0 && !reserved(bi, bj) && districtOfBlock(bi, bj) !== 'docks') this.busStop(b.x0 + L * 0.82, b.z1 - 1.2);
      }
    // ATMs beside some building doors
    const doors = [...this.city.doors].sort(() => r.next() - 0.5).slice(0, 34);
    for (const d of doors) this.atm(d);
    // cell towers (hackable: kills witness calls in range)
    for (const [bi, bj] of [[3, 3], [7, 4], [5, 7], [8, 6], [1, 1], [10, 2], [1, 8], [10, 9], [6, 10], [5, 1]]) {
      const b = blockBounds(bi, bj);
      this.tower(b.x0 + 2.0, b.z1 - 2.0);
    }
    // tower guards at tall plinth doors
    for (const d of this.city.doors.filter((_, i) => i % 9 === 0).slice(0, 14)) this.guardSpots.push({ x: d.x + Math.sin(d.heading) * 1.2 + Math.cos(d.heading) * 1.5, z: d.z + Math.cos(d.heading) * 1.2 - Math.sin(d.heading) * 1.5, heading: d.heading });
    // vent grates are flat decals
    for (const v of this.vents) {
      const vg = this.city.propsAt(v.x, v.z);
      vg.box(v.x - 0.7, 0, v.z - 0.45, v.x + 0.7, 0.03, v.z + 0.45, { color: '#2a2a28' });
      for (let i = -0.55; i < 0.6; i += 0.22) vg.box(v.x + i, 0.03, v.z - 0.38, v.x + i + 0.1, 0.035, v.z + 0.38, { color: '#4a4844' });
    }
    return this;
  }

  private cart(x: number, z: number, heading: number) {
    const g = (this.g = this.city.propsAt(x, z));
    const kind = this.rng.chance(0.5) ? 'food' : 'coffee';
    const body = kind === 'food' ? '#9b3b2f' : '#2f4a32';
    g.box(x - 1.1, CURB_H + 0.35, z - 0.55, x + 1.1, CURB_H + 1.15, z + 0.55, { color: body, shadeSides: true });
    g.box(x - 1.15, CURB_H + 1.15, z - 0.6, x + 1.15, CURB_H + 1.22, z + 0.6, { color: '#8a8a84' });
    for (const sx of [-0.9, 0.9]) g.cbox(x + sx, CURB_H + 0.2, z + 0.4, 0.1, 0.4, 0.4, { color: PAL.tyre });
    g.cbox(x - 0.8, CURB_H + 1.35, z, 0.4, 0.25, 0.4, { color: '#c8c3b5' }); // pot / machine
    g.cbox(x, CURB_H + 1.9, z, 0.06, 1.4, 0.06, { color: PAL.metal });
    g.cbox(x, CURB_H + 2.6, z, 2.6, 0.12, 2.0, { color: kind === 'food' ? '#c8b48a' : '#d8d0bc' }); // umbrella
    g.cbox(x, CURB_H + 2.5, z, 2.4, 0.1, 1.8, { color: kind === 'food' ? '#9b3b2f' : '#4a5b39' });
    this.col.addCentered(x, z, 2.2, 1.1, 1.3, 0, false, 'prop');
    const fx = Math.sin(heading + Math.PI), fz = Math.cos(heading + Math.PI);
    const queue: Spot[] = [0, 1, 2].map((i) => ({ x: x + fx * (1.6 + i * 0.9) + (i % 2) * 0.2, z: z + fz * (1.6 + i * 0.9), heading }));
    this.carts.push({ x: x - fx * 1.0, z: z - fz * 1.0, heading: heading + Math.PI, queue, kind });
  }

  private atm(d: { x: number; z: number; heading: number }) {
    const fx = Math.sin(d.heading), fz = Math.cos(d.heading);
    const sx = Math.cos(d.heading), sz = -Math.sin(d.heading);
    const x = d.x - fx * 0.7 + sx * 2.4, z = d.z - fz * 0.7 + sz * 2.4;
    const g = (this.g = this.city.propsAt(x, z));
    g.cbox(x, CURB_H + 0.9, z, Math.abs(fz) * 0.8 + Math.abs(fx) * 0.35, 1.8, Math.abs(fx) * 0.8 + Math.abs(fz) * 0.35, { color: '#5a5f64', shadeSides: true });
    g.cbox(x + fx * 0.18, CURB_H + 1.3, z + fz * 0.18, Math.abs(fz) * 0.5 + 0.02, 0.35, Math.abs(fx) * 0.5 + 0.02, { color: '#3a8a9a' });
    g.cbox(x + fx * 0.18, CURB_H + 1.75, z + fz * 0.18, Math.abs(fz) * 0.7 + 0.02, 0.12, Math.abs(fx) * 0.7 + 0.02, { color: PAL.cyan });
    const queue: Spot[] = [0, 1].map((i) => ({ x: x + fx * (0.9 + i * 0.9), z: z + fz * (0.9 + i * 0.9), heading: d.heading + Math.PI }));
    this.atms.push({ x, z, heading: d.heading, queue });
  }

  private busStop(x: number, z: number) {
    const g = (this.g = this.city.propsAt(x, z));
    g.box(x - 2.0, CURB_H, z - 0.1, x + 2.0, CURB_H + 2.5, z + 0.0, { color: '#6a7a80' });
    g.box(x - 2.1, CURB_H + 2.5, z - 0.8, x + 2.1, CURB_H + 2.62, z + 0.2, { color: '#3a3c3e' });
    for (const sx of [-1.95, 1.95]) g.cbox(x + sx, CURB_H + 1.25, z - 0.3, 0.1, 2.5, 0.1, { color: PAL.metal });
    g.box(x - 1.6, CURB_H + 0.45, z - 0.7, x + 1.6, CURB_H + 0.55, z - 0.3, { color: '#6b4a30' });
    g.box(x - 0.5, CURB_H + 1.0, z + 0.0, x + 0.5, CURB_H + 2.1, z + 0.05, { color: '#c4a03c' }); // ad panel
    this.col.add(x - 2.0, 0, z - 0.15, x + 2.0, 2.6, z + 0.05, false, 'prop');
    this.busStops.push({ x, z: z - 0.5, heading: Math.PI });
    this.city.benches.push({ x, z: z - 0.5, yaw: Math.PI });
  }

  private tower(x: number, z: number) {
    const g = (this.g = this.city.propsAt(x, z));
    const H = 22;
    g.cbox(x, CURB_H + 0.3, z, 2.2, 0.6, 2.2, { color: '#7a766d' });
    for (let y = 0.6; y < H; y += 2) {
      const w = 1.4 - (y / H) * 0.8;
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.cbox(x + sx * w / 2, CURB_H + y + 1, z + sz * w / 2, 0.1, 2, 0.1, { color: '#8a8a84' });
      g.cbox(x, CURB_H + y + 2, z, w, 0.06, 0.06, { color: '#6a6a64' });
      g.cbox(x, CURB_H + y + 2, z, 0.06, 0.06, w, { color: '#6a6a64' });
    }
    for (const a of [0, 2.1, 4.2]) g.cbox(x + Math.sin(a) * 0.7, CURB_H + H - 1, z + Math.cos(a) * 0.7, 0.35, 1.6, 0.35, { color: '#d8d6cf' });
    g.cbox(x, CURB_H + H + 0.6, z, 0.2, 0.2, 0.2, { color: PAL.sirenRed });
    this.col.addCentered(x, z, 2.2, 2.2, 1.0, 0, false, 'prop');
    this.towers.push({ x, z, disabledT: 0 });
  }

  /** witness calls can't connect near a disabled tower or inside a blackout */
  coverage(x: number, z: number) {
    for (const t of this.towers) if (t.disabledT > 0 && Math.hypot(x - t.x, z - t.z) < 150) return false;
    return true;
  }

  update(dt: number) {
    for (const t of this.towers) if (t.disabledT > 0) t.disabledT -= dt;
  }
}
