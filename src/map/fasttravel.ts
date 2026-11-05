// Fast travel: a taxi stand in every district plus one at your front door.
// E opens the menu; Up/Down pick, Enter goes, Backspace closes. Cabs won't touch
// you while you're hot, and the driver waves the fee if you're broke.
import * as THREE from 'three';
import { CURB_H, blockBounds } from '../world/layout';
import { DISTRICTS, District } from './districts';
import { worldMaterials } from '../world/materials';
import { GeoBuilder } from '../world/geo';
import type { Game } from '../core/game';

export interface Stand { name: string; district: District | 'home'; x: number; z: number; /** only once you own it */ prop?: string; }

const FEE = 50;

export class FastTravel {
  stands: Stand[] = [];
  open = false;
  sel = 0;
  private from = 0;
  private justOpened = false;

  constructor(private g: Game) {}

  build() {
    const g = this.g;
    const at = (bi: number, bj: number) => { const b = blockBounds(bi, bj); return { x: b.x0 + 7, z: b.z0 + 1.6 }; };
    const defs: [District, number, number][] = [['downtown', 5, 4], ['oldtown', 2, 6], ['docks', 10, 6], ['residential', 2, 1], ['park', 6, 11]];
    for (const [d, bi, bj] of defs) this.stands.push({ name: DISTRICTS[d].name, district: d, ...at(bi, bj) });
    this.stands.push({ name: 'Home', district: 'home', x: -24, z: 50.9 - 3.5 });
    for (const p of g.properties.list) this.stands.push({ name: p.def.name, district: 'home', x: p.door.x - 3, z: p.door.z - 0.4, prop: p.def.id });
    const b = new GeoBuilder();
    this.stands.forEach((s, i) => {
      b.cbox(s.x, CURB_H + 1.4, s.z, 0.12, 2.8, 0.12, { color: '#3a3c3e' });
      b.cbox(s.x, CURB_H + 2.9, s.z, 0.9, 0.5, 0.1, { color: '#c4a03c' });
      b.cbox(s.x, CURB_H + 2.9, s.z, 0.5, 0.2, 0.12, { color: '#2a2a2a' });
      b.cbox(s.x + 1.2, CURB_H + 0.45, s.z, 1.8, 0.1, 0.45, { color: '#6b4a30' });
      g.col.addCentered(s.x, s.z, 0.2, 0.2, 3, 0, false, 'pole');
      g.interactables.push({
        pos: new THREE.Vector3(s.x, CURB_H, s.z), radius: 2.2, label: 'Taxi stand: fast travel', enabled: () => !g.player.vehicle && !this.open && this.usable(s),
        action: () => this.show(i),
      });
    });
    g.scene.add(new THREE.Mesh(b.build(), worldMaterials().props));
    return this;
  }

  usable(s: Stand) { return !s.prop || this.g.properties.owns(s.prop); }

  private step(dir: number) {
    const n = this.stands.length;
    for (let k = 0; k < n; k++) {
      this.sel = (this.sel + dir + n) % n;
      if (this.sel !== this.from && this.usable(this.stands[this.sel])) return;
    }
  }

  /** the player is frozen while the menu is up */
  private show(i: number) {
    const g = this.g;
    if (g.police.heat > 0) { g.hud.toast('NO CABS FOR HOT PASSENGERS — LOSE THE HEAT', 'dim'); g.audio.deny(); return; }
    this.open = true;
    this.justOpened = true;
    this.from = i;
    this.sel = i;
    this.step(1);
  }

  update() {
    if (!this.open) return;
    const g = this.g;
    const inp = g.input;
    if (this.justOpened) { this.justOpened = false; return; } // the E press that opened it
    if (inp.pressed('menuDown')) this.step(1);
    if (inp.pressed('menuUp')) this.step(-1);
    if (inp.pressed('back', 'interact')) { this.open = false; return; }
    if (g.police.heat > 0) { this.open = false; return; }
    if (inp.pressed('confirm')) this.go(this.stands[this.sel]);
  }

  private go(s: Stand) {
    const g = this.g;
    this.open = false;
    const broke = g.save.data.cash < FEE;
    if (!broke) { g.save.data.cash -= FEE; g.audio.cash(); }
    g.fadeTeleport(s.x + 1.6, CURB_H, s.z + 1.2, 0, `${s.name.toUpperCase()}${broke ? ' — THIS ONE\'S ON THE DRIVER' : ` — $${FEE}`}`);
  }

  menuHtml() {
    if (!this.open) return '';
    const rows = this.stands.map((s, i) => (i === this.from || !this.usable(s) ? '' : `<div class="${i === this.sel ? 'sel' : ''}">${i === this.sel ? '▶' : '&nbsp;'} ${s.name} <em>$${FEE}</em></div>`)).join('');
    return `<div class="label">TAXI</div>${rows}<div class="label">[↑↓] CHOOSE · [ENTER] GO · [E] CLOSE</div>`;
  }
}
