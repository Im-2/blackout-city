// The mission list. Adding a mission = adding an entry here.
//
// Mid-mission rules (see CLAUDE.md): heat never fails a mission by itself, only a
// bust does. Vehicles are never required by identity: lose or swap yours and the
// mission carries on with whatever you're in.
import * as THREE from 'three';
import type { MissionDef, MissionCtx } from './types';

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

const COURIER_PICKUP = v3(-130, 1, 9);
const COURIER_DROP = v3(190, 1, 9);

/** Common bank set-up for the checkpoints after the first. */
function bankInside(c: MissionCtx) {
  const { g } = c;
  g.bank.openDoor(g.bank.doors.find((d) => d.name === 'Back door')!);
  g.heist.backOpen = true;
  for (const cam of g.cameras.cams) if (cam.bank) g.cameras.blind(cam, 60);
}

export const MISSIONS: MissionDef[] = [
  {
    id: 'courier_run',
    title: 'Hot Parcel',
    giver: 'Dispatch',
    district: 'oldtown',
    type: 'courier',
    marker: { x: -190, z: 9, heading: Math.PI / 2 },
    intro: 'A parcel in Old Town has to reach the docks before the buyer walks. There\'s a scooter by the kerb, or take whatever\'s fastest.',
    timeLimit: 90,
    reward: { cash: 350, reputation: 5 },
    replay: true,
    setup: (c) => {
      c.vars.scooter = c.spawnVehicle('scooter', -186, 5.5, Math.PI / 2, '#c96a3a');
    },
    steps: [
      {
        id: 'pickup',
        text: 'Pick up the parcel',
        sub: 'Old Town, Union Blvd. Any vehicle will do',
        target: () => COURIER_PICKUP,
        reach: 6,
      },
      {
        id: 'deliver',
        text: 'Deliver it to the docks',
        sub: (c) => (c.g.police.heat > 0 ? 'Cops or not, it still pays. Don\'t get cuffed' : c.g.player.vehicle ? 'Follow the GPS line' : 'On foot? Grab anything with wheels'),
        target: () => COURIER_DROP,
        reach: 7,
        enter: (c) => { c.g.hud.toast('PARCEL ON BOARD', 'hack'); },
        checkpoint: {
          restore: (c) => {
            const { g } = c;
            const s = c.vars.scooter as { place: (x: number, z: number, h: number) => void };
            s.place(-126, 5.5, Math.PI / 2);
            g.player.spawn(-128, 9, Math.PI / 2);
          },
        },
      },
    ],
  },
  {
    id: 'bank_heist',
    title: 'Cut the Power',
    giver: 'The Crew',
    district: 'downtown',
    type: 'heist',
    marker: { x: -84, z: -8.8, heading: Math.PI },
    intro: 'City Savings, after hours. Get in the back, crack the vault, grab the bag, and get it to the Old Garage with nobody watching.',
    unlock: { missions: ['courier_run'], hint: 'Finish a job for Dispatch first (Hot Parcel, Old Town)' },
    failOnWreck: true,
    replay: true,
    reward: { cash: (c) => c.g.heist.stats.loot, reputation: 25, label: 'Loot' },
    setup: (c) => c.g.heist.begin(),
    cleanup: (c) => c.g.heist.end(),
    summary: (c) => {
      const s = c.g.heist.stats;
      return [
        ['HEAT PEAK', `${'★'.repeat(s.heatPeak)}${'☆'.repeat(5 - s.heatPeak)}`],
        ['HACKS USED', String(s.hacks)],
        ['SILENT ENTRY', s.alarmBeforeLoot ? 'NO' : 'YES +$50,000'],
      ];
    },
    steps: [
      {
        id: 'case',
        text: (c) => c.g.heist.objective,
        sub: (c) => c.g.heist.sub,
        target: (c) => c.g.heist.target,
        done: (c) => c.g.heist.backOpen || c.g.bank.isInside(c.g.player.pos.x, c.g.player.pos.z),
      },
      {
        id: 'vault',
        text: (c) => c.g.heist.objective,
        sub: (c) => c.g.heist.sub,
        target: (c) => c.g.heist.target,
        done: (c) => c.g.heist.vaultOpen,
        checkpoint: {
          restore: (c) => {
            bankInside(c);
            c.g.player.spawn(-78, -42.5, 0);
          },
        },
      },
      {
        id: 'loot',
        text: (c) => c.g.heist.objective,
        sub: (c) => c.g.heist.sub,
        target: (c) => c.g.heist.target,
        done: (c) => c.g.heist.hasLoot,
      },
      {
        // the heist itself reports the win when you reach the drop unseen
        id: 'escape',
        text: (c) => c.g.heist.objective,
        sub: (c) => c.g.heist.sub,
        target: (c) => c.g.heist.target,
        checkpoint: {
          restore: (c) => {
            const { g } = c;
            bankInside(c);
            g.heist.vaultOpen = true;
            g.bank.openDoor(g.bank.doors.find((d) => d.name === 'Vault door')!);
            g.heist.giveLoot();
            g.player.spawn(-85, -42, Math.PI / 2);
            g.police.minHeat = 1;
            g.police.setHeat(2, 'bank alarm');
          },
        },
      },
    ],
  },
];
