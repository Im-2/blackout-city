// The harbour's fixed parts: the lagoon's quay, piers, boardwalk, cranes, the cargo
// ship, and the seawall's colliders. All merged into the city's chunks. Colliders below
// y = 0 stop boats; colliders above stop people and cars, with gaps where a pier starts.
import { BRIDGE, CHANNEL, CURB_H, HALF, LAGOON, ROAD_HALF, SHORE, surfaces } from './layout';
import type { City } from './city';

export interface DeckDef { x0: number; z0: number; x1: number; z1: number; h: number; /** the side you walk on from */ open: 'w' | 'n'; piles?: number; }

const WOOD = '#6e5a44', WOOD2 = '#5e4c3a', STEEL = '#3a3c3e', CONCRETE = '#7a766d';

export const EAST_PIER = { x0: SHORE, z0: 52, x1: 395, z1: 60, h: 0.5, open: 'w' } satisfies DeckDef;
export const CARGO_PIER = { x0: SHORE, z0: 160, x1: 410, z1: 176, h: 0.5, open: 'w', piles: 14 } satisfies DeckDef;
export const VILLA_JETTY = { x0: 143, z0: SHORE, x1: 151, z1: 372, h: 0.5, open: 'n' } satisfies DeckDef;
export const BOARDWALK = { x0: -140, z0: SHORE, x1: -50, z1: 351, h: 0.4, open: 'n', piles: 12 } satisfies DeckDef;
/** where the seawall opens onto the boardwalk */
const BOARDWALK_GAP: [number, number] = [-98, -90];

