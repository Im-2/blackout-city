// Seeded downtown generator: roads, sidewalks, buildings, props, lamps,
// signals, outer skyline. Builds merged per-block meshes + instanced props.
import * as THREE from 'three';
import { PAL } from '../core/palette';
import { buildWaterfront } from './waterfront';
import { Rng } from '../core/math';
import { GeoBuilder } from './geo';
import { Collision } from './collision';
import { worldMaterials, WorldMats } from './materials';
import { worldMat } from '../render/patch';
import type { FacadeStyle } from '../assets/textures';
import {
  BLOCKS, PITCH, ROAD_HALF, SIDEWALK, CURB_H, HALF, PARK_LANE,
  roadCoord, blockBounds, blockCenter, RoadGraph, RUNWAYS, BANK_BLOCK, DROP_BLOCK, RING, OVERPASS, SHORE, surfaces, BRIDGE, BRIDGE_H, LAGOON, CHANNEL,
} from './layout';
import { DISTRICTS, District, districtOfBlock } from '../map/districts';

export interface LampInfo { x: number; z: number; block: number; index: number; dead: boolean; }
export interface SpotInfo { x: number; z: number; heading: number; }
export interface PowerBoxInfo { x: number; z: number; block: number; bi: number; bj: number; }
export interface CameraSpot { x: number; z: number; y: number; yaw: number; }

const FLOOR = 3.4;

/** A streamable piece of the world: its meshes are hidden and freed when far away. */
export interface Chunk { cx: number; cz: number; r: number; buckets: Map<string, GeoBuilder>; meshes: THREE.Mesh[]; on: boolean; }

/** Instanced props: only instances in active blocks are written to the GPU. */
class StreamedInstances {
  items: { block: number; m: THREE.Matrix4; off?: boolean; color?: THREE.Color }[] = [];
  meshes: THREE.InstancedMesh[] = [];
  rebuild(active: Set<number>) {
    let n = 0;
    for (const it of this.items) {
      if (it.off || !active.has(it.block)) continue;
      for (const im of this.meshes) {
        im.setMatrixAt(n, it.m);
        if (it.color && im.instanceColor) im.setColorAt(n, it.color);
      }
      n++;
    }
    for (const im of this.meshes) {
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }
}

export class City {
  group = new THREE.Group();
  graph = new RoadGraph();
  mats: WorldMats;
  lamps: LampInfo[] = [];
  lampGlow!: THREE.InstancedMesh;
  lampPool!: THREE.InstancedMesh;
  parking: SpotInfo[] = [];
  powerBoxes: PowerBoxInfo[] = [];
  /** street doors pedestrians use to enter/leave buildings (heading = facing out) */
  doors: { x: number; z: number; heading: number }[] = [];
  benches: { x: number; z: number; yaw: number }[] = [];
  stuntSpots: { x: number; z: number }[] = [];
  /** blocks reserved for hand-built buildings (shops, station, garage…) */
  reserved = new Map<number, string>();
  footprints: { x0: number; z0: number; x1: number; z1: number; top: number }[] = [];
  cameraSpots: CameraSpot[] = [];
  pedLoops: { x0: number; z0: number; x1: number; z1: number }[] = [];
  dropZone = { x: 0, z: 0, w: 10, d: 12, doorX: 0, doorZ: 0 };
  garageDoor!: THREE.Mesh;
  /** signal head anchors: per node, per approach axis */
  signalHeads: { node: number; axis: 'x' | 'z'; pos: THREE.Vector3; facing: number }[] = [];

  private rng: Rng;
  chunks: Chunk[] = [];
  water!: THREE.Mesh;
  private props!: GeoBuilder;
  private curBlock = 0;
  private tint: [number, number, number] = [1, 1, 1];
  private treeStream = new StreamedInstances();
  private lampStream = new StreamedInstances();
  private lampPoolStream = new StreamedInstances();
  private lampMats: THREE.Matrix4[] = [];
  private activeBlocks = new Set<number>();
  private instDirty = false;

  constructor(public col: Collision, seed = 7) {
    this.rng = new Rng(seed);
    this.mats = worldMaterials();
    // one chunk = 2x2 blocks: few draw calls per area, frustum culling still bites
    for (let j = 0; j < BLOCKS / 2; j++)
      for (let i = 0; i < BLOCKS / 2; i++)
        this.chunks.push({ cx: roadCoord(i * 2 + 1), cz: roadCoord(j * 2 + 1), r: 62, buckets: new Map(), meshes: [], on: true });
    this.useBlock(0);
  }

  private bucketOf(c: Chunk, key: string) {
    let g = c.buckets.get(key);
    if (!g) c.buckets.set(key, (g = new GeoBuilder()));
    return g;
  }

  private chunkOfBlock(id: number) {
    const bi = id % BLOCKS, bj = Math.floor(id / BLOCKS);
    return this.chunks[(bj >> 1) * (BLOCKS / 2) + (bi >> 1)];
  }

  private useBlock(id: number) {
    this.curBlock = id;
    this.props = this.bucketOf(this.chunkOfBlock(id), 'props');
    return this.props;
  }

