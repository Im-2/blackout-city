// Harmless chaos. Billboards take preset or short custom messages (filtered), shop
// doors and the Vantage lift can be locked for a few seconds, and three scored
// missions string it together: Prime Time, Disco Junction and the Car Alarm Concert.
import * as THREE from 'three';
import { Vehicle } from '../vehicles/vehicle';
import type { Billboard } from '../ai/escapes';
import type { MissionCtx, MissionDef } from '../missions/types';
import type { Game } from '../core/game';

export const BILLBOARD_PRESETS = [
  'LOOK BEHIND YOU', 'THE PIGEONS ARE WATCHING', 'YOUR BOSS KNOWS', 'CALL YOUR MUM',
  'THE MAYOR WEARS A WIG', 'THIS AD IS HACKED', 'FREE COFFEE? NO.', 'CUT THE POWER',
];

// Custom text is short, plain and checked. This catches the obvious; presets are the safe route.
const BLOCKED = ['KILL', 'MURDER', 'SHOOT', 'BOMB', 'STAB', 'RAPE', 'NAZI', 'HITLER', 'SUICIDE', 'TERROR', 'LYNCH', 'NIGG', 'FAGG', 'KIKE', 'SPIC', 'CHINK', 'TRANNY', 'RETARD', 'FUCK', 'SHIT', 'CUNT', 'BITCH', 'WHORE', 'SLUT'];
const LEET: Record<string, string> = { 0: 'O', 1: 'I', 3: 'E', 4: 'A', 5: 'S', 7: 'T', '@': 'A', $: 'S', '!': 'I' };

