// Getaway driver: wait at the kerb while a crew robs the place, then get them to the
// drop with the police behind you. They ride in whatever car you're driving: swap cars
// and they run over and pile in. Scored on speed, damage and how fast you shook the heat.
import * as THREE from 'three';
import { RigCharacter, AnimState } from '../characters/rig';
import { makePedSkin } from '../characters/pedTypes';
import { Rng } from '../core/math';
import { districtAt } from '../map/districts';
import { kerbNear } from './route';
import type { Vehicle } from '../vehicles/vehicle';
import type { MissionCtx, MissionDef } from '../missions/types';
import type { District } from '../map/districts';
import type { Game } from '../core/game';

interface JobDef {
  id: string;
  title: string;
  giver: string;
  district: District;
  marker: { x: number; z: number };
  /** where the crew go in and come out */
  door: { x: number; z: number };
  drop: { x: number; z: number };
  pay: number;
  /** seconds a good driver takes to get to the drop */
  par: number;
  place: string;
  intro: string;
  unlock?: MissionDef['unlock'];
}

const JOBS: JobDef[] = [
  { id: 'getaway_gems', title: 'Diamond Dash', giver: 'Sal\'s crew', district: 'oldtown', marker: { x: -47, z: 9 }, door: { x: -28, z: 10 }, drop: { x: 112, z: 130 }, pay: 2500, par: 34, place: 'Gems & Co', intro: 'Sal\'s crew are hitting Gems & Co. Wait at the kerb with the engine running, then get them to the docks yard. You get paid for speed, a clean car and a quick escape.' },
  { id: 'getaway_docks', title: 'Payroll Run', giver: 'Harbour crew', district: 'docks', marker: { x: 210, z: 65 }, door: { x: 214, z: 64 }, drop: { x: -112, z: -168 }, pay: 3500, par: 48, place: 'the payroll office', intro: 'It\'s pay day at the docks. The crew walk in, you bring them out across the whole city. Long drive, plenty of time to pick up a tail.' },
  { id: 'getaway_tower', title: 'The Vantage Job', giver: 'A nervous banker', district: 'downtown', marker: { x: 12, z: 9 }, door: { x: 28, z: 13.5 }, drop: { x: -280, z: 168 }, pay: 6000, par: 52, place: 'Vantage Tower', intro: 'The lead you got from tailing the courier: a safe deposit run at Vantage Tower. The biggest job in town, in the busiest part of it.', unlock: { missions: ['tail_courier'], hint: 'You need a lead: tail the courier in Old Town' } },
];

type CrewState = 'waiting' | 'toDoor' | 'inside' | 'run' | 'seated';
interface Crew { rig: RigCharacter; state: CrewState; seat: [number, number]; pos: THREE.Vector3; cheer: number; car: Vehicle | null; }

const INSIDE_S = 9, ALARM_AT = 5;
const LINES = {
  impact: ['WATCH THE PAINT!', 'I SAID DRIVE, NOT CRASH!', 'MY NECK!', 'WHO TAUGHT YOU THIS?'],
  fast: ['GO GO GO!', 'THAT\'S IT, FLOOR IT!', 'OH, WE\'RE FLYING!'],
  chased: ['THEY\'RE RIGHT BEHIND US!', 'LOSE THEM, LOSE THEM!', 'SIRENS! LEFT, GO LEFT!'],
  lost: ['WE LOST THEM!', 'HA! TOO SLOW!', 'ALL CLEAR. BREATHE.'],
  swap: ['NEW CAR? FINE, MOVE OVER!'],
};

export class GetawayJob {
  def: JobDef | null = null;
  crew: Crew[] = [];
  pickup = new THREE.Vector3();
  private doorPt = new THREE.Vector3();
  private dropPt = new THREE.Vector3();
  private parked = false;
  private insideT = 0;
  private alarmed = false;
  private rng = new Rng(3131);
  private sayT = 0;
  private boardT = 0;
  private hpLost = 0;
  private lastCar: Vehicle | null = null;
  private lastHp = 0;
  private lostAt = -1;
  private wasHot = false;
  private score: { total: number; rank: string; time: number; hp: number; heat: number } | null = null;

