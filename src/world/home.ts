// The player's home: a ground-floor flat with its own garage in Residential.
// Sealed interior (the front door is an E + fade, so nothing walks in). Lighting
// is baked into vertex colours from a list of lamps, so it costs one draw call and
// stays warm whatever the sun is doing. The street out of the window is the real one.
import * as THREE from 'three';
import { Kit } from './interior';
import { GeoBuilder } from './geo';
import { CURB_H } from './layout';
import { worldMaterials } from './materials';
import { basicMat } from '../render/patch';
import { texGrain } from '../assets/textures';
import { hexToRgb, damp } from '../core/math';
import { PAL } from '../core/palette';
import { Vehicle } from '../vehicles/vehicle';
import { CarKind } from '../vehicles/carMesh';
import { RARES } from '../activities/collection';
import type { Buildings, Site } from './buildings';
import type { Game } from '../core/game';
import type { OwnedVehicle } from '../save/save';

export const F = 0.15; // floor
export const TOP = F + 3.0; // ceiling
export const WAIN = 1.15, DOOR_TOP = 2.35, WIN_TOP = 2.55;

export interface Opening { axis: 'x' | 'z'; fixed: number; at: number; w: number; window?: boolean; /** a taller window than the flat's */ sill?: number; head?: number; }
export interface Lamp { x: number; y: number; z: number; c: [number, number, number]; reach: number; rect: [number, number, number, number]; }
export interface RoomDef { x0: number; z0: number; x1: number; z1: number; wall: string; wain: string; floor: (i: number, j: number) => string; top?: number; }

const LIVING: RoomDef = { x0: -34.9, z0: 36.1, x1: -21.1, z1: 44.5, wall: '#b08a5c', wain: '#6e4f33', floor: (_, j) => (j % 2 ? '#7a5634' : '#6e4c2e') };
const KITCHEN: RoomDef = { x0: -20.9, z0: 36.1, x1: -11.5, z1: 44.5, wall: '#c2a878', wain: '#d8d0bc', floor: (i, j) => ((i + j) % 2 ? '#c8bfa8' : '#7c6f5c') };
const BEDROOM: RoomDef = { x0: -34.9, z0: 27.5, x1: -25.7, z1: 35.9, wall: '#8f6f5e', wain: '#5e4638', floor: (i, j) => ((i * 3 + j * 5) % 7 ? '#6a4a4a' : '#624444') };
const BATH: RoomDef = { x0: -25.5, z0: 27.5, x1: -20.7, z1: 35.9, wall: '#9ab0a4', wain: '#d8d6cc', floor: (i, j) => ((i + j) % 2 ? '#d8d6cc' : '#8ea49a') };
const DEN: RoomDef = { x0: -20.5, z0: 27.5, x1: -11.5, z1: 35.9, wall: '#5c5a5e', wain: '#3a3840', floor: (_, j) => (j % 2 ? '#4a3a30' : '#42342c') };
const GARAGE: RoomDef = { x0: -44.5, z0: 27.5, x1: -35.1, z1: 44.5, wall: '#8a857a', wain: '#6a665e', floor: (i, j) => ((i * 7 + j * 11) % 13 === 0 ? '#4e4c48' : '#5e5c56'), top: F + 3.6 };

const OPENINGS: Opening[] = [
  { axis: 'z', fixed: 36, at: -30, w: 1.4 }, // living > bedroom
  { axis: 'z', fixed: 36, at: -23, w: 1.2 }, // living > bathroom
  { axis: 'z', fixed: 36, at: -16, w: 1.4 }, // kitchen > den
  { axis: 'x', fixed: -21, at: 40.3, w: 3 }, // living > kitchen arch
  { axis: 'z', fixed: 44.5, at: -32, w: 3, window: true },
  { axis: 'z', fixed: 44.5, at: -24.5, w: 3, window: true },
  { axis: 'z', fixed: 44.5, at: -16, w: 2.4, window: true },
];

const WARM: [number, number, number] = [1.0, 0.72, 0.42];
const LAMPS: Lamp[] = [
  { x: -28, y: 2.9, z: 40.2, c: WARM, reach: 10, rect: [LIVING.x0, LIVING.z0, LIVING.x1, LIVING.z1] },
  { x: -22.2, y: 1.8, z: 43.5, c: WARM, reach: 5, rect: [LIVING.x0, LIVING.z0, LIVING.x1, LIVING.z1] },
  { x: -17, y: 2.4, z: 40.2, c: [1.0, 0.78, 0.5], reach: 8.5, rect: [KITCHEN.x0, KITCHEN.z0, KITCHEN.x1, KITCHEN.z1] },
  { x: -30.9, y: 1.1, z: 27.9, c: [1.0, 0.62, 0.34], reach: 6, rect: [BEDROOM.x0, BEDROOM.z0, BEDROOM.x1, BEDROOM.z1] },
  { x: -30, y: 2.9, z: 32, c: WARM, reach: 7.5, rect: [BEDROOM.x0, BEDROOM.z0, BEDROOM.x1, BEDROOM.z1] },
  { x: -23, y: 2.9, z: 31.5, c: [1.0, 0.86, 0.66], reach: 7.5, rect: [BATH.x0, BATH.z0, BATH.x1, BATH.z1] },
  { x: -16, y: 2.9, z: 33, c: [0.85, 0.6, 0.4], reach: 6.5, rect: [DEN.x0, DEN.z0, DEN.x1, DEN.z1] },
  { x: -15.7, y: 1.5, z: 28.7, c: [0.25, 0.8, 1.0], reach: 5, rect: [DEN.x0, DEN.z0, DEN.x1, DEN.z1] },
  { x: -39.7, y: 3.4, z: 35, c: [1.0, 0.82, 0.58], reach: 13, rect: [GARAGE.x0, GARAGE.z0, GARAGE.x1, GARAGE.z1] },
];
const AMBIENT: [number, number, number] = [0.3, 0.25, 0.2];

/** multiply every vertex colour by the light it receives from its room's lamps */
export function makeBake(lamps: Lamp[]) {
  return (geo: GeoBuilder) => {
    const p = geo.pos, n = geo.nor, c = geo.col;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      let r = AMBIENT[0], gr = AMBIENT[1], b = AMBIENT[2];
      for (const L of lamps) {
        const [rx0, rz0, rx1, rz1] = L.rect;
        if (x < rx0 - 0.3 || x > rx1 + 0.3 || z < rz0 - 0.3 || z > rz1 + 0.3) continue;
        const dx = L.x - x, dy = L.y - y, dz = L.z - z;
        const d = Math.hypot(dx, dy, dz) || 0.001;
        if (d > L.reach) continue;
        const f = 1 - d / L.reach;
        const nl = Math.max(0, (dx * n[i] + dy * n[i + 1] + dz * n[i + 2]) / d);
        const e = f * f * (0.45 + 0.55 * nl) * 1.05;
        r += L.c[0] * e; gr += L.c[1] * e; b += L.c[2] * e;
      }
      // unlit material: hex colours have to go in as linear to come out as themselves
      c[i] = c[i] ** 2.2 * r; c[i + 1] = c[i + 1] ** 2.2 * gr; c[i + 2] = c[i + 2] ** 2.2 * b;
    }
  };
}
const bake = makeBake(LAMPS);

let homeMat: THREE.MeshBasicMaterial | null = null;
export const homeMaterial = () => (homeMat ??= basicMat({ map: texGrain(), vertexColors: true }));
const material = homeMaterial;

