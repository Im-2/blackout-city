// Boxy 1990s car meshes from merged boxes (vertex colours on the noise texture).
import * as THREE from 'three';
import { PAL } from '../core/palette';
import { GeoBuilder } from '../world/geo';
import { worldMaterials } from '../world/materials';
import { basicMat, worldMat } from '../render/patch';
import { texNoise } from '../assets/textures';

export type CarKind = 'sedan' | 'taxi' | 'police' | 'swat' | 'van';

export interface CarParts {
  root: THREE.Group;
  body: THREE.Group; // tilts for roll/pitch
  wheels: THREE.Object3D[]; // FL FR RL RR
  brake: THREE.Mesh;
  head: THREE.Mesh;
  red?: THREE.Mesh;
  blue?: THREE.Mesh;
  dims: { len: number; wid: number; h: number; wheelR: number; wheelBase: number; track: number };
}

const geoCache = new Map<string, { body: THREE.BufferGeometry; glow: THREE.BufferGeometry }>();
let wheelGeo: THREE.BufferGeometry | null = null;
let wheelMat: THREE.Material | null = null;

function dimsFor(kind: CarKind) {
  if (kind === 'swat') return { len: 5.4, wid: 2.2, h: 2.5, wheelR: 0.45, wheelBase: 3.3, track: 1.8 };
  if (kind === 'van') return { len: 5.0, wid: 2.05, h: 2.3, wheelR: 0.4, wheelBase: 3.1, track: 1.7 };
  return { len: 4.4, wid: 1.9, h: 1.58, wheelR: 0.36, wheelBase: 2.6, track: 1.6 };
}

function buildGeo(kind: CarKind, color: string) {
  const key = kind + color;
  const hit = geoCache.get(key);
  if (hit) return hit;
  const d = dimsFor(kind);
  const g = new GeoBuilder();
  const gl = new GeoBuilder();
  const L = d.len / 2, W = d.wid / 2;
  const dark = '#2a2a2a';
  const trim = '#3c3c3c';
  if (kind === 'swat' || kind === 'van') {
    const c = kind === 'swat' ? '#232b3a' : color;
    g.box(-W, 0.4, -L, W, d.h - 0.1, L - 1.0, { color: c, shadeSides: true });
    g.box(-W, 0.4, L - 1.0, W, 1.45, L, { color: c, shadeSides: true }); // nose
    g.box(-W + 0.06, 1.45, L - 1.0, W - 0.06, d.h - 0.35, L - 0.95, { color: PAL.carGlass }); // windshield
    g.box(-W - 0.01, 1.5, L - 1.9, W + 0.01, 2.0, L - 1.05, { color: PAL.carGlass, skip: { py: true, ny: true, pz: true, nz: true } });
    g.box(-W, 0.3, -L - 0.06, W, 0.55, L + 0.06, { color: dark, skip: { py: true } });
    if (kind === 'swat') {
      g.box(-W - 0.02, 1.0, -L + 0.4, W + 0.02, 1.25, L - 1.3, { color: '#c9a245', skip: { py: true, ny: true } }); // stripe
      g.box(-0.9, d.h - 0.1, -1.2, 0.9, d.h + 0.02, 0.2, { color: '#1a1f28' });
    } else {
      g.box(-W - 0.02, 1.2, -L + 0.3, W + 0.02, 1.32, L - 1.2, { color: '#9b3b2f', skip: { py: true, ny: true } });
    }
    gl.box(-W + 0.15, 0.85, L + 0.0, -W + 0.5, 1.05, L + 0.04, { color: PAL.headlight });
    gl.box(W - 0.5, 0.85, L + 0.0, W - 0.15, 1.05, L + 0.04, { color: PAL.headlight });
  } else {
    const isCop = kind === 'police';
    const low = isCop ? PAL.copBlack : color;
    const doors = isCop ? PAL.copWhite : color;
    const roof = isCop ? PAL.copWhite : color;
    // lower body
    g.box(-W, 0.32, -L, W, 0.98, L, { color: low, shadeSides: true });
    if (isCop) {
      g.box(-W - 0.015, 0.4, -1.15, W + 0.015, 0.97, 0.95, { color: doors, skip: { py: true, ny: true, pz: true, nz: true } });
      g.box(-0.5, 0.981, 1.35, 0.5, 0.99, 2.0, { color: '#d9d6cc' }); // hood star-ish plate
    }
    // hood slope hint + trunk lip
    g.box(-W + 0.05, 0.98, 1.0, W - 0.05, 1.03, L - 0.05, { color: low });
    g.box(-W + 0.05, 0.98, -L + 0.05, W - 0.05, 1.04, -1.25, { color: low });
    // cabin: glass box + pillars + roof
    const cz0 = -1.2, cz1 = 0.85, cy0 = 0.98, cy1 = 1.5;
    g.box(-W + 0.1, cy0, cz0, W - 0.1, cy1, cz1, { color: PAL.carGlass });
    for (const x of [-W + 0.08, W - 0.18]) {
      for (const z of [cz0 - 0.02, -0.2, cz1 - 0.08]) g.box(x, cy0, z, x + 0.1, cy1, z + 0.1, { color: roof });
    }
    g.box(-W + 0.06, cy1, cz0 - 0.05, W - 0.06, d.h, cz1 + 0.02, { color: roof, shadeSides: true });
    // bumpers, grille, mirrors, arches
    g.box(-W - 0.02, 0.3, L, W + 0.02, 0.52, L + 0.08, { color: trim });
    g.box(-W - 0.02, 0.3, -L - 0.08, W + 0.02, 0.52, -L, { color: trim });
    g.box(-0.45, 0.6, L, 0.45, 0.85, L + 0.02, { color: dark });
    g.box(-W - 0.12, 1.0, 0.75, -W, 1.12, 0.92, { color: low });
    g.box(W, 1.0, 0.75, W + 0.12, 1.12, 0.92, { color: low });
    g.box(-W - 0.005, 0.32, -0.25, W + 0.005, 0.45, 0.25, { color: dark, skip: { py: true, ny: true, pz: true, nz: true } }); // sill
    if (kind === 'taxi') {
      g.box(-0.35, d.h, -0.4, 0.35, d.h + 0.22, 0.0, { color: '#e8d26a' });
      g.box(-W - 0.01, 0.62, -1.1, W + 0.01, 0.7, 0.9, { color: '#2a2a2a', skip: { py: true, ny: true, pz: true, nz: true } });
    }
    if (isCop) {
      // light bar base
      g.box(-0.75, d.h, -0.45, 0.75, d.h + 0.08, -0.15, { color: '#2a2a2a' });
      // push bar
      g.box(-0.6, 0.45, L + 0.08, 0.6, 0.85, L + 0.22, { color: '#1a1a1a' });
    }
    gl.box(-W + 0.12, 0.7, L - 0.02, -W + 0.5, 0.86, L + 0.03, { color: PAL.headlight });
    gl.box(W - 0.5, 0.7, L - 0.02, W - 0.12, 0.86, L + 0.03, { color: PAL.headlight });
  }
  const body = g.build();
  const glow = gl.build();
  const res = { body, glow };
  geoCache.set(key, res);
  return res;
}

