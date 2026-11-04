// Side jobs from the fixer's phone (J = open/cycle, Enter = accept, X = abandon):
// ATM network hack, courier drop, data theft, armored truck intercept, plant evidence.
import * as THREE from 'three';
import { Rng } from '../core/math';
import { Vehicle } from '../vehicles/vehicle';
import { lanePoint, LANE } from '../world/layout';
import { edgePoints } from '../ai/traffic';
import type { Game } from '../core/game';
import type { Hackable } from '../hacking/hack';
import type { Interactable } from '../player/player';

type JobId = 'atm' | 'courier' | 'data' | 'armored' | 'evidence';

interface JobDef { id: JobId; title: string; brief: string; pay: number; time: number; }

const DEFS: JobDef[] = [
  { id: 'atm', title: 'ATM network', brief: 'Hack 3 marked ATMs before the bank patches them.', pay: 1500, time: 150 },
  { id: 'courier', title: 'Courier drop', brief: 'Grab the parcel and deliver it across town. No questions.', pay: 800, time: 95 },
  { id: 'data', title: 'Data theft', brief: 'Copy the core server in Vantage Tower and bring the drive home.', pay: 1000, time: 300 },
  { id: 'armored', title: 'Armored truck', brief: 'Stop the armored truck (red lights, ramming) and hack its rear lock.', pay: 5000, time: 180 },
  { id: 'evidence', title: 'Plant evidence', brief: 'Slip a package into a rival\'s SUV without a camera seeing you.', pay: 1000, time: 120 },
];

export class Jobs {
  offer = 0;
  phoneOpen = false;
  active: (JobDef & { t: number; step: number; targets: THREE.Vector3[]; done: boolean[] }) | null = null;
  private hacks: Hackable[] = [];
  private inters: Interactable[] = [];
  private truck: Vehicle | null = null;
  private rng = new Rng(4040);
  private markers: THREE.Mesh[] = [];
  completed = 0;

  constructor(private g: Game) {}

  get offers() { return DEFS; }

  reset() {
    this.abandon(true);
    this.phoneOpen = false;
  }

  /** J opens the phone; J again cycles; Enter accepts; X abandons */
  input() {
    const inp = this.g.input;
    if (this.g.missions.run || this.g.missions.card) return;
    if (inp.pressed('phone')) {
      if (!this.phoneOpen) { this.phoneOpen = true; this.g.audio.ring(); }
      else this.offer = (this.offer + 1) % DEFS.length;
    }
    if (this.phoneOpen && inp.pressed('confirm')) { this.start(DEFS[this.offer]); this.phoneOpen = false; }
    if (this.phoneOpen && inp.pressed('escape', 'back')) this.phoneOpen = false;
    if (inp.pressed('abandon') && this.active) { this.g.hud.toast('JOB ABANDONED', 'dim'); this.abandon(); }
  }

  private start(def: JobDef) {
    const g = this.g;
    this.abandon(true);
    const targets: THREE.Vector3[] = [];
    switch (def.id) {
      case 'atm': {
        const atms = [...g.street.atms].sort(() => this.rng.next() - 0.5).slice(0, 3);
        atms.forEach((a, i) => {
          targets.push(new THREE.Vector3(a.x, 1.3, a.z));
          this.addHack({
            kind: 'atm', label: 'Marked ATM', pos: targets[i], size: new THREE.Vector3(1, 1.9, 1), range: 30,
            available: () => !!this.active && !this.active.done[i],
            act: () => { this.active!.done[i] = true; g.fx.spawn('money', targets[i], 12); g.audio.cash(); const n = this.active!.done.filter(Boolean).length; this.check(); return `ATM ${n}/3 DRAINED`; },
          });
        });
        break;
      }
      case 'courier': {
        const doors = [...g.city.doors].sort(() => this.rng.next() - 0.5);
        const P = g.player.worldPos;
        const a = doors.find((d) => Math.hypot(d.x - P.x, d.z - P.z) < 120 && Math.hypot(d.x - P.x, d.z - P.z) > 30) ?? doors[0];
        const b = doors.find((d) => Math.hypot(d.x - a.x, d.z - a.z) > 150) ?? doors[1];
        targets.push(new THREE.Vector3(a.x, 0.15, a.z), new THREE.Vector3(b.x, 0.15, b.z));
        this.addInter({ pos: targets[0], radius: 2.2, label: 'Pick up the parcel', enabled: () => this.active?.step === 0, action: () => { this.active!.step = 1; this.active!.done[0] = true; g.hud.toast('PARCEL ACQUIRED — DELIVER IT', 'hack'); } });
        this.addInter({ pos: targets[1], radius: 2.4, label: 'Deliver the parcel', enabled: () => this.active?.step === 1, action: () => { this.active!.done[1] = true; this.check(); } });
        break;
      }
      case 'data': {
        targets.push(new THREE.Vector3(28, 1, 13), new THREE.Vector3(-28, 0.15, 46));
        break;
      }
      case 'armored': {
        const e = this.rng.pick(g.city.graph.edges.filter((x) => Math.hypot((g.city.graph.nodes[x.a].x + g.city.graph.nodes[x.b].x) / 2 - g.player.worldPos.x, (g.city.graph.nodes[x.a].z + g.city.graph.nodes[x.b].z) / 2 - g.player.worldPos.z) > 70));
        const A = g.city.graph.nodes[e.a], B = g.city.graph.nodes[e.b];
        const p = lanePoint(A.x, A.z, B.x, B.z, 0.4, LANE);
        const v = new Vehicle('van', '#3a3e44', g.col);
        v.p.maxSpeed = 18;
        v.hp = 160;
        v.driver = 'traffic';
        v.ai = { a: e.a, b: e.b, c: g.city.graph.other(g.city.graph.edges[g.city.graph.nodes[e.b].edges[0]], e.b), phase: 'edge', pts: edgePoints(g, e.a, e.b), idx: 4, cruise: 9, crashedT: 0, stuckT: 0, honkT: 0, blockedT: 0, lane: LANE, laneCD: 0, stopT: 0, stopCD: 0, emergency: false, panicT: 0 };
        v.place(p.x, p.z, Math.atan2(B.x - A.x, B.z - A.z));
        g.addVehicle(v);
        g.traffic.cars.push(v);
        this.truck = v;
        targets.push(v.pos);
        this.addHack({
          kind: 'truck', label: 'Armored truck lock', pos: v.pos, size: new THREE.Vector3(2.4, 2.5, 5.2), range: 16,
          available: () => !!this.active && !this.active.done[0] && v.speedAbs < 1.5,
          act: () => {
            this.active!.done[0] = true;
            g.loot.add({ id: 'armored', name: 'Cash crates', value: 5000 });
            g.fx.spawn('money', v.pos.clone().setY(1.5), 30);
            g.police.crime(2, 'armored truck hit');
            g.news.report('witness', v.pos.x, v.pos.z);
            this.check();
            return 'ARMORED TRUCK CRACKED';
          },
        });
        break;
      }
      case 'evidence': {
        const spots = g.city.parking.filter((s) => Math.hypot(s.x - g.player.worldPos.x, s.z - g.player.worldPos.z) > 50);
        const s = this.rng.pick(spots);
        const v = new Vehicle('suv', '#1c1c1e', g.col);
        v.place(s.x, s.z, s.heading);
        v.locked = true;
        v.handbrake = true;
        g.addVehicle(v);
        this.truck = v;
        targets.push(v.pos);
        this.addInter({
          pos: v.pos, radius: 3.2, label: 'Plant evidence', enabled: () => !!this.active && !this.active.done[0],
          action: () => {
            const seen = g.cameras.cams.some((c) => c.seeing);
            if (seen) { g.hud.toast('A CAMERA SAW YOU — JOB BLOWN', 'heat'); this.fail(); return; }
            this.active!.done[0] = true;
            this.check();
          },
        });
        break;
      }
    }
    this.active = { ...def, t: def.time, step: 0, targets, done: targets.map(() => false) };
    if (def.id === 'data' || def.id === 'armored' || def.id === 'evidence') this.active.done = def.id === 'data' ? [false, false] : [false];
    for (const t of targets) this.marker(t);
    g.hud.toast(`JOB: ${def.title.toUpperCase()}`, 'hack');
    g.hud.hint(def.brief);
  }