/** floor, ceiling and inward-facing walls of a room, broken up so light can vary across them */
export function paintRoom(k: Kit, r: RoomDef, openings: Opening[], base = 0) {
  const g = k.props;
  const top = (r.top ?? TOP) + base;
  const rgb = hexToRgb;
  const fy = F + base + 0.012; // just proud of the shell it's painted on, so they don't z-fight
  for (let x = r.x0, i = 0; x < r.x1 - 0.01; x += 1, i++)
    for (let z = r.z0, j = 0; z < r.z1 - 0.01; z += 1, j++) {
      const xe = Math.min(x + 1, r.x1), ze = Math.min(z + 1, r.z1);
      g.quad([x, fy, ze], [xe, fy, ze], [xe, fy, z], [x, fy, z], [0, 1, 0], x, z, xe, ze, rgb(r.floor(i, j)));
      g.quad([x, top, z], [xe, top, z], [xe, top, ze], [x, top, ze], [0, -1, 0], x, z, xe, ze, rgb('#8c7a60'));
    }
  const tall = openings.find((o) => o.sill !== undefined);
  const rows = [...new Set([F, WAIN, DOOR_TOP, WIN_TOP, ...(tall ? [tall.sill!, tall.head!] : [])])].map((v) => v + base).sort((p, q) => p - q);
  rows.push(top);
  const walls: ['x' | 'z', number, number, number, 1 | -1][] = [
    ['z', r.z0, r.x0, r.x1, 1], ['z', r.z1, r.x0, r.x1, -1],
    ['x', r.x0, r.z0, r.z1, 1], ['x', r.x1, r.z0, r.z1, -1],
  ];
  for (const [axis, wallAt, a0, a1, dir] of walls) {
    const fixed = wallAt + dir * 0.015;
    const ops = openings.filter((o) => o.axis === axis && Math.abs(o.fixed - wallAt) < 0.25 && o.at > a0 && o.at < a1);
    const cuts = new Set<number>([a1]);
    for (let a = a0; a < a1; a += 1) cuts.add(a);
    for (const o of ops) { cuts.add(o.at - o.w / 2); cuts.add(o.at + o.w / 2); }
    const pts = [...cuts].sort((p, q) => p - q);
    for (let n = 0; n < pts.length - 1; n++) {
      const a = pts[n], b = pts[n + 1];
      if (b - a < 0.005) continue;
      for (let v = 0; v < rows.length - 1; v++) {
        const y0 = rows[v], y1 = rows[v + 1], am = (a + b) / 2, ym = (y0 + y1) / 2 - base;
        if (ops.some((o) => Math.abs(am - o.at) < o.w / 2 && (o.window ? ym > (o.sill ?? WAIN) && ym < (o.head ?? WIN_TOP) : ym < DOOR_TOP))) continue;
        const c = rgb(ym < WAIN ? r.wain : r.wall);
        if (axis === 'z') {
          if (dir > 0) g.quad([a, y0, fixed], [b, y0, fixed], [b, y1, fixed], [a, y1, fixed], [0, 0, 1], a, y0, b, y1, c);
          else g.quad([b, y0, fixed], [a, y0, fixed], [a, y1, fixed], [b, y1, fixed], [0, 0, -1], a, y0, b, y1, c);
        } else if (dir > 0) g.quad([fixed, y0, b], [fixed, y0, a], [fixed, y1, a], [fixed, y1, b], [1, 0, 0], a, y0, b, y1, c);
        else g.quad([fixed, y0, a], [fixed, y0, b], [fixed, y1, b], [fixed, y1, a], [-1, 0, 0], a, y0, b, y1, c);
      }
    }
  }
}

/** collision + door frames for a partition */
export function partitionWall(k: Kit, openings: Opening[], axis: 'x' | 'z', fixed: number, a0: number, a1: number, base = 0) {
  const ops = openings.filter((o) => o.axis === axis && Math.abs(o.fixed - fixed) < 0.01 && !o.window && o.at > a0 && o.at < a1).sort((p, q) => p.at - q.at);
  const top = base + 4.2;
  let cur = a0;
  const seg = (s0: number, s1: number, y0: number, y1: number) => {
    if (s1 - s0 < 0.01) return;
    if (axis === 'z') k.solid(s0, y0, fixed - 0.1, s1, y1, fixed + 0.1, true);
    else k.solid(fixed - 0.1, y0, s0, fixed + 0.1, y1, s1, true);
  };
  for (const o of ops) {
    const a = o.at - o.w / 2, b = o.at + o.w / 2;
    seg(cur, a, base, top);
    seg(a, b, base + DOOR_TOP, top);
    cur = b;
    // door frame
    const trim = '#3b2c20', t = 0.07, f0 = base + F, dt = base + DOOR_TOP;
    if (axis === 'z') {
      k.props.box(a - t, f0, fixed - 0.13, a, dt + t, fixed + 0.13, { color: trim });
      k.props.box(b, f0, fixed - 0.13, b + t, dt + t, fixed + 0.13, { color: trim });
      k.props.box(a, dt, fixed - 0.13, b, dt + t, fixed + 0.13, { color: trim });
    } else {
      k.props.box(fixed - 0.13, f0, a - t, fixed + 0.13, dt + t, a, { color: trim });
      k.props.box(fixed - 0.13, f0, b, fixed + 0.13, dt + t, b + t, { color: trim });
      k.props.box(fixed - 0.13, dt, a, fixed + 0.13, dt + t, b, { color: trim });
    }
  }
  seg(cur, a1, base, top);
}

const canvasTex = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return { c, x: c.getContext('2d')!, t };
};

export class Home {
  static readonly DOOR_OUT = { x: -28, z: 46.4 };
  static readonly START = { x: -30.6, z: 32.6, heading: 0 };
  private static readonly BAY = { x: -39.75, z: 33 };
  /** the car parked in the garage right now */
  car: Vehicle | null = null;
  private site!: Site;
  private garageSite!: Site;
  private rollMesh!: THREE.Mesh;
  private rollCol!: import('./collision').AABB;
  private roll = 0;
  private farGlow!: THREE.Mesh;
  private display: THREE.Mesh | null = null;
  private warm = 0;
  tv = canvasTex(192, 108);
  monitor = canvasTex(128, 72);
  private tvT = 0;
  private monT = 0;
  private scroll = 192;
  private hintT = 0;
  private hemiSky = new THREE.Color(PAL.hemiSky);
  private hemiGround = new THREE.Color(PAL.hemiGround);
  private warmSky = new THREE.Color('#ffc890');
  private warmGround = new THREE.Color('#8a5a38');

  constructor(private g: Game, private b: Buildings) {}

  /** in the flat itself (not the garage) */
  get inHouse() {
    if (this.g.player.vehicle) return false;
    const s = this.g.siteAt(this.g.player.pos.x, this.g.player.pos.z, this.g.player.pos.y);
    return s === 'home' || (!!s?.startsWith('prop-') && !s.endsWith('-g'));
  }
  /** anywhere the police won't follow */
  get inside() {
    const P = this.g.player.worldPos;
    const s = this.g.siteAt(P.x, P.z, P.y);
    return s === 'home' || s === 'homegarage' || !!s?.startsWith('prop-');
  }
  /** the street outside wherever you're hiding: `dz` points away from the wall */
  get doorOut() { return this.g.properties.doorOut ?? { x: Home.DOOR_OUT.x, z: Home.DOOR_OUT.z, dz: 1 }; }

