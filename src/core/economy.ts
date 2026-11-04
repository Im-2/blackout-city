// Cash economy: carried loot (lost if busted) -> sell at the pawn shop fence
// or stash at the safehouse. Cash buys hack upgrades, car tuning, outfits,
// and resprays.
import type { Game } from './game';
import type { LootItem } from '../save/save';
import { OUTFITS } from '../player/disguise';
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
    this.g.save.write();
  }

  sellAll() {
    const v = this.carriedValue;
    if (!v) return;
    // the fence takes a cut, more if you're hot
    const cut = this.g.police.heat > 0 ? 0.6 : 0.8;
    const paid = Math.round(v * cut);
    this.addCash(paid);
    this.carried = [];
    this.g.audio.cash();
    this.g.hud.toast(`FENCE PAID $${paid.toLocaleString()}${this.g.police.heat > 0 ? ' (HOT GOODS -40%)' : ' (-20% CUT)'}`, 'win');
  }

  stashAll() {
    const v = this.carriedValue;
    if (!v) return;
    this.g.save.data.stash.push(...this.carried);
    this.carried = [];
    this.g.save.write();
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
  private upI = 0;

  constructor(private g: Game) {}

  private pay(n: number): boolean {
    const s = this.g.save.data;
    if (s.cash < n) { this.g.hud.toast(`NEED $${n.toLocaleString()} (HAVE $${s.cash.toLocaleString()})`, 'dim'); this.g.audio.deny(); return false; }
    s.cash -= n;
    this.g.save.write();
    this.g.audio.cash();
    return true;
  }

  buyNextOutfit() {
    const g = this.g;
    const next = OUTFITS.find((o) => !g.disguise.owned.has(o.id));
    if (!next) { this.cycleOutfit(); return; }
    if (!this.pay(next.price)) return;
    g.disguise.owned.add(next.id);
    g.save.data.outfits = [...g.disguise.owned];
    g.save.write();
    g.disguise.wear(next.id);
  }

  cycleOutfit() {
    const g = this.g;
    const owned = OUTFITS.filter((o) => g.disguise.owned.has(o.id));
    const i = owned.findIndex((o) => o.id === g.disguise.current.id);
    g.disguise.wear(owned[(i + 1) % owned.length].id);
  }

  /** the upgrade terminal cycles through upgrades; each press buys the next affordable tier */
  buyUpgrade() {
    const g = this.g;
    const u = g.save.data.upgrades;
    for (let k = 0; k < UPGRADES.length; k++) {
      const up = UPGRADES[(this.upI + k) % UPGRADES.length];
      const lvl = u[up.id];
      if (lvl >= up.cost.length) continue;
      this.upI = (this.upI + k + 1) % UPGRADES.length;
      const cost = up.cost[lvl];
      if (!this.pay(cost)) { g.hud.hint(`Next upgrade: ${up.name} — $${cost.toLocaleString()}`); return; }
      u[up.id] = lvl + 1;
      g.save.write();
      g.hud.toast(`UPGRADED: ${up.name.toUpperCase()} (LV ${lvl + 1})`, 'win');
      if (up.id === 'car' && g.getawayCar) g.getawayCar.tune('getaway', u.car);
      return;
    }
    g.hud.toast('ALL UPGRADES BOUGHT', 'dim');
  }

  sleep() {
    const g = this.g;
    g.save.write();
    if (g.police.heat > 0 && g.police.lastSeenT > 3) { g.police.setHeat(g.police.minHeat); g.police.lastSeenT = 999; }
    g.world.skipHours(3);
    g.hud.toast('SAVED. YOU SLEPT IT OFF.', 'cool');
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
