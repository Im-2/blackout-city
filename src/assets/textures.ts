// Procedural low-res pixel textures (canvas). No image files needed.
import * as THREE from 'three';
import { PAL } from '../core/palette';
import { Rng, clamp } from '../core/math';

const rng = new Rng(1337);

export function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return { c, ctx };
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Fill a rect with base colour, each `cell`-sized pixel jittered by ±amount. */
export function mottle(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, hex: string, amount = 0.07, cell = 1) {
  const [r, g, b] = rgb(hex);
  for (let j = 0; j < h; j += cell)
    for (let i = 0; i < w; i += cell) {
      const m = 1 + (rng.next() * 2 - 1) * amount;
      ctx.fillStyle = `rgb(${clamp(r * m, 0, 255) | 0},${clamp(g * m, 0, 255) | 0},${clamp(b * m, 0, 255) | 0})`;
      ctx.fillRect(x + i, y + j, Math.min(cell, w - i), Math.min(cell, h - j));
    }
}

export function toTexture(c: HTMLCanvasElement, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  // Hard texel edges; nearest-mip only to stop distant moire (no blending between texels).
  t.minFilter = THREE.NearestMipmapNearestFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Grey mottled texture for vertex-coloured props/cars (multiplied by vertex colour). */
let noiseTex: THREE.CanvasTexture | null = null;
export function texNoise(): THREE.CanvasTexture {
  if (noiseTex) return noiseTex;
  const { c, ctx } = makeCanvas(16, 16);
  mottle(ctx, 0, 0, 16, 16, '#ffffff', 0.09, 1);
  // darker rim = fake bevel
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(0, 15, 16, 1);
  ctx.fillRect(15, 0, 1, 16);
  noiseTex = toTexture(c);
  return noiseTex;
}

let grainTex: THREE.CanvasTexture | null = null;

/** the same mottle without the bevel, for surfaces that tile across a room */
export function texGrain(): THREE.CanvasTexture {
  if (grainTex) return grainTex;
  const { c, ctx } = makeCanvas(16, 16);
  mottle(ctx, 0, 0, 16, 16, '#ffffff', 0.07, 1);
  grainTex = toTexture(c);
  return grainTex;
}

export function texAsphalt() {
  const { c, ctx } = makeCanvas(64, 64);
  mottle(ctx, 0, 0, 64, 64, PAL.asphalt, 0.06, 2);
  for (let i = 0; i < 60; i++) {
    const x = rng.int(0, 31) * 2,
      y = rng.int(0, 31) * 2;
    mottle(ctx, x, y, 4, 4, rng.chance(0.5) ? PAL.asphaltDark : '#44413d', 0.05, 2);
  }
  ctx.fillStyle = 'rgba(20,20,20,0.5)';
  for (let i = 0; i < 4; i++) {
    let x = rng.int(0, 63),
      y = rng.int(0, 63);
    for (let k = 0; k < 10; k++) {
      ctx.fillRect(x, y, 1, 1);
      x += rng.int(-1, 1);
      y += 1;
    }
  }
  return toTexture(c);
}

export function texSidewalk() {
  const { c, ctx } = makeCanvas(32, 32);
  mottle(ctx, 0, 0, 32, 32, PAL.grout, 0.05);
  for (let y = 0; y < 32; y += 8)
    for (let x = 0; x < 32; x += 8) {
      const tone = rng.range(0.94, 1.05);
      const [r, g, b] = rgb(PAL.sidewalk);
      mottle(ctx, x + 1, y + 1, 7, 7, `#${[r, g, b].map((v) => clamp(Math.round(v * tone), 0, 255).toString(16).padStart(2, '0')).join('')}`, 0.05);
    }
  return toTexture(c);
}

export function texConcrete(hex: string = PAL.concrete, size = 32, cell = 2) {
  const { c, ctx } = makeCanvas(size, size);
  mottle(ctx, 0, 0, size, size, hex, 0.06, cell);
  return toTexture(c);
}

export function texStoneBlocks(hex: string, dark: string) {
  const { c, ctx } = makeCanvas(32, 32);
  mottle(ctx, 0, 0, 32, 32, dark, 0.04);
  for (let y = 0; y < 32; y += 8) {
    const off = (y / 8) % 2 ? 8 : 0;
    for (let x = -16; x < 32; x += 16) mottle(ctx, x + off + 1, y + 1, 15, 7, hex, 0.05);
  }
  return toTexture(c);
}

function drawBrick(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, a: string, b: string, mortar: string) {
  mottle(ctx, x0, y0, w, h, mortar, 0.05);
  for (let y = 0; y < h; y += 3) {
    const off = (y / 3) % 2 ? 3 : 0;
    for (let x = -off; x < w; x += 6) {
      const bx = Math.max(0, x),
        bw = Math.min(x + 5, w) - bx;
      if (bw > 0) mottle(ctx, x0 + bx, y0 + y, bw, 2, rng.chance(0.5) ? a : b, 0.06);
    }
  }
}

export type FacadeStyle = 'brick' | 'tan' | 'office' | 'tower' | 'sage' | 'slate' | 'concrete';

export interface Facade {
  map: THREE.CanvasTexture;
  emissive: THREE.CanvasTexture;
  /** world metres covered by one texture repeat (x, y) */
  tile: [number, number];
}

/**
 * A facade texture covering 4 bays x 4 floors (16 m x 13.6 m). Wall pixels
 * come from the style; windows are dark glass, ~30% lit warm. The emissive map
 * holds only the lit window pixels.
 */
export function texFacade(style: FacadeStyle): Facade {
  const W = 128,
    H = 128;
  const { c, ctx } = makeCanvas(W, H);
  const e = makeCanvas(W, H);
  e.ctx.fillStyle = '#000';
  e.ctx.fillRect(0, 0, W, H);
  const bayW = 32,
    floorH = 32;
  const wall: Record<FacadeStyle, [string, string]> = {
    brick: [PAL.brick, PAL.brick2],
    tan: [PAL.tan, PAL.tanDark],
    office: [PAL.concrete, PAL.concreteDark],
    tower: [PAL.glassFrame, '#41464b'],
    sage: [PAL.sage, PAL.sageLight],
    slate: [PAL.slate, '#47637b'],
    concrete: ['#9a958b', '#86817a'],
  };
  const [a, b] = wall[style];
  if (style === 'brick') drawBrick(ctx, 0, 0, W, H, a, b, PAL.mortar);
  else if (style === 'sage' || style === 'slate') {
    mottle(ctx, 0, 0, W, H, b, 0.04);
    for (let y = 0; y < H; y += 4) for (let x = (y / 4) % 2 ? 0 : 4; x < W; x += 8) mottle(ctx, x, y, 7, 3, a, 0.06);
  } else mottle(ctx, 0, 0, W, H, a, 0.06, 2);

  for (let fy = 0; fy < 4; fy++)
    for (let bx = 0; bx < 4; bx++) {
      const x0 = bx * bayW,
        y0 = fy * floorH;
      let wx: number, wy: number, ww: number, wh: number;
      if (style === 'tower') {
        wx = x0 + 2; wy = y0 + 4; ww = bayW - 4; wh = floorH - 8;
      } else if (style === 'office') {
        wx = x0 + 3; wy = y0 + 9; ww = bayW - 6; wh = 14;
      } else {
        wx = x0 + 9; wy = y0 + 7; ww = 14; wh = 18;
      }
      // sill / lintel
      if (style !== 'tower') {
        mottle(ctx, wx - 1, wy - 2, ww + 2, 2, style === 'brick' ? '#9b8b78' : PAL.concreteDark, 0.04);
        mottle(ctx, wx - 1, wy + wh, ww + 2, 2, style === 'brick' ? '#9b8b78' : PAL.concreteDark, 0.04);
      } else {
        mottle(ctx, x0, y0, bayW, 2, '#5a5f64', 0.03);
      }
      const lit = rng.chance(style === 'tower' ? 0.22 : 0.3);
      const glass = lit ? PAL.windowLit : rng.chance(0.3) ? '#2a333f' : PAL.windowDark;
      ctx.fillStyle = PAL.glassFrame;
      ctx.fillRect(wx, wy, ww, wh);
      mottle(ctx, wx + 1, wy + 1, ww - 2, wh - 2, glass, lit ? 0.08 : 0.05, 2);
      // mullions
      ctx.fillStyle = PAL.glassFrame;
      ctx.fillRect(wx + (ww >> 1), wy, 1, wh);
      if (style !== 'office') ctx.fillRect(wx, wy + (wh >> 1), ww, 1);
      // reflection streak
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(wx + 2, wy + 1, 2, wh - 2);
      if (lit) {
        e.ctx.fillStyle = '#c8a870';
        e.ctx.fillRect(wx + 1, wy + 1, ww - 2, wh - 2);
        e.ctx.fillStyle = '#000';
        e.ctx.fillRect(wx + (ww >> 1), wy, 1, wh);
        // a blind half-drawn on some windows
        if (rng.chance(0.4)) {
          const bh = rng.int(3, wh >> 1);
          mottle(ctx, wx + 1, wy + 1, ww - 2, bh, '#c9b993', 0.04);
          e.ctx.fillStyle = '#4a4030';
          e.ctx.fillRect(wx + 1, wy + 1, ww - 2, bh);
        }
      }
    }
  return { map: toTexture(c), emissive: toTexture(e.c), tile: [16, 13.6] };
}

/** Ground-floor storefront / plinth texture: 2 bays wide, 1 floor tall. */
export function texPlinth(hex: string, dark: string) {
  const { c, ctx } = makeCanvas(64, 32);
  const e = makeCanvas(64, 32);
  e.ctx.fillStyle = '#000';
  e.ctx.fillRect(0, 0, 64, 32);
  mottle(ctx, 0, 0, 64, 32, dark, 0.05, 2);
  for (let i = 0; i < 2; i++) {
    const x = i * 32 + 4;
    ctx.fillStyle = '#25292e';
    ctx.fillRect(x, 6, 24, 24);
    const lit = rng.chance(0.55);
    mottle(ctx, x + 1, 7, 22, 22, lit ? '#d9b878' : '#2c3540', 0.06, 2);
    ctx.fillStyle = '#25292e';
    ctx.fillRect(x + 12, 6, 1, 24);
    if (lit) {
      e.ctx.fillStyle = '#9a7c4c';
      e.ctx.fillRect(x + 1, 7, 22, 22);
    }
    mottle(ctx, x - 2, 2, 28, 3, hex, 0.05); // sign band
  }
  return { map: toTexture(c), emissive: toTexture(e.c), tile: [8, 3.6] as [number, number] };
}

export function texRoof() {
  const { c, ctx } = makeCanvas(32, 32);
  mottle(ctx, 0, 0, 32, 32, '#6e6b65', 0.08, 2);
  return toTexture(c);
}

export function texFoliage() {
  const { c, ctx } = makeCanvas(16, 16);
  mottle(ctx, 0, 0, 16, 16, PAL.foliage, 0.04, 2);
  for (let i = 0; i < 14; i++) mottle(ctx, rng.int(0, 7) * 2, rng.int(0, 7) * 2, 2, 2, rng.chance(0.5) ? PAL.foliageDark : PAL.foliageLight, 0.04);
  return toTexture(c);
}

/** Glass-door / storefront texture for the bank entrance. */
export function texBankDoor() {
  const { c, ctx } = makeCanvas(32, 48);
  ctx.fillStyle = '#2b3530';
  ctx.fillRect(0, 0, 32, 48);
  mottle(ctx, 2, 2, 13, 44, '#c9a865', 0.08, 2);
  mottle(ctx, 17, 2, 13, 44, '#c9a865', 0.08, 2);
  ctx.fillStyle = '#2b3530';
  ctx.fillRect(2, 22, 28, 2);
  ctx.fillStyle = '#d8c9a0';
  ctx.fillRect(13, 24, 1, 6);
  ctx.fillRect(18, 24, 1, 6);
  return toTexture(c, false);
}

export function texVaultDoor() {
  const { c, ctx } = makeCanvas(32, 32);
  mottle(ctx, 0, 0, 32, 32, '#7b7d7f', 0.05, 2);
  ctx.fillStyle = '#5a5c5e';
  ctx.fillRect(4, 4, 24, 24);
  mottle(ctx, 6, 6, 20, 20, '#8e9092', 0.05, 2);
  ctx.fillStyle = '#3a3c3e';
  ctx.fillRect(14, 8, 4, 16);
  ctx.fillRect(8, 14, 16, 4);
  ctx.fillStyle = '#c9a245';
  ctx.fillRect(15, 15, 2, 2);
  return toTexture(c, false);
}

/** the harbour: dark water with short pixel crests, tiling */
export function texWaves() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = PAL.water;
  x.fillRect(0, 0, 64, 64);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 90; i++) {
    x.fillStyle = PAL.waterDark;
    x.fillRect(Math.floor(rnd() * 64), Math.floor(rnd() * 64), 2 + Math.floor(rnd() * 8), 1);
  }
  for (let i = 0; i < 42; i++) {
    x.fillStyle = rnd() < 0.3 ? '#6f97a6' : '#3f6272';
    x.fillRect(Math.floor(rnd() * 64), Math.floor(rnd() * 64), 2 + Math.floor(rnd() * 6), 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapNearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
