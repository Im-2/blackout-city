// Street races: checkpoint circuits against three rivals in the same vehicle as
// you. A race is a mission built from a route (markers, intro card, GPS, beams, fail
// and retry all come from the mission runner); this file adds the rivals, countdown,
// position counter and prizes.
//
// Rubber-banding is deliberately mild: a rival more than 30 m from you gets at most
// 12 % slower or 8 % faster, it stops in the last fifth of the race, and nobody teleports
// unless they've been stuck out of sight for a long time.
import * as THREE from 'three';
import { clamp } from '../core/math';
import { LANE, lanePoint, roadCoord, HALF } from '../world/layout';
import { Vehicle } from '../vehicles/vehicle';
import { edgePoints, turnPoints, steerTo } from '../ai/traffic';
import { RigCharacter } from '../characters/rig';
import { makePedSkin } from '../characters/pedTypes';
import { Rng } from '../core/math';
import type { CarKind } from '../vehicles/carMesh';
import type { District } from '../map/districts';
import type { MissionCtx, MissionDef, MissionStep } from '../missions/types';
import type { Game } from '../core/game';

interface RaceDef {
  id: string;
  title: string;
  giver: string;
  district: District;
  kind: CarKind;
  className: string;
  /** road-graph nodes [i, j] at the corners of a closed circuit */
  corners: [number, number][];
  laps: number;
  /** checkpoint every n junctions (corners always get one) */
  every: number;
  prize: number;
  intro: string;
}

const RACES: RaceDef[] = [
  { id: 'race_oldtown', title: 'Old Town Scramble', giver: 'Dee, scooter courier', district: 'oldtown', kind: 'scooter', className: 'Scooters', corners: [[1, 4], [3, 4], [3, 7], [1, 7]], laps: 2, every: 1, prize: 400, intro: 'Couriers settle their arguments on scooters. Two laps around Old Town, no brakes, no insurance.' },
  { id: 'race_docks', title: 'Dockside Drag', giver: 'Harbour crew', district: 'docks', kind: 'muscle', className: 'Muscle', corners: [[9, 2], [11, 2], [11, 8], [9, 8]], laps: 2, every: 2, prize: 900, intro: 'Long straights and heavy V8s between the warehouses. Two laps. Brake early, these things barely turn.' },
  { id: 'race_downtown', title: 'Midnight Sprint', giver: 'A rich kid', district: 'downtown', kind: 'sports', className: 'Sports', corners: [[4, 3], [8, 3], [8, 6], [4, 6]], laps: 2, every: 2, prize: 1500, intro: 'Borrowed sports cars through the financial district. The lights won\'t wait for you, and nor will they.' },
  { id: 'race_ring', title: 'Ring Run', giver: 'The Night Riders', district: 'residential', kind: 'motorbike', className: 'Motorbikes', corners: [[3, 0], [12, 0], [12, 12], [0, 12], [0, 0]], laps: 1, every: 3, prize: 1200, intro: 'One lap of the whole Ring Hwy on motorbikes, over the bridge and back. Filter through traffic or die trying.' },
];

const RIVAL_NAMES = ['VEX', 'NOVA', 'RAZOR', 'DUKE', 'MOTH', 'ZIP'];
const RIVAL_COLORS = ['#3f7b88', '#c4a03c', '#7a1c1c', '#cfccc4'];
const SKILL = [0.97, 0.93, 0.89];
const REV_LIMIT = 44;

const nx = (i: number) => roadCoord(i);

/** every junction of the route, in order, including the start and the finish */
function junctions(d: RaceDef): [number, number][] {
  const out: [number, number][] = [d.corners[0]];
  for (let lap = 0; lap < d.laps; lap++)
    for (let c = 0; c < d.corners.length; c++) {
      const [ai, aj] = d.corners[c], [bi, bj] = d.corners[(c + 1) % d.corners.length];
      const n = Math.max(Math.abs(bi - ai), Math.abs(bj - aj));
      for (let k = 1; k <= n; k++) out.push([ai + Math.sign(bi - ai) * k, aj + Math.sign(bj - aj) * k]);
    }
  return out;
}

function checkpoints(d: RaceDef) {
  const js = junctions(d);
  const cps: { x: number; z: number; lap: number; j: number }[] = [];
  const isCorner = (i: number, j: number) => d.corners.some(([a, b]) => a === i && b === j);
  let since = 0;
  const lapLen = (js.length - 1) / d.laps;
  js.forEach(([i, j], k) => {
    if (k === 0) return;
    since++;
    if (since >= d.every || isCorner(i, j) || k === js.length - 1) {
      since = 0;
      cps.push({ x: nx(i), z: nx(j), lap: Math.ceil(k / lapLen), j: k });
    }
  });
  return cps;
}

