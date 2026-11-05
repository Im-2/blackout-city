// Houses you can buy. A property is one row in PROPERTIES: where it stands, what it's
// worth, what it gives you, and a floor plan. The doors are E + fade like the first
// flat (world/home.ts), the lighting is baked the same way, and the garage is a real
// drive-in room. Interiors stream with the rest of the buildings, and vehicles stored
// in a garage only exist while it's loaded.
import * as THREE from 'three';
import { Kit } from './interior';
import { GeoBuilder } from './geo';
import { blockCenter, CURB_H } from './layout';
import { worldMaterials } from './materials';
import { basicMat } from '../render/patch';
import { damp } from '../core/math';
import { Vehicle } from '../vehicles/vehicle';
import { RARES } from '../activities/collection';
import { DOOR_TOP, F, Lamp, makeBake, homeMaterial, Opening, paintRoom, partitionWall, RoomDef, TOP, WAIN, WIN_TOP } from './home';
import type { CarKind } from '../vehicles/carMesh';
import type { FacadeStyle } from '../assets/textures';
import type { OwnedVehicle } from '../save/save';
import type { Buildings, Site } from './buildings';
import type { Game } from '../core/game';

type Face = 's' | 'n' | 'e' | 'w';

interface Palette { wall: string; wain: string; a: string; b: string; }
const WOOD: Palette = { wall: '#b08a5c', wain: '#6e4f33', a: '#7a5634', b: '#6e4c2e' };
const WARMW: Palette = { wall: '#c2a878', wain: '#8a6a48', a: '#8a6a44', b: '#7c5e3c' };
const TILE: Palette = { wall: '#9ab0a4', wain: '#d8d6cc', a: '#d8d6cc', b: '#8ea49a' };
const KITCH: Palette = { wall: '#c2a878', wain: '#d8d0bc', a: '#c8bfa8', b: '#7c6f5c' };
const CARPET: Palette = { wall: '#8f6f5e', wain: '#5e4638', a: '#6a4a4a', b: '#624444' };
const DARK: Palette = { wall: '#5c5a5e', wain: '#3a3840', a: '#4a3a30', b: '#42342c' };
const BRICK: Palette = { wall: '#8a5240', wain: '#6e4032', a: '#6a6660', b: '#5e5a54' };
const WHITE: Palette = { wall: '#d8d4c8', wain: '#c0bcb0', a: '#a89e8c', b: '#9c927e' };
const MARBLE: Palette = { wall: '#e0dccf', wain: '#b8a878', a: '#d8d4c8', b: '#c4c0b4' };
const NIGHT: Palette = { wall: '#3e4656', wain: '#2a3040', a: '#5a5048', b: '#50463e' };
const GARAGE: Palette = { wall: '#8a857a', wain: '#6a665e', a: '#5e5c56', b: '#56544e' };

type RoomSpec = [x0: number, z0: number, x1: number, z1: number, p: Palette];

export interface PropertyDef {
  id: string;
  name: string;
  kind: string;
  tier: number;
  price: number;
  bi: number; bj: number;
  style: FacadeStyle;
  trim: string;
  /** height of the home floor above the street */
  base: number;
  /** top of the building */
  top: number;
  /** garage width and depth at street level */
  gw: number; gd: number;
  /** home size. A street-level home sits beside the garage, a raised one spans the plot */
  w: number; d: number;
  cars: number; bikes: number;
  stash: number;
  /** seconds per heat point while you hide inside (lower is quicker) */
  heatDiv: number;
  /** when this is your home: extra hack energy per second, and off every hack's cost */
  regen: number;
  hackOff: number;
  features: string[];
  rooms: RoomSpec[];
  /** [axis, line, from, to] */
  walls: ['x' | 'z', number, number, number][];
  /** [axis, line, centre, width] */
  doors: ['x' | 'z', number, number, number][];
  /** [north/south, centre, width] */
  windows: ['n' | 's', number, number][];
  /** front door position along the north wall */
  ex: number;
  /** the door to the garage: on the west wall at this depth, or beside the front door if raised */
  link: number;
  fit: (f: Furnish) => void;
  garden?: boolean;
  /** what fills the rest of the block */
  fill?: FacadeStyle;
}

