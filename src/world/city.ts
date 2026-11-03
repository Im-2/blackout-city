// Seeded downtown generator: roads, sidewalks, buildings, props, lamps,
// signals, outer skyline. Builds merged per-block meshes + instanced props.
import * as THREE from 'three';
import { PAL } from '../core/palette';
import { Rng } from '../core/math';
import { GeoBuilder } from './geo';
import { Collision } from './collision';
import { worldMaterials, WorldMats } from './materials';
import type { FacadeStyle } from '../assets/textures';
import {
  BLOCKS, PITCH, ROAD_HALF, SIDEWALK, CURB_H, HALF, PARK_LANE,
  roadCoord, blockBounds, blockCenter, RoadGraph, BANK_BLOCK, DROP_BLOCK,
} from './layout';

export interface LampInfo { x: number; z: number; block: number; index: number; dead: boolean; }
export interface SpotInfo { x: number; z: number; heading: number; }
export interface PowerBoxInfo { x: number; z: number; block: number; bi: number; bj: number; }
export interface CameraSpot { x: number; z: number; y: number; yaw: number; }

export interface BlockMeshes {
  lit: THREE.Mesh[];
  /** material swap pairs for blackout */
  pairs: { mesh: THREE.Mesh; lit: THREE.Material; dark: THREE.Material }[];
}

const FLOOR = 3.4;

export class City {
  group = new THREE.Group();
  graph = new RoadGraph();
  mats: WorldMats;
  blocks: BlockMeshes[] = [];
  lamps: LampInfo[] = [];
  lampGlow!: THREE.InstancedMesh;
  lampPool!: THREE.InstancedMesh;
  parking: SpotInfo[] = [];
  powerBoxes: PowerBoxInfo[] = [];
  /** street doors pedestrians use to enter/leave buildings (heading = facing out) */
  doors: { x: number; z: number; heading: number }[] = [];
  benches: { x: number; z: number; yaw: number }[] = [];
  /** blocks reserved for hand-built buildings (shops, station, garage…) */
  reserved = new Map<number, string>();
  cameraSpots: CameraSpot[] = [];
  pedLoops: { x0: number; z0: number; x1: number; z1: number }[] = [];
  dropZone = { x: 0, z: 0, w: 10, d: 12, doorX: 0, doorZ: 0 };
  garageDoor!: THREE.Mesh;
  /** signal head anchors: per node, per approach axis */
  signalHeads: { node: number; axis: 'x' | 'z'; pos: THREE.Vector3; facing: number }[] = [];

  private rng: Rng;
  private props = new GeoBuilder();
  private glow = new GeoBuilder();
  private trees: THREE.Matrix4[] = [];
  private lampMats: THREE.Matrix4[] = [];

  constructor(public col: Collision, seed = 7) {
    this.rng = new Rng(seed);
    this.mats = worldMaterials();
  }

  build() {
    this.buildGround();
    for (let bj = 0; bj < BLOCKS; bj++) for (let bi = 0; bi < BLOCKS; bi++) this.buildBlock(bi, bj);
    this.buildOuterRing();
    this.buildIntersections();
    this.buildLamps();
    this.buildTrees();
    this.buildSkyline();
    this.flushProps();
    return this;
  }