interface Racer {
  v: Vehicle;
  name: string;
  pts: { x: number; z: number }[];
  /** cumulative distance and the fastest sensible speed at each point */
  arc: number[];
  limit: number[];
  idx: number;
  skill: number;
  baseMax: number;
  stuckT: number;
  reverseT: number;
  finished: number;
  stuck?: number;
  /** two-wheelers need someone on them */
  rider?: RigCharacter;
}

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
const ord = (n: number) => ['1ST', '2ND', '3RD', '4TH'][n - 1] ?? `${n}TH`;

export class Races {
  active: RaceDef | null = null;
  rivals: Racer[] = [];
  /** seconds until the lights go green */
  private count = 0;
  private lastBeep = 0;
  private t = 0;
  private pIdx = 0;
  private base: Racer | null = null;
  private cps: ReturnType<typeof checkpoints> = [];
  private cpArc: number[] = [];
  private finishArc = 0;
  private hudEl: HTMLDivElement;
  private countEl: HTMLDivElement;
  private html = '';
  private finalPos = 0;
  private bestLine = false;

  constructor(private g: Game) {
    this.hudEl = g.hud.addPanel('panel race-hud');
    this.countEl = g.hud.addPanel('race-count');
  }

  get frozen() { return !!this.active && this.count > 0; }
  get racing() { return !!this.active && this.count <= 0; }
  get elapsed() { return this.t; }
  get position() { return this.finalPos || 1 + this.rivals.filter((r) => r.arc[r.idx] > this.playerArc).length; }
  private get cpDone() { return this.g.missions.run ? Math.max(0, this.g.missions.run.step - 1) : 0; }

  private get playerArc() {
    if (!this.base) return 0;
    // you can't get ahead of a checkpoint you haven't touched
    const cap = this.cpArc[Math.min(this.cpDone, this.cpArc.length - 1)] ?? this.finishArc;
    return Math.min(this.base.arc[this.pIdx], cap);
  }

