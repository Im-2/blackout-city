// Living crowd: 90-230 agents on a sidewalk graph. Near agents get full
// SkinnedMesh rigs (pooled by distance); far agents are instanced "ghosts".
// Behaviours: walk, wait for crosswalk lights, cross, chat groups, benches,
// queues at carts/ATMs, vendors, buskers, doors in/out, panic, dodge,
// knockdown + get up, lures, and WITNESSES who phone the police.
import * as THREE from 'three';
import { Rng, dampAngle, damp } from '../core/math';
import { RigCharacter, AnimState } from '../characters/rig';
import { makePedSkin, PedType, WALKER_WEIGHTS } from '../characters/pedTypes';
import type { Skin } from '../characters/skins';
import { BLOCKS, blockBounds, groundHeight, CURB_H } from '../world/layout';
import { GeoBuilder } from '../world/geo';
import { basicMat, worldMat } from '../render/patch';
import { texNoise } from '../assets/textures';
import type { Game } from '../core/game';

type Role = 'walker' | 'vendor' | 'busker' | 'sitter' | 'chat' | 'queue' | 'guard';
type State =
  | 'walk' | 'wait' | 'idle' | 'station' | 'panic' | 'knocked' | 'lured' | 'calling'
  | 'toDoor' | 'inside' | 'return' | 'dodge' | 'handsup';

interface SNode { x: number; z: number; edges: SEdge[]; }
interface SEdge { a: number; b: number; cross: null | { node: number; axis: 'x' | 'z' }; len: number; }

interface Agent {
  type: PedType;
  role: Role;
  skin: Skin;
  x: number; z: number; y: number;
  heading: number;
  speed: number;
  v: number; // current speed
  a: number; b: number; edge: SEdge | null; t: number; lat: number;
  state: State;
  timer: number;
  anchor: { x: number; z: number; heading: number; anim: AnimState } | null;
  goal: { x: number; z: number } | null;
  rig: RigCharacter | null;
  full: boolean;
  vx: number; vz: number;
  callT: number; losT: number;
  dog: THREE.Group | null;
  dist: number;
  panicCD: number;
  off?: boolean; // over the quality budget: not simulated or drawn
}

const FULL_R = 52;
const GHOST_R = 165;

export class Pedestrians {
  agents: Agent[] = [];
  nodes: SNode[] = [];
  edges: SEdge[] = [];
  private rng = new Rng(77);
  private ghosts!: { legs: THREE.InstancedMesh; top: THREE.InstancedMesh; head: THREE.InstancedMesh; hair: THREE.InstancedMesh };
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v3 = new THREE.Vector3();
  private s3 = new THREE.Vector3(1, 1, 1);
  private c = new THREE.Color();
  private lodT = 0;
  private icons: HTMLDivElement[] = [];
  private dogPool: THREE.Group[] = [];
  private screamT = 0;
  stats = { total: 0, full: 0, ghost: 0, calling: 0 };

  constructor(private g: Game) {
    this.buildGraph();
    this.buildGhosts();
    for (let i = 0; i < 6; i++) {
      const d = document.createElement('div');
      d.className = 'witness';
      d.innerHTML = '<div class="wi">☎ CALLING 911</div><div class="wb"><i></i></div>';
      d.style.display = 'none';
      g.hud.root.appendChild(d);
      this.icons.push(d);
    }
  }