export const PROPERTIES: PropertyDef[] = [
  {
    id: 'elm', name: 'Elm Court', kind: 'Starter apartment', tier: 1, price: 8000, bi: 3, bj: 8, style: 'brick', trim: '#5e4636', base: 0, top: 11, gw: 8, gd: 12, w: 18, d: 12, fill: 'tan',
    cars: 1, bikes: 1, stash: 16, heatDiv: 30, regen: 0.5, hackOff: 0.02,
    features: ['Three rooms and a small kitchen', 'Basic hacker desk'],
    rooms: [[0, 0, 18, 7, WOOD], [0, 7.2, 10, 12, CARPET], [10.2, 7.2, 18, 12, TILE]],
    walls: [['z', 7.1, 0, 18], ['x', 10.1, 7.1, 12]], doors: [['z', 7.1, 4, 1.4], ['z', 7.1, 13, 1.2]],
    windows: [['n', 3, 3], ['n', 12, 3], ['n', 15.6, 2], ['s', 4, 2.4], ['s', 14, 1.6]], ex: 7.5, link: 6.2,
    fit: (f) => {
      f.rug(1.4, 1.6, 6, 5.4, '#7a2f2a'); f.tv(0, 3.5, 'e'); f.sofa(6.4, 3.5, 'w', '#5e7a6c'); f.coffee(3.8, 3.5);
      f.kitchen(18, 3.5, 'w', 6); f.desk(12, 7, 'n', 1); f.plant(1, 0.9); f.lamp(16.8, 6.2);
      f.bed(3, 12, 'n', '#3e5870', false); f.night(5, 12, 'n'); f.wardrobe(10, 9.5, 'w'); f.safe(0, 8.6, 'e');
      f.tub(16, 12, 'n'); f.sink(10.2, 8.4, 'e'); f.toilet(18, 8.4, 'w');
    },
  },
  {
    id: 'harcourt', name: 'Harcourt Row', kind: 'Townhouse', tier: 2, price: 22000, bi: 5, bj: 1, style: 'tan', trim: '#6b5a44', base: 0, top: 8.6, gw: 10, gd: 14, w: 22, d: 14, fill: 'brick',
    cars: 2, bikes: 1, stash: 24, heatDiv: 26, regen: 1, hackOff: 0.04,
    features: ['Five rooms, separate kitchen', 'A proper den for the desk', 'Bookshelves and a real sofa'],
    rooms: [[0, 0, 12, 8, WARMW], [12.2, 0, 22, 8, KITCH], [0, 8.2, 9, 14, CARPET], [9.2, 8.2, 14, 14, TILE], [14.2, 8.2, 22, 14, DARK]],
    walls: [['z', 8.1, 0, 22], ['x', 12.1, 0, 8.1], ['x', 9.1, 8.1, 14], ['x', 14.1, 8.1, 14]],
    doors: [['z', 8.1, 4, 1.4], ['z', 8.1, 11.5, 1.2], ['z', 8.1, 18, 1.4], ['x', 12.1, 4, 3]],
    windows: [['n', 2.6, 3], ['n', 9.6, 3], ['n', 17, 3], ['s', 4.4, 3], ['s', 18, 3]], ex: 6, link: 6.9,
    fit: (f) => {
      f.rug(1.6, 1.6, 7.4, 6, '#2f4a5a'); f.tv(0, 3.8, 'e'); f.sofa(7.8, 3.8, 'w', '#6e3f5c'); f.coffee(4.8, 3.8); f.books(8, 8, 'n', 3.4); f.art(12, 2.4, 'w', 3, 1.6, 1); f.plant(10, 7.2); f.lamp(1, 1);
      f.kitchen(22, 4, 'w', 7); f.dining(17, 4, 4);
      f.bed(4, 14, 'n', '#7a2f2a', true); f.night(1.4, 14, 'n'); f.night(6.6, 14, 'n'); f.wardrobe(9, 11, 'w'); f.safe(0, 9.4, 'e');
      f.tub(11.6, 14, 'n'); f.sink(14, 10, 'w'); f.toilet(9.2, 9.6, 'e');
      f.desk(18, 14, 'n', 2); f.books(22, 11, 'w', 3); f.art(14.2, 10.6, 'e', 1.6, 1.2, 2);
    },
  },
  {
    id: 'foundry', name: 'Foundry Loft', kind: 'Downtown loft', tier: 3, price: 45000, bi: 8, bj: 3, style: 'brick', trim: '#3a3c3e', base: 14, top: 18.6, gw: 12, gd: 16, w: 33, d: 18, fill: 'concrete',
    cars: 2, bikes: 2, stash: 32, heatDiv: 22, regen: 1.5, hackOff: 0.06,
    features: ['Top floor, downtown views', 'Open plan with exposed brick', 'Bar and pool table', 'Art on the walls'],
    rooms: [[0, 0, 24, 18, BRICK], [24.2, 0, 33, 10, CARPET], [24.2, 10.2, 33, 18, TILE]],
    walls: [['x', 24.1, 0, 18], ['z', 10.1, 24.1, 33]], doors: [['x', 24.1, 6, 1.6], ['x', 24.1, 13, 1.4]],
    windows: [['n', 3, 3], ['n', 8, 3], ['n', 19.2, 3], ['n', 22, 1.2], ['n', 28.6, 3], ['s', 3, 3], ['s', 8, 3], ['s', 13, 3], ['s', 18, 3], ['s', 29, 2.4]], ex: 12.5, link: 12.5,
    fit: (f) => {
      for (const [x, z] of [[8, 6], [8, 12], [16, 6], [16, 12]]) f.pillar(x, z);
      f.rug(1.5, 4, 7, 13, '#7a2f2a'); f.tv(0, 8.5, 'e'); f.sofa(7.4, 8.5, 'w', '#3a3c3e'); f.coffee(4.4, 8.5);
      f.bar(20.6, 0.2, 's', 5); f.pooltable(12, 9); f.kitchen(24, 15, 'w', 5.6); f.dining(19, 14.4, 6);
      f.desk(4, 18, 'n', 3); f.art(10, 18, 'n', 3, 1.8, 3); f.art(15, 18, 'n', 2.2, 1.6, 4); f.art(0, 15, 'e', 2.4, 1.6, 5); f.books(24, 3, 'w', 3.4); f.plant(1, 1.2); f.plant(23, 1.2); f.lamp(1, 16.8);
      f.bed(28.6, 0, 's', '#2f3b4d', true); f.night(26, 0, 's'); f.night(31.2, 0, 's'); f.wardrobe(33, 7, 'w'); f.safe(24.2, 8.6, 'e');
      f.tub(31, 18, 'n'); f.sink(33, 12, 'w'); f.toilet(24.2, 16.8, 'e');
    },
  },
  {
    id: 'glasshouse', name: 'The Glasshouse', kind: 'Modern house', tier: 4, price: 80000, bi: 7, bj: 9, style: 'concrete', trim: '#d8d4c8', base: 0, top: 4.4, gw: 12, gd: 16, w: 21, d: 22, garden: true,
    cars: 3, bikes: 2, stash: 40, heatDiv: 18, regen: 2, hackOff: 0.08,
    features: ['Walls of glass, its own garden', 'Hot tub', 'Trophy room', 'Home gym'],
    rooms: [[0, 0, 12, 10, WHITE], [12.2, 0, 21, 10, KITCH], [0, 10.2, 9.5, 22, CARPET], [9.7, 10.2, 21, 16, DARK], [9.7, 16.2, 15, 22, TILE], [15.2, 16.2, 21, 22, NIGHT]],
    walls: [['z', 10.1, 0, 21], ['x', 12.1, 0, 10.1], ['x', 9.6, 10.1, 22], ['z', 16.1, 9.6, 21], ['x', 15.1, 16.1, 22]],
    doors: [['z', 10.1, 5, 1.6], ['z', 10.1, 16, 1.6], ['x', 12.1, 5, 3.4], ['x', 9.6, 19, 1.4], ['z', 16.1, 18, 1.4]],
    windows: [['n', 2.4, 3], ['n', 8.6, 3], ['n', 13.4, 2.4], ['n', 17, 2.4], ['n', 19.6, 1.8], ['s', 2, 3], ['s', 6, 3], ['s', 12, 3], ['s', 18, 3.4]], ex: 5.5, link: 8.4,
    fit: (f) => {
      f.rug(1.2, 2, 8, 8, '#c4a03c'); f.tv(0, 5, 'e'); f.sofa(8.2, 5, 'w', '#d8d0bc'); f.coffee(5, 5); f.art(12, 2.6, 'w', 3, 1.8, 6); f.plant(1, 1); f.plant(11, 9.2); f.lamp(11, 1);
      f.kitchen(21, 5, 'w', 8); f.bar(14, 8.4, 'n', 4);
      f.bed(5, 22, 'n', '#c8c3b5', true); f.night(2.2, 22, 'n'); f.night(7.8, 22, 'n'); f.wardrobe(0, 14, 'e'); f.safe(9.5, 12, 'w'); f.hottub(4.8, 12.4);
      f.desk(15, 16, 'n', 3); f.art(21, 13, 'w', 2, 1.4, 7);
      f.tub(12.4, 22, 'n'); f.toilet(9.7, 17.6, 'e'); f.sink(15, 18, 'w');
      f.trophies(21, 19, 'w', 5); f.gym(16.4, 21);
    },
  },
  {
    id: 'marina', name: 'Villa Marina', kind: 'Waterfront villa', tier: 5, price: 140000, bi: 8, bj: 11, style: 'tan', trim: '#8a6a48', base: 0, top: 5.2, gw: 14, gd: 16, w: 19, d: 33, garden: true,
    cars: 4, bikes: 3, stash: 60, heatDiv: 14, regen: 2.5, hackOff: 0.1,
    features: ['Eight rooms by the water', 'Indoor pool looking out to sea', 'Trophy room and a study', 'Grand piano'],
    rooms: [[0, 0, 19, 11, MARBLE], [0, 11.2, 9, 22, KITCH], [9.2, 11.2, 19, 16, DARK], [9.2, 16.2, 19, 22, NIGHT], [0, 22.2, 19, 33, TILE]],
    walls: [['z', 11.1, 0, 19], ['x', 9.1, 11.1, 22], ['z', 16.1, 9.1, 19], ['z', 22.1, 0, 19]],
    doors: [['z', 11.1, 4.5, 3], ['z', 11.1, 14, 1.6], ['x', 9.1, 19, 1.4], ['z', 22.1, 4.5, 3]],
    windows: [['n', 2.6, 3], ['n', 7.4, 2.4], ['n', 12, 3], ['n', 16.4, 3], ['s', 2.6, 3.6], ['s', 7, 3.6], ['s', 12, 3.6], ['s', 16.4, 3.6]], ex: 9.6, link: 2.4,
    fit: (f) => {
      f.rug(1.4, 3, 8.4, 9.8, '#7a2f2a'); f.tv(0, 6.4, 'e'); f.sofa(8.8, 6.4, 'w', '#d8d0bc'); f.coffee(5.2, 6.4); f.piano(15, 7); f.art(19, 3, 'w', 3, 2, 8); f.art(19, 8.4, 'w', 2.4, 1.6, 9); f.plant(18, 1); f.plant(18, 10); f.lamp(1, 10); f.lamp(12.8, 1);
      f.kitchen(0, 16.6, 'e', 9.5); f.dining(5.4, 17, 8);
      f.desk(14, 11.2, 's', 3); f.books(19, 13.6, 'w', 3.6); f.safe(9.2, 15, 'e');
      f.bed(14, 22, 'n', '#6e3f5c', true); f.night(11.2, 22, 'n'); f.night(16.8, 22, 'n'); f.wardrobe(19, 19, 'w'); f.trophies(9.2, 18.6, 'e', 3.6);
      f.pool(3, 25, 16, 31); f.plant(1, 24); f.plant(18, 24); f.plant(1, 32); f.plant(18, 32);
      f.toilet(0, 23.2, 'e'); f.sink(19, 23.4, 'w');
    },
  },
  {
    id: 'skyline', name: 'Skyline Penthouse', kind: 'Penthouse tower', tier: 6, price: 250000, bi: 5, bj: 3, style: 'tower', trim: '#2a2c30', base: 38, top: 42.6, gw: 22, gd: 18, w: 33, d: 33,
    cars: 6, bikes: 4, stash: 80, heatDiv: 10, regen: 3, hackOff: 0.12,
    features: ['The whole top floor, city on every side', 'Hot tub and a lounge bar', 'Trophy room, gym and gallery', 'Private lift to a six-car garage'],
    rooms: [[0, 0, 33, 16, NIGHT], [0, 16.2, 12, 33, MARBLE], [12.2, 16.2, 22, 24, DARK], [12.2, 24.2, 22, 33, NIGHT], [22.2, 16.2, 33, 25, CARPET], [22.2, 25.2, 33, 33, TILE]],
    walls: [['z', 16.1, 0, 33], ['x', 12.1, 16.1, 33], ['x', 22.1, 16.1, 33], ['z', 24.1, 12.1, 22.1], ['z', 25.1, 22.1, 33]],
    doors: [['z', 16.1, 6, 3], ['z', 16.1, 17, 1.6], ['z', 16.1, 27, 1.6], ['z', 24.1, 17, 1.4], ['z', 25.1, 27, 1.4]],
    windows: [['n', 3, 3.6], ['n', 8, 3.6], ['n', 13, 3.6], ['n', 23.8, 2.4], ['n', 27.4, 3], ['n', 31, 2.6], ['s', 3, 3.6], ['s', 8, 3.6], ['s', 17, 3.6], ['s', 27, 3.6]], ex: 17.5, link: 17.5,
    fit: (f) => {
      for (const [x, z] of [[11, 8], [22, 8]]) f.pillar(x, z);
      f.rug(1.5, 4, 9, 13, '#2f3b4d'); f.tv(0, 8.5, 'e'); f.sofa(9.2, 8.5, 'w', '#c8c3b5'); f.coffee(5.4, 8.5);
      f.bar(33, 8, 'w', 7); f.pooltable(16, 9); f.hottub(26, 3.4); f.piano(26, 12); f.plant(1, 1.2); f.plant(32, 1.2); f.plant(1, 15); f.lamp(14, 15);
      f.art(4, 16, 'n', 3, 1.8, 10); f.art(10, 16, 'n', 2.4, 1.6, 11); f.art(21, 16, 'n', 2.4, 1.6, 12);
      f.kitchen(0, 24, 'e', 12); f.dining(6.6, 24, 10);
      f.desk(17, 16.2, 's', 4); f.books(22, 21, 'w', 4); f.safe(12.2, 22, 'e'); f.art(12.2, 18.4, 'e', 2, 1.4, 13);
      f.trophies(22, 28.6, 'w', 6); f.gym(13.6, 31.6); f.art(12.2, 28.6, 'e', 3, 1.8, 14);
      f.bed(27.6, 16.2, 's', '#c4a03c', true); f.night(24.6, 16.2, 's'); f.night(30.6, 16.2, 's'); f.wardrobe(33, 21, 'w');
      f.tub(31, 33, 'n'); f.sink(33, 27, 'w'); f.toilet(22.2, 31, 'e');
    },
  },
];

