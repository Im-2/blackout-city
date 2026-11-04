// A drivable line through the road graph, for anything that follows a set route.
import { LANE, lanePoint } from '../world/layout';
import { edgePoints, turnPoints, steerTo } from '../ai/traffic';
import { clamp } from '../core/math';
import type { Vehicle } from '../vehicles/vehicle';
import type { Game } from '../core/game';

export interface Pt { x: number; z: number; }
/** the point on the line where a vehicle would stop for the junction ahead */
export interface RouteStop { idx: number; node: number; axis: 'x' | 'z'; }

export interface Route {
  pts: Pt[];
  arc: number[];
  stops: RouteStop[];
  nodes: number[];
}

/** every junction from corner to corner, closing the loop if asked */
export function expandCorners(corners: [number, number][], closed: boolean): [number, number][] {
  const out: [number, number][] = [corners[0]];
  const n = closed ? corners.length : corners.length - 1;
  for (let c = 0; c < n; c++) {
    const [ai, aj] = corners[c], [bi, bj] = corners[(c + 1) % corners.length];
    const steps = Math.max(Math.abs(bi - ai), Math.abs(bj - aj));
    for (let k = 1; k <= steps; k++) out.push([ai + Math.sign(bi - ai) * k, aj + Math.sign(bj - aj) * k]);
  }
  return out;
}

export function buildRoute(g: Game, junctions: [number, number][], offset = LANE): Route {
  const G = g.city.graph;
  const nodes = junctions.map(([i, j]) => G.node(i, j).id);
  const pts: Pt[] = [];
  const stops: RouteStop[] = [];
  const add = (p: Pt) => {
    const l = pts[pts.length - 1];
    if (!l || Math.hypot(p.x - l.x, p.z - l.z) > 0.5) pts.push(p);
  };
  for (let k = 0; k < nodes.length - 1; k++) {
    edgePoints(g, nodes[k], nodes[k + 1], offset).forEach(add);
    const e = G.edgeBetween(nodes[k], nodes[k + 1]);
    stops.push({ idx: pts.length - 1, node: nodes[k + 1], axis: e?.axis ?? 'x' });
    if (k < nodes.length - 2) turnPoints(g, nodes[k], nodes[k + 1], nodes[k + 2], offset).forEach(add);
  }
  const arc = [0];
  for (let i = 1; i < pts.length; i++) arc.push(arc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  return { pts, arc, stops, nodes };
}

/** a kerbside point in the right-hand lane of the road nearest this spot */
export function kerbNear(g: Game, x: number, z: number) {
  const G = g.city.graph;
  const { edge, t } = G.edgeAt(x, z);
  const A = G.nodes[edge.a], B = G.nodes[edge.b];
  // drive on whichever side of the road the spot is on
  const nearA = lanePoint(A.x, A.z, B.x, B.z, t, 5);
  const nearB = lanePoint(B.x, B.z, A.x, A.z, 1 - t, 5);
  const useA = Math.hypot(nearA.x - x, nearA.z - z) < Math.hypot(nearB.x - x, nearB.z - z);
  const p = useA ? nearA : nearB;
  const heading = useA ? Math.atan2(B.x - A.x, B.z - A.z) : Math.atan2(A.x - B.x, A.z - B.z);
  return { x: p.x, z: p.z, heading };
}

/** steer + throttle along a route toward a wanted speed. Returns the point index. */
export function followRoute(v: Vehicle, r: Route, idx: number, want: number) {
  while (idx < r.pts.length - 1 && Math.hypot(r.pts[idx].x - v.pos.x, r.pts[idx].z - v.pos.z) < Math.max(4.5, v.speedAbs * 0.3)) idx++;
  const aim = r.pts[Math.min(idx + 1, r.pts.length - 1)];
  v.steer = steerTo(v, aim.x, aim.z, 2.4).steer;
  v.throttle = clamp((want - v.speed) * 0.5, -1, 1);
  v.handbrake = false;
  return idx;
}

/** room ahead of this vehicle before it reaches another one in its lane */
export function gapAhead(g: Game, v: Vehicle) {
  const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
  let best = Infinity;
  for (const o of g.vehicles) {
    if (o === v) continue;
    const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z;
    const along = dx * fx + dz * fz;
    if (along < 0 || along > 26 || Math.abs(dx * fz - dz * fx) > 1.9) continue;
    best = Math.min(best, along - v.parts.dims.len / 2 - o.parts.dims.len / 2);
  }
  return best;
}
