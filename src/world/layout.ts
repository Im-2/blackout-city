// City grid constants, road graph and street naming. Pure data, no rendering.

export const BLOCKS = 12;
export const PITCH = 56;
export const ROAD_HALF = 7;
export const SIDEWALK = 4;
export const CURB_H = 0.15;
export const HALF = (BLOCKS * PITCH) / 2; // 336
/** waterline on the south and east sides of the map */
export const SHORE = HALF + ROAD_HALF + 2;
export const LANE = 2.2; // traffic lane centre offset from road centre
export const PARK_LANE = 5.6;

/** Road centre-line coordinate for road index 0..BLOCKS. */
export const roadCoord = (i: number) => i * PITCH - HALF;

/** Block bounds (curb to curb) for block index bi,bj. */
export function blockBounds(bi: number, bj: number) {
  return {
    x0: roadCoord(bi) + ROAD_HALF,
    x1: roadCoord(bi + 1) - ROAD_HALF,
    z0: roadCoord(bj) + ROAD_HALF,
    z1: roadCoord(bj + 1) - ROAD_HALF,
  };
}

export function blockCenter(bi: number, bj: number) {
  return { x: roadCoord(bi) + PITCH / 2, z: roadCoord(bj) + PITCH / 2 };
}

export function blockAt(x: number, z: number): [number, number] | null {
  const bi = Math.floor((x + HALF) / PITCH), bj = Math.floor((z + HALF) / PITCH);
  if (bi < 0 || bj < 0 || bi >= BLOCKS || bj >= BLOCKS) return null;
  return [bi, bj];
}

/** Distance from point to nearest road centre-line in x and z. */
function nearestRoadOffset(v: number) {
  const i = Math.round((v + HALF) / PITCH);
  const ic = Math.max(0, Math.min(BLOCKS, i));
  return v - roadCoord(ic);
}

export function isRoad(x: number, z: number) {
  const inX = Math.abs(nearestRoadOffset(x)) < ROAD_HALF && Math.abs(z) < HALF + ROAD_HALF;
  const inZ = Math.abs(nearestRoadOffset(z)) < ROAD_HALF && Math.abs(x) < HALF + ROAD_HALF;
  return inX || inZ;
}

/** boats get turned back past this */
export const SEA_LIMIT = HALF + 105;
export const WATER_Y = -1.5;
/** the marina basin, dug out of one park block */
export const LAGOON = { x0: -45, z0: 291, x1: -11, z1: 325 };
/** the cut from the lagoon out to the bay, under the ring road */
export const CHANNEL = { x0: -40, z0: 325, x1: -16, z1: SHORE };
/** the span of the drawbridge along the ring */
export const BRIDGE = { x0: -40, x1: -16 };
export const BRIDGE_H = 1.4;
/** the elevated metro: corners of its loop, along the middle of the roads */
export const METRO_LINE: [number, number][] = [[-280, 0], [-280, -280], [56, -280], [56, -56], [168, -56], [168, 168], [-112, 168], [-112, 0]];
export const METRO_RAIL = 10;

export function isWater(x: number, z: number) {
  if (x > SHORE || z > SHORE) return true;
  if (z < LAGOON.z0 || z > SHORE) return false;
  if (x > LAGOON.x0 && x < LAGOON.x1 && z < LAGOON.z1) return true;
  return x > CHANNEL.x0 && x < CHANNEL.x1 && z >= CHANNEL.z0;
}

export function groundHeight(x: number, z: number) {
  if (isWater(x, z)) return WATER_Y;
  return isRoad(x, z) ? 0 : CURB_H;
}

/** Walkable/drivable platforms (parking decks, ramps, rooftops, station floors). */
export interface Surface {
  x0: number; z0: number; x1: number; z1: number;
  /** flat height, or a ramp from h0 at the start edge to h1 at the end edge along `axis` */
  h0: number; h1?: number; axis?: 'x' | 'z';
}
export const surfaces: Surface[] = [];

/** Highest surface under (x,z) that is not above curY + step (so you can drive under decks). */
export function surfaceHeight(x: number, z: number, curY = 0, step = 0.7) {
  // underground (metro) has no street above it to snap up to
  let best = curY < -2 ? -Infinity : groundHeight(x, z);
  for (const s of surfaces) {
    if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
    let h = s.h0;
    if (s.h1 !== undefined) {
      const t = s.axis === 'x' ? (x - s.x0) / (s.x1 - s.x0) : (z - s.z0) / (s.z1 - s.z0);
      h = s.h0 + (s.h1 - s.h0) * t;
    }
    if (h <= curY + step && h > best) best = h;
  }
  return best;
}

// Street names (original, generic).
export const RING = 'Ring Hwy';
export const AVENUES = [RING, 'Birch Ave', 'Cooper Ave', 'Quarry Ave', '2nd Ave', 'Kettle Ave', 'Main Ave', 'Lantern Ave', '6th Ave', 'Harbor Ave', 'Pier Ave', 'Gantry Ave', RING];
export const STREETS = [RING, 'Elm St', 'Orchard St', 'Rail St', 'Foundry St', 'Bank St', 'Union Blvd', 'Canal St', 'Mill St', 'Dock St', 'Marina St', 'Shore Rd', RING];