export const PROPERTY_BLOCKS: Record<string, [number, number]> = Object.fromEntries(PROPERTIES.map((p) => [`prop-${p.id}`, [p.bi, p.bj]]));

/** the flat you start with, as a row of the same table */
export const STARTER_BENEFITS = { name: 'No. 17', kind: 'Your first flat', cars: 1, bikes: 0, stash: 12, heatDiv: 35, regen: 0, hackOff: 0 };

/** Furniture. Every piece stands with its back to (x, z) and faces `face`. Local units: metres from the home's north-west corner. */
export class Furnish {
  cups: { x: number; y: number; z: number; xAxis: boolean }[] = [];

  constructor(private k: Kit, private ox: number, private oz: number, private y: number, private act: (label: string | (() => string), x: number, z: number, r: number, fn: () => void, on?: () => boolean) => void, private g: Game) {}

  private box(x: number, z: number, face: Face, u0: number, y0: number, v0: number, u1: number, y1: number, v1: number, color: string, solid = false, glow = false) {
    const wx = this.ox + x, wz = this.oz + z;
    let ax: number, bx: number, az: number, bz: number;
    if (face === 's') { ax = wx + u0; bx = wx + u1; az = wz + v0; bz = wz + v1; }
    else if (face === 'n') { ax = wx - u1; bx = wx - u0; az = wz - v1; bz = wz - v0; }
    else if (face === 'e') { ax = wx + v0; bx = wx + v1; az = wz - u1; bz = wz - u0; }
    else { ax = wx - v1; bx = wx - v0; az = wz + u0; bz = wz + u1; }
    const yy0 = this.y + y0, yy1 = this.y + y1;
    if (glow) this.k.glow.box(ax, yy0, az, bx, yy1, bz, { color });
    else this.k.props.box(ax, yy0, az, bx, yy1, bz, { color, shadeSides: true });
    if (solid) this.k.solid(ax, yy0, az, bx, yy1, bz, false);
  }

  /** a spot `v` metres out in front of a piece */
  private front(x: number, z: number, face: Face, v: number): [number, number] {
    return face === 's' ? [x, z + v] : face === 'n' ? [x, z - v] : face === 'e' ? [x + v, z] : [x - v, z];
  }

  rug(x0: number, z0: number, x1: number, z1: number, c: string) {
    this.box(x0, z0, 's', 0, 0.012, 0, x1 - x0, 0.03, z1 - z0, c);
    this.box(x0, z0, 's', 0.3, 0.03, 0.3, x1 - x0 - 0.3, 0.04, z1 - z0 - 0.3, '#a8603c');
  }

  sofa(x: number, z: number, face: Face, c: string) {
    this.box(x, z, face, -2, 0, 0.4, 2, 0.48, 1.4, c, true);
    this.box(x, z, face, -2, 0, 0, 2, 1.02, 0.4, c, true);
    this.box(x, z, face, -2.4, 0, 0, -2, 0.72, 1.4, c, true);
    this.box(x, z, face, 2, 0, 0, 2.4, 0.72, 1.4, c, true);
    this.box(x, z, face, -1.9, 0.48, 0.45, -0.05, 0.6, 1.35, '#8a9a8c');
    this.box(x, z, face, 0.05, 0.48, 0.45, 1.9, 0.6, 1.35, '#8a9a8c');
  }

  coffee(x: number, z: number) {
    this.box(x, z, 's', -0.5, 0, -1, 0.5, 0.42, 1, '#5b4330', true);
    this.box(x, z, 's', -0.55, 0.42, -1.05, 0.55, 0.47, 1.05, '#6b4f38');
    this.box(x, z, 's', -0.2, 0.47, 0.2, 0.15, 0.59, 0.5, '#d8d0bc');
  }

