// Vehicle meshes from merged boxes (vertex colours on the noise texture),
// in the boxy 1990s concept-art style. One builder per family.
import * as THREE from 'three';
import { PAL } from '../core/palette';
import { GeoBuilder } from '../world/geo';
import { worldMaterials } from '../world/materials';
import { basicMat, worldMat } from '../render/patch';
import { texNoise } from '../assets/textures';

export type CarKind =
  | 'bicycle' | 'scooter' | 'motorbike' | 'policemoto'
  | 'sedan' | 'hatchback' | 'taxi' | 'sports' | 'muscle' | 'pickup' | 'suv'
  | 'van' | 'boxtruck' | 'garbage' | 'foodtruck' | 'bus' | 'ambulance' | 'firetruck'
  | 'police' | 'swat';

export interface Dims { len: number; wid: number; h: number; wheelR: number; wheelBase: number; track: number; two: boolean; seatY: number; seatZ: number; }

export const DIMS: Record<CarKind, Dims> = {
  bicycle: { len: 1.8, wid: 0.5, h: 1.1, wheelR: 0.34, wheelBase: 1.1, track: 0, two: true, seatY: 0.25, seatZ: -0.15 },
  scooter: { len: 1.8, wid: 0.62, h: 1.1, wheelR: 0.25, wheelBase: 1.25, track: 0, two: true, seatY: 0.08, seatZ: -0.25 },
  motorbike: { len: 2.1, wid: 0.72, h: 1.2, wheelR: 0.33, wheelBase: 1.45, track: 0, two: true, seatY: 0.2, seatZ: -0.2 },
  policemoto: { len: 2.2, wid: 0.8, h: 1.25, wheelR: 0.33, wheelBase: 1.5, track: 0, two: true, seatY: 0.2, seatZ: -0.2 },
  sedan: { len: 4.4, wid: 1.9, h: 1.58, wheelR: 0.36, wheelBase: 2.6, track: 1.6, two: false, seatY: 0.12, seatZ: -0.3 },
  taxi: { len: 4.4, wid: 1.9, h: 1.58, wheelR: 0.36, wheelBase: 2.6, track: 1.6, two: false, seatY: 0.12, seatZ: -0.3 },
  police: { len: 4.5, wid: 1.92, h: 1.6, wheelR: 0.37, wheelBase: 2.65, track: 1.62, two: false, seatY: 0.12, seatZ: -0.3 },
  hatchback: { len: 3.8, wid: 1.8, h: 1.55, wheelR: 0.33, wheelBase: 2.35, track: 1.55, two: false, seatY: 0.1, seatZ: -0.1 },
  sports: { len: 4.3, wid: 1.96, h: 1.22, wheelR: 0.36, wheelBase: 2.6, track: 1.68, two: false, seatY: -0.05, seatZ: -0.4 },
  muscle: { len: 4.8, wid: 1.96, h: 1.4, wheelR: 0.38, wheelBase: 2.85, track: 1.66, two: false, seatY: 0.05, seatZ: -0.5 },
  pickup: { len: 5.1, wid: 2.0, h: 1.85, wheelR: 0.42, wheelBase: 3.1, track: 1.72, two: false, seatY: 0.35, seatZ: 0.4 },
  suv: { len: 4.7, wid: 2.0, h: 1.95, wheelR: 0.42, wheelBase: 2.8, track: 1.72, two: false, seatY: 0.35, seatZ: 0.0 },
  van: { len: 5.0, wid: 2.05, h: 2.3, wheelR: 0.4, wheelBase: 3.1, track: 1.72, two: false, seatY: 0.45, seatZ: 1.3 },
  foodtruck: { len: 5.8, wid: 2.2, h: 2.85, wheelR: 0.45, wheelBase: 3.5, track: 1.82, two: false, seatY: 0.5, seatZ: 1.8 },
  boxtruck: { len: 7.0, wid: 2.3, h: 3.15, wheelR: 0.48, wheelBase: 4.2, track: 1.9, two: false, seatY: 0.6, seatZ: 2.6 },
  garbage: { len: 7.4, wid: 2.4, h: 3.2, wheelR: 0.5, wheelBase: 4.3, track: 1.95, two: false, seatY: 0.6, seatZ: 2.8 },
  bus: { len: 10.6, wid: 2.5, h: 3.1, wheelR: 0.5, wheelBase: 6.2, track: 2.05, two: false, seatY: 0.5, seatZ: 4.4 },
  ambulance: { len: 5.6, wid: 2.2, h: 2.75, wheelR: 0.43, wheelBase: 3.4, track: 1.82, two: false, seatY: 0.5, seatZ: 1.7 },
  firetruck: { len: 8.6, wid: 2.45, h: 3.0, wheelR: 0.5, wheelBase: 4.8, track: 2.0, two: false, seatY: 0.6, seatZ: 3.2 },
  swat: { len: 5.4, wid: 2.2, h: 2.5, wheelR: 0.45, wheelBase: 3.3, track: 1.8, two: false, seatY: 0.5, seatZ: 1.5 },
};