/** the cleaned-up text, or null if it isn't going on a billboard */
export function cleanMessage(raw: string): string | null {
  const text = raw.toUpperCase().replace(/[^A-Z0-9 !?.,'&-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
  if (!text) return null;
  const plain = (raw.toUpperCase().replace(/[01345 7@$!]/g, (c) => LEET[c] ?? '')).replace(/[^A-Z]/g, '');
  return BLOCKED.some((w) => plain.includes(w)) ? null : text;
}

const NODES_DISCO: [number, number, 'red' | 'green'][] = [[3, 6, 'red'], [4, 6, 'green'], [5, 6, 'red'], [6, 6, 'green'], [7, 6, 'red']];
const BEAT = 2.4, BEAT_WINDOW = 0.45;
const CONCERT_CARS = 6, CONCERT_PASS = 4;

export class Pranks {
  score = 0;
  private el: HTMLDivElement;
  private html = '';
  private mode: 'billboards' | 'disco' | 'concert' | null = null;
  // billboards
  boards: Billboard[] = [];
  private custom = 0;
  // disco
  discoI = 0;
  private mistakes = 0;
  // concert
  cars: Vehicle[] = [];
  private beat = 0;
  private fired = new Set<Vehicle>();
  done = false;
  /** the billboard the menu is writing to */
  private editing: Billboard | null = null;

  constructor(private g: Game) {
    this.el = g.hud.addPanel('panel prank-hud');
  }

  // ------------------------------------------------------------------ billboards, any time
  /** hacking a billboard opens the message menu */
  openBillboard(b: Billboard) {
    this.editing = b;
    this.g.homeUi.open(['billboard'], 'BILLBOARD');
  }

  post(text: string, custom: boolean) {
    const g = this.g, b = this.editing;
    if (!b) return;
    b.msg = text;
    b.msgT = 40;
    b.flashT = 0;
    this.editing = null;
    g.news.headline(`Billboard hacked again: "${text}"`);
    g.rep.add(g.chunks.district, 1);
    if (this.mode === 'billboards' && this.boards.includes(b)) {
      this.boards = this.boards.filter((x) => x !== b);
      this.score += custom ? 350 : 200;
      if (custom) this.custom++;
      g.audio.cash();
      if (!this.boards.length) this.done = true;
    }
  }

  /** a shopkeeper who got locked in holds it against you */
  remember(site: string) {
    const s = this.g.save.data;
    s.grudges[site] = (s.grudges[site] ?? 0) + 1;
    this.g.rep.add(this.g.chunks.district, 1);
  }

  // ------------------------------------------------------------------ scored missions
  beginBillboards(c: MissionCtx) {
    const g = c.g;
    this.reset('billboards');
    const P = g.player.worldPos;
    this.boards = [...g.escapes.billboards].sort((a, b) => a.pos.distanceTo(P) - b.pos.distanceTo(P)).slice(0, 3);
  }

  get nextBoard() {
    const P = this.g.player.worldPos;
    let best: Billboard | null = null, bd = Infinity;
    for (const b of this.boards) { const d = b.pos.distanceTo(P); if (d < bd) { bd = d; best = b; } }
    return best ? new THREE.Vector3(best.pos.x, 1, best.pos.z) : null;
  }

  beginDisco() {
    this.reset('disco');
    this.discoI = 0;
    this.mistakes = 0;
    for (const [i, j] of NODES_DISCO) this.g.signals.nodes[this.g.city.graph.node(i, j).id].override = null;
  }

  get discoNode() {
    const n = NODES_DISCO[this.discoI];
    if (!n) return null;
    const N = this.g.city.graph.node(n[0], n[1]);
    return new THREE.Vector3(N.x, 1, N.z);
  }
  get discoColor() { return NODES_DISCO[this.discoI]?.[2] ?? 'red'; }

  beginConcert(c: MissionCtx) {
    const g = c.g;
    this.reset('concert');
    this.beat = 0;
    this.fired.clear();
    // both kerbs of one stretch of Mill St, so you can play them from one spot
    const spots = [[66, 117.6, 1], [76, 117.6, 1], [86, 117.6, 1], [96, 117.6, 1], [72, 106.4, -1], [90, 106.4, -1]].map(([x, z, d]) => ({ x, z, heading: (d * Math.PI) / 2 }));
    const cols = ['#d8782a', '#3f7b88', '#c4a03c', '#7a1c1c', '#cfccc4', '#4a2a5a'];
    this.cars = spots.map((s, i) => {
      for (const o of [...g.vehicles]) if (o.driver === 'none' && o !== g.home.car && Math.hypot(o.pos.x - s.x, o.pos.z - s.z) < 5) g.removeVehicle(o);
      const v = c.spawnVehicle(i % 2 ? 'hatchback' : 'sedan', s.x, s.z, s.heading, cols[i]);
      v.locked = false;
      return v;
    });
  }

  get nextCar() {
    const P = this.g.player.worldPos;
    let best: Vehicle | null = null, bd = Infinity;
    for (const v of this.cars) { if (this.fired.has(v)) continue; const d = v.pos.distanceTo(P); if (d < bd) { bd = d; best = v; } }
    return best ? new THREE.Vector3(best.pos.x, 1, best.pos.z) : null;
  }
  get concertPlayed() { return this.fired.size; }

  private reset(mode: Pranks['mode']) {
    this.mode = mode;
    this.score = 0;
    this.custom = 0;
    this.done = false;
    this.html = '';
  }

  end() {
    this.mode = null;
    this.boards = [];
    this.cars = [];
    this.el.style.display = 'none';
  }

  /** seconds left turn into points */
  finalScore(timeLeft: number) {
    return this.score + Math.round(timeLeft * 12);
  }

  update(dt: number) {
    const g = this.g;
    if (!this.mode) return;
    if (this.mode === 'disco') {
      const n = NODES_DISCO[this.discoI];
      if (n) {
        const id = g.city.graph.node(n[0], n[1]).id;
        const ov = g.signals.nodes[id].override;
        if (ov) {
          const got = ov === 'red' ? 'red' : 'green';
          if (got === n[2]) {
            this.discoI++;
            this.score += 300;
            g.audio.hackBlip();
            // hold the finished ones so the whole pattern is up at the end
            g.signals.nodes[id].overrideT = 40;
            if (this.discoI >= NODES_DISCO.length) this.done = true;
          } else {
            this.mistakes++;
            this.score = Math.max(0, this.score - 100);
            g.signals.nodes[id].override = null;
            g.hud.toast('WRONG COLOUR', 'dim');
            g.audio.deny();
          }
        }
      }
    }
    if (this.mode === 'concert') {
      this.beat += dt;
      const ph = this.beat % BEAT;
      const onBeat = ph < BEAT_WINDOW || ph > BEAT - BEAT_WINDOW;
      if (Math.floor((this.beat - dt) / BEAT) !== Math.floor(this.beat / BEAT)) g.audio.pop();
      for (const v of this.cars) {
        if (this.fired.has(v) || v.alarmT <= 0) continue;
        this.fired.add(v);
        this.score += onBeat ? 300 : 100;
        g.hud.toast(onBeat ? 'ON THE BEAT!' : 'OFF THE BEAT', onBeat ? 'cool' : 'dim');
        if (this.fired.size >= CONCERT_CARS) this.done = true;
      }
      this.el.classList.toggle('pulse', onBeat);
    }
    const html = `<div class="label">SCORE</div><div class="r-pos">${this.score.toLocaleString()}</div>${this.mode === 'concert' ? `<div class="r-row">${this.fired.size}/${CONCERT_CARS} CARS · HACK ON THE BEAT</div>` : this.mode === 'disco' ? `<div class="r-row">${this.discoI}/${NODES_DISCO.length} LIGHTS</div>` : `<div class="r-row">${this.boards.length} BILLBOARDS LEFT</div>`}`;
    if (html !== this.html) { this.html = html; this.el.innerHTML = html; }
    this.el.style.display = 'block';
  }
}

function prank(base: Pick<MissionDef, 'id' | 'title' | 'giver' | 'district' | 'marker' | 'intro' | 'timeLimit' | 'steps' | 'setup' | 'failIf'> & { pay: number }): MissionDef {
  const { pay, ...def } = base;
  return {
    ...def,
    type: 'prank',
    icon: 'bolt',
    category: 'activity',
    replay: true,
    reward: { cash: (c) => pay + Math.round(c.g.pranks.finalScore(c.g.missions.timeLeft ?? 0) / 4), reputation: 4, label: 'Tips' },
    cleanup: (c) => c.g.pranks.end(),
    summary: (c) => {
      const score = c.g.pranks.finalScore(c.g.missions.timeLeft ?? 0);
      const isBest = c.g.records.prank(def.id, score);
      return [['SCORE', score.toLocaleString()], ['BEST SCORE', `${c.g.records.pranks[def.id].toLocaleString()}${isBest ? ' NEW!' : ''}`]];
    },
  };
}

export const PRANK_MISSIONS: MissionDef[] = [
  prank({
    id: 'prank_billboards', title: 'Prime Time', giver: 'A bored student', district: 'downtown', marker: { x: 20, z: -9 }, timeLimit: 80, pay: 200,
    intro: 'Take over three billboards before the ad company notices. Your own words score more than the presets. Keep it silly.',
    setup: (c) => c.g.pranks.beginBillboards(c),
    steps: [{
      id: 'boards', text: 'Hack the billboards', sub: 'Hold Q and aim at the nearest one, then pick a message',
      target: (c) => c.g.pranks.nextBoard, done: (c) => c.g.pranks.done,
    }],
  }),
  prank({
    id: 'prank_lights', title: 'Disco Junction', giver: 'A bored student', district: 'downtown', marker: { x: -90, z: 9 }, timeLimit: 90, pay: 300,
    intro: 'Five junctions along Union Blvd, red, green, red, green, red. Traffic will hate it. Click a light for green, right-click for red. A wrong colour costs points.',
    setup: (c) => c.g.pranks.beginDisco(),
    steps: [{
      id: 'lights', text: (c) => `Set this light to ${c.g.pranks.discoColor.toUpperCase()}`, sub: 'Hold Q: click = green, right-click = red. On foot works best',
      target: (c) => c.g.pranks.discoNode, done: (c) => c.g.pranks.done,
    }],
  }),
  prank({
    id: 'prank_alarms', title: 'Car Alarm Concert', giver: 'A bored student', district: 'residential', marker: { x: 84, z: 121 }, timeLimit: 45, pay: 300,
    intro: 'Six parked cars, one song. Set off their alarms in time with the beat. On the beat is worth triple. Play at least four to pass.',
    setup: (c) => c.g.pranks.beginConcert(c),
    failIf: (c) => ((c.g.missions.timeLeft ?? 1) < 0.2 && c.g.pranks.concertPlayed < CONCERT_PASS ? 'Not enough of a show' : null),
    steps: [{
      id: 'play', text: 'Play the car alarms', sub: 'Hold Q, aim at a car, hack it as the panel flashes',
      target: (c) => c.g.pranks.nextCar, done: (c) => c.g.pranks.done || ((c.g.missions.timeLeft ?? 9) < 0.5 && c.g.pranks.concertPlayed >= CONCERT_PASS),
    }],
  }),
];