  // ------------------------------------------------------------------ exterior
  buildExterior() {
    const g = this.g, e = this.b.ext;
    const x0 = -45, x1 = -11, z0 = 27, z1 = 45, top = 4.4;
    const wins = OPENINGS.filter((o) => o.window);
    this.b.shell(x0, z0, x1, z1, top, 'brick', [
      { side: 's', at: -39.75, w: 6, h: 3.2 }, // garage
      ...wins.map((w) => ({ side: 's' as const, at: w.at, w: w.w, h: WIN_TOP - CURB_H })),
    ], '#5e4636');
    // flats upstairs
    const f = this.b.facade('brick');
    f.box(x0, top, z0, x1, 11.2, z1, { tile: [16, 13.6], skip: { ny: true } });
    g.col.add(x0, top, z0, x1, 11.2, z1, true, 'building');
    e.box(x0 - 0.3, 11.2, z0 - 0.3, x1 + 0.3, 11.6, z1 + 0.3, { color: '#5e4636', shadeSides: true });
    // wall between the flat and the garage, plus the interior partitions live in the kits
    g.col.add(-35.1, 0, z0, -34.9, 4.4, z1, true, 'building');

    // windows: brick sill, frame, glass
    const glass = new GeoBuilder(), far = new GeoBuilder();
    for (const w of wins) {
      const a = w.at - w.w / 2, b = w.at + w.w / 2;
      f.box(a, 0, 44.5, b, WAIN, 45, { tile: [16, 13.6] });
      g.col.add(a, 0, 44.5, b, WIN_TOP, 45, false, 'window');
      e.box(a - 0.08, WAIN - 0.06, 44.98, b + 0.08, WAIN + 0.05, 45.12, { color: '#3b2c20' });
      e.box(a - 0.08, WIN_TOP - 0.05, 44.98, b + 0.08, WIN_TOP + 0.06, 45.12, { color: '#3b2c20' });
      for (const x of [a, w.at, b]) e.box(x - 0.05, WAIN, 44.5, x + 0.05, WIN_TOP, 45.05, { color: '#3b2c20' });
      glass.box(a, WAIN, 44.72, b, WIN_TOP, 44.76, { color: '#9fb8c8' });
      far.box(a, WAIN, 44.6, b, WIN_TOP, 44.62, { color: '#d8a860', skip: { nz: true } });
      // window box with some green in it
      e.box(a + 0.1, WAIN - 0.3, 45, b - 0.1, WAIN - 0.06, 45.32, { color: '#5b4330', shadeSides: true });
      for (let x = a + 0.3; x < b - 0.2; x += 0.45) e.cbox(x, WAIN + 0.02, 45.16, 0.34, 0.18, 0.22, { color: x % 0.9 < 0.45 ? '#4f7a3a' : '#5e8a44' });
    }
    const gm = new THREE.Mesh(glass.build(), basicMat({ vertexColors: true, transparent: true, opacity: 0.16, depthWrite: false }));
    gm.renderOrder = 2;
    g.scene.add(gm);
    this.farGlow = new THREE.Mesh(far.build(), worldMaterials().glow);
    g.scene.add(this.farGlow);

    // front door
    e.box(-29, CURB_H, 45, -27, CURB_H + 2.5, 45.08, { color: '#3b2c20' });
    e.box(-28.85, CURB_H, 45.08, -27.15, CURB_H + 2.38, 45.14, { color: '#6b2f2a' });
    e.box(-28.6, CURB_H + 1.3, 45.14, -27.4, CURB_H + 2.1, 45.16, { color: '#4f221e' });
    e.box(-28.6, CURB_H + 0.3, 45.14, -27.4, CURB_H + 1.1, 45.16, { color: '#4f221e' });
    e.cbox(-27.4, CURB_H + 1.15, 45.18, 0.08, 0.08, 0.08, { color: '#c4a03c' });
    e.box(-29.2, CURB_H + 2.6, 45, -26.8, CURB_H + 2.72, 46, { color: '#3a3c3e' }); // canopy
    e.box(-28.8, CURB_H + 0.005, 45.1, -27.2, CURB_H + 0.03, 46.1, { color: '#7a6a50' }); // mat
    e.box(-29.9, CURB_H + 0.8, 45, -29.4, CURB_H + 1.3, 45.22, { color: '#2f3b4d' }); // mailbox
    const lit = new Kit(g.col);
    lit.glow.cbox(-29.15, CURB_H + 2.1, 45.08, 0.2, 0.3, 0.14, { color: '#ffd98a' });
    lit.sign('No. 17', -26.3, CURB_H + 2.0, 45.04, 0, 0.9, 0.3, '#2f3b4d', '#ffd27a');
    lit.sign('GARAGE', -39.75, 3.85, 45.04, 0, 3, 0.5, '#2f3b4d', '#e8e2d0');
    lit.finish(g.scene);

    // roll-up garage door + a darker apron across the pavement
    e.box(-42.75, CURB_H + 0.01, 45, -36.75, CURB_H + 0.02, 49, { color: '#4e4c48' });
    const slats = new GeoBuilder();
    for (let y = 0; y < 3.2; y += 0.32) slats.box(-3, y, 0, 3, y + 0.29, 0.1, { color: y % 0.64 < 0.32 ? '#7d7a72' : '#74716a' });
    this.rollMesh = new THREE.Mesh(slats.build(), worldMaterials().props);
    this.rollMesh.position.set(-39.75, CURB_H, 44.7);
    this.rollMesh.castShadow = true;
    g.scene.add(this.rollMesh);
    this.rollCol = g.col.add(-42.75, 0, 44.5, -36.75, 3.6, 45, true, 'door');

    const entry = { x: Home.DOOR_OUT.x, z: Home.DOOR_OUT.z, heading: 0 };
    this.site = this.b.site({
      id: 'home', name: 'Home', open: true, x0: LIVING.x0, z0: BEDROOM.z0, x1: KITCHEN.x1, z1: LIVING.z1, ceiling: 3.0, maxY: 4,
      door: entry, approach: entry,
      build: (k, s) => this.buildHouse(k, s),
    });
    const gEntry = { x: -39.75, z: 47.6, heading: Math.PI };
    this.garageSite = this.b.site({
      id: 'homegarage', name: 'Home garage', open: true, x0: GARAGE.x0, z0: GARAGE.z0, x1: GARAGE.x1, z1: GARAGE.z1, ceiling: 3.6, maxY: 4,
      door: gEntry, approach: gEntry,
      build: (k, s) => this.buildGarage(k, s),
    });
    // the front door is on the street, so it's there whether or not the flat is loaded
    g.interactables.push({ pos: new THREE.Vector3(-28, CURB_H, 46), radius: 1.5, get label() { return g.police.heat > 0 ? 'Go inside: the police can\'t follow' : 'Go inside'; }, enabled: () => !g.player.vehicle, action: () => this.enter() });
  }

  // ------------------------------------------------------------------ painting helpers
  private setup(k: Kit) {
    k.propsMat = material();
    k.bake = bake;
    k.props = new GeoBuilder();
  }

  private paint(k: Kit, r: RoomDef) { paintRoom(k, r, OPENINGS); }
  private partition(k: Kit, axis: 'x' | 'z', fixed: number, a0: number, a1: number) { partitionWall(k, OPENINGS, axis, fixed, a0, a1); }

  private mug(k: Kit, x: number, y: number, z: number, color = '#d8d0bc') {
    k.props.cbox(x, y + 0.06, z, 0.09, 0.12, 0.09, { color });
    k.props.cbox(x + 0.065, y + 0.06, z, 0.04, 0.07, 0.03, { color });
  }

