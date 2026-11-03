// Clip/debug tools for recording footage. Always on (documented on the controls screen).
import type { Game } from '../core/game';
import { blockCenter } from '../world/layout';

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
