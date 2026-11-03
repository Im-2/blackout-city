// Procedural blocky character: one SkinnedMesh per character (rigid bone
// weights, 1 draw call) with a pixel atlas painted from the skin. All humans
// share the same skeleton layout so procedural animations are shared.
import * as THREE from 'three';
import { Skin } from './skins';
import { makeCanvas, mottle, toTexture } from '../assets/textures';
import { patchWorld } from '../render/patch';
import { damp, clamp } from '../core/math';

export type AnimState = 'idle' | 'walk' | 'run' | 'drive' | 'panic' | 'handsup' | 'cuffed' | 'fall' | 'vault' | 'hack' | 'carry';

export interface CharacterView {
  root: THREE.Object3D;
  update(dt: number, state: AnimState, speed: number): void;
  /** optional: flash colour (hit / spotted) */
  tint?(hex: string | null): void;
}

// Bone indices
const B = { root: 0, hips: 1, spine: 2, head: 3, uaL: 4, faL: 5, uaR: 6, faR: 7, thL: 8, shL: 9, thR: 10, shR: 11 } as const;
const BONE_COUNT = 12;
const PARENT = [-1, 0, 1, 2, 2, 4, 2, 6, 1, 8, 1, 10];
const REST: [number, number, number][] = [
  [0, 0, 0],
  [0, 0.95, 0],
  [0, 0.06, 0],
  [0, 0.62, 0],
  [0.25, 0.53, 0],
  [0, -0.3, 0],
  [-0.25, 0.53, 0],
  [0, -0.3, 0],
  [0.1, -0.04, 0],
  [0, -0.46, 0],
  [-0.1, -0.04, 0],
  [0, -0.46, 0],
];

type Face = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';
interface Part {
  name: string;
  bone: number;
  c: [number, number, number]; // centre relative to bone
  s: [number, number, number]; // size
}

