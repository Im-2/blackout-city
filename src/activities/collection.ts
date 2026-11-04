// Rare cars: nine one-offs parked around the city, grouped into sets. Steal one, park
// it in your garage, and it's yours. You only know the district until you've been
// close enough to spot it. Finishing a set pays out.
import * as THREE from 'three';
import { Vehicle } from '../vehicles/vehicle';
import { DISTRICTS, District } from '../map/districts';
import type { CarKind } from '../vehicles/carMesh';
import type { Game } from '../core/game';

export interface RareCar {
  id: string;
  name: string;
  kind: CarKind;
  color: string;
  set: string;
  district: District;
  /** roughly where: snapped to a parking spot at start-up */
  x: number;
  z: number;
  hint: string;
}

export const RARE_SETS: { id: string; name: string; cash: number; rep: number }[] = [
  { id: 'legends', name: 'Street Legends', cash: 5000, rep: 15 },
  { id: 'working', name: 'Working Class', cash: 4000, rep: 10 },
  { id: 'clock', name: 'Off the Clock', cash: 6000, rep: 15 },
];
const ALL_BONUS = 15000;

export const RARES: RareCar[] = [
  { id: 'gold_muscle', name: 'Gold Muscle', kind: 'muscle', color: '#d8b020', set: 'legends', district: 'oldtown', x: -250, z: 40, hint: 'A gold V8 on the back streets of Old Town' },
  { id: 'red_comet', name: 'Red Comet', kind: 'sports', color: '#c0281e', set: 'legends', district: 'downtown', x: 90, z: -160, hint: 'Parked outside somebody\'s office in Downtown' },
  { id: 'ghost_line', name: 'Ghost Line', kind: 'sports', color: '#e8e6e0', set: 'legends', district: 'park', x: -30, z: 300, hint: 'Somebody\'s weekend toy, by the waterfront' },
  { id: 'pink_truck', name: 'Pink Taco Truck', kind: 'foodtruck', color: '#ff7ab8', set: 'working', district: 'park', x: 110, z: 300, hint: 'You can\'t miss it. Park & Waterfront' },
  { id: 'chrome_box', name: 'Chrome Hauler', kind: 'boxtruck', color: '#b8bcc0', set: 'working', district: 'docks', x: 250, z: -60, hint: 'A polished box truck in the Docks' },
  { id: 'harbour_tug', name: 'Harbour Tug', kind: 'pickup', color: '#3f7b88', set: 'working', district: 'docks', x: 290, z: 120, hint: 'A dock foreman\'s pride, down by the water' },
  { id: 'old_cruiser', name: 'Retired Cruiser', kind: 'police', color: '#e6e4dc', set: 'clock', district: 'residential', x: -200, z: -280, hint: 'A cop\'s old car, on a quiet Residential street' },
  { id: 'night_ambulance', name: 'Night Ambulance', kind: 'ambulance', color: '#1c1c1e', set: 'clock', district: 'residential', x: 60, z: 190, hint: 'Painted black. South Residential' },
  { id: 'black_moto', name: 'Black Moto', kind: 'motorbike', color: '#1c1c1e', set: 'clock', district: 'oldtown', x: -280, z: -20, hint: 'Hidden on the western edge of Old Town' },
];

interface Slot { car: RareCar; x: number; z: number; heading: number; v: Vehicle | null; }

const STREAM_IN = 120, STREAM_OUT = 175, SPOT_R = 70;

export class Collection {
  private slots: Slot[] = [];
  private glint = 0;

  constructor(private g: Game) {}

  build() {
    const g = this.g;
    this.slots = RARES.map((car) => {
      let best = g.city.parking[0], bd = Infinity;
      for (const s of g.city.parking) {
        const d = Math.hypot(s.x - car.x, s.z - car.z);
        if (d < bd) { bd = d; best = s; }
      }
      return { car, x: best.x, z: best.z, heading: best.heading, v: null };
    });
    return this;
  }

  reset() {
    for (const s of this.slots) s.v = null;
  }