export function buildWaterfront(city: City) {
  const col = city.col;
  const low = (x0: number, z0: number, x1: number, z1: number) => col.add(x0, -3, z0, x1, 0, z1, false, 'seawall');
  const high = (x0: number, z0: number, x1: number, z1: number, h = 1.6) => col.add(x0, 0, z0, x1, h, z1, false, 'seawall');
  const wallV = (x: number, z: number) => city.useAt(x, z);

  // ---- the long seawall, south and east
  const west = -HALF - 70;
  const southGaps: [number, number][] = [BOARDWALK_GAP, [VILLA_JETTY.x0, VILLA_JETTY.x1]];
  let cur = west;
  for (const [a, b] of [[CHANNEL.x0, CHANNEL.x1], ...southGaps].sort((p, q) => p[0] - q[0]) as [number, number][]) {
    high(cur, SHORE - 0.5, a, SHORE);
    cur = b;
  }
  high(cur, SHORE - 0.5, SHORE, SHORE);
  low(west, SHORE - 0.5, CHANNEL.x0, SHORE);
  low(CHANNEL.x1, SHORE - 0.5, SHORE, SHORE);
  cur = west;
  for (const [a, b] of [[EAST_PIER.z0, EAST_PIER.z1], [CARGO_PIER.z0, CARGO_PIER.z1]] as [number, number][]) {
    high(SHORE - 0.5, cur, SHORE, a);
    cur = b;
  }
  high(SHORE - 0.5, cur, SHORE, SHORE);
  low(SHORE - 0.5, west, SHORE, SHORE);

  // ---- the lagoon: stone edge, a low rail, and the channel out
  const L = LAGOON, C = CHANNEL;
  const stone = { color: CONCRETE, shadeSides: true };
  const q = wallV((L.x0 + L.x1) / 2, (L.z0 + L.z1) / 2);
  q.box(L.x0 - 0.3, -1.6, L.z0 - 0.3, L.x1 + 0.3, CURB_H + 0.02, L.z0, stone);
  q.box(L.x0 - 0.3, -1.6, L.z0, L.x0, CURB_H + 0.02, L.z1, stone);
  q.box(L.x1, -1.6, L.z0, L.x1 + 0.3, CURB_H + 0.02, L.z1, stone);
  q.box(L.x0, -1.6, L.z1, C.x0, CURB_H + 0.02, L.z1 + 0.3, stone);
  q.box(C.x1, -1.6, L.z1, L.x1, CURB_H + 0.02, L.z1 + 0.3, stone);
  low(L.x0 - 0.3, L.z0 - 0.3, L.x1 + 0.3, L.z0);
  low(L.x0 - 0.3, L.z0, L.x0, L.z1 + 0.3);
  low(L.x1, L.z0, L.x1 + 0.3, L.z1 + 0.3);
  low(L.x0, L.z1, C.x0, L.z1 + 0.3);
  low(C.x1, L.z1, L.x1, L.z1 + 0.3);
  const railBox = (x0: number, z0: number, x1: number, z1: number) => {
    col.add(x0, 0, z0, x1, 1.15, z1, false, 'rail');
    q.box(x0, CURB_H + 0.85, z0, x1, CURB_H + 0.95, z1, { color: STEEL });
  };
  railBox(L.x0 - 0.15, L.z0 - 0.15, L.x1 + 0.15, L.z0 + 0.05);
  railBox(L.x0 - 0.15, L.z0, L.x0 + 0.05, L.z1 + 0.15);
  railBox(L.x1 - 0.05, L.z0, L.x1 + 0.15, L.z1 + 0.15);
  railBox(L.x0, L.z1 - 0.05, C.x0, L.z1 + 0.15);
  railBox(C.x1, L.z1 - 0.05, L.x1, L.z1 + 0.15);
  for (let x = L.x0; x <= L.x1; x += 3) q.cbox(x, CURB_H + 0.45, L.z0 - 0.05, 0.08, 0.9, 0.08, { color: STEEL });
  for (let z = L.z0; z <= L.z1; z += 3) { q.cbox(L.x0, CURB_H + 0.45, z, 0.08, 0.9, 0.08, { color: STEEL }); q.cbox(L.x1, CURB_H + 0.45, z, 0.08, 0.9, 0.08, { color: STEEL }); }
  // channel walls: boats all the way, people only where there's no road over it
  const zn = HALF - ROAD_HALF, zs = HALF + ROAD_HALF;
  const chan = wallV((C.x0 + C.x1) / 2, (C.z0 + C.z1) / 2);
  for (const x of [C.x0 - 0.3, C.x1]) {
    chan.box(x, -1.6, C.z0, x + 0.3, 0.02, C.z1, stone);
    low(x, C.z0, x + 0.3, C.z1);
    col.add(x, 0, C.z0, x + 0.3, 1.15, zn, false, 'rail');
    col.add(x, 0, zs, x + 0.3, 1.15, SHORE, false, 'rail');
  }

  // ---- decks
  deck(city, EAST_PIER);
  deck(city, CARGO_PIER);
  deck(city, VILLA_JETTY);
  deck(city, BOARDWALK, BOARDWALK_GAP);

  // boardwalk life: benches and lamps
  const bw = wallV((BOARDWALK.x0 + BOARDWALK.x1) / 2, SHORE);
  for (let x = BOARDWALK.x0 + 6; x < BOARDWALK.x1 - 3; x += 14) {
    bw.box(x, BOARDWALK.h, BOARDWALK.z1 - 1.5, x + 2.2, BOARDWALK.h + 0.46, BOARDWALK.z1 - 0.9, { color: WOOD2, shadeSides: true });
    bw.cbox(x + 5, BOARDWALK.h + 1.8, BOARDWALK.z1 - 0.5, 0.12, 3.6, 0.12, { color: STEEL });
    bw.cbox(x + 5, BOARDWALK.h + 3.7, BOARDWALK.z1 - 0.5, 0.5, 0.25, 0.3, { color: '#ffd98a' });
    col.addCentered(x + 5, BOARDWALK.z1 - 0.5, 0.2, 0.2, 4, BOARDWALK.h, false, 'pole');
  }

  // ---- cargo pier: cranes, containers, a shed, a ship tied up alongside
  const cz = (CARGO_PIER.z0 + CARGO_PIER.z1) / 2, ct = wallV(SHORE, CARGO_PIER.z0);
  const y = CARGO_PIER.h;
  const solid = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: string) => {
    ct.box(x0, y0, z0, x1, y1, z1, { color, shadeSides: true });
    col.add(x0, y0, z0, x1, y1, z1, true, 'container');
  };
  for (const x of [362, 390]) {
    for (const [dx, dz] of [[-3, -7], [3, -7], [-3, 7], [3, 7]]) { ct.cbox(x + dx, y + 8, cz + dz, 0.7, 16, 0.7, { color: '#c9552a', shadeSides: true }); col.addCentered(x + dx, cz + dz, 0.7, 0.7, 8, y, false, 'crane'); }
    ct.box(x - 3.5, y + 15.8, cz - 7.5, x + 3.5, y + 17, cz + 7.5, { color: '#c9552a', shadeSides: true });
    ct.box(x - 0.9, y + 17, cz - 26, x + 0.9, y + 18.2, cz + 12, { color: '#d8782a', shadeSides: true }); // the boom, out over the water
    ct.box(x - 1.3, y + 14.4, cz + 7.6, x + 1.3, y + 17, cz + 12, { color: '#2f3b4d', shadeSides: true });
    ct.cbox(x, y + 12, cz - 20, 0.08, 10, 0.08, { color: STEEL });
    ct.cbox(x, y + 7, cz - 20, 2.6, 0.5, 1.2, { color: '#e6c84a' });
  }
  const crates = ['#9b3b2f', '#3f7b88', '#c4a03c', '#4a5b39', '#7a2f2a', '#2f4a6a'];
  let k = 0;
  for (let x = 351; x < 402; x += 7) for (const z of [CARGO_PIER.z0 + 0.8, CARGO_PIER.z1 - 3.4]) {
    if (x > 394 && z < cz) continue;
    if (k % 3 === 2) { k++; continue; }
    solid(x, y, z, x + 6, y + 2.6, z + 2.6, crates[k % crates.length]);
    if (k % 2) ct.box(x, y + 2.6, z, x + 6, y + 5.2, z + 2.6, { color: crates[(k + 2) % crates.length], shadeSides: true });
    k++;
  }
  // ship
  const sx0 = 355, sx1 = 415, sz0 = 182, sz1 = 195, sh = wallV(SHORE, sz0);
  sh.box(sx0, -2, sz0, sx1, 4.5, sz1, { color: '#2a3a4a', shadeSides: true });
  sh.box(sx0 - 3, -2, sz0 + 3, sx0, 4.5, sz1 - 3, { color: '#2a3a4a', shadeSides: true });
  sh.box(sx0, 3.9, sz0 - 0.03, sx1, 4.5, sz1 + 0.03, { color: '#8a2a22' });
  sh.box(sx1 - 16, 4.5, sz0 + 1, sx1 - 2, 13, sz1 - 1, { color: '#d8d4c8', shadeSides: true });
  sh.box(sx1 - 13, 13, sz0 + 3, sx1 - 8, 18, sz1 - 3, { color: '#7a2f2a', shadeSides: true });
  for (let x = sx0 + 2; x < sx1 - 20; x += 7) sh.box(x, 4.5, sz0 + 2, x + 6, 7, sz1 - 2, { color: crates[(x | 0) % crates.length], shadeSides: true });
  col.add(sx0 - 3, -3, sz0, sx1, 7, sz1, true, 'ship');

  // a shed at the landward end of the docks pier, for the marina
  const mp = wallV(SHORE, EAST_PIER.z0);
  mp.box(EAST_PIER.x1 - 8, EAST_PIER.h, EAST_PIER.z0 + 1, EAST_PIER.x1 - 2, EAST_PIER.h + 2.8, EAST_PIER.z1 - 1, { color: '#8a7a5a', shadeSides: true });
  mp.box(EAST_PIER.x1 - 8.3, EAST_PIER.h + 2.8, EAST_PIER.z0 + 0.7, EAST_PIER.x1 - 1.7, EAST_PIER.h + 3, EAST_PIER.z1 - 0.7, { color: '#3e5870' });
  col.add(EAST_PIER.x1 - 8, EAST_PIER.h, EAST_PIER.z0 + 1, EAST_PIER.x1 - 2, EAST_PIER.h + 2.8, EAST_PIER.z1 - 1, true, 'shed');
}