  constructor(private g: Game) {}

  get aboard() {
    return this.crew.length > 0 && this.crew.every((c) => c.state === 'seated') && this.crew[0].car === this.g.player.vehicle && !!this.g.player.vehicle;
  }
  get robbing() { return this.parked && this.insideT > 0; }
  get robT() { return this.insideT; }
  get isParked() { return this.parked; }
  get dropTarget() { return this.dropPt; }
  get result() { return this.score; }
  get strandedSub() {
    const v = this.g.player.vehicle;
    if (!v) return 'Get back in a car. The crew are waiting';
    if (v.two) return 'They won\'t fit on that. Find a car';
    return 'Hold still while they pile in';
  }

  begin(c: MissionCtx, d: JobDef) {
    const g = this.g;
    this.def = d;
    this.parked = this.alarmed = false;
    this.insideT = this.hpLost = 0;
    this.lastCar = null;
    this.lostAt = -1;
    this.wasHot = false;
    this.score = null;
    this.doorPt.set(d.door.x, 0.15, d.door.z);
    this.dropPt.set(d.drop.x, 1, d.drop.z);
    const k = kerbNear(g, d.door.x, d.door.z);
    this.pickup.set(k.x, 1, k.z);
    // the crew's car, waiting a little way back
    const bx = k.x - Math.sin(k.heading) * 24, bz = k.z - Math.cos(k.heading) * 24;
    c.spawnVehicle('sedan', bx, bz, k.heading, '#4a4c52').locked = false;
    this.crew = [0, 1].map((i) => {
      const rig = new RigCharacter({ ...makePedSkin('local', this.rng), top: i ? '#23283a' : '#2c2e3c', pants: '#1e1e20', key: `crew${i}` });
      const pos = new THREE.Vector3(d.door.x + (i ? 2.4 : -2.4), 0.15, d.door.z - Math.sign(d.door.z - k.z) * -1.6);
      rig.root.position.copy(pos);
      g.scene.add(rig.root);
      return { rig, state: 'waiting' as CrewState, seat: (i ? [-0.42, -0.2] : [0.42, -1.05]) as [number, number], pos, cheer: 0, car: null };
    });
  }

  end() {
    const g = this.g;
    for (const c of this.crew) c.rig.root.parent?.remove(c.rig.root);
    this.crew = [];
    this.def = null;
    void g;
  }

  private say(kind: keyof typeof LINES, force = false) {
    if (this.sayT > 0 && !force) return;
    this.sayT = 7;
    const l = LINES[kind];
    this.g.hud.say('CREW', l[this.rng.int(0, l.length - 1)]);
  }

  private seat(c: Crew, v: Vehicle) {
    const d = v.parts.dims;
    c.rig.root.parent?.remove(c.rig.root);
    v.object.add(c.rig.root);
    c.rig.root.position.set(c.seat[0], d.seatY, d.seatZ + c.seat[1]);
    c.rig.root.rotation.set(0, 0, 0);
    c.state = 'seated';
    c.car = v;
    this.g.audio.door();
  }

  private unseat(c: Crew) {
    if (!c.car) return;
    const v = c.car;
    c.pos.set(v.pos.x + Math.cos(v.heading) * 1.8, 0.15, v.pos.z - Math.sin(v.heading) * 1.8);
    c.rig.root.parent?.remove(c.rig.root);
    this.g.scene.add(c.rig.root);
    c.rig.root.rotation.set(0, 0, 0);
    c.state = 'run';
    c.car = null;
  }

