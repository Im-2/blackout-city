// The heist loop: case -> infiltrate -> vault -> loot (alarm) -> escape -> drop.
import * as THREE from 'three';
import type { Game } from '../core/game';
import type { Door } from '../world/bank';
import type { SecCam } from '../ai/cameras';

export interface Stats {
  start: number;
  time: number;
  loot: number;
  heatPeak: number;
  hacks: number;
  alarmBeforeLoot: boolean;
}

export type Outcome = 'won' | 'busted' | 'wrecked';

const ga0 = (g: Game) => !!g.getawayCar && !g.getawayCar.wrecked;

export class Heist {
  /** only true while the bank mission is running */
  active = false;
  alarm = false;
  hasLoot = false;
  suspicion = 0;
  private seenThisFrame = false;
  stats: Stats = { start: 0, time: 0, loot: 0, heatPeak: 0, hacks: 0, alarmBeforeLoot: false };
  outcome: Outcome | null = null;
  objective = '';
  sub = '';
  target = new THREE.Vector3();
  private alarmT = 0;
  private dropT = 0;
  private garageOpen = 0;
  vaultOpen = false;
  private lootSpot: import('../player/player').Interactable | null = null;
  backOpen = false;

  constructor(private g: Game) {}

  reset() {
    this.active = false;
    this.alarm = false;
    this.hasLoot = false;
    this.suspicion = 0;
    this.outcome = null;
    this.vaultOpen = false;
    this.backOpen = false;
    this.alarmT = 0;
    this.dropT = 0;
    this.garageOpen = 0;
    this.stats = { start: this.g.time, time: 0, loot: 0, heatPeak: 0, hacks: 0, alarmBeforeLoot: false };
    const bank = this.g.bank;
    bank.lootTaken = false;
    bank.loot.visible = true;
    for (const d of bank.doors) { d.locked = true; d.target = 0; d.open = 0; d.col.enabled = true; }
    if (this.lootSpot) { const i = this.g.interactables.indexOf(this.lootSpot); if (i >= 0) this.g.interactables.splice(i, 1); }
    this.g.interactables.push(this.lootSpot = {
      pos: bank.lootPos,
      radius: 2.6,
      label: 'Grab the loot',
      enabled: () => this.active && !this.hasLoot && !bank.lootTaken,
      action: () => this.grabLoot(),
    });
  }

  /** mission start: a clean bank with guards back on patrol */
  begin() {
    this.reset();
    this.active = true;
    this.g.guards.reset();
  }

  /** mission over, however it went */
  end() {
    this.reset();
    this.g.police.minHeat = 0;
    this.g.guards.reset();
  }

  /** checkpoint: the bag is already in hand */
  giveLoot() {
    const bank = this.g.bank;
    this.hasLoot = true;
    this.alarm = true;
    bank.lootTaken = true;
    bank.loot.visible = false;
    this.stats.loot = 250000;
    this.stats.alarmBeforeLoot = true;
  }

  onDoorHacked(d: Door) {
    if (d.name === 'Vault door') this.vaultOpen = true;
    if (d.name === 'Back door') this.backOpen = true;
  }

  private grabLoot() {
    const g = this.g;
    this.hasLoot = true;
    g.bank.lootTaken = true;
    g.bank.loot.visible = false;
    this.stats.loot = 250000 + (this.alarm ? 0 : 50000);
    this.stats.alarmBeforeLoot = this.alarm;
    g.fx.spawn('money', g.bank.lootPos, 26);
    g.audio.loot();
    g.camRig.addShake(0.2);
    this.triggerAlarm('LOOT GRABBED — ALARM!');
    g.news.report('bank', g.player.pos.x, g.player.pos.z);
    g.peds.witnessCrime(g.player.pos, 'robbery', 2);
    g.police.minHeat = 1;
  }

  triggerAlarm(msg = 'ALARM TRIPPED') {
    const g = this.g;
    if (!this.alarm) {
      this.alarm = true;
      g.hud.toast(msg, 'heat');
      g.audio.alarmBell(30);
      g.post.triggerFlash('#ff2a1a', 0.35);
    }
    g.guards.alertAll(g.player.pos);
    g.police.crime(2, 'bank alarm');
  }

