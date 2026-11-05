// Character skins: colours/details copied from the reference sheets in /assets.
import { Rng } from '../core/math';

export interface Skin {
  key: string;
  skin: string;
  hair: string;
  hairStyle: 'messy' | 'short' | 'ponytail' | 'buzz' | 'bald';
  top: string;
  topStyle: 'shirt' | 'uniform' | 'hoodie' | 'stripes' | 'tee';
  sleeves: 'rolled' | 'short' | 'long';
  tie?: string;
  stripe?: string;
  under?: string;
  pants: string;
  cuffs?: boolean;
  shoes: string;
  sole?: string;
  beard?: string;
  glasses?: boolean;
  glassTint?: string;
  headphones?: string;
  cap?: string;
  badge?: boolean;
  belt?: string;
  bracelet?: string;
  hivis?: boolean;
  props?: ('briefcase' | 'parcel' | 'phone' | 'camera' | 'hardhat' | 'guitar' | 'backpack' | 'apron')[];
  height: number;
  width: number;
}

export const PLAYER_SKIN: Skin = {
  key: 'player',
  skin: '#d48a5c',
  hair: '#3a2a20',
  hairStyle: 'messy',
  top: '#c9c8a8',
  topStyle: 'shirt',
  sleeves: 'rolled',
  tie: '#3d4b2f',
  pants: '#2f2f30',
  shoes: '#6b3f24',
  belt: '#1d1b19',
  height: 1,
  width: 1,
};

export const COP_SKIN: Skin = {
  key: 'cop',
  skin: '#d08658',
  hair: '#2a1e17',
  hairStyle: 'messy',
  top: '#232c40',
  topStyle: 'uniform',
  sleeves: 'rolled',
  tie: '#151a24',
  pants: '#20283a',
  shoes: '#6b3f24',
  badge: true,
  belt: '#1b1b1b',
  height: 1.02,
  width: 1.04,
};

export const GUARD_SKIN: Skin = {
  ...COP_SKIN,
  key: 'guard',
  top: '#4a4a44',
  tie: '#26261f',
  pants: '#33332e',
  hair: '#1b1612',
  hairStyle: 'short',
  width: 1.1,
};

export const SWAT_SKIN: Skin = {
  ...COP_SKIN,
  key: 'swat',
  top: '#1c2230',
  tie: '#11141b',
  pants: '#1a1f2b',
  cap: '#14171f',
  hairStyle: 'short',
  sleeves: 'long',
  width: 1.12,
};

export const ROADMAN_SKIN: Skin = {
  key: 'roadman',
  skin: '#d9915f',
  hair: '#6a3a1c',
  hairStyle: 'ponytail',
  top: '#4f9a2e',
  topStyle: 'hoodie',
  sleeves: 'rolled',
  pants: '#2c2e3c',
  cuffs: true,
  shoes: '#2a2a2a',
  beard: '#5a3018',
  glasses: true,
  headphones: '#2c2c30',
  height: 1,
  width: 1.05,
};

export const ROADMAN2_SKIN: Skin = {
  key: 'roadman2',
  skin: '#d68d5c',
  hair: '#2a2420',
  hairStyle: 'buzz',
  top: '#8fb0d6',
  topStyle: 'stripes',
  stripe: '#d8e4f0',
  under: '#e6e0d4',
  sleeves: 'short',
  pants: '#232323',
  cuffs: true,
  shoes: '#1e1e1e',
  sole: '#e0d8c4',
  beard: '#2a2420',
  glasses: true,
  cap: '#1e1e1e',
  bracelet: '#9a2a22',
  height: 1.01,
  width: 1.06,
};

const SKINS = ['#d48a5c', '#c47a4c', '#e0a27a', '#a8683e', '#8a5232', '#e6b08a'];
const HAIRS = ['#3a2a20', '#1b1612', '#6a3a1c', '#8a6a3a', '#2a2420', '#4a3a30', '#9a9a92'];
const TOPS = ['#4f9a2e', '#8fb0d6', '#9b3b2f', '#c9c8a8', '#3e5870', '#b39a73', '#5f6b4f', '#6e3f5c', '#c4a03c', '#7a7a74', '#2f3b4d'];
const PANTS = ['#2c2e3c', '#232323', '#4a4438', '#3b4a5c', '#2f2f30', '#5a5040'];
const SHOES = ['#2a2a2a', '#6b3f24', '#1e1e1e', '#d0c8b8', '#4a3424'];

/** Pedestrian variants: recolour/rescale the two roadman sheets so crowds don't look cloned. */
export function pedestrianSkin(rng: Rng, i: number): Skin {
  const base = i % 2 === 0 ? ROADMAN_SKIN : ROADMAN2_SKIN;
  if (i < 2) return base;
  const style = rng.pick(['hoodie', 'stripes', 'shirt', 'tee'] as const);
  const s: Skin = {
    ...base,
    key: `ped${i}`,
    skin: rng.pick(SKINS),
    hair: rng.pick(HAIRS),
    hairStyle: rng.pick(['messy', 'short', 'ponytail', 'buzz', 'bald'] as const),
    top: rng.pick(TOPS),
    topStyle: style,
    sleeves: style === 'hoodie' ? rng.pick(['rolled', 'long'] as const) : style === 'stripes' || style === 'tee' ? 'short' : 'rolled',
    tie: style === 'shirt' && rng.chance(0.4) ? rng.pick(['#3d4b2f', '#5a2a2a', '#22283a']) : undefined,
    stripe: '#d8e4f0',
    under: rng.pick(['#e6e0d4', '#2a2a2a', '#c9b98f']),
    pants: rng.pick(PANTS),
    shoes: rng.pick(SHOES),
    sole: rng.chance(0.5) ? '#e0d8c4' : undefined,
    beard: rng.chance(0.4) ? undefined : rng.pick(HAIRS),
    glasses: rng.chance(0.35),
    headphones: rng.chance(0.2) ? rng.pick(['#2c2c30', '#d8d4cc', '#9b3b2f']) : undefined,
    cap: rng.chance(0.25) ? rng.pick(['#1e1e1e', '#2f3b4d', '#9b3b2f', '#c4a03c']) : undefined,
    bracelet: undefined,
    height: rng.range(0.92, 1.08),
    width: rng.range(0.92, 1.15),
  };
  return s;
}