  // ------------------------------------------------------------------ the flat
  private buildHouse(k: Kit, s: Site) {
    const g = this.g;
    this.setup(k);
    for (const r of [LIVING, KITCHEN, BEDROOM, BATH, DEN]) this.paint(k, r);
    this.partition(k, 'z', 36, -35, -11.5);
    this.partition(k, 'x', -21, 36, 44.5);
    this.partition(k, 'x', -25.6, 27.5, 36);
    this.partition(k, 'x', -20.6, 27.5, 36);
    k.solid(-35, TOP, 27.5, -11.5, TOP + 0.3, 44.5, true, 'ceiling');
    const p = k.props;
    const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: string) => p.box(x0, y0, z0, x1, y1, z1, { color, shadeSides: true });
    const glow = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: string) => k.glow.box(x0, y0, z0, x1, y1, z1, { color });

    // ceiling lights
    for (const [x, z, w] of [[-28, 40.2, 1.6], [-30, 32, 1.2], [-23, 31.5, 0.9], [-16, 33, 1]] as [number, number, number][]) glow(x - w / 2, TOP - 0.05, z - 0.25, x + w / 2, TOP, z + 0.25, '#ffdf9e');

    // ---- living room
    box(-29.5, F, 37.5, -24.2, F + 0.02, 41.6, '#7a2f2a'); // rug
    box(-29.1, F + 0.02, 37.9, -24.6, F + 0.03, 41.2, '#a8603c');
    k.block(-28.8, F, 39.9, -24.9, F + 0.48, 40.9, '#5e7a6c'); // sofa
    k.block(-28.8, F, 40.9, -24.9, F + 1.02, 41.3, '#526c60');
    k.block(-29.2, F, 39.9, -28.8, F + 0.72, 41.3, '#526c60');
    k.block(-24.9, F, 39.9, -24.5, F + 0.72, 41.3, '#526c60');
    box(-28.6, F + 0.48, 40, -26.95, F + 0.6, 40.85, '#6a8a7a');
    box(-26.8, F + 0.48, 40, -25.1, F + 0.6, 40.85, '#6a8a7a');
    box(-28.5, F + 0.6, 40.45, -28, F + 0.85, 40.85, '#c4a03c'); // cushion
    k.block(-27.8, F, 38.2, -25.8, F + 0.42, 39.1, '#5b4330'); // coffee table
    box(-27.85, F + 0.42, 38.15, -25.75, F + 0.47, 39.15, '#6b4f38');
    this.mug(k, -27.2, F + 0.47, 38.7);
    this.mug(k, -26.3, F + 0.47, 38.4, '#3f7b88');
    box(-26.9, F + 0.47, 38.45, -26.5, F + 0.5, 38.85, '#c8c3b5'); // a magazine
    k.block(-28.6, F, 36.1, -25, F + 0.55, 36.75, '#3b2c20'); // TV stand
    k.block(-28.2, F + 0.55, 36.2, -25.4, F + 2.1, 36.4, '#17171a');
    const tv = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.36), basicMat({ map: this.tv.t, fog: false }));
    tv.position.set(-26.8, F + 1.33, 36.41);
    k.group.add(tv);
    // bookshelf
    k.block(-34.8, F, 36.1, -31.2, F + 2.4, 36.6, '#4a3424', true);
    const books = ['#9b3b2f', '#c4a03c', '#3f7b88', '#d8d0bc', '#4a5b39', '#6e3f5c', '#c96a3a', '#2f3b4d'];
    for (let lv = 0; lv < 4; lv++) {
      box(-34.7, F + 0.2 + lv * 0.56, 36.6, -31.3, F + 0.26 + lv * 0.56, 36.68, '#2e2016');
      for (let x = -34.65, n = lv * 3 + 1; x < -31.5; n += 3) {
        const w = 0.07 + ((n * 5) % 4) * 0.025, h = 0.34 + ((n * 7) % 3) * 0.05;
        if ((n * 11) % 9 !== 0) box(x, F + 0.26 + lv * 0.56, 36.6, x + w, F + 0.26 + lv * 0.56 + h, 36.72, books[n % books.length]);
        x += w + 0.01;
      }
    }
    // floor lamp + side table
    k.block(-22.45, F, 43.25, -21.95, F + 0.05, 43.75, '#3a3c3e');
    box(-22.24, F, 43.46, -22.16, F + 1.55, 43.54, '#3a3c3e');
    glow(-22.45, F + 1.55, 43.25, -21.95, F + 1.95, 43.75, '#ffd590');
    k.block(-24.45, F, 40.1, -23.75, F + 0.55, 40.8, '#5b4330');
    this.mug(k, -24.1, F + 0.55, 40.4);
    // a plant by the window
    k.block(-33.9, F, 43.4, -33.3, F + 0.5, 44, '#8a5a3a');
    box(-34.1, F + 0.5, 43.2, -33.1, F + 1.2, 44.2, '#4f7a3a');
    box(-33.85, F + 1.2, 43.45, -33.35, F + 1.6, 43.95, '#5e8a44');
    // the work lanyard on a hook by the door, a coat, keys
    box(-29.55, F + 1.72, 44.42, -29.5, F + 1.78, 44.5, '#3a3c3e');
    box(-29.57, F + 1.25, 44.46, -29.54, F + 1.75, 44.48, '#3e7a5a');
    box(-29.51, F + 1.25, 44.46, -29.48, F + 1.75, 44.48, '#3e7a5a');
    box(-29.65, F + 1.02, 44.44, -29.38, F + 1.28, 44.48, '#e6e0d4');
    box(-29.6, F + 1.14, 44.43, -29.43, F + 1.24, 44.44, '#3e7a5a');
    box(-26.9, F + 1.72, 44.42, -26.85, F + 1.78, 44.5, '#3a3c3e');
    box(-27.15, F + 0.75, 44.3, -26.6, F + 1.75, 44.48, '#6e6a62'); // grey hoodie on a peg
    // inside of the front door
    box(-28.75, F, 44.44, -27.25, DOOR_TOP, 44.5, '#6b2f2a');
    box(-29, DOOR_TOP - 0.05, 44.4, -27, DOOR_TOP + 0.1, 44.5, '#3b2c20');
    p.cbox(-27.45, F + 1.05, 44.42, 0.08, 0.08, 0.05, { color: '#c4a03c' });
    // door to the garage
    box(-34.9, F, 37.35, -34.84, DOOR_TOP, 38.65, '#5a5448');
    box(-34.9, DOOR_TOP, 37.25, -34.82, DOOR_TOP + 0.1, 38.75, '#3b2c20');
    // trophy shelf + stash
    for (const y of [1.1, 1.65, 2.2]) k.block(-34.9, F + y, 41.4, -34.45, F + y + 0.06, 44.1, '#4a3424');
    k.block(-34.85, F, 39.8, -34, F + 1.0, 41.1, '#3f4346'); // safe
    box(-34.0, F + 0.12, 39.95, -33.98, F + 0.88, 40.95, '#55595c');
    p.cbox(-33.96, F + 0.5, 40.45, 0.04, 0.14, 0.14, { color: '#c4a03c' });
    glow(-33.98, F + 0.78, 40.75, -33.96, F + 0.82, 40.85, '#5aff8a');

    // ---- kitchen
    k.block(-20.2, F, 43.8, -12.1, F + 0.9, 44.45, '#7a6248'); // run under the window
    box(-20.25, F + 0.9, 43.72, -12.1, F + 0.96, 44.47, '#bdb5a2');
    box(-17, F + 0.91, 43.85, -15, F + 0.97, 44.35, '#8e9092'); // sink
    box(-16.05, F + 0.96, 44.3, -15.95, F + 1.3, 44.38, '#8e9092');
    k.block(-12.15, F, 37.6, -11.5, F + 0.9, 44.45, '#7a6248'); // run on the east wall
    box(-12.22, F + 0.9, 37.55, -11.5, F + 0.96, 44.45, '#bdb5a2');
    box(-12.12, F + 0.965, 39.8, -11.6, F + 0.98, 41, '#2a2a2c'); // hob
    for (const z of [40.1, 40.7]) glow(-11.95, F + 0.982, z - 0.1, -11.75, F + 0.986, z + 0.1, '#7a2f1e');
    k.block(-12.5, F, 36.15, -11.5, F + 2.1, 37.4, '#d8d6cf'); // fridge
    box(-12.54, F + 1.3, 36.3, -12.5, F + 2, 36.36, '#8e9092');
    box(-12.54, F + 0.2, 36.3, -12.5, F + 1.2, 36.36, '#8e9092');
    box(-12.52, F + 1.5, 36.6, -12.5, F + 1.75, 36.85, '#e6c84a'); // note on the fridge
    box(-13.6, F + 0.96, 43.9, -13.2, F + 1.3, 44.2, '#2a2a2c'); // coffee machine
    glow(-13.61, F + 1.2, 43.98, -13.6, F + 1.24, 44.02, '#ff5a2a');
    for (const [x, c] of [[-13.05, '#d8d0bc'], [-12.85, '#3f7b88'], [-14, '#c96a3a'], [-18.4, '#d8d0bc']] as [number, string][]) this.mug(k, x, F + 0.96, 44.05, c);
    box(-19.8, F + 0.96, 43.9, -19.1, F + 1.2, 44.3, '#9b3b2f'); // toaster + bread bin
    for (let x = -20.3; x < -12.3; x += 0) { if (x < -17.4 || x > -14.6) box(x, F + 1.65, 44.1, x + 1.4, F + 2.3, 44.45, '#6b533c'); x += 1.5; } // wall units
    k.block(-18.1, F, 39.5, -15.9, F + 0.76, 40.9, '#6b4f38'); // table
    box(-17.8, F + 0.76, 39.9, -17.2, F + 0.86, 40.5, '#8e9092'); // fruit bowl
    p.cbox(-17.6, F + 0.9, 40.1, 0.12, 0.12, 0.12, { color: '#c96a3a' });
    p.cbox(-17.4, F + 0.9, 40.3, 0.12, 0.12, 0.12, { color: '#9b3b2f' });
    box(-16.8, F + 0.76, 39.9, -16.3, F + 0.78, 40.3, '#e6e0d4'); // unopened bills
    this.mug(k, -16.5, F + 0.76, 40.6, '#3f7b88');
    for (const z of [38.9, 41.1]) {
      k.block(-17.3, F, z, -16.7, F + 0.46, z + 0.6, '#5b4330');
      const back = z < 40 ? z : z + 0.5;
      box(-17.3, F + 0.46, back, -16.7, F + 1.0, back + 0.1, '#5b4330');
    }
    box(-17.15, 2.35, 40.1, -16.85, TOP, 40.3, '#3a3c3e');
    glow(-17.35, 2.1, 39.95, -16.65, 2.38, 40.45, '#ffdf9e'); // pendant

    // ---- bedroom
    k.block(-33.7, F, 27.6, -31.5, F + 0.3, 30, '#4a3424'); // bed
    box(-33.65, F + 0.3, 27.65, -31.55, F + 0.56, 29.95, '#d8d0bc');
    box(-33.72, F + 0.56, 28.5, -31.48, F + 0.66, 30.02, '#3e5870'); // blanket, thrown back
    box(-33.3, F + 0.56, 27.75, -32.7, F + 0.7, 28.25, '#e6e0d4');
    box(-32.5, F + 0.56, 27.75, -31.9, F + 0.7, 28.25, '#e6e0d4');
    k.block(-33.8, F, 27.5, -31.4, F + 1.2, 27.62, '#4a3424');
    k.block(-31.25, F, 27.6, -30.55, F + 0.6, 28.3, '#5b4330'); // night stand
    box(-31.02, F + 0.6, 27.82, -30.78, F + 0.85, 28.08, '#3a3c3e');
    glow(-31.1, F + 0.85, 27.75, -30.7, F + 1.15, 28.15, '#ffc878');
    this.mug(k, -30.72, F + 0.6, 28.15);
    box(-33.8, F, 30.4, -30.8, F + 0.02, 32.2, '#7a5a3a'); // bedside rug
    // the desk + a chair with yesterday's shirt on it
    k.block(-34.85, F, 32.5, -34.1, F + 0.76, 34.7, '#5b4330');
    box(-34.75, F + 0.76, 32.7, -34.3, F + 0.78, 33.2, '#e6e0d4');
    box(-34.75, F + 0.78, 33.5, -34.2, F + 0.84, 34.1, '#3f4346'); // an old laptop
    this.mug(k, -34.4, F + 0.76, 34.4, '#c96a3a');
    k.block(-33.8, F, 33.2, -33.2, F + 0.46, 33.8, '#4a3424');
    box(-33.3, F + 0.46, 33.2, -33.2, F + 1.05, 33.8, '#4a3424');
    box(-33.75, F + 0.46, 33.25, -33.3, F + 0.56, 33.75, '#e6e0d4'); // crumpled shirt
    box(-33.62, F + 0.56, 33.32, -33.32, F + 0.62, 33.62, '#d8d0bc');
    box(-33.34, F + 0.72, 33.22, -33.18, F + 1.08, 33.72, '#e6e0d4');
    box(-33.28, F + 0.3, 33.42, -33.16, F + 0.98, 33.52, '#3e7a5a'); // the green tie
    // wardrobe
    k.block(-26.45, F, 29, -25.7, F + 2.5, 32.2, '#5b4330');
    box(-26.47, F + 0.1, 29.08, -26.45, F + 2.4, 30.55, '#6b4f38');
    box(-26.47, F + 0.1, 30.65, -26.45, F + 2.4, 32.12, '#6b4f38');
    p.cbox(-26.49, F + 1.2, 30.42, 0.03, 0.2, 0.05, { color: '#c4a03c' });
    p.cbox(-26.49, F + 1.2, 30.78, 0.03, 0.2, 0.05, { color: '#c4a03c' });
    // a cold look at the alley
    glow(-29, 1.3, 27.52, -27, 2.5, 27.54, '#54677c');
    box(-29.08, 1.22, 27.5, -26.92, 1.3, 27.58, '#3b2c20');
    box(-29.08, 2.5, 27.5, -26.92, 2.58, 27.58, '#3b2c20');
    box(-28.04, 1.3, 27.5, -27.96, 2.5, 27.58, '#3b2c20');

    // ---- bathroom
    k.block(-25.4, F, 27.6, -22.7, F + 0.6, 28.9, '#d8d6cf'); // tub
    box(-25.25, F + 0.6, 27.75, -22.85, F + 0.61, 28.75, '#7ca0a8');
    box(-25.35, F + 0.6, 27.6, -25.25, F + 2.1, 27.7, '#8e9092');
    k.block(-21.5, F, 30.6, -20.75, F + 0.42, 31.2, '#e6e0d4'); // toilet
    box(-21.05, F + 0.42, 30.6, -20.75, F + 1.0, 31.2, '#d8d6cf');
    k.block(-25.45, F, 32.7, -24.85, F + 0.85, 33.6, '#d8d6cf'); // sink
    box(-25.4, F + 0.85, 33.05, -25.3, F + 1.05, 33.25, '#8e9092');
    glow(-25.48, F + 1.15, 32.6, -25.46, F + 2.05, 33.7, '#9fb0b0'); // mirror
    box(-25.48, F + 1.08, 32.52, -25.44, F + 1.15, 33.78, '#5a6264');
    box(-25.46, F + 1.2, 34.3, -25.38, F + 1.65, 34.9, '#3f7b88'); // towel
    box(-24.6, F, 30.2, -23.2, F + 0.02, 31, '#3f7b88'); // bath mat
    this.mug(k, -25.15, F + 0.85, 33.45); // even in here
    k.block(-21.6, F, 34.6, -20.75, F + 1.3, 35.8, '#8a7a5a'); // laundry shelf
    box(-21.5, F + 0.5, 34.8, -20.85, F + 0.85, 35.6, '#c8c3b5');

    // ---- the hacker desk
    k.block(-18.6, F, 27.6, -12.9, F + 0.78, 28.75, '#2e3034');
    box(-18.65, F + 0.78, 27.55, -12.85, F + 0.83, 28.8, '#3e4146');
    const mon = (x: number, y: number, w: number, h: number, screen: string) => {
      box(x - w / 2 - 0.05, y - h / 2 - 0.05, 27.7, x + w / 2 + 0.05, y + h / 2 + 0.05, 27.85, '#17171a');
      if (screen) {
        glow(x - w / 2, y - h / 2, 27.85, x + w / 2, y + h / 2, 27.86, screen);
        for (let i = 0; i < Math.floor(h * 14); i++) {
          const ly = y + h / 2 - 0.04 - i * 0.07, lw = (0.3 + ((i * 13 + Math.abs(x * 7)) % 5) / 8) * w * 0.8;
          glow(x - w / 2 + 0.05, ly - 0.012, 27.86, x - w / 2 + 0.05 + lw, ly + 0.012, 27.865, i % 3 ? '#5aff8a' : '#46e6ff');
        }
      }
    };
    mon(-15.75, 1.55, 1.7, 0.92, ''); // the big one shows the live city
    mon(-17.6, 1.45, 1.0, 0.62, '#0e2230');
    mon(-13.9, 1.45, 1.0, 0.62, '#0e2230');
    mon(-17.5, 2.18, 0.9, 0.52, '#10202a');
    mon(-14, 2.18, 0.9, 0.52, '#10202a');
    const live = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.92), basicMat({ map: this.monitor.t, fog: false }));
    live.position.set(-15.75, 1.55, 27.87);
    k.group.add(live);
    box(-16.6, F + 0.83, 28.25, -15.2, F + 0.86, 28.6, '#1e2024'); // keyboard
    this.mug(k, -14.9, F + 0.83, 28.4);
    this.mug(k, -17.3, F + 0.83, 28.5, '#3f7b88');
    this.mug(k, -13.3, F + 0.83, 28.3, '#c96a3a');
    k.block(-12.85, F, 27.6, -12, F + 1.5, 28.8, '#1e2228'); // server tower
    for (let y = 0.3; y < 1.4; y += 0.22) glow(-12.84, F + y, 28.8, -12.2, F + y + 0.04, 28.81, y % 0.44 < 0.22 ? '#5aff8a' : '#46e6ff');
    k.block(-16.05, F, 29.5, -15.45, F + 0.48, 30.1, '#2a2c30'); // chair
    box(-16.05, F + 0.48, 30, -15.45, F + 1.15, 30.1, '#2a2c30');
    box(-13.3, F, 28.75, -13.2, F + 0.03, 29.7, '#17171a'); // cables
    box(-13.2, F, 29.6, -12.2, F + 0.03, 29.7, '#17171a');
    box(-12.3, F, 28.8, -12.2, F + 0.03, 29.7, '#17171a');
    // pinned-up map of the city with string on it
    box(-20.5, 1.2, 30.6, -20.46, 2.55, 34, '#c8bfa8');
    for (const [z, y, c] of [[31.2, 1.9, '#e0322a'], [32.3, 2.2, '#e0322a'], [33.2, 1.6, '#ffb000'], [31.9, 1.5, '#46e6ff']] as [number, number, string][]) box(-20.46, y, z, -20.44, y + 0.12, z + 0.16, c);
    box(-20.45, 1.95, 31.25, -20.44, 1.97, 32.35, '#9b3b2f');
    // shelf of model cars (the collection)
    for (const y of [1.0, 1.0 + 0.5]) k.block(-11.95, F + y, 30.5, -11.5, F + y + 0.05, 35, '#3a3c3e');
    k.block(-20.45, F, 34.9, -19.7, F + 0.5, 35.85, '#2a2c30'); // box of parts
    box(-20.3, F + 0.5, 35.05, -19.9, F + 0.65, 35.6, '#5a6264');

    this.refreshDisplays(k);

    // ---- what you can do here
    const ui = () => g.homeUi;
    s.interactables.push(
      { pos: new THREE.Vector3(-28, F, 43.9), radius: 1.4, label: 'Go outside', enabled: () => !g.player.vehicle, action: () => this.leave() },
      { pos: new THREE.Vector3(-34.2, F, 38), radius: 1.3, label: 'Door to the garage', enabled: () => !g.player.vehicle, action: () => { g.audio.door(); g.fadeTeleport(-36.1, F, 38, -Math.PI / 2, ''); } },
      { get label() { return g.police.heat > 0 ? 'Bed: too hot to sleep (lose the heat first)' : g.missions.run ? 'Bed: finish your mission first' : 'Sleep: save game, skip 8 hours'; }, pos: new THREE.Vector3(-32.6, F, 30.6), radius: 1.5, enabled: () => true, action: () => this.sleep() },
      { pos: new THREE.Vector3(-27, F, 30.6), radius: 1.5, label: 'Wardrobe: change outfit', enabled: () => true, action: () => g.shopUi.wardrobe() },
      { pos: new THREE.Vector3(-15.75, F, 30.5), radius: 1.5, label: 'Hacker desk', enabled: () => true, action: () => ui().open(['missions', 'homes', 'map', 'wardrobe', 'gallery', 'collection', 'rep', 'records', 'upgrades'], 'HACKER DESK') },
      { get label() { const v = g.loot.carriedValue; return v ? `Stash your loot ($${v.toLocaleString()})` : `Open the stash (${g.save.data.stash.length})`; }, pos: new THREE.Vector3(-33.3, F, 40.45), radius: 1.2, enabled: () => true, action: () => { if (g.loot.carriedValue) { g.loot.stashAll(); this.refreshDisplays(); } else ui().open(['stash'], 'STASH'); } },
      { pos: new THREE.Vector3(-33.6, F, 42.6), radius: 1.3, label: 'Trophy shelf', enabled: () => true, action: () => ui().open(['trophies'], 'TROPHIES') },
      { pos: new THREE.Vector3(-13.6, F, 43), radius: 1.2, label: 'Make coffee', enabled: () => g.hack.energy < 100, action: () => { g.hack.energy = 100; g.audio.pop(); g.hud.toast('COFFEE. HACK ENERGY FULL', 'cool'); } },
    );
  }

  // ------------------------------------------------------------------ garage
  private buildGarage(k: Kit, s: Site) {
    const g = this.g;
    this.setup(k);
    this.paint(k, GARAGE);
    k.solid(-45, F + 3.6, 27.5, -35, F + 3.9, 44.5, true, 'ceiling');
    const p = k.props;
    const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: string) => p.box(x0, y0, z0, x1, y1, z1, { color, shadeSides: true });
    k.glow.box(-40.7, F + 3.55, 34.7, -38.8, F + 3.6, 35.3, { color: '#ffe2a8' });
    k.glow.box(-40.7, F + 3.55, 41, -38.8, F + 3.6, 41.6, { color: '#ffe2a8' });
    // the parking bay
    for (const x of [-42.6, -36.9]) box(x, F, 29, x + 0.12, F + 0.01, 38, '#c4a03c');
    box(-42.6, F, 28.9, -36.78, F + 0.01, 29.02, '#c4a03c');
    // workbench, tools, tyres
    k.block(-44.45, F, 30, -43.5, F + 0.9, 36, '#5b4330');
    box(-44.5, F + 0.9, 29.95, -43.45, F + 0.96, 36.05, '#6b4f38');
    box(-44.48, F + 1.25, 30.2, -44.44, F + 2.3, 35.8, '#8a7a5a'); // pegboard
    for (let z = 30.5; z < 35.5; z += 0.8) box(-44.44, F + 1.45, z, -44.41, F + 2.05, z + 0.1, z % 1.6 < 0.8 ? '#8e9092' : '#9b3b2f');
    box(-44.3, F + 0.96, 31.5, -43.8, F + 1.2, 32.2, '#9b3b2f'); // tool chest
    this.mug(k, -43.9, F + 0.96, 33);
    for (let i = 0; i < 3; i++) k.block(-44.4, F + i * 0.26, 27.6, -43.5, F + 0.24 + i * 0.26, 28.5, '#1e1e20');
    k.block(-40, F, 27.55, -36, F + 2.2, 28, '#3a3c3e'); // shelving
    for (const [x, y, c] of [[-39.6, 0.5, '#c4a03c'], [-38.8, 0.5, '#3f7b88'], [-37.9, 1.3, '#9b3b2f'], [-37, 1.3, '#d8d0bc'], [-39, 1.3, '#4a5b39']] as [number, number, string][]) box(x, F + y, 28, x + 0.3, F + y + 0.35, 28.14, c);
    box(-38.6, F + 0.005, 32, -37.7, F + 0.012, 33, '#2a2826'); // oil stain
    // door through to the flat
    box(-35.16, F, 37.35, -35.1, DOOR_TOP, 38.65, '#5a5448');
    s.interactables.push(
      { pos: new THREE.Vector3(-35.7, F, 38), radius: 1.3, label: 'Door to the flat', enabled: () => !g.player.vehicle, action: () => { g.audio.door(); g.fadeTeleport(-33.6, F, 38, Math.PI / 2, ''); } },
    );
  }

  // ------------------------------------------------------------------ door, bed
  enter() {
    const g = this.g;
    g.audio.door();
    g.fadeTeleport(-28, F, 43.2, Math.PI, 'HOME');
  }

  leave() {
    const g = this.g;
    g.audio.door();
    g.fadeTeleport(Home.DOOR_OUT.x, CURB_H, Home.DOOR_OUT.z, 0, g.police.heat > 0 ? 'THEY ARE STILL OUT HERE' : '');
  }

  sleep() {
    const g = this.g;
    if (g.police.heat > 0) { g.hud.toast('TOO HOT TO SLEEP — HEAT MUST BE ZERO', 'dim'); g.audio.deny(); return; }
    if (g.missions.run) { g.hud.toast('FINISH YOUR MISSION FIRST', 'dim'); g.audio.deny(); return; }
    const P = g.player.pos;
    g.fadeTeleport(P.x, P.y, P.z, g.player.heading, 'GAME SAVED — 8 HOURS LATER', () => {
      g.world.skipHours(8);
      g.save.data.hour = g.world.hour;
      g.save.commit();
      if (g.loot.carriedValue) g.hud.hint('Carried loot is not saved. Stash it in the safe.');
    });
  }

  // ------------------------------------------------------------------ garage + collection
  /** back in a new world: the stored car waits in the bay */
  onWorldReset() {
    this.car = null;
    this.roll = 0;
    const s = this.g.save.data.garage;
    if (s) this.placeStored(s);
  }

  private placeStored(s: OwnedVehicle) {
    const g = this.g;
    const v = new Vehicle(s.kind as CarKind, s.color, g.col);
    v.place(Home.BAY.x, Home.BAY.z, 0);
    v.handbrake = true;
    g.addVehicle(v);
    this.car = v;
  }

  /** swap the bay's car for one you already own */
  fetch(o: OwnedVehicle) {
    const g = this.g;
    if (this.car && this.car !== g.player.vehicle) g.removeVehicle(this.car);
    g.save.data.garage = o;
    this.placeStored(o);
    g.hud.toast(`${o.label.toUpperCase()} IS IN THE GARAGE`, 'cool');
  }

  private park(v: Vehicle) {
    const g = this.g;
    if (v.wrecked) { g.hud.toast('TOO WRECKED TO KEEP', 'dim'); g.audio.deny(); return; }
    const s = g.save.data;
    const known = s.ownedVehicles.some((o) => o.kind === v.kind && o.color === v.color);
    const entry: OwnedVehicle = { kind: v.kind, color: v.color, label: RARES.find((r) => r.id === v.rareId)?.name ?? `${g.news.colorName(v.color)} ${v.label.toLowerCase()}` };
    if (!known) s.ownedVehicles.push(entry);
    s.garage = entry;
    g.fadeTeleport(-37, F, 40, Math.PI, known || v.rareId ? 'PARKED' : `NEW IN THE COLLECTION: ${entry.label.toUpperCase()} (${s.ownedVehicles.length})`, () => {
      g.player.exitVehicle(true);
      if (this.car && this.car !== v) g.removeVehicle(this.car);
      const i = g.parked.indexOf(v);
      if (i >= 0) g.parked.splice(i, 1);
      v.place(Home.BAY.x, Home.BAY.z, 0);
      v.handbrake = true;
      v.locked = false;
      v.repair();
      this.car = v;
      g.collection.onPark(v);
      this.refreshDisplays();
    });
    g.audio.unlock();
  }

  // ------------------------------------------------------------------ what's on the shelves
  refreshDisplays(kit?: Kit) {
    const k = kit ?? this.site.kit;
    if (!k) return;
    if (this.display) {
      this.display.parent?.remove(this.display);
      this.display.geometry.dispose();
    }
    const s = this.g.save.data;
    const b = new GeoBuilder();
    // a cup per finished mission
    const cups = Object.keys(s.completed);
    cups.forEach((id, i) => {
      const y = F + 1.16 + Math.floor(i / 6) * 0.55, z = 41.65 + (i % 6) * 0.42;
      const c = id === 'bank_heist' ? '#e6c84a' : '#c8a060';
      b.box(-34.85, y, z - 0.09, -34.6, y + 0.05, z + 0.09, { color: '#3a3c3e' });
      b.box(-34.8, y + 0.05, z - 0.03, -34.65, y + 0.14, z + 0.03, { color: c });
      b.box(-34.86, y + 0.14, z - 0.09, -34.59, y + 0.32, z + 0.09, { color: c });
    });
    // stash goods on the top shelf
    s.stash.slice(0, 14).forEach((it, i) => {
      const z = 41.6 + (i % 7) * 0.36, y = F + 2.26 + 0, cols = ['#9fe8ff', '#ff9ad8', '#e6c84a', '#d8d0bc', '#9b3b2f'];
      b.box(-34.85, y, z, -34.55, y + 0.14 + (i % 3) * 0.05, z + 0.26, { color: cols[it.name.length % cols.length], shadeSides: true });
    });
    // cash earned, in bricks on the safe
    const bricks = Math.min(24, Math.ceil(s.earned / 1000));
    for (let i = 0; i < bricks; i++) {
      const z = 39.9 + (i % 4) * 0.28, x = -34.75 + (Math.floor(i / 4) % 2) * 0.32, y = F + 1 + Math.floor(i / 8) * 0.1;
      b.box(x, y, z, x + 0.28, y + 0.09, z + 0.25, { color: i % 2 ? '#6d9a4a' : '#7ea858', shadeSides: true });
    }
    // model cars
    s.ownedVehicles.slice(0, 16).forEach((o, i) => {
      const z = 30.7 + (i % 8) * 0.52, y = F + 1.05 + Math.floor(i / 8) * 0.55, wide = o.kind === 'bus' || o.kind === 'boxtruck';
      b.box(-11.92, y + 0.03, z, -11.62, y + 0.13, z + (wide ? 0.44 : 0.36), { color: o.color, shadeSides: true });
      b.box(-11.88, y + 0.13, z + 0.08, -11.66, y + 0.2, z + 0.26, { color: o.color });
      b.box(-11.93, y, z + 0.04, -11.61, y + 0.04, z + 0.12, { color: '#17171a' });
      b.box(-11.93, y, z + 0.24, -11.61, y + 0.04, z + 0.32, { color: '#17171a' });
    });
    if (b.empty) { this.display = null; return; }
    bake(b);
    this.display = new THREE.Mesh(b.build(), material());
    k.group.add(this.display);
  }

  /** where officers wait for you when you've gone inside */
  stakeout(i: number) {
    const a = (i % 6) / 5 - 0.5, row = 1 + Math.floor(i / 6), D = this.doorOut;
    return { x: D.x + a * 9, z: D.z + D.dz * (2.2 + row * 0.8) };
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number, realDt: number) {
    const g = this.g;
    const P = g.player.worldPos;
    const v = g.player.vehicle;
    this.hintT -= realDt;
    this.farGlow.visible = !this.site.kit;

    // warmer light on you the moment you're in
    this.warm = damp(this.warm, this.inHouse || (this.inside && !v) ? 1 : 0, 9, realDt);
    g.post.warm = this.warm;
    const env = g.env;
    env.hemi.color.copy(this.hemiSky).lerp(this.warmSky, this.warm);
    env.hemi.groundColor.copy(this.hemiGround).lerp(this.warmGround, this.warm);
    if (this.warm > 0.01) env.hemi.intensity = THREE.MathUtils.lerp(env.hemi.intensity, 1.5, this.warm);

    // garage door: opens for you when it's safe, and always lets you out
    const near = Math.hypot(P.x + 39.75, P.z - 45) < (v ? 16 : 7);
    const inGarage = g.siteAt(P.x, P.z, P.y) === 'homegarage';
    const open = inGarage || (near && g.police.heat === 0);
    if (near && !open && this.hintT <= 0) { g.hud.hint('The garage stays shut while the police are on you.'); this.hintT = 6; }
    const prev = this.roll;
    this.roll = damp(this.roll, open ? 1 : 0, 4, dt);
    if (Math.abs(prev - this.roll) > 0.001) this.rollMesh.position.y = CURB_H + this.roll * 3.15;
    this.rollCol.enabled = this.roll < 0.82;

    // park here
    if (v && inGarage && v.speedAbs < 3.5 && !g.carAction) {
      const known = g.save.data.ownedVehicles.some((o) => o.kind === v.kind && o.color === v.color);
      g.carAction = { label: known ? (v.health < 0.999 ? 'Park it: free repair' : 'Park it in the garage') : `Park and repair: add ${v.label.toLowerCase()} to the collection`, action: () => this.park(v) };
    }

    if (!this.inHouse) return;
    this.tvT -= realDt;
    if (this.tvT <= 0) { this.tvT = 1 / 12; this.drawTv(); }
    this.monT -= realDt;
    if (this.monT <= 0) { this.monT = 0.4; this.drawMonitor(); }
  }

  private drawTv() {
    const { x: c, t } = this.tv, g = this.g;
    c.imageSmoothingEnabled = false;
    c.fillStyle = '#16304a';
    c.fillRect(0, 0, 192, 108);
    // the skyline behind the anchor desk
    c.fillStyle = '#20486a';
    for (let i = 0; i < 12; i++) { const h = 16 + ((i * 37) % 26); c.fillRect(i * 16, 74 - h, 13, h); }
    c.fillStyle = g.police.heat > 0 ? '#e0322a' : '#e0a030';
    for (let i = 0; i < 12; i++) if ((i * 7 + Math.floor(g.time)) % 5 === 0) c.fillRect(i * 16 + 4, 66 - ((i * 37) % 22), 3, 3);
    c.fillStyle = '#c0281e';
    c.fillRect(0, 0, 192, 18);
    c.fillStyle = '#fff1d0';
    c.font = '16px VT323, monospace';
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    c.fillText('CITY NEWS', 6, 10);
    c.textAlign = 'right';
    c.fillText(`${String(Math.floor(g.world.hour)).padStart(2, '0')}:${String(Math.floor((g.world.hour % 1) * 60)).padStart(2, '0')}`, 186, 10);
    c.fillStyle = '#0d1a28';
    c.fillRect(0, 74, 192, 34);
    c.fillStyle = '#ffd24a';
    c.font = '20px VT323, monospace';
    c.textAlign = 'left';
    const msg = g.news.ticker;
    this.scroll -= 3;
    const w = c.measureText(msg).width;
    if (this.scroll < -w) this.scroll = 192;
    c.fillText(msg, this.scroll, 91);
    t.needsUpdate = true;
  }

  private drawMonitor() {
    const { x: c, t } = this.monitor, g = this.g;
    const base = g.hud.mapCanvas();
    c.imageSmoothingEnabled = false;
    c.fillStyle = '#0a1218';
    c.fillRect(0, 0, 128, 72);
    const E = g.hud.mapExtent, s = 72 / (E * 2);
    c.drawImage(base, 28, 0, 72, 72);
    const sx = (x: number) => 28 + (x + E) * s, sy = (z: number) => (z + E) * s;
    c.fillStyle = '#7dffb0';
    c.fillRect(sx(-28) - 1, sy(36) - 1, 3, 3);
    c.fillStyle = Math.sin(g.time * 6) > 0 ? '#e0322a' : '#2b5ce0';
    for (const u of g.police.units) c.fillRect(sx(u.pos.x) - 1, sy(u.pos.z) - 1, 2, 2);
    c.fillStyle = '#5aff8a';
    c.font = '10px monospace';
    c.textBaseline = 'top';
    c.textAlign = 'left';
    c.fillText('GRID', 2, 2);
    c.fillText(`H${g.police.heat}`, 2, 14);
    c.fillText(`C${g.police.units.length}`, 2, 26);
    t.needsUpdate = true;
  }
}
