// The shopping streets: three clothes stores, a barber and a corner shop, each a
// row on a reserved block, with a plain building filling the rest of the lot. Food
// stands are the street carts, which now sell you something.
import * as THREE from 'three';
import { blockCenter, CURB_H } from './layout';
import { Kit } from './interior';
import { districtAt, DISTRICTS, District } from '../map/districts';
import { SNACKS, StoreId } from '../player/clothes';
import type { FacadeStyle } from '../assets/textures';
import type { Buildings, Site } from './buildings';
import type { Game } from '../core/game';

const FRONT = 11; // lot edge from the block's road line
const DEPTH = 12, TOP = 5.2;

interface Unit {
  id: string;
  sign: string;
  color: string;
  wall: string;
  window: string;
  floor: string;
  floor2: string;
  /** what the screen is */
  open: StoreId | 'barber' | 'goods';
  label: string;
  intro: string;
  short: string;
  icon: 'hanger' | 'scissors' | 'cup';
  iconColor: string;
  decor: (k: Kit, x0: number, z0: number, x1: number, z1: number, s: Site) => void;
}

interface Row { bi: number; bj: number; style: FacadeStyle; back: FacadeStyle; backTop: number; units: [Unit, Unit]; }

function rail(k: Kit, x0: number, z: number, colors: string[]) {
  const w = colors.length * 0.42;
  k.block(x0, 0.15, z - 0.5, x0 + w, 0.22, z + 0.5, '#3a3c3e');
  k.solid(x0, 0.15, z - 0.3, x0 + w, 1.86, z + 0.3, false); // the shop camera has to see it too
  k.props.box(x0 - 0.05, 1.8, z - 0.05, x0 + w + 0.05, 1.86, z + 0.05, { color: '#8a8a84' });
  colors.forEach((c, i) => k.props.box(x0 + 0.06 + i * 0.42, 0.75, z - 0.26, x0 + 0.36 + i * 0.42, 1.8, z + 0.26, { color: c }));
}

function mannequin(k: Kit, x: number, z: number, top: string, pants: string, skin = '#c8c3b5') {
  k.block(x - 0.3, 0.15, z - 0.3, x + 0.3, 0.25, z + 0.3, '#3a3c3e');
  k.solid(x - 0.3, 0.15, z - 0.3, x + 0.3, 2.1, z + 0.3, false);
  k.props.cbox(x, 0.7, z, 0.34, 0.9, 0.2, { color: pants });
  k.props.cbox(x, 1.45, z, 0.46, 0.6, 0.24, { color: top });
  k.props.cbox(x, 1.92, z, 0.22, 0.26, 0.22, { color: skin });
}

const THREADS: Unit = {
  id: 'threads', sign: 'THREADS', color: '#c9552a', window: '#c8a878', wall: '#8a6a4a', floor: '#6a5a4a', floor2: '#5a4c3e',
  open: 'street', label: 'Browse street wear', icon: 'hanger', iconColor: '#ff9a5a',
  intro: 'Street clothes, cheap. Change what you\'re wearing and the description on the radio goes stale.', short: 'Cheap street clothes. A new look fools the police.',
  decor: (k, x0, z0, x1, z1) => {
    rail(k, x0 + 0.8, z0 + 3, ['#9b3b2f', '#2a2a2c', '#8fb0d6', '#4f9a2e', '#232326']);
    rail(k, x1 - 3, z0 + 3, ['#4a5b39', '#3e5870', '#c9552a', '#6e6a62', '#2f3b4d']);
    for (let x = x0 + 0.8; x < x1 - 1.5; x += 2.6) k.shelf(x, z1 - 0.9, x + 2, z1 - 0.2, 0.15, 2.2);
    mannequin(k, (x0 + x1) / 2 + 2.6, z0 + 6.2, '#4f9a2e', '#3b4a5c');
    mannequin(k, (x0 + x1) / 2 - 2.6, z0 + 6.2, '#9b3b2f', '#5a5040');
  },
};