  private blockIdAt(x: number, z: number) {
    const bi = Math.max(0, Math.min(BLOCKS - 1, Math.floor((x + HALF) / PITCH)));
    const bj = Math.max(0, Math.min(BLOCKS - 1, Math.floor((z + HALF) / PITCH)));
    return bj * BLOCKS + bi;
  }

  useAt(x: number, z: number) {
    return this.useBlock(this.blockIdAt(x, z));
  }

  /** the streamed prop builder for a position (street furniture adds to it before finalize) */
  propsAt(x: number, z: number) {
    return this.bucketOf(this.chunkOfBlock(this.blockIdAt(x, z)), 'props');
  }

  build() {
    this.buildGround();
    for (let bj = 0; bj < BLOCKS; bj++) for (let bi = 0; bi < BLOCKS; bi++) this.buildBlock(bi, bj);
    this.buildOuterRing();
    this.buildHighway();
    this.buildIntersections();
    this.buildLamps();
    this.buildTrees();
    this.buildSkyline();
    return this;
  }

  /** Turn all chunk buckets into meshes (after street furniture has been added). */
  finalize() {
    for (const c of this.chunks) {
      for (const [key, g] of c.buckets) {
        if (g.empty) continue;
        let mat: THREE.Material = this.mats.props;
        if (key.startsWith('f:')) mat = this.mats.facades[key.slice(2) as FacadeStyle].lit;
        else if (key.startsWith('p:')) mat = this.mats.plinth[key.slice(2)].lit;
        else if (key === 'roof') mat = this.mats.roof;
        else if (key === 'side') mat = this.mats.sidewalk;
        const mesh = new THREE.Mesh(g.build(), mat);
        mesh.castShadow = key !== 'side';
        mesh.receiveShadow = true;
        this.group.add(mesh);
        c.meshes.push(mesh);
      }
      c.buckets.clear();
    }
  }

  /** Show chunks near (x,z), free GPU buffers of far ones, refresh instanced props. */
  stream(x: number, z: number, radius: number) {
    let active = 0;
    this.activeBlocks.clear();
    for (const c of this.chunks) {
      const d = Math.hypot(c.cx - x, c.cz - z) - c.r;
      const on = d < radius + (c.on ? 12 : 0);
      if (on !== c.on) {
        c.on = on;
        for (const m of c.meshes) {
          m.visible = on;
          if (!on) m.geometry.dispose(); // re-uploaded automatically when it comes back
        }
      }
      if (on) active++;
    }
    // instanced props stream per block
    for (let id = 0; id < BLOCKS * BLOCKS; id++) {
      const b = blockCenter(id % BLOCKS, Math.floor(id / BLOCKS));
      if (Math.hypot(b.x - x, b.z - z) - 40 < radius) this.activeBlocks.add(id);
    }
    this.treeStream.rebuild(this.activeBlocks);
    this.lampStream.rebuild(this.activeBlocks);
    this.lampPoolStream.rebuild(this.activeBlocks);
    this.postStream.rebuild(this.activeBlocks);
    this.instDirty = false;
    return { active, total: this.chunks.length };
  }

  flushInstances() {
    if (!this.instDirty) return;
    this.instDirty = false;
    this.lampStream.rebuild(this.activeBlocks);
    this.lampPoolStream.rebuild(this.activeBlocks);
  }

