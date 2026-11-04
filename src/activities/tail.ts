// Surveillance: follow a target on foot. Stay in the distance band and out of sight
// when they check behind them; a crowd around you counts as cover. At the end, get
// close and hack their phone for a lead that opens up other jobs.
import * as THREE from 'three';
import { RigCharacter } from '../characters/rig';
import { makePedSkin } from '../characters/pedTypes';
import { Rng, dampAngle } from '../core/math';
import { blockBounds, groundHeight } from '../world/layout';
import type { Interactable } from '../player/player';
import type { MissionDef } from '../missions/types';
import type { District } from '../map/districts';
import type { Game } from '../core/game';

const NEAR = 5, FAR = 42, LOST_AFTER = 7;
const SEEN_RANGE = 22, VIEW_COS = Math.cos(1.05), WALK = 2.8;
const LOOK_S = 2.8, WARN_S = 1.2;

/** a block's sidewalk corner: 0 NW, 1 NE, 2 SE, 3 SW */
const corner = (bi: number, bj: number, k: number) => {
  const b = blockBounds(bi, bj), i = 1.8;
  return { x: k === 1 || k === 2 ? b.x1 - i : b.x0 + i, z: k >= 2 ? b.z1 - i : b.z0 + i };
};

interface TailDef {
  id: string;
  title: string;
  who: string;
  district: District;
  marker: { x: number; z: number };
  route: [number, number, number][];
  look: string;
  lead: string;
  intro: string;
  unlock?: MissionDef['unlock'];
}

const TAILS: TailDef[] = [
  { id: 'tail_courier', title: 'Shadow the Courier', who: 'courier', district: 'oldtown', marker: { x: -190, z: -9 }, look: '#c96a3a', route: [[2, 5, 2], [3, 5, 3], [3, 5, 2], [3, 5, 1], [3, 5, 0], [2, 5, 1], [2, 5, 0]], lead: 'VANTAGE TOWER SAFE DEPOSIT RUN', intro: 'A courier in orange knows about a job at Vantage Tower. Follow on foot, stay back, and don\'t be seen when they look round. Then lift the details from their phone.' },
  { id: 'tail_banker', title: 'The Banker\'s Lunch', who: 'banker', district: 'downtown', marker: { x: 84, z: -65 }, look: '#7a1c1c', route: [[7, 4, 2], [8, 4, 3], [8, 4, 2], [8, 4, 1], [8, 4, 0], [7, 4, 1], [7, 4, 0]], lead: 'ARMORED TRUCK PAY +$3,000', intro: 'A bank manager in a red tie is taking a long walk at lunch. Downtown\'s crowds are good cover. Their phone has the armored truck rota, worth more on every truck job.', unlock: { missions: ['tail_courier'], hint: 'Do the Old Town tail first (Shadow the Courier)' } },
];

export class TailJob {
  active = false;
  rig: RigCharacter | null = null;
  pos = new THREE.Vector3();
  heading = 0;
  seen = 0;
  dist = 0;
  private lostT = 0;
  private pts: { x: number; z: number }[] = [];
  private i = 0;
  private lookT = 0;
  private lookingBack = 0;
  arrived = false;
  hacked = false;
  blown = '';
  private inter: Interactable | null = null;
  private el: HTMLDivElement;
  private html = '';
  private rng = new Rng(707);
  private exposed = false;
  private cover = false;

  constructor(private g: Game) {
    this.el = g.hud.addPanel('panel tail-hud');
  }

  get target() { return this.pos; }

  begin(d: TailDef) {
    const g = this.g;
    this.active = true;
    this.seen = this.lostT = 0;
    this.arrived = this.hacked = false;
    this.blown = '';
    this.exposed = false;
    this.pts = d.route.map(([a, b, k]) => corner(a, b, k));
    this.i = 1;
    this.pos.set(this.pts[0].x, groundHeight(this.pts[0].x, this.pts[0].z), this.pts[0].z);
    this.lookT = 12;
    this.lookingBack = 0;
    const skin = { ...makePedSkin(d.who === 'banker' ? 'office' : 'courier', this.rng), top: d.look, key: `mark-${d.who}` };
    this.rig = new RigCharacter(skin);
    g.scene.add(this.rig.root);
    this.inter = {
      pos: this.pos, radius: 9, label: 'Hack their phone', enabled: () => this.arrived && !this.hacked && !g.minigame.active,
      action: () => this.hackPhone(d),
    };
    g.interactables.push(this.inter);
  }

  end() {
    const g = this.g;
    this.active = false;
    if (this.rig) g.scene.remove(this.rig.root);
    this.rig = null;
    if (this.inter) { const k = g.interactables.indexOf(this.inter); if (k >= 0) g.interactables.splice(k, 1); }
    this.inter = null;
    this.el.style.display = 'none';
    this.html = '';
    if (g.minigame.active) g.minigame.cancel();
  }

  private hackPhone(d: TailDef) {
    const g = this.g;
    g.minigame.open({
      title: 'PHONE: SYNC THE SIGNAL', hits: 3, time: 13, speed: 1.05, zone: 0.2,
      onWin: () => {
        this.hacked = true;
        g.audio.hackBlip();
        g.hud.toast(`LEAD: ${d.lead}`, 'win');
      },
      onFail: () => {
        this.seen = Math.min(0.9, this.seen + 0.3);
        g.hud.toast('NO SYNC — TRY AGAIN', 'dim');
      },
    });
  }

