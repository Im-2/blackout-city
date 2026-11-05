// Jobs on the water: a smuggling run, a jet ski race and a dock heist with an escape
// by boat. All ordinary missions, so markers, map, GPS, fail and retry come for free.
import * as THREE from 'three';
import { Vehicle } from '../vehicles/vehicle';
import { Rng, clamp } from '../core/math';
import { steerTo } from '../ai/traffic';
import { CHANNEL, HALF, LAGOON } from '../world/layout';
import { CARGO_PIER, EAST_PIER } from '../world/waterfront';
import type { MissionCtx, MissionDef, MissionStep } from '../missions/types';
import type { Interactable } from '../player/player';
import type { Game } from '../core/game';

const v3 = (x: number, z: number) => new THREE.Vector3(x, 0, z);
const QUAY = { x: (LAGOON.x0 + LAGOON.x1) / 2, z: LAGOON.z0 - 1.4 };
const onBoat = (c: MissionCtx) => !!c.g.player.vehicle?.boat;
const sank = (c: MissionCtx) => (c.g.player.vehicle?.sunk ? 'You sank' : null);

// ------------------------------------------------------------------ the race
/** in, out of the lagoon, under the bridge, round the bay and home */
const COURSE: [number, number][] = [
  [-28, 308], [-28, 336], [-28, 362], [60, 395], [180, 420], [300, 405], [395, 360], [420, 260], [395, 215], [300, 380], [150, 395], [20, 375], [-28, 355], [-28, 336], [-28, 305],
];
const CP_RADIUS = 13;
const RIVAL_NAMES = ['MARLIN', 'PIKE', 'SKATE'];

interface Rival { v: Vehicle; idx: number; name: string; done: number; skill: number; stuck: number; }

export class WaterRace {
  rivals: Rival[] = [];
  count = 0;
  t = 0;
  cp = 0;
  private rng = new Rng(9090);
  constructor(private g: Game) {}

  get frozen() { return this.count > 0; }

  begin(c: MissionCtx) {
    const g = this.g;
    this.cp = 0;
    this.t = 0;
    this.count = 4;
    const heading = Math.PI;
    for (let i = 0; i < 3; i++) {
      const v = new Vehicle('jetski', ['#3f7b88', '#c4a03c', '#7a1c1c'][i], g.col);
      v.place(-36 + i * 8, 316, heading);
      v.driver = 'racer';
      v.handbrake = true;
      g.addVehicle(v);
      this.rivals.push({ v, idx: 0, name: RIVAL_NAMES[i], done: 0, skill: [0.97, 0.93, 0.88][i], stuck: 0 });
    }
    const pv = c.spawnVehicle('jetski', -28, 321, heading, '#e0322a');
    g.player.spawn(-28, 321, heading);
    g.player.enterVehicle(pv);
    g.camRig.snapBehind(heading);
  }

  end() {
    const g = this.g;
    for (const r of this.rivals) { r.v.driver = 'none'; g.removeVehicle(r.v); }
    this.rivals = [];
  }

  /** where you stand: rivals past your checkpoint, and level ones nearer the next */
  get position() {
    const P = this.g.player.worldPos;
    const [nx, nz] = COURSE[Math.min(this.cp, COURSE.length - 1)];
    const mine = Math.hypot(nx - P.x, nz - P.z);
    return 1 + this.rivals.filter((r) => r.done || r.idx > this.cp || (r.idx === this.cp && Math.hypot(nx - r.v.pos.x, nz - r.v.pos.z) < mine)).length;
  }

  prize() {
    return Math.round(1600 * [1, 0.4, 0.15, 0][this.finishPos - 1]);
  }
  finishPos = 4;