  update(dt: number) {
    const g = this.g, d = this.def;
    if (!d) return;
    this.sayT -= dt;
    const pv = g.player.vehicle;
    const car = pv && !pv.two ? pv : null;

    // pulled up?
    if (!this.parked && car && Math.hypot(car.pos.x - this.pickup.x, car.pos.z - this.pickup.z) < 7 && car.speedAbs < 3) {
      this.parked = true;
      this.insideT = INSIDE_S;
      for (const c of this.crew) c.state = 'toDoor';
      g.hud.say('CREW', `Keep it running. We're going into ${d.place}.`);
    }
    if (this.parked && this.insideT > 0) {
      this.insideT -= dt;
      if (!this.alarmed && this.insideT < INSIDE_S - ALARM_AT) {
        this.alarmed = true;
        g.audio.alarmBell(10);
        g.peds.panic(this.doorPt, 22, true);
        g.news.report(d.id === 'getaway_gems' ? 'store' : 'witness', this.doorPt.x, this.doorPt.z);
        g.police.crime(2, `alarm at ${d.place}`);
      }
      if (this.insideT <= 0) {
        for (const c of this.crew) { c.state = 'run'; c.pos.copy(this.doorPt); c.rig.root.visible = true; }
        g.hud.say('CREW', 'GOT IT! OPEN THE DOOR!');
        g.fx.spawn('money', this.doorPt.clone().setY(1.2), 12);
      }
    }

    for (const c of this.crew) {
      let anim: AnimState = 'idle';
      if (c.state === 'toDoor') {
        const dx = this.doorPt.x - c.pos.x, dz = this.doorPt.z - c.pos.z, L = Math.hypot(dx, dz);
        if (L < 0.6) { c.state = 'inside'; c.rig.root.visible = false; }
        else { c.pos.x += (dx / L) * 2.2 * dt; c.pos.z += (dz / L) * 2.2 * dt; c.rig.root.rotation.y = Math.atan2(dx, dz); anim = 'walk'; }
      } else if (c.state === 'run') {
        if (car) {
          const dx = car.pos.x - c.pos.x, dz = car.pos.z - c.pos.z, L = Math.hypot(dx, dz);
          if (L < 3.4 && car.speedAbs < 4) { this.seat(c, car); if (this.crew.every((q) => q.state === 'seated')) this.onBoard(car); continue; }
          c.pos.x += (dx / L) * 5.6 * dt;
          c.pos.z += (dz / L) * 5.6 * dt;
          c.rig.root.rotation.y = Math.atan2(dx, dz);
          anim = 'run';
        }
      } else if (c.state === 'seated') {
        // swapped cars: everybody out and over to the new one
        if (car && c.car !== car) { this.unseat(c); this.say('swap', true); continue; }
        c.cheer -= dt;
        anim = c.cheer > 0 ? 'handsup' : 'drive';
      }
      if (c.state === 'seated') c.rig.update(dt, anim, 0);
      else if (c.state !== 'inside') {
        c.rig.root.position.copy(c.pos);
        c.rig.update(dt, anim, anim === 'run' ? 5.6 : anim === 'walk' ? 2.2 : 0);
      }
    }

    // on the road: score and reactions
    if (this.aboard && pv) {
      if (this.lastCar !== pv) { this.lastCar = pv; this.lastHp = pv.hp; }
      if (pv.hp < this.lastHp) {
        const lost = this.lastHp - pv.hp;
        this.hpLost += lost;
        this.lastHp = pv.hp;
        if (lost > 4) { this.say('impact', true); for (const c of this.crew) c.cheer = 0.9; }
      }
      const hot = g.police.heat > 0 && g.police.lastSeenT < 3;
      if (hot) { this.wasHot = true; if (this.rng.next() < dt * 0.15) this.say('chased'); }
      else if (this.wasHot && this.lostAt < 0 && g.police.lastSeenT > 5) {
        this.lostAt = g.time - this.boardT;
        this.say('lost', true);
        for (const c of this.crew) c.cheer = 2;
      }
      if (pv.speedAbs > 26 && this.rng.next() < dt * 0.1) this.say('fast');
    }
  }

  private onBoard(car: Vehicle) {
    const g = this.g;
    this.boardT = g.time;
    this.lastCar = car;
    this.lastHp = car.hp;
    if (g.police.heat === 0) g.police.crime(2, 'getaway spotted');
  }