  tv(x: number, z: number, face: Face) {
    this.box(x, z, face, -1.8, 0, 0, 1.8, 0.55, 0.6, '#3b2c20', true);
    this.box(x, z, face, -1.4, 0.55, 0.05, 1.4, 2.1, 0.25, '#17171a', true);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.36), basicMat({ map: this.g.home.tv.t, fog: false }));
    const [px, pz] = this.front(x, z, face, 0.26);
    m.position.set(this.ox + px, this.y + 1.33, this.oz + pz);
    m.rotation.y = face === 's' ? 0 : face === 'n' ? Math.PI : face === 'e' ? Math.PI / 2 : -Math.PI / 2;
    this.k.group.add(m);
  }

  bed(x: number, z: number, face: Face, c: string, big: boolean) {
    const w = big ? 1.5 : 1.1;
    this.box(x, z, face, -w, 0, 0.1, w, 0.3, 2.3, '#4a3424', true);
    this.box(x, z, face, -w + 0.05, 0.3, 0.15, w - 0.05, 0.56, 2.25, '#d8d0bc');
    this.box(x, z, face, -w - 0.02, 0.56, 1, w + 0.02, 0.66, 2.32, c);
    this.box(x, z, face, -w + 0.2, 0.56, 0.2, -0.1, 0.7, 0.7, '#e6e0d4');
    this.box(x, z, face, 0.1, 0.56, 0.2, w - 0.2, 0.7, 0.7, '#e6e0d4');
    this.box(x, z, face, -w - 0.1, 0, 0, w + 0.1, 1.2, 0.12, '#4a3424', true);
    const [ax, az] = this.front(x, z, face, 2.9);
    const g = this.g;
    this.act(() => (g.police.heat > 0 ? 'Bed: too hot to sleep (lose the heat first)' : g.missions.run ? 'Bed: finish your mission first' : 'Sleep: save game, skip 8 hours'), ax, az, 1.9, () => g.home.sleep());
  }

  night(x: number, z: number, face: Face) {
    this.box(x, z, face, -0.35, 0, 0, 0.35, 0.6, 0.7, '#5b4330', true);
    this.box(x, z, face, -0.1, 0.6, 0.25, 0.1, 0.85, 0.45, '#3a3c3e');
    this.box(x, z, face, -0.2, 0.85, 0.15, 0.2, 1.15, 0.55, '#ffc878', false, true);
  }

  wardrobe(x: number, z: number, face: Face) {
    this.box(x, z, face, -1.5, 0, 0, 1.5, 2.5, 0.7, '#5b4330', true);
    this.box(x, z, face, -1.42, 0.1, 0.7, -0.05, 2.4, 0.72, '#6b4f38');
    this.box(x, z, face, 0.05, 0.1, 0.7, 1.42, 2.4, 0.72, '#6b4f38');
    const [ax, az] = this.front(x, z, face, 1.3);
    this.act('Wardrobe: change outfit', ax, az, 1.5, () => this.g.shopUi.wardrobe());
  }

  safe(x: number, z: number, face: Face) {
    this.box(x, z, face, -0.6, 0, 0, 0.6, 1, 0.8, '#3f4346', true);
    this.box(x, z, face, -0.5, 0.12, 0.8, 0.5, 0.88, 0.82, '#55595c');
    this.box(x, z, face, 0.2, 0.75, 0.82, 0.3, 0.8, 0.84, '#5aff8a', false, true);
    const [ax, az] = this.front(x, z, face, 1.3);
    const g = this.g;
    this.act(() => { const v = g.loot.carriedValue; return v ? `Stash your loot ($${v.toLocaleString()})` : `Open the stash (${g.save.data.stash.length}/${g.properties.stashCap})`; }, ax, az, 1.3, () => { if (g.loot.carriedValue) g.loot.stashAll(); else g.homeUi.open(['stash'], 'STASH'); });
  }

  desk(x: number, z: number, face: Face, screens: number) {
    this.box(x, z, face, -2.6, 0, 0, 2.6, 0.78, 1.1, '#2e3034', true);
    this.box(x, z, face, -2.65, 0.78, 0, 2.65, 0.83, 1.15, '#3e4146');
    const live = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.92), basicMat({ map: this.g.home.monitor.t, fog: false }));
    const [px, pz] = this.front(x, z, face, 0.31);
    live.position.set(this.ox + px, this.y + 1.4, this.oz + pz);
    live.rotation.y = face === 's' ? 0 : face === 'n' ? Math.PI : face === 'e' ? Math.PI / 2 : -Math.PI / 2;
    this.k.group.add(live);
    this.box(x, z, face, -0.95, 0.88, 0.15, 0.95, 1.92, 0.3, '#17171a');
    for (let i = 1; i < screens; i++) {
      const u = i % 2 ? -1.7 : 1.7, top = i > 2;
      this.box(x, z, face, u - 0.55, top ? 1.75 : 1, 0.15, u + 0.55, top ? 2.35 : 1.6, 0.28, '#17171a');
      this.box(x, z, face, u - 0.48, top ? 1.8 : 1.05, 0.28, u + 0.48, top ? 2.3 : 1.55, 0.29, i % 2 ? '#0e3040' : '#10302a', false, true);
    }
    this.box(x, z, face, -0.7, 0.83, 0.65, 0.7, 0.86, 1, '#1e2024');
    this.box(x, z, face, -0.3, 0, 1.3, 0.3, 0.48, 1.9, '#2a2c30', true);
    const [ax, az] = this.front(x, z, face, 2.1);
    this.act('Hacker desk', ax, az, 1.7, () => this.g.homeUi.open(['missions', 'homes', 'map', 'wardrobe', 'gallery', 'collection', 'rep', 'records', 'upgrades'], 'HACKER DESK'));
  }

  kitchen(x: number, z: number, face: Face, len: number) {
    const h = len / 2;
    this.box(x, z, face, -h, 0, 0, h, 0.9, 0.65, '#7a6248', true);
    this.box(x, z, face, -h, 0.9, 0, h, 0.96, 0.72, '#bdb5a2');
    this.box(x, z, face, -h + 0.6, 0.965, 0.1, -h + 1.6, 0.98, 0.6, '#2a2a2c');
    this.box(x, z, face, h - 1.6, 0.965, 0.1, h - 0.6, 0.98, 0.6, '#8e9092');
    this.box(x, z, face, h - 0.02 - 0.9, 0, 0, h, 2.1, 0.8, '#d8d6cf', true);
    for (let u = -h + 0.2; u < h - 2.2; u += 1.5) this.box(x, z, face, u, 1.65, 0, u + 1.4, 2.3, 0.35, '#6b533c');
    this.box(x, z, face, 0, 0.96, 0.15, 0.35, 1.3, 0.45, '#2a2a2c');
    const [ax, az] = this.front(x, z, face, 1.3);
    const g = this.g;
    this.act('Make coffee', ax, az, 1.5, () => { g.hack.energy = 100; g.audio.pop(); g.hud.toast('COFFEE. HACK ENERGY FULL', 'cool'); }, () => g.hack.energy < 100);
  }

  dining(x: number, z: number, seats: number) {
    const h = Math.max(1, seats * 0.32);
    this.box(x, z, 's', -0.7, 0, -h, 0.7, 0.76, h, '#6b4f38', true);
    const n = Math.ceil(seats / 2);
    for (let i = 0; i < n; i++) {
      const c = -h + ((i + 0.5) * 2 * h) / n;
      this.box(x, z, 's', -1.35, 0, c - 0.28, -0.8, 0.46, c + 0.28, '#5b4330', true);
      this.box(x, z, 's', 0.8, 0, c - 0.28, 1.35, 0.46, c + 0.28, '#5b4330', true);
    }
  }

  tub(x: number, z: number, face: Face) {
    this.box(x, z, face, -1.35, 0, 0, 1.35, 0.6, 1.3, '#d8d6cf', true);
    this.box(x, z, face, -1.2, 0.6, 0.15, 1.2, 0.61, 1.15, '#7ca0a8');
  }

  sink(x: number, z: number, face: Face) {
    this.box(x, z, face, -0.45, 0, 0, 0.45, 0.85, 0.6, '#d8d6cf', true);
    this.box(x, z, face, -0.5, 1.15, 0, 0.5, 2.05, 0.02, '#9fb0b0', false, true);
  }

  toilet(x: number, z: number, face: Face) {
    this.box(x, z, face, -0.3, 0, 0.3, 0.3, 0.42, 0.75, '#e6e0d4', true);
    this.box(x, z, face, -0.3, 0, 0, 0.3, 1, 0.3, '#d8d6cf', true);
  }

  books(x: number, z: number, face: Face, len: number) {
    const h = len / 2, cols = ['#9b3b2f', '#c4a03c', '#3f7b88', '#d8d0bc', '#4a5b39', '#6e3f5c', '#c96a3a', '#2f3b4d'];
    this.box(x, z, face, -h, 0, 0, h, 2.4, 0.5, '#4a3424', true);
    for (let lv = 0; lv < 4; lv++) {
      let n = lv * 3 + 1;
      for (let u = -h + 0.08; u < h - 0.2; n += 3) {
        const w = 0.07 + ((n * 5) % 4) * 0.025, bh = 0.34 + ((n * 7) % 3) * 0.05;
        if ((n * 11) % 9) this.box(x, z, face, u, 0.26 + lv * 0.56, 0.5, u + w, 0.26 + lv * 0.56 + bh, 0.56, cols[n % cols.length]);
        u += w + 0.01;
      }
    }
  }

  plant(x: number, z: number) {
    this.box(x, z, 's', -0.3, 0, -0.3, 0.3, 0.5, 0.3, '#8a5a3a', true);
    this.box(x, z, 's', -0.5, 0.5, -0.5, 0.5, 1.2, 0.5, '#4f7a3a');
    this.box(x, z, 's', -0.25, 1.2, -0.25, 0.25, 1.6, 0.25, '#5e8a44');
  }

  lamp(x: number, z: number) {
    this.box(x, z, 's', -0.25, 0, -0.25, 0.25, 0.05, 0.25, '#3a3c3e', true);
    this.box(x, z, 's', -0.04, 0, -0.04, 0.04, 1.55, 0.04, '#3a3c3e');
    this.box(x, z, 's', -0.25, 1.55, -0.25, 0.25, 1.95, 0.25, '#ffd590', false, true);
  }

  /** a framed abstract: blocks of colour from a seed, no two alike */
  art(x: number, z: number, face: Face, w: number, h: number, seed: number) {
    const cols = ['#c9552a', '#e6c84a', '#2f4a6a', '#7a2f2a', '#3f7b88', '#d8d0bc', '#6e3f5c', '#4f7a3a', '#1c1c1e'];
    const y0 = 1.3 - h / 8;
    this.box(x, z, face, -w / 2 - 0.08, y0 - 0.08, 0.02, w / 2 + 0.08, y0 + h + 0.08, 0.06, '#c4a03c');
    const nx = 5, ny = 3;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const c = cols[(seed * 7 + i * 3 + j * 5 + ((i * j + seed) % 4)) % cols.length];
      this.box(x, z, face, -w / 2 + (i * w) / nx, y0 + (j * h) / ny, 0.06, -w / 2 + ((i + 1) * w) / nx, y0 + ((j + 1) * h) / ny, 0.07, c, false, true);
    }
  }

  trophies(x: number, z: number, face: Face, len: number) {
    const h = len / 2, g = this.g;
    this.box(x, z, face, -h, 0, 0, h, 0.9, 0.5, '#2a2c30', true);
    for (const y of [1.3, 1.9]) this.box(x, z, face, -h, y, 0, h, y + 0.06, 0.45, '#4a3424');
    const done = Object.keys(g.save.data.completed);
    done.slice(0, 24).forEach((id, i) => {
      const u = -h + 0.3 + (i % 8) * ((len - 0.6) / 7.5), y = i < 8 ? 0.9 : i < 16 ? 1.36 : 1.96, c = id === 'bank_heist' ? '#e6c84a' : '#c8a060';
      this.box(x, z, face, u - 0.09, y, 0.12, u + 0.09, y + 0.05, 0.3, '#3a3c3e');
      this.box(x, z, face, u - 0.03, y + 0.05, 0.18, u + 0.03, y + 0.14, 0.24, c);
      this.box(x, z, face, u - 0.09, y + 0.14, 0.12, u + 0.09, y + 0.32, 0.3, c);
    });
    const [ax, az] = this.front(x, z, face, 1.3);
    this.act('Trophy room', ax, az, 1.6, () => g.homeUi.open(['trophies'], 'TROPHIES'));
  }

  hottub(x: number, z: number) {
    this.box(x, z, 's', -1.5, 0, -1.5, 1.5, 0.75, 1.5, '#8a7a5a', true);
    this.box(x, z, 's', -1.3, 0.75, -1.3, 1.3, 0.78, 1.3, '#46c8d8', false, true);
    for (const [u, v] of [[-0.7, -0.5], [0.6, 0.4], [0, -0.8], [-0.2, 0.7]]) this.box(x, z, 's', u - 0.1, 0.78, v - 0.1, u + 0.1, 0.79, v + 0.1, '#c8f0f4', false, true);
  }

  pool(x0: number, z0: number, x1: number, z1: number) {
    const w = x1 - x0, d = z1 - z0;
    this.box(x0, z0, 's', -0.5, 0, -0.5, w + 0.5, 0.2, d + 0.5, '#c4bca8', true);
    this.box(x0, z0, 's', 0, 0.2, 0, w, 0.22, d, '#2f9ab8', false, true);
    for (let i = 0; i < 7; i++) this.box(x0, z0, 's', 0.8 + (i * 1.9) % (w - 2), 0.22, 0.6 + (i * 2.3) % (d - 1), 1.5 + (i * 1.9) % (w - 2), 0.23, 0.72 + (i * 2.3) % (d - 1), '#8ad8e8', false, true);
  }

  pillar(x: number, z: number) {
    this.box(x, z, 's', -0.3, 0, -0.3, 0.3, 4.5, 0.3, '#6e4032', true);
  }

  bar(x: number, z: number, face: Face, len: number) {
    const h = len / 2;
    this.box(x, z, face, -h, 0, 0.5, h, 1.05, 1.1, '#3a2418', true);
    this.box(x, z, face, -h - 0.05, 1.05, 0.45, h + 0.05, 1.12, 1.15, '#8a6a48');
    this.box(x, z, face, -h, 1.5, 0, h, 1.56, 0.3, '#4a3424');
    const cols = ['#4f7a3a', '#9b3b2f', '#c4a03c', '#3f7b88'];
    for (let i = 0; i < len * 2.4; i++) this.box(x, z, face, -h + 0.2 + i * 0.4, 1.56, 0.08, -h + 0.3 + i * 0.4, 1.86, 0.18, cols[i % 4]);
    for (let u = -h + 0.4; u < h; u += 1.1) this.box(x, z, face, u - 0.2, 0, 1.4, u + 0.2, 0.7, 1.8, '#2a2c30', true);
  }

  pooltable(x: number, z: number) {
    this.box(x, z, 's', -1.4, 0, -0.8, 1.4, 0.8, 0.8, '#3a2418', true);
    this.box(x, z, 's', -1.25, 0.8, -0.65, 1.25, 0.82, 0.65, '#2a6a3a');
  }

  gym(x: number, z: number) {
    this.box(x, z, 's', -0.5, 0, -1.2, 0.5, 0.2, 0.6, '#2a2c30', true);
    this.box(x, z, 's', -0.5, 0, -1.2, 0.5, 1.3, -1, '#3a3c3e', true);
    this.box(x + 2.2, z, 's', -0.3, 0, -1, 0.3, 0.45, 1, '#2a2c30', true);
    this.box(x + 2.2, z, 's', -0.8, 1.05, -0.05, 0.8, 1.1, 0.05, '#8e9092');
    for (const u of [-0.8, 0.8]) this.box(x + 2.2, z, 's', u - 0.05, 0.95, -0.2, u + 0.05, 1.2, 0.2, '#17171a');
  }

  piano(x: number, z: number) {
    this.box(x, z, 's', -1, 0, -1.2, 1, 0.95, 1, '#141416', true);
    this.box(x, z, 's', -1, 0.95, -1.2, 1, 1.7, -1.05, '#141416');
    this.box(x, z, 's', -0.9, 0.9, 1, 0.9, 0.96, 1.25, '#e8e4d8');
    this.box(x, z, 's', -0.4, 0, 1.5, 0.4, 0.48, 1.9, '#3a2418', true);
  }
}

