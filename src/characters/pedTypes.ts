// Pedestrian archetypes built by recolouring / rescaling / re-propping the
// four reference sheets (player, cop, roadman, roadman2).
import { Rng } from '../core/math';
import { Skin, PLAYER_SKIN, COP_SKIN, GUARD_SKIN, ROADMAN_SKIN, ROADMAN2_SKIN } from './skins';

export type PedType =
  | 'office' | 'jogger' | 'courier' | 'vendor' | 'busker' | 'tourist' | 'teen'
  | 'construction' | 'security' | 'homeless' | 'dogwalker' | 'local';

/** Relative spawn weights (stationary roles are placed at spots instead). */
export const WALKER_WEIGHTS: [PedType, number][] = [
  ['office', 5], ['local', 6], ['teen', 3], ['tourist', 2], ['courier', 2], ['jogger', 1.5], ['construction', 1.5], ['dogwalker', 1.2],
];

const SKINS = ['#d48a5c', '#c47a4c', '#e0a27a', '#a8683e', '#8a5232', '#e6b08a', '#6e4026'];
const HAIRS = ['#3a2a20', '#1b1612', '#6a3a1c', '#8a6a3a', '#2a2420', '#4a3a30', '#9a9a92', '#b08a50'];
const MUTED = ['#5f6b4f', '#3e5870', '#7b4a34', '#b39a73', '#6e6a62', '#4a5160', '#8a7a5a', '#5a4a5a', '#2f3b4d', '#9b3b2f'];
const BRIGHT = ['#4f9a2e', '#8fb0d6', '#c4a03c', '#c96a3a', '#3f7b88', '#d8d0bc', '#9b3b2f', '#6e3f5c'];
const PANTS = ['#2c2e3c', '#232323', '#4a4438', '#3b4a5c', '#2f2f30', '#5a5040', '#6a6050'];
const SHOES = ['#2a2a2a', '#6b3f24', '#1e1e1e', '#d0c8b8', '#4a3424'];

let n = 0;

