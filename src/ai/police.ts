// Police: heat 0-5, pursuit / search / roadblocks / helicopter, officers on
// foot, busting — plus ADAPTIVE stakeouts on the player's favourite routes.
import * as THREE from 'three';
import { Rng, clamp, damp, dampAngle, wrapAngle } from '../core/math';
import { LANE, PITCH, lanePoint, groundHeight, HALF } from '../world/layout';
import { Vehicle } from '../vehicles/vehicle';
import { createCharacter } from '../characters/loader';
import { COP_SKIN, SWAT_SKIN } from '../characters/skins';
import type { CharacterView, AnimState } from '../characters/rig';
import { edgePoints, turnPoints, pickNext, steerTo } from './traffic';
import type { REdge } from '../world/layout';
import type { Game } from '../core/game';
import { basicMat } from '../render/patch';
import { GeoBuilder } from '../world/geo';
import { worldMaterials } from '../world/materials';

interface Pt { x: number; z: number; }
type Mode = 'patrol' | 'pursuit' | 'roadblock' | 'stakeout' | 'leave' | 'deployed';

interface CopAI {
  mode: Mode;
  pts: Pt[];
  idx: number;
  repathT: number;
  stuckT: number;
  reverseT: number;
  sees: boolean;
  checkT: number;
  deployed: boolean;
  officers: Officer[];
  // patrol lane following
  a: number; b: number; c: number; phase: 'edge' | 'turn';
  wanderT: number;
  street?: string;
}

export interface Officer {
  view: CharacterView;
  pos: THREE.Vector3;
  heading: number;
  vx: number;
  vz: number;
  car: Vehicle | null;
  sees: boolean;
  checkT: number;
  knockT: number;
  state: AnimState;
  goal: THREE.Vector3 | null;
  returning: boolean;
}

const UNIT_CAP = [2, 2, 3, 4, 5, 6];
const CAR_SIGHT = 70;
const FOOT_SIGHT = 34;

export class Police {
  heat = 0;
  progress = 0;
  peak = 0;
  minHeat = 0;
  units: Vehicle[] = [];
  officers: Officer[] = [];
  lastKnown = new THREE.Vector3();
  lastSeenT = 999;
  seenNow = false;
  bust = 0;
  watched: string[] = [];
  private rng = new Rng(4242);
  private roadblockT = 10;
  private spawnT = 0;
  private hintT = 0;
  private stakeoutDone = false;
  heli: Heli | null = null;
  /** the car the police are looking for */
  knownVehicle: { id: number; color: string } | null = null;

  vehicleRecogniseRange(normal: number) {
    const v = this.g.player.vehicle;
    if (!v || !this.knownVehicle) return normal;
    if (this.knownVehicle.id === v.id && this.knownVehicle.color === v.color) return normal;
    return Math.min(normal, 10);
  }
  roadblocks: Vehicle[][] = [];

  constructor(private g: Game) {}

  reset() {
    for (const u of this.units) this.g.removeVehicle(u);
    for (const o of this.officers) this.g.scene.remove(o.view.root);
    this.units = [];
    this.officers = [];
    this.roadblocks = [];
    this.heat = 0;
    this.progress = 0;
    this.peak = 0;
    this.minHeat = 0;
    this.knownVehicle = null;
    this.lastSeenT = 999;
    this.bust = 0;
    this.stakeoutDone = false;
    this.roadblockT = 10;
    this.watched = this.g.routes.topStreets(2).map((s) => s.name);
    if (this.heli) { this.heli.dispose(); this.heli = null; }
  }

  get status(): 'clear' | 'pursuit' | 'search' {
    if (this.heat === 0) return 'clear';
    return this.lastSeenT < 3 ? 'pursuit' : 'search';
  }

  setHeat(n: number, reason?: string) {
    n = clamp(Math.round(n), 0, 5);
    if (n > this.heat) {
      if (this.heat === 0) this.onPursuitStart();
      this.g.hud.toast(`HEAT ${n}${reason ? ' — ' + reason : ''}`, 'heat');
      this.g.audio.heatUp();
    }
    const prev = this.heat;
    this.heat = n;
    this.progress = 0.05;
    // escalation beats fire immediately so short clips show them
    if (n >= 4 && prev < 4) this.roadblockT = 2.5;
    if (n >= 5 && prev < 5) this.spawnUnit('pursuit', undefined, undefined, 45, 110, 'swat');
    this.peak = Math.max(this.peak, n);
    if (n > 0) { this.lastKnown.copy(this.g.player.worldPos); this.lastSeenT = Math.min(this.lastSeenT, 0.5); }
  }

  /** A crime someone saw: bump heat to at least `min`. */
  crime(min: number, reason: string) {
    if (this.heat < min) this.setHeat(min, reason);
    this.lastKnown.copy(this.g.player.worldPos);
    this.lastSeenT = 0;
  }