  /** build this racer's line through the circuit, offset from the road centre */
  private line(d: RaceDef, offset: number, v: Vehicle, startK: { x: number; z: number }) {
    const g = this.g;
    const G = g.city.graph;
    const js = junctions(d).map(([i, j]) => G.node(i, j).id);
    // a little run-out past the line so finishers don't stop dead on it
    js.push(G.node(...junctions(d)[1]).id);
    const pts: { x: number; z: number }[] = [startK];
    // edges and turns share end points: a repeat would read as an instant hairpin
    const add = (p: { x: number; z: number }) => {
      const l = pts[pts.length - 1];
      if (Math.hypot(p.x - l.x, p.z - l.z) > 0.5) pts.push(p);
    };
    for (let k = 0; k < js.length - 1; k++) {
      const seg = edgePoints(g, js[k], js[k + 1], offset);
      (k === 0 ? seg.filter((q) => this.ahead(startK, q, js, k)) : seg).forEach(add);
      if (k < js.length - 2) turnPoints(g, js[k], js[k + 1], js[k + 2], offset).forEach(add);
    }
    const arc = [0];
    for (let i = 1; i < pts.length; i++) arc.push(arc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    // corner speeds from curvature, then a backward pass so they brake in time
    const limit = pts.map(() => v.p.maxSpeed);
    const brake = v.p.brake * 0.55;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = Math.atan2(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      const b = Math.atan2(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z);
      let dA = Math.abs(a - b);
      if (dA > Math.PI) dA = Math.PI * 2 - dA;
      const seg = Math.max(0.5, arc[i + 1] - arc[i]);
      // the fastest this vehicle can actually hold that radius: yaw rate = steerRate / (1 + v / 45)
      if (dA > 0.01) {
        const S = v.p.steerRate * 0.88, R = seg / dA;
        limit[i] = Math.min(limit[i], 22.5 * (Math.sqrt(1 + (4 * S * R) / 45) - 1));
      }
    }
    for (let i = pts.length - 2; i >= 0; i--) limit[i] = Math.min(limit[i], Math.sqrt(limit[i + 1] ** 2 + 2 * brake * (arc[i + 1] - arc[i])));
    return { pts, arc, limit };
  }

  private ahead(s: { x: number; z: number }, q: { x: number; z: number }, js: number[], k: number) {
    const N = this.g.city.graph.nodes, A = N[js[k]], B = N[js[k + 1]];
    return (q.x - s.x) * (B.x - A.x) + (q.z - s.z) * (B.z - A.z) > 4;
  }

  /** the mission's setup: lines up the grid and puts you on it */
  begin(d: RaceDef, c: MissionCtx) {
    const g = this.g;
    const G = g.city.graph;
    this.active = d;
    this.count = 3.6;
    this.lastBeep = 4;
    this.t = 0;
    this.pIdx = 0;
    this.finalPos = 0;
    this.bestLine = false;
    this.rivals = [];
    this.cps = checkpoints(d);
    const A = G.node(...d.corners[0]), B = G.node(...d.corners[1]);
    const L = Math.hypot(B.x - A.x, B.z - A.z);
    const heading = Math.atan2(B.x - A.x, B.z - A.z);
    // three rivals in front, you at the back
    const grid: { t: number; off: number }[] = [
      { t: 40 / L, off: LANE }, { t: 40 / L, off: 5 }, { t: 30 / L, off: LANE }, { t: 30 / L, off: 5 },
    ];
    const spot = grid.map((s) => lanePoint(A.x, A.z, B.x, B.z, s.t, s.off));
    // clear the grid of anyone who wandered onto it
    for (const o of [...g.vehicles]) {
      if (o === g.home.car || o.driver === 'player') continue;
      if (spot.some((p) => Math.hypot(o.pos.x - p.x, o.pos.z - p.z) < 30)) {
        if (o.driver === 'traffic') { const i = g.traffic.cars.indexOf(o); if (i >= 0) g.traffic.cars.splice(i, 1); }
        g.removeVehicle(o);
      }
    }
    for (let i = 0; i < 3; i++) {
      const v = new Vehicle(d.kind, RIVAL_COLORS[i], g.col);
      v.place(spot[i].x, spot[i].z, heading);
      v.driver = 'racer';
      v.handbrake = true;
      g.addVehicle(v);
      const offset = grid[i].off;
      const l = this.line(d, offset, v, spot[i]);
      let rider: RigCharacter | undefined;
      if (v.two) {
        rider = new RigCharacter(makePedSkin('teen', this.rng));
        const dm = v.parts.dims;
        rider.root.position.set(0, dm.wheelR + dm.seatY, dm.seatZ);
        v.object.add(rider.root);
      }
      this.rivals.push({ v, name: RIVAL_NAMES[(i + d.id.length) % RIVAL_NAMES.length], ...l, idx: 0, skill: SKILL[i], baseMax: v.p.maxSpeed, stuckT: 0, reverseT: 0, finished: 0, rider });
    }
    this.base = this.rivals[0];
    this.cpArc = [];
    let from = 0;
    for (const cp of this.cps) { const a = this.arcNear(cp.x, cp.z, from); this.cpArc.push(a); from = a; }
    this.finishArc = this.cpArc[this.cpArc.length - 1];
    const pv = c.spawnVehicle(d.kind, spot[3].x, spot[3].z, heading, '#e0322a');
    g.player.spawn(spot[3].x, spot[3].z, heading);
    g.player.enterVehicle(pv);
    pv.handbrake = true;
    g.player.heading = heading;
    g.camRig.snapBehind(heading);
  }

  /** first time the line passes close to this point after `from` */
  private arcNear(x: number, z: number, from: number) {
    const b = this.base!;
    for (let i = 0; i < b.pts.length; i++) {
      if (b.arc[i] <= from + 5) continue;
      if (Math.hypot(b.pts[i].x - x, b.pts[i].z - z) < 12) return b.arc[i];
    }
    return b.arc[b.arc.length - 1];
  }

  /** the mission's cleanup */
  end() {
    const g = this.g;
    for (const r of this.rivals) { r.v.driver = 'none'; g.removeVehicle(r.v); }
    this.rivals = [];
    this.base = null;
    this.active = null;
    this.hudEl.style.display = 'none';
    this.countEl.style.display = 'none';
    this.html = '';
  }

  update(dt: number) {
    const g = this.g;
    if (!this.active) return;
    if (this.count > 0) {
      this.count -= dt;
      const n = Math.ceil(this.count);
      if (n !== this.lastBeep && this.count > 0 && n <= 3) { this.lastBeep = n; g.audio.pop(); }
      this.countEl.style.display = 'block';
      this.countEl.textContent = this.count > 0 ? (n <= 3 ? String(n) : '') : '';
      if (this.count <= 0) {
        g.audio.missionStart();
        this.countEl.textContent = 'GO!';
        this.goT = 0.8;
      }
    } else {
      this.t += dt;
      if (this.goT > 0) { this.goT -= dt; if (this.goT <= 0) this.countEl.style.display = 'none'; }
    }
    this.trackPlayer();
    for (const r of this.rivals) this.drive(r, dt);
    this.drawHud();
  }
  private goT = 0;
  private rng = new Rng(4040);

  private trackPlayer() {
    const b = this.base;
    if (!b) return;
    const P = this.g.player.worldPos;
    let bi = this.pIdx, bd = Infinity;
    for (let i = this.pIdx; i < Math.min(b.pts.length, this.pIdx + 80); i++) {
      const d = Math.hypot(b.pts[i].x - P.x, b.pts[i].z - P.z);
      if (d < bd) { bd = d; bi = i; }
    }
    this.pIdx = bi;
  }

  private drive(r: Racer, dt: number) {
    const g = this.g;
    const v = r.v;
    r.rider?.update(dt, 'ride', v.speedAbs);
    if (this.frozen) { v.throttle = 0; v.steer = 0; v.handbrake = true; return; }
    v.handbrake = false;
    // bruised but never out: a race with no rivals left isn't a race
    if (v.health < 0.25) { v.hp = v.maxHp * 0.25; v.wrecked = false; }
    const pv = g.player.worldPos;
    while (r.idx < r.pts.length - 1 && Math.hypot(r.pts[r.idx].x - v.pos.x, r.pts[r.idx].z - v.pos.z) < Math.max(5, v.speedAbs * 0.22)) r.idx++;
    const arc = r.arc[r.idx];
    if (!r.finished && arc >= this.finishArc) {
      r.finished = this.t;
      if (this.g.missions.run) g.hud.toast(`${r.name} FINISHED`, 'dim');
    }
    if (r.finished) {
      const tp = r.pts[Math.min(r.idx, r.pts.length - 1)];
      v.steer = steerTo(v, tp.x, tp.z).steer;
      v.throttle = v.speed > 2 ? -0.6 : 0;
      return;
    }
    // fair rubber band: only well away from the player, never near the finish
    const gap = arc - this.playerArc;
    let band = 1;
    if (arc < this.finishArc * 0.8) {
      if (gap > 30) band = 1 - Math.min(0.12, (gap - 30) / 500);
      else if (gap < -30) band = 1 + Math.min(0.08, (-gap - 30) / 500);
    }
    v.p.maxSpeed = Math.min(REV_LIMIT, r.baseMax * r.skill * band);
    let aim = r.pts[Math.min(r.idx + 1, r.pts.length - 1)];
    let want = Math.min(v.p.maxSpeed, r.limit[Math.min(r.idx, r.limit.length - 1)] * (0.92 + r.skill * 0.1));

    // don't plough straight through whatever's in front
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    let shift = 0;
    for (const o of g.vehicles) {
      if (o === v) continue;
      const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z;
      const along = dx * fx + dz * fz;
      if (along < 1 || along > 10 + v.speedAbs * 0.7) continue;
      const lat = dx * fz - dz * fx;
      if (Math.abs(lat) > 2.1) continue;
      shift = lat >= 0 ? -3.2 : 3.2;
      const closing = v.speedAbs - (o.vx * fx + o.vz * fz);
      if (along < 7 && closing > 4) want = Math.min(want, v.speedAbs - closing * 0.5);
      break;
    }
    if (shift) aim = { x: aim.x + fz * shift, z: aim.z - fx * shift };
    const { steer, diff } = steerTo(v, aim.x, aim.z, 2.6);

    if (r.reverseT > 0) {
      r.reverseT -= dt;
      v.throttle = -1;
      v.steer = -steer;
      return;
    }
    v.steer = steer;
    v.throttle = clamp((want - v.speed) * 0.6, -1, 1);
    if (Math.abs(diff) > 1.2 && v.speedAbs > 12) v.throttle = -0.6;

    // stuck: back out, and only as a last resort, unseen, rejoin the line
    if (v.throttle > 0.4 && v.speedAbs < 1) r.stuckT += dt; else r.stuckT = Math.max(0, r.stuckT - dt * 2);
    if (r.stuckT > 1.2) { r.reverseT = 1; r.stuckT = 0.6; r.stuck = (r.stuck ?? 0) + 1; }
    if ((r.stuck ?? 0) > 5 && !g.isVisible(v.pos.x, 1, v.pos.z) && Math.hypot(v.pos.x - pv.x, v.pos.z - pv.z) > 50) {
      const p = r.pts[r.idx], n = r.pts[Math.min(r.idx + 1, r.pts.length - 1)];
      v.place(p.x, p.z, Math.atan2(n.x - p.x, n.z - p.z));
      r.stuck = 0;
    }
  }

  private drawHud() {
    const d = this.active!;
    const run = this.g.missions.run;
    const done = this.cpDone, total = this.cps.length;
    const lap = this.cps[Math.min(done, total - 1)]?.lap ?? 1;
    const html = `<div class="label">${d.className.toUpperCase()}</div><div class="r-pos">${ord(this.position)}<small>/4</small></div><div class="r-row">LAP ${lap}/${d.laps} · CP ${Math.min(done, total)}/${total}</div><div class="r-row r-t">${fmt(this.t)}</div>`;
    if (html !== this.html) { this.html = html; this.hudEl.innerHTML = html; }
    this.hudEl.style.display = run ? 'block' : 'none';
  }

  /** when you cross the line: decides the prize, or fails you for coming last */
  finishLine(c: MissionCtx): boolean {
    const g = c.g;
    const place = 1 + this.rivals.filter((r) => r.finished).length;
    this.finalPos = place;
    if (place >= 4) { g.missions.fail('You came last'); return false; }
    this.bestLine = g.records.raceTime(this.active!.id, this.t);
    const P = g.player.worldPos;
    g.news.headline(`Illegal street race ends near ${g.news.street(P.x, P.z)}. ${g.news.description()} placed ${ord(place).toLowerCase()}`);
    return true;
  }

  prize(c: MissionCtx) {
    const def = this.active;
    if (!def) return 0;
    void c;
    return Math.round(def.prize * [1, 0.4, 0.15][this.finalPos - 1]);
  }

  summary(): [string, string][] {
    const rows: [string, string][] = [['POSITION', `${ord(this.finalPos)} OF 4`], ['RACE TIME', fmt(this.t)]];
    const best = this.g.records.races[this.active!.id];
    if (best !== undefined) rows.push(['RECORD', `${fmt(best)}${this.bestLine ? ' NEW!' : ''}`]);
    return rows;
  }

  /** map blips while racing */
  blips() {
    return this.rivals.map((r) => r.v.pos);
  }

  /** for the records screen */
  static titles(): [string, string][] {
    return RACES.map((r) => [r.id, r.title]);
  }
}

function missionFor(d: RaceDef): MissionDef {
  const cps = checkpoints(d);
  const A = { x: nx(d.corners[0][0]), z: nx(d.corners[0][1]) }, B = { x: nx(d.corners[1][0]), z: nx(d.corners[1][1]) };
  const m = lanePoint(A.x, A.z, B.x, B.z, 34 / Math.hypot(B.x - A.x, B.z - A.z), 9.2);
  const lastI = cps.length - 1;
  const point = (i: number) => new THREE.Vector3(cps[i].x, 1, cps[i].z);
  const reachLast = (c: MissionCtx) => {
    const P = c.g.player.worldPos;
    return Math.hypot(cps[lastI].x - P.x, cps[lastI].z - P.z) < 12;
  };
  const steps: MissionStep[] = [
    {
      id: 'grid',
      text: 'Wait for the lights',
      sub: `${d.laps > 1 ? `${d.laps} laps, ` : ''}${cps.length} checkpoints. Beat at least one rival`,
      target: () => point(0),
      done: (c) => !c.g.races.frozen,
    },
    ...cps.map((_, i): MissionStep => ({
      id: `cp${i}`,
      text: i === lastI ? 'Finish line!' : `Checkpoint ${i + 1} of ${cps.length}`,
      sub: (c) => `Running ${ord(c.g.races.position).toLowerCase()}. Follow the beams`,
      target: () => point(i),
      ...(i === lastI ? { done: (c: MissionCtx) => reachLast(c) && c.g.races.finishLine(c) } : { reach: 13 }),
    })),
  ];
  return {
    id: d.id,
    title: d.title,
    giver: d.giver,
    district: d.district,
    type: 'race',
    marker: { x: m.x, z: m.z, heading: Math.atan2(B.x - A.x, B.z - A.z) },
    intro: `${d.className} class, $${d.prize.toLocaleString()} to the winner. ${d.intro}`,
    replay: true,
    reward: { cash: (c) => c.g.races.prize(c), reputation: 10, label: 'Prize' },
    setup: (c) => c.g.races.begin(d, c),
    cleanup: (c) => c.g.races.end(),
    summary: (c) => c.g.races.summary(),
    failIf: (c) => {
      const v = c.g.player.vehicle;
      if (v && v.wrecked) return 'You wrecked your ride';
      return c.g.races.rivals.length && c.g.races.rivals.every((r) => r.finished && c.g.races.elapsed - r.finished > 25) ? 'They all went home' : null;
    },
    steps,
  };
}

export const RACE_MISSIONS = RACES.map(missionFor);
void HALF;