  // ---------------------------------------------------------------- ground
  private buildGround() {
    const E = HALF + 70;
    const g = new GeoBuilder();
    g.floor(-E, -E, E, E, 0, { tile: [8, 8] });
    const asphalt = new THREE.Mesh(g.build(), this.mats.asphalt);
    asphalt.receiveShadow = true;
    this.group.add(asphalt);

    // Sidewalks: one slab per block (+ outer ring later)
    const top = new GeoBuilder();
    for (let bj = 0; bj < BLOCKS; bj++)
      for (let bi = 0; bi < BLOCKS; bi++) {
        const b = blockBounds(bi, bj);
        top.floor(b.x0, b.z0, b.x1, b.z1, CURB_H, { tile: [4, 4] });
        this.props.box(b.x0, 0, b.z0, b.x1, CURB_H, b.z1, { color: PAL.curb, skip: { py: true, ny: true } });
        this.pedLoops.push({ x0: b.x0 + 1.8, z0: b.z0 + 1.8, x1: b.x1 - 1.8, z1: b.z1 - 1.8 });
      }
    // outer ring sidewalk
    const o0 = HALF + ROAD_HALF, o1 = HALF + ROAD_HALF + SIDEWALK + 1;
    top.floor(-o1, -o1, o1, -o0, CURB_H, { tile: [4, 4] });
    top.floor(-o1, o0, o1, o1, CURB_H, { tile: [4, 4] });
    top.floor(-o1, -o0, -o0, o0, CURB_H, { tile: [4, 4] });
    top.floor(o0, -o0, o1, o0, CURB_H, { tile: [4, 4] });
    const sw = new THREE.Mesh(top.build(), this.mats.sidewalk);
    sw.receiveShadow = true;
    this.group.add(sw);

    // Lane markings
    const m = new GeoBuilder();
    const Y = 0.015;
    for (const e of this.graph.edges) {
      const A = this.graph.nodes[e.a], B = this.graph.nodes[e.b];
      const s0 = ROAD_HALF + 3.5, len = PITCH - 2 * s0;
      if (e.axis === 'x') {
        const x0 = A.x + s0, x1 = x0 + len, z = A.z;
        m.floor(x0, z - 0.22, x1, z - 0.08, Y, { color: PAL.laneYellow });
        m.floor(x0, z + 0.08, x1, z + 0.22, Y, { color: PAL.laneYellow });
        for (let x = x0 + 1; x < x1 - 2; x += 6) {
          m.floor(x, z - 3.6, x + 3, z - 3.45, Y, { color: PAL.laneWhite });
          m.floor(x, z + 3.45, x + 3, z + 3.6, Y, { color: PAL.laneWhite });
        }
      } else {
        const z0 = A.z + s0, z1 = z0 + len, x = A.x;
        m.floor(x - 0.22, z0, x - 0.08, z1, Y, { color: PAL.laneYellow });
        m.floor(x + 0.08, z0, x + 0.22, z1, Y, { color: PAL.laneYellow });
        for (let z = z0 + 1; z < z1 - 2; z += 6) {
          m.floor(x - 3.6, z, x - 3.45, z + 3, Y, { color: PAL.laneWhite });
          m.floor(x + 3.45, z, x + 3.6, z + 3, Y, { color: PAL.laneWhite });
        }
      }
      void B;
    }
    // Crosswalks + stop lines around each intersection
    for (const n of this.graph.nodes) {
      for (const eid of n.edges) {
        const e = this.graph.edges[eid];
        const o = this.graph.nodes[this.graph.other(e, n.id)];
        const sx = Math.sign(o.x - n.x), sz = Math.sign(o.z - n.z);
        const c0 = ROAD_HALF + 0.4, c1 = ROAD_HALF + 3.0;
        for (let k = -6; k <= 5.5; k += 1.4) {
          if (sx) m.floor(n.x + sx * (sx > 0 ? c0 : c1), n.z + k, n.x + sx * (sx > 0 ? c1 : c0), n.z + k + 0.7, Y, { color: PAL.laneWhite });
          else m.floor(n.x + k, n.z + sz * (sz > 0 ? c0 : c1), n.x + k + 0.7, n.z + sz * (sz > 0 ? c1 : c0), Y, { color: PAL.laneWhite });
        }
        // stop line on the incoming lanes (right-hand side when heading toward n)
        const s = ROAD_HALF + 3.4;
        if (sx) {
          const side = sx > 0 ? 1 : -1; // incoming from +x travels -x; its right is -z... use lanePoint convention
          const zA = side > 0 ? n.z - 6.8 : n.z + 0.3, zB = side > 0 ? n.z - 0.3 : n.z + 6.8;
          m.floor(n.x + sx * s, Math.min(zA, zB), n.x + sx * (s + 0.4), Math.max(zA, zB), Y, { color: PAL.laneWhite });
        } else {
          const side = sz > 0 ? 1 : -1;
          const xA = side > 0 ? n.x + 0.3 : n.x - 6.8, xB = side > 0 ? n.x + 6.8 : n.x - 0.3;
          m.floor(Math.min(xA, xB), n.z + sz * s, Math.max(xA, xB), n.z + sz * (s + 0.4), Y, { color: PAL.laneWhite });
        }
      }
    }
    const marks = new THREE.Mesh(m.build(), this.mats.props);
    marks.receiveShadow = true;
    this.group.add(marks);
  }