interface Live {
  def: PropertyDef;
  ox: number; oz: number; floor: number;
  gx0: number; gz0: number;
  /** centre of the roll-up door */
  gcx: number;
  door: { x: number; z: number };
  roll: THREE.Mesh;
  rollCol: import('./collision').AABB;
  rollY: number;
  far: THREE.Mesh;
  sign: THREE.Group;
  bays: { x: number; z: number; heading: number; bike: boolean }[];
  /** real vehicles standing in the bays right now */
  live: (Vehicle | null)[];
  site: Site;
  garage: Site;
}

const WALL = 0.5;
/** from the loft up, windows you can see the street through */
const TALL_SILL = 0.4, TALL_HEAD = 2.9;

export class Properties {
  list: Live[] = [];
  private byId = new Map<string, Live>();
  private hintT = 0;
  /** looking round a house you haven't bought */
  touring: string | null = null;

  constructor(private g: Game, private b: Buildings) {}

  // ------------------------------------------------------------------ ownership
  owns(id: string) { return this.g.save.data.properties.includes(id); }
  get activeId() { return this.g.save.data.activeHome; }
  get active() { return this.byId.get(this.activeId)?.def ?? null; }
  get regen() { return this.active?.regen ?? 0; }
  get hackOff() { return this.active?.hackOff ?? 0; }
  /** your biggest safe sets the limit: it's one stash, moved between homes */
  get stashCap() { return Math.max(STARTER_BENEFITS.stash, ...this.list.filter((p) => this.owns(p.def.id)).map((p) => p.def.stash)); }

  /** the property you're in, if any */
  get here(): Live | null {
    const P = this.g.player.worldPos;
    const id = this.g.siteAt(P.x, P.z, P.y);
    if (!id?.startsWith('prop-')) return null;
    return this.byId.get(id.slice(5).replace(/-g$/, '')) ?? null;
  }
  get inGarage() {
    const P = this.g.player.worldPos;
    return !!this.g.siteAt(P.x, P.z, P.y)?.endsWith('-g') && !!this.here;
  }
  get heatDiv() { return this.here?.def.heatDiv ?? STARTER_BENEFITS.heatDiv; }
  /** the street outside wherever you're hiding */
  get doorOut() {
    const p = this.here;
    return p ? { x: p.door.x, z: p.door.z, dz: -1 } : null;
  }
  doorOf(id: string) { return this.byId.get(id)?.door ?? null; }

  /** Where you wake up. */
  start() {
    const p = this.byId.get(this.activeId);
    if (!p) return null;
    this.b.load(p.site.id);
    this.b.load(p.garage.id);
    return { x: p.ox + p.def.ex, y: p.floor, z: p.oz + 1.6, heading: Math.PI };
  }

  setHome(id: string) {
    this.g.save.data.activeHome = id;
    const name = this.byId.get(id)?.def.name ?? STARTER_BENEFITS.name;
    this.g.hud.toast(`${name.toUpperCase()} IS YOUR HOME NOW`, 'cool');
  }

  buy(id: string) {
    const g = this.g, p = this.byId.get(id);
    if (!p || this.owns(id)) return false;
    if (g.save.data.cash < p.def.price) { g.audio.deny(); return false; }
    g.save.data.cash -= p.def.price;
    g.save.data.properties.push(id);
    g.audio.cash();
    this.refresh();
    g.news.headline(`${p.def.name} sold to a buyer who paid in cash`);
    g.hud.hint(`${p.def.name} is yours. Sleep in its bed to save it. Make it your home at any hacker desk.`);
    return true;
  }

  private refresh() {
    for (const p of this.list) p.sign.visible = !this.owns(p.def.id);
  }

  // ------------------------------------------------------------------ the building
  build() {
    for (const def of PROPERTIES) this.buildOne(def);
  }

  /** walls round a box, with window and door holes, a roof on top */
  private envelope(style: FacadeStyle, trim: string, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, holes: { side: 'n' | 's'; at: number; w: number; door?: boolean; tall?: boolean }[], glass: GeoBuilder, far: GeoBuilder) {
    const g = this.g, f = this.b.facade(style), e = this.b.ext;
    const tile = (worldMaterials().facades as Record<string, { tile: [number, number] }>)[style].tile;
    const wall = (ax0: number, az0: number, ax1: number, az1: number, ay0: number, ay1: number) => {
      if (ax1 - ax0 < 0.01 || az1 - az0 < 0.01 || ay1 - ay0 < 0.01) return;
      f.box(ax0, ay0, az0, ax1, ay1, az1, { tile });
      g.col.add(ax0, ay0, az0, ax1, ay1, az1, true, 'building');
    };
    const w = WALL;
    wall(x0, z0, x0 + w, z1, y0, y1);
    wall(x1 - w, z0, x1, z1, y0, y1);
    for (const side of ['n', 's'] as const) {
      const za = side === 'n' ? z0 : z1 - w, zb = za + w, outer = side === 'n' ? z0 : z1, out = side === 'n' ? -1 : 1;
      let cur = x0 + w;
      for (const h of holes.filter((o) => o.side === side).sort((p, q) => p.at - q.at)) {
        const a = h.at - h.w / 2, b = h.at + h.w / 2;
        wall(cur, za, a, zb, y0, y1);
        cur = b;
        if (h.door) { wall(a, za, b, zb, CURB_H + 3.3, y1); continue; }
        const sill = y0 + (h.tall ? TALL_SILL : WAIN), head = y0 + (h.tall ? TALL_HEAD : WIN_TOP);
        wall(a, za, b, zb, y0, sill);
        wall(a, za, b, zb, head, y1);
        g.col.add(a, sill, za, b, head, zb, false, 'window');
        const fx = outer + out * 0.02;
        const mid = (za + zb) / 2;
        e.box(a - 0.08, sill - 0.06, Math.min(fx, fx + out * 0.1), b + 0.08, sill + 0.05, Math.max(fx, fx + out * 0.1), { color: trim });
        e.box(a - 0.08, head - 0.05, Math.min(fx, fx + out * 0.1), b + 0.08, head + 0.06, Math.max(fx, fx + out * 0.1), { color: trim });
        for (const x of [a, h.at, b]) e.box(x - 0.05, sill, za, x + 0.05, head, zb, { color: trim });
        glass.box(a, sill, mid + 0.02, b, head, mid + 0.06, { color: '#9fb8c8' });
        far.box(a, sill, za + 0.08, b, head, za + 0.1, { color: '#d8a860' });
        far.box(a, sill, zb - 0.1, b, head, zb - 0.08, { color: '#d8a860' });
      }
      wall(cur, za, x1 - w, zb, y0, y1);
    }
    e.box(x0 - 0.2, y1, z0 - 0.2, x1 + 0.2, y1 + 0.3, z1 + 0.2, { color: '#6e6b65', shadeSides: true });
    e.box(x0 - 0.3, y1 - 0.6, z0 - 0.3, x1 + 0.3, y1, z1 + 0.3, { color: trim, shadeSides: true, skip: { py: true } });
    g.col.add(x0, y1 - 0.3, z0, x1, y1 + 0.3, z1, false, 'roof');
  }