function partsFor(skin: Skin): Part[] {
  const p: Part[] = [
    { name: 'hips', bone: B.hips, c: [0, -0.02, 0], s: [0.34, 0.18, 0.2] },
    { name: 'torso', bone: B.spine, c: [0, 0.3, 0], s: [0.42, 0.58, 0.22] },
    { name: 'neck', bone: B.spine, c: [0, 0.61, 0], s: [0.11, 0.06, 0.11] },
    { name: 'head', bone: B.head, c: [0, 0.15, 0.01], s: [0.24, 0.28, 0.26] },
    { name: 'uaL', bone: B.uaL, c: [0, -0.15, 0], s: [0.12, 0.32, 0.13] },
    { name: 'faL', bone: B.faL, c: [0, -0.16, 0], s: [0.1, 0.34, 0.11] },
    { name: 'uaR', bone: B.uaR, c: [0, -0.15, 0], s: [0.12, 0.32, 0.13] },
    { name: 'faR', bone: B.faR, c: [0, -0.16, 0], s: [0.1, 0.34, 0.11] },
    { name: 'thL', bone: B.thL, c: [0, -0.23, 0], s: [0.16, 0.48, 0.17] },
    { name: 'shL', bone: B.shL, c: [0, -0.2, 0], s: [0.14, 0.42, 0.15] },
    { name: 'ftL', bone: B.shL, c: [0, -0.43, 0.05], s: [0.14, 0.09, 0.28] },
    { name: 'thR', bone: B.thR, c: [0, -0.23, 0], s: [0.16, 0.48, 0.17] },
    { name: 'shR', bone: B.shR, c: [0, -0.2, 0], s: [0.14, 0.42, 0.15] },
    { name: 'ftR', bone: B.shR, c: [0, -0.43, 0.05], s: [0.14, 0.09, 0.28] },
  ];
  const H = B.head;
  if (skin.cap) {
    p.push({ name: 'cap', bone: H, c: [0, 0.3, 0.0], s: [0.27, 0.08, 0.29] });
    p.push({ name: 'brim', bone: H, c: [0, 0.27, 0.19], s: [0.24, 0.03, 0.12] });
  } else if (skin.hairStyle === 'messy') {
    p.push({ name: 'hairTop', bone: H, c: [0, 0.31, -0.005], s: [0.27, 0.08, 0.29] });
    p.push({ name: 'hairTuft', bone: H, c: [0.03, 0.355, 0.06], s: [0.14, 0.05, 0.12] });
    p.push({ name: 'hairBack', bone: H, c: [0, 0.2, -0.125], s: [0.26, 0.2, 0.04] });
  } else if (skin.hairStyle === 'short' || skin.hairStyle === 'ponytail') {
    p.push({ name: 'hairTop', bone: H, c: [0, 0.3, -0.01], s: [0.26, 0.05, 0.28] });
    p.push({ name: 'hairBack', bone: H, c: [0, 0.2, -0.125], s: [0.25, 0.18, 0.03] });
    if (skin.hairStyle === 'ponytail') p.push({ name: 'bun', bone: H, c: [0, 0.27, -0.17], s: [0.1, 0.1, 0.1] });
  }
  if (skin.headphones) {
    p.push({ name: 'phL', bone: H, c: [0.135, 0.15, 0], s: [0.05, 0.13, 0.13] });
    p.push({ name: 'phR', bone: H, c: [-0.135, 0.15, 0], s: [0.05, 0.13, 0.13] });
    p.push({ name: 'band', bone: H, c: [0, 0.34, 0], s: [0.3, 0.03, 0.05] });
  }
  if (skin.beard) p.push({ name: 'chin', bone: H, c: [0, 0.02, 0.06], s: [0.2, 0.06, 0.16] });
  if (skin.glasses) p.push({ name: 'glasses', bone: H, c: [0, 0.165, 0.145], s: [0.23, 0.05, 0.02] });
  if (skin.topStyle === 'hoodie') p.push({ name: 'hood', bone: B.spine, c: [0, 0.58, -0.08], s: [0.32, 0.1, 0.12] });
  if (skin.topStyle === 'uniform' || skin.belt) p.push({ name: 'belt', bone: B.hips, c: [0, 0.06, 0], s: [0.36, 0.06, 0.22] });
  if (skin.topStyle === 'uniform') {
    p.push({ name: 'holster', bone: B.hips, c: [-0.19, -0.02, 0.0], s: [0.06, 0.16, 0.1] });
    p.push({ name: 'pouch', bone: B.hips, c: [0.19, 0.0, 0.03], s: [0.05, 0.1, 0.08] });
  }
  return p;
}

const TPM = 40; // texels per metre on characters
const ATLAS = 128;

interface Rect { x: number; y: number; w: number; h: number; }

