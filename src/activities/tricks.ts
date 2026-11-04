// Bike trick scoring. Wheelies, stoppies, air time, spins and flips add to a combo;
// each trick bumps the multiplier and keeps the clock alive. Let the clock run out
// to bank it. Crash and it's gone.
import { wrapAngle } from '../core/math';
import { districtAt } from '../map/districts';
import type { Game } from '../core/game';

const HOLD = 2.6; // seconds to start the next trick
const MAX_MULT = 8;
const SPIN_PTS = [0, 800, 2000, 4000, 7000];
const FLIP_PTS = 1200;

export class Tricks {
  private feedEl: HTMLDivElement;
  private comboEl: HTMLDivElement;
  private feed: { text: string; t: number }[] = [];
  private pts = 0;
  private mult = 1;
  private clock = 0;
  private wheelieT = 0;
  private stoppieT = 0;
  private html = '';
  private comboHtml = '';

  constructor(private g: Game) {
    this.feedEl = g.hud.addPanel('trick-feed');
    this.comboEl = g.hud.addPanel('trick-combo');
  }

  reset() {
    this.pts = 0;
    this.mult = 1;
    this.clock = 0;
    this.wheelieT = this.stoppieT = 0;
    this.feed = [];
  }

  private line(text: string) {
    this.feed.unshift({ text, t: 4 });
    this.feed.length = Math.min(5, this.feed.length);
  }

  private score(name: string, pts: number) {
    pts = Math.round(pts);
    if (this.pts > 0) this.mult = Math.min(MAX_MULT, this.mult + 1);
    this.pts += pts;
    this.clock = HOLD;
    this.line(`${name} <b>+${pts.toLocaleString()}</b>`);
    this.g.audio.pop();
  }

  private bank() {
    const g = this.g;
    const total = this.pts * this.mult;
    const label = g.player.vehicle?.label ?? 'bike';
    this.pts = 0;
    this.mult = 1;
    if (total < 150) return;
    const cash = Math.floor(total / 25);
    g.loot.addCash(cash);
    const rank = g.records.addTricks(total, label);
    this.line(`<i>BANKED ${total.toLocaleString()} · $${cash}</i>`);
    g.audio.cash();
    if (rank === 1) { g.hud.toast(`NEW BEST TRICK SCORE: ${total.toLocaleString()}`, 'win'); g.news.headline(`Stunt rider stuns ${g.news.street(g.player.worldPos.x, g.player.worldPos.z)} with a ${total.toLocaleString()} point run`); }
    else if (rank) g.hud.toast(`HIGH SCORE #${rank}: ${total.toLocaleString()}`, 'hack');
    const P = g.player.worldPos;
    g.rep.add(districtAt(P.x, P.z), Math.min(5, Math.floor(total / 1500)));
  }

  private bail(reason: string) {
    if (this.pts > 0) this.line(`<u>${reason} -${(this.pts * this.mult).toLocaleString()}</u>`);
    this.pts = 0;
    this.mult = 1;
    this.clock = 0;
    this.wheelieT = this.stoppieT = 0;
  }

  update(dt: number) {
    const g = this.g;
    const v = g.player.vehicle;
    for (const f of this.feed) f.t -= dt;
    this.feed = this.feed.filter((f) => f.t > 0);
    if (!v || !v.two) {
      if (this.pts > 0) { if (g.player.knockT > 0 || g.player.busted) this.bail('BAILED'); else this.bank(); }
      this.wheelieT = this.stoppieT = 0;
    } else {
      if (v.wheelie && v.speedAbs > 2) { this.wheelieT += dt; this.clock = HOLD; }
      else if (this.wheelieT > 0) {
        if (this.wheelieT >= 0.8) this.score(`WHEELIE ${this.wheelieT.toFixed(1)}s`, this.wheelieT * 90 * (1 + v.speedAbs / 30));
        this.wheelieT = 0;
      }
      if (v.stoppie && v.speedAbs > 1.5) { this.stoppieT += dt; this.clock = HOLD; }
      else if (this.stoppieT > 0) {
        if (this.stoppieT >= 0.5) this.score(`STOPPIE ${this.stoppieT.toFixed(1)}s`, this.stoppieT * 260);
        this.stoppieT = 0;
      }
      if (v.air) this.clock = HOLD;
      const L = v.landed;
      if (L) {
        v.landed = null;
        const off = wrapAngle(v.heading - Math.atan2(v.vx, v.vz));
        const crooked = v.speedAbs > 5 && Math.abs(off) > 1.05;
        if (L.time >= 0.3 && (crooked || Math.abs(L.flipLeft) > 0.9)) {
          this.bail('BAD LANDING');
          g.player.thrownOff(v.vx, v.vz);
        } else if (L.time >= 0.4) {
          this.score(L.time > 1.2 ? `BIG AIR ${L.time.toFixed(1)}s` : `AIR ${L.time.toFixed(1)}s`, L.time * 180);
          const spins = Math.floor((Math.abs(L.yaw) + 1.05) / (Math.PI * 2));
          if (spins > 0) this.score(`${spins * 360} SPIN`, SPIN_PTS[Math.min(spins, SPIN_PTS.length - 1)]);
          const flips = Math.floor((Math.abs(L.flip) + 0.9) / (Math.PI * 2));
          if (flips > 0) this.score(flips > 1 ? `${flips}× ${L.flip > 0 ? 'FRONT' : 'BACK'}FLIP` : `${L.flip > 0 ? 'FRONT' : 'BACK'}FLIP`, flips * FLIP_PTS);
        }
      }
      if (this.pts > 0) {
        this.clock -= dt;
        if (this.clock <= 0) this.bank();
      }
    }
    this.draw();
  }

  private draw() {
    const html = this.feed.map((f) => `<div>${f.text}</div>`).join('');
    if (html !== this.html) { this.html = html; this.feedEl.innerHTML = html; this.feedEl.style.display = html ? 'block' : 'none'; }
    const live = this.pts > 0 || this.wheelieT > 0.3 || this.stoppieT > 0.2;
    const name = this.wheelieT > 0.3 ? `WHEELIE ${this.wheelieT.toFixed(1)}s` : this.stoppieT > 0.2 ? `STOPPIE ${this.stoppieT.toFixed(1)}s` : '';
    const combo = live ? `<span>${name}</span><b>${this.pts.toLocaleString()} ×${this.mult}</b><i style="width:${Math.max(0, this.clock / HOLD) * 100}%"></i>` : '';
    if (combo !== this.comboHtml) { this.comboHtml = combo; this.comboEl.innerHTML = combo; this.comboEl.style.display = combo ? 'block' : 'none'; }
  }
}