  // ---------------------------------------------------------------- ground
  private buildGround() {
    const W = HALF + 70, E = SHORE; // land stops at the shore south and east
    const g = new GeoBuilder();
    // land, with a hole where the lagoon and its channel are
    const L = LAGOON, C = CHANNEL;
    g.floor(-W, -W, E, L.z0, 0, { tile: [8, 8] });
    g.floor(-W, L.z0, L.x0, E, 0, { tile: [8, 8] });
    g.floor(L.x1, L.z0, E, E, 0, { tile: [8, 8] });
    g.floor(L.x0, L.z1, C.x0, E, 0, { tile: [8, 8] });
    g.floor(C.x1, L.z1, L.x1, E, 0, { tile: [8, 8] });
    const asphalt = new THREE.Mesh(g.build(), this.mats.asphalt);
    asphalt.receiveShadow = true;
    this.group.add(asphalt);
    // the harbour
    const wg = new GeoBuilder();
    wg.floor(-1600, -1600, 1600, 1600, -1.5, { tile: [14, 14], color: PAL.water });
    this.water = new THREE.Mesh(wg.build(), worldMat({ map: this.mats.props.map, vertexColors: true }));
    this.group.add(this.water);

    // Sidewalks: one slab per block
    for (let bj = 0; bj < BLOCKS; bj++)
      for (let bi = 0; bi < BLOCKS; bi++) {
        const id = bj * BLOCKS + bi;
        const b = blockBounds(bi, bj);
        this.useBlock(id);
        const side = this.bucketOf(this.chunkOfBlock(id), 'side'), tint = DISTRICTS[districtOfBlock(bi, bj)].tint;
        if (bi === 5 && bj === 11) { // the lagoon's quay is the pavement round it
          const L = LAGOON, C = CHANNEL;
          side.floor(b.x0, b.z0, b.x1, L.z0, CURB_H, { tile: [4, 4], color: tint });
          side.floor(b.x0, L.z0, L.x0, b.z1, CURB_H, { tile: [4, 4], color: tint });
          side.floor(L.x1, L.z0, b.x1, b.z1, CURB_H, { tile: [4, 4], color: tint });
          side.floor(L.x0, L.z1, C.x0, b.z1, CURB_H, { tile: [4, 4], color: tint });
          side.floor(C.x1, L.z1, L.x1, b.z1, CURB_H, { tile: [4, 4], color: tint });
        } else side.floor(b.x0, b.z0, b.x1, b.z1, CURB_H, { tile: [4, 4], color: tint });
        this.props.box(b.x0, 0, b.z0, b.x1, CURB_H, b.z1, { color: PAL.curb, skip: { py: true, ny: true } });
        this.pedLoops.push({ x0: b.x0 + 1.8, z0: b.z0 + 1.8, x1: b.x1 - 1.8, z1: b.z1 - 1.8 });
      }
    // outer sidewalk on the landward (north + west) sides
    const top = new GeoBuilder();
    const o0 = HALF + ROAD_HALF, o1 = HALF + ROAD_HALF + SIDEWALK + 1;
    top.floor(-o1, -o1, o0, -o0, CURB_H, { tile: [4, 4] });
    top.floor(-o1, -o0, -o0, o0, CURB_H, { tile: [4, 4] });
    const sw = new THREE.Mesh(top.build(), this.mats.sidewalk);
    sw.receiveShadow = true;
    this.group.add(sw);

    // Lane markings
    const Y = 0.015;
    for (const e of this.graph.edges) {
      const A = this.graph.nodes[e.a], B = this.graph.nodes[e.b];
      if (e.axis === 'x' && A.z === HALF && A.x < BRIDGE.x0 && B.x > BRIDGE.x1) continue; // the drawbridge draws its own
      const m = this.useAt((A.x + B.x) / 2, (A.z + B.z) / 2);
      const s0 = ROAD_HALF + 3.5, len = e.len - 2 * s0;
      const ring = e.name === RING;
      const dash = ring ? 10 : 6;
      if (e.axis === 'x') {
        const x0 = A.x + s0, x1 = x0 + len, z = A.z;
        m.floor(x0, z - 0.22, x1, z - 0.08, Y, { color: PAL.laneYellow });
        m.floor(x0, z + 0.08, x1, z + 0.22, Y, { color: PAL.laneYellow });
        for (let x = x0 + 1; x < x1 - 2; x += dash) {
          m.floor(x, z - 3.6, x + 3, z - 3.45, Y, { color: PAL.laneWhite });
          m.floor(x, z + 3.45, x + 3, z + 3.6, Y, { color: PAL.laneWhite });
        }
      } else {
        const z0 = A.z + s0, z1 = z0 + len, x = A.x;
        m.floor(x - 0.22, z0, x - 0.08, z1, Y, { color: PAL.laneYellow });
        m.floor(x + 0.08, z0, x + 0.22, z1, Y, { color: PAL.laneYellow });
        for (let z = z0 + 1; z < z1 - 2; z += dash) {
          m.floor(x - 3.6, z, x - 3.45, z + 3, Y, { color: PAL.laneWhite });
          m.floor(x + 3.45, z, x + 3.6, z + 3, Y, { color: PAL.laneWhite });
        }
      }
    }
    // Crosswalks + stop lines around each intersection (not on the highway)
    for (const n of this.graph.nodes) {
      const m = this.useAt(n.x, n.z);
      for (const eid of n.edges) {
        const e = this.graph.edges[eid];
        if (e.name === RING) continue;
        const o = this.graph.nodes[this.graph.other(e, n.id)];
        const sx = Math.sign(o.x - n.x), sz = Math.sign(o.z - n.z);
        const c0 = ROAD_HALF + 0.4, c1 = ROAD_HALF + 3.0;
        for (let k = -6; k <= 5.5; k += 1.4) {
          if (sx) m.floor(n.x + sx * (sx > 0 ? c0 : c1), n.z + k, n.x + sx * (sx > 0 ? c1 : c0), n.z + k + 0.7, Y, { color: PAL.laneWhite });
          else m.floor(n.x + k, n.z + sz * (sz > 0 ? c0 : c1), n.x + k + 0.7, n.z + sz * (sz > 0 ? c1 : c0), Y, { color: PAL.laneWhite });
        }
        if (!n.hasLight) continue;
        // stop line on the incoming lanes (right-hand side when heading toward n)
        const s = ROAD_HALF + 3.4;
        if (sx) {
          const side = sx > 0 ? 1 : -1;
          const zA = side > 0 ? n.z - 6.8 : n.z + 0.3, zB = side > 0 ? n.z - 0.3 : n.z + 6.8;
          m.floor(n.x + sx * s, Math.min(zA, zB), n.x + sx * (s + 0.4), Math.max(zA, zB), Y, { color: PAL.laneWhite });
        } else {
          const side = sz > 0 ? 1 : -1;
          const xA = side > 0 ? n.x + 0.3 : n.x - 6.8, xB = side > 0 ? n.x + 6.8 : n.x - 0.3;
          m.floor(Math.min(xA, xB), n.z + sz * s, Math.max(xA, xB), n.z + sz * (s + 0.4), Y, { color: PAL.laneWhite });
        }
      }
    }
  }

