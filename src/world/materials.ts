// Shared world materials (built once from procedural textures).
import * as THREE from 'three';
import { PAL } from '../core/palette';
import { worldMat, basicMat } from '../render/patch';
import * as T from '../assets/textures';

export interface FacadeMats {
  lit: THREE.MeshLambertMaterial;
  dark: THREE.MeshLambertMaterial;
  tile: [number, number];
}

export interface WorldMats {
  facades: Record<T.FacadeStyle, FacadeMats>;
  plinth: Record<string, FacadeMats>;
  roof: THREE.MeshLambertMaterial;
  asphalt: THREE.MeshLambertMaterial;
  sidewalk: THREE.MeshLambertMaterial;
  props: THREE.MeshLambertMaterial; // vertex colours x noise
  foliage: THREE.MeshLambertMaterial;
  glow: THREE.MeshBasicMaterial; // vertex colours, unlit
  pool: THREE.MeshBasicMaterial; // additive lamp light pools
  stone: THREE.MeshLambertMaterial;
  brick: THREE.MeshLambertMaterial;
  bankDoor: THREE.MeshLambertMaterial;
  vaultDoor: THREE.MeshLambertMaterial;
}

let cached: WorldMats | null = null;

function facade(style: T.FacadeStyle): FacadeMats {
  const f = T.texFacade(style);
  const lit = worldMat({ map: f.map, emissiveMap: f.emissive, emissive: new THREE.Color(PAL.windowLit), emissiveIntensity: 0.85, vertexColors: true });
  const dark = worldMat({ map: f.map, emissive: 0x000000, vertexColors: true });
  return { lit, dark, tile: f.tile };
}

function plinth(hex: string, dark: string): FacadeMats {
  const f = T.texPlinth(hex, dark);
  const lit = worldMat({ map: f.map, emissiveMap: f.emissive, emissive: new THREE.Color(PAL.windowLit), emissiveIntensity: 0.9, vertexColors: true });
  const darkM = worldMat({ map: f.map, emissive: 0x000000, vertexColors: true });
  return { lit, dark: darkM, tile: f.tile };
}

export function worldMaterials(): WorldMats {
  if (cached) return cached;
  const styles: T.FacadeStyle[] = ['brick', 'tan', 'office', 'tower', 'sage', 'slate', 'concrete'];
  const facades = {} as Record<T.FacadeStyle, FacadeMats>;
  for (const s of styles) facades[s] = facade(s);
  const pool = basicMat({
    color: new THREE.Color(PAL.lamp).multiplyScalar(0.22),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    map: lampPoolTex(),
  });
  cached = {
    facades,
    plinth: {
      warm: plinth('#6b4a34', '#5c5650'),
      green: plinth(PAL.bankGreen, '#4f4d48'),
      grey: plinth('#3c4652', '#6b6760'),
    },
    roof: worldMat({ map: T.texRoof() }),
    asphalt: worldMat({ map: T.texAsphalt() }),
    sidewalk: worldMat({ map: T.texSidewalk(), vertexColors: true }),
    props: worldMat({ map: T.texNoise(), vertexColors: true }),
    foliage: worldMat({ map: T.texFoliage(), vertexColors: true }),
    glow: basicMat({ vertexColors: true, fog: true }),
    pool,
    stone: worldMat({ map: T.texStoneBlocks(PAL.bankStone, PAL.bankStoneDark) }),
    brick: worldMat({ map: T.texFacade('brick').map }),
    bankDoor: worldMat({ map: T.texBankDoor(), emissive: new THREE.Color('#5a4826'), emissiveIntensity: 0.6 }),
    vaultDoor: worldMat({ map: T.texVaultDoor() }),
  };
  return cached;
}

function lampPoolTex() {
  const { c, ctx } = T.makeCanvas(16, 16);
  // pixelated radial falloff
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5) / 8;
      const v = Math.max(0, 1 - d);
      const q = Math.round(v * v * 4) / 4;
      ctx.fillStyle = `rgb(${q * 255},${q * 255},${q * 255})`;
      ctx.fillRect(x, y, 1, 1);
    }
  return T.toTexture(c, false);
}
