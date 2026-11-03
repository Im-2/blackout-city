// Reputation / news: radio lines + billboard ticker that describe the player
// ("suspect in a green tie") based on their current outfit and car.
import type { Game } from '../core/game';

const COLOR_NAMES: Record<string, string> = {
  '#5b6433': 'olive', '#c4a03c': 'yellow', '#3f7b88': 'teal', '#9b3b2f': 'red', '#2f3b4d': 'navy',
  '#b9a98a': 'beige', '#cfccc4': 'white', '#6e6a62': 'grey', '#1c1c1e': 'black', '#d8782a': 'orange',
  '#4a2a5a': 'purple', '#e0e0d8': 'white', '#2a4a2a': 'green', '#7a1c1c': 'maroon',
};

export class News {
  ticker = 'CITY NEWS · POWER GRID ON EDGE AS HEATWAVE CONTINUES · ';
  private queue: string[] = [];
  private t = 0;
  crimes = 0;

  constructor(private g: Game) {}

  reset() {
    this.crimes = 0;
    this.queue = [];
    this.ticker = 'CITY NEWS · POWER GRID ON EDGE AS HEATWAVE CONTINUES · CITY SAVINGS BANK REPORTS RECORD DEPOSITS · ';
  }

  /** What the cops / witnesses think you look like right now. */
  description(): string {
    const g = this.g;
    const outfit = g.disguise?.current.desc ?? 'a green tie';
    const v = g.player.vehicle;
    if (v) return `${this.colorName(v.color)} ${v.label.toLowerCase()}`;
    return `suspect in ${outfit}`;
  }

  colorName(hex: string) {
    return COLOR_NAMES[hex.toLowerCase()] ?? 'dark';
  }

  street(x: number, z: number) {
    return this.g.city.graph.edgeAt(x, z).edge.name.toUpperCase();
  }

  report(kind: string, x: number, z: number) {
    this.crimes++;
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
    this.ticker = `BREAKING · ${line.toUpperCase()} · ` + this.ticker.slice(0, 260);
  }

  update(dt: number) {
    this.t -= dt;
    if (this.t <= 0 && this.queue.length) {
      this.t = 6;
      this.g.hud.radio(this.queue.shift()!);
    }
  }
}
