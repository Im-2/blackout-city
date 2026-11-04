// Mission runner: markers in the world, intro card, steps + checkpoints, timers,
// success and fail screens, retries, rewards.
import * as THREE from 'three';
import { basicMat } from '../render/patch';
import { Vehicle } from '../vehicles/vehicle';
import { MISSIONS } from './data';
import { MissionCtx, MissionDef, MissionStep, TYPE_INFO } from './types';
import { DISTRICTS } from '../map/districts';
import type { Game } from '../core/game';

export type MissionStatus = 'open' | 'locked' | 'done';

interface Run {
  def: MissionDef;
  step: number;
  /** last step with a checkpoint reached this attempt, and the clock at that moment */
  checkpoint: number;
  cpTime: number;
  cpElapsed: number;
  timeLeft: number;
  startedAt: number;
  ctx: MissionCtx;
  spawned: Vehicle[];
}

interface Beam { group: THREE.Group; mat: THREE.MeshBasicMaterial; ringMat: THREE.MeshBasicMaterial; }

const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).translate(0, 0.5, 0);
const ringGeo = new THREE.RingGeometry(0.82, 1, 24).rotateX(-Math.PI / 2);

function makeBeam(scene: THREE.Scene, r: number, h: number): Beam {
  const mat = basicMat({ transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const ringMat = basicMat({ transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const group = new THREE.Group();
  const c = new THREE.Mesh(beamGeo, mat);
  c.scale.set(r, h, r);
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.scale.set(r, 1, r);
  ring.position.y = 0.2;
  group.add(c, ring);
  group.visible = false;
  scene.add(group);
  return { group, mat, ringMat };
}

export class Missions {
  defs = MISSIONS;
  run: Run | null = null;
  /** mission waiting on the intro card */
  card: MissionDef | null = null;
  /** set while the end screen is coming up or showing */
  ended: null | { kind: 'success' | 'fail'; reason?: string; def: MissionDef; rows: [string, string][] } = null;
  private endT = -1;
  private markerBeams = new Map<string, Beam>();
  private cpBeam: Beam;
  private cooldown = new Set<string>();
  private heatHintT = 0;
  private lastHomeMarker: MissionDef | null = null;
  private t = 0;

  constructor(private g: Game) {
    for (const d of this.defs) this.markerBeams.set(d.id, makeBeam(g.scene, 2.4, 26));
    this.cpBeam = makeBeam(g.scene, 2.6, 60);
    this.cpBeam.mat.color.set('#ffd24a');
    this.cpBeam.ringMat.color.set('#ffd24a');
  }

  // ------------------------------------------------------------------ status
  status(d: MissionDef): MissionStatus {
    const s = this.g.save.data;
    if (s.completed[d.id] && !d.replay) return 'done';
    const u = d.unlock;
    if (u) {
      if (s.unlockAll) return 'open';
      if (u.missions?.some((m) => !s.completed[m])) return 'locked';
      if (u.cash !== undefined && s.cash < u.cash) return 'locked';
      if (u.reputation !== undefined && s.rep.overall < u.reputation) return 'locked';
    }
    return 'open';
  }

  private text(v: unknown, ctx: MissionCtx): string {
    return typeof v === 'function' ? (v as (c: MissionCtx) => string)(ctx) : ((v as string) ?? '');
  }

  // ------------------------------------------------------------------ HUD accessors
  get step(): MissionStep | null {
    return this.run ? this.run.def.steps[this.run.step] : null;
  }
  get panelTitle() { return this.run ? `${TYPE_INFO[this.run.def.type].label}: ${this.run.def.title}` : 'FREE ROAM'; }
  get objective() { return this.run && this.step ? this.text(this.step.text, this.run.ctx) : this.g.jobs.active ? this.g.jobs.active.title : 'Walk or drive into a marker'; }
  get sub() { return this.run && this.step ? this.text(this.step.sub, this.run.ctx) : this.g.jobs.active ? this.g.jobs.active.brief : '[M] full map'; }
  get timeLeft() { return this.run && this.run.def.timeLimit ? this.run.timeLeft : null; }
  target(): THREE.Vector3 | null {
    if (!this.run || !this.step?.target) return null;
    return this.step.target(this.run.ctx);
  }

  // ------------------------------------------------------------------ flow
  /** the world was reset under us: forget the attempt */
  onWorldReset() {
    if (this.run) this.runCleanup();
    this.run = null;
    this.card = null;
    this.ended = null;
    this.endT = -1;
    this.cooldown.clear();
    this.lastHomeMarker = null;
  }

  private runCleanup() {
    const r = this.run!;
    r.def.cleanup?.(r.ctx);
    for (const v of r.spawned) if (v.driver === 'none' && this.g.vehicles.includes(v)) this.g.removeVehicle(v);
  }

  private makeRun(def: MissionDef): Run {
    const spawned: Vehicle[] = [];
    const g = this.g;
    return {
      def, step: 0, checkpoint: 0, cpTime: def.timeLimit ?? 0, cpElapsed: 0, timeLeft: def.timeLimit ?? 0, startedAt: g.time, spawned,
      ctx: {
        g, vars: {},
        spawnVehicle: (kind, x, z, heading, color = '#9b3b2f') => {
          const v = new Vehicle(kind, color, g.col);
          v.place(x, z, heading);
          v.handbrake = true;
          g.addVehicle(v);
          spawned.push(v);
          return v;
        },
      },
    };
  }

  /** Begin (or resume at `stepIndex`) in the current world. */
  start(def: MissionDef, stepIndex = 0, timeLeft?: number, elapsed = 0) {
    const g = this.g;
    g.jobs.abandon(true);
    g.gps.clearWaypoint();
    this.card = null;
    this.ended = null;
    this.endT = -1;
    const r = this.makeRun(def);
    this.run = r;
    def.setup?.(r.ctx);
    r.step = stepIndex;
    r.checkpoint = stepIndex;
    if (timeLeft !== undefined) r.timeLeft = timeLeft;
    r.cpTime = r.timeLeft;
    r.startedAt = g.time - elapsed; // best times count the whole run, retries included
    r.cpElapsed = elapsed;
    if (stepIndex > 0) def.steps[stepIndex].checkpoint?.restore(r.ctx);
    this.enterStep(true);
    g.audio.missionStart();
    this.heatHintT = 0;
  }

  private enterStep(silent = false) {
    const r = this.run!;
    const s = r.def.steps[r.step];
    if (s.checkpoint && !silent) {
      r.checkpoint = r.step;
      r.cpTime = r.timeLeft;
      r.cpElapsed = this.g.time - r.startedAt;
      this.g.hud.toast('CHECKPOINT', 'cool');
    }
    if (!silent) this.g.audio.checkpoint();
    s.enter?.(r.ctx);
  }

  private advance() {
    const r = this.run!;
    if (r.step + 1 >= r.def.steps.length) { this.complete(); return; }
    r.step++;
    this.enterStep();
  }

  /** the current mission's goal has been met */
  complete() {
    const r = this.run;
    if (!r || this.ended) return;
    const g = this.g;
    const def = r.def;
    const cash = typeof def.reward.cash === 'function' ? def.reward.cash(r.ctx) : def.reward.cash;
    const time = g.time - r.startedAt;
    const s = g.save.data;
    const prev = s.completed[def.id];
    const best = prev ? Math.min(prev.best, time) : time;
    s.completed[def.id] = { n: (prev?.n ?? 0) + 1, best };
    s.cash += cash;
    s.rep.overall += def.reward.reputation;
    s.rep.districts[def.district] = (s.rep.districts[def.district] ?? 0) + def.reward.reputation;
    g.save.write();
    const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    this.ended = {
      kind: 'success', def,
      rows: [
        ['TIME', fmt(time)],
        [def.reward.label?.toUpperCase() ?? 'PAY', `$${cash.toLocaleString()}`],
        ['REPUTATION', `+${def.reward.reputation} ${DISTRICTS[def.district].name}`],
        ...(def.summary?.(r.ctx) ?? []),
        ['BEST TIME', fmt(best)],
      ],
    };
    g.audio.win();
    this.endT = 1.4;
  }

  fail(reason: string) {
    const r = this.run;
    if (!r || this.ended) return;
    this.ended = { kind: 'fail', reason, def: r.def, rows: [] };
    this.g.audio.fail();
    this.endT = 1.4;
  }

  /** Back to a clean world, resuming from the last checkpoint or the very start. */
  retry(fromCheckpoint: boolean) {
    const r = this.run ?? null;
    const def = this.ended?.def ?? r?.def;
    if (!def) return;
    const step = fromCheckpoint && r ? r.checkpoint : 0;
    const time = fromCheckpoint && r ? r.cpTime : undefined;
    const elapsed = fromCheckpoint && r ? r.cpElapsed : 0;
    const g = this.g;
    g.reset(false);
    const m = def.marker;
    g.player.spawn(m.x, m.z, m.heading ?? 0);
    g.camRig.snapBehind(m.heading ?? 0);
    this.cooldown.add(def.id);
    this.start(def, step, time, elapsed);
    g.chunks.update();
    g.camRig.snapBehind(g.player.heading);
    g.play();
  }

  /** clip tools + ?clip: jump straight to a step of a mission in a fresh world */
  startAt(id: string, stepId: string) {
    const def = this.defs.find((d) => d.id === id);
    if (!def) return;
    this.start(def, Math.max(0, def.steps.findIndex((s) => s.id === stepId)));
  }

  /** Drop the attempt and go back to free roam at the marker. */
  quit() {
    const def = this.ended?.def ?? this.run?.def;
    const g = this.g;
    g.reset(false);
    if (def) {
      g.player.spawn(def.marker.x, def.marker.z, def.marker.heading ?? 0);
      g.camRig.snapBehind(def.marker.heading ?? 0);
      this.cooldown.add(def.id);
      g.chunks.update();
    }
    g.play();
  }

  /** Success screen dismissed: straight back to free roam, right where you are. */
  private continueFreeRoam() {
    const g = this.g;
    this.runCleanup();
    this.run = null;
    this.ended = null;
    g.play();
  }

  /** end-screen buttons (click or key) */
  action(a: string) {
    if (a === 'continue') this.continueFreeRoam();
    else if (a === 'checkpoint') this.retry(true);
    else if (a === 'mission') this.retry(false);
    else if (a === 'quit') this.quit();
  }

  /** runs while the end screen is up */
  updateResults() {
    const inp = this.g.input;
    if (!this.ended) return;
    if (this.ended.kind === 'success') {
      if (inp.pressed('Enter', 'KeyE', 'Space')) this.action('continue');
    } else {
      if (inp.pressed('Enter', 'KeyC')) this.action('checkpoint');
      else if (inp.pressed('KeyR')) this.action('mission');
      else if (inp.pressed('KeyX', 'Backspace')) this.action('quit');
    }
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number) {
    const g = this.g;
    this.t += dt;
    this.heatHintT -= dt;
    if (this.card) this.updateCard();
    else if (!this.run) this.checkMarkers();
    this.drawMarkers();

    if (this.endT >= 0) {
      this.endT -= dt;
      if (this.endT < 0) {
        g.state = 'results';
        g.hud.missionEnd(this);
        g.input.unlock();
      }
      return;
    }
    const r = this.run;
    if (!r || this.ended) return;
    if (r.def.timeLimit) {
      r.timeLeft -= dt;
      if (r.timeLeft <= 0) { r.timeLeft = 0; this.fail('Out of time'); return; }
    }
    const P = g.player.worldPos;
    const v = g.player.vehicle;
    if (r.def.failOnWreck && v && v.wrecked && g.police.heat > 0) { this.fail('You wrecked your ride with the cops on you'); return; }
    const reason = r.def.failIf?.(r.ctx);
    if (reason) { this.fail(reason); return; }
    const s = r.def.steps[r.step];
    const t = s.target?.(r.ctx);
    if (s.done?.(r.ctx)) { this.advance(); return; }
    if (s.reach && t && Math.hypot(t.x - P.x, t.z - P.z) < s.reach && Math.abs(t.y - P.y) < 6) this.advance();
  }

  private checkMarkers() {
    const g = this.g;
    const P = g.player.worldPos;
    const radius = g.player.vehicle ? 5.5 : 2.8;
    for (const d of this.defs) {
      const dist = Math.hypot(d.marker.x - P.x, d.marker.z - P.z);
      if (this.cooldown.has(d.id)) {
        if (dist > 9) this.cooldown.delete(d.id);
        continue;
      }
      if (dist > radius || Math.abs(P.y) > 3) continue;
      const st = this.status(d);
      if (st === 'locked') {
        if (this.heatHintT <= 0) { g.hud.hint(`LOCKED: ${d.unlock?.hint}`); g.audio.deny(); this.heatHintT = 5; }
        this.cooldown.add(d.id);
        continue;
      }
      if (st === 'done') continue;
      if (g.police.heat > 0) {
        // never dump a chase into a mission: lose the heat first
        if (this.heatHintT <= 0) { g.hud.hint('Too hot to take a job. Lose the cops first'); this.heatHintT = 5; }
        continue;
      }
      this.card = d;
      g.hud.missionCard(d);
      g.audio.ring();
      return;
    }
  }

  private updateCard() {
    const g = this.g;
    const d = this.card!;
    const inp = g.input;
    if (inp.pressed('Enter', 'KeyE')) {
      g.hud.missionCard(null);
      this.start(d);
    } else if (inp.pressed('Backspace', 'KeyX')) {
      this.card = null;
      g.hud.missionCard(null);
      this.cooldown.add(d.id);
    }
  }

  private drawMarkers() {
    const g = this.g;
    const P = g.player.worldPos;
    const view = g.quality.p.view;
    for (const d of this.defs) {
      const b = this.markerBeams.get(d.id)!;
      const st = this.status(d);
      const show = !this.run && st !== 'done' && Math.hypot(d.marker.x - P.x, d.marker.z - P.z) < view;
      b.group.visible = show;
      if (!show) continue;
      const col = st === 'locked' ? '#6a6f78' : TYPE_INFO[d.type].color;
      b.group.position.set(d.marker.x, 0.1, d.marker.z);
      b.mat.color.set(col);
      b.ringMat.color.set(col);
      b.mat.opacity = st === 'locked' ? 0.08 : 0.16 + Math.sin(this.t * 3) * 0.05;
      b.ringMat.opacity = st === 'locked' ? 0.3 : 0.8;
    }
    const t = this.target();
    const cp = this.cpBeam;
    cp.group.visible = !!t && !this.ended;
    if (t) {
      cp.group.position.set(t.x, Math.min(t.y - 1, 1), t.z);
      cp.mat.opacity = 0.16 + Math.sin(this.t * 4) * 0.05;
    }
  }
}