  // ---------------------------------------------------------------- blocks
  private buildBlock(bi: number, bj: number) {
    const id = bj * BLOCKS + bi;
    const b = blockBounds(bi, bj);
    const district = districtOfBlock(bi, bj);
    // Old Town's buildings crowd narrower sidewalks
    const inset = district === 'oldtown' ? SIDEWALK - 1 : SIDEWALK;
    const lot = { x0: b.x0 + inset, z0: b.z0 + inset, x1: b.x1 - inset, z1: b.z1 - inset };
    const chunk = this.chunkOfBlock(id);
    const bucket = (key: string) => this.bucketOf(chunk, key);
    const r = this.rng;
    this.useBlock(id);
    this.tint = DISTRICTS[district].tint;

    const isBank = bi === BANK_BLOCK[0] && bj === BANK_BLOCK[1];
    const isDrop = bi === DROP_BLOCK[0] && bj === DROP_BLOCK[1];

    if (isBank || this.reserved.has(id)) {
      // hand-built (bank.ts / buildings.ts)
    } else if (isDrop) {
      this.buildGarage(lot, bucket);
    } else {
      const roll = r.next();
      if (district === 'park') this.buildPark(lot, bj >= 10, RUNWAYS.some(([i, j]) => i === bi && j === bj));
      else if (district === 'docks') this.buildDocksLot(lot, bucket, bi);
      else if (district === 'downtown' && roll < 0.55) this.buildTowerLot(lot, bucket);
      else if (district === 'residential' && roll < 0.08) this.buildPark(lot, false);
      else if (district !== 'downtown' && roll < 0.16) this.buildParkingLot(lot, bucket);
      else this.buildQuadLot(lot, bucket, district);
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

    this.tint = [1, 1, 1];
  }

  private pickStyle(d: District): FacadeStyle {
    const w = DISTRICTS[d].styles;
    let k = this.rng.next() * w.reduce((a, x) => a + x[1], 0);
    for (const [st, n] of w) { k -= n; if (k <= 0) return st; }
    return 'brick';
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
      bucket('p:' + opts.plinth).box(x0, y, z0, x1, y + ph, z1, { tile: pf.tile, color: this.tint, skip: { py: true, ny: true } });
      bucket('props').box(x0 - 0.15, y + ph, z0 - 0.15, x1 + 0.15, y + ph + 0.35, z1 + 0.15, { color: '#6b6760', shadeSides: true, skip: { ny: true } });
      y += ph + 0.35;
      const sb = opts.setback ?? 0;
      bx0 += sb; bz0 += sb; bx1 -= sb; bz1 -= sb;
      if (sb > 0) bucket('roof').floor(x0, z0, x1, z1, y + 0.01, { tile: [4, 4] });
    }
    const h = floors * FLOOR;
    const ou = r.int(0, 3) * 0.25, ov = r.int(0, 3) * 0.25;
    bucket('f:' + style).box(bx0, y, bz0, bx1, y + h, bz1, { tile: f.tile, uvOffset: [ou, ov], color: this.tint, skip: { py: true, ny: true } });
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
    this.col.add(x0, 0, z0, x1, top + 0.5, z1, true, 'building');
    this.footprints.push({ x0, z0, x1, z1, top: top + 0.5 });
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

  private buildQuadLot(lot: { x0: number; z0: number; x1: number; z1: number }, bucket: (k: string) => GeoBuilder, d: District) {
    const r = this.rng;
    const D = DISTRICTS[d];
    const old = d === 'oldtown';
    const splitX = old || r.chance(0.7), splitZ = old || r.chance(0.7);
    const mx = (lot.x0 + lot.x1) / 2 + r.range(-4, 4), mz = (lot.z0 + lot.z1) / 2 + r.range(-4, 4);
    // 1.5 m gaps: alleys bikes can squeeze through but cars can't
    const xs = splitX ? [[lot.x0, mx - 0.75], [mx + 0.75, lot.x1]] : [[lot.x0, lot.x1]];
    const zs = splitZ ? [[lot.z0, mz - 0.75], [mz + 0.75, lot.z1]] : [[lot.z0, lot.z1]];
    for (const [x0, x1] of xs)
      for (const [z0, z1] of zs) {
        const style = this.pickStyle(d);
        const floors = r.int(D.floors[0], D.floors[1]);
        const plinth = style === 'office' || style === 'concrete' ? 'grey' : r.chance(old || d === 'residential' ? 0.5 : 0.3) ? 'warm' : undefined;
        this.building(bucket, x0, z0, x1, z1, floors, style, plinth ? { plinth, setback: r.chance(0.5) ? 1 : 0 } : {});
        this.streetDoor(x0, z0, x1, z1, lot);
      }
  }

  private buildPark(lot: { x0: number; z0: number; x1: number; z1: number }, waterfront: boolean, runway = false) {
    const g = this.props;
    const top = CURB_H + 0.25;
    g.box(lot.x0 + 1, CURB_H, lot.z0 + 1, lot.x1 - 1, top, lot.z1 - 1, { color: waterfront ? '#566a38' : '#4f6332' });
    this.col.add(lot.x0 + 1, 0, lot.z0 + 1, lot.x1 - 1, top, lot.z1 - 1, false, 'grass');
    const cx = (lot.x0 + lot.x1) / 2, cz = (lot.z0 + lot.z1) / 2;
    // crossing paths for joggers and bikes
    g.box(lot.x0 + 1, top, cz - 1.2, lot.x1 - 1, top + 0.01, cz + 1.2, { color: '#a1885f' });
    g.box(cx - 1.2, top, lot.z0 + 1, cx + 1.2, top + 0.01, lot.z1 - 1, { color: '#a1885f' });
    for (let i = 0; i < 7; i++) {
      const sx = this.rng.chance(0.5) ? 1 : -1, sz = this.rng.chance(0.5) ? 1 : -1;
      this.tree(cx + sx * this.rng.range(4, 14), cz + sz * this.rng.range(4, 14), top, this.rng.range(1.1, 1.6));
    }
    if (runway) {
      // nothing on the paths, and they're ridden on top of the grass
      surfaces.push({ x0: lot.x0 + 1, z0: lot.z0 + 1, x1: lot.x1 - 1, z1: lot.z1 - 1, h0: top + 0.01 });
      return;
    }
    g.cbox(cx, CURB_H + 0.5, cz, 3, 0.5, 3, { color: '#8a857c', shadeSides: true });
    g.cbox(cx, CURB_H + 1.4, cz, 0.8, 1.4, 0.8, { color: '#7a766d' });
    this.col.addCentered(cx, cz, 3, 3, 1.0, 0, false, 'prop');
    this.bench(cx - 6, cz + 2.2, 0);
    this.bench(cx + 6, cz - 2.2, Math.PI);
    if (waterfront) {
      // jump spots along the paths
      this.stuntRamp(cx + 5, cz - 1.2, 4, 2.4, 1.3);
      this.stuntRamp(cx - 13, cz - 1.2, 4, 2.4, 1.0);
    }
  }

  /** A wedge that rises along +x; vehicles and riders launch off the high end. */
  private stuntRamp(x: number, z: number, len: number, wid: number, h: number) {
    const g = this.props;
    const y0 = CURB_H + 0.25, y1 = y0 + h;
    const c: [number, number, number] = [0.47, 0.45, 0.41];
    const dark: [number, number, number] = [0.3, 0.29, 0.27];
    g.quad([x, y0, z + wid], [x + len, y1, z + wid], [x + len, y1, z], [x, y0, z], [0, 1, 0], 0, 0, 1, 1, c);
    g.quad([x + len, y0, z + wid], [x + len, y0, z], [x + len, y1, z], [x + len, y1, z + wid], [1, 0, 0], 0, 0, 1, 1, dark);
    g.quad([x, y0, z + wid], [x + len, y0, z + wid], [x + len, y1, z + wid], [x, y0, z + wid], [0, 0, 1], 0, 0, 1, 1, dark);
    g.quad([x + len, y0, z], [x, y0, z], [x, y0, z], [x + len, y1, z], [0, 0, -1], 0, 0, 1, 1, dark);
    surfaces.push({ x0: x, z0: z, x1: x + len, z1: z + wid, h0: y0, h1: y1, axis: 'x' });
    this.col.add(x + len, 0, z, x + len + 0.1, y1 - 0.05, z + wid, false, 'ramp');
    this.stuntSpots.push({ x: x + len, z: z + wid / 2 });
  }

  /** Warehouses, container stacks and the odd gantry crane. */
  private buildDocksLot(lot: { x0: number; z0: number; x1: number; z1: number }, bucket: (k: string) => GeoBuilder, bi: number) {
    const r = this.rng;
    this.props.box(lot.x0, CURB_H, lot.z0, lot.x1, CURB_H + 0.02, lot.z1, { color: '#4a4844' });
    let yz0 = lot.z0;
    if (r.chance(0.6)) {
      const z1 = lot.z0 + r.range(14, 20);
      this.building(bucket, lot.x0 + 1, lot.z0 + 1, lot.x1 - 1, z1, r.int(2, 3), this.pickStyle('docks'));
      this.streetDoor(lot.x0 + 1, lot.z0 + 1, lot.x1 - 1, z1, { ...lot, z0: lot.z0 + 1 });
      yz0 = z1 + 2;
    }
    const cols = ['#9b3b2f', '#3f7b88', '#5b6433', '#c4a03c', '#2f3b4d', '#7b4a34'];
    for (let x = lot.x0 + 1; x < lot.x1 - 6.5; x += 7)
      for (let z = yz0 + 1; z < lot.z1 - 2.6; z += 3.6) {
        const n = r.int(0, 3);
        for (let k = 0; k < n; k++) {
          const y = CURB_H + k * 2.6;
          this.props.box(x, y, z, x + 6, y + 2.55, z + 2.4, { color: r.pick(cols), shadeSides: true });
          for (let t = 0.4; t < 6; t += 0.8) this.props.box(x + t, y + 0.2, z - 0.02, x + t + 0.2, y + 2.35, z, { color: '#2a2a28' });
        }
        if (n) this.col.add(x, 0, z, x + 6, CURB_H + n * 2.6, z + 2.4, n > 1, 'container');
      }
    if (bi >= BLOCKS - 1 && r.chance(0.7)) {
      // gantry crane over the yard
      const cx = (lot.x0 + lot.x1) / 2, cz = (lot.z0 + lot.z1) / 2;
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        this.props.cbox(cx + sx * 12, 11, cz + sz * 8, 0.8, 22, 0.8, { color: '#c4a03c', shadeSides: true });
        this.col.addCentered(cx + sx * 12, cz + sz * 8, 0.9, 0.9, 22, 0, false, 'pole');
      }
      this.props.cbox(cx, 22.5, cz - 8, 25, 1, 1, { color: '#c4a03c' });
      this.props.cbox(cx, 22.5, cz + 8, 25, 1, 1, { color: '#c4a03c' });
      this.props.cbox(cx + 14, 23.5, cz, 34, 1.2, 1.4, { color: '#b08a24' });
      this.props.cbox(cx + 2, 22, cz, 3, 2.4, 2.4, { color: '#6e6a62', shadeSides: true });
    }
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

  /** Boundary buildings on the landward (north + west) sides, in streamable sectors. */
  private buildOuterRing() {
    const r = this.rng;
    const o = HALF + ROAD_HALF + SIDEWALK + 1;
    const depth = 24;
    const sector = (cx: number, cz: number) => {
      const c: Chunk = { cx, cz, r: 72, buckets: new Map(), meshes: [], on: true };
      this.chunks.push(c);
      return (k: string) => this.bucketOf(c, k);
    };
    const run = (horizontal: boolean, end: number) => {
      let t = -o;
      while (t < end) {
        const t1End = Math.min(end, t + 110);
        const mid = (t + t1End) / 2;
        const bucket = horizontal ? sector(mid, -o - 12) : sector(-o - 12, mid);
        while (t < t1End) {
          const t1 = Math.min(t1End, t + r.range(14, 30));
          const style = this.pickStyle('residential');
          const floors = r.int(3, 10);
          if (horizontal) this.building(bucket, t, -o - depth, t1, -o, floors, style);
          else this.building(bucket, -o - depth, t, -o, t1, floors, style);
          t = t1;
        }
      }
    };
    run(true, SHORE);
    run(false, SHORE);
    this.building(sector(-o - 12, -o - 12), -o - depth, -o - depth, -o, -o, 6, 'brick');
  }

  /** Ring highway dressing: seawall, the bridge over the channel and the overpass. */
  private buildHighway() {
    // seawall along the south + east shore (keeps everyone out of the water)
    for (let t = -HALF - 70; t < SHORE; t += PITCH) {
      const t1 = Math.min(SHORE, t + PITCH);
      const gapS = t1 > BRIDGE.x0 && t < BRIDGE.x1;
      if (!gapS) {
        this.useAt((t + t1) / 2, SHORE).box(t, -1.5, SHORE - 0.5, t1, 0.8, SHORE, { color: '#7a766d', shadeSides: true });
      } else {
        const p = this.useAt((t + t1) / 2, SHORE);
        p.box(t, -1.5, SHORE - 0.5, BRIDGE.x0, 0.8, SHORE, { color: '#7a766d', shadeSides: true });
        p.box(BRIDGE.x1, -1.5, SHORE - 0.5, t1, 0.8, SHORE, { color: '#7a766d', shadeSides: true });
      }
      this.useAt(SHORE, (t + t1) / 2).box(SHORE - 0.5, -1.5, t, SHORE, 0.8, t1, { color: '#7a766d', shadeSides: true });
    }
    buildWaterfront(this);
    // bridge on the south side of the ring
    const zb = HALF;
    this.elevated(BRIDGE.x0 - 9, BRIDGE.x1 + 9, 9, zb, BRIDGE_H, false, true);
    const pb = this.useAt((BRIDGE.x0 + BRIDGE.x1) / 2, HALF - 10);
    for (const x of [BRIDGE.x0 + 3, BRIDGE.x1 - 3])
      for (const sz of [-1, 1]) pb.cbox(x, 6, zb + sz * 7.6, 1, 15, 1, { color: '#6e6a62', shadeSides: true });
    for (const sz of [-1, 1]) {
      pb.cbox((BRIDGE.x0 + BRIDGE.x1) / 2, 11.5, zb + sz * 7.6, BRIDGE.x1 - BRIDGE.x0 - 5, 0.5, 0.5, { color: '#6e6a62' });
      for (let x = BRIDGE.x0 + 5; x < BRIDGE.x1 - 4; x += 3.5) pb.cbox(x, 7.2, zb + sz * 7.6, 0.1, 8.5, 0.1, { color: '#3a3c3e' });
    }
    // overpass: Foundry St flies over Pier Ave in the docks
    const n = this.graph.node(OVERPASS.i, OVERPASS.j);
    this.elevated(n.x - 48, n.x + 48, 36, n.z, 5.4, true);
  }

  /**
   * A raised road section along x: ramp up, deck, ramp down, side rails.
   * clearUnder keeps the space below the deck open for the road beneath.
   */
  private elevated(x0: number, x1: number, rampLen: number, z: number, h: number, clearUnder: boolean, gap = false) {
    const zn = z - ROAD_HALF, zs = z + ROAD_HALF;
    const road: [number, number, number] = [0.2, 0.19, 0.18];
    const side: [number, number, number] = [0.36, 0.35, 0.33];
    const a = x0 + rampLen, b = x1 - rampLen;
    const seg = (xa: number, xb: number, ya: number, yb: number) => {
      const steps = Math.max(1, Math.ceil((xb - xa) / PITCH));
      for (let i = 0; i < steps; i++) {
        const u0 = i / steps, u1 = (i + 1) / steps;
        const X0 = xa + (xb - xa) * u0, X1 = xa + (xb - xa) * u1, Y0 = ya + (yb - ya) * u0, Y1 = ya + (yb - ya) * u1;
        const p = this.useAt((X0 + X1) / 2, z);
        p.quad([X0, Y0 + 0.02, zs], [X1, Y1 + 0.02, zs], [X1, Y1 + 0.02, zn], [X0, Y0 + 0.02, zn], [0, 1, 0], 0, 0, 1, 1, road);
        p.quad([X1, Y1 - 0.5, zs], [X0, Y0 - 0.5, zs], [X0, Y0 - 0.5, zn], [X1, Y1 - 0.5, zn], [0, -1, 0], 0, 0, 1, 1, side);
        p.quad([X0, Math.max(0, Y0 - 0.5), zs], [X1, Math.max(0, Y1 - 0.5), zs], [X1, Y1 + 0.02, zs], [X0, Y0 + 0.02, zs], [0, 0, 1], 0, 0, 1, 1, side);
        p.quad([X1, Math.max(0, Y1 - 0.5), zn], [X0, Math.max(0, Y0 - 0.5), zn], [X0, Y0 + 0.02, zn], [X1, Y1 + 0.02, zn], [0, 0, -1], 0, 0, 1, 1, side);
        // rail tops + centre line
        p.quad([X0, Y0 + 0.9, zs + 0.15], [X1, Y1 + 0.9, zs + 0.15], [X1, Y1 + 0.9, zs], [X0, Y0 + 0.9, zs], [0, 1, 0], 0, 0, 1, 1, side);
        p.quad([X0, Y0 + 0.9, zn], [X1, Y1 + 0.9, zn], [X1, Y1 + 0.9, zn - 0.15], [X0, Y0 + 0.9, zn - 0.15], [0, 1, 0], 0, 0, 1, 1, side);
        p.quad([X0, Y0 + 0.03, z + 0.15], [X1, Y1 + 0.03, z + 0.15], [X1, Y1 + 0.03, z - 0.15], [X0, Y0 + 0.03, z - 0.15], [0, 1, 0], 0, 0, 1, 1, [0.5, 0.4, 0.14]);
        p.quad([X0, Y0 + 0.02, zs], [X1, Y1 + 0.02, zs], [X1, Y1 + 0.9, zs], [X0, Y0 + 0.9, zs], [0, 0, -1], 0, 0, 1, 1, side);
        p.quad([X1, Y1 + 0.02, zn], [X0, Y0 + 0.02, zn], [X0, Y0 + 0.9, zn], [X1, Y1 + 0.9, zn], [0, 0, 1], 0, 0, 1, 1, side);
      }
    };
    seg(x0, a, 0, h);
    if (!gap) seg(a, b, h, h);
    seg(b, x1, h, 0);
    surfaces.push({ x0, z0: zn, x1: a, z1: zs, h0: 0.02, h1: h, axis: 'x' });
    if (!gap) surfaces.push({ x0: a, z0: zn, x1: b, z1: zs, h0: h });
    surfaces.push({ x0: b, z0: zn, x1, z1: zs, h0: h, h1: 0.02, axis: 'x' });
    const railY = clearUnder ? h - 0.6 : 0;
    for (const [z0, z1] of [[zn - 0.2, zn], [zs, zs + 0.2]]) {
      this.col.add(x0, 0, z0, a, h + 1.2, z1, false, 'rail');
      if (!gap) this.col.add(a, railY, z0, b, h + 1.2, z1, false, 'rail');
      this.col.add(b, 0, z0, x1, h + 1.2, z1, false, 'rail');
    }
    if (clearUnder) {
      this.col.add(a, h - 0.5, zn, b, h, zs, true, 'deck');
      for (const x of [a + 2, b - 2]) {
        const p = this.useAt(x, z);
        for (const sz of [-1, 1]) { p.cbox(x, h / 2, z + sz * 5.5, 1.2, h, 1.2, { color: '#6e6a62', shadeSides: true }); this.col.addCentered(x, z + sz * 5.5, 1.2, 1.2, h - 0.5, 0, true, 'pier'); }
      }
    }
  }

  // ---------------------------------------------------------------- intersections
  private buildIntersections() {
    for (const n of this.graph.nodes) {
      if (!n.hasLight) continue;
      const g = this.useAt(n.x, n.z);
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
        this.useBlock(id);
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
    this.lampStream.items.push({ block, m });
    this.lampPoolStream.items.push({ block, m });
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
    const color = new THREE.Color(PAL.foliage).offsetHSL((this.rng.next() - 0.5) * 0.04, 0, (this.rng.next() - 0.5) * 0.08).multiplyScalar(1.6);
    this.treeStream.items.push({ block: this.curBlock, color, m: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.floor(this.rng.next() * 4) * Math.PI / 2), new THREE.Vector3(s, s, s)) });
    this.col.addCentered(x, z, 0.4, 0.4, 3, 0, false, 'tree');
  }