export const LABELS: Record<CarKind, string> = {
  bicycle: 'Bicycle', scooter: 'Scooter', motorbike: 'Motorbike', policemoto: 'Police bike', sedan: 'Sedan', taxi: 'Taxi',
  police: 'Cruiser', hatchback: 'Hatchback', sports: 'Sports car', muscle: 'Muscle car', pickup: 'Pickup', suv: 'SUV',
  van: 'Delivery van', foodtruck: 'Food truck', boxtruck: 'Box truck', garbage: 'Garbage truck', bus: 'City bus',
  ambulance: 'Ambulance', firetruck: 'Fire truck', swat: 'SWAT van',
};

export interface CarParts {
  root: THREE.Group;
  body: THREE.Group; // tilts for roll/pitch/lean
  bodyMesh: THREE.Mesh;
  wheels: THREE.Object3D[];
  brake: THREE.Mesh;
  head: THREE.Mesh;
  red?: THREE.Mesh;
  blue?: THREE.Mesh;
  dims: Dims;
}

const geoCache = new Map<string, { body: THREE.BufferGeometry; glow: THREE.BufferGeometry }>();
let wheelGeo: THREE.BufferGeometry | null = null;
let wheelMat: THREE.Material | null = null;
let headMat: THREE.Material | null = null;
let hubMat: THREE.Material | null = null;
const hubGeo = new THREE.BoxGeometry(1.1, 0.5, 0.5), spokeGeo = new THREE.BoxGeometry(1.2, 1.8, 0.08);

const dark = '#2a2a2a', trim = '#3c3c3c';