  update(dt: number) {
    const g = this.g;
    if (!this.rivals.length) return;
    if (this.count > 0) {
      const before = Math.ceil(this.count);
      this.count -= dt;
      const n = Math.ceil(this.count);
      if (n !== before && n > 0 && n <= 3) { g.audio.pop(); g.hud.toast(String(n), 'hack'); }
      if (this.count <= 0) { g.audio.missionStart(); g.hud.toast('GO!', 'win'); }
      for (const r of this.rivals) { r.v.throttle = 0; r.v.steer = 0; r.v.handbrake = true; }
      const pv = g.player.vehicle;
      if (pv) { pv.throttle = 0; pv.vx = pv.vz = 0; }
      return;
    }
    this.t += dt;
    for (const r of this.rivals) {
      const v = r.v;
      v.handbrake = false;
      if (r.idx >= COURSE.length) { v.throttle = v.speed > 2 ? -0.5 : 0; continue; }
      const [tx, tz] = COURSE[r.idx];
      if (Math.hypot(tx - v.pos.x, tz - v.pos.z) < CP_RADIUS * 0.8) { r.idx++; if (r.idx >= COURSE.length) { r.done = this.t; g.hud.toast(`${r.name} FINISHED`, 'dim'); continue; } }
      const { steer, diff } = steerTo(v, tx, tz, 2.6);
      v.steer = steer;
      // a loose rubber band, far from the finish only
      const lead = r.idx - this.cp;
      const band = r.idx < COURSE.length - 3 ? (lead > 1 ? 0.9 : lead < -1 ? 1.08 : 1) : 1;
      const want = (Math.abs(diff) > 0.7 ? 14 : v.p.maxSpeed) * r.skill * band;
      v.throttle = clamp((want - v.speed) * 0.5, -1, 1);
      r.stuck = v.throttle > 0.4 && v.speedAbs < 1 ? r.stuck + dt : 0;
      if (r.stuck > 2.5) { v.place(tx - Math.sign(tx - v.pos.x) * 12, tz - Math.sign(tz - v.pos.z) * 12, Math.atan2(tx - v.pos.x, tz - v.pos.z)); r.stuck = 0; }
    }
  }
}

const ord = (n: number) => ['1st', '2nd', '3rd', '4th'][n - 1] ?? `${n}th`;

const raceSteps = (): MissionStep[] => [
  { id: 'grid', text: 'Wait for the horn', sub: 'Jet skis fit under the bridge. Beat at least one rival', target: () => v3(COURSE[0][0], COURSE[0][1]), done: (c) => !c.g.waterRace.frozen },
  ...COURSE.map(([x, z], i): MissionStep => ({
    id: `cp${i}`,
    text: i === COURSE.length - 1 ? 'Finish line!' : `Buoy ${i + 1} of ${COURSE.length}`,
    sub: (c) => `Running ${ord(c.g.waterRace.position).toLowerCase()}`,
    target: () => v3(x, z),
    reach: CP_RADIUS,
    enter: (c) => { c.g.waterRace.cp = i; },
  })),
];

export const JETSKI_RACE: MissionDef = {
  id: 'race_harbour', title: 'Harbour Dash', giver: 'The Marina Rats', district: 'park', type: 'race',
  marker: { x: QUAY.x + 8, z: QUAY.z, heading: Math.PI },
  intro: 'Jet skis, $1,600 to the winner. Out of the lagoon, under the bridge, round the bay and back. Hit the buoys and don\'t hit the piers.',
  replay: true,
  reward: { cash: (c) => { const r = c.g.waterRace; r.finishPos = r.position; return r.prize(); }, reputation: 10, label: 'Prize' },
  setup: (c) => c.g.waterRace.begin(c),
  cleanup: (c) => c.g.waterRace.end(),
  summary: (c) => [['FINISHED', ord(c.g.waterRace.finishPos)], ['TIME', `${c.g.waterRace.t.toFixed(1)}s`]],
  failIf: (c) => {
    if (c.g.player.vehicle?.sunk) return 'You sank';
    const r = c.g.waterRace;
    return r.rivals.length && r.rivals.every((x) => x.done && r.t - x.done > 25) ? 'They all went home' : null;
  },
  steps: raceSteps(),
};

// ------------------------------------------------------------------ smuggling
const DROP_BUOY = v3(250, 425), HANDOFF = v3(EAST_PIER.x1 + 8, (EAST_PIER.z0 + EAST_PIER.z1) / 2);

export const SMUGGLING_RUN: MissionDef = {
  id: 'smuggle_run', title: 'Low Tide', giver: 'A man called Salt', district: 'park', type: 'water',
  marker: { x: QUAY.x - 8, z: QUAY.z, heading: Math.PI },
  intro: 'Someone dropped crates off a freighter last night and tied a buoy to them. Take a speedboat out, pick them up and bring them round to the end of the docks pier. The police launches will come looking.',
  replay: true,
  timeLimit: 210,
  reward: { cash: 3000, reputation: 12, label: 'Salt\'s cut' },
  setup: (c) => { c.spawnVehicle('speedboat', QUAY.x - 4, LAGOON.z0 + 7, Math.PI, '#e6dcc0').locked = false; },
  failIf: sank,
  steps: [
    { id: 'board', text: 'Get in the speedboat', sub: 'At the quay', target: (c) => c.g.player.vehicle ? null : v3(QUAY.x - 4, LAGOON.z0 + 4), done: onBoat },
    { id: 'gate', text: 'Get out to the bay', sub: 'A speedboat won\'t fit under the bridge. Hack it, or find another way', target: () => v3((CHANNEL.x0 + CHANNEL.x1) / 2, HALF + 18), reach: 16 },
    { id: 'crates', text: 'Pick up the crates', sub: 'Slow down at the buoy', target: () => DROP_BUOY, done: (c) => onBoat(c) && c.g.player.worldPos.distanceTo(DROP_BUOY) < 14 && c.g.player.vehicle!.speedAbs < 12 },
    { id: 'run', text: 'Bring them to the docks pier', sub: 'Police launches at heat 3. Outrun them', target: () => HANDOFF, reach: 14, enter: (c) => { c.g.audio.loot(); c.g.hud.toast('CRATES ABOARD', 'win'); c.g.police.crime(3, 'smuggling'); } },
  ],
};