  // ---------------------------------------------------------------- blocks
  private buildBlock(bi: number, bj: number) {
    const id = bj * BLOCKS + bi;
    const b = blockBounds(bi, bj);
    const lot = { x0: b.x0 + SIDEWALK, z0: b.z0 + SIDEWALK, x1: b.x1 - SIDEWALK, z1: b.z1 - SIDEWALK };
    const buckets = new Map<string, GeoBuilder>();
    const bucket = (key: string) => {
      let g = buckets.get(key);
      if (!g) buckets.set(key, (g = new GeoBuilder()));
      return g;
    };
    const r = this.rng;

    const isBank = bi === BANK_BLOCK[0] && bj === BANK_BLOCK[1];
    const isDrop = bi === DROP_BLOCK[0] && bj === DROP_BLOCK[1];

    if (isBank) {
      // Bank is hand-built (bank.ts). Pave the back lot.
    } else if (isDrop) {
      this.buildGarage(lot, bucket);
    } else {
      const roll = r.next();
      const central = Math.abs(bi - 2.5) + Math.abs(bj - 2.5) < 2.5;
      if ((bi === 3 && bj === 2) || (!central && roll < 0.1)) this.buildPark(lot);
      else if (roll < 0.18 && !central) this.buildParkingLot(lot, bucket);
      else if (central && roll < 0.55) this.buildTowerLot(lot, bucket);
      else this.buildQuadLot(lot, bucket, central);
    }

    // power box (hackable) on the sidewalk, one per block
    const pbx = b.x0 + 1.0, pbz = (b.z0 + b.z1) / 2 + 6;
    this.props.cbox(pbx, CURB_H + 0.65, pbz, 0.6, 1.3, 1.0, { color: '#556048', shadeSides: true });
    this.props.cbox(pbx, CURB_H + 1.34, pbz, 0.7, 0.08, 1.1, { color: '#46503b' });
    this.props.cbox(pbx + 0.31, CURB_H + 0.9, pbz, 0.02, 0.25, 0.5, { color: '#c9b04a' }); // warning plate
    this.col.addCentered(pbx, pbz, 0.6, 1.0, 1.4, 0, false, 'prop');
    this.powerBoxes.push({ x: pbx, z: pbz, block: id, bi, bj });

    // sidewalk props: hydrant, mailbox, bench
    if (!isBank) {
      const hx = b.x1 - 1.2, hz = b.z0 + r.range(8, 16);
      this.props.cbox(hx, CURB_H + 0.35, hz, 0.3, 0.7, 0.3, { color: '#8e2f25' });
      this.props.cbox(hx, CURB_H + 0.75, hz, 0.2, 0.12, 0.2, { color: '#7a281f' });
      this.col.addCentered(hx, hz, 0.3, 0.3, 0.8, 0, false, 'prop');
      if (r.chance(0.5)) {
        const mx = r.range(b.x0 + 10, b.x1 - 10), mz = b.z1 - 1.3;
        this.props.cbox(mx, CURB_H + 0.55, mz, 0.6, 1.1, 0.5, { color: '#2f4a32', shadeSides: true });
        this.props.cbox(mx, CURB_H + 1.13, mz, 0.62, 0.1, 0.52, { color: '#263c29' });
        this.col.addCentered(mx, mz, 0.6, 0.5, 1.2, 0, false, 'prop');
      }
      if (r.chance(0.5)) this.bench(r.range(b.x0 + 8, b.x1 - 8), b.z0 + 1.0, 0);
    }

    // parking spots along curbs (outer lane)
    if (!isDrop) {
      const sides = [
        { x: (b.x0 + b.x1) / 2, z: b.z0 - ROAD_HALF + PARK_LANE - 0.0, h: Math.PI / 2, along: 'x' },
        { x: (b.x0 + b.x1) / 2, z: b.z1 + ROAD_HALF - PARK_LANE, h: -Math.PI / 2, along: 'x' },
      ];
      for (const s of sides) {
        if (r.chance(0.45)) {
          const off = r.range(-12, 12);
          // the curb lane belongs to traffic moving with the right-hand rule
          this.parking.push({ x: s.x + off, z: s.z, heading: s.h });
        }
      }
    }

    // finalize meshes for this block
    const bm: BlockMeshes = { lit: [], pairs: [] };
    for (const [key, g] of buckets) {
      if (g.empty) continue;
      const geo = g.build();
      let lit: THREE.Material, dark: THREE.Material;
      if (key.startsWith('f:')) {
        const f = this.mats.facades[key.slice(2) as FacadeStyle];
        lit = f.lit; dark = f.dark;
      } else if (key.startsWith('p:')) {
        const f = this.mats.plinth[key.slice(2)];
        lit = f.lit; dark = f.dark;
      } else if (key === 'roof') { lit = dark = this.mats.roof; }
      else { lit = dark = this.mats.props; }
      const mesh = new THREE.Mesh(geo, lit);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      bm.lit.push(mesh);
      if (lit !== dark) bm.pairs.push({ mesh, lit, dark });
    }
    this.blocks.push(bm);
  }

  setBlockPower(block: number, on: boolean) {
    const bm = this.blocks[block];
    if (!bm) return;
    for (const p of bm.pairs) p.mesh.material = on ? p.lit : p.dark;
  }

  private pickStyle(central: boolean): FacadeStyle {
    const r = this.rng.next();
    if (central) return r < 0.3 ? 'office' : r < 0.5 ? 'tan' : r < 0.75 ? 'brick' : r < 0.88 ? 'concrete' : 'sage';
    return r < 0.35 ? 'brick' : r < 0.55 ? 'tan' : r < 0.7 ? 'sage' : r < 0.82 ? 'slate' : 'concrete';
  }