const BARBER: Unit = {
  id: 'barber', sign: 'OLD CUTS', color: '#2f4a6a', window: '#d8d8c8', wall: '#c8c0a8', floor: '#d8d4c8', floor2: '#2a2a2c',
  open: 'barber', label: 'Sit down: haircut and shave', icon: 'scissors', iconColor: '#9fd0ff',
  intro: 'Haircuts, colours and shaves. Sit in the chair and see it before you pay.', short: 'Hair and beard. See it before you pay.',
  decor: (k, x0, z0, x1, z1) => {
    for (const x of [x0 + 2.6, x0 + 6.4]) {
      k.block(x - 0.4, 0.15, z1 - 2.6, x + 0.4, 0.7, z1 - 1.8, '#7a1c1c');
      k.props.box(x - 0.4, 0.7, z1 - 1.85, x + 0.4, 1.5, z1 - 1.75, { color: '#7a1c1c' });
      k.glow.box(x - 0.8, 1.1, z1 - 0.3, x + 0.8, 2.3, z1 - 0.26, { color: '#b8d0d8' });
      k.block(x - 0.9, 0.15, z1 - 0.7, x + 0.9, 0.95, z1 - 0.26, '#5b4330');
    }
    k.block(x0 + 0.4, 0.15, z0 + 2, x0 + 1.0, 0.6, z0 + 5, '#5b4330'); // waiting bench
  },
};

const MERIDIAN: Unit = {
  id: 'meridian', sign: 'MERIDIAN', color: '#23283a', window: '#b8c4c8', wall: '#b8b4a4', floor: '#a0a098', floor2: '#90908a',
  open: 'office', label: 'Browse office wear', icon: 'hanger', iconColor: '#a8c0e0',
  intro: 'Suits and shirts. Nobody looks twice at a suit carrying a briefcase.', short: 'Suits and shirts. Blend in downtown.',
  decor: (k, x0, z0, x1, z1) => {
    rail(k, x0 + 0.8, z0 + 2.6, ['#23283a', '#3a3c40', '#e0ddd0', '#8fa8c4', '#8a8c8c']);
    rail(k, x1 - 3, z0 + 2.6, ['#23283a', '#55585c', '#7a1c1c', '#22283a', '#e0ddd0']);
    mannequin(k, (x0 + x1) / 2, z0 + 5.6, '#23283a', '#23283a');
    k.counter(x0 + 3, z1 - 3.2, x1 - 3, z1 - 2.3, 0.15, '#3a3430');
    k.glow.box(x0 + 0.4, 1, z1 - 0.3, x0 + 1.6, 2.6, z1 - 0.26, { color: '#b8d0d8' }); // mirror
  },
};

const QUICKSTOP: Unit = {
  id: 'quickstop', sign: 'QUICKSTOP', color: '#3f7b3a', window: '#d8e8d0', wall: '#d8d6cf', floor: '#c8c3b5', floor2: '#a8a294',
  open: 'goods', label: 'Buy snacks and drinks', icon: 'cup', iconColor: '#7de0a0',
  intro: 'Energy drinks and food. Hack energy back in your hand, or a burst of speed on foot.', short: 'Drinks refill hack energy. Food: run faster.',
  decor: (k, x0, z0, x1, z1) => {
    for (let x = x0 + 0.8; x < x1 - 3; x += 2.2) k.shelf(x, z0 + 4, x + 1, z1 - 1.5);
    k.counter(x1 - 3.4, z0 + 1.2, x1 - 0.5, z0 + 2.6);
    k.block(x1 - 1.6, 0.15, z1 - 1.4, x1 - 0.4, 1.9, z1 - 0.4, '#d8d6cf');
    k.glow.box(x1 - 1.62, 0.4, z1 - 1.3, x1 - 1.6, 1.8, z1 - 0.5, { color: '#a8d8e8' });
  },
};

