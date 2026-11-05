// Clothes: every item is a recolour of existing character parts. A Look is one item
// per slot; buildSkin() turns a Look and a haircut into the Skin the rig draws.
import { PLAYER_SKIN, Skin } from '../characters/skins';

export type Slot = 'top' | 'bottom' | 'shoes' | 'hat' | 'glasses' | 'jacket' | 'accessory';
export type StoreId = 'street' | 'office' | 'luxury' | 'pawn';

export interface Item {
  id: string;
  name: string;
  slot: Slot;
  /** where it's sold; 'home' = you already own it */
  store: StoreId | 'home';
  price: number;
  /** what a witness says */
  desc: string;
  look: Partial<Skin>;
}

export type Look = Record<Slot, string | null>;
export interface Hair { style: Skin['hairStyle']; color: string; beard: string | null; }

export const SLOTS: { id: Slot; name: string; optional: boolean }[] = [
  { id: 'top', name: 'TOPS', optional: false },
  { id: 'bottom', name: 'BOTTOMS', optional: false },
  { id: 'shoes', name: 'SHOES', optional: false },
  { id: 'hat', name: 'HATS', optional: true },
  { id: 'glasses', name: 'GLASSES', optional: true },
  { id: 'jacket', name: 'JACKETS', optional: true },
  { id: 'accessory', name: 'EXTRAS', optional: true },
];

const I = (id: string, name: string, slot: Slot, store: Item['store'], price: number, desc: string, look: Partial<Skin>): Item => ({ id, name, slot, store, price, desc, look });
const tee = (top: string): Partial<Skin> => ({ top, topStyle: 'tee', sleeves: 'short' });
const hood = (top: string): Partial<Skin> => ({ top, topStyle: 'hoodie', sleeves: 'long' });
const shirt = (top: string, tie?: string): Partial<Skin> => ({ top, topStyle: 'shirt', sleeves: 'long', tie });
const blazer = (top: string): Partial<Skin> => ({ top, topStyle: 'shirt', sleeves: 'long' });

