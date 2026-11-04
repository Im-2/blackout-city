// Bike parking (free bicycles on a rack) and rental stands (pay and ride, or pick
// the lock if you're broke). Bikes stream in near the player like parked cars and
// the stand restocks once you've gone.
import * as THREE from 'three';
import { GeoBuilder } from '../world/geo';
import { CURB_H, blockBounds } from '../world/layout';
import { worldMaterials } from '../world/materials';
import { basicMat } from '../render/patch';
import { makeCanvas, toTexture } from '../assets/textures';
import { Vehicle } from '../vehicles/vehicle';
import type { CarKind } from '../vehicles/carMesh';
import { DISTRICTS, districtOfBlock } from '../map/districts';
import type { Game } from '../core/game';

interface Slot { x: number; z: number; heading: number; kind: CarKind; color: string; price: number; v: Vehicle | null; gone: boolean; }

const STREAM_IN = 115, STREAM_OUT = 165;
const COLORS = ['#9b3b2f', '#2f3b4d', '#c4a03c', '#3f7b88', '#cfccc4', '#4a2a5a'];

const RACKS: [number, number][] = [[5, 7], [7, 4], [2, 5], [7, 9], [8, 11]];
const RENTALS: [number, number][] = [[5, 10], [5, 3], [1, 7], [2, 1], [10, 6]];
const FLEET: [CarKind, number][] = [['motorbike', 40], ['scooter', 20], ['bicycle', 8]];

export class Bikes {
  private slots: Slot[] = [];

  constructor(private g: Game) {}

  /** a clear 8 m stretch of pavement on the block, north side first */
  private findSpot(bi: number, bj: number) {
    const g = this.g;
    const b = blockBounds(bi, bj);
    for (const [z, heading] of [[b.z0 + 1.15, Math.PI], [b.z1 - 1.15, 0]] as [number, number][])
      for (let x = b.x0 + 3; x < b.x1 - 9; x += 1) {
        if (!g.col.query(x - 0.6, z - 0.7, x + 6.8, z + 0.7).length) return { x, z, heading };
      }
    return null;
  }

  build() {
    const g = this.g;
    const posts = new GeoBuilder(), boards = new GeoBuilder();
    const place = (bi: number, bj: number, rental: boolean) => {
      // a crowded block hands over to its neighbours
      const at = this.findSpot(bi, bj) ?? this.findSpot(bi + 1, bj) ?? this.findSpot(bi - 1, bj) ?? this.findSpot(bi, bj + 1);
      if (!at) { console.warn('[bikes] no room near block', bi, bj); return; }
      const { x, z, heading } = at;
      const n = 3;
      for (let i = 0; i < n; i++) {
        const [kind, price] = rental ? FLEET[i] : (['bicycle', 0] as [CarKind, number]);
        this.slots.push({ x: x + 1 + i * 1.7, z, heading, kind, color: COLORS[(bi * 3 + bj + i) % COLORS.length], price, v: null, gone: false });
      }
      // the rail + sign
      posts.box(x, CURB_H + 0.45, z - 0.04, x + 5.4, CURB_H + 0.52, z + 0.04, { color: '#3a3c3e' });
      for (const px of [x, x + 5.4]) posts.cbox(px, CURB_H + 0.25, z, 0.07, 0.5, 0.07, { color: '#3a3c3e' });
      const sx = x + 6.4;
      posts.cbox(sx, CURB_H + 1.4, z, 0.1, 2.8, 0.1, { color: '#3a3c3e' });
      const v0 = rental ? 0.5 : 0, v1 = v0 + 0.5, y0 = CURB_H + 2.4, y1 = CURB_H + 3.1, w = 0.9;
      const c: [number, number, number] = [1, 1, 1];
      boards.quad([sx - w, y0, z + 0.06], [sx + w, y0, z + 0.06], [sx + w, y1, z + 0.06], [sx - w, y1, z + 0.06], [0, 0, 1], 0, v0, 1, v1, c);
      boards.quad([sx + w, y0, z - 0.06], [sx - w, y0, z - 0.06], [sx - w, y1, z - 0.06], [sx + w, y1, z - 0.06], [0, 0, -1], 0, v0, 1, v1, c);
      g.col.addCentered(sx, z, 0.2, 0.2, 3, 0, false, 'pole');
      const d = DISTRICTS[districtOfBlock(bi, bj)].name;
      g.activities.add(rental
        ? { id: `rent-${bi}-${bj}`, name: `Bike rental, ${d}`, type: 'bike', tag: '$', x: x + 3, z, intro: 'Rent a motorbike ($40), scooter ($20) or bicycle ($8). Press E on the one you want. Broke? Hold E and pick the lock, if nobody is looking.' }
        : { id: `rack-${bi}-${bj}`, name: `Bike parking, ${d}`, type: 'bike', x: x + 3, z, intro: 'Free bicycles. Nobody locks them around here. On any bike, hold F for a wheelie, or F + S for a stoppie.' });
    };
    for (const [bi, bj] of RACKS) place(bi, bj, false);
    for (const [bi, bj] of RENTALS) place(bi, bj, true);
    const pm = new THREE.Mesh(posts.build(), worldMaterials().props);
    g.scene.add(pm);
    const { c, ctx } = makeCanvas(64, 64);
    for (const [y, bg, word] of [[0, '#2a7a5a', 'RENT'], [32, '#2f6a9a', 'BIKES']] as [number, string, string][]) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, y, 64, 32);
      ctx.fillStyle = '#fff1d0';
      ctx.font = 'bold 18px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(word, 32, y + 17);
    }
    g.scene.add(new THREE.Mesh(boards.build(), basicMat({ map: toTexture(c, false), vertexColors: true })));
    return this;
  }

  reset() {
    for (const s of this.slots) { s.v = null; s.gone = false; }
  }

  update() {
    const g = this.g;
    const P = g.player.worldPos;
    for (const s of this.slots) {
      const d = Math.hypot(s.x - P.x, s.z - P.z);
      const v = s.v;
      if (v) {
        // ridden away or moved: the stand restocks when you're long gone
        if (!g.vehicles.includes(v) || v.driver !== 'none' || Math.hypot(v.pos.x - s.x, v.pos.z - s.z) > 2.5) { s.v = null; s.gone = true; continue; }
        if (d > STREAM_OUT) { g.removeVehicle(v); s.v = null; }
        continue;
      }
      if (s.gone) { if (d > 70) s.gone = false; continue; }
      if (d > STREAM_IN) continue;
      if (g.vehicles.some((o) => Math.hypot(o.pos.x - s.x, o.pos.z - s.z) < 1.2)) continue;
      const nv = new Vehicle(s.kind, s.color, g.col);
      nv.place(s.x, s.z, s.heading);
      nv.pos.y = CURB_H;
      nv.handbrake = true;
      if (s.price) { nv.rental = s.price; nv.locked = true; }
      g.addVehicle(nv);
      s.v = nv;
    }
  }
}