  /**
   * One building: optional wider plinth (stepped base), facade body, cornice,
   * roof + rooftop clutter. Adds collision.
   */
  building(
    bucket: (k: string) => GeoBuilder,
    x0: number, z0: number, x1: number, z1: number,
    floors: number, style: FacadeStyle, opts: { plinth?: string; setback?: number } = {},
  ) {
    const r = this.rng;
    const f = this.mats.facades[style];
    let y = CURB_H;
    let bx0 = x0, bz0 = z0, bx1 = x1, bz1 = z1;
    if (opts.plinth) {
      const pf = this.mats.plinth[opts.plinth];
      const ph = 4.2;
      bucket('p:' + opts.plinth).box(x0, y, z0, x1, y + ph, z1, { tile: pf.tile, skip: { py: true, ny: true } });
      bucket('props').box(x0 - 0.15, y + ph, z0 - 0.15, x1 + 0.15, y + ph + 0.35, z1 + 0.15, { color: '#6b6760', shadeSides: true, skip: { ny: true } });
      y += ph + 0.35;
      const sb = opts.setback ?? 0;
      bx0 += sb; bz0 += sb; bx1 -= sb; bz1 -= sb;
      if (sb > 0) bucket('roof').floor(x0, z0, x1, z1, y + 0.01, { tile: [4, 4] });
    }
    const h = floors * FLOOR;
    const ou = r.int(0, 3) * 0.25, ov = r.int(0, 3) * 0.25;
    bucket('f:' + style).box(bx0, y, bz0, bx1, y + h, bz1, { tile: f.tile, uvOffset: [ou, ov], skip: { py: true, ny: true } });
    const top = y + h;
    // cornice
    const cc = style === 'brick' ? '#5e4636' : style === 'sage' ? PAL.bankGreenDark : style === 'tower' ? '#3b4046' : '#7c766c';
    bucket('props').box(bx0 - 0.3, top, bz0 - 0.3, bx1 + 0.3, top + 0.5, bz1 + 0.3, { color: cc, shadeSides: true, skip: { ny: true, py: true } });
    bucket('props').box(bx0 - 0.3, top - 0.25, bz0 - 0.3, bx1 + 0.3, top, bz1 + 0.3, { color: cc, skip: { py: true, nz: false } });
    bucket('roof').floor(bx0 - 0.3, bz0 - 0.3, bx1 + 0.3, bz1 + 0.3, top + 0.5, { tile: [4, 4] });
    // parapet lip
    const lip = 0.25;
    const pp = bucket('props');
    pp.box(bx0 - 0.3, top + 0.5, bz0 - 0.3, bx1 + 0.3, top + 0.9, bz0 - 0.3 + lip, { color: cc });
    pp.box(bx0 - 0.3, top + 0.5, bz1 + 0.3 - lip, bx1 + 0.3, top + 0.9, bz1 + 0.3, { color: cc });
    pp.box(bx0 - 0.3, top + 0.5, bz0, bx0 - 0.3 + lip, top + 0.9, bz1, { color: cc });
    pp.box(bx1 + 0.3 - lip, top + 0.5, bz0, bx1 + 0.3, top + 0.9, bz1, { color: cc });
    // rooftop clutter
    const w = bx1 - bx0, d = bz1 - bz0;
    const nAc = r.int(1, 3);
    for (let i = 0; i < nAc; i++) {
      const ax = r.range(bx0 + 2, bx1 - 2), az = r.range(bz0 + 2, bz1 - 2);
      pp.cbox(ax, top + 1.1, az, r.range(1.2, 2.4), 1.2, r.range(1.2, 2.0), { color: '#8a8780', shadeSides: true });
    }
    if ((style === 'brick' || style === 'tan' || style === 'sage') && floors <= 7 && r.chance(0.35) && w > 8 && d > 8) {
      const tx = bx0 + w * r.range(0.3, 0.7), tz = bz0 + d * r.range(0.3, 0.7);
      const ty = top + 0.5;
      for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pp.cbox(tx + lx * 1.2, ty + 1.5, tz + lz * 1.2, 0.25, 3, 0.25, { color: '#3b2f27' });
      pp.cbox(tx, ty + 3.2, tz, 3.0, 0.3, 3.0, { color: '#3b2f27' });
      pp.cbox(tx, ty + 4.8, tz, 2.8, 3.0, 2.8, { color: '#5a4434', shadeSides: true });
      pp.cbox(tx, ty + 6.5, tz, 2.0, 0.6, 2.0, { color: '#4a3a2e' });
      pp.cbox(tx, ty + 7.0, tz, 1.0, 0.5, 1.0, { color: '#4a3a2e' });
    }
    this.col.add(x0, 0, z0, x1, top + 1, z1, true, 'building');
    return top;
  }

  private buildTowerLot(lot: { x0: number; z0: number; x1: number; z1: number }, bucket: (k: string) => GeoBuilder) {
    const r = this.rng;
    const style: FacadeStyle = r.chance(0.6) ? 'tower' : 'office';
    const inset = r.range(1, 3);
    const floors = r.int(9, 18);
    this.building(bucket, lot.x0 + inset, lot.z0 + inset, lot.x1 - inset, lot.z1 - inset, floors, style, { plinth: r.pick(['grey', 'warm']), setback: 2 });
    this.streetDoor(lot.x0 + inset, lot.z0 + inset, lot.x1 - inset, lot.z1 - inset, lot);
    // planters at the base
    const cx = (lot.x0 + lot.x1) / 2, cz = lot.z1 + 1.5;
    this.planter(cx - 8, cz);
    this.planter(cx + 8, cz);
  }

  private buildQuadLot(lot: { x0: number; z0: number; x1: number; z1: number }, bucket: (k: string) => GeoBuilder, central: boolean) {
    const r = this.rng;
    const splitX = r.chance(0.7), splitZ = r.chance(0.7);
    const mx = (lot.x0 + lot.x1) / 2 + r.range(-4, 4), mz = (lot.z0 + lot.z1) / 2 + r.range(-4, 4);
    // 1.5 m gaps: alleys bikes can squeeze through but cars can't
    const xs = splitX ? [[lot.x0, mx - 0.75], [mx + 0.75, lot.x1]] : [[lot.x0, lot.x1]];
    const zs = splitZ ? [[lot.z0, mz - 0.75], [mz + 0.75, lot.z1]] : [[lot.z0, lot.z1]];
    for (const [x0, x1] of xs)
      for (const [z0, z1] of zs) {
        const style = this.pickStyle(central);
        const floors = style === 'office' ? r.int(5, 9) : r.int(central ? 3 : 2, central ? 7 : 5);
        const plinth = style === 'office' || style === 'concrete' ? 'grey' : r.chance(0.35) ? 'warm' : undefined;
        this.building(bucket, x0, z0, x1, z1, floors, style, plinth ? { plinth, setback: r.chance(0.5) ? 1 : 0 } : {});
        this.streetDoor(x0, z0, x1, z1, lot);
      }
  }

