// Clip/debug tools for recording footage. Always on (documented on the controls screen).
import type { Game } from '../core/game';
import { blockCenter } from '../world/layout';
import { Vehicle } from '../vehicles/vehicle';
import { DIMS, CarKind } from '../vehicles/carMesh';
import { colorFor } from '../ai/traffic';
import { Rng } from '../core/math';

const ALL_KINDS = Object.keys(DIMS) as CarKind[];
let cycleI = 0;
let tpI = -1;
const rng = new Rng(9);

export function updateDebug(g: Game) {
  const inp = g.input;
  for (let n = 0; n <= 5; n++) {
    if (inp.pressed(`Digit${n}`)) {
      g.police.setHeat(n, 'debug');
      if (n === 0) { g.police.minHeat = 0; g.police.lastSeenT = 999; }
      g.hud.toast(`DEBUG: HEAT ${n}`, 'dim');
    }
  }
  if (inp.pressed('KeyT')) teleport(g, g.bank.playerStart.x, -46, 0, 'BANK (BACK ALLEY)');
  if (inp.pressed('KeyY')) teleport(g, g.city.dropZone.doorX - 18, g.city.dropZone.doorZ, Math.PI / 2, 'DROP POINT');
  if (inp.pressed('KeyU')) { const c = blockCenter(3, 3); teleport(g, c.x - 30, c.z - 2, 0, 'MID-CITY'); }
  if (inp.pressed('KeyG')) { g.spawnGetawayBeside(); g.hud.toast('DEBUG: GETAWAY CAR', 'dim'); }
  if (inp.pressed('KeyL') && !g.heist.hasLoot) {
    g.heist.reset(true);
    g.police.minHeat = 1;
    g.hud.toast('DEBUG: LOOT IN HAND', 'dim');
  }
  if (inp.pressed('KeyB')) spawnBeside(g, 'bicycle');
  if (inp.pressed('KeyN')) spawnBeside(g, 'motorbike');
  if (inp.pressed('KeyV')) { spawnBeside(g, ALL_KINDS[cycleI % ALL_KINDS.length]); cycleI++; }
  if (inp.pressed('KeyK')) {
    const P = g.player.worldPos;
    g.peds.spawnCrowd(P.x, P.z, 30);
    g.hud.toast('DEBUG: CROWD', 'dim');
  }
  // teleport through the enterable buildings
  const sites = g.sites();
  if (sites.length && (inp.pressed('BracketRight') || inp.pressed('BracketLeft'))) {
    tpI = (tpI + (inp.pressed('BracketRight') ? 1 : -1) + sites.length) % sites.length;
    const s = sites[tpI];
    teleport(g, s.x, s.z, s.heading, s.name.toUpperCase());
  }
}

function spawnBeside(g: Game, kind: CarKind) {
  const p = g.player;
  const base = p.vehicle ? p.vehicle.pos : p.pos;
  const heading = p.vehicle ? p.vehicle.heading : p.heading;
  const v = new Vehicle(kind, colorFor(rng, kind), g.col);
  const rx = Math.cos(heading), rz = -Math.sin(heading);
  const off = 2.2 + v.parts.dims.wid / 2;
  v.place(base.x + rx * off, base.z + rz * off, heading);
  v.handbrake = true;
  g.addVehicle(v);
  g.hud.toast(`DEBUG: ${v.label.toUpperCase()}`, 'dim');
}

function teleport(g: Game, x: number, z: number, heading: number, label: string) {
  const v = g.player.vehicle;
  if (v) {
    v.place(x, z, heading);
  } else {
    g.player.spawn(x, z, heading);
  }
  g.camRig.snapBehind(heading);
  g.hud.toast(`TELEPORT: ${label}`, 'dim');
}