/** Classic 3-box car family: sedan / taxi / police / hatchback / sports / muscle / suv / pickup. */
function carBody(g: GeoBuilder, gl: GeoBuilder, kind: CarKind, color: string, d: Dims) {
  const L = d.len / 2, W = d.wid / 2;
  const isCop = kind === 'police';
  const low = isCop ? PAL.copBlack : color;
  const roof = isCop ? PAL.copWhite : kind === 'muscle' ? '#1e1e1e' : color;
  const beltY = kind === 'sports' ? 0.78 : kind === 'suv' || kind === 'pickup' ? 1.15 : 0.98;
  const bot = kind === 'suv' || kind === 'pickup' ? 0.42 : 0.32;
  g.box(-W, bot, -L, W, beltY, L, { color: low, shadeSides: true });
  if (isCop) {
    g.box(-W - 0.015, 0.4, -1.15, W + 0.015, beltY - 0.01, 0.95, { color: PAL.copWhite, skip: { py: true, ny: true, pz: true, nz: true } });
    g.box(-0.6, 0.45, L + 0.08, 0.6, 0.85, L + 0.22, { color: '#1a1a1a' }); // push bar
  }
  // cabin extents per style
  let cz0 = -1.2, cz1 = 0.85, ch = 0.52;
  if (kind === 'hatchback') { cz0 = -L + 0.15; cz1 = 0.6; ch = 0.58; }
  if (kind === 'sports') { cz0 = -1.1; cz1 = 0.5; ch = 0.42; }
  if (kind === 'muscle') { cz0 = -1.3; cz1 = 0.55; ch = 0.45; }
  if (kind === 'suv') { cz0 = -L + 0.2; cz1 = 1.0; ch = 0.7; }
  if (kind === 'pickup') { cz0 = -0.1; cz1 = 1.35; ch = 0.68; }
  const cy0 = beltY, cy1 = beltY + ch;
  g.box(-W + 0.1, cy0, cz0, W - 0.1, cy1, cz1, { color: PAL.carGlass });
  for (const x of [-W + 0.08, W - 0.18]) for (const z of [cz0 - 0.02, (cz0 + cz1) / 2 - 0.05, cz1 - 0.08]) g.box(x, cy0, z, x + 0.1, cy1, z + 0.1, { color: roof });
  g.box(-W + 0.06, cy1, cz0 - 0.05, W - 0.06, cy1 + 0.08, cz1 + 0.02, { color: roof, shadeSides: true });
  // hood / trunk lips
  g.box(-W + 0.05, beltY, cz1 + 0.15, W - 0.05, beltY + 0.05, L - 0.05, { color: low });
  if (kind === 'pickup') {
    // open bed with side walls
    g.box(-W, beltY, -L, -W + 0.12, beltY + 0.45, cz0 - 0.1, { color: low });
    g.box(W - 0.12, beltY, -L, W, beltY + 0.45, cz0 - 0.1, { color: low });
    g.box(-W, beltY, -L, W, beltY + 0.45, -L + 0.12, { color: low });
    g.box(-W + 0.12, beltY - 0.05, -L + 0.12, W - 0.12, beltY + 0.01, cz0 - 0.1, { color: '#3a3a3a' });
  } else if (kind !== 'hatchback' && kind !== 'suv') g.box(-W + 0.05, beltY, -L + 0.05, W - 0.05, beltY + 0.06, cz0 - 0.1, { color: low });
  // bumpers, grille, mirrors, sills
  g.box(-W - 0.02, bot - 0.02, L, W + 0.02, bot + 0.2, L + 0.08, { color: trim });
  g.box(-W - 0.02, bot - 0.02, -L - 0.08, W + 0.02, bot + 0.2, -L, { color: trim });
  g.box(-0.45, bot + 0.28, L, 0.45, beltY - 0.12, L + 0.02, { color: dark });
  g.box(-W - 0.12, beltY + 0.02, cz1 - 0.1, -W, beltY + 0.14, cz1 + 0.07, { color: low });
  g.box(W, beltY + 0.02, cz1 - 0.1, W + 0.12, beltY + 0.14, cz1 + 0.07, { color: low });
  g.box(-W - 0.005, bot, -0.25, W + 0.005, bot + 0.13, 0.25, { color: dark, skip: { py: true, ny: true, pz: true, nz: true } });
  // style extras
  if (kind === 'taxi') {
    g.box(-0.35, cy1 + 0.08, -0.4, 0.35, cy1 + 0.3, 0.0, { color: '#e8d26a' });
    g.box(-W - 0.01, 0.62, -1.1, W + 0.01, 0.7, 0.9, { color: '#2a2a2a', skip: { py: true, ny: true, pz: true, nz: true } });
  }
  if (kind === 'sports') { g.box(-W + 0.1, beltY + 0.25, -L + 0.05, W - 0.1, beltY + 0.31, -L + 0.4, { color: dark }); for (const x of [-W + 0.2, W - 0.3]) g.box(x, beltY, -L + 0.2, x + 0.1, beltY + 0.25, -L + 0.3, { color: dark }); }
  if (kind === 'muscle') { g.box(-0.35, beltY, 1.1, 0.35, beltY + 0.14, 1.9, { color: dark }); g.box(-0.25, beltY + 0.001, -L, 0.25, beltY + 0.06, L, { color: '#e6e0d4', skip: { ny: true } }); }
  if (kind === 'suv') { g.box(-W + 0.2, cy1 + 0.08, cz0 + 0.3, -W + 0.28, cy1 + 0.16, cz1 - 0.3, { color: dark }); g.box(W - 0.28, cy1 + 0.08, cz0 + 0.3, W - 0.2, cy1 + 0.16, cz1 - 0.3, { color: dark }); }
  if (isCop) g.box(-0.75, cy1 + 0.08, -0.45, 0.75, cy1 + 0.16, -0.15, { color: '#2a2a2a' });
  const hy = bot + 0.35;
  gl.box(-W + 0.12, hy, L - 0.02, -W + 0.5, hy + 0.16, L + 0.03, { color: PAL.headlight });
  gl.box(W - 0.5, hy, L - 0.02, W - 0.12, hy + 0.16, L + 0.03, { color: PAL.headlight });
  return cy1 + 0.08;
}