  private buildTrees() {
    // street trees in planters on block sidewalks (between lamps)
    for (let bj = 0; bj < BLOCKS; bj++)
      for (let bi = 0; bi < BLOCKS; bi++) {
        if (bi === BANK_BLOCK[0] && bj === BANK_BLOCK[1]) continue;
        if (this.reserved.has(bj * BLOCKS + bi)) continue;
        const b = blockBounds(bi, bj);
        const L = b.x1 - b.x0;
        this.useBlock(bj * BLOCKS + bi);
        for (const t of [0.5]) {
          const clear = RUNWAYS.some(([i, j]) => i === bi && j === bj); // nothing in the way of a run-up
          if (this.rng.chance(0.75) && !clear) this.planter(b.x0 + L * t, b.z1 - 1.3);
          if (this.rng.chance(0.6) && !clear) this.planter(b.x0 + L * t, b.z0 + 1.3);
          if (this.rng.chance(0.5) && !clear) this.planter(b.x1 - 1.3, b.z0 + L * t);
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
    const n = this.treeStream.items.length;
    const tm = new THREE.InstancedMesh(trunk.build(), this.mats.props, n);
    const fm = new THREE.InstancedMesh(fol.build(), this.mats.foliage, n);
    fm.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    for (const im of [tm, fm]) {
      im.castShadow = true;
      im.receiveShadow = true;
      im.frustumCulled = false;
      this.group.add(im);
    }
    this.treeStream.meshes = [tm, fm];

    // Lamps: post + arm + head as one instanced geometry
    const lp = new GeoBuilder();
    lp.cbox(0, 0.4, 0, 0.42, 0.8, 0.42, { color: '#2e3032' });
    lp.cbox(0, 3.0, 0, 0.22, 6.0, 0.22, { color: PAL.metal, shadeSides: true });
    lp.cbox(0, 6.0, 0.8, 0.18, 0.18, 1.8, { color: PAL.metal });
    lp.cbox(0, 5.85, 1.6, 0.5, 0.3, 0.8, { color: '#2e3032' });
    const count = this.lampMats.length;
    const lm = new THREE.InstancedMesh(lp.build(), this.mats.props, count);
    lm.castShadow = true;
    lm.frustumCulled = false;
    this.group.add(lm);

    const gl = new GeoBuilder();
    gl.cbox(0, 5.68, 1.6, 0.42, 0.06, 0.66, { color: PAL.lamp });
    this.lampGlow = new THREE.InstancedMesh(gl.build(), this.mats.glow, count);
    this.lampGlow.frustumCulled = false;
    this.group.add(this.lampGlow);
    this.lampStream.meshes = [this.lampGlow];
    this.lampPoolStream.meshes = [];

    const pool = new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2).translate(0, CURB_H + 0.04, 1.6);
    this.lampPool = new THREE.InstancedMesh(pool, this.mats.pool, count);
    this.lampPool.renderOrder = 1;
    this.lampPool.frustumCulled = false;
    this.group.add(this.lampPool);
    this.lampPoolStream.meshes = [this.lampPool];
    // posts stay when a lamp is blown; only its glow and pool go out
    this.postStream.items = this.lampStream.items.map((i) => ({ block: i.block, m: i.m }));
    this.postStream.meshes = [lm];
  }

  private postStream = new StreamedInstances();

  setLamp(index: number, on: boolean) {
    this.lampStream.items[index].off = !on;
    this.lampPoolStream.items[index].off = !on;
    this.instDirty = true;
  }

  // ---------------------------------------------------------------- skyline
  private buildSkyline() {
    const r = this.rng;
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 6);
    const count = 140;
    const mat = this.mats.facades.office.lit.clone();
    mat.vertexColors = false;
    mat.onBeforeCompile = this.mats.facades.office.lit.onBeforeCompile;
    const im = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const ang = r.range(0, Math.PI * 2);
      const rad = r.range(HALF + 90, HALF + 300);
      let x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
      if (x > -HALF * 0.3 && z > -HALF * 0.3) { x = -Math.abs(x); z = -Math.abs(z); } // not out at sea
      const h = r.range(25, 110);
      m.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion(), new THREE.Vector3(r.range(12, 26), h, r.range(12, 26)));
      im.setMatrixAt(i, m);
    }
    this.group.add(im);
  }

  blockCenter(id: number) {
    return blockCenter(id % BLOCKS, Math.floor(id / BLOCKS));
  }

  roadCoord = roadCoord;
}