  report(pos: THREE.Vector3) {
    if (this.heat <= 0) return;
    this.lastKnown.copy(pos);
    this.lastSeenT = 0;
    this.seenNow = true;
  }

  private onPursuitStart() {
    this.stakeoutDone = false;
    // first responders arrive fast so the chase starts right away
    this.spawnT = 2.5;
    for (let i = 0; i < 2; i++) this.spawnUnit('pursuit', undefined, undefined, 50, 110);
    this.watched = this.g.routes.topStreets(2).map((s) => s.name);
  }

  // ------------------------------------------------------------------ update
  update(dt: number) {
    const g = this.g;
    const P = g.player.worldPos;
    this.seenNow = false;
    this.lastSeenT += dt;

    // unit management
    const cap = UNIT_CAP[this.heat];
    const active = this.units.filter((u) => (u.ai as CopAI).mode !== 'roadblock');
    this.spawnT -= dt;
    if (active.length < cap && this.units.length < cap + 4 && this.spawnT <= 0) {
      this.spawnT = this.spawnUnit(this.heat === 0 ? 'patrol' : 'pursuit') ? 1.2 : 0.5;
    }
    if (this.heat > 0 && !this.stakeoutDone) this.placeStakeouts();

    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      if (u.driver !== 'cop') { this.units.splice(i, 1); continue; } // stolen
      const ai = u.ai as CopAI;
      const d = Math.hypot(u.pos.x - P.x, u.pos.z - P.z);
      // despawn when calm and far, or too many
      const surplus = active.length > cap + 1 && ai.mode !== 'roadblock';
      if ((this.heat === 0 && ai.mode !== 'patrol' && d > 90) || (surplus && d > 120) || (u.wrecked && d > 70) || d > 230) {
        if (!g.isVisible(u.pos.x, 1, u.pos.z) || d > 200) { this.removeUnit(u); continue; }
      }
      if (this.heat === 0 && (ai.mode === 'pursuit' || ai.mode === 'stakeout' || ai.mode === 'roadblock')) { ai.mode = 'leave'; u.siren = false; }
      if (this.heat > 0 && (ai.mode === 'patrol' || ai.mode === 'leave')) { ai.mode = 'pursuit'; ai.repathT = 0; }
      this.sight(u, dt, d);
      this.driveUnit(u, dt, d);
    }

    // officers
    for (let i = this.officers.length - 1; i >= 0; i--) {
      if (this.updateOfficer(this.officers[i], dt)) {
        this.g.scene.remove(this.officers[i].view.root);
        this.officers.splice(i, 1);
      }
    }

    // helicopter at heat 5
    if (this.heat >= 5 && !this.heli) this.heli = new Heli(g);
    if (this.heat < 5 && this.heli && this.heli.leave(dt)) { this.heli.dispose(); this.heli = null; }
    if (this.heli && this.heat >= 5 && this.heli.update(dt, this)) this.markSeen();

    // roadblocks at heat >= 4
    if (this.heat >= 4) {
      this.roadblockT -= dt;
      if (this.roadblockT <= 0) {
        this.roadblockT = 16;
        if (this.roadblocks.length < 2) this.placeRoadblock();
      }
    }
    for (let i = this.roadblocks.length - 1; i >= 0; i--) {
      const rb = this.roadblocks[i];
      if (rb.every((u) => !this.units.includes(u) || (u.ai as CopAI).mode !== 'roadblock')) this.roadblocks.splice(i, 1);
    }

    // heat dynamics
    if (this.seenNow) {
      this.lastSeenT = 0;
      this.lastKnown.copy(P);
      if (g.player.vehicle) this.knownVehicle = { id: g.player.vehicle.id, color: g.player.vehicle.color };
      else g.disguise.seen();
    }
    if (this.heat > 0) {
      const inBlack = g.hack.isBlackedOut(P.x, P.z);
      if (this.lastSeenT < 0.5) this.progress += dt / (20 + this.heat * 7);
      else if (this.lastSeenT > 5) this.progress -= dt / (inBlack ? 2.5 : 7);
      if (this.progress >= 1 && this.heat < 5) this.setHeat(this.heat + 1, 'more units inbound');
      if (this.progress < 0) {
        if (this.heat > this.minHeat) {
          this.heat--;
          this.progress = 0.7;
          g.hud.toast(this.heat === 0 ? 'COPS LOST YOU' : `HEAT ${this.heat}`, 'cool');
        } else this.progress = 0;
      }
    }

    // adaptive hints during pursuit
    this.hintT -= dt;
    if (this.heat > 0 && this.hintT <= 0 && this.watched.length) {
      this.hintT = 22;
      g.hud.hint(`Police are watching ${this.watched[0].toUpperCase()}${this.watched[1] ? ' & ' + this.watched[1].toUpperCase() : ''}`);
    }