/** Cab-over box family: van / food truck / box truck / garbage / ambulance / fire / bus / swat. */
function boxBody(g: GeoBuilder, gl: GeoBuilder, kind: CarKind, color: string, d: Dims) {
  const L = d.len / 2, W = d.wid / 2, H = d.h;
  const cabLen = kind === 'bus' ? 0 : kind === 'van' || kind === 'swat' || kind === 'ambulance' ? 1.0 : 1.9;
  const cab = kind === 'garbage' ? '#e6e0d4' : kind === 'boxtruck' ? color : kind === 'firetruck' ? '#a8261e' : color;
  const box = kind === 'boxtruck' ? '#d8d6cf' : kind === 'garbage' ? '#3f5a34' : kind === 'firetruck' ? '#a8261e' : kind === 'ambulance' ? '#e6e4dc' : kind === 'swat' ? '#232b3a' : color;
  const bot = 0.45;
  if (kind === 'bus') {
    g.box(-W, bot, -L, W, H - 0.1, L, { color, shadeSides: true });
    g.box(-W - 0.01, 1.3, -L + 0.6, W + 0.01, 2.4, L - 1.2, { color: PAL.carGlass, skip: { py: true, ny: true, pz: true, nz: true } });
    for (let z = -L + 1.4; z < L - 1.2; z += 1.5) g.box(-W - 0.02, 1.3, z, W + 0.02, 2.4, z + 0.12, { color, skip: { py: true, ny: true, pz: true, nz: true } });
    g.box(-W + 0.08, 1.2, L - 0.02, W - 0.08, 2.6, L + 0.02, { color: PAL.carGlass });
    g.box(-W - 0.02, 0.8, -L + 0.4, W + 0.02, 1.0, L - 0.4, { color: '#c4a03c', skip: { py: true, ny: true } });
    g.box(-0.8, H - 0.1, -1.5, 0.8, H + 0.15, 1.0, { color: '#6a6a64' });
    g.box(-W + 0.4, 2.65, L + 0.01, W - 0.4, 2.95, L + 0.04, { color: '#1a1a1a' });
    gl.box(-W + 0.4, 2.7, L + 0.03, W - 0.4, 2.9, L + 0.05, { color: '#ffb000' }); // route sign
  } else {
    // cab
    g.box(-W, bot, L - cabLen, W, H * 0.62, L, { color: cab, shadeSides: true });
    g.box(-W + 0.06, H * 0.62, L - cabLen, W - 0.06, H - 0.15, L - 0.3, { color: cab });
    g.box(-W + 0.08, H * 0.42, L - 0.05, W - 0.08, H * 0.62 + 0.4, L + 0.0, { color: PAL.carGlass });
    g.box(-W - 0.01, H * 0.45, L - cabLen + 0.15, W + 0.01, H * 0.62 + 0.25, L - 0.35, { color: PAL.carGlass, skip: { py: true, ny: true, pz: true, nz: true } });
    // body box
    g.box(-W, bot, -L, W, H, L - cabLen - (cabLen > 1.2 ? 0.08 : 0), { color: box, shadeSides: true });
    g.box(-W, 0.3, -L - 0.06, W, 0.55, L + 0.06, { color: dark, skip: { py: true } });
    if (kind === 'ambulance') {
      g.box(-W - 0.02, 1.1, -L + 0.2, W + 0.02, 1.35, L - 0.2, { color: '#b8231c', skip: { py: true, ny: true } });
      g.box(-0.3, 1.6, -L - 0.03, 0.3, 2.2, -L, { color: '#b8231c' });
      g.box(-0.1, 1.5, -L - 0.03, 0.1, 2.3, -L, { color: '#b8231c' });
    } else if (kind === 'firetruck') {
      g.box(-W - 0.02, 1.0, -L + 0.2, W + 0.02, 1.15, L - 0.2, { color: '#e6e0d4', skip: { py: true, ny: true } });
      for (const x of [-0.5, 0.5]) g.box(x - 0.06, H + 0.05, -L + 0.3, x + 0.06, H + 0.17, L - 2.2, { color: '#c8c3b5' });
      for (let z = -L + 0.6; z < L - 2.2; z += 0.5) g.box(-0.5, H + 0.05, z, 0.5, H + 0.12, z + 0.06, { color: '#c8c3b5' });
      for (let z = -L + 0.5; z < L - 2.4; z += 1.0) g.box(-W - 0.02, 0.6, z, W + 0.02, 0.95, z + 0.8, { color: '#8a8a84', skip: { py: true, ny: true, pz: true, nz: true } });
    } else if (kind === 'garbage') {
      g.box(-W + 0.1, H * 0.6, -L - 0.4, W - 0.1, H - 0.2, -L, { color: '#2f4a28' });
      for (let z = -L + 0.4; z < L - 2.2; z += 0.6) g.box(-W - 0.02, 1.2, z, W + 0.02, H - 0.2, z + 0.08, { color: '#2f4a28', skip: { py: true, ny: true, pz: true, nz: true } });
    } else if (kind === 'foodtruck') {
      g.box(W - 0.01, 1.3, -1.6, W + 0.02, 2.2, 0.6, { color: '#2a2a2a' });
      g.box(W, 2.25, -1.8, W + 0.9, 2.32, 0.8, { color: '#c4a03c' });
      g.box(W - 0.01, 2.35, -1.8, W + 0.02, 2.65, 0.8, { color: '#e6e0d4' });
      gl.box(W + 0.01, 1.35, -1.55, W + 0.03, 2.15, 0.55, { color: '#d9b878' });
      g.box(-0.4, H, -1.2, 0.4, H + 0.6, 0.2, { color: '#9b3b2f' });
    } else if (kind === 'boxtruck') {
      g.box(-W - 0.02, 1.5, -L + 0.5, W + 0.02, 2.4, L - 2.5, { color: '#2f3b4d', skip: { py: true, ny: true, pz: true, nz: true } });
    } else if (kind === 'van') {
      g.box(-W - 0.02, 1.25, -L + 0.3, W + 0.02, 1.38, L - 1.2, { color: '#9b3b2f', skip: { py: true, ny: true } });
    } else if (kind === 'swat') {
      g.box(-W - 0.02, 1.0, -L + 0.4, W + 0.02, 1.25, L - 1.3, { color: '#c9a245', skip: { py: true, ny: true } });
      g.box(-0.9, H - 0.1, -1.2, 0.9, H + 0.02, 0.2, { color: '#1a1f28' });
    }
  }
  gl.box(-W + 0.15, 0.85, L + 0.0, -W + 0.5, 1.05, L + 0.04, { color: PAL.headlight });
  gl.box(W - 0.5, 0.85, L + 0.0, W - 0.15, 1.05, L + 0.04, { color: PAL.headlight });
  return H;
}