/** node the overpass flies over */
export const OVERPASS = { i: 10, j: 4 };

// ---- Road graph -----------------------------------------------------------
export interface RNode {
  id: number;
  i: number;
  j: number;
  x: number;
  z: number;
  edges: number[]; // edge ids
  hasLight: boolean;
}
export interface REdge {
  id: number;
  a: number;
  b: number;
  /** 'x' = runs along x (an E-W street), 'z' = runs along z (an avenue) */
  axis: 'x' | 'z';
  name: string;
  len: number;
  /** closed by a street event / barrier (traffic avoids it) */
  closed?: boolean;
}

export class RoadGraph {
  nodes: RNode[] = [];
  edges: REdge[] = [];

  constructor() {
    const N = BLOCKS + 1;
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++)
        this.nodes.push({ id: j * N + i, i, j, x: roadCoord(i), z: roadCoord(j), edges: [], hasLight: false });
    const link = (a: number, b: number, axis: 'x' | 'z', name: string, len = PITCH) => {
      const e: REdge = { id: this.edges.length, a, b, axis, name, len };
      this.edges.push(e);
      this.nodes[a].edges.push(e.id);
      this.nodes[b].edges.push(e.id);
    };
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        // the overpass: Foundry St flies over Pier Ave without a junction
        if (j === OVERPASS.j && i === OVERPASS.i - 1) { link(j * N + i, j * N + i + 2, 'x', STREETS[j], PITCH * 2); continue; }
        if (j === OVERPASS.j && i === OVERPASS.i) { if (j < N - 1) link(j * N + i, (j + 1) * N + i, 'z', AVENUES[i]); continue; }
        if (i < N - 1) link(j * N + i, j * N + i + 1, 'x', STREETS[j]);
        if (j < N - 1) link(j * N + i, (j + 1) * N + i, 'z', AVENUES[i]);
      }
    // no lights on the highway ring
    for (const n of this.nodes) n.hasLight = n.edges.length >= 3 && n.i > 0 && n.j > 0 && n.i < BLOCKS && n.j < BLOCKS;
  }

  node(i: number, j: number) {
    return this.nodes[j * (BLOCKS + 1) + i];
  }

  other(e: REdge, n: number) {
    return e.a === n ? e.b : e.a;
  }

  nearestNode(x: number, z: number): RNode {
    const i = Math.max(0, Math.min(BLOCKS, Math.round((x + HALF) / PITCH)));
    const j = Math.max(0, Math.min(BLOCKS, Math.round((z + HALF) / PITCH)));
    return this.node(i, j);
  }

  /** The edge whose road the point is on (or nearest), with param t along a->b. */
  edgeAt(x: number, z: number): { edge: REdge; t: number; dist: number } {
    let best: REdge = this.edges[0], bt = 0, bd = Infinity;
    for (const e of this.edges) {
      const A = this.nodes[e.a], B = this.nodes[e.b];
      const dx = B.x - A.x, dz = B.z - A.z;
      const L2 = dx * dx + dz * dz;
      let t = ((x - A.x) * dx + (z - A.z) * dz) / L2;
      t = Math.max(0, Math.min(1, t));
      const px = A.x + dx * t, pz = A.z + dz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < bd) { bd = d; best = e; bt = t; }
    }
    return { edge: best, t: bt, dist: bd };
  }

  /** Dijkstra on the node graph, optional per-edge cost multiplier. */
  path(from: number, to: number, cost?: (e: REdge) => number): number[] {
    const n = this.nodes.length;
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    dist[from] = 0;
    for (;;) {
      let u = -1, best = Infinity;
      for (let i = 0; i < n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
      if (u < 0 || u === to) break;
      done[u] = 1;
      for (const eid of this.nodes[u].edges) {
        const e = this.edges[eid];
        const v = this.other(e, u);
        const d = dist[u] + e.len * (cost ? cost(e) : 1);
        if (d < dist[v]) { dist[v] = d; prev[v] = u; }
      }
    }
    const out: number[] = [];
    for (let c = to; c >= 0; c = prev[c]) {
      out.unshift(c);
      if (c === from) break;
    }
    return out[0] === from ? out : [from];
  }

  edgeBetween(a: number, b: number): REdge | undefined {
    for (const eid of this.nodes[a].edges) {
      const e = this.edges[eid];
      if (this.other(e, a) === b) return e;
    }
    return undefined;
  }
}

/** Point in the right-hand lane travelling from node a to node b, at param t. */
export function lanePoint(ax: number, az: number, bx: number, bz: number, t: number, offset = LANE) {
  const dx = bx - ax, dz = bz - az;
  const L = Math.hypot(dx, dz) || 1;
  // right-hand side of travel direction (forward = (dx,dz)); right = (-dz, dx) in this world
  const rx = -dz / L, rz = dx / L;
  return { x: ax + dx * t + rx * offset, z: az + dz * t + rz * offset };
}

// Key locations
/** park blocks kept clear down the middle: the run-ups for the stunt ramps */
export const RUNWAYS = [[3, 10], [5, 10], [7, 10]];
export const BANK_BLOCK: [number, number] = [4, 5];
export const DROP_BLOCK: [number, number] = [8, 8];
