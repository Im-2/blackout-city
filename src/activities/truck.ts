// Armored truck intercept: a cash truck drives a visible route. It ignores the normal
// lights, but it will stop for a hacked red or a raised barrier, so you choose the
// junction. Crack the rear door before the police arrive, grab the crates, lose the heat.
import * as THREE from 'three';
import { Vehicle } from '../vehicles/vehicle';
import { GeoBuilder } from '../world/geo';
import { worldMaterials } from '../world/materials';
import { basicMat } from '../render/patch';
import { Route, buildRoute, expandCorners, followRoute, gapAhead } from './route';
import type { AABB } from '../world/collision';
import type { Hackable } from '../hacking/hack';
import type { Interactable } from '../player/player';
import type { MissionDef } from '../missions/types';
import type { Game } from '../core/game';

const ROUTES: [number, number][][] = [
  [[4, 3], [8, 3], [8, 7], [4, 7], [4, 3]],
  [[9, 2], [9, 7], [5, 7], [5, 2], [9, 2]],
  [[3, 1], [7, 1], [7, 5], [3, 5], [3, 1]],
  [[2, 4], [6, 4], [6, 7], [2, 7], [2, 4]],
];
const CRUISE = 11.5;
const STOP_HOLD = 26; // how long the driver sits tight before pushing on
const POLICE_AFTER = 38; // dispatch gets a call this long after it stops
const BASE_PAY = 6000;

interface Barrier { node: number; mesh: THREE.Object3D; col: AABB; up: number; }

export class TruckJob {
  truck: Vehicle | null = null;
  route: Route | null = null;
  idx = 0;
  stopped = false;
  cracked = false;
  grabbed = false;
  finished = false;
  holdT = 0;
  policeT = 0;
  private group = new THREE.Group();
  private barriers: Barrier[] = [];
  private hacks: Hackable[] = [];
  private inter: Interactable[] = [];
  private rear = new THREE.Vector3();
  private routeI = -1;
  private escapeT = 0;
  private startT = 0;
  stoppedAtRed = false;

  constructor(private g: Game) {
    g.scene.add(this.group);
  }

  get pay() { return BASE_PAY + (this.g.save.data.completed.tail_banker ? 3000 : 0); }
  get rearPoint() { return this.rear; }
  get truckPos() { return this.truck ? new THREE.Vector3(this.truck.pos.x, 1, this.truck.pos.z) : null; }

