// Persistent progress (saved at the safehouse and on sales/purchases).
export interface LootItem { id: string; name: string; value: number; }

export interface SaveData {
  cash: number;
  stash: LootItem[];
  outfits: string[];
  outfit: string;
  upgrades: { blackout: number; hackCost: number; regen: number; car: number };
  jobsDone: number;
  escapes: Record<string, number>; // escape method usage (adaptive police)
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