  private buildOne(def: PropertyDef) {
    const g = this.g, e = this.b.ext;
    const c = blockCenter(def.bi, def.bj);
    const X0 = c.x - 17, X1 = c.x + 17, Z0 = c.z - 17, Z1 = c.z + 17;
    const raised = def.base > 0;
    const glass = new GeoBuilder(), farB = new GeoBuilder();
    const gx0 = X0 + WALL, gz0 = Z0 + WALL, gcx = gx0 + def.gw / 2;
    const ox = raised ? X0 + WALL : gx0 + def.gw + 0.2, oz = Z0 + WALL;
    const floor = def.base + F;
    const footX1 = ox + def.w + WALL;
    const footZ1 = oz + def.d + WALL;
    const holes = def.windows.map(([side, at, w]) => ({ side, at: ox + at, w, tall: def.tier >= 3 }));
    const garageHole = { side: 'n' as const, at: gcx, w: 6, door: true };

    if (raised) {
      // street level: a garage and a lobby wall, then the tower, then the home on top
      const groundH = 4.4;
      this.envelope(def.style, def.trim, X0, Z0, footX1, footZ1, 0, groundH, [garageHole], glass, farB);
      const mf = this.b.facade(def.style), tile = (worldMaterials().facades as Record<string, { tile: [number, number] }>)[def.style].tile;
      mf.box(X0, groundH, Z0, footX1, def.base, footZ1, { tile, skip: { ny: true } });
      g.col.add(X0, groundH, Z0, footX1, def.base, footZ1, true, 'building');
      // the floor you live on
      const homeH = def.top - def.base;
      this.envelope(def.style, def.trim, X0, Z0, footX1, footZ1, def.base, def.base + homeH, holes, glass, farB);
      if (def.tier >= 6) { // a crown
        e.box(c.x - 9, def.top + 0.3, c.z - 9, c.x + 9, def.top + 2.2, c.z + 9, { color: def.trim, shadeSides: true });
        e.cbox(c.x, def.top + 5, c.z, 0.4, 6, 0.4, { color: '#8e9092' });
      }
    } else {
      this.envelope(def.style, def.trim, X0, Z0, footX1, footZ1, 0, 4.4, [garageHole, ...holes], glass, farB);
      g.col.add(gx0 + def.gw, 0, Z0, gx0 + def.gw + 0.2, 4.4, footZ1, true, 'building');
      if (def.top > 4.6) { // flats upstairs
        const mf = this.b.facade(def.style), tile = (worldMaterials().facades as Record<string, { tile: [number, number] }>)[def.style].tile;
        mf.box(X0, 4.7, Z0, footX1, def.top, footZ1, { tile, skip: { ny: true } });
        g.col.add(X0, 4.7, Z0, footX1, def.top, footZ1, true, 'building');
        e.box(X0 - 0.3, def.top, Z0 - 0.3, footX1 + 0.3, def.top + 0.4, footZ1 + 0.3, { color: def.trim, shadeSides: true });
      }
    }
    this.fillLot(def, footX1, footZ1, X0, X1, Z0, Z1);

    const gm = new THREE.Mesh(glass.build(), basicMat({ vertexColors: true, transparent: true, opacity: 0.16, depthWrite: false }));
    gm.renderOrder = 2;
    g.scene.add(gm);
    const far = new THREE.Mesh(farB.build(), worldMaterials().glow);
    g.scene.add(far);

    // front door, on the street
    const doorX = ox + def.ex;
    e.box(doorX - 1, CURB_H, Z0 - 0.08, doorX + 1, CURB_H + 2.5, Z0, { color: '#3b2c20' });
    e.box(doorX - 0.85, CURB_H, Z0 - 0.14, doorX + 0.85, CURB_H + 2.38, Z0 - 0.08, { color: def.tier >= 4 ? '#c4a03c' : '#2f4a5a' });
    e.box(doorX - 1.2, CURB_H + 2.6, Z0 - 1, doorX + 1.2, CURB_H + 2.72, Z0, { color: '#3a3c3e' });
    e.box(doorX - 0.8, CURB_H + 0.005, Z0 - 1.1, doorX + 0.8, CURB_H + 0.03, Z0 - 0.1, { color: '#7a6a50' });

    // garage door and apron
    e.box(gcx - 3, CURB_H + 0.01, Z0 - 4, gcx + 3, CURB_H + 0.02, Z0, { color: '#4e4c48' });
    const slats = new GeoBuilder();
    for (let y = 0; y < 3.2; y += 0.32) slats.box(-3, y, -0.05, 3, y + 0.29, 0.05, { color: y % 0.64 < 0.32 ? '#7d7a72' : '#74716a' });
    const roll = new THREE.Mesh(slats.build(), worldMaterials().props);
    roll.position.set(gcx, CURB_H, Z0 + 0.25);
    roll.castShadow = true;
    g.scene.add(roll);
    const rollCol = g.col.add(gcx - 3, 0, Z0, gcx + 3, 3.5, Z0 + WALL, true, 'door');

    // the sign out front
    const sign = new Kit(g.col);
    const sx = doorX + 2.6, sz = Z0 - 1.2;
    sign.props.cbox(sx, CURB_H + 1, sz, 0.1, 2, 0.1, { color: '#3a3c3e' });
    sign.sign('FOR SALE', sx, CURB_H + 2.3, sz, Math.PI, 2.4, 0.6, '#c0281e', '#fff1d0');
    sign.sign(`$${def.price.toLocaleString()}`, sx, CURB_H + 1.65, sz, Math.PI, 2.4, 0.5, '#fff1d0', '#141416');
    sign.finish(g.scene);

    const bays: Live['bays'] = [];
    const bayW = def.gw / def.cars;
    for (let i = 0; i < def.cars; i++) bays.push({ x: gx0 + bayW * (i + 0.5), z: gz0 + def.gd - 4, heading: Math.PI, bike: false });
    for (let i = 0; i < def.bikes; i++) bays.push({ x: gx0 + 1, z: gz0 + 1.4 + i * 1.5, heading: Math.PI / 2, bike: true });

    const door = { x: doorX, z: Z0 - 1.4 };
    const p = { def, ox, oz, floor, gx0, gz0, gcx, door, roll, rollCol, rollY: 0, far, sign: sign.group, bays, live: bays.map(() => null) } as unknown as Live;
    this.list.push(p);
    this.byId.set(def.id, p);

    const entry = { x: door.x, z: door.z, heading: Math.PI };
    p.site = this.b.site({
      id: `prop-${def.id}`, name: def.name, open: true, x0: ox, z0: oz, x1: ox + def.w, z1: oz + def.d, ceiling: 3, minY: raised ? def.base - 1 : undefined, maxY: def.base + 4,
      door: entry, approach: entry,
      build: (k, s) => this.buildHome(p, k, s),
    });
    p.garage = this.b.site({
      id: `prop-${def.id}-g`, name: `${def.name} garage`, open: true, x0: gx0, z0: gz0, x1: gx0 + def.gw, z1: gz0 + def.gd, ceiling: 3.6, maxY: 4,
      door: { x: gcx, z: Z0 - 2, heading: Math.PI }, approach: { x: gcx, z: Z0 - 2, heading: Math.PI },
      build: (k, s) => this.buildGarage(p, k, s),
      unload: () => this.unloadCars(p),
    });
    g.interactables.push({
      pos: new THREE.Vector3(door.x, CURB_H, door.z), radius: 1.6,
      get label() { return g.properties.owns(def.id) ? (g.police.heat > 0 ? 'Go inside: the police can\'t follow' : `Go inside ${def.name}`) : `For sale: ${def.kind}, $${def.price.toLocaleString()}`; },
      enabled: () => !g.player.vehicle,
      action: () => {
        if (this.owns(def.id)) this.enter(p);
        else g.homeUi.openProperty(def.id);
      },
    });
  }