export const ITEMS: Item[] = [
  // what you start with
  I('clerk_shirt', 'Tired clerk shirt', 'top', 'home', 0, 'a green tie', { top: '#c9c8a8', topStyle: 'shirt', sleeves: 'rolled', tie: '#3d4b2f' }),
  I('grey_hoodie', 'Grey hoodie', 'top', 'home', 0, 'a grey hoodie', hood('#6e6a62')),
  I('work_trousers', 'Work trousers', 'bottom', 'home', 0, '', { pants: '#2f2f30' }),
  I('dark_jeans', 'Dark jeans', 'bottom', 'home', 0, '', { pants: '#2c2e3c' }),
  I('brown_shoes', 'Scuffed brown shoes', 'shoes', 'home', 0, '', { shoes: '#6b3f24' }),
  I('black_shoes', 'Black trainers', 'shoes', 'home', 0, '', { shoes: '#2a2a2a' }),
  I('black_cap', 'Black cap', 'hat', 'home', 0, 'a black cap', { cap: '#1e1e1e' }),

  // THREADS: street
  I('red_tee', 'Red tee', 'top', 'street', 60, 'a red t-shirt', tee('#9b3b2f')),
  I('band_tee', 'Faded band tee', 'top', 'street', 75, 'a faded black t-shirt', tee('#2a2a2c')),
  I('sky_stripes', 'Sky stripes', 'top', 'street', 90, 'a striped blue top', { top: '#8fb0d6', topStyle: 'stripes', stripe: '#d8e4f0', under: '#e6e0d4', sleeves: 'short' }),
  I('green_hoodie', 'Green hoodie', 'top', 'street', 140, 'a green hoodie', hood('#4f9a2e')),
  I('black_hoodie', 'Black hoodie', 'top', 'street', 160, 'a black hoodie', hood('#232326')),
  I('blue_jeans', 'Blue jeans', 'bottom', 'street', 90, '', { pants: '#3b4a5c', cuffs: true }),
  I('cargo', 'Cargo pants', 'bottom', 'street', 110, '', { pants: '#5a5040' }),
  I('white_kicks', 'White trainers', 'shoes', 'street', 120, '', { shoes: '#d0c8b8', sole: '#e0d8c4' }),
  I('red_kicks', 'Red trainers', 'shoes', 'street', 150, '', { shoes: '#9b3b2f', sole: '#e0d8c4' }),
  I('red_cap', 'Red cap', 'hat', 'street', 45, 'a red cap', { cap: '#9b3b2f' }),
  I('navy_cap', 'Navy cap', 'hat', 'street', 45, 'a navy cap', { cap: '#2f3b4d' }),
  I('shades', 'Cheap shades', 'glasses', 'street', 35, 'sunglasses', { glasses: true }),
  I('bomber', 'Olive bomber', 'jacket', 'street', 240, 'an olive bomber jacket', { ...hood('#4a5b39') }),
  I('denim', 'Denim jacket', 'jacket', 'street', 220, 'a denim jacket', blazer('#3e5870')),
  I('backpack', 'Backpack', 'accessory', 'street', 80, 'a backpack', { props: ['backpack'] }),
  I('headphones', 'Headphones', 'accessory', 'street', 95, 'headphones', { headphones: '#d8d4cc' }),

  // MERIDIAN: office
  I('white_shirt', 'White shirt, navy tie', 'top', 'office', 220, 'a navy tie', shirt('#e0ddd0', '#22283a')),
  I('blue_shirt', 'Blue shirt, red tie', 'top', 'office', 240, 'a red tie', shirt('#8fa8c4', '#7a1c1c')),
  I('grey_shirt', 'Grey shirt, no tie', 'top', 'office', 180, 'a grey shirt', shirt('#8a8c8c')),
  I('navy_slacks', 'Navy slacks', 'bottom', 'office', 200, '', { pants: '#23283a' }),
  I('grey_slacks', 'Grey slacks', 'bottom', 'office', 200, '', { pants: '#55585c' }),
  I('oxfords', 'Black oxfords', 'shoes', 'office', 280, '', { shoes: '#1e1e1e' }),
  I('tan_brogues', 'Tan brogues', 'shoes', 'office', 300, '', { shoes: '#8a5a30' }),
  I('flat_cap', 'Grey flat cap', 'hat', 'office', 110, 'a grey cap', { cap: '#6a6c6e' }),
  I('readers', 'Reading glasses', 'glasses', 'office', 90, 'glasses', { glasses: true, glassTint: '#3a2a20' }),
  I('navy_blazer', 'Navy blazer', 'jacket', 'office', 750, 'a navy suit', blazer('#23283a')),
  I('char_blazer', 'Charcoal blazer', 'jacket', 'office', 750, 'a charcoal suit', blazer('#3a3c40')),
  I('briefcase', 'Briefcase', 'accessory', 'office', 260, 'a briefcase', { props: ['briefcase'] }),
  I('work_phone', 'Work phone', 'accessory', 'office', 150, 'a phone', { props: ['phone'] }),

  // VELVET: luxury
  I('silk_shirt', 'Plum silk shirt', 'top', 'luxury', 950, 'a plum silk shirt', shirt('#6e3f5c')),
  I('cream_polo', 'Cream polo', 'top', 'luxury', 800, 'a cream polo', { top: '#e6dcc0', topStyle: 'tee', sleeves: 'short' }),
  I('black_gold', 'Black shirt, gold tie', 'top', 'luxury', 1400, 'a gold tie', shirt('#1c1c1e', '#c4a03c')),
  I('cream_trousers', 'Cream trousers', 'bottom', 'luxury', 900, '', { pants: '#d8d0bc' }),
  I('black_tailored', 'Tailored black', 'bottom', 'luxury', 1100, '', { pants: '#18181a' }),
  I('white_leather', 'White leather shoes', 'shoes', 'luxury', 1200, '', { shoes: '#e8e4d8', sole: '#c4a03c' }),
  I('oxblood', 'Oxblood loafers', 'shoes', 'luxury', 1300, '', { shoes: '#5a1c1c' }),
  I('cream_cap', 'Cream cap', 'hat', 'luxury', 600, 'a cream cap', { cap: '#e6dcc0' }),
  I('aviators', 'Gold aviators', 'glasses', 'luxury', 1500, 'gold sunglasses', { glasses: true, glassTint: '#c4a03c' }),
  I('white_blazer', 'White blazer', 'jacket', 'luxury', 3200, 'a white suit', blazer('#e8e4d8')),
  I('velvet_blazer', 'Velvet blazer', 'jacket', 'luxury', 3600, 'a purple velvet jacket', blazer('#4a2a5a')),
  I('black_leather', 'Black leather jacket', 'jacket', 'luxury', 4200, 'a black leather jacket', blazer('#141416')),
  I('gold_bracelet', 'Gold bracelet', 'accessory', 'luxury', 2400, 'a gold bracelet', { bracelet: '#c4a03c' }),

  // Pawn & Loan: second-hand, and the working disguises
  I('courier_jacket', 'Courier jacket', 'jacket', 'pawn', 300, 'an orange courier jacket', { ...hood('#c96a3a'), sleeves: 'rolled' }),
  I('hivis', 'Hi-vis vest', 'top', 'pawn', 260, 'a hi-vis vest', { ...tee('#d8782a'), hivis: true }),
  I('tourist_shirt', 'Tourist shirt', 'top', 'pawn', 180, 'a striped shirt', { top: '#c4a03c', topStyle: 'stripes', stripe: '#f0f0e8', under: '#e6e0d4', sleeves: 'short' }),
  I('old_suit', 'Old navy suit jacket', 'jacket', 'pawn', 420, 'a navy suit', blazer('#23283a')),
  I('khakis', 'Khakis', 'bottom', 'pawn', 70, '', { pants: '#b39a73' }),
  I('work_boots', 'Work boots', 'shoes', 'pawn', 90, '', { shoes: '#4a3424' }),
  I('hard_hat', 'Hard hat', 'hat', 'pawn', 120, 'a hard hat', { props: ['hardhat'] }),
  I('sun_hat', 'Tourist cap', 'hat', 'pawn', 50, 'a beige cap', { cap: '#d8d0bc' }),
  I('old_camera', 'Old camera', 'accessory', 'pawn', 140, 'a camera', { props: ['camera'] }),
  I('courier_bag', 'Courier bag', 'accessory', 'pawn', 90, 'a backpack', { props: ['backpack'] }),
];