  /** called by cameras / guards when they see the player */
  spotted(source: 'camera' | 'guard', dt: number) {
    const g = this.g;
    const P = g.player.worldPos;
    if (!this.active || this.alarm || !g.bank.isRestricted(P.x, P.z)) return;
    this.seenThisFrame = true;
    this.suspicion += dt * (source === 'guard' ? 1.1 : 0.7);
    if (this.suspicion >= 1) this.triggerAlarm(source === 'guard' ? 'GUARD RAISED THE ALARM' : 'CAMERA TRIPPED THE ALARM');
  }

  update(dt: number) {
    const g = this.g;
    if (!this.seenThisFrame) this.suspicion = Math.max(0, this.suspicion - dt * 0.15);
    this.seenThisFrame = false;
    if (this.alarm) this.alarmT += dt;
    this.stats.heatPeak = Math.max(this.stats.heatPeak, g.police.heat);
    if (!this.active) {
      // the garage stays shut outside the mission
      this.garageOpen = 0;
      g.city.garageDoor.position.y = 0.15;
      if (g.garageDoorCol) g.garageDoorCol.enabled = true;
      return;
    }
    if (this.outcome) return;
    this.stats.time = g.time - this.stats.start;

    const bank = g.bank;
    const P = g.player.worldPos;
    const inBank = bank.isInside(P.x, P.z);
    const drop = g.city.dropZone;
    const v = g.player.vehicle;
    const backCamsLive = g.cameras.cams.some((c) => c.bank && !c.inside && !g.cameras.isOffline(c));

    // objective + marker
    if (!this.hasLoot) {
      if (!this.backOpen && !inBank) {
        this.objective = 'Hack the bank\'s back door';
        this.sub = backCamsLive ? 'Hold Q: blind the alley cameras first' : 'Hold Q and click the door';
        this.target.set(-78, 2, -41);
      } else if (!this.vaultOpen) {
        this.objective = 'Reach the vault door and hack it';
        this.sub = 'Avoid the guards\' vision cones';
        this.target.set(-84, 2, -32.5);
      } else {
        this.objective = 'Grab the loot';
        this.sub = 'It will trip the alarm';
        this.target.copy(bank.lootPos);
      }
    } else if (!v) {
      this.objective = 'Get to a car';
      this.sub = ga0(g) ? 'The getaway is behind the bank, but anything with wheels will do' : 'Getaway car\'s gone. Steal something';
      const ga = g.getawayCar;
      if (ga && !ga.wrecked) this.target.copy(ga.pos).setY(1.5);
      else this.target.copy(P);
    } else {
      this.objective = 'Drive to the drop: Old Garage';
      const seen = g.police.lastSeenT < 3;
      this.sub = seen ? 'Lose the cops before you enter the drop!' : g.police.heat > 0 ? 'They lost sight of you — go!' : 'Clean. Bring it home.';
      this.target.set(drop.doorX, 2, drop.doorZ);
    }

    // garage door opens when you approach with the loot and nobody is watching
    const atDoor = Math.hypot(P.x - drop.doorX, P.z - drop.doorZ) < 26;
    const unseen = g.police.lastSeenT > 3;
    this.garageOpen = THREE.MathUtils.damp(this.garageOpen, this.hasLoot && atDoor && unseen ? 1 : 0, 3, dt);
    g.city.garageDoor.position.y = 0.15 + this.garageOpen * 4.2;
    const doorBox = g.garageDoorCol;
    if (doorBox) doorBox.enabled = this.garageOpen < 0.7;

    // win
    const inDrop = Math.abs(P.x - drop.x) < drop.w / 2 && Math.abs(P.z - drop.z) < drop.d / 2;
    if (this.hasLoot && inDrop) {
      this.dropT += dt;
      if (unseen && this.dropT > 0.6) this.finish('won');
    } else this.dropT = 0;

  }

  finish(o: Outcome) {
    if (this.outcome) return;
    this.outcome = o;
    this.stats.time = this.g.time - this.stats.start;
    if (o !== 'won') { this.stats.loot = 0; return; }
    const g = this.g;
    g.hud.toast('CLEAN GETAWAY', 'win');
    g.police.minHeat = 0;
    g.police.setHeat(0);
    g.missions.complete();
  }
}