  /** the rest of the block: more building, or a garden */
  private fillLot(def: PropertyDef, fx1: number, fz1: number, X0: number, X1: number, Z0: number, Z1: number) {
    const g = this.g, e = this.b.ext;
    if (def.garden) {
      const grass = '#4a6a34';
      if (X1 - fx1 > 0.5) e.box(fx1, CURB_H, Z0, X1, CURB_H + 0.02, Z1, { color: grass });
      if (Z1 - fz1 > 0.5) e.box(X0, CURB_H, fz1, fx1, CURB_H + 0.02, Z1, { color: grass });
      // a hedge round the plot, and a few trees that aren't the city's
      const hedge = (x0: number, z0: number, x1: number, z1: number) => { e.box(x0, CURB_H, z0, x1, CURB_H + 1.3, z1, { color: '#3a5a2c', shadeSides: true }); g.col.add(x0, 0, z0, x1, CURB_H + 1.3, z1, false, 'prop'); };
      hedge(fx1, Z0, X1, Z0 + 0.8);
      hedge(X1 - 0.8, Z0, X1, Z1);
      hedge(X0, Z1 - 0.8, X1, Z1);
      hedge(X0, fz1, X0 + 0.8, Z1);
      const tree = (x: number, z: number) => {
        e.cbox(x, CURB_H + 1.2, z, 0.35, 2.4, 0.35, { color: '#5b4330' });
        e.cbox(x, CURB_H + 3.2, z, 2.6, 2, 2.6, { color: '#4f7a3a', shadeSides: true });
        g.col.addCentered(x, z, 0.4, 0.4, 3, 0, false, 'tree');
      };
      if (X1 - fx1 > 4) for (const z of [Z0 + 6, Z0 + 16, Z0 + 28]) if (z < Z1 - 3) tree((fx1 + X1) / 2, z);
      if (Z1 - fz1 > 4) for (const x of [X0 + 6, X0 + 18, X0 + 28]) tree(x, (fz1 + Z1) / 2);
      return;
    }
    if (!def.fill) return;
    const tile = (worldMaterials().facades as Record<string, { tile: [number, number] }>)[def.fill].tile;
    const f = this.b.facade(def.fill);
    const block = (x0: number, z0: number, x1: number, z1: number, h: number) => {
      if (x1 - x0 < 1 || z1 - z0 < 1) return;
      f.box(x0, 0, z0, x1, h, z1, { tile, skip: { ny: true } });
      g.col.add(x0, 0, z0, x1, h, z1, true, 'building');
      e.box(x0 - 0.2, h, z0 - 0.2, x1 + 0.2, h + 0.3, z1 + 0.2, { color: '#6e6b65', shadeSides: true });
    };
    block(fx1 + 0.05, Z0, X1, fz1, def.top);
    block(X0, fz1 + 0.05, X1, Z1, Math.max(8, def.top - 4));
  }

  // ------------------------------------------------------------------ inside
  private act(p: Live, s: Site) {
    const g = this.g;
    return (label: string | (() => string), x: number, z: number, r: number, fn: () => void, on?: () => boolean) => {
      const it = {
        pos: new THREE.Vector3(p.ox + x, p.floor, p.oz + z), radius: r,
        get label() { return typeof label === 'string' ? label : label(); },
        enabled: () => g.properties.owns(p.def.id) && (on ? on() : true),
        action: fn,
      };
      s.interactables.push(it);
    };
  }

  private buildHome(p: Live, k: Kit, s: Site) {
    const g = this.g, def = p.def, base = def.base;
    const { ox, oz } = p;
    k.propsMat = homeMaterial();
    k.props = new GeoBuilder();
    const openings: Opening[] = [
      ...def.doors.map(([axis, fixed, at, w]) => ({ axis, fixed: fixed + (axis === 'z' ? oz : ox), at: at + (axis === 'z' ? ox : oz), w })),
      ...def.windows.map(([side, at, w]) => ({ axis: 'z' as const, fixed: side === 'n' ? oz : oz + def.d, at: ox + at, w, window: true, ...(def.tier >= 3 ? { sill: TALL_SILL, head: TALL_HEAD } : {}) })),
    ];
    const lamps: Lamp[] = [];
    const rooms: RoomDef[] = def.rooms.map(([x0, z0, x1, z1, pal]) => ({
      x0: ox + x0, z0: oz + z0, x1: ox + x1, z1: oz + z1, wall: pal.wall, wain: pal.wain,
      floor: (i: number, j: number) => ((i + j) % 2 ? pal.a : pal.b),
    }));
    for (const r of rooms) {
      paintRoom(k, r, openings, base);
      const w = r.x1 - r.x0, d = r.z1 - r.z0;
      const rect: Lamp['rect'] = [r.x0, r.z0, r.x1, r.z1];
      // big rooms get a row of lights
      const nx = Math.max(1, Math.round(w / 10)), nz = Math.max(1, Math.round(d / 10));
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const lx = r.x0 + ((i + 0.5) * w) / nx, lz = r.z0 + ((j + 0.5) * d) / nz;
        lamps.push({ x: lx, y: TOP + base - 0.1, z: lz, c: [1, 0.76, 0.48], reach: Math.max(7.5, Math.max(w / nx, d / nz) * 1.05), rect });
        k.glow.box(lx - 0.8, TOP + base - 0.05, lz - 0.25, lx + 0.8, TOP + base, lz + 0.25, { color: '#ffdf9e' });
      }
    }
    k.bake = makeBake(lamps);
    for (const [axis, fixed, a0, a1] of def.walls) {
      const line = fixed + (axis === 'z' ? oz : ox);
      partitionWall(k, openings.filter((o) => !o.window), axis, line, a0 + (axis === 'z' ? ox : oz), a1 + (axis === 'z' ? ox : oz), base);
    }
    // ceiling, and a floor if we're up in the air
    k.solid(ox, TOP + base, oz, ox + def.w, TOP + base + 0.3, oz + def.d, true, 'ceiling');
    if (base > 0) {
      k.surface({ x0: ox, z0: oz, x1: ox + def.w, z1: oz + def.d, h0: p.floor });
      k.solid(ox, p.floor - 0.3, oz, ox + def.w, p.floor - 0.02, oz + def.d, false, 'floor');
    }

    const act = this.act(p, s);
    def.fit(new Furnish(k, ox, oz, p.floor, act, g));