  update(dt: number) {
    const g = this.g;
    if (!this.active || !this.rig) return;
    const P = g.player.worldPos;
    const dx = P.x - this.pos.x, dz = P.z - this.pos.z;
    this.dist = Math.hypot(dx, dz);

    // walk the route, stop now and then to check behind
    let moving = false;
    if (!this.arrived) {
      if (this.lookingBack > 0) {
        this.lookingBack -= dt;
        if (this.lookingBack <= 0) this.lookT = this.rng.range(9, 15);
        // a beat standing still before turning round: your cue to find cover
        if (this.lookingBack < LOOK_S) {
          const n = this.pts[this.i];
          const away = Math.atan2(n.x - this.pos.x, n.z - this.pos.z) + Math.PI;
          this.heading = dampAngle(this.heading, away, 5, dt);
        }
      } else {
        this.lookT -= dt;
        if (this.lookT <= 0) this.lookingBack = LOOK_S + WARN_S;
        const n = this.pts[this.i];
        const tx = n.x - this.pos.x, tz = n.z - this.pos.z, L = Math.hypot(tx, tz);
        if (L < 0.8) {
          this.i++;
          if (this.i >= this.pts.length) { this.arrived = true; g.hud.toast('THE TARGET HAS STOPPED — GET ON THEIR PHONE', 'hack'); }
        } else {
          this.pos.x += (tx / L) * WALK * dt;
          this.pos.z += (tz / L) * WALK * dt;
          this.pos.y = groundHeight(this.pos.x, this.pos.z);
          this.heading = dampAngle(this.heading, Math.atan2(tx, tz), 7, dt);
          moving = true;
        }
      }
    }
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.heading;
    this.rig.update(dt, moving ? 'walk' : this.arrived ? 'phone' : 'idle', moving ? WALK : 0);

    // can they see you?
    const inView = this.dist < SEEN_RANGE && (dx * Math.sin(this.heading) + dz * Math.cos(this.heading)) / (this.dist || 1) > VIEW_COS;
    const los = inView && g.col.lineOfSight(this.pos.x, this.pos.y + 1.6, this.pos.z, P.x, P.y + 1.3, P.z);
    let around = 0;
    for (const a of g.peds.agents) {
      if (a.off || Math.abs(a.x - P.x) > 3 || Math.abs(a.z - P.z) > 3) continue;
      if (Math.hypot(a.x - P.x, a.z - P.z) < 3) around++;
    }
    this.cover = around >= 2;
    this.exposed = los && !this.cover;
    // a car on your tail gets noticed quicker than someone on foot
    const rate = g.player.vehicle ? 1.6 : 1;
    // far away you're just another face: close up you're obvious in moments
    const notice = 2.5 + (Math.max(0, this.dist - 8) / (SEEN_RANGE - 8)) * 6.5;
    if (this.exposed && !g.hack.isBlackedOut(P.x, P.z)) this.seen += (dt / notice) * rate;
    else if (this.dist < NEAR && !this.arrived) this.seen += dt / 3.5;
    else this.seen = Math.max(0, this.seen - dt / 7);
    if (this.seen >= 1) this.blown = 'The target spotted you';
    if (this.dist > FAR && !this.arrived) {
      this.lostT += dt;
      if (this.lostT > LOST_AFTER) this.blown = 'You lost the target';
    } else this.lostT = 0;
    this.drawHud();
  }

  private drawHud() {
    const d = this.dist;
    const state = this.exposed ? 'IN THEIR SIGHT' : d < NEAR ? 'TOO CLOSE' : d > FAR ? `TOO FAR ${Math.ceil(LOST_AFTER - this.lostT)}s` : this.cover ? 'IN THE CROWD' : 'GOOD';
    const bad = this.exposed || d < NEAR || d > FAR;
    const mark = Math.max(0, Math.min(100, (d / 60) * 100));
    const html = `<div class="label">${this.lookingBack > LOOK_S ? 'STOPPED. FIND COVER!' : this.lookingBack > 0 ? 'THEY\'RE LOOKING BACK!' : 'DISTANCE'}</div>
      <div class="t-band"><i style="left:${(NEAR / 60) * 100}%;width:${((FAR - NEAR) / 60) * 100}%"></i><b style="left:${mark}%"></b></div>
      <div class="t-state ${bad ? 'bad' : ''}">${state} · ${Math.round(d)}m</div>
      <div class="t-seen"><i style="width:${Math.min(1, this.seen) * 100}%"></i></div>`;
    if (html !== this.html) { this.html = html; this.el.innerHTML = html; }
    this.el.style.display = 'block';
  }
}

function mission(d: TailDef): MissionDef {
  return {
    id: d.id,
    title: d.title,
    giver: 'Your fixer',
    district: d.district,
    type: 'tail',
    icon: 'eye',
    category: 'activity',
    marker: { ...d.marker },
    intro: d.intro,
    unlock: d.unlock,
    replay: true,
    reward: { cash: 800, reputation: 8 },
    setup: (c) => c.g.tail.begin(d),
    cleanup: (c) => c.g.tail.end(),
    failIf: (c) => c.g.tail.blown || null,
    summary: () => [['LEAD', d.lead]],
    steps: [
      {
        id: 'follow',
        text: 'Follow the target',
        sub: 'Stay in the band. When they look back, hide behind something or in a crowd',
        target: (c) => c.g.tail.target,
        done: (c) => c.g.tail.arrived,
      },
      {
        id: 'hack',
        text: 'Hack the target\'s phone',
        sub: 'Get within 9 m, then press E. Stay out of sight',
        target: (c) => c.g.tail.target,
        done: (c) => c.g.tail.hacked,
      },
    ],
  };
}

export const TAIL_MISSIONS = TAILS.map(mission);
