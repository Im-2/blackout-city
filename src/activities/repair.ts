// Roadside repair pads. Pull up, stop, press E. The home garage does it for free.
import * as THREE from 'three';
import { CURB_H } from '../world/layout';
import { GeoBuilder } from '../world/geo';
import { Kit } from '../world/interior';
import { worldMaterials } from '../world/materials';
import { kerbNear } from './route';
import type { Game } from '../core/game';

const SPOTS: [string, number, number][] = [['Downtown', 140, -60], ['Old Town', -230, 60], ['Docks', 230, 62], ['Park & Waterfront', 28, 226]];
const RADIUS = 6;
const FULL_COST = 200, MIN_COST = 25;

export class Repair {
  private pads: { x: number; z: number }[] = [];

  constructor(private g: Game) {}

  build() {
    const g = this.g;
    const b = new GeoBuilder();
    const signs = new Kit(g.col);
    for (const [name, x, z] of SPOTS) {
      const k = kerbNear(g, x, z);
      this.pads.push({ x: k.x, z: k.z });
      const fx = Math.sin(k.heading), fz = Math.cos(k.heading), rx = Math.cos(k.heading), rz = -Math.sin(k.heading);
      // a painted box on the road: long side along the kerb
      const hx = Math.abs(fx) * 4 + Math.abs(rx) * 1.6, hz = Math.abs(fz) * 4 + Math.abs(rz) * 1.6;
      for (const [ax0, az0, ax1, az1] of [[-hx, -hz, hx, -hz + 0.2], [-hx, hz - 0.2, hx, hz], [-hx, -hz, -hx + 0.2, hz], [hx - 0.2, -hz, hx, hz]]) {
        b.box(k.x + ax0, 0.012, k.z + az0, k.x + ax1, 0.022, k.z + az1, { color: '#7ad8a8' });
      }
      // the sign stands on the pavement beside it
      const side = kerbSide(k, x, z);
      const sx = k.x + rx * side * 3.6, sz = k.z + rz * side * 3.6;
      b.cbox(sx, CURB_H + 1.5, sz, 0.12, 3, 0.12, { color: '#3a3c3e' });
      g.col.addCentered(sx, sz, 0.2, 0.2, 3, 0, false, 'pole');
      signs.sign('REPAIR', sx, CURB_H + 3.2, sz, k.heading + Math.PI / 2, 2.2, 0.6, '#2a7a5a', '#fff1d0');
      g.activities.add({ id: `repair-${name}`, name: `Repair, ${name}`, type: 'repair', icon: 'garage', tag: 'R', x: k.x, z: k.z, intro: `Stop in the green box and press E to fix your vehicle. $${MIN_COST}–$${FULL_COST}, by damage. Your home garage does it for free.`, short: 'Stop in the green box and tap USE. Home garage is free.' });
    }
    g.scene.add(new THREE.Mesh(b.build(), worldMaterials().props));
    signs.finish(g.scene);
    return this;
  }

  private cost(share: number) {
    return Math.max(MIN_COST, Math.ceil((1 - share) * FULL_COST));
  }

  /** while you're stopped on a pad, E repairs */
  update() {
    const g = this.g, v = g.player.vehicle;
    if (!v || v.wrecked || v.health >= 0.999 || v.speedAbs > 3 || g.carAction) return;
    if (!this.pads.some((p) => Math.hypot(p.x - v.pos.x, p.z - v.pos.z) < RADIUS)) return;
    if (g.police.heat > 0 && g.police.lastSeenT < 3) {
      g.carAction = { label: 'Repair: not with the police watching', action: () => g.audio.deny() };
      return;
    }
    const cost = this.cost(v.health);
    g.carAction = {
      label: `Repair: $${cost}`,
      action: () => {
        const c = this.cost(v.health);
        if (g.save.data.cash < c) { g.hud.toast(`NEED $${c}`, 'dim'); g.audio.deny(); return; }
        g.save.data.cash -= c;
        v.repair();
        g.audio.unlock();
        g.fx.spawn('spark', v.pos.clone().setY(1.2), 18);
        g.hud.toast('GOOD AS NEW', 'cool');
      },
    };
  }
}

/** which way from the lane the pavement is: the side the original spot was on */
function kerbSide(k: { x: number; z: number; heading: number }, x: number, z: number) {
  const rx = Math.cos(k.heading), rz = -Math.sin(k.heading);
  return (x - k.x) * rx + (z - k.z) * rz >= 0 ? 1 : -1;
}