// ------------------------------------------------------------------ the dock heist
const CONTAINER = new THREE.Vector3(CARGO_PIER.x1 - 7, CARGO_PIER.h, (CARGO_PIER.z0 + CARGO_PIER.z1) / 2);

export class DockHeist {
  cracked = false;
  private act: Interactable | null = null;
  private crate: THREE.Mesh | null = null;
  constructor(private g: Game) {}

  begin(c: MissionCtx) {
    const g = this.g;
    this.cracked = false;
    const geo = new THREE.BoxGeometry(6, 2.6, 2.6);
    this.crate = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: '#c4a03c' }));
    this.crate.position.set(CONTAINER.x, CONTAINER.y + 1.3, CONTAINER.z + 2.6);
    g.scene.add(this.crate);
    this.act = {
      pos: new THREE.Vector3(CONTAINER.x, CONTAINER.y, CONTAINER.z + 0.6), radius: 2.6, label: 'Crack container 9', enabled: () => !this.cracked && !g.minigame.active && !g.player.vehicle,
      action: () => g.minigame.open({
        title: 'CONTAINER LOCK: HIT THE GREEN', hits: 3, time: 14, speed: 1.2, zone: 0.17,
        onWin: () => {
          this.cracked = true;
          g.audio.unlock();
          g.fx.spawn('money', this.crate!.position.clone(), 26);
          g.hud.toast('CAMERAS, WATCHES, THE LOT', 'win');
          g.police.crime(3, 'dock security');
          g.audio.alarmBell(6);
        },
        onFail: () => { g.hud.toast('ALARM — COPS INBOUND', 'heat'); g.police.crime(2, 'dock alarm'); },
      }),
    };
    g.interactables.push(this.act);
    const boat = c.spawnVehicle('speedboat', CARGO_PIER.x1 - 20, CARGO_PIER.z0 - 2.8, Math.PI / 2, '#2a2a2c');
    boat.locked = false;
  }

  end() {
    const g = this.g;
    if (g.minigame.active) g.minigame.cancel();
    if (this.act) { const i = g.interactables.indexOf(this.act); if (i >= 0) g.interactables.splice(i, 1); this.act = null; }
    if (this.crate) { g.scene.remove(this.crate); this.crate.geometry.dispose(); this.crate = null; }
  }
}

export const DOCK_HEIST: MissionDef = {
  id: 'dock_heist', title: 'Container Nine', giver: 'A nervous customs man', district: 'docks', type: 'water',
  marker: { x: 341, z: (CARGO_PIER.z0 + CARGO_PIER.z1) / 2, heading: Math.PI / 2 },
  intro: 'A container of stolen electronics sits at the far end of the cargo pier. Crack it, take a boat from the pier, and bring it all round to the lagoon. The road out is the first place they\'ll look.',
  replay: true,
  reward: { cash: 7500, reputation: 18, label: 'The haul' },
  setup: (c) => c.g.dockHeist.begin(c),
  cleanup: (c) => c.g.dockHeist.end(),
  failIf: sank,
  steps: [
    { id: 'walk', text: 'Get to container nine', sub: 'At the far end of the cargo pier', target: () => CONTAINER, done: (c) => c.g.player.worldPos.distanceTo(CONTAINER) < 8 },
    { id: 'crack', text: 'Crack the container', sub: 'Press E at the door', target: () => CONTAINER, done: (c) => c.g.dockHeist.cracked },
    { id: 'boat', text: 'Get to the boat', sub: 'Tied up on the south side of the pier', target: (c) => c.g.player.vehicle ? null : v3(CARGO_PIER.x1 - 20, CARGO_PIER.z0 + 1), done: onBoat },
    { id: 'away', text: 'Get to the lagoon', sub: 'Round the shore and through the channel. Hack the bridge to get a speedboat under it', target: () => v3(QUAY.x, LAGOON.z0 + 8), done: (c) => onBoat(c) && c.g.player.worldPos.distanceTo(v3(QUAY.x, LAGOON.z0 + 8)) < 16 },
  ],
};

export const WATER_MISSIONS = [SMUGGLING_RUN, JETSKI_RACE, DOCK_HEIST];
