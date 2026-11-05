// Enterable, hackable buildings. Exteriors are always present; interiors are
// built with the Kit when the player gets close and streamed out when far.
//  - Shop row (block 2,3): MART 24 (register robbery), GEMS & CO (lasers,
//    cases, safe), PAWN & LOAN (fence: sell loot, buy clothes)
//  - The player's home + garage (behind the shops): see home.ts
//  - Police station (block 4,3): records room hack, cells, officers
//  - Parking garage (block 3,4): 3 levels, ramps, respray booth, cars to swap
//  - Office tower (block 3,3): lobby security, elevator, server room, rooftop
//    helipad + ziplines
//  - Stubs: warehouse (5,4) and arcade (0,3) — closed
import * as THREE from 'three';
import { PAL } from '../core/palette';
import { Rng } from '../core/math';
import { Kit } from './interior';
import { Home } from './home';
import { Stores, STORE_BLOCKS } from './stores';
import { Properties, PROPERTY_BLOCKS } from './properties';
import { GeoBuilder } from './geo';
import { worldMat } from '../render/patch';
import { worldMaterials } from './materials';
import { BLOCKS, CURB_H, surfaces } from './layout';
import { RigCharacter } from '../characters/rig';
import { makePedSkin } from '../characters/pedTypes';
import type { City } from './city';
import type { Game } from '../core/game';
import type { Hackable } from '../hacking/hack';
import type { Interactable } from '../player/player';
import type { Vehicle } from '../vehicles/vehicle';

export interface Site {
  id: string;
  name: string;
  open: boolean;
  x0: number; z0: number; x1: number; z1: number;
  door: { x: number; z: number; heading: number };
  ceiling: number;
  /** ignored above this height (so the roof isn't "inside") */
  maxY?: number;
  /** ignored below this height (a home up a tower) */
  minY?: number;
  /** called as it streams out */
  unload?: () => void;
  /** street-facing approach point used for teleports */
  approach: { x: number; z: number; heading: number };
  kit: Kit | null;
  hackables: Hackable[];
  interactables: Interactable[];
  npcs: RigCharacter[];
  cams: unknown[];
  guards: unknown[];
  restricted?: { x0: number; z0: number; x1: number; z1: number };
  build: (kit: Kit, s: Site) => void;
  tick?: (dt: number, s: Site) => void;
  state: Record<string, number | boolean>;
  /** a door lock prank in progress */
  prank?: { t: number; col: import('./collision').AABB | null; mesh: THREE.Object3D | null; was: string[] };
}

export interface Ladder { x: number; z: number; top: number; heading: number; topX: number; topZ: number; }
export interface Zipline { a: THREE.Vector3; b: THREE.Vector3; name: string; }

const RESERVED: Record<string, [number, number]> = {
  shops: [5, 6],
  police: [7, 6],
  garage: [6, 7],
  tower: [6, 6],
  warehouse: [8, 7],
  arcade: [3, 6],
  stuntpark: [6, 10],
  longjump: [4, 10],
  shoreleap: [3, 11],
  ...STORE_BLOCKS,
  ...PROPERTY_BLOCKS,
};

export class Buildings {
  sites: Site[] = [];
  ladders: Ladder[] = [];
  ziplines: Zipline[] = [];
  ext = new GeoBuilder();
  home!: Home;
  private extFacade = new Map<string, GeoBuilder>();
  private rng = new Rng(808);
  private t = 0;

  constructor(private g: Game) {}

  /** must run before city.build() so those blocks stay empty */
  static reserve(city: City) {
    for (const [name, [bi, bj]] of Object.entries(RESERVED)) city.reserved.set(bj * BLOCKS + bi, name);
  }

  facade(style: string) {
    let b = this.extFacade.get(style);
    if (!b) this.extFacade.set(style, (b = new GeoBuilder()));
    return b;
  }

  /** hollow shell walls (facade outside) with door gaps + roof; solid above `solidFrom` */
  shell(x0: number, z0: number, x1: number, z1: number, top: number, style: string, doors: { side: 'n' | 's' | 'e' | 'w'; at: number; w: number; h: number }[], trim = '#6b6760') {
    const g = this.g;
    const f = this.facade(style);
    const tile = (worldMaterials().facades as Record<string, { tile: [number, number] }>)[style].tile;
    const t = 0.5;
    const wall = (ax0: number, az0: number, ax1: number, az1: number, y0: number, y1: number) => {
      f.box(ax0, y0, az0, ax1, y1, az1, { tile });
      g.col.add(ax0, y0, az0, ax1, y1, az1, true, 'building');
    };
    const sides: ['n' | 's' | 'e' | 'w', number, number][] = [['n', x0, x1], ['s', x0, x1], ['w', z0, z1], ['e', z0, z1]];
    for (const [side, a0, a1] of sides) {
      const gaps = doors.filter((d) => d.side === side).sort((p, q) => p.at - q.at);
      let cur = a0;
      const seg = (s0: number, s1: number, y0: number, y1: number) => {
        if (s1 - s0 < 0.01) return;
        if (side === 'n') wall(s0, z0, s1, z0 + t, y0, y1);
        else if (side === 's') wall(s0, z1 - t, s1, z1, y0, y1);
        else if (side === 'w') wall(x0, s0, x0 + t, s1, y0, y1);
        else wall(x1 - t, s0, x1, s1, y0, y1);
      };
      for (const d of gaps) { seg(cur, d.at - d.w / 2, 0, top); seg(d.at - d.w / 2, d.at + d.w / 2, CURB_H + d.h, top); cur = d.at + d.w / 2; }
      seg(cur, a1, 0, top);
    }
    // roof + parapet (walkable)
    this.ext.box(x0 - 0.2, top, z0 - 0.2, x1 + 0.2, top + 0.3, z1 + 0.2, { color: '#6e6b65', shadeSides: true });
    g.col.add(x0, top - 0.3, z0, x1, top + 0.3, z1, false, 'roof');
    this.ext.box(x0 - 0.3, top - 0.6, z0 - 0.3, x1 + 0.3, top, z1 + 0.3, { color: trim, shadeSides: true, skip: { py: true } });
    surfaces.push({ x0, z0, x1, z1, h0: top + 0.3 });
  }

  build() {
    const g = this.g;
    this.buildShops();
    this.home = new Home(g, this);
    this.home.buildExterior();
    this.buildPolice();
    this.buildGarage();
    this.buildTower();
    this.buildStubs();
    new Stores(g, this).build();
    g.properties = new Properties(g, this);
    g.properties.build();
    this.buildLadders();
    this.buildZiplines();
    // flush exteriors
    const M = worldMaterials();
    const ext = new THREE.Mesh(this.ext.build(), M.props);
    ext.castShadow = true;
    ext.receiveShadow = true;
    g.scene.add(ext);
    for (const [style, b] of this.extFacade) {
      const m = new THREE.Mesh(b.build(), (M.facades as Record<string, { lit: THREE.Material }>)[style].lit);
      m.castShadow = true;
      m.receiveShadow = true;
      g.scene.add(m);
    }
    return this;
  }

  site(p: Omit<Site, 'kit' | 'hackables' | 'interactables' | 'npcs' | 'cams' | 'guards' | 'state'>): Site {
    const s: Site = { ...p, kit: null, hackables: [], interactables: [], npcs: [], cams: [], guards: [], state: {} };
    this.sites.push(s);
    return s;
  }

  sign(text: string, x: number, y: number, z: number, heading: number, w: number, bg: string, fg: string) {
    const k = new Kit(this.g.col);
    k.sign(text, x, y, z, heading, w, w * 0.19, bg, fg);
    k.finish(this.g.scene);
  }