/** Two-wheelers: bicycle / scooter / motorbike / police bike. */
function twoBody(g: GeoBuilder, gl: GeoBuilder, kind: CarKind, color: string, d: Dims) {
  const hb = d.wheelBase / 2, r = d.wheelR;
  if (kind === 'bicycle') {
    const c = color;
    g.box(-0.03, r + 0.1, -hb, 0.03, r + 0.16, hb - 0.15, { color: c }); // top tube
    g.box(-0.03, r, -hb + 0.1, 0.03, r + 0.55, -hb + 0.18, { color: c }); // seat tube
    g.box(-0.03, r - 0.05, -0.1, 0.03, r + 0.15, 0.1, { color: c });
    g.box(-0.03, r, hb - 0.12, 0.03, r + 0.62, hb - 0.05, { color: c }); // fork
    g.box(-0.3, r + 0.6, hb - 0.12, 0.3, r + 0.65, hb - 0.06, { color: '#1a1a1a' }); // bars
    g.box(-0.08, r + 0.56, -hb + 0.05, 0.08, r + 0.62, -hb + 0.3, { color: '#1a1a1a' }); // saddle
  } else {
    const c = kind === 'policemoto' ? '#dcdad2' : color;
    const isScoot = kind === 'scooter';
    g.box(-0.16, r - 0.05, -hb + 0.1, 0.16, r + (isScoot ? 0.08 : 0.3), hb - 0.2, { color: isScoot ? c : '#2a2a2a', shadeSides: true });
    if (isScoot) {
      g.box(-0.2, r + 0.08, -hb, 0.2, r + 0.45, -0.1, { color: c, shadeSides: true });
      g.box(-0.12, r, hb - 0.3, 0.12, r + 0.75, hb - 0.12, { color: c });
      g.box(-0.3, r + 0.75, hb - 0.28, 0.3, r + 0.8, hb - 0.2, { color: '#1a1a1a' });
      g.box(-0.18, r + 0.45, -hb + 0.05, 0.18, r + 0.52, -0.2, { color: '#1a1a1a' });
    } else {
      g.box(-0.2, r + 0.3, -0.05, 0.2, r + 0.55, 0.5, { color: c, shadeSides: true }); // tank
      g.box(-0.17, r + 0.32, -hb + 0.05, 0.17, r + 0.47, -0.05, { color: '#1a1a1a' }); // seat
      g.box(-0.04, r, hb - 0.1, 0.04, r + 0.65, hb - 0.02, { color: '#5a5a5a' }); // fork
      g.box(-0.38, r + 0.65, hb - 0.12, 0.38, r + 0.7, hb - 0.05, { color: '#1a1a1a' });
      g.box(-0.2, r + 0.45, hb - 0.12, 0.2, r + 0.75, hb + 0.05, { color: c }); // fairing
      g.box(-0.18, r - 0.02, -hb - 0.1, -0.1, r + 0.08, -0.2, { color: '#8a8a84' }); // exhaust
      if (kind === 'policemoto') { g.box(-0.24, r + 0.05, -hb + 0.1, 0.24, r + 0.4, -hb + 0.45, { color: '#1c1c1e' }); }
    }
    gl.box(-0.08, r + 0.55, hb + 0.02, 0.08, r + 0.65, hb + 0.06, { color: PAL.headlight });
  }
  return d.h;
}