  private marker(p: THREE.Vector3) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 40, 6, 1, true), new THREE.MeshBasicMaterial({ color: '#ffb000', transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.position.set(p.x, 20, p.z);
    m.userData.follow = p;
    this.g.scene.add(m);
    this.markers.push(m);
  }

  private addHack(h: Hackable) { this.hacks.push(h); this.g.hack.hackables.push(h); }
  private addInter(i: Interactable) { this.inters.push(i); this.g.interactables.push(i); }

  /** events from elsewhere in the game */
  onEvent(kind: 'data' | 'loot' | 'stash') {
    const a = this.active;
    if (!a) return;
    if (a.id === 'data' && kind === 'data') { a.done[0] = true; a.step = 1; this.g.hud.toast('DRIVE COPIED — TAKE IT TO THE SAFEHOUSE', 'hack'); }
  }

  private check() {
    const a = this.active;
    if (!a) return;
    if (a.done.every(Boolean)) {
      const g = this.g;
      g.loot.addCash(a.pay);
      g.save.data.jobsDone++;
      this.completed++;
      g.audio.win();
      g.hud.toast(`JOB DONE: ${a.title.toUpperCase()} +$${a.pay.toLocaleString()}`, 'win');
      this.abandon(true);
    }
  }

  private fail() {
    this.g.hud.toast('JOB FAILED', 'heat');
    this.abandon(true);
  }

  abandon(silent = false) {
    const g = this.g;
    g.hack.hackables = g.hack.hackables.filter((h) => !this.hacks.includes(h));
    for (const i of this.inters) { const k = g.interactables.indexOf(i); if (k >= 0) g.interactables.splice(k, 1); }
    for (const m of this.markers) g.scene.remove(m);
    this.hacks = [];
    this.inters = [];
    this.markers = [];
    if (this.truck && this.active?.id === 'evidence') g.removeVehicle(this.truck);
    this.truck = null;
    this.active = null;
    void silent;
  }

  /** where the HUD marker should point (first unfinished target) */
  target(): THREE.Vector3 | null {
    const a = this.active;
    if (!a) return null;
    if (a.id === 'courier') return a.targets[a.step];
    if (a.id === 'data') return a.done[0] ? a.targets[1] : a.targets[0];
    const i = a.done.findIndex((d) => !d);
    return i >= 0 ? a.targets[i] : null;
  }

  update(dt: number) {
    this.input();
    const a = this.active;
    for (const m of this.markers) { const f = m.userData.follow as THREE.Vector3; m.position.x = f.x; m.position.z = f.z; m.visible = !!a; }
    if (!a) return;
    a.t -= dt;
    if (a.t <= 0) { this.fail(); return; }
    // data job finishes when you walk through your front door with the drive
    if (a.id === 'data' && a.done[0] && this.g.buildings.siteAt(this.g.player.pos.x, this.g.player.pos.z)?.id === 'home') { a.done[1] = true; this.check(); }
    // armored truck stops when it's damaged enough
    if (a.id === 'armored' && this.truck && this.truck.hp < 110) { this.truck.throttle = 0; this.truck.handbrake = true; (this.truck.ai as { crashedT: number }).crashedT = 0.01; }
  }
}