  private buildPark(lot: { x0: number; z0: number; x1: number; z1: number }) {
    const g = this.props;
    g.box(lot.x0 + 1, CURB_H, lot.z0 + 1, lot.x1 - 1, CURB_H + 0.25, lot.z1 - 1, { color: '#4f6332' });
    this.col.add(lot.x0 + 1, 0, lot.z0 + 1, lot.x1 - 1, CURB_H + 0.25, lot.z1 - 1, false, 'grass');
    for (let i = 0; i < 9; i++) {
      const x = this.rng.range(lot.x0 + 4, lot.x1 - 4), z = this.rng.range(lot.z0 + 4, lot.z1 - 4);
      this.tree(x, z, CURB_H + 0.25, this.rng.range(1.1, 1.6));
    }
    const cx = (lot.x0 + lot.x1) / 2, cz = (lot.z0 + lot.z1) / 2;
    g.cbox(cx, CURB_H + 0.5, cz, 3, 0.5, 3, { color: '#8a857c', shadeSides: true });
    g.cbox(cx, CURB_H + 1.4, cz, 0.8, 1.4, 0.8, { color: '#7a766d' });
    this.col.addCentered(cx, cz, 3, 3, 1.0, 0, false, 'prop');
    this.bench(cx - 5, cz, Math.PI / 2);
    this.bench(cx + 5, cz, Math.PI / 2);
  }

  private buildParkingLot(lot: { x0: number; z0: number; x1: number; z1: number }, bucket: (k: string) => GeoBuilder) {
    const g = this.props;
    g.box(lot.x0, CURB_H, lot.z0, lot.x1, CURB_H + 0.02, lot.z1, { color: '#43413d' });
    for (let x = lot.x0 + 3; x < lot.x1 - 2; x += 3) g.box(x, CURB_H + 0.02, lot.z0 + 2, x + 0.12, CURB_H + 0.03, lot.z0 + 7, { color: PAL.laneWhite });
    for (let x = lot.x0 + 3; x < lot.x1 - 4; x += 6) if (this.rng.chance(0.4)) this.parking.push({ x: x + 1.5, z: lot.z0 + 4.5, heading: 0 });
    // kiosk
    this.building(bucket, lot.x1 - 8, lot.z1 - 7, lot.x1 - 1, lot.z1 - 1, 1, 'concrete');
  }

  private buildGarage(lot: { x0: number; z0: number; x1: number; z1: number }, bucket: (k: string) => GeoBuilder) {
    // Old garage: brick shed with roll-up door facing west (toward the city).
    const gx0 = lot.x0 + 6, gx1 = lot.x1 - 2, gz0 = lot.z0 + 6, gz1 = lot.z1 - 4;
    const top = CURB_H + 6.5;
    const f = this.mats.facades.brick;
    const B = bucket('f:brick');
    const dz0 = (gz0 + gz1) / 2 - 3.5, dz1 = dz0 + 7;
    // west wall with door opening
    B.box(gx0, CURB_H, gz0, gx0 + 0.6, top, dz0, { tile: f.tile, skip: { py: true } });
    B.box(gx0, CURB_H, dz1, gx0 + 0.6, top, gz1, { tile: f.tile, skip: { py: true } });
    B.box(gx0, CURB_H + 4.5, dz0, gx0 + 0.6, top, dz1, { tile: f.tile });
    B.box(gx1 - 0.6, CURB_H, gz0, gx1, top, gz1, { tile: f.tile });
    B.box(gx0, CURB_H, gz0, gx1, top, gz0 + 0.6, { tile: f.tile });
    B.box(gx0, CURB_H, gz1 - 0.6, gx1, top, gz1, { tile: f.tile });
    bucket('roof').floor(gx0, gz0, gx1, gz1, top, { tile: [4, 4] });
    bucket('props').box(gx0, CURB_H, gz0, gx1, CURB_H + 0.02, gz1, { color: '#4a4844' });
    // painted sign band
    bucket('props').box(gx0 - 0.1, CURB_H + 4.6, dz0 - 1, gx0, CURB_H + 5.6, dz1 + 1, { color: '#2f3b4d' });
    this.col.add(gx0, 0, gz0, gx0 + 0.6, top, dz0, true, 'building');
    this.col.add(gx0, 0, dz1, gx0 + 0.6, top, gz1, true, 'building');
    this.col.add(gx1 - 0.6, 0, gz0, gx1, top, gz1, true, 'building');
    this.col.add(gx0, 0, gz0, gx1, top, gz0 + 0.6, true, 'building');
    this.col.add(gx0, 0, gz1 - 0.6, gx1, top, gz1, true, 'building');
    // roll-up door (animated open by heist)
    const door = new GeoBuilder();
    for (let y = 0; y < 4.4; y += 0.4) door.box(-0.08, y, -3.5, 0.08, y + 0.36, 3.5, { color: y % 0.8 < 0.4 ? '#7d7a72' : '#6e6b64' });
    this.garageDoor = new THREE.Mesh(door.build(), this.mats.props);
    this.garageDoor.position.set(gx0 + 0.3, CURB_H, (dz0 + dz1) / 2);
    this.garageDoor.castShadow = true;
    this.group.add(this.garageDoor);
    this.dropZone = { x: (gx0 + gx1) / 2, z: (gz0 + gz1) / 2, w: gx1 - gx0 - 2, d: gz1 - gz0 - 2, doorX: gx0 - 4, doorZ: (dz0 + dz1) / 2 };
    // the paved apron in front of the door
    this.props.box(lot.x0, CURB_H, dz0 - 1, gx0, CURB_H + 0.02, dz1 + 1, { color: '#48463f' });
    // yellow chevrons
    for (let i = 0; i < 4; i++) this.props.box(lot.x0 + 0.6 + i * 1.3, CURB_H + 0.02, dz0 + 1, lot.x0 + 1.1 + i * 1.3, CURB_H + 0.03, dz1 - 1, { color: PAL.laneYellow });
  }