let bodyMat: THREE.Material | null = null;
let headMat: THREE.Material | null = null;

export function buildCar(kind: CarKind, color: string): CarParts {
  const d = dimsFor(kind);
  const geo = buildGeo(kind, color);
  if (!bodyMat) bodyMat = worldMaterials().props;
  if (!headMat) headMat = basicMat({ vertexColors: true });
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const bm = new THREE.Mesh(geo.body, bodyMat);
  bm.castShadow = true;
  bm.receiveShadow = true;
  body.add(bm);
  const head = new THREE.Mesh(geo.glow, headMat);
  body.add(head);
  // brake/tail lights (own material per car so they can brighten)
  const L = d.len / 2, W = d.wid / 2;
  const tg = new GeoBuilder();
  const ty = kind === 'swat' || kind === 'van' ? 0.9 : 0.72;
  tg.box(-W + 0.1, ty, -L - 0.03, -W + 0.45, ty + 0.17, -L + 0.02, { color: '#ffffff' });
  tg.box(W - 0.45, ty, -L - 0.03, W - 0.1, ty + 0.17, -L + 0.02, { color: '#ffffff' });
  const brake = new THREE.Mesh(tg.build(), basicMat({ color: PAL.taillight }));
  body.add(brake);
  // wheels
  if (!wheelGeo) {
    const wg = new THREE.CylinderGeometry(1, 1, 1, 8).rotateZ(Math.PI / 2);
    const cg = new THREE.BoxGeometry(0.5, 0.9, 0.9);
    void cg;
    wheelGeo = wg;
    wheelMat = worldMat({ map: texNoise(), color: PAL.tyre });
  }
  const wheels: THREE.Object3D[] = [];
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * (d.track / 2 + 0.02), d.wheelR, sz * d.wheelBase / 2);
    const w = new THREE.Mesh(wheelGeo, wheelMat!);
    w.scale.set(0.28, d.wheelR, d.wheelR);
    w.castShadow = true;
    const hub = new THREE.Mesh(new THREE.BoxGeometry(0.02, d.wheelR * 0.9, d.wheelR * 0.9), bodyMat);
    hub.position.x = sx * 0.15;
    w.add(hub);
    pivot.add(w);
    root.add(pivot);
    wheels.push(pivot);
  }
  const parts: CarParts = { root, body, wheels, brake, head, dims: d };
  if (kind === 'police' || kind === 'swat') {
    const y = kind === 'police' ? d.h + 0.08 : d.h + 0.02;
    const z = kind === 'police' ? -0.3 : -0.5;
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.2, 0.3), basicMat({ color: PAL.sirenRed }));
    red.position.set(-0.36, y + 0.1, z);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.2, 0.3), basicMat({ color: PAL.sirenBlue }));
    blue.position.set(0.36, y + 0.1, z);
    body.add(red, blue);
    parts.red = red;
    parts.blue = blue;
  }
  return parts;
}