    this.updateBust(dt);
  }

  markSeen() {
    this.seenNow = true;
  }

  /** Disguise / respray / swap: the description they were working from is stale. */
  onDescriptionLost(kind: 'outfit' | 'vehicle') {
    if (this.heat === 0) return;
    if (this.lastSeenT < 0.6 && kind === 'vehicle') return; // they watched you do it
    this.lastSeenT = Math.max(this.lastSeenT, 6);
    this.progress = Math.max(0, this.progress - 0.45);
    this.g.news.report('lost', this.g.player.worldPos.x, this.g.player.worldPos.z);
  }

  private sight(u: Vehicle, dt: number, d: number) {
    const ai = u.ai as CopAI;
    ai.checkT -= dt;
    if (ai.checkT > 0) { if (ai.sees) this.markSeen(); return; }
    ai.checkT = 0.15;
    ai.sees = this.canSee(u.pos.x, u.pos.y + 1.4, u.pos.z, d, CAR_SIGHT * (this.heat === 0 ? 0.5 : 1));
    if (ai.sees) {
      if (this.heat === 0) {
        // patrols only care about obvious crimes
        if (this.g.heist.alarm || (this.g.player.vehicle && this.g.player.vehicle.isCop)) this.crime(1, 'spotted by patrol');
        else ai.sees = false;
      }
      if (ai.sees) this.markSeen();
      if (ai.mode === 'stakeout' && ai.sees) {
        ai.mode = 'pursuit';
        u.siren = true;
        this.g.hud.toast(`STAKEOUT ON ${ai.street?.toUpperCase() ?? 'YOUR ROUTE'} SPOTTED YOU`, 'heat');
      }
    }
  }

  canSee(x: number, y: number, z: number, d: number, range: number): boolean {
    const g = this.g;
    if (g.player.busted) return false;
    const P = g.player.worldPos;
    if (!g.player.vehicle) range = g.disguise.recogniseRange(range);
    else range = g.police.vehicleRecogniseRange(range);
    if (g.player.hidden) return false;
    if (d > range) return false;
    if (g.hack.isBlackedOut(P.x, P.z) && d > 11) return false;
    if (g.bank.isInside(P.x, P.z) !== g.bank.isInside(x, z)) return false;
    const py = g.player.vehicle ? P.y + 1.0 : g.player.pos.y + 1.3;
    return g.col.lineOfSight(x, y, z, P.x, py, P.z);
  }

  private updateBust(dt: number) {
    const g = this.g;
    if (g.player.busted || g.state !== 'playing') return;
    const P = g.player.worldPos;
    let pressing = false;
    if (g.player.vehicle) {
      const v = g.player.vehicle;
      if (v.speedAbs < 2.2 && this.heat > 0) {
        for (const u of this.units) if (Math.hypot(u.pos.x - P.x, u.pos.z - P.z) < 6.5 && !u.wrecked) pressing = true;
        for (const o of this.officers) if (o.pos.distanceTo(P) < 3.0 && o.knockT <= 0) pressing = true;
      }
    } else {
      for (const o of this.officers) if (o.knockT <= 0 && Math.hypot(o.pos.x - P.x, o.pos.z - P.z) < 1.7) pressing = true;
      if (g.guards.pressing()) pressing = true;
    }
    this.bust = pressing ? Math.min(1, this.bust + dt / 3) : Math.max(0, this.bust - dt / 2);
    if (this.bust >= 1) g.onBusted();
  }

  // ------------------------------------------------------------------ spawning
  private spawnUnit(mode: Mode, at?: { x: number; z: number; heading: number }, street?: string, near = 75, far = 170, force?: 'swat' | 'moto'): Vehicle | null {
    const g = this.g;
    const swat = force === 'swat' || (this.heat >= 5 && this.units.filter((u) => u.kind === 'swat').length < 2 && this.rng.chance(0.5));
    const moto = !swat && !at && (force === 'moto' || (this.heat >= 2 && this.units.filter((u) => u.kind === 'policemoto').length < 2 && this.rng.chance(0.3)));
    const v = new Vehicle(swat ? 'swat' : moto ? 'policemoto' : 'police', '#1c1c1e', g.col);
    v.driver = 'cop';
    const ai: CopAI = { mode, pts: [], idx: 0, repathT: 0, stuckT: 0, reverseT: 0, sees: false, checkT: 0, deployed: false, officers: [], a: 0, b: 0, c: 0, phase: 'edge', wanderT: 0, street };
    v.ai = ai;
    if (at) v.place(at.x, at.z, at.heading);
    else {
      const P = g.player.worldPos;
      let placed = false;
      // prefer arriving from a watched route (adaptive), else any hidden node 80-150 m away
      const watchedEdges = this.heat > 0 ? g.routes.topEdges(3) : [];
      const tryEdges = [...watchedEdges.filter(() => this.rng.chance(0.5)), ...Array.from({ length: 40 }, () => this.rng.pick(g.city.graph.edges))];
      for (const e of tryEdges) {
        const flip = this.rng.chance(0.5);
        const a = flip ? e.b : e.a, b = flip ? e.a : e.b;
        const A = g.city.graph.nodes[a], B = g.city.graph.nodes[b];
        const p = lanePoint(A.x, A.z, B.x, B.z, 0.5, LANE);
        const d = Math.hypot(p.x - P.x, p.z - P.z);
        if (d < near || d > far) continue;
        if (g.isVisible(p.x, 1, p.z) && d < near + 55) continue;
        if (g.vehicles.some((o) => Math.hypot(o.pos.x - p.x, o.pos.z - p.z) < 8)) continue;
        v.place(p.x, p.z, Math.atan2(B.x - A.x, B.z - A.z));
        ai.a = a; ai.b = b; ai.c = pickNext(g, a, b, () => this.rng.next());
        ai.pts = edgePoints(g, a, b);
        ai.idx = 5;
        placed = true;
        break;
      }
      if (!placed) return null;
    }
    v.siren = mode === 'pursuit' || mode === 'roadblock';
    g.addVehicle(v);
    this.units.push(v);
    return v;
  }

  removeUnit(u: Vehicle) {
    const i = this.units.indexOf(u);
    if (i >= 0) this.units.splice(i, 1);
    for (const o of (u.ai as CopAI).officers) o.car = null;
    this.g.removeVehicle(u);
  }

  /** ADAPTIVE: park cruisers on the streets the player has used most. */
  private placeStakeouts() {
    this.stakeoutDone = true;
    const g = this.g;
    const top = g.routes.topStreets(2);
    if (!top.length) return;
    this.watched = top.map((t) => t.name);
    const P = g.player.worldPos;
    const n = this.heat >= 3 ? 2 : 1;
    let placed = 0;
    for (const st of top) {
      if (placed >= n) break;
      // the most-used edge on that street that's not right next to the player
      const edges = [...st.edges].sort((a, b) => g.routes.scores[b.id] - g.routes.scores[a.id]);
      for (const e of edges) {
        const A = g.city.graph.nodes[e.a], B = g.city.graph.nodes[e.b];
        const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
        if (Math.hypot(mx - P.x, mz - P.z) < 45) continue;
        const p = lanePoint(A.x, A.z, B.x, B.z, 0.5, LANE + 1.2);
        if (g.vehicles.some((o) => Math.hypot(o.pos.x - p.x, o.pos.z - p.z) < 6)) continue;
        const u = this.spawnUnit('stakeout', { x: p.x, z: p.z, heading: Math.atan2(B.x - A.x, B.z - A.z) + 0.5 }, st.name);
        if (u) { u.siren = false; placed++; }
        break;
      }
    }
    if (placed) {
      g.hud.hint(`Police learned your route — watching ${top[0].name.toUpperCase()}`);
      this.hintT = 20;
    }
  }

  private placeRoadblock() {
    const g = this.g;
    const P = g.player.worldPos;
    const v = g.player.vehicle;
    const dirx = v ? v.vx : Math.sin(g.camRig.yaw), dirz = v ? v.vz : Math.cos(g.camRig.yaw);
    const dl = Math.hypot(dirx, dirz) || 1;
    let best: REdge | null = null, bs = -Infinity;
    // prefer edges dead ahead; relax the cone if the player is stationary/cornered
    for (const minAhead of [0.5, -0.2]) {
      for (const e of g.city.graph.edges) {
        const A = g.city.graph.nodes[e.a], B = g.city.graph.nodes[e.b];
        const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
        const dx = mx - P.x, dz = mz - P.z;
        const d = Math.hypot(dx, dz);
        if (d < 40 || d > 120) continue;
        const ahead = (dx * dirx + dz * dirz) / (d * dl);
        if (ahead < minAhead) continue;
        if (g.vehicles.some((o) => Math.hypot(o.pos.x - mx, o.pos.z - mz) < 7)) continue;
        const score = ahead + g.routes.intensity(e) * 2.5 + this.rng.next() * 0.4;
        if (score > bs) { bs = score; best = e; }
      }
      if (best) break;
    }
    if (!best) { this.roadblockT = 2; return; }
    const A = g.city.graph.nodes[best.a], B = g.city.graph.nodes[best.b];
    const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
    const along = Math.atan2(B.x - A.x, B.z - A.z);
    const rx = Math.cos(along), rz = -Math.sin(along);
    const cars: Vehicle[] = [];
    for (const s of [-3.6, 2.4]) {
      const u = this.spawnUnit('roadblock', { x: mx + rx * s, z: mz + rz * s, heading: along + Math.PI / 2 + (s > 0 ? 0.25 : -0.25) });
      if (u) { u.siren = true; cars.push(u); }
    }
    if (cars.length) {
      this.roadblocks.push(cars);
      g.hud.toast(`ROADBLOCK — ${best.name.toUpperCase()}`, 'heat');
    }
  }

  // ------------------------------------------------------------------ driving
  private driveUnit(u: Vehicle, dt: number, d: number) {
    const g = this.g;
    const ai = u.ai as CopAI;
    if (u.wrecked) { u.throttle = 0; u.handbrake = true; u.siren = false; return; }
    u.handbrake = false;
    if (ai.mode === 'stakeout' || ai.mode === 'roadblock') {
      u.throttle = 0;
      u.handbrake = true;
      // roadblock cars give chase once the player is past them
      if (ai.mode === 'roadblock' && d < 45 && ai.sees) ai.wanderT += dt;
      if (ai.mode === 'roadblock' && ai.wanderT > 3) { ai.mode = 'pursuit'; }
      return;
    }
    if (ai.mode === 'deployed') {
      u.throttle = 0;
      u.handbrake = true;
      if (ai.officers.length === 0 || ai.officers.every((o) => !this.officers.includes(o))) { ai.mode = 'pursuit'; ai.deployed = false; ai.officers = []; }
      return;
    }
    if (ai.mode === 'patrol' || ai.mode === 'leave') {
      u.siren = false;
      this.followLanes(u, dt, ai, 10.5);
      return;
    }
    // pursuit
    u.siren = true;
    const P = g.player.worldPos;
    const pv = g.player.vehicle;
    const recent = this.lastSeenT < 1.5;
    const tx = recent ? P.x : this.lastKnown.x, tz = recent ? P.z : this.lastKnown.z;
    const dt2 = Math.hypot(tx - u.pos.x, tz - u.pos.z);
    const direct = dt2 < 55 && (ai.sees || dt2 < 14);

    if (ai.reverseT > 0) {
      ai.reverseT -= dt;
      u.throttle = -1;
      const { steer } = steerTo(u, tx, tz);
      u.steer = -steer;
      return;
    }

    let aimX = tx, aimZ = tz, want = 36;
    if (direct) {
      if (pv && recent) {
        const lead = clamp(dt2 / 30, 0, 1.0);
        aimX = P.x + pv.vx * lead;
        aimZ = P.z + pv.vz * lead;
        if (this.heat >= 2 && dt2 < 14) {
          // PIT: aim for the rear quarter on the side we're already on
          const pfx = Math.sin(pv.heading), pfz = Math.cos(pv.heading);
          const sx = Math.cos(pv.heading), sz = -Math.sin(pv.heading);
          const side = Math.sign((u.pos.x - P.x) * sx + (u.pos.z - P.z) * sz) || 1;
          aimX = P.x - pfx * 1.5 + sx * side * 0.9 + pv.vx * 0.2;
          aimZ = P.z - pfz * 1.5 + sz * side * 0.9 + pv.vz * 0.2;
          want = pv.speedAbs + 8;
        } else if (this.heat < 2 && dt2 < 12) want = Math.max(4, pv.speedAbs);
      } else if (!pv) {
        // player on foot: pull up and deploy officers
        want = dt2 > 22 ? 22 : Math.max(0, (dt2 - 8) * 1.2);
        if (dt2 < 16 && u.speedAbs < 3.5 && !ai.deployed && this.heat >= 1 && recent) this.deploy(u);
      }
      const { steer, diff } = steerTo(u, aimX, aimZ, 2.6);
      u.steer = steer;
      if (Math.abs(diff) > 1.9 && dt2 < 28 && u.speedAbs < 8) { ai.reverseT = 0.9; }
      u.throttle = clamp((want - u.speed) * 0.5, -1, 1);
      if (Math.abs(diff) > 1.2 && u.speedAbs > 16) u.handbrake = true; // slide around
    } else {
      // path mode on the road graph
      ai.repathT -= dt;
      if (ai.repathT <= 0 || ai.idx >= ai.pts.length) {
        ai.repathT = 1.5;
        this.repath(u, ai, tx, tz);
      }
      while (ai.idx < ai.pts.length && Math.hypot(ai.pts[ai.idx].x - u.pos.x, ai.pts[ai.idx].z - u.pos.z) < 6) ai.idx++;
      const p = ai.pts[Math.min(ai.idx, ai.pts.length - 1)] ?? { x: tx, z: tz };
      const { steer, diff } = steerTo(u, p.x, p.z, 2.4);
      u.steer = steer;
      want = Math.abs(diff) > 0.5 ? 14 : 30;
      if (!recent && dt2 < 14) want = 6; // searching the area
      u.throttle = clamp((want - u.speed) * 0.4, -1, 1);
      if (Math.abs(diff) > 2.0 && u.speedAbs < 6) ai.reverseT = 0.8;
    }
    // stuck recovery
    if (u.throttle > 0.5 && u.speedAbs < 1.2) ai.stuckT += dt; else ai.stuckT = Math.max(0, ai.stuckT - dt);
    if (ai.stuckT > 1.1) { ai.stuckT = 0; ai.reverseT = 1.0; }
    void d;
  }

  private repath(u: Vehicle, ai: CopAI, tx: number, tz: number) {
    const g = this.g;
    const G = g.city.graph;
    const here = G.edgeAt(u.pos.x, u.pos.z);
    const e = here.edge;
    const A = G.nodes[e.a], B = G.nodes[e.b];
    const fx = Math.sin(u.heading), fz = Math.cos(u.heading);
    const towardB = (B.x - A.x) * fx + (B.z - A.z) * fz > 0;
    const from = towardB ? e.a : e.b, start = towardB ? e.b : e.a;
    const goal = G.nearestNode(tx, tz).id;
    const path = [from, ...G.path(start, goal)];
    const pts: Pt[] = [];
    const S = G.nodes[start];
    pts.push(lanePoint(G.nodes[from].x, G.nodes[from].z, S.x, S.z, 0.85, LANE * 0.5));
    for (let i = 1; i < path.length - 1; i++) {
      pts.push(...turnPoints(g, path[i - 1], path[i], path[i + 1], LANE * 0.5));
      pts.push(...edgePoints(g, path[i], path[i + 1], LANE * 0.5).slice(2));
    }
    pts.push({ x: tx, z: tz });
    // drop points behind us
    let idx = 0;
    while (idx < pts.length - 1 && (pts[idx].x - u.pos.x) * fx + (pts[idx].z - u.pos.z) * fz < 0 && Math.hypot(pts[idx].x - u.pos.x, pts[idx].z - u.pos.z) < 15) idx++;
    ai.pts = pts;
    ai.idx = idx;
  }

  private followLanes(u: Vehicle, dt: number, ai: CopAI, cruise: number) {
    const g = this.g;
    if (!ai.pts.length) {
      const e = g.city.graph.edgeAt(u.pos.x, u.pos.z).edge;
      ai.a = e.a; ai.b = e.b; ai.c = pickNext(g, e.a, e.b, () => this.rng.next());
      ai.pts = edgePoints(g, ai.a, ai.b); ai.idx = 0; ai.phase = 'edge';
    }
    while (ai.idx < ai.pts.length && Math.hypot(ai.pts[ai.idx].x - u.pos.x, ai.pts[ai.idx].z - u.pos.z) < 4.5) ai.idx++;
    if (ai.idx >= ai.pts.length) {
      if (ai.phase === 'edge') { ai.phase = 'turn'; ai.pts = turnPoints(g, ai.a, ai.b, ai.c); }
      else { ai.phase = 'edge'; ai.a = ai.b; ai.b = ai.c; ai.c = pickNext(g, ai.a, ai.b, () => this.rng.next()); ai.pts = edgePoints(g, ai.a, ai.b); }
      ai.idx = 0;
    }
    const p = ai.pts[ai.idx];
    const { steer, diff } = steerTo(u, p.x, p.z);
    u.steer = steer;
    let want = Math.abs(diff) > 0.3 ? 6.5 : cruise;
    const fx = Math.sin(u.heading), fz = Math.cos(u.heading);
    for (const o of g.vehicles) {
      if (o === u) continue;
      const dx = o.pos.x - u.pos.x, dz = o.pos.z - u.pos.z;
      const along = dx * fx + dz * fz;
      if (along < 0 || along > 15) continue;
      if (Math.abs(dx * fz - dz * fx) > 2) continue;
      want = Math.min(want, Math.max(0, (along - 6) * 0.9));
    }
    u.throttle = clamp((want - u.speed) * 0.45, -1, 1);
    if (u.throttle > 0.4 && u.speedAbs < 0.8) ai.stuckT += dt; else ai.stuckT = 0;
    if (ai.stuckT > 3) { ai.pts = []; ai.stuckT = 0; }
  }

  // ------------------------------------------------------------------ officers
  private deploy(u: Vehicle) {
    const ai = u.ai as CopAI;
    ai.deployed = true;
    ai.mode = 'deployed';
    const n = this.heat >= 3 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const side = i === 0 ? 1 : -1;
      const lx = Math.cos(u.heading) * side, lz = -Math.sin(u.heading) * side;
      const o = this.spawnOfficer(u.pos.x + lx * 1.8, u.pos.z + lz * 1.8, u.heading, u, u.kind === 'swat');
      ai.officers.push(o);
    }
    this.g.audio.door();
  }

  spawnOfficer(x: number, z: number, heading: number, car: Vehicle | null, swat = false): Officer {
    const view = createCharacter('cop', swat ? SWAT_SKIN : COP_SKIN);
    this.g.scene.add(view.root);
    const o: Officer = { view, pos: new THREE.Vector3(x, groundHeight(x, z), z), heading, vx: 0, vz: 0, car, sees: false, checkT: 0, knockT: 0, state: 'idle', goal: null, returning: false };
    this.officers.push(o);
    return o;
  }

  /** returns true to remove */
  private updateOfficer(o: Officer, dt: number): boolean {
    const g = this.g;
    const P = g.player.worldPos;
    const d = Math.hypot(P.x - o.pos.x, P.z - o.pos.z);
    o.checkT -= dt;
    if (o.checkT <= 0) {
      o.checkT = 0.15;
      o.sees = !g.player.vehicle || d < 25 ? this.canSee(o.pos.x, o.pos.y + 1.6, o.pos.z, d, FOOT_SIGHT) : false;
    }
    if (o.sees) this.markSeen();

    let tx = o.pos.x, tz = o.pos.z, speed = 0;
    if (o.knockT > 0) {
      o.knockT -= dt;
      o.vx = damp(o.vx, 0, 4, dt); o.vz = damp(o.vz, 0, 4, dt);
      o.pos.x += o.vx * dt; o.pos.z += o.vz * dt;
      o.view.update(dt, 'fall', 0);
      this.syncOfficer(o);
      return false;
    }
    if (g.player.busted) {
      if (d > 1.6) { tx = P.x; tz = P.z; speed = 2; }
    } else if (g.player.vehicle && d > 22) {
      // go back to the car (or give up)
      o.returning = true;
      if (o.car && this.units.includes(o.car)) {
        tx = o.car.pos.x; tz = o.car.pos.z; speed = 6;
        if (Math.hypot(tx - o.pos.x, tz - o.pos.z) < 2.6) return true;
      } else if (!g.isVisible(o.pos.x, 1, o.pos.z) || d > 80) return true;
    } else if (this.heat > 0 && (o.sees || this.lastSeenT < 2)) {
      tx = P.x; tz = P.z; speed = d < 3 ? 4.5 : 6.0;
    } else if (this.heat > 0) {
      tx = this.lastKnown.x; tz = this.lastKnown.z;
      speed = Math.hypot(tx - o.pos.x, tz - o.pos.z) > 2 ? 3.5 : 0;
      if (d > 90 && !g.isVisible(o.pos.x, 1, o.pos.z)) return true;
    } else {
      if (o.car && this.units.includes(o.car)) { tx = o.car.pos.x; tz = o.car.pos.z; speed = 3.2; if (Math.hypot(tx - o.pos.x, tz - o.pos.z) < 2.6) return true; }
      else if (!g.isVisible(o.pos.x, 1, o.pos.z)) return true;
    }
    if (o.goal) { tx = o.goal.x; tz = o.goal.z; speed = 4; if (Math.hypot(tx - o.pos.x, tz - o.pos.z) < 2) o.goal = null; }
    const dx = tx - o.pos.x, dz = tz - o.pos.z;
    const dl = Math.hypot(dx, dz);
    const vx = dl > 0.5 ? (dx / dl) * speed : 0, vz = dl > 0.5 ? (dz / dl) * speed : 0;
    o.vx = damp(o.vx, vx, 8, dt);
    o.vz = damp(o.vz, vz, 8, dt);
    o.pos.x += o.vx * dt;
    o.pos.z += o.vz * dt;
    g.col.resolveCircle(o.pos, 0.34, o.pos.y, 0.45, o.pos.y + 1.7);
    const base = groundHeight(o.pos.x, o.pos.z);
    o.pos.y = Math.max(base, g.col.groundUnder(o.pos.x, o.pos.z, 0.3, o.pos.y + 0.46));
    // cars knock officers down
    for (const v of g.vehicles) {
      if (v.speedAbs < 7) continue;
      if (Math.hypot(v.pos.x - o.pos.x, v.pos.z - o.pos.z) < 2.2) {
        o.knockT = 2.2; o.vx = v.vx * 0.5; o.vz = v.vz * 0.5;
        g.audio.thud(0.5);
        if (v.driver === 'player') this.crime(Math.max(2, this.heat), 'officer hit');
      }
    }
    const sp = Math.hypot(o.vx, o.vz);
    if (sp > 0.3) o.heading = dampAngle(o.heading, Math.atan2(o.vx, o.vz), 10, dt);
    else if (d < 12) o.heading = dampAngle(o.heading, Math.atan2(P.x - o.pos.x, P.z - o.pos.z), 6, dt);
    o.state = sp > 4.2 ? 'run' : sp > 0.4 ? 'walk' : 'idle';
    o.view.update(dt, o.state, sp);
    this.syncOfficer(o);
    void wrapAngle;
    return false;
  }

  private syncOfficer(o: Officer) {
    o.view.root.position.copy(o.pos);
    o.view.root.rotation.y = o.heading;
  }

  /** Car alarm / distraction: send officers + searching units to a point. */
  lure(pos: THREE.Vector3) {
    for (const o of this.officers) if (!o.sees && o.pos.distanceTo(pos) < 60) o.goal = pos.clone();
    if (this.heat > 0 && this.lastSeenT > 2) this.lastKnown.copy(pos);
  }

  /** nearest siren for audio */
  nearestSiren(p: THREE.Vector3): number {
    let best = Infinity;
    for (const u of this.units) if (u.siren) best = Math.min(best, u.pos.distanceTo(p));
    return best;
  }

  get pitch() { return PITCH; }
  get edge() { return HALF; }
}