  begin() {
    const g = this.g;
    this.finished = this.stopped = this.cracked = this.grabbed = false;
    this.holdT = this.policeT = this.escapeT = 0;
    this.startT = g.time;
    // a different route each attempt, joined out of sight
    this.routeI = (this.routeI + 1 + Math.floor(Math.random() * (ROUTES.length - 1))) % ROUTES.length;
    const route = (this.route = buildRoute(g, expandCorners(ROUTES[this.routeI], false)));
    const P = g.player.worldPos;
    let start = 0, best = Infinity;
    for (let i = 0; i < route.pts.length * 0.5; i++) {
      const d = Math.abs(Math.hypot(route.pts[i].x - P.x, route.pts[i].z - P.z) - 130);
      if (d < best) { best = d; start = i; }
    }
    this.idx = start;
    const a = route.pts[start], b = route.pts[start + 1];
    const v = new Vehicle('swat', '#3a3e44', g.col);
    v.isCop = false;
    v.isEmergency = false;
    v.driver = 'racer';
    v.maxHp = v.hp = 9000;
    v.place(a.x, a.z, Math.atan2(b.x - a.x, b.z - a.z));
    g.addVehicle(v);
    this.truck = v;
    // a gold stripe says "cash in transit"
    const d = v.parts.dims;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(d.wid + 0.06, 0.28, d.len * 0.82), basicMat({ color: '#e6c84a' }));
    stripe.position.set(0, d.h * 0.55, -0.1);
    v.object.add(stripe);
    g.routeLine = route.pts.slice(start);
    this.buildBarriers(route, start);
    const rearAct: Interactable = {
      pos: this.rear, radius: 3.2, label: 'Crack the rear door', enabled: () => this.stopped && !this.cracked && !g.minigame.active && !g.player.vehicle,
      action: () => this.crack(),
    };
    const lootAct: Interactable = {
      pos: this.rear, radius: 3.4, label: 'Grab the cash crates', enabled: () => this.cracked && !this.grabbed && !g.player.vehicle,
      action: () => this.grab(),
    };
    this.inter = [rearAct, lootAct];
    g.interactables.push(...this.inter);
  }

  /** two road barriers on junctions further along the route */
  private buildBarriers(route: Route, start: number) {
    const g = this.g;
    const ahead = route.stops.filter((s) => s.idx > start + 15);
    for (const k of [1, 3]) {
      const s = ahead[k];
      if (!s) continue;
      const p = route.pts[s.idx], q = route.pts[Math.max(0, s.idx - 1)];
      const heading = Math.atan2(p.x - q.x, p.z - q.z);
      const rx = Math.cos(heading), rz = -Math.sin(heading);
      const b = new GeoBuilder();
      // posts on the kerb, a striped boom across both lanes, drawn raised then lowered
      const group = new THREE.Group();
      for (let i = -2; i <= 2; i++) b.cbox(i * 1.3, 0, 0, 1.25, 0.28, 0.2, { color: i % 2 ? '#d8782a' : '#e6e0d4' });
      const boom = new THREE.Mesh(b.build(), worldMaterials().props);
      boom.position.set(p.x + rx * -2.6, 6, p.z + rz * -2.6);
      boom.rotation.y = heading;
      group.add(boom);
      this.group.add(group);
      const cx = p.x - rx * 2.6, cz = p.z - rz * 2.6;
      const col = g.col.add(cx - Math.abs(rx) * 3.6 - 0.2, 0, cz - Math.abs(rz) * 3.6 - 0.2, cx + Math.abs(rx) * 3.6 + 0.2, 1.4, cz + Math.abs(rz) * 3.6 + 0.2, false, 'barrier');
      col.enabled = false;
      const bar: Barrier = { node: s.node, mesh: boom, col, up: 0 };
      this.barriers.push(bar);
      const h: Hackable = {
        kind: 'barrier', label: 'Road barrier', pos: new THREE.Vector3(cx, 3, cz), size: new THREE.Vector3(Math.abs(rx) * 7 + 1, 2, Math.abs(rz) * 7 + 1), range: 60,
        available: () => bar.up <= 0,
        act: () => { bar.up = 30; return 'ROAD BARRIER DOWN'; },
      };
      this.hacks.push(h);
      g.hack.hackables.push(h);
    }
  }

  /** the mission ended, however it ended */
  end() {
    const g = this.g;
    if (this.truck) g.removeVehicle(this.truck);
    this.truck = null;
    this.route = null;
    g.routeLine = null;
    g.hack.hackables = g.hack.hackables.filter((h) => !this.hacks.includes(h));
    for (const i of this.inter) { const k = g.interactables.indexOf(i); if (k >= 0) g.interactables.splice(k, 1); }
    for (const b of this.barriers) g.col.remove(b.col);
    this.group.clear();
    this.barriers = [];
    this.hacks = [];
    this.inter = [];
    if (g.minigame.active) g.minigame.cancel();
  }

  private crack() {
    const g = this.g;
    g.peds.witnessCrime(this.rear, 'armored truck', 1);
    g.minigame.open({
      title: 'REAR DOOR: HIT THE GREEN', hits: 4, time: 16, speed: 1.3, zone: 0.16,
      onWin: () => {
        this.cracked = true;
        g.audio.unlock();
        g.fx.spawn('spark', this.rear.clone().setY(1.5), 24);
        g.hud.toast('REAR DOOR OPEN', 'win');
      },
      onFail: () => {
        g.hud.toast('LOCKOUT ALARM — POLICE ON THE WAY', 'heat');
        g.audio.alarmBell(8);
        this.policeT = Math.max(this.policeT, POLICE_AFTER);
      },
    });
  }

  private grab() {
    const g = this.g;
    this.grabbed = true;
    g.fx.spawn('money', this.rear.clone().setY(1.5), 30);
    g.audio.loot();
    g.hud.toast(`CASH CRATES — WORTH $${this.pay.toLocaleString()} IF YOU GET AWAY`, 'win');
    g.police.crime(Math.max(3, g.police.heat), 'armored truck hit');
    g.news.report('witness', this.rear.x, this.rear.z);
    g.rep.add('downtown', 5);
    this.escapeT = 14;
  }

  private blocked(s: { node: number; axis: 'x' | 'z' }) {
    const g = this.g;
    const sig = g.signals.nodes[s.node];
    if (sig?.override && g.signals.state(s.node, s.axis) === 'red') return true;
    return this.barriers.some((b) => b.node === s.node && b.up > 0);
  }

  update(dt: number) {
    const g = this.g, v = this.truck;
    if (!v || !this.route) return;
    const r = this.route;
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    this.rear.set(v.pos.x - fx * (v.parts.dims.len / 2 + 1.1), 0.15, v.pos.z - fz * (v.parts.dims.len / 2 + 1.1));
    v.hp = 9000;
    for (const b of this.barriers) {
      b.up = Math.max(0, b.up - dt);
      const on = b.up > 0;
      b.col.enabled = on;
      b.mesh.position.y += ((on ? 1.0 : 6) - b.mesh.position.y) * Math.min(1, dt * 5);
    }
    // heat keeps climbing for a while after the grab
    if (this.grabbed && this.escapeT > 0) {
      this.escapeT -= dt;
      if (this.escapeT <= 0 && g.police.heat > 0 && g.police.heat < 4 && g.police.lastSeenT < 4) { g.police.setHeat(g.police.heat + 1, 'armored car alert'); this.escapeT = 18; }
    }
    if (this.stopped || this.cracked) {
      this.policeT -= dt;
      if (this.policeT <= 0 && !this.grabbed && g.police.heat === 0) {
        g.police.crime(2, 'armored truck stopped');
        g.hud.toast('DISPATCH CALLED IT IN', 'heat');
      }
    }
    if (this.stopped) {
      v.throttle = 0;
      v.steer = 0;
      v.handbrake = true;
      if (this.cracked || g.minigame.active) return;
      this.holdT -= dt;
      if (this.holdT <= 0) {
        this.stopped = false;
        g.hud.toast('THE TRUCK IS MOVING AGAIN', 'heat');
      }
      return;
    }
    // next junction, and can it go through?
    const next = r.stops.find((s) => s.idx >= this.idx);
    let want = CRUISE;
    const curve = next && r.arc[next.idx] - r.arc[this.idx];
    if (next && curve !== undefined && curve < 28 && this.blocked(next)) {
      want = Math.max(0, (curve - 2.5) * 0.7);
      if (curve < 7 && v.speedAbs < 1) {
        this.stopped = true;
        this.holdT = STOP_HOLD;
        if (this.policeT <= 0) this.policeT = POLICE_AFTER;
        g.hud.toast('TRUCK STOPPED — GET TO THE REAR DOOR', 'win');
        g.audio.horn(v.pos);
        return;
      }
    }
    const gap = gapAhead(g, v);
    want = Math.min(want, Math.max(0, (gap - 2) * 0.9));
    this.idx = followRoute(v, r, this.idx, want);
    if (this.idx >= r.pts.length - 2) this.finished = true;
  }

  /** how long you've had the truck in hand: a faster job pays a little more */
  get bonus() {
    const t = this.g.time - this.startT;
    return t < 90 ? 1500 : t < 150 ? 500 : 0;
  }
}