/** planks on piles, with rails on every side but the way on */
function deck(city: City, d: DeckDef, gap?: [number, number]) {
  const col = city.col, b = city.useAt(Math.min(d.x1, SHORE), Math.min(d.z1, SHORE));
  surfaces.push({ x0: d.x0 - 0.6, z0: d.z0 - 0.6, x1: d.x1, z1: d.z1, h0: d.h });
  b.box(d.x0, d.h - 0.35, d.z0, d.x1, d.h - 0.02, d.z1, { color: WOOD2, shadeSides: true });
  const alongX = d.x1 - d.x0 > d.z1 - d.z0;
  const a0 = alongX ? d.x0 : d.z0, a1 = alongX ? d.x1 : d.z1;
  for (let a = a0; a < a1; a += 0.9) {
    const a2 = Math.min(a + 0.82, a1);
    if (alongX) b.box(a, d.h - 0.02, d.z0, a2, d.h, d.z1, { color: (a * 3 | 0) % 2 ? WOOD : WOOD2 });
    else b.box(d.x0, d.h - 0.02, a, d.x1, d.h, a2, { color: (a * 3 | 0) % 2 ? WOOD : WOOD2 });
  }
  const step = d.piles ?? 9;
  const pile = (x: number, z: number) => {
    b.cbox(x, (d.h - 3) / 2, z, 0.5, d.h + 3, 0.5, { color: '#4a3c30', shadeSides: true });
    col.add(x - 0.25, -3, z - 0.25, x + 0.25, 0, z + 0.25, false, 'pile');
  };
  if (alongX) for (let x = d.x0 + 3; x < d.x1; x += step) { pile(x, d.z0 + 0.3); pile(x, d.z1 - 0.3); }
  else for (let z = d.z0 + 3; z < d.z1; z += step) { pile(d.x0 + 0.3, z); pile(d.x1 - 0.3, z); }
  const rail = (x0: number, z0: number, x1: number, z1: number) => {
    col.add(x0, d.h, z0, x1, d.h + 1.1, z1, false, 'rail');
    b.box(x0, d.h + 0.85, z0, x1, d.h + 0.95, z1, { color: STEEL });
    const n = Math.max(x1 - x0, z1 - z0);
    for (let t = 0; t <= n; t += 3) b.cbox(x1 - x0 > z1 - z0 ? x0 + t : (x0 + x1) / 2, d.h + 0.45, x1 - x0 > z1 - z0 ? (z0 + z1) / 2 : z0 + t, 0.08, 0.9, 0.08, { color: STEEL });
  };
  const t = 0.12;
  if (d.open === 'w') {
    rail(d.x0, d.z0, d.x1, d.z0 + t); rail(d.x0, d.z1 - t, d.x1, d.z1); rail(d.x1 - t, d.z0, d.x1, d.z1);
  } else {
    rail(d.x0, d.z0, d.x0 + t, d.z1); rail(d.x1 - t, d.z0, d.x1, d.z1); rail(d.x0, d.z1 - t, d.x1, d.z1);
    void gap;
  }
}
