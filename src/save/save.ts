// Progress: missions, cash, reputation, vehicles, upgrades. Lives in memory until
// the player sleeps at home, which is the only thing that commits it (New Game
// wipes it too). Every localStorage touch is guarded, so private windows just lose
// it on reload.
export interface LootItem { id: string; name: string; value: number; }
export interface OwnedVehicle { kind: string; color: string; label: string; }

export interface SaveData {
  cash: number;
  stash: LootItem[];
  outfits: string[];
  outfit: string;
  upgrades: { blackout: number; hackCost: number; regen: number; car: number };
  jobsDone: number;
  escapes: Record<string, number>; // escape method usage (adaptive police)
  completed: Record<string, { n: number; best: number }>;
  rep: { overall: number; districts: Record<string, number> };
  /** every vehicle ever parked at home */
  ownedVehicles: OwnedVehicle[];
  /** what's in the garage bay */
  garage: OwnedVehicle | null;
  /** lifetime cash, for the trophy shelf */
  earned: number;
  hour: number;
  /** activity spots whose intro card you've seen */
  seen: Record<string, boolean>;
  /** what the police have on you, for the news */
  crimes: Record<string, number>;
  /** shopkeepers you've locked in, and how many times */
  grudges: Record<string, number>;
  /** rare cars parked at home, spotted, and set rewards paid */
  rare: Record<string, boolean>;
  rareSeen: Record<string, boolean>;
  rareSets: Record<string, boolean>;
  /** clip tool: every mission open */
  unlockAll: boolean;
}

const KEY = 'blackoutcity.save.v1';
/** intro cards you've read: kept apart so they never come back, even without sleeping */
const SEEN_KEY = 'blackoutcity.seen.v1';

const fresh = (): SaveData => ({
  cash: 0,
  stash: [],
  outfits: ['clerk', 'hoodie'],
  outfit: 'clerk',
  upgrades: { blackout: 0, hackCost: 0, regen: 0, car: 0 },
  jobsDone: 0,
  escapes: {},
  completed: {},
  rep: { overall: 0, districts: {} },
  ownedVehicles: [],
  garage: null,
  earned: 0,
  hour: 17.6,
  seen: {},
  crimes: {},
  grudges: {},
  rare: {},
  rareSeen: {},
  rareSets: {},
  unlockAll: false,
});

export class Save {
  data: SaveData = fresh();

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = { ...fresh(), ...JSON.parse(raw) };
      const seen = localStorage.getItem(SEEN_KEY);
      if (seen) Object.assign(this.data.seen, JSON.parse(seen));
    } catch { /* storage blocked: progress lasts for the session */ }
  }

  commit() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ }
  }

  markSeen(id: string) {
    this.data.seen[id] = true;
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(this.data.seen)); } catch { /* ignore */ }
  }

  get hasProgress() {
    return this.data.cash > 0 || Object.keys(this.data.completed).length > 0;
  }

  wipe() {
    this.data = fresh();
    this.commit();
    try { localStorage.removeItem(SEEN_KEY); } catch { /* ignore */ }
  }

  /** count an escape method (subway/garage/rooftop/sewer/hide) for adaptive police */
  escape(kind: string) {
    this.data.escapes[kind] = (this.data.escapes[kind] ?? 0) + 1;
  }
}