/** Paint one face of one part. */
function paint(ctx: CanvasRenderingContext2D, part: string, face: Face, r: Rect, k: Skin) {
  const fill = (hex: string, amt = 0.07) => mottle(ctx, r.x, r.y, r.w, r.h, hex, amt);
  const px = (x: number, y: number, w: number, h: number, hex: string) => {
    ctx.fillStyle = hex;
    ctx.fillRect(r.x + Math.round(x), r.y + Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  };
  const darkBottom = (a = 0.18) => {
    ctx.fillStyle = `rgba(0,0,0,${a})`;
    ctx.fillRect(r.x, r.y + r.h - 1, r.w, 1);
  };
  const W = r.w, H = r.h;
  const sleeveColor = k.top;
  switch (part) {
    case 'head': {
      fill(k.skin, 0.05);
      const hairRows = k.cap ? 0 : k.hairStyle === 'bald' ? 0 : k.hairStyle === 'buzz' ? 1 : 2;
      if (face === 'pz') {
        if (hairRows) px(0, 0, W, hairRows, k.hair);
        if (k.hairStyle === 'messy') { px(1, hairRows, 3, 1, k.hair); px(W - 3, hairRows, 2, 1, k.hair); }
        // brows, eyes, nose, mouth
        px(1, 3, 3, 1, k.hair === '#9a9a92' ? '#6a6a62' : '#2a1d15');
        px(W - 4, 3, 3, 1, '#2a1d15');
        px(2, 4, 2, 1, '#f0e6d8'); px(3, 4, 1, 1, '#1c1410');
        px(W - 4, 4, 2, 1, '#f0e6d8'); px(W - 4, 4, 1, 1, '#1c1410');
        px(1, 5, 3, 1, 'rgba(90,40,20,0.35)'); px(W - 4, 5, 3, 1, 'rgba(90,40,20,0.35)'); // tired eye bags
        px(W / 2 - 0.5, 5, 1, 2, 'rgba(110,50,25,0.45)');
        if (k.beard) {
          px(0, H - 4, W, 4, k.beard);
          px(1, H - 5, 2, 1, k.beard); px(W - 3, H - 5, 2, 1, k.beard);
          px(W / 2 - 1.5, H - 3, 3, 1, '#7a3a28');
        } else {
          px(W / 2 - 1.5, H - 3, 3, 1, '#8a4a34');
          px(0, H - 2, W, 2, 'rgba(60,40,30,0.18)'); // stubble
        }
      } else if (face === 'nz') {
        if (k.hairStyle === 'bald') { fill(k.skin); }
        else if (!k.cap) px(0, 0, W, Math.ceil(H * 0.75), k.hair);
        else px(0, 0, W, Math.ceil(H * 0.55), k.hair);
        darkBottom();
      } else if (face === 'px' || face === 'nx') {
        if (!k.cap && k.hairStyle !== 'bald') {
          px(0, 0, W, hairRows + 1, k.hair);
          if (face === 'px') px(0, 0, 4, H * 0.7, k.hair); else px(W - 4, 0, 4, H * 0.7, k.hair);
        }
        px(W / 2 - 1, 4, 2, 3, 'rgba(120,60,30,0.35)'); // ear
        if (k.beard) px(face === 'px' ? W - 5 : 0, H - 4, 5, 4, k.beard);
      } else if (face === 'py') {
        fill(k.cap ? k.skin : k.hairStyle === 'bald' ? k.skin : k.hair);
      } else fill(k.skin);
      break;
    }
    case 'hairTop': case 'hairTuft': case 'hairBack': case 'bun':
      fill(k.hair, 0.12);
      break;
    case 'chin':
      fill(k.beard!, 0.1);
      if (face === 'pz') px(W / 2 - 1.5, 0, 3, 1, '#7a3a28');
      break;
    case 'glasses':
      fill('#141414', 0.03);
      if (face === 'pz') { px(1, 1, 3, 1, '#4a5a66'); px(W - 4, 1, 3, 1, '#4a5a66'); }
      break;
    case 'cap':
      fill(k.cap!, 0.06);
      break;
    case 'brim':
      fill(k.cap!, 0.04);
      break;
    case 'phL': case 'phR':
      fill(k.headphones!, 0.05);
      if ((part === 'phL' && face === 'px') || (part === 'phR' && face === 'nx')) {
        // gold "W" mark from the reference sheet
        px(1, 1, 1, 3, '#e0a020'); px(W - 2, 1, 1, 3, '#e0a020'); px(W / 2 - 0.5, 2, 1, 2, '#e0a020'); px(2, 4, W - 4, 1, '#e0a020');
      }
      break;
    case 'band':
      fill(k.headphones!, 0.05);
      break;
    case 'neck':
      fill(k.skin, 0.05);
      break;
    case 'hood':
      fill(k.top, 0.06);
      darkBottom(0.25);
      break;
    case 'torso': {
      const shade = k.topStyle === 'hoodie' ? 0.07 : 0.09;
      fill(k.top, shade);
      if (k.topStyle === 'stripes') {
        for (let x = 1; x < W; x += 3) px(x, 0, 1, H, k.stripe!);
      }
      if (face === 'pz') {
        if (k.topStyle === 'shirt' || k.topStyle === 'uniform') {
          // open collar V + collar points
          px(W / 2 - 2, 0, 4, 2, k.skin);
          px(W / 2 - 1, 2, 2, 1, k.skin);
          px(W / 2 - 4, 0, 2, 2, k.topStyle === 'uniform' ? '#2c364c' : '#dcdcc0');
          px(W / 2 + 2, 0, 2, 2, k.topStyle === 'uniform' ? '#2c364c' : '#dcdcc0');
          if (k.tie) { px(W / 2 - 1, 2, 2, H - 6, k.tie); px(W / 2 - 1.5, 3, 3, 1, k.tie); px(W / 2 - 1, H - 4, 2, 1, k.tie); }
          // rumple patches
          if (k.topStyle === 'shirt') for (let i = 0; i < 6; i++) px(1 + ((i * 5) % (W - 3)), 4 + ((i * 7) % (H - 6)), 2, 2, 'rgba(90,90,60,0.18)');
        }
        if (k.topStyle === 'uniform') {
          px(2, 5, 4, 3, '#1a2131'); px(W - 6, 5, 4, 3, '#1a2131'); // pockets
          px(W - 5, 3, 2, 3, '#c9a245'); px(W - 4, 3, 1, 1, '#e8cc70'); // badge (character's left)
          px(2, 3, 3, 1, '#c9a245'); // name tag
          px(0, 0, 2, 1, '#2c364c'); px(W - 2, 0, 2, 1, '#2c364c');
        }
        if (k.topStyle === 'hoodie') {
          px(W / 2 - 3, 0, 6, 2, '#3a7a22');
          px(W / 2 - 2, 2, 1, 6, '#e8e8e0'); px(W / 2 + 1, 2, 1, 6, '#e8e8e0'); // drawstrings
          px(3, H - 9, W - 6, 6, '#3f7f24'); // kangaroo pocket
          px(0, H - 2, W, 2, '#3f7f24');
        }
        if (k.topStyle === 'stripes') {
          px(W / 2 - 3, 0, 6, H, k.under!); // open shirt shows tee
          for (let y = 3; y < H - 1; y += 5) px(W / 2 - 4, y, 1, 1, '#f0f0f0');
        }
        if (k.topStyle === 'tee') px(W / 2 - 2, 0, 4, 1, k.skin);
      }
      if (face === 'nz' && k.topStyle === 'hoodie') px(2, 0, W - 4, 4, '#3f7f24');
      if (face === 'py') px(r.w / 2 - 2, 0, 4, r.h, k.skin);
      darkBottom(0.2);
      break;
    }
    case 'hips':
      fill(k.pants, 0.06);
      if (face === 'pz') px(W / 2 - 0.5, 2, 1, H - 2, 'rgba(0,0,0,0.25)');
      break;
    case 'belt':
      fill(k.belt ?? '#1b1b1b', 0.04);
      if (face === 'pz') px(W / 2 - 1.5, 0, 3, H, k.topStyle === 'uniform' ? '#a0a0a0' : '#7a6a4a');
      if (k.topStyle === 'uniform' && (face === 'px' || face === 'nx' || face === 'pz')) { px(1, 0, 2, H, '#2a2a2a'); px(W - 3, 0, 2, H, '#2a2a2a'); }
      break;
    case 'holster': case 'pouch':
      fill('#1b1b1b', 0.05);
      break;
    case 'uaL': case 'uaR': {
      if (k.sleeves === 'short') {
        fill(k.skin, 0.05);
        mottle(ctx, r.x, r.y, r.w, Math.ceil(r.h * 0.55), sleeveColor, 0.07);
        if (k.topStyle === 'stripes' && face !== 'py') for (let x = 1; x < W; x += 3) px(x, 0, 1, Math.ceil(H * 0.55), k.stripe!);
      } else {
        fill(sleeveColor, 0.08);
        if (k.sleeves === 'rolled') px(0, H - 3, W, 3, k.topStyle === 'uniform' ? '#2c364c' : k.topStyle === 'hoodie' ? '#3f7f24' : '#dcdcc0');
        if (k.topStyle === 'uniform' && ((part === 'uaL' && face === 'px') || (part === 'uaR' && face === 'nx'))) {
          px(1, 2, W - 2, 4, '#4a5a78'); px(1, 2, W - 2, 1, '#c9a245');
        }
      }
      break;
    }
    case 'faL': case 'faR': {
      if (k.sleeves === 'long') {
        fill(sleeveColor, 0.08);
        px(0, H - 4, W, 4, k.skin);
      } else fill(k.skin, 0.05);
      // hand: slightly darker + finger line
      px(0, H - 4, W, 4, k.skin);
      ctx.fillStyle = 'rgba(80,30,10,0.18)';
      ctx.fillRect(r.x, r.y + H - 4, r.w, 1);
      if (k.bracelet && part === 'faR') px(0, H - 5, W, 1, k.bracelet);
      break;
    }
    case 'thL': case 'thR':
      fill(k.pants, 0.07);
      if (face === 'pz') px(W / 2, 0, 1, H, 'rgba(0,0,0,0.12)'); // crease
      break;
    case 'shL': case 'shR':
      fill(k.pants, 0.07);
      if (k.cuffs) px(0, H - 3, W, 3, k.pants === '#2c2e3c' ? '#3a3d50' : '#343434');
      darkBottom(0.25);
      break;
    case 'ftL': case 'ftR':
      fill(k.shoes, 0.07);
      if (k.sole) { ctx.fillStyle = k.sole; ctx.fillRect(r.x, r.y + r.h - 1, r.w, 1); }
      else darkBottom(0.4);
      if (face === 'py' && k.shoes === '#6b3f24') px(1, r.h / 2 - 1, W - 2, 1, '#8a5a34'); // loafer strap
      if (face === 'py' && k.sole) px(W / 2 - 0.5, 2, 1, r.h - 4, k.sole);
      break;
    default:
      fill('#888888');
  }
}

interface BuiltRig {
  geo: THREE.BufferGeometry;
  tex: THREE.CanvasTexture;
}
const rigCache = new Map<string, BuiltRig>();

function buildRigGeometry(skin: Skin): BuiltRig {
  const cached = rigCache.get(skin.key);
  if (cached) return cached;
  const parts = partsFor(skin);
  const { c, ctx } = makeCanvas(ATLAS, ATLAS);
  ctx.fillStyle = '#ff00ff';
  ctx.fillRect(0, 0, ATLAS, ATLAS);
  // shelf packer
  let sx = 0, sy = 0, shelf = 0;
  const alloc = (w: number, h: number): Rect => {
    if (sx + w > ATLAS) { sx = 0; sy += shelf; shelf = 0; }
    const r = { x: sx, y: sy, w, h };
    sx += w;
    shelf = Math.max(shelf, h);
    return r;
  };
  // bone world rest positions
  const bonePos: THREE.Vector3[] = [];
  for (let i = 0; i < BONE_COUNT; i++) {
    const v = new THREE.Vector3(...REST[i]);
    if (PARENT[i] >= 0) v.add(bonePos[PARENT[i]]);
    bonePos.push(v);
  }
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], si: number[] = [], sw: number[] = [], idx: number[] = [];
  const q = (p: number[][], n: number[], r: Rect, bone: number) => {
    const b = pos.length / 3;
    for (const v of p) { pos.push(v[0], v[1], v[2]); nor.push(n[0], n[1], n[2]); si.push(bone, 0, 0, 0); sw.push(1, 0, 0, 0); }
    const u0 = r.x / ATLAS, u1 = (r.x + r.w) / ATLAS, v0 = 1 - (r.y + r.h) / ATLAS, v1 = 1 - r.y / ATLAS;
    uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const T = (m: number) => Math.max(2, Math.round(m * TPM));
  for (const part of parts) {
    const bp = bonePos[part.bone];
    const [w, h, d] = part.s;
    const x0 = bp.x + part.c[0] - w / 2, x1 = x0 + w;
    const y0 = bp.y + part.c[1] - h / 2, y1 = y0 + h;
    const z0 = bp.z + part.c[2] - d / 2, z1 = z0 + d;
    const faces: [Face, number[][], number[], number, number][] = [
      ['pz', [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], T(w), T(h)],
      ['nz', [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], T(w), T(h)],
      ['px', [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], T(d), T(h)],
      ['nx', [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], T(d), T(h)],
      ['py', [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], T(w), T(d)],
      ['ny', [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], T(w), T(d)],
    ];
    for (const [face, verts, n, tw, th] of faces) {
      const r = alloc(tw, th);
      paint(ctx, part.name, face, r, skin);
      q(verts, n, r, part.bone);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const tex = toTexture(c, false);
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  const built = { geo, tex };
  rigCache.set(skin.key, built);
  return built;
}

const matCache = new Map<string, THREE.MeshLambertMaterial>();

/** Procedural character view. */
export class RigCharacter implements CharacterView {
  root = new THREE.Group();
  bones: THREE.Bone[] = [];
  mesh: THREE.SkinnedMesh;
  private rot: Float32Array = new Float32Array(BONE_COUNT * 3);
  private tgt: Float32Array = new Float32Array(BONE_COUNT * 3);
  private hipY = 0;
  private hipYTarget = 0;
  private phase = Math.random() * 10;
  private t = Math.random() * 10;
  private mat: THREE.MeshLambertMaterial;
  private bodyTilt = 0;

  constructor(public skin: Skin) {
    const { geo, tex } = buildRigGeometry(skin);
    let mat = matCache.get(skin.key);
    if (!mat) {
      mat = patchWorld(new THREE.MeshLambertMaterial({ map: tex }));
      matCache.set(skin.key, mat);
    }
    this.mat = mat;
    for (let i = 0; i < BONE_COUNT; i++) {
      const b = new THREE.Bone();
      b.position.set(...REST[i]);
      if (PARENT[i] >= 0) this.bones[PARENT[i]].add(b);
      this.bones.push(b);
    }
    this.mesh = new THREE.SkinnedMesh(geo, mat);
    this.mesh.add(this.bones[0]);
    this.mesh.bind(new THREE.Skeleton(this.bones));
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
    this.root.scale.set(skin.width, skin.height, skin.width);
  }

  tint(hex: string | null) {
    // swap to a tinted clone (rare: spotted flash)
    if (!hex) { this.mesh.material = this.mat; return; }
    const m = this.mat.clone();
    m.onBeforeCompile = this.mat.onBeforeCompile;
    m.emissive = new THREE.Color(hex);
    m.emissiveIntensity = 0.5;
    this.mesh.material = m;
  }

  private set(b: number, x: number, y = 0, z = 0) {
    this.tgt[b * 3] = x;
    this.tgt[b * 3 + 1] = y;
    this.tgt[b * 3 + 2] = z;
  }

  update(dt: number, state: AnimState, speed: number) {
    this.t += dt;
    const tg = this.tgt;
    tg.fill(0);
    this.hipYTarget = 0;
    let tilt = 0;
    const s = Math.sin, t = this.t;
    switch (state) {
      case 'idle': case 'hack': case 'carry': {
        const br = s(t * 1.6) * 0.03;
        this.set(B.spine, 0.06 + br, 0, 0);
        this.set(B.head, 0.12 + s(t * 0.5) * 0.04, s(t * 0.33) * 0.15, 0);
        this.set(B.uaL, 0, 0, 0.12 + br);
        this.set(B.uaR, 0, 0, -0.12 - br);
        this.set(B.faL, -0.15);
        this.set(B.faR, -0.15);
        if (state === 'hack') {
          // phone raised in right hand, head down at screen
          this.set(B.uaR, -0.9, 0.2, -0.15);
          this.set(B.faR, -1.3, 0, 0);
          this.set(B.uaL, -0.5, -0.2, 0.2);
          this.set(B.faL, -1.2);
          this.set(B.head, 0.4, -0.1, 0);
        }
        if (state === 'carry') {
          this.set(B.uaR, 0.1, 0, -0.25);
          this.set(B.faR, -0.2);
        }
        break;
      }
      case 'walk': case 'run': {
        const run = state === 'run';
        const freq = run ? 1.55 : 1.8;
        this.phase += dt * Math.max(1.5, speed) * freq;
        const p = this.phase;
        const amp = run ? 0.95 : 0.55;
        this.set(B.thL, s(p) * amp);
        this.set(B.thR, -s(p) * amp);
        this.set(B.shL, Math.max(0, -Math.cos(p)) * (run ? 1.5 : 0.7) + 0.05);
        this.set(B.shR, Math.max(0, Math.cos(p)) * (run ? 1.5 : 0.7) + 0.05);
        this.set(B.uaL, -s(p) * (run ? 0.9 : 0.45), 0, 0.1);
        this.set(B.uaR, s(p) * (run ? 0.9 : 0.45), 0, -0.1);
        this.set(B.faL, run ? -1.3 : -0.3);
        this.set(B.faR, run ? -1.3 : -0.3);
        this.set(B.spine, run ? 0.28 : 0.08, s(p) * 0.08, 0);
        this.set(B.head, run ? -0.12 : 0.06);
        this.hipYTarget = -Math.abs(Math.cos(p)) * (run ? 0.07 : 0.035);
        tilt = 0;
        break;
      }
      case 'drive': {
        this.set(B.thL, -1.45, 0.08);
        this.set(B.thR, -1.45, -0.08);
        this.set(B.shL, 1.35);
        this.set(B.shR, 1.35);
        this.set(B.uaL, -1.0, 0, 0.1);
        this.set(B.uaR, -1.0, 0, -0.1);
        this.set(B.faL, -0.45);
        this.set(B.faR, -0.45);
        this.set(B.spine, -0.08);
        this.hipYTarget = -0.38;
        break;
      }
      case 'panic': case 'handsup': {
        const run = state === 'panic' && speed > 0.5;
        if (run) {
          this.phase += dt * speed * 1.6;
          const p = this.phase;
          this.set(B.thL, s(p) * 0.9);
          this.set(B.thR, -s(p) * 0.9);
          this.set(B.shL, Math.max(0, -Math.cos(p)) * 1.3);
          this.set(B.shR, Math.max(0, Math.cos(p)) * 1.3);
          this.hipYTarget = -Math.abs(Math.cos(p)) * 0.06;
        }
        // hands up, jittery
        const j = s(t * 22) * 0.05;
        this.set(B.uaL, -2.7 + j, 0, 0.35);
        this.set(B.uaR, -2.7 - j, 0, -0.35);
        this.set(B.faL, -0.5);
        this.set(B.faR, -0.5);
        this.set(B.spine, run ? 0.2 : -0.06);
        this.set(B.head, run ? 0 : -0.15, s(t * 3) * 0.3);
        break;
      }
      case 'cuffed': {
        // hands behind the back, head down, kneeling
        this.set(B.uaL, 0.55, 0, 0.35);
        this.set(B.uaR, 0.55, 0, -0.35);
        this.set(B.faL, -1.4, 0, 0.9);
        this.set(B.faR, -1.4, 0, -0.9);
        this.set(B.head, 0.45);
        this.set(B.thL, -0.1);
        this.set(B.shL, 1.6);
        this.set(B.thR, -1.4);
        this.set(B.shR, 1.5);
        this.set(B.spine, 0.15);
        this.hipYTarget = -0.4;
        break;
      }
      case 'fall': {
        tilt = -1.45;
        this.set(B.uaL, -2.4, 0, 0.6);
        this.set(B.uaR, -2.2, 0, -0.6);
        this.set(B.thL, 0.2);
        this.set(B.thR, -0.3);
        this.set(B.shL, 0.4);
        this.hipYTarget = -0.75;
        break;
      }
      case 'vault': {
        this.set(B.thL, -1.3);
        this.set(B.thR, -0.9);
        this.set(B.shL, 1.6);
        this.set(B.shR, 1.0);
        this.set(B.uaL, -1.6, 0, 0.3);
        this.set(B.uaR, -1.6, 0, -0.3);
        this.set(B.spine, 0.35);
        break;
      }
    }
    // damp toward target
    const k = state === 'fall' || state === 'vault' ? 14 : 12;
    for (let i = 0; i < this.rot.length; i++) this.rot[i] = damp(this.rot[i], tg[i], k, dt);
    for (let i = 1; i < BONE_COUNT; i++) this.bones[i].rotation.set(this.rot[i * 3], this.rot[i * 3 + 1], this.rot[i * 3 + 2]);
    this.hipY = damp(this.hipY, this.hipYTarget, 12, dt);
    this.bones[B.hips].position.y = REST[B.hips][1] + this.hipY;
    this.bodyTilt = damp(this.bodyTilt, tilt, 8, dt);
    this.bones[B.root].rotation.x = this.bodyTilt;
    void clamp;
  }
}
