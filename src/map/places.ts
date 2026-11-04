// Everything with a spot on the map, in one list: what it is, what it looks like,
// how important it is. The full map, the LOCATIONS panel and the minimap all read this.
import { TYPE_INFO } from '../missions/types';
import { DISTRICTS, districtAt } from './districts';
import type { IconKind } from '../ui/mapicons';
import type { Game } from '../core/game';

export type PlaceCategory = 'mission' | 'race' | 'activity' | 'shop' | 'service';

export interface Place {
  id: string;
  name: string;
  desc: string;
  category: PlaceCategory;
  icon: IconKind;
  color: string;
  tag?: string;
  /** draws on top of lower numbers, and keeps its true position when things crowd */
  prio: number;
  x: number;
  z: number;
  district: string;
  status: string;
  locked: boolean;
  done: boolean;
  /** stays on the edge of the minimap when out of range */
  pin: boolean;
  /** the mission marker is hidden while you're on a mission */
  missionMarker: boolean;
}

export const PRIO = { active: 100, mission: 90, race: 85, home: 80, key: 70, activity: 60, shop: 50, garage: 40, minor: 30 };

const STATIC: { id: string; name: string; desc: string; category: PlaceCategory; icon: IconKind; color: string; tag?: string; prio: number; x: number; z: number; status?: string; locked?: boolean }[] = [
  { id: 'home', name: 'Home', desc: 'Your flat. Sleep in the bed to save. Police can\'t follow you in.', category: 'service', icon: 'house', color: '#7dffb0', prio: PRIO.home, x: -28, z: 46 },
  { id: 'home-garage', name: 'Your garage', desc: 'Park a stolen vehicle here to add it to your collection.', category: 'service', icon: 'garage', color: '#7dffb0', tag: 'G', prio: PRIO.garage, x: -39.75, z: 47 },
  { id: 'bank', name: 'City Savings Bank', desc: 'The big score. Start the heist at its marker on Union Blvd.', category: 'service', icon: 'bank', color: '#e6c84a', prio: PRIO.key, x: -84, z: -27 },
  { id: 'police', name: 'Police station', desc: 'Records room hack: heat -2, routes forgotten. Staff areas are trespassing.', category: 'service', icon: 'shield', color: '#4a7cff', prio: PRIO.key, x: 84, z: 11 },
  { id: 'tower', name: 'Vantage Tower', desc: 'Server room, rooftop helipad and ziplines.', category: 'service', icon: 'tower', color: '#c8c3b5', prio: PRIO.key, x: 28, z: 14 },
  { id: 'mart', name: 'Mart 24', desc: 'Rob or skim the register.', category: 'shop', icon: 'circle', color: '#5ac8c8', tag: 'S', prio: PRIO.shop, x: -40.5, z: 10 },
  { id: 'gems', name: 'Gems & Co', desc: 'Hack the door. Lasers, four cases and a safe.', category: 'shop', icon: 'circle', color: '#d898e8', tag: 'S', prio: PRIO.shop, x: -28, z: 10 },
  { id: 'pawn', name: 'Pawn & Loan', desc: 'The fence buys your loot. Also sells clothes.', category: 'shop', icon: 'coin', color: '#ffd24a', tag: '$', prio: PRIO.shop, x: -16.7, z: 10 },
  { id: 'parking', name: 'Parking garage', desc: 'Three levels, cars to swap, respray booth $200.', category: 'service', icon: 'garage', color: '#8fb0d6', tag: 'P', prio: PRIO.garage, x: 11, z: 84 },
  { id: 'old-garage', name: 'Old Garage', desc: 'The heist drop. Get here with the loot, unseen.', category: 'service', icon: 'garage', color: '#ffb000', tag: 'D', prio: PRIO.garage, x: 125, z: 141 },
  { id: 'arcade', name: 'Lucky 7 Arcade', desc: 'Closed for now.', category: 'shop', icon: 'circle', color: '#6a6f78', tag: 'x', prio: PRIO.minor, x: -140, z: 9.6, status: 'Closed', locked: true },
  { id: 'warehouse', name: 'Harbor Freight', desc: 'Closed for now.', category: 'service', icon: 'circle', color: '#6a6f78', tag: 'x', prio: PRIO.minor, x: 137, z: 65.5, status: 'Closed', locked: true },
];

const districtName = (x: number, z: number) => DISTRICTS[districtAt(x, z)].name;

export class Places {
  constructor(private g: Game) {}

  /** a fresh list: statuses change as you play */
  list(): Place[] {
    const g = this.g;
    const out: Place[] = [];
    const base = (p: Pick<Place, 'id' | 'name' | 'desc' | 'category' | 'icon' | 'color' | 'prio' | 'x' | 'z'> & Partial<Place>): Place => ({
      district: districtName(p.x, p.z), status: 'Available', locked: false, done: false, pin: false, missionMarker: false, ...p,
    });
    const run = g.missions.run?.def.id;
    for (const d of g.missions.defs) {
      const st = g.missions.status(d), t = TYPE_INFO[d.type], rec = g.save.data.completed[d.id];
      const active = run === d.id;
      out.push(base({
        id: d.id, name: d.title, desc: d.intro, category: d.type === 'race' ? 'race' : d.category ?? 'mission',
        icon: d.icon ?? (d.type === 'race' ? 'flag' : 'diamond'), color: st === 'locked' ? '#6a6f78' : t.color, tag: t.tag,
        prio: active ? PRIO.active : d.type === 'race' ? PRIO.race : PRIO.mission,
        x: d.marker.x, z: d.marker.z, district: DISTRICTS[d.district].name,
        status: active ? 'In progress' : st === 'locked' ? `Locked: ${d.unlock?.hint ?? ''}` : rec ? `Completed ×${rec.n}` : 'Available',
        locked: st === 'locked', done: st === 'done' || !!rec, pin: st !== 'done', missionMarker: true,
      }));
    }
    for (const s of STATIC) out.push(base({ ...s, status: s.status ?? 'Available', locked: !!s.locked, pin: s.id === 'home' }));
    for (const s of g.activities.spots) {
      const bike = s.type === 'bike';
      out.push(base({
        id: s.id, name: s.name, desc: s.intro, category: bike ? 'service' : 'activity',
        icon: bike ? (s.tag === '$' ? 'wheelpay' : 'wheel') : 'ramp', color: g.activities.iconColor(s), tag: s.tag,
        prio: bike ? PRIO.minor : PRIO.activity, x: s.x, z: s.z, pin: !!s.pin,
      }));
    }
    g.travel.stands.forEach((s, i) => out.push(base({ id: `taxi-${i}`, name: `Taxi: ${s.name}`, desc: 'E at the stand to fast travel. $50, free if you\'re broke. Refused while heat is above 0.', category: 'service', icon: 'taxi', color: '#d8b84a', prio: PRIO.minor, x: s.x, z: s.z })));
    for (const s of g.escapes.stations) out.push(base({ id: `metro-${s.name}`, name: `Metro: ${s.name}`, desc: 'Hack or vault the turnstiles. Riding drops your trail.', category: 'service', icon: 'metro', color: '#6a9fd8', prio: PRIO.minor, x: s.entrance.x, z: s.entrance.z }));
    return out;
  }
}