    // the way out
    k.props.box(ox + def.ex - 0.85, p.floor, oz + 0.02, ox + def.ex + 0.85, p.floor + DOOR_TOP - F, oz + 0.08, { color: def.tier >= 4 ? '#c4a03c' : '#6b2f2a' });
    s.interactables.push({
      pos: new THREE.Vector3(ox + def.ex, p.floor, oz + 1), radius: 1.4,
      get label() { return g.properties.owns(def.id) ? (base > 0 ? 'Lift to the street' : 'Go outside') : 'Leave'; },
      enabled: () => !g.player.vehicle,
      action: () => this.leave(p),
    });
    const linkX = base > 0 ? def.link + 3 : 0.8, linkZ = base > 0 ? 1 : def.link;
    if (base > 0) k.props.box(ox + def.ex + 2.2, p.floor, oz + 0.02, ox + def.ex + 3.8, p.floor + DOOR_TOP - F, oz + 0.08, { color: '#8e9092' });
    else k.props.box(ox + 0.02, p.floor, oz + def.link - 0.7, ox + 0.08, p.floor + DOOR_TOP - F, oz + def.link + 0.7, { color: '#5a5448' });
    s.interactables.push({
      pos: new THREE.Vector3(ox + linkX, p.floor, oz + linkZ), radius: 1.3, label: base > 0 ? 'Lift to the garage' : 'Door to the garage',
      enabled: () => !g.player.vehicle && this.owns(def.id),
      action: () => { g.audio.door(); g.fadeTeleport(p.gx0 + def.gw - 1.4, F, p.gz0 + Math.min(def.gd - 1, base > 0 ? 8 : def.link), -Math.PI / 2, ''); },
    });
    this.refresh();
  }

  private buildGarage(p: Live, k: Kit, s: Site) {
    const g = this.g, def = p.def;
    const x0 = p.gx0, z0 = p.gz0, x1 = x0 + def.gw, z1 = z0 + def.gd;
    k.propsMat = homeMaterial();
    k.props = new GeoBuilder();
    const room: RoomDef = { x0, z0, x1, z1, wall: GARAGE.wall, wain: GARAGE.wain, floor: (i, j) => ((i * 7 + j * 11) % 13 === 0 ? GARAGE.b : GARAGE.a), top: F + 3.6 };
    const openings: Opening[] = [{ axis: 'z', fixed: z0, at: p.gcx, w: 6 }];
    paintRoom(k, room, openings, 0);
    const lamps: Lamp[] = [];
    for (let x = x0 + 3; x < x1; x += 6) {
      lamps.push({ x, y: 3.4, z: (z0 + z1) / 2, c: [1, 0.82, 0.58], reach: 13, rect: [x0, z0, x1, z1] });
      k.glow.box(x - 0.9, F + 3.55, (z0 + z1) / 2 - 0.3, x + 0.9, F + 3.6, (z0 + z1) / 2 + 0.3, { color: '#ffe2a8' });
    }
    k.bake = makeBake(lamps);
    k.solid(x0, F + 3.6, z0, x1, F + 3.9, z1, true, 'ceiling');
    k.solid(x0, 0, z1, x1, 4, z1 + 0.2, true);
    k.solid(x1, 0, z0, x1 + 0.2, 4, z1 + 0.2, true);
    for (const b of p.bays) {
      if (b.bike) { k.props.box(b.x - 0.8, F, b.z - 0.6, b.x + 0.8, F + 0.01, b.z - 0.54, { color: '#c4a03c' }); continue; }
      const w = Math.min(1.6, (def.gw / def.cars) / 2 - 0.1);
      for (const sx of [-w, w]) k.props.box(b.x + sx - 0.06, F, b.z - 3.4, b.x + sx + 0.06, F + 0.01, b.z + 3.4, { color: '#c4a03c' });
    }
    // a workbench along the back, longer in a better house
    const bench = Math.min(def.gw - 2, 3 + def.tier * 1.5);
    k.block(x0 + 1, F, z1 - 0.8, x0 + 1 + bench, F + 0.9, z1 - 0.05, '#5b4330');
    k.props.box(x0 + 1, F + 0.9, z1 - 0.85, x0 + 1 + bench, F + 0.96, z1, { color: '#6b4f38' });
    for (let x = x0 + 1.3; x < x0 + bench; x += 0.9) k.props.box(x, F + 1.45, z1 - 0.06, x + 0.1, F + 2.05, z1 - 0.02, { color: x % 1.8 < 0.9 ? '#8e9092' : '#9b3b2f' });
    k.props.box(x1 - 0.08, F, z0 + Math.min(def.gd - 1, def.base > 0 ? 8 : def.link) - 0.7, x1 - 0.02, DOOR_TOP, z0 + Math.min(def.gd - 1, def.base > 0 ? 8 : def.link) + 0.7, { color: '#5a5448' });
    s.interactables.push({
      pos: new THREE.Vector3(x1 - 0.8, F, z0 + Math.min(def.gd - 1, def.base > 0 ? 8 : def.link)), radius: 1.3, label: def.base > 0 ? 'Lift up to the penthouse floor' : 'Door to the house',
      enabled: () => !g.player.vehicle && this.owns(def.id),
      action: () => { g.audio.door(); g.fadeTeleport(p.ox + (def.base > 0 ? def.link : 1.6), p.floor, p.oz + (def.base > 0 ? 2 : def.link), Math.PI / 2, ''); },
    });
    this.spawnCars(p);
  }

  // ------------------------------------------------------------------ doors
  private enter(p: Live) {
    this.g.audio.door();
    this.g.fadeTeleport(p.ox + p.def.ex, p.floor, p.oz + 1.8, 0, p.def.name.toUpperCase());
    this.b.load(p.site.id);
  }

  tour(id: string) {
    const p = this.byId.get(id), g = this.g;
    if (!p) return;
    if (g.police.heat > 0) { g.hud.toast('THE AGENT WON\'T SHOW YOU ROUND WITH THE POLICE ON YOU', 'dim'); g.audio.deny(); return; }
    this.touring = id;
    this.enter(p);
    g.hud.hint('Have a look round. Leave by the front door.');
  }

  private leave(p: Live) {
    const g = this.g;
    this.touring = null;
    g.audio.door();
    g.fadeTeleport(p.door.x, CURB_H, p.door.z, Math.PI, g.police.heat > 0 ? 'THEY ARE STILL OUT HERE' : '');
  }

  // ------------------------------------------------------------------ garage storage
  stored(id: string) {
    const s = this.g.save.data.propCars;
    const p = this.byId.get(id);
    if (!p) return [];
    return (s[id] ??= p.bays.map(() => null));
  }

  private bayFor(p: Live, two: boolean) {
    const st = this.stored(p.def.id);
    const free = (bike: boolean) => p.bays.findIndex((b, i) => b.bike === bike && !st[i]);
    if (two) { const i = free(true); return i >= 0 ? i : free(false); }
    return free(false);
  }

  private spawnAt(p: Live, i: number) {
    const o = this.stored(p.def.id)[i], g = this.g;
    if (!o) return;
    const b = p.bays[i];
    const v = new Vehicle(o.kind as CarKind, o.color, g.col);
    v.place(b.x, b.z, b.heading);
    v.handbrake = true;
    g.addVehicle(v);
    p.live[i] = v;
  }

  private spawnCars(p: Live) {
    const st = this.stored(p.def.id);
    for (let i = 0; i < p.bays.length; i++) {
      const v = p.live[i];
      if (st[i] && !(v && this.g.vehicles.includes(v))) this.spawnAt(p, i);
    }
  }

  /** only cars still standing in their bays go away; one you've driven off stays out there */
  private unloadCars(p: Live) {
    const g = this.g;
    p.live = p.live.map((v, i) => {
      if (!v) return null;
      const b = p.bays[i];
      if (v.driver === 'none' && Math.hypot(v.pos.x - b.x, v.pos.z - b.z) < 3) { g.removeVehicle(v); return null; }
      return v;
    });
  }

  /** the desk's collection tab: bring a car you own to this garage */
  fetch(p: Live, o: OwnedVehicle) {
    const g = this.g;
    const i = this.bayFor(p, o.kind === 'bicycle' || o.kind === 'scooter' || o.kind === 'motorbike' || o.kind === 'policemoto');
    if (i < 0) { g.hud.toast('THIS GARAGE IS FULL', 'dim'); g.audio.deny(); return; }
    this.stored(p.def.id)[i] = o;
    if (p.garage.kit) this.spawnAt(p, i);
    g.hud.toast(`${o.label.toUpperCase()} IS IN THE GARAGE`, 'cool');
  }

  sendAway(p: Live, o: OwnedVehicle) {
    const st = this.stored(p.def.id), i = st.findIndex((x) => x && x.kind === o.kind && x.color === o.color);
    if (i < 0) return;
    st[i] = null;
    const v = p.live[i];
    if (v && v.driver === 'none' && this.g.vehicles.includes(v)) this.g.removeVehicle(v);
    p.live[i] = null;
  }

  isStored(p: Live, o: OwnedVehicle) {
    return this.stored(p.def.id).some((x) => x && x.kind === o.kind && x.color === o.color);
  }

  private park(p: Live, v: Vehicle) {
    const g = this.g, s = g.save.data;
    if (v.wrecked) { g.hud.toast('TOO WRECKED TO KEEP', 'dim'); g.audio.deny(); return; }
    const mine = p.live.indexOf(v);
    const i = mine >= 0 ? mine : this.bayFor(p, v.two);
    if (i < 0) { g.hud.toast('THIS GARAGE IS FULL. MAKE ROOM AT THE DESK', 'dim'); g.audio.deny(); return; }
    const known = s.ownedVehicles.some((o) => o.kind === v.kind && o.color === v.color);
    const entry: OwnedVehicle = { kind: v.kind, color: v.color, label: RARES.find((r) => r.id === v.rareId)?.name ?? `${g.news.colorName(v.color)} ${v.label.toLowerCase()}` };
    if (!known) s.ownedVehicles.push(entry);
    this.stored(p.def.id)[i] = entry;
    const b = p.bays[i];
    g.fadeTeleport(p.gx0 + p.def.gw / 2, F, p.gz0 + 3, Math.PI, known || v.rareId ? 'PARKED' : `NEW IN THE COLLECTION: ${entry.label.toUpperCase()} (${s.ownedVehicles.length})`, () => {
      g.player.exitVehicle(true);
      const j = g.parked.indexOf(v);
      if (j >= 0) g.parked.splice(j, 1);
      v.place(b.x, b.z, b.heading);
      v.handbrake = true;
      v.locked = false;
      v.repair();
      p.live[i] = v;
      g.collection.onPark(v);
    });
    g.audio.unlock();
  }

  // ------------------------------------------------------------------ per frame
  onWorldReset() {
    this.touring = null;
    for (const p of this.list) {
      p.live = p.bays.map(() => null);
      if (p.garage.kit) this.spawnCars(p);
    }
    this.refresh();
  }

  update(dt: number, realDt: number) {
    const g = this.g, P = g.player.worldPos, v = g.player.vehicle;
    this.hintT -= realDt;
    for (const p of this.list) {
      p.far.visible = !p.site.kit;
      const d = Math.hypot(P.x - p.gcx, P.z - (p.gz0 - 0.5));
      if (d > 40 && p.rollY === 0) continue;
      const near = d < (v ? 16 : 7);
      const inside = g.siteAt(P.x, P.z, P.y) === p.garage.id;
      const owned = this.owns(p.def.id);
      const open = inside || (near && owned && g.police.heat === 0);
      if (near && !open && !inside && this.hintT <= 0) { g.hud.hint(owned ? 'The garage stays shut while the police are on you.' : `${p.def.name} is for sale. The door round the front.`); this.hintT = 8; }
      const prev = p.rollY;
      p.rollY = damp(p.rollY, open ? 1 : 0, 4, dt);
      if (p.rollY < 0.002 && !open) p.rollY = 0;
      if (Math.abs(prev - p.rollY) > 0.001) p.roll.position.y = CURB_H + p.rollY * 3.15;
      p.rollCol.enabled = p.rollY < 0.82;
      if (v && inside && v.speedAbs < 3.5 && !g.carAction) {
        const mine = p.live.includes(v);
        const known = g.save.data.ownedVehicles.some((o) => o.kind === v.kind && o.color === v.color);
        const room = mine || this.bayFor(p, v.two) >= 0;
        g.carAction = { label: !room ? 'Garage full: make room at the desk' : mine || known ? (v.health < 0.999 ? 'Park it: free repair' : 'Park it in the garage') : `Park and repair: add ${v.label.toLowerCase()} to the collection`, action: () => this.park(p, v) };
      }
    }
  }
}
