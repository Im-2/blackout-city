// Adaptive police: a heatmap of which road edges the player drives most.
// Persisted across runs (with decay) so the police learn your escape routes.
import type { RoadGraph, REdge } from '../world/layout';

const KEY = 'blackoutcity.routeMemory.v1';

export class RouteMemory {
  scores: Float32Array;
  /** score delta gathered this run (for the results screen) */
  runScores: Float32Array;
  private saveT = 0;

  constructor(private graph: RoadGraph) {
    this.scores = new Float32Array(graph.edges.length);
    this.runScores = new Float32Array(graph.edges.length);
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const arr = JSON.parse(raw) as number[];
        if (arr.length === this.scores.length) arr.forEach((v, i) => (this.scores[i] = v * 0.8)); // memory fades between runs
      }
    } catch {
      /* storage unavailable: memory is per-session only */
    }
  }

  newRun() {
    this.runScores.fill(0);
  }

  /** Record driving on the edge nearest to (x,z). */
  record(x: number, z: number, metres: number, dt: number) {
    const hit = this.graph.edgeAt(x, z);
    if (hit.dist > 8) return;
    this.scores[hit.edge.id] += metres;
    this.runScores[hit.edge.id] += metres;
    this.saveT += dt;
    if (this.saveT > 4) this.save();
  }

  save() {
    this.saveT = 0;
    try {
      localStorage.setItem(KEY, JSON.stringify(Array.from(this.scores, (v) => Math.round(v))));
    } catch {
      /* ignore */
    }
  }

  clear() {
    this.scores.fill(0);
    this.save();
  }

  /** 0..1 normalized intensity per edge for the minimap. */
  intensity(e: REdge) {
    const max = Math.max(150, ...this.scores);
    return Math.min(1, this.scores[e.id] / max);
  }

  /** Streets ranked by learned score (sum of their edges). */
  topStreets(n = 2, min = 120): { name: string; score: number; edges: REdge[] }[] {
    const by = new Map<string, { name: string; score: number; edges: REdge[] }>();
    for (const e of this.graph.edges) {
      const s = this.scores[e.id];
      if (s <= 0) continue;
      let r = by.get(e.name);
      if (!r) by.set(e.name, (r = { name: e.name, score: 0, edges: [] }));
      r.score += s;
      r.edges.push(e);
    }
    return [...by.values()].filter((r) => r.score >= min).sort((a, b) => b.score - a.score).slice(0, n);
  }

  /** Highest-scoring edges overall. */
  topEdges(n = 4, min = 60): REdge[] {
    return [...this.graph.edges].filter((e) => this.scores[e.id] >= min).sort((a, b) => this.scores[b.id] - this.scores[a.id]).slice(0, n);
  }
}
