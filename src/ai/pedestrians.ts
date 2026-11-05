// Living crowd: 90-230 agents on a sidewalk graph. Near agents get full
// SkinnedMesh rigs (pooled by distance); far agents are instanced "ghosts".
// Behaviours: walk, wait for crosswalk lights, cross, chat groups, benches,
// queues at carts/ATMs, vendors, buskers, doors in/out, panic, dodge,
// knockdown + get up, lures, and WITNESSES who phone the police.
import * as THREE from 'three';
import { Rng, dampAngle, damp } from '../core/math';
import { RigCharacter, AnimState } from '../characters/rig';
import { makePedSkin, PedType } from '../characters/pedTypes';
import { DISTRICTS, districtAt } from '../map/districts';
import type { Skin } from '../characters/skins';
import { BLOCKS, blockBounds, groundHeight, isRoad, CURB_H, HALF, PITCH, ROAD_HALF } from '../world/layout';
import { GeoBuilder } from '../world/geo';
import { basicMat, worldMat } from '../render/patch';
import { texNoise } from '../assets/textures';
import { device } from '../core/device';
import type { Game } from '../core/game';
import type { Vehicle } from '../vehicles/vehicle';

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
  off?: boolean; // over the quality budget or parked: not simulated or drawn
  spot: Station | null;
  /** no free spot nearby for a stationary role */
  parked: boolean;
  /** stopped to look at the player */
  watching?: boolean;
  noticeCD?: number;
  /** running to get off a crossing */
  hurry?: boolean;
  /** a car is coming: when the penny drops */
  reactAt?: number;
}

interface Station { x: number; z: number; heading: number; anim: AnimState; taken: Agent | null; }