const BY_ID = new Map(ITEMS.map((i) => [i.id, i]));
export const itemById = (id: string | null | undefined) => (id ? BY_ID.get(id) : undefined);

export const START_CLOSET = ITEMS.filter((i) => i.store === 'home').map((i) => i.id);
export const clerkLook = (): Look => ({ top: 'clerk_shirt', bottom: 'work_trousers', shoes: 'brown_shoes', hat: null, glasses: null, jacket: null, accessory: null });
export const startHair = (): Hair => ({ style: 'messy', color: '#3a2a20', beard: null });

/** the whole-outfit presets older saves stored */
export const LEGACY: Record<string, { items: string[]; look: Partial<Look> }> = {
  clerk: { items: [], look: {} },
  hoodie: { items: [], look: { top: 'grey_hoodie', bottom: 'dark_jeans', shoes: 'black_shoes', hat: 'black_cap' } },
  courier: { items: ['courier_jacket', 'courier_bag', 'white_kicks'], look: { jacket: 'courier_jacket', accessory: 'courier_bag', shoes: 'white_kicks' } },
  worker: { items: ['hivis', 'hard_hat', 'work_boots', 'blue_jeans'], look: { top: 'hivis', hat: 'hard_hat', shoes: 'work_boots', bottom: 'blue_jeans' } },
  suit: { items: ['old_suit', 'blue_shirt', 'navy_slacks', 'oxfords'], look: { top: 'blue_shirt', jacket: 'old_suit', bottom: 'navy_slacks', shoes: 'oxfords' } },
  tourist: { items: ['tourist_shirt', 'sun_hat', 'old_camera', 'khakis'], look: { top: 'tourist_shirt', hat: 'sun_hat', accessory: 'old_camera', bottom: 'khakis' } },
};

