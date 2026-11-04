// Persistent progress: missions, cash, reputation, vehicles, upgrades. Every
// localStorage touch is guarded, so private windows just lose it on reload.
export interface LootItem { id: string; name: string; value: number; }

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
  ownedVehicles: string[];
  /** clip tool: every mission open */
  unlockAll: boolean;
}

const KEY = 'blackoutcity.save.v1';

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
  unlockAll: false,
});

export class Save {
  data: SaveData = fresh();

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = { ...fresh(), ...JSON.parse(raw) };
    } catch { /* storage blocked: progress lasts for the session */ }
  }

  write() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ }
  }

  get hasProgress() {
    return this.data.cash > 0 || Object.keys(this.data.completed).length > 0;
  }

  wipe() {
    this.data = fresh();
    this.write();
  }

  /** count an escape method (subway/garage/rooftop/sewer/hide) for adaptive police */
  escape(kind: string) {
    this.data.escapes[kind] = (this.data.escapes[kind] ?? 0) + 1;
    this.write();
  }
}