  // ------------------------------------------------------------------ graph
  private buildGraph() {
    const id = (bi: number, bj: number, k: number) => (bj * BLOCKS + bi) * 4 + k;
    for (let bj = 0; bj < BLOCKS; bj++)
      for (let bi = 0; bi < BLOCKS; bi++) {
        const b = blockBounds(bi, bj);
        const i = 1.8;
        this.nodes.push({ x: b.x0 + i, z: b.z0 + i, edges: [] }, { x: b.x1 - i, z: b.z0 + i, edges: [] }, { x: b.x1 - i, z: b.z1 - i, edges: [] }, { x: b.x0 + i, z: b.z1 - i, edges: [] });
      }
    const link = (a: number, b: number, cross: SEdge['cross']) => {
      const A = this.nodes[a], B = this.nodes[b];
      const e: SEdge = { a, b, cross, len: Math.hypot(B.x - A.x, B.z - A.z) };
      this.edges.push(e);
      A.edges.push(e);
      B.edges.push(e);
    };
    const G = this.g.city.graph;
    for (let bj = 0; bj < BLOCKS; bj++)
      for (let bi = 0; bi < BLOCKS; bi++) {
        for (let k = 0; k < 4; k++) link(id(bi, bj, k), id(bi, bj, (k + 1) % 4), null);
        if (bi < BLOCKS - 1) {
          link(id(bi, bj, 1), id(bi + 1, bj, 0), { node: G.node(bi + 1, bj).id, axis: 'z' });
          link(id(bi, bj, 2), id(bi + 1, bj, 3), { node: G.node(bi + 1, bj + 1).id, axis: 'z' });
        }
        if (bj < BLOCKS - 1) {
          link(id(bi, bj, 3), id(bi, bj + 1, 0), { node: G.node(bi, bj + 1).id, axis: 'x' });
          link(id(bi, bj, 2), id(bi + 1 - 1, bj + 1, 1), { node: G.node(bi + 1, bj + 1).id, axis: 'x' });
        }
      }
  }