  private buildOuterRing() {
    const r = this.rng;
    const o = HALF + ROAD_HALF + SIDEWALK + 1;
    const depth = 24;
    const bucket = (k: string) => {
      let g = ring.get(k);
      if (!g) ring.set(k, (g = new GeoBuilder()));
      return g;
    };
    const ring = new Map<string, GeoBuilder>();
    const run = (horizontal: boolean, fixed: number, sign: number) => {
      let t = -o;
      while (t < o) {
        const w = r.range(14, 30);
        const t1 = Math.min(o, t + w);
        const style = this.pickStyle(r.chance(0.4));
        const floors = r.int(3, 10);
        if (horizontal) {
          const z0 = sign > 0 ? fixed : fixed - depth, z1 = sign > 0 ? fixed + depth : fixed;
          this.building(bucket, t, z0, t1, z1, floors, style);
        } else {
          const x0 = sign > 0 ? fixed : fixed - depth, x1 = sign > 0 ? fixed + depth : fixed;
          this.building(bucket, x0, t, x1, t1, floors, style);
        }
        t = t1;
      }
    };
    run(true, -o, -1);
    run(true, o, 1);
    run(false, -o, -1);
    run(false, o, 1);
    // corners
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x0 = sx > 0 ? o : -o - depth, z0 = sz > 0 ? o : -o - depth;
      this.building(bucket, x0, z0, x0 + depth, z0 + depth, r.int(4, 9), 'brick');
    }
    for (const [key, g] of ring) {
      let mat: THREE.Material = this.mats.props;
      if (key.startsWith('f:')) mat = this.mats.facades[key.slice(2) as FacadeStyle].lit;
      else if (key.startsWith('p:')) mat = this.mats.plinth[key.slice(2)].lit;
      else if (key === 'roof') mat = this.mats.roof;
      const mesh = new THREE.Mesh(g.build(), mat);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      this.group.add(mesh);
    }
  }

  // ---------------------------------------------------------------- intersections
  private buildIntersections() {
    const g = this.props;
    for (const n of this.graph.nodes) {
      if (!n.hasLight) continue;
      for (const eid of n.edges) {
        const e = this.graph.edges[eid];
        const o = this.graph.nodes[this.graph.other(e, n.id)];
        // traffic approaching n from o travels dir = n - o
        const dx = Math.sign(n.x - o.x), dz = Math.sign(n.z - o.z);
        const rx = -dz, rz = dx; // right of travel
        const px = n.x - dx * (ROAD_HALF + 1.2) + rx * (ROAD_HALF + 1.0);
        const pz = n.z - dz * (ROAD_HALF + 1.2) + rz * (ROAD_HALF + 1.0);
        // pole
        g.cbox(px, 2.6, pz, 0.28, 5.2, 0.28, { color: PAL.metal, shadeSides: true });
        // arm reaching over the lanes (toward road centre, i.e. -right)
        const armLen = 6.0;
        const ax = px - rx * armLen / 2, az = pz - rz * armLen / 2;
        g.cbox(ax, 5.1, az, Math.abs(rx) * armLen + 0.18, 0.18, Math.abs(rz) * armLen + 0.18, { color: PAL.metal });
        // housing hangs at the lane above incoming traffic
        const hx = px - rx * 4.4, hz = pz - rz * 4.4;
        g.cbox(hx, 4.4, hz, 0.55, 1.4, 0.55, { color: PAL.signal, shadeSides: true });
        g.cbox(hx - dx * 0.3, 4.4, hz - dz * 0.3, Math.abs(dz) * 0.7 + 0.1, 1.5, Math.abs(dx) * 0.7 + 0.1, { color: '#2a2a2a' });
        // small pedestrian box on the pole
        g.cbox(px - dx * 0.25, 2.6, pz - dz * 0.25, 0.35, 0.45, 0.35, { color: PAL.signal });
        this.col.addCentered(px, pz, 0.35, 0.35, 5.2, 0, false, 'pole');
        this.signalHeads.push({ node: n.id, axis: e.axis, pos: new THREE.Vector3(hx - dx * 0.33, 4.4, hz - dz * 0.33), facing: Math.atan2(-dx, -dz) });
      }
    }
  }

  // ---------------------------------------------------------------- lamps
  private buildLamps() {
    const r = this.rng;
    for (let bj = 0; bj < BLOCKS; bj++)
      for (let bi = 0; bi < BLOCKS; bi++) {
        const b = blockBounds(bi, bj);
        const id = bj * BLOCKS + bi;
        const L = b.x1 - b.x0;
        // two lamps per side, at 1/4 and 3/4 (skip near signal poles)
        for (const t of [0.3, 0.7]) {
          this.lamp(b.x0 + L * t, b.z0 + 0.6, Math.PI, id); // north side, arm toward -z
          this.lamp(b.x0 + L * t, b.z1 - 0.6, 0, id);
          this.lamp(b.x0 + 0.6, b.z0 + L * t, -Math.PI / 2, id);
          this.lamp(b.x1 - 0.6, b.z0 + L * t, Math.PI / 2, id);
        }
        void r;
      }
  }

  /** yaw: direction the arm points (0 = +z). */
  private lamp(x: number, z: number, yaw: number, block: number) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, CURB_H, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
    this.lampMats.push(m);
    this.lamps.push({ x: x + Math.sin(yaw) * 1.6, z: z + Math.cos(yaw) * 1.6, block, index: this.lamps.length, dead: false });
    this.col.addCentered(x, z, 0.3, 0.3, 6, 0, false, 'pole');
  }

  /** A door on the building face that sits on the lot edge closest to the street. */
  private streetDoor(x0: number, z0: number, x1: number, z1: number, lot: { x0: number; z0: number; x1: number; z1: number }) {
    const opts: [number, number, number][] = [];
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    if (Math.abs(z0 - lot.z0) < 0.6) opts.push([cx, z0, Math.PI]);
    if (Math.abs(z1 - lot.z1) < 0.6) opts.push([cx, z1, 0]);
    if (Math.abs(x0 - lot.x0) < 0.6) opts.push([x0, cz, -Math.PI / 2]);
    if (Math.abs(x1 - lot.x1) < 0.6) opts.push([x1, cz, Math.PI / 2]);
    if (!opts.length) return;
    const [x, z, h] = this.rng.pick(opts);
    const fx = Math.sin(h), fz = Math.cos(h);
    // recessed dark door + frame + small awning
    const w = 1.6, ww = Math.abs(fz) * w + 0.12, dd = Math.abs(fx) * w + 0.12;
    this.props.cbox(x + fx * 0.02, CURB_H + 1.2, z + fz * 0.02, ww + Math.abs(fz) * 0.3, 2.5, dd + Math.abs(fx) * 0.3, { color: '#3a3430' });
    this.props.cbox(x + fx * 0.05, CURB_H + 1.1, z + fz * 0.05, ww, 2.2, dd, { color: '#5a4030' });
    this.props.cbox(x + fx * 0.06, CURB_H + 1.4, z + fz * 0.06, Math.abs(fz) * 1.2 + 0.1, 0.9, Math.abs(fx) * 1.2 + 0.1, { color: '#c9a865' });
    this.props.cbox(x + fx * 0.5, CURB_H + 2.75, z + fz * 0.5, Math.abs(fz) * 2.2 + Math.abs(fx), 0.12, Math.abs(fx) * 2.2 + Math.abs(fz), { color: this.rng.pick(['#4a5b39', '#7b3a2a', '#2f3b4d']) });
    this.doors.push({ x: x + fx * 0.8, z: z + fz * 0.8, heading: h });
  }

  private bench(x: number, z: number, yaw: number) {
    this.benches.push({ x, z, yaw });
    const g = new GeoBuilder();
    g.cbox(0, 0.45, 0, 1.8, 0.1, 0.5, { color: '#6b4a30' });
    g.cbox(0, 0.8, -0.22, 1.8, 0.4, 0.08, { color: '#6b4a30' });
    g.cbox(-0.75, 0.22, 0, 0.1, 0.45, 0.45, { color: PAL.metal });
    g.cbox(0.75, 0.22, 0, 0.1, 0.45, 0.45, { color: PAL.metal });
    this.props.append(g, new THREE.Matrix4().compose(new THREE.Vector3(x, CURB_H, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1)));
    const w = Math.abs(Math.cos(yaw)) * 1.8 + Math.abs(Math.sin(yaw)) * 0.5, d = Math.abs(Math.sin(yaw)) * 1.8 + Math.abs(Math.cos(yaw)) * 0.5;
    this.col.addCentered(x, z, w, d, 0.6, 0, false, 'prop');
  }

  planter(x: number, z: number, withTree = true) {
    this.props.cbox(x, CURB_H + 0.35, z, 1.6, 0.7, 1.6, { color: PAL.planter, shadeSides: true });
    this.props.cbox(x, CURB_H + 0.66, z, 1.3, 0.05, 1.3, { color: '#3d2c20' });
    this.col.addCentered(x, z, 1.6, 1.6, 0.85, 0, false, 'planter');
    if (withTree) this.tree(x, z, CURB_H + 0.7, this.rng.range(0.8, 1.05));
  }

  tree(x: number, z: number, y: number, s: number) {
    this.trees.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.floor(this.rng.next() * 4) * Math.PI / 2), new THREE.Vector3(s, s, s)));
    this.col.addCentered(x, z, 0.4, 0.4, 3, 0, false, 'tree');
  }

  private buildTrees() {
    // street trees in planters on block sidewalks (between lamps)
    for (let bj = 0; bj < BLOCKS; bj++)
      for (let bi = 0; bi < BLOCKS; bi++) {
        if (bi === BANK_BLOCK[0] && bj === BANK_BLOCK[1]) continue;
        const b = blockBounds(bi, bj);
        const L = b.x1 - b.x0;
        for (const t of [0.5]) {
          if (this.rng.chance(0.75)) this.planter(b.x0 + L * t, b.z1 - 1.3);
          if (this.rng.chance(0.6)) this.planter(b.x0 + L * t, b.z0 + 1.3);
          if (this.rng.chance(0.5)) this.planter(b.x1 - 1.3, b.z0 + L * t);
        }
      }
    // Instanced tree: trunk + stacked foliage cubes
    const trunk = new GeoBuilder();
    trunk.cbox(0, 0.9, 0, 0.35, 1.8, 0.35, { color: PAL.trunk, shadeSides: true });
    const fol = new GeoBuilder();
    fol.cbox(0, 2.4, 0, 2.2, 1.4, 2.2, { color: '#ffffff', shadeSides: true });
    fol.cbox(0.2, 3.4, -0.1, 1.6, 1.0, 1.6, { color: '#e8f0e0', shadeSides: true });
    fol.cbox(-0.5, 2.0, 0.6, 1.0, 0.8, 1.0, { color: '#d8e2cc', shadeSides: true });
    fol.cbox(0.7, 2.1, 0.5, 0.8, 0.8, 0.8, { color: '#f0f4e8', shadeSides: true });
    const n = this.trees.length;
    const tm = new THREE.InstancedMesh(trunk.build(), this.mats.props, n);
    const fm = new THREE.InstancedMesh(fol.build(), this.mats.foliage, n);
    const c = new THREE.Color();
    this.trees.forEach((m, i) => {
      tm.setMatrixAt(i, m);
      fm.setMatrixAt(i, m);
      c.set(PAL.foliage).offsetHSL((this.rng.next() - 0.5) * 0.04, 0, (this.rng.next() - 0.5) * 0.08);
      fm.setColorAt(i, c.multiplyScalar(1.6));
    });
    for (const im of [tm, fm]) {
      im.castShadow = true;
      im.receiveShadow = true;
      this.group.add(im);
    }

    // Lamps: post + arm + head as one instanced geometry
    const lp = new GeoBuilder();
    lp.cbox(0, 0.4, 0, 0.42, 0.8, 0.42, { color: '#2e3032' });
    lp.cbox(0, 3.0, 0, 0.22, 6.0, 0.22, { color: PAL.metal, shadeSides: true });
    lp.cbox(0, 6.0, 0.8, 0.18, 0.18, 1.8, { color: PAL.metal });
    lp.cbox(0, 5.85, 1.6, 0.5, 0.3, 0.8, { color: '#2e3032' });
    const lm = new THREE.InstancedMesh(lp.build(), this.mats.props, this.lampMats.length);
    lm.castShadow = true;
    this.lampMats.forEach((m, i) => lm.setMatrixAt(i, m));
    this.group.add(lm);

    const gl = new GeoBuilder();
    gl.cbox(0, 5.68, 1.6, 0.42, 0.06, 0.66, { color: PAL.lamp });
    this.lampGlow = new THREE.InstancedMesh(gl.build(), this.mats.glow, this.lampMats.length);
    this.lampMats.forEach((m, i) => this.lampGlow.setMatrixAt(i, m));
    this.group.add(this.lampGlow);

    const pool = new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2).translate(0, CURB_H + 0.04, 1.6);
    this.lampPool = new THREE.InstancedMesh(pool, this.mats.pool, this.lampMats.length);
    this.lampMats.forEach((m, i) => this.lampPool.setMatrixAt(i, m));
    this.lampPool.renderOrder = 1;
    this.group.add(this.lampPool);
  }

  private hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  setLamp(index: number, on: boolean) {
    const m = on ? this.lampMats[index] : this.hidden;
    this.lampGlow.setMatrixAt(index, m);
    this.lampPool.setMatrixAt(index, m);
    this.lampGlow.instanceMatrix.needsUpdate = true;
    this.lampPool.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- skyline
  private buildSkyline() {
    const r = this.rng;
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 6);
    const count = 140;
    const mat = this.mats.facades.office.lit.clone();
    mat.onBeforeCompile = this.mats.facades.office.lit.onBeforeCompile;
    const im = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const ang = r.range(0, Math.PI * 2);
      const rad = r.range(HALF + 60, HALF + 240);
      const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
      const h = r.range(25, 110);
      m.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion(), new THREE.Vector3(r.range(12, 26), h, r.range(12, 26)));
      im.setMatrixAt(i, m);
    }
    this.group.add(im);
  }

  private flushProps() {
    const mesh = new THREE.Mesh(this.props.build(), this.mats.props);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /** Expose for bank.ts to add into the shared prop bucket before flush. */
  get propBuilder() {
    return this.props;
  }

  blockCenter(id: number) {
    return blockCenter(id % BLOCKS, Math.floor(id / BLOCKS));
  }

  roadCoord = roadCoord;
}
