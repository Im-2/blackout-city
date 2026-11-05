// News: radio lines + the ticker on billboards and the TV at home. It describes
// the player ("suspect in a green tie") from their outfit, car, crime record and
// reputation.
import { repTitle } from '../reputation/reputation';
import { districtAt } from '../map/districts';
import type { District } from '../map/districts';
import type { Game } from '../core/game';

const COLOR_NAMES: Record<string, string> = {
  '#5b6433': 'olive', '#c4a03c': 'yellow', '#3f7b88': 'teal', '#9b3b2f': 'red', '#2f3b4d': 'navy',
  '#b9a98a': 'beige', '#cfccc4': 'white', '#6e6a62': 'grey', '#1c1c1e': 'black', '#d8782a': 'orange',
  '#4a2a5a': 'purple', '#e0e0d8': 'white', '#2a4a2a': 'green', '#7a1c1c': 'maroon',
};

const CRIME_NAMES: Record<string, [string, string]> = {
  bank: ['bank job', 'bank jobs'],
  store: ['store hold-up', 'store hold-ups'],
  carjack: ['carjacking', 'carjackings'],
  witness: ['911 report', '911 reports'],
  pursuit: ['police chase', 'police chases'],
};

const CRIME_REP: Record<string, number> = { bank: 10, store: 4, carjack: 1, witness: 1, pursuit: 2 };

const FILLER = [
  'POWER GRID ON EDGE AS HEATWAVE CONTINUES',
  'CITY SAVINGS BANK REPORTS RECORD DEPOSITS',
  'TRAFFIC HEAVY ON THE RING HWY',
  'STREET MARKET RETURNS TO MILL ST',
  'MAYOR PROMISES NEW SUBSTATIONS, AGAIN',
  'HARBOUR FREIGHT STRIKE ENTERS SECOND WEEK',
];

export class News {
  ticker = '';
  private queue: string[] = [];
  private headlines: string[] = [];
  private t = 0;
  private fillI = 0;
  private featureT = 30;
  private scannerT = 50;
  crimes = 0;

  constructor(private g: Game) {}

  reset() {
    this.crimes = 0;
    this.queue = [];
    this.headlines = [];
    this.rebuild();
  }

  /** What the cops / witnesses think you look like right now. */
  description(): string {
    const g = this.g;
    const v = g.player.vehicle;
    if (v) return `${this.colorName(v.color)} ${v.label.toLowerCase()}`;
    // the news only knows what somebody saw
    if (g.disguise?.knownDesc) return `suspect last seen in ${g.disguise.knownDesc}`;
    return `suspect in ${g.disguise?.current.desc ?? 'a green tie'}`;
  }

  colorName(hex: string) {
    return COLOR_NAMES[hex.toLowerCase()] ?? 'dark';
  }

  street(x: number, z: number) {
    return this.g.city.graph.edgeAt(x, z).edge.name.toUpperCase();
  }

  report(kind: string, x: number, z: number) {
    this.crimes++;
    const g = this.g;
    const where = this.street(x, z);
    const d = this.description();
    const lines: Record<string, string> = {
      witness: `911 CALL: ${d} near ${where}`,
      bank: `ROBBERY IN PROGRESS at City Savings — ${d}`,
      carjack: `CARJACKING on ${where}. Look for ${d}`,
      store: `STORE HOLD-UP near ${where} — ${d}`,
      blackout: `GRID FAILURE: blocks dark near ${where}`,
      pursuit: `ALL UNITS: pursuit of ${d} on ${where}`,
      lost: `Units lost contact with ${d}`,
    };
    const line = lines[kind] ?? `${kind.toUpperCase()} near ${where}`;
    this.queue.push(line);
    this.headline(line);
    if (CRIME_NAMES[kind]) {
      const c = g.save.data.crimes;
      c[kind] = (c[kind] ?? 0) + 1;
      g.rep.add(districtAt(x, z), CRIME_REP[kind]);
    }
  }

  /** breaking item at the front of the ticker */
  headline(text: string) {
    this.headlines.unshift(text.toUpperCase());
    this.headlines.length = Math.min(4, this.headlines.length);
    this.rebuild();
  }

  /** a line for the radio right now, without a crime behind it */
  onAir(text: string) {
    this.queue.push(text);
  }

  private rebuild() {
    const fill = [FILLER[this.fillI % FILLER.length], FILLER[(this.fillI + 1) % FILLER.length]];
    this.ticker = `${this.headlines.length ? `BREAKING · ${this.headlines.join(' · ')} · ` : ''}CITY NEWS · ${fill.join(' · ')} · `;
  }

  /** "wanted for 2 store hold-ups and a carjacking" */
  record(): string {
    const parts = Object.entries(this.g.save.data.crimes)
      .filter(([k, n]) => n > 0 && CRIME_NAMES[k])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, n]) => `${n === 1 ? 'one' : n} ${CRIME_NAMES[k][n === 1 ? 0 : 1]}`);
    return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] ?? '';
  }

  private feature() {
    const g = this.g;
    const P = g.player.worldPos;
    const rep = g.rep.overall;
    this.fillI++;
    if (rep >= 10) {
      const rec = this.record();
      this.headline(`${repTitle(rep)} STILL AT LARGE${rec ? ` AFTER ${rec}` : ''}`);
    } else this.rebuild();
    void P;
  }

  update(dt: number) {
    const g = this.g;
    this.t -= dt;
    if (this.t <= 0 && this.queue.length) {
      this.t = 6;
      g.hud.radio(this.queue.shift()!);
    }
    this.featureT -= dt;
    if (this.featureT <= 0) { this.featureT = 45; this.feature(); }
    // the police scanner reads out your outfit and your record
    this.scannerT -= dt;
    if (this.scannerT <= 0) {
      this.scannerT = 70;
      const rec = this.record();
      if (rec) {
        const P = g.player.worldPos;
        this.onAir(`SCANNER: be on the lookout for a ${this.description()}. Wanted for ${rec}. Last reported near ${this.street(P.x, P.z)}.`);
      }
    }
  }

  /** used by the district line on the reputation screen */
  standing(d: District) {
    return repTitle(this.g.rep.district(d));
  }
}