  private nearestNode(x: number, z: number) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.nodes.length; i++) {
      const d = Math.hypot(this.nodes[i].x - x, this.nodes[i].z - z);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // ------------------------------------------------------------------ ghosts (far LOD)
  private buildGhosts() {
    const max = 260;
    const mat = worldMat({ map: texNoise(), color: 0xffffff });
    const mk = (geo: GeoBuilder) => {
      const im = new THREE.InstancedMesh(geo.build(), mat, max);
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
      im.count = 0;
      im.frustumCulled = false;
      this.g.scene.add(im);
      return im;
    };
    const legs = new GeoBuilder().cbox(0.1, 0.45, 0, 0.15, 0.9, 0.17).cbox(-0.1, 0.45, 0, 0.15, 0.9, 0.17).cbox(0, 0.93, 0, 0.34, 0.18, 0.2);
    const top = new GeoBuilder().cbox(0, 1.31, 0, 0.42, 0.58, 0.22).cbox(0.26, 1.2, 0, 0.11, 0.6, 0.12).cbox(-0.26, 1.2, 0, 0.11, 0.6, 0.12);
    const head = new GeoBuilder().cbox(0, 1.76, 0.01, 0.24, 0.26, 0.26);
    const hair = new GeoBuilder().cbox(0, 1.9, -0.01, 0.26, 0.06, 0.28);
    this.ghosts = { legs: mk(legs), top: mk(top), head: mk(head), hair: mk(hair) };
    void basicMat;
  }

  // ------------------------------------------------------------------ setup
  reset() {
    const g = this.g;
    for (const a of this.agents) { if (a.rig) g.scene.remove(a.rig.root); if (a.dog) g.scene.remove(a.dog); }
    this.agents = [];
    this.dogPool = [];
    const total = 230; // max pool; quality.peds decides how many are live
    const r = this.rng;
    const life = g.street;
    const add = (type: PedType, role: Role, anchor: Agent['anchor']) => {
      const skin = makePedSkin(type, r);
      const n = r.int(0, this.nodes.length - 1);
      const A = this.nodes[n];
      const e = r.pick(A.edges);
      const ag: Agent = {
        type, role, skin, x: A.x, z: A.z, y: CURB_H, heading: 0,
        speed: type === 'jogger' ? r.range(3.0, 3.6) : type === 'courier' ? r.range(1.6, 1.9) : type === 'tourist' ? r.range(0.9, 1.2) : r.range(1.15, 1.55),
        v: 0, a: n, b: e.a === n ? e.b : e.a, edge: e, t: r.next(), lat: r.range(-1.0, 1.0),
        state: anchor ? 'station' : 'walk', timer: r.range(3, 15), anchor, goal: null, rig: null, full: false,
        vx: 0, vz: 0, callT: 0, losT: 0, dog: null, dist: 999, panicCD: 0,
      };
      if (anchor) { ag.x = anchor.x; ag.z = anchor.z; ag.heading = anchor.heading; }
      else this.placeOnEdge(ag);
      this.agents.push(ag);
      return ag;
    };
    // stationary roles
    for (const c of life.carts) {
      add('vendor', 'vendor', { x: c.x, z: c.z, heading: c.heading, anim: 'idle' });
      const nq = r.int(0, 3);
      for (let i = 0; i < nq; i++) { const q = c.queue[i]; add(r.pick(['office', 'local', 'teen', 'construction'] as PedType[]), 'queue', { x: q.x, z: q.z, heading: Math.atan2(c.x - q.x, c.z - q.z), anim: i === 0 ? 'chat' : 'idle' }); }
    }
    for (const a of life.atms) if (r.chance(0.6)) {
      const nq = r.int(1, 2);
      for (let i = 0; i < nq; i++) { const q = a.queue[i]; add(r.pick(['office', 'local', 'tourist'] as PedType[]), 'queue', { x: q.x, z: q.z, heading: q.heading, anim: i === 0 ? 'phone' : 'idle' }); }
    }
    for (const b of life.buskerSpots) add('busker', 'busker', { x: b.x, z: b.z, heading: b.heading, anim: 'busk' });
    for (const s of life.guardSpots) add('security', 'guard', { x: s.x, z: s.z, heading: s.heading, anim: 'idle' });
    const benches = [...g.city.benches].sort(() => r.next() - 0.5);
    for (let i = 0; i < Math.min(benches.length, Math.round(total * 0.08)); i++) {
      const b = benches[i];
      const off = r.range(-0.5, 0.5);
      add(i % 3 === 0 ? 'homeless' : r.pick(['office', 'local', 'tourist', 'teen'] as PedType[]), 'sitter', { x: b.x + Math.cos(b.yaw) * off, z: b.z - Math.sin(b.yaw) * off + Math.cos(b.yaw) * 0.05, heading: b.yaw, anim: 'sit' });
    }
    for (const c of life.chatSpots) {
      if (this.agents.length > total * 0.45) break;
      const n = r.int(2, 4);
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + r.range(-0.2, 0.2);
        const x = c.x + Math.sin(ang) * 0.75, z = c.z + Math.cos(ang) * 0.75;
        add(r.pick(['office', 'local', 'teen', 'tourist', 'construction'] as PedType[]), 'chat', { x, z, heading: Math.atan2(c.x - x, c.z - z), anim: r.chance(0.6) ? 'chat' : 'idle' });
      }
    }
    // walkers fill the rest
    const wsum = WALKER_WEIGHTS.reduce((s, w) => s + w[1], 0);
    while (this.agents.length < total) {
      let k = r.next() * wsum, type: PedType = 'local';
      for (const [t, w] of WALKER_WEIGHTS) { k -= w; if (k <= 0) { type = t; break; } }
      add(type, 'walker', null);
    }
  }

  private placeOnEdge(a: Agent) {
    const A = this.nodes[a.a], B = this.nodes[a.b];
    const dx = B.x - A.x, dz = B.z - A.z;
    const L = Math.hypot(dx, dz) || 1;
    const px = -dz / L, pz = dx / L;
    a.x = A.x + dx * a.t + px * a.lat;
    a.z = A.z + dz * a.t + pz * a.lat;
    a.heading = Math.atan2(dx, dz);
  }

  // ------------------------------------------------------------------ public reactions
  panic(pos: THREE.Vector3, radius: number, handsUp = false) {
    let screamed = false;
    for (const a of this.agents) {
      if (a.state === 'knocked' || a.state === 'inside' || a.panicCD > 0) continue;
      const d = Math.hypot(a.x - pos.x, a.z - pos.z);
      if (d > radius) continue;
      this.scare(a, pos.x, pos.z, handsUp && d < radius * 0.6);
      if (!screamed && a.full && d < 25) { this.g.audio.scream(this.v3.set(a.x, 1.6, a.z)); screamed = true; }
    }
  }

  private scare(a: Agent, fx: number, fz: number, handsUp: boolean) {
    a.state = handsUp ? 'handsup' : 'panic';
    a.timer = handsUp ? 2.2 : this.rng.range(3, 5.5);
    a.panicCD = 1;
    const dx = a.x - fx, dz = a.z - fz;
    const l = Math.hypot(dx, dz) || 1;
    a.goal = { x: a.x + (dx / l) * 16, z: a.z + (dz / l) * 16 };
  }

  lure(pos: THREE.Vector3, radius = 40) {
    for (const a of this.agents) {
      if (a.state === 'knocked' || a.state === 'panic' || a.state === 'inside' || a.role === 'vendor') continue;
      if (Math.hypot(a.x - pos.x, a.z - pos.z) < radius) {
        a.state = 'lured';
        a.timer = this.rng.range(8, 13);
        const ang = this.rng.range(0, Math.PI * 2);
        a.goal = { x: pos.x + Math.cos(ang) * 4.5, z: pos.z + Math.sin(ang) * 4.5 };
      }
    }
  }

  ejectDriver(pos: THREE.Vector3) {
    let best: Agent | null = null, bd = -1;
    for (const a of this.agents) if (a.role === 'walker' && a.dist > bd && a.state !== 'calling') { bd = a.dist; best = a; }
    if (!best) return;
    best.x = pos.x; best.z = pos.z;
    this.scare(best, pos.x - 1, pos.z, false);
    this.witnessCrime(pos, 'carjack', 1);
  }

  /** WITNESSES: nearby peds who can see a crime pull out a phone and call it in. */
  witnessCrime(pos: THREE.Vector3, kind: string, maxCallers = 2) {
    const g = this.g;
    const cands = this.agents
      .filter((a) => a.state !== 'inside' && a.state !== 'knocked' && a.state !== 'calling' && a.role !== 'guard' && Math.hypot(a.x - pos.x, a.z - pos.z) < 34)
      .sort((p, q) => Math.hypot(p.x - pos.x, p.z - pos.z) - Math.hypot(q.x - pos.x, q.z - pos.z))
      .slice(0, 8);
    let n = 0;
    for (const a of cands) {
      if (n >= maxCallers) break;
      if (!g.col.lineOfSight(a.x, a.y + 1.6, a.z, pos.x, pos.y + 1, pos.z)) continue;
      if (Math.hypot(a.x - pos.x, a.z - pos.z) < 3.5) { this.scare(a, pos.x, pos.z, true); continue; }
      a.state = 'calling';
      a.callT = 0;
      a.losT = 0;
      a.timer = 5.5;
      a.goal = null;
      n++;
    }
    if (n) g.hud.toast(`WITNESS${n > 1 ? 'ES' : ''} CALLING THE COPS`, 'heat');
    void kind;
  }

  // ------------------------------------------------------------------ update
  update(dt: number) {
    const g = this.g;
    const P = g.player.worldPos;
    this.screamT -= dt;
    this.lodT -= dt;
    const live = g.quality.p.peds;
    this.agents.forEach((a, i) => {
      a.dist = Math.hypot(a.x - P.x, a.z - P.z);
      a.off = i >= live;
    });
    if (this.lodT <= 0) { this.lodT = 0.3; this.assignLod(); }

    let calling = 0;
    for (const a of this.agents) {
      if (a.off) continue;
      if (a.state === 'inside') { a.timer -= dt; if (a.timer <= 0) this.emerge(a); continue; }
      if (a.dist > GHOST_R + 30) { this.cheapUpdate(a, dt); continue; }
      a.panicCD -= dt;
      this.reactToCars(a);
      this.think(a, dt);
      if (a.state === 'calling') calling++;
      // animate
      if (a.full && a.rig) {
        a.rig.update(dt, this.animFor(a), a.v);
        a.rig.root.position.set(a.x, a.y, a.z);
        a.rig.root.rotation.y = a.heading;
        if (a.dog) this.updateDog(a, dt);
      }
    }
    this.stats.calling = calling;
    this.drawGhosts();
    this.drawIcons();
  }

  private animFor(a: Agent): AnimState {
    switch (a.state) {
      case 'station': case 'wait': case 'idle': return a.anchor ? a.anchor.anim : a.type === 'teen' && a.state === 'idle' ? 'phone' : 'idle';
      case 'calling': return 'phone';
      case 'knocked': return 'fall';
      case 'handsup': return 'handsup';
      case 'panic': return 'panic';
      case 'dodge': return 'vault';
      default: return a.v > 2.6 ? 'run' : a.v > 0.2 ? 'walk' : 'idle';
    }
  }

  private cheapUpdate(a: Agent, dt: number) {
    if (a.state !== 'walk' || !a.edge) return;
    a.t += (a.speed * dt) / a.edge.len;
    if (a.t >= 1) this.arrive(a);
    else this.placeOnEdge(a);
  }

  private reactToCars(a: Agent) {
    const g = this.g;
    if (a.state === 'knocked' || a.state === 'inside') return;
    for (const v of g.vehicles) {
      const dx = a.x - v.pos.x, dz = a.z - v.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 100) continue;
      const sp = v.speedAbs;
      const d = Math.sqrt(d2);
      if (d < v.radius + 0.6 && sp > 4.5) {
        // hit: ragdoll-lite knockdown, gets up later
        a.state = 'knocked';
        a.timer = 3.2;
        a.vx = v.vx * 0.65 + (dx / (d || 1)) * 2.5;
        a.vz = v.vz * 0.65 + (dz / (d || 1)) * 2.5;
        g.audio.thud(0.5, this.v3.set(a.x, 1, a.z));
        g.fx.spawn('dust', this.v3.set(a.x, 0.5, a.z), 6);
        if (v.driver === 'player') { g.camRig.addShake(0.15); g.onPedHit(this.v3.set(a.x, 0, a.z)); }
        this.panic(this.v3.set(a.x, 0, a.z), 14);
        return;
      }
      // jump out of the way of a car heading at us
      if (sp > 6 && d < 9 && a.state !== 'dodge') {
        const along = -(dx * v.vx + dz * v.vz) / (sp * d);
        if (along < -0.85) {
          const side = Math.sign(dx * v.vz - dz * v.vx) || 1;
          a.state = 'dodge';
          a.timer = 0.45;
          a.goal = { x: a.x + (-v.vz / sp) * side * 2.6, z: a.z + (v.vx / sp) * side * 2.6 };
          if (v.driver === 'player' && this.screamT <= 0 && a.full) { this.g.audio.scream(this.v3.set(a.x, 1.6, a.z)); this.screamT = 1.5; }
        } else if (sp > 13 && v.driver === 'player' && d < 7 && a.panicCD <= 0 && (a.state === 'walk' || a.state === 'station')) this.scare(a, v.pos.x, v.pos.z, false);
      }
    }
  }

  private think(a: Agent, dt: number) {
    const g = this.g;
    a.timer -= dt;
    let tx = a.x, tz = a.z, speed = 0, collide = false;
    switch (a.state) {
      case 'walk': {
        const e = a.edge!;
        a.t += (a.speed * dt) / e.len;
        if (a.t >= 1) { this.arrive(a); return this.finish(a, dt, a.speed); }
        const ox = a.x, oz = a.z;
        this.placeOnEdge(a);
        a.v = Math.hypot(a.x - ox, a.z - oz) / Math.max(dt, 1e-4);
        a.y = CURB_H;
        if (a.timer < 0 && a.role === 'walker' && !e.cross) { a.state = 'idle'; a.timer = this.rng.range(1.5, 4); }
        return this.finish(a, dt, a.speed, true);
      }
      case 'wait': {
        const e = a.edge!;
        if (this.mayCross(e)) { a.state = 'walk'; a.timer = this.rng.range(6, 18); }
        break;
      }
      case 'idle':
        if (a.timer < 0) { a.state = 'walk'; a.timer = this.rng.range(6, 18); }
        break;
      case 'station':
        if (a.anchor) {
          tx = a.anchor.x; tz = a.anchor.z;
          speed = Math.hypot(tx - a.x, tz - a.z) > 0.3 ? 1.4 : 0;
          if (speed === 0) a.heading = dampAngle(a.heading, a.anchor.heading, 4, dt);
          if (a.anchor.anim === 'sit') a.y = CURB_H;
        }
        break;
      case 'panic':
        if (a.goal) { tx = a.goal.x; tz = a.goal.z; speed = 5.4; collide = true; }
        if (a.timer < 0) { a.state = 'return'; a.timer = 12; }
        break;
      case 'handsup':
        if (a.timer < 0) { a.state = 'panic'; a.timer = 3; }
        break;
      case 'dodge':
        if (a.goal) { tx = a.goal.x; tz = a.goal.z; speed = 7; collide = true; }
        if (a.timer < 0) { a.state = 'panic'; a.timer = 2.5; a.goal = { x: a.x + (a.x - (a.goal?.x ?? a.x)) * -3, z: a.z + (a.z - (a.goal?.z ?? a.z)) * -3 }; }
        break;
      case 'lured':
        if (a.goal) { tx = a.goal.x; tz = a.goal.z; speed = Math.hypot(tx - a.x, tz - a.z) > 1 ? 2.6 : 0; collide = true; }
        if (a.timer < 0) { a.state = 'return'; a.timer = 12; }
        break;
      case 'knocked':
        a.vx = damp(a.vx, 0, 3, dt); a.vz = damp(a.vz, 0, 3, dt);
        a.x += a.vx * dt; a.z += a.vz * dt;
        g.col.resolveCircle(a, 0.3, a.y, 0.45, a.y + 1.7);
        if (a.timer < 0) this.scare(a, a.x + (Math.random() - 0.5), a.z + (Math.random() - 0.5), false);
        a.y = groundHeight(a.x, a.z);
        a.v = 0;
        return;
      case 'calling': {
        // turn to watch the player, phone to ear
        const P = g.player.worldPos;
        a.heading = dampAngle(a.heading, Math.atan2(P.x - a.x, P.z - a.z), 5, dt);
        a.callT += dt;
        const sees = a.dist < 45 && g.col.lineOfSight(a.x, a.y + 1.6, a.z, P.x, P.y + 1, P.z);
        a.losT = sees ? 0 : a.losT + dt;
        if (a.dist < 3.2) { this.scare(a, P.x, P.z, true); g.hud.toast('WITNESS SCARED OFF', 'cool'); break; }
        if (a.losT > 2.2) { a.state = 'idle'; a.timer = 2; g.hud.toast('WITNESS LOST SIGHT OF YOU', 'cool'); break; }
        if (!g.street.coverage(a.x, a.z) || g.hack.isBlackedOut(a.x, a.z)) { a.state = 'idle'; a.timer = 3; g.hud.toast('CALL DROPPED — NO SIGNAL', 'cool'); break; }
        if (a.callT >= 5.5) {
          a.state = 'idle'; a.timer = 3;
          g.police.crime(Math.min(5, Math.max(1, g.police.heat + 1)), 'witness called it in');
          g.news.report('witness', a.x, a.z);
        }
        break;
      }
      case 'toDoor':
        if (a.goal) { tx = a.goal.x; tz = a.goal.z; speed = a.speed; }
        if (Math.hypot(tx - a.x, tz - a.z) < 0.6) { a.state = 'inside'; a.timer = this.rng.range(8, 30); this.hide(a); return; }
        break;
      case 'return': {
        const n = this.nodes[a.a];
        tx = n.x; tz = n.z; speed = 1.8; collide = true;
        if (a.anchor) { tx = a.anchor.x; tz = a.anchor.z; }
        if (Math.hypot(tx - a.x, tz - a.z) < 0.8 || a.timer < 0) {
          if (a.anchor) { a.state = 'station'; }
          else { a.state = 'walk'; a.t = 0; a.edge = this.pickEdge(a.a, -1); a.b = a.edge.a === a.a ? a.edge.b : a.edge.a; a.lat = this.rng.range(-1, 1); }
        }
        break;
      }
    }
    this.finish(a, dt, speed, false, tx, tz, collide);
  }

  private finish(a: Agent, dt: number, speed: number, onPath = false, tx = a.x, tz = a.z, collide = false) {
    if (onPath) return;
    const dx = tx - a.x, dz = tz - a.z;
    const dl = Math.hypot(dx, dz);
    if (dl > 0.05 && speed > 0) {
      const step = Math.min(dl, speed * dt);
      a.x += (dx / dl) * step;
      a.z += (dz / dl) * step;
      a.heading = dampAngle(a.heading, Math.atan2(dx, dz), 10, dt);
      a.v = step / Math.max(dt, 1e-4);
    } else a.v = 0;
    if (collide && a.full) this.g.col.resolveCircle(a, 0.3, a.y, 0.45, a.y + 1.7);
    if (!(a.anchor && a.state === 'station')) a.y = groundHeight(a.x, a.z);
  }

  private mayCross(e: SEdge) {
    if (!e.cross) return true;
    const n = this.g.city.graph.nodes[e.cross.node];
    if (!n.hasLight) return true;
    return this.g.signals.state(e.cross.node, e.cross.axis) === 'red' && this.g.signals.nodes[e.cross.node].override !== 'green';
  }

  private pickEdge(node: number, from: number): SEdge {
    const opts = this.nodes[node].edges.filter((e) => (e.a === node ? e.b : e.a) !== from);
    return this.rng.pick(opts.length ? opts : this.nodes[node].edges);
  }

  private arrive(a: Agent) {
    const prev = a.a;
    a.a = a.b;
    const e = this.pickEdge(a.a, prev);
    a.edge = e;
    a.b = e.a === a.a ? e.b : e.a;
    a.t = 0;
    a.lat = e.cross ? this.rng.range(-1.6, 1.6) : this.rng.range(-1.1, 1.1);
    this.placeOnEdge(a);
    if (e.cross && !this.mayCross(e)) { a.state = 'wait'; }
    // sometimes duck into a building
    else if (a.role === 'walker' && this.rng.chance(0.06) && this.g.city.doors.length) {
      let best: { x: number; z: number } | null = null, bd = 30;
      for (const d of this.g.city.doors) { const dd = Math.hypot(d.x - a.x, d.z - a.z); if (dd < bd) { bd = dd; best = d; } }
      if (best) { a.state = 'toDoor'; a.goal = { x: best.x, z: best.z }; }
    }
  }

  private hide(a: Agent) {
    if (a.rig) a.rig.root.visible = false;
    if (a.dog) a.dog.visible = false;
  }

  private emerge(a: Agent) {
    const d = this.rng.pick(this.g.city.doors);
    a.x = d.x; a.z = d.z; a.heading = d.heading;
    a.a = this.nearestNode(d.x, d.z);
    a.state = 'return';
    a.timer = 15;
  }

  // ------------------------------------------------------------------ LOD
  private assignLod() {
    const g = this.g;
    const max = g.quality.p.rigs;
    const sorted = this.agents.filter((a) => !a.off && a.state !== 'inside' && a.dist < FULL_R).sort((p, q) => p.dist - q.dist);
    const want = new Set(sorted.slice(0, max));
    let full = 0, created = 0;
    for (const a of this.agents) {
      let f = want.has(a);
      if (f && !a.rig && created >= 4) f = false; // stagger rig builds to avoid hitches
      if (f && !a.rig) {
        created++;
        a.rig = new RigCharacter(a.skin);
        g.scene.add(a.rig.root);
      }
      if (a.rig) a.rig.root.visible = f;
      if (f && a.type === 'dogwalker' && !a.dog) a.dog = this.takeDog();
      if (!f && a.dog) { this.dogPool.push(a.dog); a.dog.visible = false; a.dog = null; }
      a.full = f;
      if (f) full++;
    }
    this.stats.full = full;
    this.stats.total = Math.min(this.agents.length, g.quality.p.peds);
  }

  private drawGhosts() {
    const G = this.ghosts;
    let n = 0;
    const P = this.g.player.worldPos;
    for (const a of this.agents) {
      if (a.off || a.full || a.state === 'inside' || a.dist > GHOST_R) continue;
      if (!this.g.isVisible(a.x, 1, a.z) && a.dist > 20) continue;
      const bob = a.v > 0.3 ? Math.abs(Math.sin(a.dist * 0.0 + performance.now() * 0.009 + a.lat * 10)) * 0.04 : 0;
      const sit = a.anchor?.anim === 'sit' && a.state === 'station' ? -0.45 : 0;
      const fall = a.state === 'knocked';
      this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, a.heading);
      if (fall) this.q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -1.4));
      this.s3.set(a.skin.width, a.skin.height, a.skin.width);
      this.m.compose(this.v3.set(a.x, a.y + bob + sit, a.z), this.q, this.s3);
      G.legs.setMatrixAt(n, this.m); G.top.setMatrixAt(n, this.m); G.head.setMatrixAt(n, this.m); G.hair.setMatrixAt(n, this.m);
      G.legs.setColorAt(n, this.c.set(a.skin.pants));
      G.top.setColorAt(n, this.c.set(a.skin.top));
      G.head.setColorAt(n, this.c.set(a.skin.skin));
      G.hair.setColorAt(n, this.c.set(a.skin.cap ?? (a.skin.hairStyle === 'bald' ? a.skin.skin : a.skin.hair)));
      n++;
    }
    for (const im of [G.legs, G.top, G.head, G.hair]) {
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    this.stats.ghost = n;
    void P;
  }

  private drawIcons() {
    const cam = this.g.camera;
    let i = 0;
    for (const a of this.agents) {
      if (a.state !== 'calling' || i >= this.icons.length) continue;
      this.v3.set(a.x, a.y + 2.3, a.z).project(cam);
      const el = this.icons[i++];
      if (this.v3.z > 1) { el.style.display = 'none'; continue; }
      el.style.display = 'block';
      el.style.transform = `translate(${((this.v3.x * 0.5 + 0.5) * innerWidth) | 0}px, ${((-this.v3.y * 0.5 + 0.5) * innerHeight) | 0}px) translate(-50%, -100%)`;
      (el.querySelector('i') as HTMLElement).style.width = `${Math.min(1, a.callT / 5.5) * 100}%`;
    }
    for (; i < this.icons.length; i++) this.icons[i].style.display = 'none';
  }

  // ------------------------------------------------------------------ dogs
  private takeDog(): THREE.Group {
    const d = this.dogPool.pop();
    if (d) { d.visible = true; return d; }
    const g = new THREE.Group();
    const col = this.rng.pick(['#6b4a30', '#2a2420', '#c9b98f', '#8a8a84']);
    const b = new GeoBuilder();
    b.cbox(0, 0.32, 0, 0.22, 0.2, 0.5, { color: col, shadeSides: true });
    b.cbox(0, 0.45, 0.3, 0.16, 0.16, 0.18, { color: col });
    b.cbox(0, 0.42, 0.42, 0.08, 0.07, 0.1, { color: '#1a1a1a' });
    b.cbox(0, 0.38, -0.28, 0.05, 0.05, 0.16, { color: col });
    const mat = worldMat({ map: texNoise(), vertexColors: true });
    g.add(new THREE.Mesh(b.build(), mat));
    for (const [sx, sz] of [[0.07, 0.17], [-0.07, 0.17], [0.07, -0.17], [-0.07, -0.17]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.24, 0.06).translate(0, -0.12, 0), mat);
      leg.position.set(sx, 0.24, sz);
      g.add(leg);
    }
    // leash
    const leash = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.015, 1), basicMat({ color: '#9b3b2f' }));
    leash.name = 'leash';
    g.add(leash);
    g.children[0].castShadow = true;
    this.g.scene.add(g);
    return g;
  }

  private updateDog(a: Agent, dt: number) {
    const d = a.dog!;
    const sx = Math.cos(a.heading), sz = -Math.sin(a.heading);
    const tx = a.x + sx * 0.7 + Math.sin(a.heading) * 0.9, tz = a.z + sz * 0.7 + Math.cos(a.heading) * 0.9;
    d.position.x = damp(d.position.x, tx, 6, dt);
    d.position.z = damp(d.position.z, tz, 6, dt);
    d.position.y = a.y;
    d.rotation.y = dampAngle(d.rotation.y, a.heading, 6, dt);
    const t = performance.now() * 0.02 * Math.min(1.5, a.v);
    for (let i = 1; i <= 4; i++) d.children[i].rotation.x = Math.sin(t + (i % 2) * Math.PI) * 0.6 * Math.min(1, a.v);
    const leash = d.getObjectByName('leash')!;
    const hx = a.x + sx * 0.28 - d.position.x, hz = a.z + sz * 0.28 - d.position.z;
    const L = Math.hypot(hx, hz, 0.5);
    leash.position.set(hx / 2, 0.45 + 0.35, hz / 2);
    leash.position.applyAxisAngle(THREE.Object3D.DEFAULT_UP, -d.rotation.y);
    leash.scale.z = L;
    leash.lookAt(a.x + sx * 0.28, a.y + 1.0, a.z + sz * 0.28);
  }

  /** debug: drop a crowd around a point */
  spawnCrowd(x: number, z: number, n = 25) {
    for (let i = 0; i < n; i++) {
      const a = this.rng.pick(this.agents.filter((q) => q.role === 'walker' && q.dist > 60));
      if (!a) break;
      const ang = this.rng.range(0, Math.PI * 2), r = this.rng.range(3, 14);
      a.x = x + Math.cos(ang) * r; a.z = z + Math.sin(ang) * r;
      a.a = this.nearestNode(a.x, a.z);
      a.state = 'return'; a.timer = 20;
    }
    this.lodT = 0;
  }
}