function buildGeo(kind: CarKind, color: string) {
  const key = kind + color;
  const hit = geoCache.get(key);
  if (hit) return hit;
  const d = DIMS[kind];
  const g = new GeoBuilder();
  const gl = new GeoBuilder();
  if (d.two) twoBody(g, gl, kind, color, d);
  else if (['sedan', 'taxi', 'police', 'hatchback', 'sports', 'muscle', 'suv', 'pickup'].includes(kind)) carBody(g, gl, kind, color, d);
  else boxBody(g, gl, kind, color, d);
  const res = { body: g.build(), glow: gl.build() };
  geoCache.set(key, res);
  return res;
}

export function buildCar(kind: CarKind, color: string): CarParts {
  const d = DIMS[kind];
  const geo = buildGeo(kind, color);
  if (!headMat) headMat = basicMat({ vertexColors: true });
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const bm = new THREE.Mesh(geo.body, worldMaterials().props);
  bm.castShadow = true;
  bm.receiveShadow = true;
  body.add(bm);
  const head = new THREE.Mesh(geo.glow, headMat);
  body.add(head);
  const L = d.len / 2, W = d.wid / 2;
  const tg = new GeoBuilder();
  if (d.two) tg.box(-0.07, d.wheelR + 0.35, -L + 0.12, 0.07, d.wheelR + 0.45, -L + 0.17, { color: '#ffffff' });
  else {
    const ty = d.h > 2 ? 0.95 : 0.72;
    tg.box(-W + 0.1, ty, -L - 0.03, -W + 0.45, ty + 0.17, -L + 0.02, { color: '#ffffff' });
    tg.box(W - 0.45, ty, -L - 0.03, W - 0.1, ty + 0.17, -L + 0.02, { color: '#ffffff' });
  }
  const brake = new THREE.Mesh(tg.build(), basicMat({ color: PAL.taillight }));
  body.add(brake);
  if (!wheelGeo) {
    wheelGeo = new THREE.CylinderGeometry(1, 1, 1, 8).rotateZ(Math.PI / 2);
    wheelMat = worldMat({ map: texNoise(), color: PAL.tyre });
  }
  const wheels: THREE.Object3D[] = [];
  const spots: [number, number][] = d.two ? [[0, 1], [0, -1]] : [[1, 1], [-1, 1], [1, -1], [-1, -1]];
  for (const [sx, sz] of spots) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * (d.track / 2 + 0.02), d.wheelR, sz * d.wheelBase / 2);
    const w = new THREE.Mesh(wheelGeo, wheelMat!);
    w.scale.set(d.two ? (kind === 'bicycle' ? 0.05 : 0.14) : 0.28, d.wheelR, d.wheelR);
    if (!hubMat) hubMat = worldMat({ color: '#8a8a84' });
    w.add(new THREE.Mesh(kind === 'bicycle' ? spokeGeo : hubGeo, hubMat));
    pivot.add(w);
    root.add(pivot);
    wheels.push(pivot);
  }
  const parts: CarParts = { root, body, bodyMesh: bm, wheels, brake, head, dims: d };
  const bar = (rc: string, bc: string, y: number, z: number, w = 0.62, x = 0.36) => {
    const red = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, 0.3), basicMat({ color: rc }));
    red.position.set(-x, y, z);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, 0.3), basicMat({ color: bc }));
    blue.position.set(x, y, z);
    body.add(red, blue);
    parts.red = red;
    parts.blue = blue;
  };
  if (kind === 'police') bar(PAL.sirenRed, PAL.sirenBlue, d.h + 0.18, -0.3);
  if (kind === 'swat') bar(PAL.sirenRed, PAL.sirenBlue, d.h + 0.12, -0.5);
  if (kind === 'ambulance') bar(PAL.sirenRed, '#f0f0f0', d.h + 0.1, d.len / 2 - 0.6, 0.7, 0.6);
  if (kind === 'firetruck') bar(PAL.sirenRed, '#ff8a2a', d.h - 0.4, d.len / 2 - 0.4, 0.7, 0.7);
  if (kind === 'policemoto') bar(PAL.sirenRed, PAL.sirenBlue, d.wheelR + 0.9, d.wheelBase / 2 - 0.1, 0.1, 0.12);
  return parts;
}

/** Repaint (respray booth / chop shop): rebuild the body geometry with a new colour. */
export function repaint(parts: CarParts, kind: CarKind, color: string) {
  parts.bodyMesh.geometry = buildGeo(kind, color).body;
}
