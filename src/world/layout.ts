// City grid constants, road graph and street naming. Pure data, no rendering.

export const BLOCKS = 6;
export const PITCH = 56;
export const ROAD_HALF = 7;
export const SIDEWALK = 4;
export const CURB_H = 0.15;
export const HALF = (BLOCKS * PITCH) / 2; // 168
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

export function groundHeight(x: number, z: number) {
  return isRoad(x, z) ? 0 : CURB_H;
}

// Street names (original, generic).
export const AVENUES = ['Quarry Ave', '2nd Ave', 'Kettle Ave', 'Main Ave', 'Lantern Ave', '6th Ave', 'Harbor Ave'];
export const STREETS = ['Rail St', 'Foundry St', 'Bank St', 'Union Blvd', 'Canal St', 'Mill St', 'Dock St'];

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
}

export class RoadGraph {
  nodes: RNode[] = [];
  edges: REdge[] = [];

  constructor() {
    const N = BLOCKS + 1;
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++)
        this.nodes.push({ id: j * N + i, i, j, x: roadCoord(i), z: roadCoord(j), edges: [], hasLight: false });
    const link = (a: number, b: number, axis: 'x' | 'z', name: string) => {
      const e: REdge = { id: this.edges.length, a, b, axis, name, len: PITCH };
      this.edges.push(e);
      this.nodes[a].edges.push(e.id);
      this.nodes[b].edges.push(e.id);
    };
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        if (i < N - 1) link(j * N + i, j * N + i + 1, 'x', STREETS[j]);
        if (j < N - 1) link(j * N + i, (j + 1) * N + i, 'z', AVENUES[i]);
      }
    for (const n of this.nodes) n.hasLight = n.edges.length >= 3;
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
export const BANK_BLOCK: [number, number] = [1, 2];
export const DROP_BLOCK: [number, number] = [5, 5];