export function makePedSkin(type: PedType, r: Rng): Skin {
  const base = (s: Skin): Skin => ({
    ...s,
    key: `${type}${n++}`,
    skin: r.pick(SKINS),
    hair: r.pick(HAIRS),
    height: r.range(0.93, 1.07),
    width: r.range(0.92, 1.12),
    bracelet: undefined,
    badge: false,
    props: [],
  });
  switch (type) {
    case 'office': {
      const s = base(PLAYER_SKIN);
      s.top = r.pick(['#c9c8a8', '#d8d4cc', '#a8b8c8', '#c8b8a8', '#2f3b4d', '#3a3a3e']);
      s.tie = r.chance(0.6) ? r.pick(['#3d4b2f', '#5a2a2a', '#22283a', '#6a5a2a']) : undefined;
      s.pants = r.pick(['#2f2f30', '#23283a', '#3a3530']);
      s.shoes = r.pick(['#6b3f24', '#1e1e1e']);
      s.hairStyle = r.pick(['messy', 'short', 'bald', 'short'] as const);
      s.sleeves = r.chance(0.5) ? 'long' : 'rolled';
      s.props = ['briefcase'];
      return s;
    }
    case 'jogger': {
      const s = base(ROADMAN2_SKIN);
      s.topStyle = 'tee'; s.sleeves = 'short';
      s.top = r.pick(BRIGHT); s.pants = r.pick(['#1e1e1e', '#3b4a5c', '#5a5a62']);
      s.shoes = '#d0c8b8'; s.sole = '#e0d8c4'; s.cap = r.chance(0.4) ? r.pick(['#1e1e1e', '#d8d0bc']) : undefined;
      s.glasses = false; s.beard = r.chance(0.3) ? s.hair : undefined; s.headphones = r.chance(0.5) ? '#d8d4cc' : undefined;
      s.width *= 0.95;
      return s;
    }
    case 'courier': {
      const s = base(ROADMAN_SKIN);
      s.top = r.pick(['#c96a3a', '#c4a03c', '#3f7b88']); s.topStyle = r.chance(0.5) ? 'hoodie' : 'tee';
      s.sleeves = s.topStyle === 'tee' ? 'short' : 'rolled';
      s.cap = r.pick(['#1e1e1e', '#c96a3a', '#2f3b4d']); s.headphones = undefined; s.glasses = r.chance(0.3);
      s.props = r.chance(0.6) ? ['parcel'] : ['backpack', 'parcel'];
      return s;
    }
    case 'vendor': {
      const s = base(ROADMAN2_SKIN);
      s.topStyle = 'tee'; s.top = r.pick(MUTED); s.sleeves = 'short'; s.cap = r.chance(0.6) ? '#d8d0bc' : undefined;
      s.props = ['apron']; s.width *= 1.08;
      return s;
    }
    case 'busker': {
      const s = base(ROADMAN_SKIN);
      s.top = r.pick(MUTED); s.topStyle = r.pick(['hoodie', 'shirt'] as const); s.headphones = undefined;
      s.hairStyle = r.pick(['ponytail', 'messy'] as const); s.props = ['guitar'];
      return s;
    }
    case 'tourist': {
      const s = base(ROADMAN2_SKIN);
      s.top = r.pick(BRIGHT); s.stripe = '#f0f0e8'; s.topStyle = r.pick(['stripes', 'tee'] as const);
      s.pants = r.pick(['#b39a73', '#d8d0bc', '#3b4a5c']); s.cap = r.chance(0.6) ? r.pick(['#d8d0bc', '#c4a03c', '#3f7b88']) : undefined;
      s.props = r.chance(0.5) ? ['camera', 'backpack'] : ['camera'];
      return s;
    }
    case 'teen': {
      const s = base(ROADMAN_SKIN);
      s.top = r.pick(BRIGHT.concat(MUTED)); s.topStyle = r.pick(['hoodie', 'tee'] as const);
      s.sleeves = s.topStyle === 'tee' ? 'short' : r.pick(['rolled', 'long'] as const);
      s.beard = undefined; s.glasses = r.chance(0.25); s.headphones = r.chance(0.5) ? r.pick(['#2c2c30', '#d8d4cc', '#9b3b2f']) : undefined;
      s.cap = r.chance(0.3) ? r.pick(['#1e1e1e', '#9b3b2f']) : undefined; s.height *= 0.94; s.width *= 0.92;
      s.props = r.chance(0.5) ? ['phone', 'backpack'] : ['phone'];
      return s;
    }
    case 'construction': {
      const s = base(ROADMAN2_SKIN);
      s.topStyle = 'tee'; s.top = r.pick(['#d8782a', '#c4c030']); s.hivis = true; s.sleeves = 'short';
      s.pants = r.pick(['#3b4a5c', '#4a4438']); s.shoes = '#4a3424'; s.cap = undefined; s.glasses = false;
      s.props = ['hardhat']; s.width *= 1.1;
      return s;
    }
    case 'security': {
      const s = { ...GUARD_SKIN, key: `security${n++}`, skin: r.pick(SKINS), height: r.range(0.98, 1.06), props: [] } as Skin;
      return s;
    }
    case 'homeless': {
      const s = base(ROADMAN_SKIN);
      s.top = r.pick(['#4a4438', '#5a4a3a', '#3a3a34']); s.topStyle = 'hoodie'; s.headphones = undefined; s.glasses = false;
      s.beard = r.pick(['#6a6a62', '#3a2a20']); s.hair = s.beard; s.pants = '#3a3530'; s.shoes = '#2a2420';
      s.cap = r.chance(0.5) ? '#3a3a34' : undefined;
      return s;
    }
    case 'dogwalker': case 'local': default: {
      const s = base(r.chance(0.5) ? ROADMAN_SKIN : ROADMAN2_SKIN);
      s.top = r.pick(MUTED.concat(BRIGHT)); s.topStyle = r.pick(['hoodie', 'stripes', 'shirt', 'tee'] as const);
      s.sleeves = s.topStyle === 'hoodie' ? r.pick(['rolled', 'long'] as const) : 'short';
      s.under = r.pick(['#e6e0d4', '#2a2a2a', '#c9b98f']); s.stripe = '#d8e4f0';
      s.pants = r.pick(PANTS); s.shoes = r.pick(SHOES); s.sole = r.chance(0.4) ? '#e0d8c4' : undefined;
      s.beard = r.chance(0.4) ? s.hair : undefined; s.glasses = r.chance(0.3);
      s.headphones = r.chance(0.15) ? '#2c2c30' : undefined; s.cap = r.chance(0.2) ? r.pick(['#1e1e1e', '#2f3b4d', '#c4a03c']) : undefined;
      s.hairStyle = r.pick(['messy', 'short', 'ponytail', 'buzz', 'bald'] as const);
      return s;
    }
  }
}

export const COP_LIKE = COP_SKIN;
