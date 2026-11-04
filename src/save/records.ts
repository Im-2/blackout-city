// Local best scores and race times. Separate from the save: an arcade table is
// written the moment you set a score, and New Game leaves it alone.
export interface TrickScore { score: number; bike: string; }

const KEY = 'blackoutcity.records.v1';
const KEEP = 5;

export class Records {
  tricks: TrickScore[] = [];
  races: Record<string, number> = {};
  pranks: Record<string, number> = {};

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this, JSON.parse(raw));
    } catch { /* storage blocked: the table lasts for the session */ }
  }

  private write() {
    try { localStorage.setItem(KEY, JSON.stringify({ tricks: this.tricks, races: this.races, pranks: this.pranks })); } catch { /* ignore */ }
  }

  /** returns 1-based rank, or 0 if it missed the table */
  addTricks(score: number, bike: string) {
    const e = { score, bike };
    this.tricks.push(e);
    this.tricks.sort((a, b) => b.score - a.score);
    this.tricks.length = Math.min(KEEP, this.tricks.length);
    this.write();
    return this.tricks.indexOf(e) + 1;
  }

  /** true when this is a new best */
  prank(id: string, score: number) {
    const prev = this.pranks[id];
    if (prev !== undefined && prev >= score) return false;
    this.pranks[id] = score;
    this.write();
    return true;
  }

  /** true when this is a new best */
  raceTime(id: string, t: number) {
    const prev = this.races[id];
    if (prev !== undefined && prev <= t) return false;
    this.races[id] = t;
    this.write();
    return true;
  }
}