export function buildSkin(look: Look, hair: Hair): Skin {
  const s: Skin = { ...PLAYER_SKIN, tie: undefined, props: [], hairStyle: hair.style, hair: hair.color, beard: hair.beard ?? undefined };
  for (const { id } of SLOTS) {
    const it = itemById(look[id]);
    if (!it) continue;
    const props = [...(s.props ?? []), ...(it.look.props ?? [])];
    Object.assign(s, it.look);
    s.props = props;
  }
  s.key = `player-${SLOTS.map((x) => look[x.id] ?? '').join('.')}-${hair.style}-${hair.color}-${hair.beard ?? ''}`;
  return s;
}

/** the part of an outfit a witness remembers: same answer = same description */
export const lookSig = (l: Look) => `${l.top}|${l.jacket ?? ''}|${l.hat ?? ''}`;

/** "a navy suit and a red cap" */
export function describe(l: Look) {
  const main = itemById(l.jacket)?.desc || itemById(l.top)?.desc || 'plain clothes';
  const hat = itemById(l.hat)?.desc;
  return hat ? `${main} and ${hat}` : main;
}

// ---------------------------------------------------------------- the barber
export const HAIR_STYLES: { id: Skin['hairStyle']; name: string; price: number }[] = [
  { id: 'messy', name: 'Slept on it', price: 15 },
  { id: 'short', name: 'Short back and sides', price: 30 },
  { id: 'buzz', name: 'Buzz cut', price: 20 },
  { id: 'ponytail', name: 'Tied back', price: 40 },
  { id: 'bald', name: 'Shaved clean', price: 25 },
];
export const HAIR_COLOURS: { id: string; name: string; price: number }[] = [
  { id: '#3a2a20', name: 'Dark brown', price: 20 },
  { id: '#1b1612', name: 'Black', price: 20 },
  { id: '#6a3a1c', name: 'Chestnut', price: 30 },
  { id: '#8a6a3a', name: 'Dirty blond', price: 35 },
  { id: '#9a9a92', name: 'Silver', price: 45 },
  { id: '#7a2a5a', name: 'Plum dye', price: 60 },
];
export const BEARDS: { id: string | null; name: string; price: number }[] = [
  { id: null, name: 'Clean shaven', price: 10 },
  { id: '#3a2a20', name: 'Brown beard', price: 25 },
  { id: '#1b1612', name: 'Black beard', price: 25 },
  { id: '#9a9a92', name: 'Grey beard', price: 30 },
];

// ---------------------------------------------------------------- things you eat
export interface Good { id: string; name: string; price: number; energy: number; sprint: number; sub: string; }
export const GOODS: Good[] = [
  { id: 'cola', name: 'Energy drink', price: 15, energy: 35, sprint: 0, sub: '+35 hack energy' },
  { id: 'coffee', name: 'Large coffee', price: 25, energy: 60, sprint: 0, sub: '+60 hack energy' },
  { id: 'bar', name: 'Protein bar', price: 12, energy: 0, sprint: 60, sub: 'Run 15 % faster for a minute' },
  { id: 'meal', name: 'Meal deal', price: 40, energy: 100, sprint: 120, sub: 'Full hack energy, run faster for two minutes' },
];
export const SNACKS: Good[] = [
  { id: 'hotdog', name: 'Hot dog', price: 8, energy: 15, sprint: 45, sub: '+15 hack energy, run faster for 45 seconds' },
  { id: 'streetcoffee', name: 'Street coffee', price: 10, energy: 40, sprint: 0, sub: '+40 hack energy' },
];