const VELVET: Unit = {
  id: 'velvet', sign: 'VELVET', color: '#2a1c34', window: '#e0c088', wall: '#5a4466', floor: '#4a3a52', floor2: '#5a4a64',
  open: 'luxury', label: 'Browse the collection', icon: 'hanger', iconColor: '#e6c84a',
  intro: 'Silk and leather, at silly prices. The staff judge your shoes.', short: 'Luxury clothes. Bring real money.',
  decor: (k, x0, z0, x1, z1) => {
    for (const [dx, top, pants] of [[-4, '#e8e4d8', '#d8d0bc'], [0, '#4a2a5a', '#18181a'], [4, '#141416', '#18181a']] as [number, string, string][]) {
      const cx = (x0 + x1) / 2 + dx, cz = (z0 + z1) / 2 + 2.4;
      k.block(cx - 0.7, 0.15, cz - 0.7, cx + 0.7, 0.4, cz + 0.7, '#c4a03c');
      k.solid(cx - 0.3, 0.4, cz - 0.3, cx + 0.3, 2.3, cz + 0.3, false);
      k.props.cbox(cx, 0.9, cz, 0.34, 0.9, 0.2, { color: pants });
      k.props.cbox(cx, 1.65, cz, 0.46, 0.6, 0.24, { color: top });
      k.props.cbox(cx, 2.12, cz, 0.22, 0.26, 0.22, { color: '#e8e4d8' });
    }
    rail(k, x0 + 0.8, z0 + 2.8, ['#6e3f5c', '#e6dcc0', '#1c1c1e', '#c4a03c']);
    k.glow.box(x0 + 3, 4.2, z0 + 3, x1 - 3, 4.3, z0 + 3.4, { color: '#ffd9a0' });
    k.glow.box(x0 + 0.3, 0.8, z1 - 0.3, x1 - 0.3, 0.86, z1 - 0.26, { color: '#c4a03c' });
  },
};

const ROWS: Row[] = [
  { bi: 1, bj: 6, style: 'brick', back: 'tan', backTop: 12, units: [THREADS, BARBER] },
  { bi: 7, bj: 4, style: 'office', back: 'tower', backTop: 30, units: [MERIDIAN, QUICKSTOP] },
  { bi: 5, bj: 8, style: 'slate', back: 'sage', backTop: 10, units: [VELVET, { ...QUICKSTOP, id: 'quickstop2', sign: 'CORNER SHOP', color: '#5a4a2a' }] },
];

export const STORE_BLOCKS: Record<string, [number, number]> = Object.fromEntries(ROWS.map((r) => [`stores-${r.bi}-${r.bj}`, [r.bi, r.bj]]));

export class Stores {
  private windows: Kit;

  constructor(private g: Game, private b: Buildings) {
    this.windows = new Kit(g.col);
  }

  build() {
    for (const r of ROWS) this.row(r);
    this.windows.finish(this.g.scene);
    this.foodStands();
  }

  private row(r: Row) {
    const b = this.b, g = this.g;
    const c = blockCenter(r.bi, r.bj);
    const X0 = c.x - 17, X1 = c.x + 17, Z0 = c.z - 28 + FRONT, Z1 = Z0 + DEPTH, mid = c.x;
    const spans: [Unit, number, number][] = [[r.units[0], X0, mid], [r.units[1], mid, X1]];
    const doorOf = (a: number, z: number) => (a + z) / 2;
    b.shell(X0, Z0, X1, Z1, TOP, r.style, spans.map(([, a, z]) => ({ side: 'n' as const, at: doorOf(a, z), w: 1.8, h: 2.6 })));
    // the rest of the lot
    b.shell(X0, Z1, X1, c.z + 17, r.backTop, r.back, []);
    g.col.add(mid - 0.15, 0, Z0, mid + 0.15, TOP, Z1, true, 'building');
    b.ext.box(mid - 0.15, CURB_H, Z0 + 0.5, mid + 0.15, TOP, Z1 - 0.5, { color: '#a89c86' });
    for (const [u, a, z] of spans) {
      const dx = doorOf(a, z);
      // lit windows, all in one mesh: one draw call for every store
      for (const [wa, wb] of [[a + 0.6, dx - 1.2], [dx + 1.2, z - 0.6]]) {
        b.ext.box(wa, CURB_H + 0.8, Z0 - 0.06, wb, CURB_H + 3.0, Z0 - 0.01, { color: '#25292e' });
        this.windows.glow.box(wa + 0.1, CURB_H + 0.9, Z0 - 0.08, wb - 0.1, CURB_H + 2.9, Z0 - 0.06, { color: u.window });
      }
      b.ext.box(dx - 1.1, CURB_H + 2.7, Z0 - 0.9, dx + 1.1, CURB_H + 2.8, Z0, { color: '#3a3c3e' });
      b.ext.box(a + 0.2, CURB_H + 3.3, Z0 - 0.15, z - 0.2, CURB_H + 4.5, Z0 - 0.02, { color: u.color });
      b.sign(u.sign, (a + z) / 2, CURB_H + 3.9, Z0 - 0.17, Math.PI, Math.min(8, z - a - 1), u.color, '#fff1c0');
      if (u.open === 'barber') { // the striped pole
        for (let i = 0; i < 5; i++) b.ext.cbox(dx + 1.5, CURB_H + 0.9 + i * 0.3, Z0 - 0.2, 0.16, 0.3, 0.16, { color: i % 2 ? '#e8e4d8' : '#b8231c' });
      }
      this.interior(u, a + 0.2, Z0 + 0.5, z - 0.2, Z1 - 0.5, dx, Z0);
      g.activities.add({ id: `store-${u.id}`, name: titleCase(u.sign), type: 'shop', x: dx, z: Z0 - 1, intro: u.intro, short: u.short, icon: u.icon, color: u.iconColor, category: 'shop' });
    }
  }

