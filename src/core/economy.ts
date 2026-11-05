// Cash economy: carried loot (lost if busted) -> sell at the pawn shop fence
// or stash at home. Cash buys hack upgrades, car tuning and resprays;
// clothes and food are in ui/shopui.ts.
import type { Game } from './game';
import type { LootItem } from '../save/save';
import type { Vehicle } from '../vehicles/vehicle';
import { PAL } from './palette';

export class Loot {
  carried: LootItem[] = [];

  constructor(private g: Game) {}

  get carriedValue() {
    return this.carried.reduce((s, i) => s + i.value, 0);
  }

  get cash() {
    return this.g.save.data.cash;
  }

  reset() {
    this.carried = [];
  }

  add(item: LootItem) {
    this.carried.push(item);
    this.g.hud.toast(`+ ${item.name.toUpperCase()} ($${item.value.toLocaleString()})`, 'win');
    this.g.jobs.onEvent('loot');
  }

  addCash(n: number) {
    this.g.save.data.cash += n;
    this.g.save.data.earned += n;
  }

  sellAll() {
    const v = this.carriedValue;
    if (!v) return;
    // the fence takes a cut, more if you're hot
    const cut = (this.g.police.heat > 0 ? 0.6 : 0.8) + this.g.rep.fenceBonus;
    const paid = Math.round(v * cut);
    this.addCash(paid);
    this.carried = [];
    this.g.audio.cash();
    this.g.hud.toast(`FENCE PAID $${paid.toLocaleString()}${this.g.police.heat > 0 ? ' (HOT GOODS)' : ''}`, 'win');
  }

  stashAll() {
    const v = this.carriedValue;
    if (!v) return;
    this.g.save.data.stash.push(...this.carried);
    this.carried = [];
    this.g.hud.toast(`STASHED $${v.toLocaleString()} OF GOODS — SELL THEM LATER`, 'cool');
  }

  /** busted: carried loot is confiscated */
  confiscate() {
    this.carried = [];
  }
}

export const UPGRADES: { id: 'blackout' | 'hackCost' | 'regen' | 'car'; name: string; cost: number[] }[] = [
  { id: 'blackout', name: 'Longer blackouts (+8s)', cost: [1500, 3000, 6000] },
  { id: 'hackCost', name: 'Cheaper hacks (-15% energy)', cost: [1200, 2500, 5000] },
  { id: 'regen', name: 'Faster energy recharge', cost: [1000, 2200, 4500] },
  { id: 'car', name: 'Tuned getaway car', cost: [2000, 4000, 8000] },
];

const RESPRAY = ['#2a4a2a', '#7a1c1c', '#e0e0d8', '#4a2a5a', '#d8782a', '#1c1c1e', ...PAL.carColors];

export class Shop {
  constructor(private g: Game) {}

  private pay(n: number): boolean {
    const s = this.g.save.data;
    if (s.cash < n) { this.g.hud.toast(`NEED $${n.toLocaleString()} (HAVE $${s.cash.toLocaleString()})`, 'dim'); this.g.audio.deny(); return false; }
    s.cash -= n;
    this.g.audio.cash();
    return true;
  }

  /** buy the next tier of an upgrade at the hacker desk */
  buy(id: (typeof UPGRADES)[number]['id']) {
    const g = this.g;
    const up = UPGRADES.find((u) => u.id === id)!;
    const u = g.save.data.upgrades;
    const lvl = u[id];
    if (lvl >= up.cost.length || !this.pay(up.cost[lvl])) return;
    u[id] = lvl + 1;
    g.hud.toast(`UPGRADED: ${up.name.toUpperCase()} (LV ${lvl + 1})`, 'win');
    if (id === 'car' && g.getawayCar) g.getawayCar.tune('getaway', u.car);
  }

  respray(v: Vehicle) {
    const g = this.g;
    if (!this.pay(200)) return;
    let c = v.color;
    while (c === v.color) c = RESPRAY[Math.floor(Math.random() * RESPRAY.length)];
    v.respray(c);
    g.fx.spawn('paint', v.pos.clone().setY(1.2), 30, undefined, 1.2, c);
    g.audio.spray();
    g.save.escape('garage');
    g.hud.toast(`RESPRAYED ${g.news.colorName(c).toUpperCase()} — VEHICLE DESCRIPTION OUT OF DATE`, 'cool');
    g.police.onDescriptionLost('vehicle');
  }
}