  owned(id: string) { return !!this.g.save.data.rare[id]; }
  get count() { return RARES.filter((r) => this.owned(r.id)).length; }
  get total() { return RARES.length; }
  setCars(set: string) { return RARES.filter((r) => r.set === set); }
  setDone(set: string) { return this.setCars(set).every((r) => this.owned(r.id)); }
  get setsDone() { return RARE_SETS.filter((s) => this.setDone(s.id)).length; }
  get progress() { return `RARE CARS ${this.count}/${this.total} · SETS ${this.setsDone}/${RARE_SETS.length}`; }

  /** map entries: exact once you've spotted it, otherwise only the district */
  mapPos(c: RareCar) {
    const slot = this.slots.find((s) => s.car === c)!;
    if (this.g.save.data.rareSeen[c.id]) return { x: slot.x, z: slot.z, known: true };
    return { x: Math.round(c.x / 84) * 84, z: Math.round(c.z / 84) * 84, known: false };
  }

  /** you parked it at home */
  onPark(v: Vehicle) {
    const g = this.g, id = v.rareId;
    if (!id || this.owned(id)) return;
    const s = g.save.data;
    s.rare[id] = true;
    const car = RARES.find((r) => r.id === id)!;
    g.hud.toast(`RARE CAR: ${car.name.toUpperCase()} (${this.count}/${this.total})`, 'win');
    g.audio.cash();
    g.rep.add(car.district, 5);
    g.news.headline(`${car.name} reported stolen in ${DISTRICTS[car.district].name}. Owner "devastated"`);
    const set = RARE_SETS.find((x) => x.id === car.set)!;
    if (this.setDone(set.id) && !s.rareSets[set.id]) {
      s.rareSets[set.id] = true;
      g.loot.addCash(set.cash);
      g.rep.add(car.district, set.rep);
      g.hud.toast(`SET COMPLETE: ${set.name.toUpperCase()} +$${set.cash.toLocaleString()}`, 'win');
    }
    if (this.count === this.total && !s.rareSets.all) {
      s.rareSets.all = true;
      g.loot.addCash(ALL_BONUS);
      g.hud.toast(`THE WHOLE COLLECTION +$${ALL_BONUS.toLocaleString()}`, 'win');
    }
  }

  update(dt: number) {
    const g = this.g;
    const P = g.player.worldPos;
    this.glint -= dt;
    const sparkle = this.glint <= 0;
    if (sparkle) this.glint = 1.1;
    const seen = g.save.data.rareSeen;
    for (const s of this.slots) {
      if (this.owned(s.car.id)) {
        if (s.v && s.v.driver === 'none' && s.v !== g.home.car) { g.removeVehicle(s.v); }
        s.v = null;
        continue;
      }
      const d = Math.hypot(s.x - P.x, s.z - P.z);
      if (d < SPOT_R && !seen[s.car.id]) {
        seen[s.car.id] = true;
        g.activities.showCard({ name: s.car.name, type: 'rare', intro: `A rare car, now marked on your map. Pick the lock, then drive it into your garage and park it to keep it. ${s.car.hint}.` });
      }
      const v = s.v;
      if (v) {
        if (!g.vehicles.includes(v)) { s.v = null; continue; }
        const moved = Math.hypot(v.pos.x - s.x, v.pos.z - s.z) > 2.5;
        // left somewhere and forgotten, or wrecked: it goes back where it was
        if (v !== g.player.vehicle && (d > STREAM_OUT || (moved && Math.hypot(v.pos.x - P.x, v.pos.z - P.z) > STREAM_OUT))) { g.removeVehicle(v); s.v = null; continue; }
        if (sparkle && !moved && d < 70) g.fx.spawn('hack', new THREE.Vector3(v.pos.x, v.pos.y + v.parts.dims.h + 0.3, v.pos.z), 3);
        continue;
      }
      if (d > STREAM_IN) continue;
      for (const o of [...g.vehicles]) if (o.driver === 'none' && o !== g.home.car && Math.hypot(o.pos.x - s.x, o.pos.z - s.z) < 5.5) g.removeVehicle(o);
      const nv = new Vehicle(s.car.kind, s.car.color, g.col);
      nv.place(s.x, s.z, s.heading);
      nv.rareId = s.car.id;
      nv.isCop = false;
      nv.isEmergency = false;
      nv.locked = true;
      nv.handbrake = true;
      nv.p.maxSpeed *= 1.08;
      g.addVehicle(nv);
      s.v = nv;
    }
  }
}
