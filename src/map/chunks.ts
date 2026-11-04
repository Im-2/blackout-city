// World streaming around the player. A chunk is one block (plus sectors of the
// outer ring). When the player crosses into a new half-block cell we show/hide
// chunk meshes and free GPU buffers for far ones, rebuild the instanced props,
// and stream parked cars, the crowd's stations and ambient life.
import { Rng } from '../core/math';
import { Vehicle } from '../vehicles/vehicle';
import { colorFor, pickKind } from '../ai/traffic';
import { districtAt, DISTRICTS, District } from './districts';
import type { Game } from '../core/game';
import type { REdge } from '../world/layout';
import type { SpotInfo } from '../world/city';

const CELL = 28;
const PARKED_IN = 115, PARKED_OUT = 165, PARKED_MAX = 26;

interface ParkSpot extends SpotInfo { v: Vehicle | null; gone: boolean; }

export class Chunks {
  /** road edges near the player (traffic and police spawn from these) */
  nearEdges: REdge[] = [];
  active = 0;
  total = 0;
  district: District = 'downtown';
  private key = '';
  private spots: ParkSpot[] = [];
  private rng = new Rng(3131);

  constructor(private g: Game) {}

  get radius() {
    return this.g.quality.p.view;
  }

  reset() {
    for (const s of this.spots) s.v = null;
    this.spots = this.g.city.parking.map((s) => ({ ...s, v: null, gone: false }));
    this.key = '';
    this.update();
  }

  update() {
    const g = this.g;
    const P = g.player.worldPos;
    const k = `${Math.floor(P.x / CELL)},${Math.floor(P.z / CELL)},${g.quality.level}`;
    this.watchDistrict(P.x, P.z);
    if (k === this.key) return;
    this.key = k;
    const res = g.city.stream(P.x, P.z, this.radius);
    this.active = res.active;
    this.total = res.total;
    g.signals.stream(P.x, P.z, this.radius);
    const G = g.city.graph;
    this.nearEdges = G.edges.filter((e) => {
      if (e.closed) return false;
      const A = G.nodes[e.a], B = G.nodes[e.b];
      return Math.hypot((A.x + B.x) / 2 - P.x, (A.z + B.z) / 2 - P.z) < 190;
    });
    this.streamParked(P.x, P.z);
    g.peds.onChunkChange();
    g.ambient.onChunkChange();
  }

  private watchDistrict(x: number, z: number) {
    const d = districtAt(x, z);
    if (d === this.district) return;
    this.district = d;
    if (this.g.state === 'playing') this.g.hud.districtBanner(DISTRICTS[d].name);
  }

  private streamParked(x: number, z: number) {
    const g = this.g;
    let live = 0;
    for (const s of this.spots) {
      const v = s.v;
      if (!v) continue;
      // driven off or towed away: the spot stays empty this run
      if (!g.vehicles.includes(v) || v.driver !== 'none' || Math.hypot(v.pos.x - s.x, v.pos.z - s.z) > 2.5) { s.v = null; s.gone = true; continue; }
      if (Math.hypot(s.x - x, s.z - z) > PARKED_OUT) { g.removeVehicle(v); s.v = null; continue; }
      live++;
    }
    const near = this.spots.filter((s) => !s.v && !s.gone && Math.hypot(s.x - x, s.z - z) < PARKED_IN).sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
    for (const s of near) {
      if (live >= PARKED_MAX) break;
      if (g.vehicles.some((o) => Math.hypot(o.pos.x - s.x, o.pos.z - s.z) < 5)) continue;
      const kind = pickKind(this.rng, districtAt(s.x, s.z));
      const v = new Vehicle(kind === 'bus' ? 'sedan' : kind, colorFor(this.rng, kind), g.col);
      v.place(s.x, s.z, s.heading);
      v.parked = true;
      v.locked = kind !== 'bicycle';
      v.handbrake = true;
      g.addVehicle(v);
      s.v = v;
      live++;
    }
    g.parked = this.spots.filter((s) => s.v).map((s) => s.v!);
  }
}