export const TRUCK_MISSION: MissionDef = {
  id: 'truck_intercept',
  title: 'Cash in Transit',
  giver: 'The Crew',
  district: 'downtown',
  type: 'intercept',
  icon: 'truck',
  marker: { x: 28, z: -102.5, heading: Math.PI / 2 },
  intro: 'An armored truck is on its round. It runs normal lights, but not a hacked red. Pick your junction, stop it, crack the back and get lost. Different route every time.',
  replay: true,
  reward: { cash: (c) => c.g.truck.pay + c.g.truck.bonus, reputation: 15, label: 'Crates' },
  setup: (c) => c.g.truck.begin(),
  cleanup: (c) => c.g.truck.end(),
  failIf: (c) => (c.g.truck.finished && !c.g.truck.grabbed ? 'The truck reached the depot' : null),
  summary: (c) => [['SPEED BONUS', `$${c.g.truck.bonus.toLocaleString()}`], ['HEAT PEAK', `${'★'.repeat(c.g.police.peak)}${'☆'.repeat(5 - c.g.police.peak)}`]],
  steps: [
    {
      id: 'find',
      text: 'Catch up with the armored truck',
      sub: 'Its route is on the map. Get ahead of it',
      target: (c) => c.g.truck.truckPos,
      done: (c) => { const t = c.g.truck.truck; return !!t && (c.g.truck.stopped || Math.hypot(t.pos.x - c.g.player.worldPos.x, t.pos.z - c.g.player.worldPos.z) < 60); },
    },
    {
      id: 'stop',
      text: 'Stop it at a junction',
      sub: 'Hold Q: right-click a light ahead for ALL RED, or drop a road barrier',
      target: (c) => c.g.truck.truckPos,
      done: (c) => c.g.truck.stopped,
    },
    {
      id: 'crack',
      text: (c) => (c.g.truck.stopped ? 'Crack the rear door' : 'It\'s moving: stop it again'),
      sub: (c) => (c.g.truck.policeT > 0 && c.g.police.heat === 0 ? `Police in ${Math.ceil(c.g.truck.policeT)}s` : 'They\'re here. Be quick'),
      target: (c) => c.g.truck.rearPoint,
      done: (c) => c.g.truck.cracked,
    },
    {
      id: 'grab',
      text: 'Grab the cash crates',
      sub: 'At the rear door',
      target: (c) => c.g.truck.rearPoint,
      done: (c) => c.g.truck.grabbed,
    },
    {
      id: 'escape',
      text: 'Lose the police',
      sub: (c) => `Heat ${c.g.police.heat}. Break line of sight, hack, change your look`,
      done: (c) => c.g.police.heat === 0,
    },
  ],
};