const POOL = device.mobile ? 90 : 230;
const FULL_R = 52;
const GHOST_R = 165;
/** brisk enough that a crossing fits inside one walk signal */
const CROSS_SPEED = 2.1, HURRY_SPEED = 5;
/** how far ahead of a moving vehicle nothing may appear */
const SPAWN_CLEAR = 30;
const CAR_CELL = 24;
const carCell = (x: number, z: number) => (Math.floor((x + HALF + 200) / CAR_CELL) << 10) | Math.floor((z + HALF + 200) / CAR_CELL);

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
  private bubbles: { el: HTMLDivElement; a: Agent | null; t: number }[] = [];
  /** moving vehicles this frame, binned, so a pedestrian only looks at the ones near it */
  private carGrid = new Map<number, Vehicle[]>();
  private moving: Vehicle[] = [];
  stats = { total: 0, full: 0, ghost: 0, calling: 0, playerHitsRoad: 0, playerHitsSidewalk: 0 };

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
    for (let i = 0; i < 3; i++) {
      const d = document.createElement('div');
      d.className = 'ped-say';
      d.style.display = 'none';
      g.hud.root.appendChild(d);
      this.bubbles.push({ el: d, a: null, t: 0 });
    }
  }

  /** somebody on the street knows that face */
  recognise(tier: number, disguised: boolean) {
    const g = this.g;
    const P = g.player.pos;
    if (Math.random() > (disguised ? 0.1 : 0.22) * tier) return;
    const b = this.bubbles.find((x) => x.t <= 0);
    if (!b) return;
    let best: Agent | null = null, bd = 12;
    for (const a of this.agents) {
      if (a.off || a.role !== 'walker' || (a.state !== 'walk' && a.state !== 'idle') || a.edge?.cross || (a.noticeCD ?? 0) > g.time) continue;
      const d = Math.hypot(a.x - P.x, a.z - P.z);
      if (d > 3 && d < bd && g.col.lineOfSight(a.x, a.y + 1.6, a.z, P.x, P.y + 1.4, P.z)) { bd = d; best = a; }
    }
    if (!best) return;
    best.noticeCD = g.time + 40;
    const scared = g.police.heat > 0 || (tier >= 3 && Math.random() < 0.3);
    const lines = scared ? ['IT\'S THEM! RUN!', 'GET AWAY FROM ME!', 'THEY\'RE ON THE NEWS!'] : [['DO I KNOW YOU?'], ['SEEN YOU SOMEWHERE...', 'YOU LOOK FAMILIAR'], ['THAT\'S THE ONE FROM THE NEWS', 'HEY, LOOK WHO IT IS'], ['NICE WORK OUT THERE', 'CAN I GET A PHOTO?', 'THAT\'S THE ONE!'], ['YOU RUN THIS CITY!', 'A LEGEND, RIGHT THERE!']][tier];
    b.el.textContent = lines[Math.floor(Math.random() * lines.length)];
    b.a = best;
    b.t = 2.6;
    if (scared) this.scare(best, P.x, P.z, false);
    else { best.state = 'idle'; best.timer = 3; best.watching = true; }
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
  private spots: Record<string, Station[]> = {};
  private nearNodes: number[] = [];

  /** every place a stationary role can stand, across the whole city */
  private buildSpots() {
    const g = this.g, life = g.street;
    const S: Record<string, Station[]> = { vendor: [], queue: [], busker: [], guard: [], sitter: [], chat: [] };
    const add = (role: string, x: number, z: number, heading: number, anim: AnimState) => S[role].push({ x, z, heading, anim, taken: null });
    for (const c of life.carts) {
      add('vendor', c.x, c.z, c.heading, 'idle');
      c.queue.forEach((q, i) => add('queue', q.x, q.z, Math.atan2(c.x - q.x, c.z - q.z), i === 0 ? 'chat' : 'idle'));
    }
    for (const a of life.atms) a.queue.forEach((q, i) => add('queue', q.x, q.z, q.heading, i === 0 ? 'phone' : 'idle'));
    for (const b of life.buskerSpots) add('busker', b.x, b.z, b.heading, 'busk');
    for (const s of life.guardSpots) add('guard', s.x, s.z, s.heading, 'idle');
    for (const b of g.city.benches) add('sitter', b.x, b.z, b.yaw, 'sit');
    for (const c of life.chatSpots) {
      const n = this.rng.int(2, 4);
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2;
        const x = c.x + Math.sin(ang) * 0.75, z = c.z + Math.cos(ang) * 0.75;
        add('chat', x, z, Math.atan2(c.x - x, c.z - z), i % 2 ? 'idle' : 'chat');
      }
    }
    // some generated spots land off the kerb
    for (const k of Object.keys(S)) S[k] = S[k].filter((p) => !isRoad(p.x, p.z));
    this.spots = S;
  }

  reset() {
    const g = this.g;
    this.buildSpots();
    const r = this.rng;
    // restarting reuses the same cast: skins and rigs are cached, so no new textures
    if (this.agents.length) {
      for (const a of this.agents) {
        if (a.dog) { a.dog.visible = false; this.dogPool.push(a.dog); a.dog = null; }
        if (a.rig) a.rig.root.visible = false;
        a.full = false;
        a.spot = null;
        a.anchor = null;
        a.parked = false;
        a.state = 'walk';
        a.goal = null;
        a.vx = a.vz = 0;
      }
      this.onChunkChange();
      const Q = g.player.worldPos;
      for (const a of this.agents) if (a.role === 'walker') { a.dist = 999; this.relocate(a, Q.x, Q.z, true); }
      return;
    }
    const make = (type: PedType, role: Role) => {
      const n = r.int(0, this.nodes.length - 1);
      const A = this.nodes[n];
      const e = r.pick(A.edges);
      this.agents.push({
        type, role, skin: makePedSkin(type, r), x: A.x, z: A.z, y: CURB_H, heading: 0,
        speed: type === 'jogger' ? r.range(3.0, 3.6) : type === 'courier' ? r.range(1.6, 1.9) : type === 'tourist' ? r.range(0.9, 1.2) : r.range(1.15, 1.55),
        v: 0, a: n, b: e.a === n ? e.b : e.a, edge: e, t: r.next(), lat: r.range(-1.0, 1.0),
        state: 'walk', timer: r.range(3, 15), anchor: null, goal: null, rig: null, full: false,
        vx: 0, vz: 0, callT: 0, losT: 0, dog: null, dist: 999, panicCD: 0, spot: null, parked: false,
      });
    };
    const mix: PedType[] = ['office', 'local', 'teen', 'tourist', 'construction'];
    for (let i = 0; i < 10; i++) make('vendor', 'vendor');
    for (let i = 0; i < 5; i++) make('busker', 'busker');
    for (let i = 0; i < 6; i++) make('security', 'guard');
    for (let i = 0; i < 18; i++) make(i % 3 === 0 ? 'homeless' : r.pick(mix), 'sitter');
    for (let i = 0; i < 22; i++) make(r.pick(mix), 'queue');
    for (let i = 0; i < 44; i++) make(r.pick(mix), 'chat');
    // walkers: the citywide mix; relocation below keeps each type in the districts that want it
    const all = Object.values(DISTRICTS).flatMap((d) => d.peds);
    const sum = all.reduce((a, w) => a + w[1], 0);
    while (this.agents.length < POOL) {
      let k = r.next() * sum, type: PedType = 'local';
      for (const [t, w] of all) { k -= w; if (k <= 0) { type = t; break; } }
      make(type === 'security' ? 'local' : type, 'walker');
    }
    // shuffle so lower quality drops all roles evenly
    for (let i = this.agents.length - 1; i > 0; i--) { const j = r.int(0, i); [this.agents[i], this.agents[j]] = [this.agents[j], this.agents[i]]; }
    this.onChunkChange();
    const P = g.player.worldPos;
    for (const a of this.agents) if (a.role === 'walker') { a.dist = 999; this.relocate(a, P.x, P.z, true); }
  }

  /** Crowd streaming: stationary roles take the nearest free spots around the player. */
  onChunkChange() {
    if (!this.agents.length) return;
    const P = this.g.player.worldPos;
    this.nearNodes = [];
    for (let i = 0; i < this.nodes.length; i++) if (Math.hypot(this.nodes[i].x - P.x, this.nodes[i].z - P.z) < 180) this.nearNodes.push(i);
    for (const role of ['vendor', 'queue', 'busker', 'guard', 'sitter', 'chat'] as Role[]) {
      const list = this.spots[role];
      const agents = this.agents.filter((a) => a.role === role);
      for (const a of agents) {
        if (a.spot && Math.hypot(a.spot.x - P.x, a.spot.z - P.z) > 205) { a.spot.taken = null; a.spot = null; a.anchor = null; }
      }
      const free = list.filter((s) => !s.taken && Math.hypot(s.x - P.x, s.z - P.z) < 180).sort((p, q) => Math.hypot(p.x - P.x, p.z - P.z) - Math.hypot(q.x - P.x, q.z - P.z));
      let i = 0;
      for (const a of agents) {
        if (a.spot) { a.parked = false; continue; }
        const s = free[i++];
        if (!s) { a.parked = true; continue; }
        s.taken = a;
        a.spot = s;
        a.parked = false;
        a.anchor = { x: s.x, z: s.z, heading: s.heading, anim: s.anim };
        a.x = s.x; a.z = s.z; a.heading = s.heading; a.state = 'station';
      }
    }
  }

  /** Walkers that fall behind reappear out of sight, in a district that suits them. */
  private relocate(a: Agent, px: number, pz: number, initial = false) {
    const g = this.g;
    if (!this.nearNodes.length) return;
    for (let tries = 0; tries < 6; tries++) {
      const n = this.rng.pick(this.nearNodes);
      const A = this.nodes[n];
      const d = Math.hypot(A.x - px, A.z - pz);
      if (!initial && (d < 90 || g.isVisible(A.x, 1, A.z))) continue;
      if (this.aheadOfCar(A.x, A.z)) continue;
      const D = DISTRICTS[districtAt(A.x, A.z)];
      const w = D.peds.find((p) => p[0] === a.type);
      const max = Math.max(...D.peds.map((p) => p[1]));
      if (this.rng.next() > ((w ? w[1] : 0.15) / max) * D.crowd && tries < 5) continue;
      a.a = n;
      a.edge = this.sidewalkEdge(n);
      a.b = a.edge.a === n ? a.edge.b : a.edge.a;
      a.t = this.rng.next();
      a.lat = this.rng.range(-1, 1);
      a.state = 'walk';
      a.timer = this.rng.range(4, 14);
      a.goal = null;
      this.placeOnEdge(a);
      a.y = CURB_H;
      return;
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
      if (a.off || a.state === 'knocked' || a.state === 'inside' || a.panicCD > 0) continue;
      const d = Math.hypot(a.x - pos.x, a.z - pos.z);
      if (d > radius) continue;
      this.scare(a, pos.x, pos.z, handsUp && d < radius * 0.6);
      if (!screamed && a.full && d < 25) { this.g.audio.scream(this.v3.set(a.x, 1.6, a.z)); screamed = true; }
    }
  }

  private scare(a: Agent, fx: number, fz: number, handsUp: boolean) {
    // nobody stands in the road with their hands up
    const road = isRoad(a.x, a.z);
    a.state = handsUp && !road ? 'handsup' : 'panic';
    a.timer = a.state === 'handsup' ? 2.2 : this.rng.range(3, 5.5);
    a.panicCD = 1;
    a.hurry = false;
    a.goal = this.fleeGoal(a, fx, fz);
  }

  /** the block this point belongs to: on a road, the nearer side */
  private blockOf(x: number, z: number) {
    const bi = Math.max(0, Math.min(BLOCKS - 1, Math.floor((x + HALF) / PITCH)));
    const bj = Math.max(0, Math.min(BLOCKS - 1, Math.floor((z + HALF) / PITCH)));
    return { bi, bj, b: blockBounds(bi, bj) };
  }

  /** Away from the threat, but along the pavement. Never over a road; off one if you're on it. */
  private fleeGoal(a: Agent, fx: number, fz: number) {
    const { b } = this.blockOf(a.x, a.z);
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    if (isRoad(a.x, a.z)) return { x: clamp(a.x, b.x0 + 2, b.x1 - 2), z: clamp(a.z, b.z0 + 2, b.z1 - 2) };
    const dW = a.x - b.x0, dE = b.x1 - a.x, dN = a.z - b.z0, dS = b.z1 - a.z;
    const near = Math.min(dW, dE, dN, dS);
    const dx = a.x - fx, dz = a.z - fz;
    const l = Math.hypot(dx, dz) || 1;
    // inside the lot (a park, a forecourt): straight away, staying on the block
    if (near > 4.5) return { x: clamp(a.x + (dx / l) * 16, b.x0 + 2, b.x1 - 2), z: clamp(a.z + (dz / l) * 16, b.z0 + 2, b.z1 - 2) };
    const INSET = 2.4;
    const alongX = near === dN || near === dS; // this side runs along x
    const sideLine = alongX ? (near === dN ? b.z0 + INSET : b.z1 - INSET) : near === dW ? b.x0 + INSET : b.x1 - INSET;
    const dir = (alongX ? dx : dz) >= 0 ? 1 : -1;
    const lo = (alongX ? b.x0 : b.z0) + INSET, hi = (alongX ? b.x1 : b.z1) - INSET;
    const cur = alongX ? a.x : a.z;
    let to = clamp(cur + dir * 16, lo, hi);
    // cornered: go the other way rather than off the kerb
    if (Math.abs(to - cur) < 3) to = clamp(cur - dir * 16, lo, hi);
    return alongX ? { x: to, z: sideLine } : { x: sideLine, z: to };
  }

  lure(pos: THREE.Vector3, radius = 40) {
    for (const a of this.agents) {
      if (a.off || a.state === 'knocked' || a.state === 'panic' || a.state === 'inside' || a.role === 'vendor' || isRoad(a.x, a.z)) continue;
      if (Math.hypot(a.x - pos.x, a.z - pos.z) < radius) {
        const { bi, bj, b } = this.blockOf(a.x, a.z);
        const at = this.blockOf(pos.x, pos.z);
        if (at.bi !== bi || at.bj !== bj) continue;
        a.state = 'lured';
        a.timer = this.rng.range(8, 13);
        const ang = this.rng.range(0, Math.PI * 2);
        a.goal = { x: Math.max(b.x0 + 1.2, Math.min(b.x1 - 1.2, pos.x + Math.cos(ang) * 4.5)), z: Math.max(b.z0 + 1.2, Math.min(b.z1 - 1.2, pos.z + Math.sin(ang) * 4.5)) };
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
      .filter((a) => !a.off && a.state !== 'inside' && a.state !== 'knocked' && a.state !== 'calling' && a.role !== 'guard' && !isRoad(a.x, a.z) && Math.hypot(a.x - pos.x, a.z - pos.z) < 34)
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
    this.binCars();
    this.agents.forEach((a, i) => {
      a.dist = Math.hypot(a.x - P.x, a.z - P.z);
      a.off = i >= live || a.parked;
    });
    if (this.lodT <= 0) { this.lodT = 0.3; this.assignLod(); }

    let calling = 0, moved = 0;
    for (const a of this.agents) {
      if (a.off) continue;
      if (a.state === 'inside') { a.timer -= dt; if (a.timer <= 0) this.emerge(a); continue; }
      if (a.dist > GHOST_R + 30) {
        if (a.role === 'walker' && moved < 8) { moved++; this.relocate(a, P.x, P.z); }
        continue;
      }
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
      case 'station': case 'wait': case 'idle': if (a.watching) return 'phone'; return a.anchor ? a.anchor.anim : a.type === 'teen' && a.state === 'idle' ? 'phone' : 'idle';
      case 'calling': return 'phone';
      case 'knocked': return 'fall';
      case 'handsup': return 'handsup';
      case 'panic': return 'panic';
      case 'dodge': return 'vault';
      default: return a.v > 2.6 ? 'run' : a.v > 0.2 ? 'walk' : 'idle';
    }
  }

  private binCars() {
    for (const list of this.carGrid.values()) list.length = 0;
    this.moving.length = 0;
    for (const v of this.g.vehicles) {
      if (v.speedAbs < 1.5) continue;
      this.moving.push(v);
      const k = carCell(v.pos.x, v.pos.z);
      let list = this.carGrid.get(k);
      if (!list) this.carGrid.set(k, (list = []));
      list.push(v);
    }
  }

  /** would something appearing here be in the way of a moving vehicle? */
  private aheadOfCar(x: number, z: number) {
    for (const v of this.moving) {
      const dx = x - v.pos.x, dz = z - v.pos.z, d = Math.hypot(dx, dz);
      if (d > SPAWN_CLEAR + v.speedAbs) continue;
      if ((dx * v.vx + dz * v.vz) / (v.speedAbs * (d || 1)) > 0.3) return true;
    }
    return false;
  }

  private knock(a: Agent, v: Vehicle, dx: number, dz: number, d: number) {
    const g = this.g;
    // ragdoll-lite knockdown, gets up later
    a.state = 'knocked';
    a.timer = 3.2;
    a.hurry = false;
    a.vx = v.vx * 0.65 + (dx / (d || 1)) * 2.5;
    a.vz = v.vz * 0.65 + (dz / (d || 1)) * 2.5;
    g.audio.thud(0.5, this.v3.set(a.x, 1, a.z));
    g.fx.spawn('dust', this.v3.set(a.x, 0.5, a.z), 6);
    if (v.driver === 'player') { this.stats[isRoad(a.x, a.z) ? 'playerHitsRoad' : 'playerHitsSidewalk']++; g.camRig.addShake(0.15); g.onPedHit(this.v3.set(a.x, 0, a.z)); }
    this.panic(this.v3.set(a.x, 0, a.z), 14);
  }

  private reactToCars(a: Agent) {
    if (a.state === 'knocked' || a.state === 'inside') return;
    const onRoad = isRoad(a.x, a.z);
    let threat: Vehicle | null = null, threatT = Infinity;
    const look = (v: Vehicle) => {
      const dx = a.x - v.pos.x, dz = a.z - v.pos.z;
      const d = Math.hypot(dx, dz), sp = v.speedAbs;
      if (d < v.radius + 0.6 && sp > 4.5) { this.knock(a, v, dx, dz, d); return true; }
      if (sp > 6 && d < 7 && a.panicCD <= 0 && v.driver === 'player' && (a.state === 'walk' || a.state === 'station') && !isRoad(v.pos.x, v.pos.z)) this.scare(a, v.pos.x, v.pos.z, false);
      const along = (dx * v.vx + dz * v.vz) / (sp || 1);
      if (along <= 0) return false;
      const miss = Math.abs(dx * v.vz - dz * v.vx) / (sp || 1);
      if (miss > v.radius + 1.3) return false;
      const t = along / sp;
      if (t < threatT) { threatT = t; threat = v; }
      return false;
    };
    if (onRoad) { for (const v of this.moving) if (look(v)) return; } // a road is a long way to see down
    else {
      const cx = Math.floor((a.x + HALF + 200) / CAR_CELL), cz = Math.floor((a.z + HALF + 200) / CAR_CELL);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const list = this.carGrid.get(((cx + i) << 10) | (cz + j));
        if (list) for (const v of list) if (look(v)) return;
      }
    }
    const v = threat as Vehicle | null;
    if (!v) { a.reactAt = 0; return; }
    const sp = v.speedAbs;
    // can it still stop short of me? then it probably will
    const along = threatT * sp;
    const committed = (sp * sp) / 18 + 3 > along;
    const horizon = onRoad ? 3 : 0.7;
    if (threatT > horizon || (onRoad && !committed) || sp < 3) { if (threatT > horizon + 1) a.reactAt = 0; return; }
    // on the pavement, only a car that's actually left the road is a threat
    if (!onRoad && isRoad(v.pos.x, v.pos.z) && isRoad(v.pos.x + v.vx * threatT, v.pos.z + v.vz * threatT)) return;
    // a beat before it registers: faster cars get noticed sooner
    const now = this.g.time;
    if (!a.reactAt) { a.reactAt = now + Math.max(0.12, 0.35 - sp * 0.01); return; }
    if (now < a.reactAt || a.state === 'dodge' || a.hurry) return;
    a.reactAt = 0;
    if (onRoad && a.state === 'walk' && a.edge?.cross) {
      const left = (1 - a.t) * a.edge.len, back = a.t * a.edge.len;
      const room = Math.min(left, back);
      if (room / HURRY_SPEED < threatT) {
        // run for the nearer kerb, even if that's back where you came from
        if (back < left) { const b = a.b; a.b = a.a; a.a = b; a.t = 1 - a.t; a.lat = -a.lat; }
        a.hurry = true;
        return;
      }
    }
    this.dodge(a, v, onRoad);
  }

  /** jump aside: away from the road if there's a choice */
  private dodge(a: Agent, v: Vehicle, onRoad: boolean) {
    const sp = v.speedAbs || 1;
    let side = Math.sign((a.x - v.pos.x) * v.vz - (a.z - v.pos.z) * v.vx) || 1;
    const px = -v.vz / sp, pz = v.vx / sp;
    const { b } = this.blockOf(a.x, a.z);
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    if (!onRoad && (a.x + px * side * 2.6 - cx) ** 2 + (a.z + pz * side * 2.6 - cz) ** 2 > (a.x - cx) ** 2 + (a.z - cz) ** 2) side = -side;
    a.state = 'dodge';
    a.timer = 0.45;
    a.hurry = false;
    a.goal = { x: a.x + px * side * 2.6, z: a.z + pz * side * 2.6 };
    if (!onRoad) { a.goal.x = Math.max(b.x0 + 0.6, Math.min(b.x1 - 0.6, a.goal.x)); a.goal.z = Math.max(b.z0 + 0.6, Math.min(b.z1 - 0.6, a.goal.z)); }
    if (v.driver === 'player' && this.screamT <= 0 && a.full) { this.g.audio.scream(this.v3.set(a.x, 1.6, a.z)); this.screamT = 1.5; }
  }

  private think(a: Agent, dt: number) {
    const g = this.g;
    a.timer -= dt;
    let tx = a.x, tz = a.z, speed = 0, collide = false;
    switch (a.state) {
      case 'walk': {
        const e = a.edge!;
        const pace = a.hurry ? HURRY_SPEED : e.cross ? Math.max(a.speed, CROSS_SPEED) : a.speed;
        // the light changed on me: don't dawdle
        if (e.cross && !a.hurry && this.walkLeft(e) <= 0) a.hurry = true;
        a.t += (pace * dt) / e.len;
        if (a.t >= 1) { a.hurry = false; this.arrive(a); return this.finish(a, dt, a.speed); }
        const ox = a.x, oz = a.z;
        this.placeOnEdge(a);
        a.v = Math.hypot(a.x - ox, a.z - oz) / Math.max(dt, 1e-4);
        a.y = e.cross ? groundHeight(a.x, a.z) : CURB_H;
        if (a.timer < 0 && a.role === 'walker' && !e.cross) { a.state = 'idle'; a.timer = this.rng.range(1.5, 4); }
        return this.finish(a, dt, a.speed, true);
      }
      case 'wait': {
        if (a.timer < 0) {
          a.timer = 0.25; // no need to look every frame
          if (this.mayCross(a.edge!, a)) { a.state = 'walk'; a.timer = this.rng.range(6, 18); }
        }
        break;
      }
      case 'idle':
        if (a.watching) { const P = g.player.worldPos; a.heading = dampAngle(a.heading, Math.atan2(P.x - a.x, P.z - a.z), 6, dt); }
        if (a.timer < 0) { a.watching = false; a.state = 'walk'; a.timer = this.rng.range(6, 18); }
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
        if (a.timer < 0) { const g0 = a.goal ?? a; this.scare(a, a.x - (g0.x - a.x), a.z - (g0.z - a.z), false); a.timer = 2.5; }
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
        // back to the nearest corner of this block; a spot across the road waits until nobody's looking
        if (a.anchor) {
          const here = this.blockOf(a.x, a.z), there = this.blockOf(a.anchor.x, a.anchor.z);
          if (here.bi !== there.bi || here.bj !== there.bj) {
            if (a.timer < 0 || !g.isVisible(a.x, 1, a.z)) { a.x = a.anchor.x; a.z = a.anchor.z; a.state = 'station'; }
            break;
          }
          tx = a.anchor.x; tz = a.anchor.z;
        } else {
          a.a = this.nearestCorner(a.x, a.z);
          const n = this.nodes[a.a];
          tx = n.x; tz = n.z;
        }
        speed = 1.8; collide = true;
        if (Math.hypot(tx - a.x, tz - a.z) < 0.8 || a.timer < 0) {
          if (a.anchor) { a.state = 'station'; }
          else { a.state = 'walk'; a.t = 0; a.edge = this.sidewalkEdge(a.a); a.b = a.edge.a === a.a ? a.edge.b : a.edge.a; a.lat = this.rng.range(-1, 1); }
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

  /** seconds of walk signal left on this crossing (0 = traffic may go); unlit crossings have no signal */
  private walkLeft(e: SEdge) {
    const c = e.cross!;
    const n = this.g.city.graph.nodes[c.node];
    if (!n.hasLight) return Infinity;
    return this.g.signals.redLeft(c.node, c.axis);
  }

  /** the kerb decision: the signal, then a look down the road */
  private mayCross(e: SEdge, a: Agent) {
    if (!e.cross) return true;
    const pace = Math.max(a.speed, CROSS_SPEED), need = e.len / pace;
    const left = this.walkLeft(e);
    const lit = left !== Infinity;
    if (lit && left < need + 0.5) return false;
    // how far off is every vehicle on this road, in seconds, not metres?
    const A = this.nodes[e.a], B = this.nodes[e.b];
    const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
    const alongZ = e.cross.axis === 'z';
    for (const v of this.moving) {
      const lateral = alongZ ? v.pos.x - mx : v.pos.z - mz;
      if (Math.abs(lateral) > ROAD_HALF + 2) continue;
      const d = alongZ ? mz - v.pos.z : mx - v.pos.x;
      const vel = alongZ ? v.vz : v.vx;
      if (d * vel <= 0) continue; // going away
      const t = Math.abs(d) / Math.max(Math.abs(vel), 0.1);
      // with a signal, traffic stops on its own: only cars too close to stop count. The player might not stop at all.
      const horizon = v.driver === 'player' || !lit ? need + 1 : 3;
      if (t < horizon) return false;
    }
    return true;
  }

  private sidewalkEdge(node: number): SEdge {
    const opts = this.nodes[node].edges.filter((e) => !e.cross);
    return this.rng.pick(opts.length ? opts : this.nodes[node].edges);
  }

  private nearestCorner(x: number, z: number) {
    const { bi, bj } = this.blockOf(x, z);
    const base = (bj * BLOCKS + bi) * 4;
    let best = base, bd = Infinity;
    for (let k = 0; k < 4; k++) {
      const n = this.nodes[base + k], d = Math.hypot(n.x - x, n.z - z);
      if (d < bd) { bd = d; best = base + k; }
    }
    return best;
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
    if (e.cross && !this.mayCross(e, a)) { a.state = 'wait'; a.timer = 0.25; }
    // sometimes duck into a building
    else if (a.role === 'walker' && this.rng.chance(0.06) && this.g.city.doors.length) {
      let best: { x: number; z: number } | null = null, bd = 30;
      const here = this.blockOf(a.x, a.z);
      for (const d of this.g.city.doors) {
        const dd = Math.hypot(d.x - a.x, d.z - a.z);
        if (dd >= bd) continue;
        const at = this.blockOf(d.x, d.z);
        if (at.bi === here.bi && at.bj === here.bj) { bd = dd; best = d; }
      }
      if (best) { a.state = 'toDoor'; a.goal = { x: best.x, z: best.z }; }
    }
  }

  private hide(a: Agent) {
    if (a.rig) a.rig.root.visible = false;
    if (a.dog) a.dog.visible = false;
  }

  private emerge(a: Agent) {
    const P = this.g.player.worldPos;
    let d = this.rng.pick(this.g.city.doors);
    for (let i = 0; i < 12 && Math.hypot(d.x - P.x, d.z - P.z) > 150; i++) d = this.rng.pick(this.g.city.doors);
    a.x = d.x; a.z = d.z; a.heading = d.heading;
    a.a = this.nearestCorner(d.x, d.z);
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
    this.stats.total = this.agents.filter((a) => !a.off).length;
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
    for (const b of this.bubbles) {
      if (b.t <= 0) continue;
      b.t -= 0.05;
      if (b.t <= 0 || !b.a || b.a.off) { b.t = 0; b.el.style.display = 'none'; continue; }
      this.v3.set(b.a.x, b.a.y + 2.25, b.a.z).project(cam);
      if (this.v3.z > 1) { b.el.style.display = 'none'; continue; }
      b.el.style.display = 'block';
      b.el.style.transform = `translate(${((this.v3.x * 0.5 + 0.5) * innerWidth) | 0}px, ${((-this.v3.y * 0.5 + 0.5) * innerHeight) | 0}px) translate(-50%, -100%)`;
    }
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
      a.a = this.nearestCorner(a.x, a.z);
      a.state = 'return'; a.timer = 20;
    }
    this.lodT = 0;
  }
}