  private storefront(x0: number, x1: number, z: number, doorX: number, glow = '#a8905c') {
    // big lit windows either side of the door, on the north face (z = wall plane)
    for (const [a, b] of [[x0 + 0.6, doorX - 1.2], [doorX + 1.2, x1 - 0.6]]) {
      if (b - a < 0.8) continue;
      this.ext.box(a, CURB_H + 0.8, z - 0.06, b, CURB_H + 3.0, z - 0.01, { color: '#25292e' });
      const k = new Kit(this.g.col);
      k.glow.box(a + 0.1, CURB_H + 0.9, z - 0.08, b - 0.1, CURB_H + 2.9, z - 0.06, { color: glow });
      k.finish(this.g.scene);
    }
    this.ext.box(doorX - 1.1, CURB_H + 2.7, z - 0.9, doorX + 1.1, CURB_H + 2.8, z, { color: '#3a3c3e' }); // canopy
  }

  // ------------------------------------------------------------------ shops
  private buildShops() {
    const g = this.g;
    const z0 = 11, z1 = 23, top = 5.2;
    const units: [string, number, number, number, string, string][] = [
      ['mart', -45, -33.7, -40.5, 'MART 24', '#3f7b88'],
      ['jewel', -33.7, -22.4, -28, 'GEMS & CO', '#6e3f5c'],
      ['pawn', -22.4, -11, -16.7, 'PAWN & LOAN', '#7b4a34'],
    ];
    this.shell(-45, z0, -11, z1, top, 'concrete', units.map((u) => ({ side: 'n' as const, at: u[3], w: 1.8, h: 2.6 })));
    for (const [id, x0, x1, dx, label, col] of units) {
      this.storefront(x0, x1, z0, dx, id === 'jewel' ? '#8a7498' : '#a8905c');
      this.ext.box(x0 + 0.2, CURB_H + 3.3, z0 - 0.15, x1 - 0.2, CURB_H + 4.5, z0 - 0.02, { color: col });
      this.sign(label, (x0 + x1) / 2, CURB_H + 3.9, z0 - 0.17, Math.PI, Math.min(8, x1 - x0 - 1), col, '#fff1c0');
      if (x1 < -11.1) { g.col.add(x1 - 0.15, 0, z0, x1 + 0.15, top, z1, true, 'building'); this.ext.box(x1 - 0.15, CURB_H, z0 + 0.5, x1 + 0.15, top, z1 - 0.5, { color: '#a89c86' }); }
    }

    // MART 24 -------------------------------------------------------
    this.site({
      id: 'mart', name: 'Mart 24', open: true, x0: -44.7, z0: 11.5, x1: -33.9, z1: 22.5, ceiling: 4.6,
      door: { x: -40.5, z: 10, heading: Math.PI }, approach: { x: -40.5, z: 8.5, heading: 0 },
      build: (k, s) => {
        k.room(-44.7, 11.5, -33.9, 22.5, { h: 4.6, floor: '#c8c3b5', floor2: '#a8a294', skip: ['n', 's', 'e', 'w'] });
        for (let x = -44; x < -39; x += 2.2) k.shelf(x, 15, x + 1.0, 21.5);
        k.shelf(-37.5, 21.6, -34.2, 22.3, 0.15, 2.0);
        k.counter(-37.2, 12.4, -34.4, 14.0);
        k.glow.cbox(-35.6, 1.4, 13.2, 0.5, 0.3, 0.4, { color: '#5aa0a8' });
        k.block(-44.4, 0.15, 12.0, -43.0, 1.9, 13.2, '#d8d6cf'); // fridge
        k.glow.box(-43.0, 0.4, 12.1, -42.98, 1.8, 13.1, { color: '#a8d8e8' });
        const clerk = this.npc(k, 'vendor', -35.4, 15.2, Math.PI, s);
        s.state.robbed = false;
        s.interactables.push({
          pos: new THREE.Vector3(-36.2, 0.15, 11.6), radius: 2.2, label: 'Rob the register',
          enabled: () => !s.state.robbed,
          action: () => {
            s.state.robbed = true;
            g.loot.add({ id: 'register', name: 'Register cash', value: 600 });
            g.fx.spawn('money', new THREE.Vector3(-35.6, 1.4, 13.2), 14);
            g.audio.cash();
            clerk.state = 'handsup';
            // a known name doesn't get reported: they just hand it over
            if (g.rep.tierHere >= 2) g.hud.say('CLERK', 'Here, take it. I didn\'t see a thing.');
            else this.caller(s, clerk, new THREE.Vector3(-35.4, 0, 15.2), 'store');
            if (!this.camBlind(s)) g.police.crime(1, 'store camera');
          },
        });
        this.hack(s, {
          kind: 'register', label: 'Cash register', pos: new THREE.Vector3(-35.6, 1.4, 13.2), size: new THREE.Vector3(0.6, 0.4, 0.5), range: 18,
          available: () => !s.state.registerHacked,
          act: () => { s.state.registerHacked = true; g.loot.add({ id: 'register-quiet', name: 'Card skim', value: 350 }); g.audio.cash(); return 'REGISTER SKIMMED +$350'; },
        });
        this.cam(s, new THREE.Vector3(-44.3, 3.9, 22.1), Math.PI * 0.78, -0.55);
        this.vend(k, s, -38.6, 22.0);
        this.npc(k, 'local', -41, 13.6, Math.PI / 2, s); // a customer
        this.prankDoor(k, s, -40.5, 11, ['CLERK', 'The door! Why won\'t the door...'], ['CUSTOMER', 'I only came in for milk!']);
      },
    });

    // GEMS & CO -------------------------------------------------------
    this.site({
      id: 'jewel', name: 'Gems & Co', open: true, x0: -33.5, z0: 11.5, x1: -22.6, z1: 22.5, ceiling: 4.6,
      door: { x: -28, z: 10, heading: Math.PI }, approach: { x: -28, z: 8.5, heading: 0 },
      restricted: { x0: -33.5, z0: 11.5, x1: -22.6, z1: 22.5 },
      build: (k, s) => {
        k.room(-33.5, 11.5, -22.6, 22.5, { h: 4.6, floor: '#2a2430', floor2: '#3a3442', wall: '#6e5a72', skip: ['n', 's', 'e', 'w'] });
        // closed for the night: the street door has to be hacked open
        const lock = k.solid(-28.9, 0, 10.9, -27.1, 2.75, 11.6, true);
        const lockMesh = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.6, 0.1), worldMat({ color: '#c8a8d8' }));
        lockMesh.position.set(-28, 1.45, 10.95);
        k.group.add(lockMesh);
        this.hack(s, {
          kind: 'door', label: 'Gems & Co door', pos: new THREE.Vector3(-28, 1.5, 11), size: new THREE.Vector3(2, 2.8, 0.6), range: 25,
          available: () => !s.state.unlocked,
          act: () => { s.state.unlocked = true; lock.enabled = false; lockMesh.visible = false; g.audio.unlock(); g.peds.witnessCrime(new THREE.Vector3(-28, 0, 9), 'break-in', 1); return 'GEMS & CO UNLOCKED'; },
        });
        const cases: [number, number][] = [[-31.5, 16.5], [-28, 16.5], [-24.5, 16.5], [-28, 20]];
        s.state.lasers = true;
        cases.forEach(([x, z], i) => {
          k.block(x - 0.9, 0.15, z - 0.5, x + 0.9, 1.05, z + 0.5, '#3a3442');
          k.props.box(x - 0.85, 1.05, z - 0.45, x + 0.85, 1.5, z + 0.45, { color: '#9fc4d0' });
          k.glow.cbox(x, 1.12, z, 1.2, 0.06, 0.5, { color: '#ffe8a8' });
          k.glow.cbox(x - 0.3, 1.2, z, 0.12, 0.08, 0.12, { color: '#9fe8ff' });
          k.glow.cbox(x + 0.3, 1.2, z, 0.12, 0.08, 0.12, { color: '#ff9ad8' });
          s.state[`case${i}`] = false;
          s.interactables.push({
            pos: new THREE.Vector3(x, 0.15, z - 1.0), radius: 1.6, label: 'Smash display case',
            enabled: () => !s.state[`case${i}`],
            action: () => {
              s.state[`case${i}`] = true;
              g.fx.spawn('glass', new THREE.Vector3(x, 1.3, z), 20);
              g.audio.pop();
              g.loot.add({ id: `jewels${i}`, name: 'Jewels', value: 1500 });
              this.siteAlarm(s, 'JEWELRY ALARM', 2);
            },
          });
        });
        // laser grid between the door and the cases
        const beams = new THREE.Group();
        for (let y = 0.5; y < 2.4; y += 0.45) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(10.6, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: '#ff2a1a' }));
          m.position.set(-28.05, y, 14.2 + (y * 3) % 0.6);
          beams.add(m);
        }
        k.group.add(beams);
        s.state.laserT = 0;
        s.tick = (dt) => {
          beams.visible = !!s.state.lasers && Math.sin(this.t * 30) > -0.8;
          if (!s.state.lasers || s.state.alarm) return;
          const P = g.player.pos;
          if (!g.player.vehicle && P.x > -33.4 && P.x < -22.7 && Math.abs(P.z - 14.4) < 0.45 && P.y < 2.4) this.siteAlarm(s, 'LASER TRIPPED', 2);
          void dt;
        };
        this.hack(s, {
          kind: 'laser', label: 'Laser grid', pos: new THREE.Vector3(-32.9, 1.6, 12.4), size: new THREE.Vector3(0.4, 0.7, 0.5), range: 22,
          available: () => !!s.state.lasers,
          act: () => { s.state.lasers = false; return 'LASER GRID OFFLINE'; },
        });
        k.block(-33.4, 1.2, 12.1, -33.1, 1.9, 12.7, '#3a3c3e');
        k.glow.box(-33.1, 1.4, 12.2, -33.08, 1.8, 12.6, { color: '#ff3a2a' });
        // safe in the back
        k.block(-24.6, 0.15, 21.4, -23.0, 1.6, 22.4, '#5a5c5e');
        k.props.box(-24.4, 0.4, 21.38, -23.2, 1.4, 21.4, { color: '#8e9092' });
        this.hack(s, {
          kind: 'safe', label: 'Wall safe', pos: new THREE.Vector3(-23.8, 0.9, 21.4), size: new THREE.Vector3(1.7, 1.5, 1.1), range: 10,
          available: () => !s.state.safe,
          act: () => { s.state.safe = true; g.loot.add({ id: 'diamonds', name: 'Diamonds', value: 4000 }); g.fx.spawn('money', new THREE.Vector3(-23.8, 1, 21), 18); g.audio.loot(); return 'SAFE CRACKED — DIAMONDS'; },
        });
        this.hack(s, {
          kind: 'alarmpanel', label: 'Alarm panel', pos: new THREE.Vector3(-22.9, 1.6, 12.4), size: new THREE.Vector3(0.4, 0.6, 0.5), range: 22,
          available: () => !s.state.silenced,
          act: () => { s.state.silenced = true; return 'ALARM SILENCED'; },
        });
        this.cam(s, new THREE.Vector3(-22.9, 3.9, 22.1), -Math.PI * 0.78, -0.55);
      },
    });

    // PAWN & LOAN -----------------------------------------------------
    this.site({
      id: 'pawn', name: 'Pawn & Loan', open: true, x0: -22.2, z0: 11.5, x1: -11.3, z1: 22.5, ceiling: 4.6,
      door: { x: -16.7, z: 10, heading: Math.PI }, approach: { x: -16.7, z: 8.5, heading: 0 },
      build: (k, s) => {
        k.room(-22.2, 11.5, -11.3, 22.5, { h: 4.6, floor: '#6b5a44', floor2: '#5d4e3c', wall: '#8a7a5a', skip: ['n', 's', 'e', 'w'] });
        k.counter(-21.5, 17.5, -12.0, 18.4, 0.15, '#4a3a2a');
        for (let x = -21.6; x < -12.5; x += 2.4) k.shelf(x, 21.6, x + 1.8, 22.3, 0.15, 2.4);
        // junk on the counter
        k.props.cbox(-19, 1.4, 17.9, 0.5, 0.4, 0.4, { color: '#c4a03c' });
        k.props.cbox(-15, 1.35, 17.9, 0.7, 0.3, 0.3, { color: '#2a2a2a' });
        // clothing rail
        k.block(-21.6, 0.15, 12.4, -19.4, 0.2, 13.6, '#3a3c3e');
        k.props.box(-21.5, 1.8, 12.95, -19.5, 1.85, 13.05, { color: '#8a8a84' });
        ['#c96a3a', '#d8782a', '#23283a', '#c4a03c', '#6e6a62'].forEach((c, i) => k.props.box(-21.4 + i * 0.4, 0.8, 12.75, -21.1 + i * 0.4, 1.8, 13.25, { color: c }));
        this.npc(k, 'local', -16.5, 19.4, Math.PI, s);
        this.npc(k, 'tourist' as 'local', -18.6, 14.6, 0, s); // a browser
        this.prankDoor(k, s, -16.7, 11, ['FENCE', 'Very funny! Who\'s doing this?'], ['CUSTOMER', 'Do you sell keys?']);
        s.interactables.push({
          pos: new THREE.Vector3(-16.5, 0.15, 16.6), radius: 2.0, label: 'Sell loot to the fence',
          enabled: () => g.loot.carried.length > 0,
          action: () => g.loot.sellAll(),
        });
        s.interactables.push({
          pos: new THREE.Vector3(-20.5, 0.15, 14.3), radius: 1.8, label: 'Buy second-hand clothes',
          enabled: () => true,
          action: () => g.shopUi.open('pawn', 'PAWN & LOAN'),
        });
      },
    });
  }

  // ------------------------------------------------------------------ police
  private buildPolice() {
    const g = this.g;
    const x0 = 69, x1 = 99, z0 = 13, z1 = 33, top = 7.0;
    this.shell(x0, z0, x1, z1, top, 'concrete', [{ side: 'n', at: 84, w: 2.4, h: 2.8 }], '#3e5870');
    this.ext.box(x0 - 0.3, 5.2, z0 - 0.4, x1 + 0.3, 6.0, z0 - 0.05, { color: '#2f3b4d' });
    this.sign('POLICE', 84, 5.6, z0 - 0.45, Math.PI, 7, '#2f3b4d', '#e8e2d0');
    for (let k = 0; k < 3; k++) { const zz = z0 - 0.4 - k * 0.8; this.ext.box(80, 0, zz - 0.8, 88, CURB_H + 0.15 * (3 - k), zz, { color: '#9a958b' }); }
    for (const x of [79, 89]) { this.ext.cbox(x, 4, z0 - 1.5, 0.15, 8, 0.15, { color: PAL.metal }); }
    this.ext.box(79.1, 6.6, z0 - 1.5, 80.4, 7.4, z0 - 1.45, { color: '#2f3b4d' });
    for (let x = x0 + 2; x < x1 - 1; x += 4) { const k = new Kit(g.col); k.glow.box(x, 3.6, z0 - 0.06, x + 2.2, 4.6, z0 - 0.02, { color: '#7c8a98' }); k.finish(g.scene); }
    this.site({
      id: 'police', name: 'Police station', open: true, x0: 69.5, z0: 13.5, x1: 98.5, z1: 32.5, ceiling: 4.2,
      door: { x: 84, z: 11.5, heading: Math.PI }, approach: { x: 84, z: 9, heading: 0 },
      restricted: { x0: 69.5, z0: 19.5, x1: 98.5, z1: 32.5 },
      build: (k, s) => {
        k.room(69.5, 13.5, 98.5, 19.5, { h: 4.2, floor: '#8a8f98', floor2: '#7a7f88', wall: '#a8b0b8', skip: ['n', 'w', 'e'], doors: [{ side: 's', at: 95.5, w: 1.6 }] });
        k.room(69.5, 19.5, 98.5, 32.5, { h: 4.2, floor: '#6e7278', wall: '#a8b0b8', skip: ['n', 's', 'w', 'e'] });
        k.counter(78, 17.4, 90, 18.4, 0.15, '#3e5870');
        k.block(70, 0.15, 14.5, 73, 0.55, 15.4, '#5b4330');
        k.block(70, 0.15, 16.6, 73, 0.55, 17.5, '#5b4330');
        // records room (west) + cells (east)
        k.room(69.5, 24, 80, 32.5, { h: 4.2, floor: '#5a5e64', wall: '#8a929a', ceiling: false, skip: ['s', 'w'], doors: [{ side: 'n', at: 77.5, w: 1.4 }, { side: 'e', at: 26, w: 0.01 }] });
        for (let x = 70.5; x < 79; x += 1.6) k.shelf(x, 29, x + 0.8, 32, 0.15, 2.4, false);
        k.block(72, 0.15, 25.5, 75, 1.4, 26.5, '#3a3c3e');
        k.glow.cbox(73.5, 1.6, 25.5, 2.4, 0.6, 0.05, { color: '#46e6ff' });
        for (let x = 88; x < 98.5; x += 3.5) {
          for (let b = 0; b < 3.2; b += 0.35) k.solid(x + b, 0.15, 25.5, x + b + 0.06, 3, 25.6, false);
          for (let b = 0; b < 3.2; b += 0.35) k.props.box(x + b, 0.15, 25.5, x + b + 0.06, 3, 25.6, { color: '#3a3c3e' });
          k.block(x + 3.3, 0.15, 25.5, x + 3.5, 4.2, 32.5, '#8a929a', true);
          k.block(x + 0.4, 0.15, 30.5, x + 2.4, 0.6, 32, '#5a5c5e');
        }
        for (let x = 82; x < 87; x += 2.5) { k.block(x, 0.15, 21, x + 1.6, 0.95, 22.2, '#4a3a2a'); k.glow.cbox(x + 0.8, 1.3, 21.1, 0.6, 0.4, 0.05, { color: '#5aa0a8' }); }
        this.hack(s, {
          kind: 'door', label: 'Records room door', pos: new THREE.Vector3(77.5, 1.5, 24), size: new THREE.Vector3(1.6, 2.8, 0.6), range: 14,
          available: () => !s.state.recordsOpen,
          act: () => { s.state.recordsOpen = true; return 'RECORDS DOOR UNLOCKED'; },
        });
        const door = k.solid(76.8, 0.15, 23.8, 78.2, 2.75, 24.2, true);
        k.props.box(76.8, 0.15, 23.85, 78.2, 2.75, 24.15, { color: '#4d5457' });
        s.tick = () => {
          door.enabled = !s.state.recordsOpen;
          // station officers spot trespassers behind the desk
          const P = g.player.pos;
          const r = s.restricted!;
          if (!g.player.vehicle && P.x > r.x0 && P.x < r.x1 && P.z > r.z0 && P.z < r.z1 && g.police.heat < 2) {
            for (const n of s.npcs) {
              const d = Math.hypot(n.root.position.x - P.x, n.root.position.z - P.z);
              if (d < 12 && g.col.lineOfSight(n.root.position.x, 1.7, n.root.position.z, P.x, P.y + 1.2, P.z)) { g.police.crime(2, 'trespassing at the station'); break; }
            }
          }
        };
        this.hack(s, {
          kind: 'records', label: 'Records server', pos: new THREE.Vector3(73.5, 1.5, 26), size: new THREE.Vector3(3.2, 1.4, 1.2), range: 9,
          available: () => !s.state.wiped && !!s.state.recordsOpen,
          act: () => {
            s.state.wiped = true;
            g.police.heat = Math.max(g.police.minHeat, g.police.heat - 2);
            g.police.knownVehicle = null;
            g.disguise.forget();
            g.routes.scores.fill(0);
            g.routes.save();
            g.police.watched = [];
            return 'RECORD ERASED — HEAT -2, ROUTES FORGOTTEN';
          },
        });
        const cop = (x: number, z: number, h: number) => {
          const n = new RigCharacter({ ...makePedSkin('security', this.rng), top: '#232c40', pants: '#20283a', badge: true, topStyle: 'uniform', key: `stationcop${this.rng.int(0, 1e6)}` });
          n.root.position.set(x, 0.15, z);
          n.root.rotation.y = h;
          k.group.add(n.root);
          s.npcs.push(n);
        };
        cop(84, 19.2, Math.PI);
        cop(83, 22.8, Math.PI);
        cop(92, 23, -Math.PI / 2);
        this.cam(s, new THREE.Vector3(70, 3.8, 14), Math.PI * 0.7, -0.45);
        this.cam(s, new THREE.Vector3(98, 3.8, 20.5), -Math.PI * 0.75, -0.5);
      },
    });
    // cruisers in the back lot
    this.policeLot = [{ x: 74, z: 39.5, h: 0 }, { x: 80, z: 39.5, h: 0 }, { x: 86, z: 39.5, h: 0 }];
  }
  policeLot: { x: number; z: number; h: number }[] = [];

  // ------------------------------------------------------------------ garage
  private buildGarage() {
    const g = this.g;
    const x0 = 11, x1 = 45, z0 = 67, z1 = 101;
    const L1 = 3.8, L2 = 7.6;
    const e = this.ext;
    const concrete = '#8f8b83';
    // columns
    for (let x = x0 + 0.5; x <= x1; x += 8.5) for (let z = z0 + 0.5; z <= z1; z += 8.5) {
      if (x > 38 && z > 74 && z < 96) continue; // keep the up-ramp clear
      if (x < 18 && z > 74 && z < 96) continue;
      e.cbox(x, L2 / 2, z, 0.6, L2, 0.6, { color: concrete, shadeSides: true });
      g.col.addCentered(x, z, 0.6, 0.6, L2, 0, true, 'pillar');
    }
    const slab = (ax0: number, az0: number, ax1: number, az1: number, y: number) => {
      e.box(ax0, y - 0.3, az0, ax1, y, az1, { color: concrete, shadeSides: true });
      g.col.add(ax0, y - 0.3, az0, ax1, y, az1, true, 'deck');
      surfaces.push({ x0: ax0, z0: az0, x1: ax1, z1: az1, h0: y });
    };
    // level 1 deck (hole for the east up-ramp)
    slab(x0, z0, 39, z1, L1);
    slab(39, z0, x1, 75, L1);
    slab(39, 95, x1, z1, L1);
    // roof deck (hole for the west ramp)
    slab(17, z0, x1, z1, L2);
    slab(x0, z0, 17, 75, L2);
    slab(x0, 95, 17, z1, L2);
    // ramps: east ground -> L1 going +z ; west L1 -> roof going -z
    const ramp = (ax0: number, ax1: number, za: number, zb: number, ya: number, yb: number) => {
      const q = new GeoBuilder();
      q.quad([ax0, ya, za], [ax1, ya, za], [ax1, yb, zb], [ax0, yb, zb], [0, 1, 0], 0, 0, 1, 1, [0.5, 0.49, 0.47]);
      q.quad([ax1, ya - 0.3, za], [ax0, ya - 0.3, za], [ax0, yb - 0.3, zb], [ax1, yb - 0.3, zb], [0, -1, 0], 0, 0, 1, 1, [0.4, 0.4, 0.38]);
      e.append(q, new THREE.Matrix4());
      surfaces.push({ x0: ax0, z0: Math.min(za, zb), x1: ax1, z1: Math.max(za, zb), h0: za < zb ? ya : yb, h1: za < zb ? yb : ya, axis: 'z' });
      // side rails
      e.box(ax0 - 0.2, Math.min(ya, yb), Math.min(za, zb), ax0, Math.max(ya, yb) + 1, Math.max(za, zb), { color: concrete });
    };
    ramp(39.2, x1 - 0.3, 75, 95, CURB_H, L1);
    ramp(x0 + 0.3, 16.8, 95, 75, L1, L2);
    // parapets on upper decks (open west side at ground for the entrance)
    for (const y of [L1, L2]) {
      for (const [ax0, az0, ax1, az1] of [[x0, z0, x1, z0 + 0.3], [x0, z1 - 0.3, x1, z1], [x1 - 0.3, z0, x1, z1], [x0, z0, x0 + 0.3, z1]]) {
        e.box(ax0, y, az0, ax1, y + 1.0, az1, { color: '#7a766d', shadeSides: true });
        g.col.add(ax0, y, az0, ax1, y + 1.0, az1, false, 'parapet');
      }
    }
    // ground-floor outer walls (south/east/north), entrance on the west
    for (const [ax0, az0, ax1, az1] of [[x0, z0, x1, z0 + 0.3], [x0, z1 - 0.3, x1, z1], [x1 - 0.3, z0, x1, z1]]) {
      e.box(ax0, 0, az0, ax1, 1.1, az1, { color: '#7a766d' });
      g.col.add(ax0, 0, az0, ax1, 1.1, az1, false, 'parapet');
    }
    e.box(x0, CURB_H, z0, x1, CURB_H + 0.02, z1, { color: '#4a4844' });
    // painted bays
    for (const y of [CURB_H + 0.03, L1 + 0.01, L2 + 0.01]) for (let x = x0 + 4; x < 38; x += 3) e.box(x, y, z0 + 1, x + 0.12, y + 0.01, z0 + 6, { color: PAL.laneYellow });
    // lights on deck undersides
    const lk = new Kit(g.col);
    for (const y of [L1 - 0.32, L2 - 0.32]) for (let x = x0 + 4; x < x1; x += 8) for (let z = z0 + 4; z < z1; z += 8) lk.glow.cbox(x, y, z, 1.2, 0.04, 0.3, { color: '#d8e8c8' });
    lk.sign('P  PARKING', x0 - 0.2, 5.6, 84, -Math.PI / 2, 8, 1.5, '#2f3b4d', '#e8e2d0');
    lk.finish(g.scene);
    // entrance barrier (hackable)
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 6), worldMat({ color: '#d8b020' }));
    bar.position.set(x0 + 0.5, 1.1, 84);
    g.scene.add(bar);
    const barCol = g.col.add(x0 + 0.3, 0, 81, x0 + 0.7, 1.2, 87, false, 'barrier');
    e.cbox(x0 + 0.5, 0.6, 80.6, 0.4, 1.2, 0.4, { color: '#d8b020' });
    this.garageBarrier = { mesh: bar, col: barCol, open: true };
    this.site({
      id: 'garage', name: 'Parking garage', open: true, x0, z0, x1, z1, ceiling: 99,
      door: { x: x0 - 1, z: 84, heading: -Math.PI / 2 }, approach: { x: x0 - 6, z: 88, heading: Math.PI / 2 },
      build: (k, s) => {
        // respray booth
        k.props.box(13, CURB_H + 0.02, 90, 21, CURB_H + 0.04, 99, { color: '#c4a03c' });
        k.block(13, 0.15, 99.2, 21, 3.4, 99.6, '#5a5f64');
        k.glow.cbox(17, 3.4, 94.5, 6, 0.05, 6, { color: '#f8f0d8' });
        k.sign('RESPRAY $200', 17, 2.8, 99.15, Math.PI, 4, 0.8, '#9b3b2f', '#fff1c0');
        s.state.boothT = 0;
        s.tick = () => {
          const v = g.player.vehicle;
          if (v && v.pos.x > 13 && v.pos.x < 21 && v.pos.z > 90 && v.pos.z < 99 && v.pos.y < 1 && v.speedAbs < 2.5)
            g.carAction = { label: `Respray ${v.label.toLowerCase()} ($200)`, action: () => g.shop.respray(v) };
        };
      },
    });
  }
  garageBarrier: { mesh: THREE.Mesh; col: import('./collision').AABB; open: boolean } | null = null;

  // ------------------------------------------------------------------ office tower
  private buildTower() {
    const g = this.g;
    const x0 = 16, x1 = 40, z0 = 15, z1 = 39, top = 48;
    // plinth band + hollow shell
    this.shell(x0, z0, x1, z1, top, 'tower', [{ side: 'n', at: 28, w: 4, h: 3.4 }], '#3b4046');
    this.ext.box(x0 - 0.6, 0, z0 - 0.6, x1 + 0.6, 5.0, z0 + 0.6, { color: '#5a5f64', skip: { py: false } });
    g.col.add(x0 - 0.6, 3.6, z0 - 0.6, x1 + 0.6, 5.0, z0, true, 'building');
    for (const [a, b] of [[x0 - 0.6, 25.8], [30.2, x1 + 0.6]]) g.col.add(a, 0, z0 - 0.6, b, 5.0, z0, true, 'building');
    this.sign('VANTAGE TOWER', 28, 4.3, z0 - 0.65, Math.PI, 9, '#1e2a36', '#9fe8ff');
    const glass = new Kit(g.col);
    glass.glow.box(19, 0.6, z0 - 0.63, 25.6, 3.4, z0 - 0.61, { color: '#7c8a84' });
    glass.glow.box(30.4, 0.6, z0 - 0.63, 37, 3.4, z0 - 0.61, { color: '#7c8a84' });
    glass.finish(g.scene);
    // helipad on the roof
    this.ext.box(22, top + 0.3, 21, 34, top + 0.34, 33, { color: '#4a4c4e' });
    this.ext.box(25.5, top + 0.34, 24, 26.5, top + 0.36, 30, { color: '#e6e0d4' });
    this.ext.box(29.5, top + 0.34, 24, 30.5, top + 0.36, 30, { color: '#e6e0d4' });
    this.ext.box(26.5, top + 0.34, 26.5, 29.5, top + 0.36, 27.5, { color: '#e6e0d4' });
    this.ext.box(37, top + 0.3, 35, 39.5, top + 3.5, 38.5, { color: '#6a6a64', shadeSides: true }); // elevator housing
    g.col.add(37, top, 35, 39.5, top + 3.5, 38.5, true, 'building');
    const SERVER_Y = 24.15, ROOF_Y = top + 0.3;
    this.site({
      id: 'tower', name: 'Vantage Tower', open: true, x0: x0 + 0.5, z0: z0 + 0.5, x1: x1 - 0.5, z1: z1 - 0.5, ceiling: 4.8,
      door: { x: 28, z: z0 - 1.5, heading: Math.PI }, approach: { x: 28, z: 9, heading: 0 },
      restricted: { x0: x0, z0: 25, x1: x1, z1: z1 },
      build: (k, s) => {
        k.room(x0 + 0.5, z0 + 0.5, x1 - 0.5, z1 - 0.5, { h: 4.8, floor: '#c9c1b0', floor2: '#b0a898', skip: ['n', 's', 'e', 'w'] });
        k.counter(24, 20, 32, 21, 0.15, '#2f3b4d');
        k.glow.cbox(28, 1.3, 20.1, 2, 0.4, 0.05, { color: '#46e6ff' });
        // turnstiles (hackable gate) across the lobby
        const gate: import('./collision').AABB[] = [];
        for (let x = x0 + 0.5; x < x1 - 0.5; x += 2) {
          if (Math.abs(x + 1 - 28) < 1.5) continue;
          gate.push(k.block(x, 0.15, 24.8, x + 1.6, 1.1, 25.2, '#5a5f64'));
        }
        const flaps = k.solid(26.6, 0.15, 24.8, 29.4, 1.1, 25.2, false);
        const flapMesh = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.9, 0.1), worldMat({ color: '#9fc4d0' }));
        flapMesh.position.set(28, 0.75, 25);
        k.group.add(flapMesh);
        this.hack(s, {
          kind: 'gate', label: 'Lobby turnstiles', pos: new THREE.Vector3(28, 0.8, 25), size: new THREE.Vector3(3, 1, 0.6), range: 20,
          available: () => !s.state.gate,
          act: () => { s.state.gate = true; return 'TURNSTILES OPEN'; },
        });
        // elevators
        k.block(26, 0.15, 38.4, 30, 4.8, 38.6, '#8a8a84');
        k.glow.cbox(28, 2.8, 38.35, 0.3, 0.3, 0.05, { color: '#ffb000' });
        // server floor
        k.room(x0 + 0.5, z0 + 0.5, x1 - 0.5, z1 - 0.5, { y: SERVER_Y, h: 3.8, floor: '#3a3e44', floor2: '#2e3238', skip: ['n', 's', 'e', 'w'] });
        for (let x = 19; x < 37; x += 3)
          for (const z of [20, 26, 32]) {
            k.block(x, SERVER_Y, z, x + 1.2, SERVER_Y + 2.4, z + 3.5, '#1e2228', true);
            for (let y = 0.3; y < 2.3; y += 0.35) k.glow.box(x + 1.2, SERVER_Y + y, z + 0.3, x + 1.21, SERVER_Y + y + 0.05, z + 3.2, { color: (x + z + y * 10) % 3 > 1 ? '#5aff8a' : '#46e6ff' });
          }
        k.block(26, SERVER_Y, 38.4, 30, SERVER_Y + 3.8, 38.6, '#8a8a84');
        this.hack(s, {
          kind: 'server', label: 'Core server', pos: new THREE.Vector3(34.6, SERVER_Y + 1.2, 33.7), size: new THREE.Vector3(1.4, 2.6, 3.7), range: 14,
          available: () => !s.state.data,
          act: () => {
            s.state.data = true;
            g.loot.add({ id: 'data', name: 'Data drive', value: 3000 });
            g.jobs.onEvent('data');
            return 'DATA STOLEN — DRIVE COPIED';
          },
        });
        // elevator: Lobby -> Server room -> Roof -> Lobby
        const floors = [{ y: 0.15, name: 'LOBBY' }, { y: SERVER_Y, name: 'SERVER ROOM' }, { y: ROOF_Y, name: 'ROOF' }];
        floors.forEach((fl, i) => {
          const next = floors[(i + 1) % floors.length];
          const at = i === 2 ? new THREE.Vector3(36.4, fl.y, 36.5) : new THREE.Vector3(28, fl.y, 37.4);
          s.interactables.push({
            pos: at, radius: 2.2, label: `Elevator to ${next.name}`,
            enabled: () => !s.prank && (i !== 0 || !!s.state.gate || g.police.heat > 0),
            action: () => {
              const dest = i + 1 === 2 ? new THREE.Vector3(35.5, next.y, 34) : new THREE.Vector3(28, next.y, 36);
              g.fadeTeleport(dest.x, dest.y, dest.z, Math.PI, `ELEVATOR — ${next.name}`);
            },
          });
        });
        s.state.gateClosed = true;
        s.tick = () => {
          flaps.enabled = !s.state.gate;
          flapMesh.visible = !s.state.gate;
          for (const b of gate) b.enabled = true;
        };
        // the lift can be held between floors, for laughs
        this.hack(s, {
          kind: 'prank', label: 'Lock the lift', pos: new THREE.Vector3(28, 2.8, 38.3), size: new THREE.Vector3(4, 4.4, 0.6), range: 22,
          available: () => !s.prank,
          act: () => {
            s.prank = { t: 8, col: null, mesh: null, was: [] };
            g.audio.alarmBell(2);
            g.hud.say('LIFT', 'Please remain calm. Someone in here is crying.');
            g.pranks.remember(s.id);
            return 'LIFT LOCKED — 8s';
          },
        });
        // lobby guard + server room guard
        g.guards.addGuard([new THREE.Vector3(22, 0.15, 22), new THREE.Vector3(34, 0.15, 22)], s.id, () => { if (this.trespassing(s)) this.siteAlarm(s, 'TOWER SECURITY ALERT', 1); });
        g.guards.addGuard([new THREE.Vector3(18, SERVER_Y, 24.5), new THREE.Vector3(37.5, SERVER_Y, 24.5), new THREE.Vector3(37.5, SERVER_Y, 30.5), new THREE.Vector3(18, SERVER_Y, 30.5)], s.id, () => this.siteAlarm(s, 'SERVER ROOM BREACH', 2));
        this.cam(s, new THREE.Vector3(x0 + 1, SERVER_Y + 3.3, z1 - 1), Math.PI * 0.75, -0.5);
        this.cam(s, new THREE.Vector3(x1 - 1, 4.2, z0 + 1.2), -Math.PI * 0.25, -0.5);
      },
    });
  }

  // ------------------------------------------------------------------ stubs
  private buildStubs() {
    const g = this.g;
    // warehouse (5,4)
    this.ext.box(123, 0, 67, 157, 9, 99, { color: '#6e6a62', shadeSides: true });
    for (let x = 124; x < 157; x += 1.2) this.ext.box(x, 0.5, 66.9, x + 0.5, 8.5, 67, { color: '#5e5a52' });
    g.col.add(123, 0, 67, 157, 9.4, 99, true, 'building');
    surfaces.push({ x0: 123, z0: 67, x1: 157, z1: 99, h0: 9.4 });
    this.ext.box(123, 9, 66, 157, 9.4, 100, { color: '#4a4844' });
    this.ext.box(132, CURB_H, 66.8, 142, 6, 67, { color: '#7d7a72' });
    this.sign('HARBOR FREIGHT', 140, 7.4, 66.7, Math.PI, 9, '#2f3b4d', '#e8e2d0');
    // crates outside
    for (let i = 0; i < 6; i++) { const x = 126 + i * 2.6, z = 103 - (i % 2) * 2; this.ext.cbox(x, 0.75, z, 2, 1.5, 2, { color: '#7b5a34', shadeSides: true }); g.col.addCentered(x, z, 2, 2, 1.5, 0, false, 'crate'); }
    // arcade (0,3)
    this.ext.box(-155, 0, 11, -125, 8, 33, { color: '#3a2a4a', shadeSides: true });
    g.col.add(-155, 0, 11, -125, 8.3, 33, true, 'building');
    surfaces.push({ x0: -155, z0: 11, x1: -125, z1: 33, h0: 8.3 });
    this.ext.box(-155.3, 8, 10.7, -124.7, 8.3, 33.3, { color: '#2a1e36' });
    this.sign('LUCKY 7 ARCADE', -140, 6.2, 10.8, Math.PI, 12, '#2a1e36', '#ff5ad8');
    const neon = new Kit(g.col);
    for (let x = -152; x < -128; x += 3) neon.glow.box(x, 0.6, 10.9, x + 2, 3.2, 10.95, { color: x % 2 ? '#ff5ad8' : '#46e6ff' });
    neon.finish(g.scene);
    for (const [name, x, z] of [['Harbor Freight warehouse', 137, 65.5], ['Lucky 7 Arcade', -140, 9.6]] as [string, number, number][]) {
      g.interactables.push({ pos: new THREE.Vector3(x, CURB_H, z), radius: 3, label: `${name}: CLOSED`, enabled: () => true, action: () => g.hud.toast('CLOSED — COME BACK LATER', 'dim') });
    }
  }

  // ------------------------------------------------------------------ rooftop travel
  private buildLadders() {
    const g = this.g;
    const add = (x: number, z: number, top: number, heading: number) => {
      const fx = Math.sin(heading), fz = Math.cos(heading);
      const b = new GeoBuilder();
      for (const s of [-0.3, 0.3]) b.cbox(Math.cos(heading) * s, top / 2, -Math.sin(heading) * s, 0.06, top + 1, 0.06, { color: '#3a3c3e' });
      for (let y = 0.3; y < top + 0.8; y += 0.4) b.cbox(0, y, 0, Math.abs(fz) * 0.6 + 0.05, 0.05, Math.abs(fx) * 0.6 + 0.05, { color: '#3a3c3e' });
      // fire-escape landings every floor
      for (let y = 3.4; y < top; y += 3.4) b.cbox(0, y, 0, Math.abs(fz) * 2.2 + Math.abs(fx) * 1, 0.08, Math.abs(fx) * 2.2 + Math.abs(fz) * 1, { color: '#2e3032' });
      this.ext.append(b, new THREE.Matrix4().makeTranslation(x, 0, z));
      const L: Ladder = { x: x + fx * 0.7, z: z + fz * 0.7, top: top + 0.3, heading, topX: x - fx * 1.4, topZ: z - fz * 1.4 };
      this.ladders.push(L);
      g.interactables.push(
        { pos: new THREE.Vector3(L.x, CURB_H, L.z), radius: 1.5, label: 'Climb fire escape', enabled: () => !g.player.vehicle, action: () => g.player.climb(L, true) },
        { pos: new THREE.Vector3(L.topX, L.top, L.topZ), radius: 1.6, label: 'Climb down', enabled: () => !g.player.vehicle, action: () => g.player.climb(L, false) },
      );
    };
    // hand-placed: home's street wall, police station side, shop roof
    add(-14, 45.4, 11.2 + 0.3 - 0.3, 0);
    add(99.4, 30, 7.0, Math.PI / 2);
    add(-11.6, 20, 5.2, Math.PI / 2);
    // a handful of generated buildings get fire escapes on their street faces
    const picks = this.g.city.footprints.filter((f) => f.top < 30 && f.top > 6).sort(() => this.rng.next() - 0.5).slice(0, 26);
    for (const f of picks) {
      const opts: [number, number, number][] = [[(f.x0 + f.x1) / 2, f.z0 - 0.15, Math.PI], [(f.x0 + f.x1) / 2, f.z1 + 0.15, 0], [f.x0 - 0.15, (f.z0 + f.z1) / 2, -Math.PI / 2], [f.x1 + 0.15, (f.z0 + f.z1) / 2, Math.PI / 2]];
      const [x, z, h] = opts[this.rng.int(0, 3)];
      add(x + Math.sin(h) * 0.2, z + Math.cos(h) * 0.2, f.top + 0.5, h);
    }
  }

  private buildZiplines() {
    const g = this.g;
    const add = (a: THREE.Vector3, b: THREE.Vector3, name: string) => {
      const z: Zipline = { a, b, name };
      this.ziplines.push(z);
      const pts = [a.clone().setY(a.y + 2.4), b.clone().setY(b.y + 2.4)];
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#2a2a2a' }));
      g.scene.add(line);
      for (const p of [a, b]) { this.ext.cbox(p.x, p.y + 1.25, p.z, 0.15, 2.5, 0.15, { color: '#3a3c3e' }); this.ext.cbox(p.x, p.y + 2.45, p.z, 0.6, 0.12, 0.12, { color: '#9b3b2f' }); }
      g.interactables.push({ pos: a.clone(), radius: 1.8, label: `Zipline: ${name}`, enabled: () => !g.player.vehicle, action: () => g.player.zipline(z) });
    };
    add(new THREE.Vector3(38.5, 48.3, 18), new THREE.Vector3(96, 7.3, 15.5), 'to the police station roof');
    add(new THREE.Vector3(17.5, 48.3, 18), new THREE.Vector3(-14, 5.5, 15), 'to the shop row roof');
    add(new THREE.Vector3(-14, 11.5, 30), new THREE.Vector3(-58, 1.15, 52), 'down to Canal St');
    add(new THREE.Vector3(97, 7.3, 31), new THREE.Vector3(118, 0.4, 52), 'down to Harbor Ave');
  }

  // ------------------------------------------------------------------ helpers used by builders
  npc(k: Kit, type: 'vendor' | 'local' | 'office', x: number, z: number, h: number, s: Site) {
    const n = new RigCharacter(makePedSkin(type, this.rng));
    n.root.position.set(x, 0.15, z);
    n.root.rotation.y = h;
    k.group.add(n.root);
    s.npcs.push(n);
    (n as unknown as { state: string }).state = 'idle';
    return n as RigCharacter & { state: string };
  }

  /** clerk-style witness: calls 911 unless you stay close or jam the signal */
  private caller(s: Site, n: RigCharacter & { state: string }, pos: THREE.Vector3, kind: string) {
    s.state.callT = 6;
    s.state.callX = pos.x;
    s.state.callZ = pos.z;
    this.g.hud.toast('CLERK REACHING FOR THE PHONE — STAY CLOSE OR JAM THE CELL', 'heat');
    s.state.callKind = kind === 'store' ? 1 : 0;
    void n;
  }

  private camBlind(s: Site) {
    return (s.cams as { blindT: number }[]).every((c) => this.g.cameras.isOffline(c as never));
  }

  private cam(s: Site, pos: THREE.Vector3, yaw: number, pitch: number) {
    const c = this.g.cameras.addCam(pos, yaw, pitch, s.id, (cam) => { if (this.trespassing(s)) this.siteAlarm(s, `CAMERA SPOTTED YOU — ${s.name.toUpperCase()}`, 1, cam); });
    s.cams.push(c);
    this.hack(s, {
      kind: 'camera', label: `${s.name} camera`, pos, size: new THREE.Vector3(0.7, 0.7, 0.9), range: 35, ref: c,
      available: () => !this.g.cameras.isOffline(c),
      act: () => { this.g.cameras.blind(c, 25); this.g.fx.spawn('spark', pos, 12); return 'CAMERA BLINDED — 25s'; },
    });
  }

  /** hack a shop's door shut for a few seconds: everybody inside overreacts */
  private prankDoor(k: Kit, s: Site, x: number, z: number, line1: [string, string], line2: [string, string]) {
    const g = this.g;
    const col = k.solid(x - 0.95, 0, z - 0.15, x + 0.95, 2.8, z + 0.5, true);
    col.enabled = false;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.9, 2.6, 0.12), worldMat({ color: '#7a7e84' }));
    mesh.position.set(x, 1.45, z - 0.05);
    mesh.visible = false;
    k.group.add(mesh);
    this.hack(s, {
      kind: 'prank', label: `${s.name} doors`, pos: new THREE.Vector3(x, 1.5, z), size: new THREE.Vector3(2.2, 2.8, 0.6), range: 26,
      available: () => !s.prank,
      act: () => {
        s.prank = { t: 7, col, mesh, was: s.npcs.map((n) => (n as unknown as { state?: string }).state ?? 'idle') };
        col.enabled = true;
        mesh.visible = true;
        for (const n of s.npcs) (n as unknown as { state: string }).state = 'handsup';
        g.audio.alarmBell(2);
        g.hud.say(line1[0], line1[1]);
        setTimeout(() => { if (s.prank) g.hud.say(line2[0], line2[1]); }, 2600);
        g.pranks.remember(s.id);
        return `${s.name.toUpperCase()} LOCKED — 7s`;
      },
    });
  }

  private vend(k: Kit, s: Site, x: number, z: number) {
    k.block(x - 0.5, 0.15, z - 0.4, x + 0.5, 2.0, z + 0.4, '#9b3b2f');
    k.glow.box(x - 0.4, 0.6, z - 0.41, x + 0.4, 1.8, z - 0.4, { color: '#d8e8f0' });
    this.hack(s, {
      kind: 'vending', label: 'Vending machine', pos: new THREE.Vector3(x, 1.2, z), size: new THREE.Vector3(1.1, 1.9, 0.9), range: 15,
      available: () => !s.state.vend,
      act: () => { s.state.vend = true; this.g.fx.spawn('money', new THREE.Vector3(x, 0.8, z - 0.6), 8); this.g.loot.addCash(40); return 'FREE SODA + $40 IN CHANGE'; },
    });
  }

  private hide(s: Site, pos: THREE.Vector3, label: string) {
    s.interactables.push({ pos, radius: 1.7, label, enabled: () => !this.g.player.hidden, action: () => this.g.player.hide(pos) });
  }

  private hack(s: Site, h: Omit<Hackable, 'kind'> & { kind: string }) {
    s.hackables.push(h as Hackable);
  }

  /** public areas are fine: only staff-only zones and upper floors count */
  trespassing(s: Site) {
    const P = this.g.player.pos, r = s.restricted;
    if (P.y > 2) return true;
    return !!r && P.x > r.x0 && P.x < r.x1 && P.z > r.z0 && P.z < r.z1;
  }

  /** a building's alarm: heat + guards alerted (silenced panels suppress it) */
  siteAlarm(s: Site, msg: string, heat: number, _cam?: unknown) {
    const g = this.g;
    if (s.state.alarm || s.state.silenced) return;
    s.state.alarm = true;
    g.hud.toast(msg, 'heat');
    g.audio.alarmBell(15);
    g.post.triggerFlash('#ff2a1a', 0.25);
    g.police.crime(Math.max(heat, g.police.heat), '');
    g.news.report(s.id === 'jewel' ? 'store' : 'witness', g.player.pos.x, g.player.pos.z);
    g.guards.alertSite(s.id, g.player.pos);
  }

  // ------------------------------------------------------------------ runtime
  siteAt(x: number, z: number, y = 0): Site | null {
    for (const s of this.sites) if (s.open && x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1 && (s.id !== 'tower' || y < 46) && (s.maxY === undefined || y < s.maxY) && (s.minY === undefined || y >= s.minY)) return s;
    return null;
  }

  reset() {
    for (const s of this.sites) this.streamOut(s);
  }

  /** make sure a site's interior exists now (you're about to stand in it) */
  load(id: string) {
    const s = this.sites.find((x) => x.id === id);
    if (s && !s.kit) this.streamIn(s);
  }

  private streamIn(s: Site) {
    const k = new Kit(this.g.col);
    s.kit = k;
    s.state = {};
    s.prank = undefined;
    s.hackables = [];
    s.interactables = [];
    s.npcs = [];
    s.cams = [];
    s.build(k, s);
    k.finish(this.g.scene);
    this.g.hack.hackables.push(...s.hackables);
    this.g.interactables.push(...s.interactables);
  }

  private streamOut(s: Site) {
    const g = this.g;
    if (!s.kit) return;
    s.unload?.();
    s.kit.dispose(g.scene);
    s.kit = null;
    g.hack.hackables = g.hack.hackables.filter((h) => !s.hackables.includes(h));
    for (const it of s.interactables) { const i = g.interactables.indexOf(it); if (i >= 0) g.interactables.splice(i, 1); }
    for (const c of s.cams) g.cameras.removeCam(c as never);
    g.guards.removeSite(s.id);
    s.tick = undefined;
  }

  update(dt: number) {
    const g = this.g;
    this.t += dt;
    g.carAction = null;
    const P = g.player.worldPos;
    for (const s of this.sites) {
      const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2;
      const d = Math.hypot(P.x - cx, P.z - cz);
      if (!s.kit && d < 60) this.streamIn(s);
      else if (s.kit && d > 110) this.streamOut(s);
      if (!s.kit) continue;
      s.tick?.(dt, s);
      if (s.prank) {
        s.prank.t -= dt;
        if (s.prank.t <= 0) {
          if (s.prank.col) s.prank.col.enabled = false;
          if (s.prank.mesh) s.prank.mesh.visible = false;
          s.prank.was.forEach((st, i) => { if (s.npcs[i]) (s.npcs[i] as unknown as { state: string }).state = st; });
          s.prank = undefined;
          g.hud.toast('THE DOORS CLICK OPEN', 'dim');
        }
      }
      for (const n of s.npcs) n.update(dt, ((n as unknown as { state?: string }).state === 'handsup' ? 'handsup' : 'idle'), 0);
      // clerk call countdown
      if (typeof s.state.callT === 'number' && (s.state.callT as number) > 0) {
        const dist = Math.hypot(g.player.pos.x - (s.state.callX as number), g.player.pos.z - (s.state.callZ as number));
        if (dist < 3.5) { s.state.callT = 6; }
        else if (!g.street.coverage(cx, cz) || g.hack.isBlackedOut(cx, cz)) { s.state.callT = 0; g.hud.toast('CALL DROPPED — NO SIGNAL', 'cool'); }
        else {
          s.state.callT = (s.state.callT as number) - dt;
          if ((s.state.callT as number) <= 0) { g.police.crime(Math.min(5, g.police.heat + 1), 'clerk called 911'); g.news.report('store', cx, cz); }
        }
      }
    }
    // garage barrier animation
    const b = this.garageBarrier;
    if (b) {
      b.mesh.rotation.x = THREE.MathUtils.damp(b.mesh.rotation.x, b.open ? -1.4 : 0, 6, dt);
      b.col.enabled = !b.open;
    }
  }
}

export { RESERVED };