  private interior(u: Unit, x0: number, z0: number, x1: number, z1: number, doorX: number, wallZ: number) {
    const b = this.b, g = this.g;
    b.site({
      id: u.id, name: titleCase(u.sign), open: true, x0, z0, x1, z1, ceiling: 4.6,
      door: { x: doorX, z: wallZ - 1, heading: Math.PI }, approach: { x: doorX, z: wallZ - 2.5, heading: 0 },
      build: (k, s) => {
        k.room(x0, z0, x1, z1, { h: 4.6, floor: u.floor, floor2: u.floor2, wall: u.wall, skip: ['n', 's', 'e', 'w'] });
        // lining, so the inside doesn't show the outside's brick
        const y = 0.15, t = 4.6;
        // unlit: a shop is bright whatever the time of day
        k.glow.box(x0, y, z1 - 0.02, x1, t, z1, { color: u.wall });
        k.glow.box(x0, y, z0, x0 + 0.02, t, z1, { color: u.wall });
        k.glow.box(x1 - 0.02, y, z0, x1, t, z1, { color: u.wall });
        k.glow.box(x0, y, z0, doorX - 0.9, t, z0 + 0.02, { color: u.wall });
        k.glow.box(doorX + 0.9, y, z0, x1, t, z0 + 0.02, { color: u.wall });
        k.glow.box(doorX - 0.9, CURB_H + 2.6, z0, doorX + 0.9, t, z0 + 0.02, { color: u.wall });
        u.decor(k, x0, z0, x1, z1, s);
        b.npc(k, u.open === 'luxury' || u.open === 'office' ? 'office' : 'vendor', x1 - 1.6, z0 + (u.open === 'goods' ? 0.7 : 1.6), Math.PI / 2, s);
        s.interactables.push({
          pos: new THREE.Vector3(doorX, 0.15, z0 + 3.2), radius: 2.6, label: u.label, enabled: () => true,
          action: () => {
            if (g.police.heat > 0 && g.police.lastSeenT < 3) { g.hud.toast('NOT WITH THE POLICE WATCHING', 'dim'); g.audio.deny(); return; }
            g.shopUi.open(u.open, titleCase(u.sign));
          },
        });
      },
    });
  }

  /** every cart sells something; one per district goes on the map */
  private foodStands() {
    const g = this.g;
    const near = new Map<District, { x: number; z: number; d: number }>();
    for (const c of g.street.carts) {
      g.interactables.push({
        pos: new THREE.Vector3(c.x, CURB_H, c.z), radius: 2, label: c.kind === 'food' ? 'Food stand: hot dog $8' : 'Coffee stand: $10', enabled: () => !g.player.vehicle,
        action: () => g.shopUi.eat(c.kind === 'food' ? SNACKS[0] : SNACKS[1]),
      });
      const dist = districtAt(c.x, c.z), d = Math.hypot(c.x, c.z);
      if (!near.has(dist) || d < near.get(dist)!.d) near.set(dist, { x: c.x, z: c.z, d });
    }
    for (const [dist, c] of near) {
      g.activities.add({ id: `stand-${dist}`, name: `Food stand, ${DISTRICTS[dist].name}`, type: 'shop', x: c.x, z: c.z, intro: 'Every street cart sells something. Coffee fills your hack energy, a hot dog makes you run faster for a bit.', short: 'Coffee: hack energy. Hot dog: run faster.', icon: 'stand', color: '#ffb84a', category: 'shop', minor: true });
    }
  }
}

function titleCase(s: string) {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
