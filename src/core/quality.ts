// Quality levels + automatic downgrade when frame time blows the 60 fps budget.
import { device } from './device';
import type { Game } from './game';

export interface QualityPreset {
  name: string;
  traffic: number; // civilian cars
  peds: number; // total crowd agents (ghost + full)
  rigs: number; // full-detail animated pedestrians near the player
  shadow: number; // shadow map size
  pixelRatio: number; // cap
  ambient: number; // pigeons/litter density multiplier
  msaa: number; // render target samples
  view: number; // world streaming radius + fog distance (m)
}

export const PRESETS: QualityPreset[] = [
  { name: 'LOW', traffic: 12, peds: 90, rigs: 12, shadow: 1024, pixelRatio: 0.85, ambient: 0.4, msaa: 0, view: 165 },
  { name: 'MEDIUM', traffic: 18, peds: 140, rigs: 20, shadow: 1024, pixelRatio: 1, ambient: 0.7, msaa: 2, view: 195 },
  { name: 'HIGH', traffic: 26, peds: 190, rigs: 30, shadow: 2048, pixelRatio: 1.25, ambient: 1, msaa: 4, view: 230 },
  { name: 'ULTRA', traffic: 32, peds: 230, rigs: 40, shadow: 2048, pixelRatio: 1.5, ambient: 1, msaa: 4, view: 265 },
];

// Phones: everything smaller, no MSAA, the bottom preset has no shadows at all.
export const MOBILE_PRESETS: QualityPreset[] = [
  { name: 'MINIMAL', traffic: 5, peds: 28, rigs: 4, shadow: 0, pixelRatio: 1, ambient: 0.1, msaa: 0, view: 110 },
  { name: 'LOW', traffic: 8, peds: 45, rigs: 6, shadow: 512, pixelRatio: 1.25, ambient: 0.2, msaa: 0, view: 135 },
  { name: 'MEDIUM', traffic: 11, peds: 65, rigs: 9, shadow: 1024, pixelRatio: 1.5, ambient: 0.4, msaa: 0, view: 160 },
  { name: 'HIGH', traffic: 15, peds: 90, rigs: 12, shadow: 1024, pixelRatio: 2, ambient: 0.6, msaa: 2, view: 190 },
];

const presets = device.mobile ? MOBILE_PRESETS : PRESETS;
const KEY = device.mobile ? 'blackoutcity.quality.mobile' : 'blackoutcity.quality';
// phones aim for a steady 30 and react faster: they heat up long before they recover
const BUDGET_MS = device.mobile ? 1000 / 30 : 1000 / 60;
const SLOW_S = device.mobile ? 1 : 2.5;
const FAST_S = device.mobile ? 30 : 15;

export class Quality {
  level = device.mobile ? (device.lowEnd ? 0 : 1) : 2; // start at HIGH (phones: LOW); auto may step up with headroom
  auto = true;
  ema = 16;
  private slowT = 0;
  private fastT = 0;
  private maxAuto = device.mobile ? (device.lowEnd ? 1 : 2) : 3;

  constructor(private g: Game) {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) { const q = JSON.parse(saved); this.level = q.level ?? 3; this.auto = q.auto ?? true; this.maxAuto = this.level; }
    } catch { /* ignore */ }
  }

  get p(): QualityPreset {
    return presets[this.level];
  }

  /** Feed real frame time (ms). Only meaningful while the tab is visible. */
  sample(ms: number, dt: number) {
    if (document.hidden || ms > 250) return;
    this.ema += (ms - this.ema) * 0.05;
    if (!this.auto) return;
    if (this.ema > BUDGET_MS * 1.15) { this.slowT += dt; this.fastT = 0; }
    else if (this.ema < BUDGET_MS * 0.8) { this.fastT += dt; this.slowT = 0; }
    else { this.slowT = Math.max(0, this.slowT - dt); this.fastT = 0; }
    if (this.slowT > SLOW_S && this.level > 0) { this.set(this.level - 1, true); this.slowT = 0; }
    if (this.fastT > FAST_S && this.level < this.maxAuto) { this.set(this.level + 1, true); this.fastT = 0; }
  }

  set(level: number, fromAuto = false) {
    this.level = Math.max(0, Math.min(presets.length - 1, level));
    if (!fromAuto) this.maxAuto = this.level;
    this.apply();
    this.g.hud.toast(`QUALITY: ${this.p.name}${fromAuto ? ' (AUTO)' : ''}`, 'dim');
    try { localStorage.setItem(KEY, JSON.stringify({ level: this.maxAuto, auto: this.auto })); } catch { /* ignore */ }
  }

  cycle() {
    this.set((this.level + presets.length - 1) % presets.length);
  }

  apply() {
    const g = this.g;
    const p = this.p;
    g.post.setSamples(p.msaa);
    g.renderer.setPixelRatio(Math.min(devicePixelRatio, p.pixelRatio));
    g.resize();
    const sh = g.env.sun.shadow;
    g.env.sun.castShadow = p.shadow > 0;
    if (p.shadow > 0 && sh.mapSize.x !== p.shadow) {
      sh.mapSize.set(p.shadow, p.shadow);
      sh.map?.dispose();
      sh.map = null as unknown as typeof sh.map;
    }
  }
}