  /** at the drop, with nobody watching */
  arrived() {
    const g = this.g;
    if (!this.aboard) return false;
    const P = g.player.worldPos;
    if (Math.hypot(P.x - this.dropPt.x, P.z - this.dropPt.z) > 11) return false;
    if (g.police.heat > 0 && g.police.lastSeenT < 2.5) return false;
    this.scoreRun();
    return true;
  }

  get nearDropHot() {
    const P = this.g.player.worldPos;
    return Math.hypot(P.x - this.dropPt.x, P.z - this.dropPt.z) < 40 && this.g.police.heat > 0 && this.g.police.lastSeenT < 2.5;
  }

  private scoreRun() {
    const d = this.def!, g = this.g;
    const time = g.time - this.boardT;
    const speed = Math.max(0, Math.min(40, 40 * (1 - (time - d.par) / (d.par * 1.5))));
    const clean = Math.max(0, 30 * (1 - this.hpLost / 60));
    const heatT = this.lostAt < 0 ? (this.wasHot ? time : 0) : this.lostAt;
    const escape = Math.max(0, Math.min(30, 30 * (1 - heatT / (d.par * 1.2))));
    const total = Math.round(speed + clean + escape);
    this.score = { total, rank: total >= 85 ? 'S' : total >= 65 ? 'A' : total >= 45 ? 'B' : 'C', time, hp: this.hpLost, heat: heatT };
    const P = g.player.worldPos;
    g.rep.add(districtAt(P.x, P.z), 3);
  }

  get payout() {
    const d = this.def, s = this.score;
    if (!d || !s) return 0;
    return Math.round(d.pay * (0.5 + s.total / 100));
  }

  summary(): [string, string][] {
    const s = this.score;
    if (!s) return [];
    return [['RATING', `${s.rank} (${s.total}/100)`], ['DRIVE TIME', `${s.time.toFixed(1)}s`], ['DAMAGE', `${Math.round(s.hp)}`], ['HEAT LOST IN', s.heat ? `${s.heat.toFixed(1)}s` : 'NEVER HOT']];
  }
}

function mission(d: JobDef): MissionDef {
  return {
    id: d.id,
    title: d.title,
    giver: d.giver,
    district: d.district,
    type: 'getaway',
    icon: 'getaway',
    marker: { ...d.marker },
    intro: d.intro,
    unlock: d.unlock,
    replay: true,
    reward: { cash: (c) => c.g.getaway.payout, reputation: 10, label: 'Your cut' },
    setup: (c) => c.g.getaway.begin(c, d),
    cleanup: (c) => c.g.getaway.end(),
    summary: (c) => c.g.getaway.summary(),
    steps: [
      {
        id: 'car',
        text: 'Pull up at the kerb',
        sub: `The crew's car is just behind the beam, outside ${d.place}. Any car will do`,
        target: (c) => c.g.getaway.pickup,
        done: (c) => c.g.getaway.isParked,
      },
      {
        id: 'wait',
        text: 'Keep the engine running',
        sub: (c) => `Crew inside ${d.place}: ${Math.ceil(c.g.getaway.robT)}s. Then they come out fast`,
        target: (c) => c.g.getaway.pickup,
        done: (c) => !c.g.getaway.robbing,
      },
      {
        id: 'board',
        text: 'Get the crew in the car',
        sub: (c) => c.g.getaway.strandedSub,
        done: (c) => c.g.getaway.aboard,
      },
      {
        id: 'drive',
        text: (c) => (c.g.getaway.aboard ? 'Drive them to the drop' : 'Pick the crew back up'),
        sub: (c) => (!c.g.getaway.aboard ? c.g.getaway.strandedSub : c.g.getaway.nearDropHot ? 'Not with them watching. Shake the police first' : 'Fast, clean, and lose the heat. All three pay'),
        target: (c) => c.g.getaway.dropTarget,
        done: (c) => c.g.getaway.arrived(),
      },
    ],
  };
}

export const GETAWAY_MISSIONS = JOBS.map(mission);