// ------------------------------------------------------------------ helicopter
class Heli {
  group = new THREE.Group();
  rotor: THREE.Mesh;
  spot: THREE.Mesh;
  beam: THREE.Mesh;
  pos = new THREE.Vector3();
  spotPos = new THREE.Vector3();
  private t = 0;

  constructor(private g: Game) {
    const M = worldMaterials();
    const b = new GeoBuilder();
    b.cbox(0, 0, 0, 2.0, 1.8, 4.2, { color: '#1e2533', shadeSides: true });
    b.cbox(0, 0.1, 2.2, 1.6, 1.2, 0.6, { color: '#2a3a4a' });
    b.cbox(0, 0.4, -4.0, 0.4, 0.5, 4.0, { color: '#1e2533' });
    b.cbox(0, 1.2, -5.8, 0.15, 1.4, 0.8, { color: '#1e2533' });
    b.cbox(0, -1.2, 0, 2.4, 0.12, 0.2, { color: '#3a3c3e' });
    b.cbox(1.1, -1.2, 0, 0.12, 0.12, 3.6, { color: '#3a3c3e' });
    b.cbox(-1.1, -1.2, 0, 0.12, 0.12, 3.6, { color: '#3a3c3e' });
    b.cbox(0, -0.2, 2.1, 1.7, 0.08, 0.5, { color: '#dcdad2' });
    const body = new THREE.Mesh(b.build(), M.props);
    body.castShadow = true;
    this.group.add(body);
    this.rotor = new THREE.Mesh(new THREE.BoxGeometry(11, 0.08, 0.4), basicMat({ color: '#1a1a1a' }));
    this.rotor.position.y = 1.15;
    this.group.add(this.rotor);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), basicMat({ color: '#ff2a1a' }));
    red.position.set(0, -0.9, -1);
    this.group.add(red);
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 7, 1, 10, 1, true).translate(0, -0.5, 0),
      new THREE.MeshBasicMaterial({ color: '#fff2c8', transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    g.scene.add(this.beam);
    this.spot = new THREE.Mesh(new THREE.CircleGeometry(7, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#fff2c8', transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }));
    g.scene.add(this.spot);
    const P = g.player.worldPos;
    this.pos.set(P.x + 60, 40, P.z - 60);
    this.spotPos.copy(P);
    g.scene.add(this.group);
    g.hud.toast('HELICOPTER INBOUND', 'heat');
  }

  /** returns true if the searchlight is on the player */
  update(dt: number, police: Police): boolean {
    const g = this.g;
    this.t += dt;
    const P = g.player.worldPos;
    const blacked = g.hack.isBlackedOut(P.x, P.z) || g.bank.isInside(P.x, P.z);
    const target = police.lastSeenT < 2 && !blacked ? P : police.lastKnown;
    const hx = target.x + Math.sin(this.t * 0.4) * 18, hz = target.z + Math.cos(this.t * 0.4) * 18;
    this.pos.x = damp(this.pos.x, hx, 0.6, dt);
    this.pos.z = damp(this.pos.z, hz, 0.6, dt);
    this.pos.y = 40;
    this.group.position.copy(this.pos);
    this.group.rotation.y = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
    this.group.rotation.z = Math.sin(this.t * 0.7) * 0.06;
    this.rotor.rotation.y += dt * 30;
    // searchlight drifts toward the player when not blacked out
    const sweepX = Math.sin(this.t * 1.3) * 5, sweepZ = Math.cos(this.t * 0.9) * 5;
    const near = Math.hypot(P.x - this.spotPos.x, P.z - this.spotPos.z) < 30 && !blacked;
    const sx = near ? P.x : target.x + sweepX, sz = near ? P.z : target.z + sweepZ;
    this.spotPos.x = damp(this.spotPos.x, sx, near ? 1.6 : 0.8, dt);
    this.spotPos.z = damp(this.spotPos.z, sz, near ? 1.6 : 0.8, dt);
    this.spot.position.set(this.spotPos.x, 0.25, this.spotPos.z);
    const dx = this.spotPos.x - this.pos.x, dz = this.spotPos.z - this.pos.z, dy = 0.25 - (this.pos.y - 1);
    const L = Math.hypot(dx, dy, dz);
    this.beam.position.set(this.pos.x, this.pos.y - 1, this.pos.z);
    this.beam.scale.set(1, L, 1);
    this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(dx / L, dy / L, dz / L));
    return !blacked && Math.hypot(P.x - this.spotPos.x, P.z - this.spotPos.z) < 6.5;
  }

  leave(dt: number) {
    this.pos.y += dt * 8;
    this.pos.x += dt * 20;
    this.group.position.copy(this.pos);
    this.rotor.rotation.y += dt * 30;
    this.beam.visible = this.spot.visible = false;
    return this.pos.y > 90;
  }

  dispose() {
    this.g.scene.remove(this.group, this.beam, this.spot);
  }
}
