// Game: owns every system, runs the update order and the state machine.
import * as THREE from 'three';
import { Input } from './input';
import { Rng, damp } from './math';
import { PAL } from './palette';
import { Collision, AABB } from '../world/collision';
import { City } from '../world/city';
import { Bank } from '../world/bank';
import { Signals } from '../world/signals';
import { Environment } from '../render/environment';
import { Post } from '../render/post';
import { Fx } from '../render/fx';
import { Player, Interactable } from '../player/player';
import { CameraRig } from '../player/camera';
import { Vehicle, collideVehicles, ImpactEvent } from '../vehicles/vehicle';
import { Skids } from '../vehicles/skids';
import { Traffic } from '../ai/traffic';
import { Police } from '../ai/police';
import { RouteMemory } from '../ai/routeMemory';
import { Pedestrians } from '../ai/pedestrians';
import { Guards } from '../ai/guards';
import { SecurityCameras, SecCam } from '../ai/cameras';
import { HackSystem } from '../hacking/hack';
import { Heist, Outcome } from '../heist/heist';
import { Hud } from '../ui/hud';
import { Audio } from '../audio/audio';
import { updateDebug } from '../debug/debug';
import { loadCharacterModels } from '../characters/loader';
import { blockCenter } from '../world/layout';

export type GameState = 'loading' | 'title' | 'playing' | 'paused' | 'results';

// rAF doesn't fire in background tabs; fall back to a timeout so loading never stalls.
const nextFrame = () => new Promise<void>((r) => { requestAnimationFrame(() => r()); setTimeout(r, 50); });

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1400);
  input: Input;
  hud = new Hud();
  audio = new Audio();
  col = new Collision();
  post!: Post;
  env!: Environment;
  city!: City;
  bank!: Bank;
  signals!: Signals;
  fx!: Fx;
  skids!: Skids;
  player!: Player;
  camRig!: CameraRig;
  traffic!: Traffic;
  police!: Police;
  routes!: RouteMemory;
  peds!: Pedestrians;
  guards!: Guards;
  cameras!: SecurityCameras;
  hack!: HackSystem;
  heist!: Heist;
  vehicles: Vehicle[] = [];
  parked: Vehicle[] = [];
  getawayCar: Vehicle | null = null;
  interactables: Interactable[] = [];
  garageDoorCol: AABB | null = null;
  state: GameState = 'loading';
  time = 0;
  timeScale = 1;
  private hitstopT = 0;
  private clock = new THREE.Clock();
  private frustum = new THREE.Frustum();
  private pv = new THREE.Matrix4();
  private impacts: ImpactEvent[] = [];
  private bustT = -1;
  private resultT = -1;
  private wasLocked = false;
  private rng = new Rng(555);
  clipMode = new URLSearchParams(location.search).has('clip');
  private fpsT = 0;
  private fpsN = 0;
  fps = 60;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.input = new Input(canvas);
    this.input.onLockChange = (locked) => {
      if (!locked && this.wasLocked && this.state === 'playing') this.pause();
      this.wasLocked = locked;
    };
    canvas.addEventListener('click', () => {
      if (this.state === 'playing') { this.audio.init(); this.input.lock(); }
    });
    addEventListener('resize', () => this.resize());
  }

  async init() {
    const H = this.hud;
    H.show('loading');
    const step = async (p: number, msg: string) => { H.loading(p, msg); await nextFrame(); };
    await step(0.05, 'painting textures');
    this.post = new Post(this.renderer);
    this.env = new Environment(this.scene);
    this.resize();
    await step(0.15, 'laying roads');
    this.city = new City(this.col).build();
    this.scene.add(this.city.group);
    await step(0.4, 'building the bank');
    this.bank = new Bank(this.col).build();
    this.scene.add(this.bank.group);
    const gd = this.city.garageDoor.position;
    this.garageDoorCol = this.col.add(gd.x - 0.3, 0, gd.z - 3.5, gd.x + 0.3, 4.6, gd.z + 3.5, true, 'door');
    await step(0.55, 'wiring signals');
    this.signals = new Signals(this.city, this.scene);
    this.fx = new Fx(this.scene, this.post.overlay);
    this.skids = new Skids(this.scene);
    this.routes = new RouteMemory(this.city.graph);
    await step(0.65, 'looking for character models');
    const found = await loadCharacterModels((m) => H.loading(0.7, m));
    if (found.length) console.info('[models] using', found.join(', '));
    await step(0.75, 'hiring extras');
    this.camRig = new CameraRig(this.camera);
    this.player = new Player(this);
    this.cameras = new SecurityCameras(this);
    this.cameras.build();
    this.traffic = new Traffic(this);
    this.police = new Police(this);
    this.peds = new Pedestrians(this);
    this.guards = new Guards(this);
    this.hack = new HackSystem(this);
    this.hack.build();
    this.heist = new Heist(this);
    await step(0.9, 'compiling shaders');
    this.reset(this.clipMode);
    this.renderer.compile(this.scene, this.camera);
    await step(1, 'ready');
    this.bindUi();
    if (this.clipMode) this.startPlaying();
    else { this.state = 'title'; H.show('title'); }
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private bindUi() {
    const S = this.hud.screens;
    S.title.querySelector('.start')!.addEventListener('click', () => this.startPlaying());
    S.pause.querySelector('.resume')!.addEventListener('click', () => this.resume());
    S.pause.querySelector('.restart')!.addEventListener('click', () => { this.reset(false); this.resume(); });
    S.pause.querySelector('.mute')!.addEventListener('click', () => this.hud.toast(this.audio.toggleMute() ? 'MUTED' : 'SOUND ON', 'dim'));
    S.pause.querySelector('.forget')!.addEventListener('click', () => { this.routes.clear(); this.hud.toast('ROUTE MEMORY CLEARED', 'dim'); });
    S.results.addEventListener('click', (e) => { if ((e.target as HTMLElement).classList.contains('restart')) this.restart(); });
  }

  private startPlaying() {
    this.audio.init();
    this.hud.show(null);
    this.state = 'playing';
    this.input.lock();
    if (!this.clipMode) this.hud.toast('CUT THE POWER. ROB THE CITY.', 'hack');
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.hud.show('pause');
  }

  resume() {
    this.state = 'playing';
    this.hud.show(null);
    this.audio.init();
    this.input.lock();
  }

  restart() {
    this.reset(false);
    this.hud.show(null);
    this.state = 'playing';
    this.input.lock();
  }

  resize() {
    const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post?.setSize(w, h);
  }

  // ------------------------------------------------------------------ world state
  reset(clip: boolean) {
    for (const v of [...this.vehicles]) this.removeVehicle(v);
    this.vehicles = [];
    this.parked = [];
    this.getawayCar = null;
    this.bustT = -1;
    this.resultT = -1;
    this.hitstopT = 0;
    this.timeScale = 1;
    this.routes.newRun();
    this.hack.reset();
    this.heist.reset(clip);
    this.police.reset();
    this.cameras.reset();
    this.post.damage = 0;

    // parked cars along curbs
    const spots = [...this.city.parking].sort(() => this.rng.next() - 0.5).slice(0, 22);
    for (const s of spots) {
      const v = new Vehicle(this.rng.chance(0.12) ? 'taxi' : 'sedan', this.rng.pick(PAL.carColors), this.col);
      v.place(s.x, s.z, s.heading);
      v.parked = true;
      v.handbrake = true;
      this.addVehicle(v);
      this.parked.push(v);
    }
    // the getaway car behind the bank
    const gs = this.bank.getawaySpot;
    const ga = new Vehicle('sedan', '#5b6433', this.col);
    ga.tune('getaway');
    ga.place(gs.x, gs.z, gs.heading);
    ga.handbrake = true;
    this.addVehicle(ga);
    this.getawayCar = ga;

    const st = this.bank.playerStart;
    this.player.spawn(st.x, st.z, st.heading);
    this.camRig.snapBehind(st.heading);
    this.camRig.pitch = -0.12;
    this.traffic.reset();
    this.peds.reset();
    this.guards.reset();

    if (clip) {
      // instant chase: mid-city, next to the getaway car, heat 3
      const c = blockCenter(3, 3);
      ga.place(c.x - 30, c.z + 4, 0);
      this.player.spawn(c.x - 32.9, c.z + 4, 0);
      this.camRig.snapBehind(0);
      this.police.minHeat = 1;
      this.police.setHeat(3, 'clip mode');
    }
  }

  addVehicle(v: Vehicle) {
    this.vehicles.push(v);
    this.scene.add(v.object);
  }

  removeVehicle(v: Vehicle) {
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
    if (this.player?.vehicle === v) this.player.exitVehicle(true);
    this.scene.remove(v.object);
  }

  spawnGetawayBeside() {
    const p = this.player;
    const base = p.vehicle ? p.vehicle.pos : p.pos;
    const heading = p.vehicle ? p.vehicle.heading : p.heading;
    let ga = this.getawayCar;
    if (!ga || ga.wrecked || ga === p.vehicle) {
      ga = new Vehicle('sedan', '#5b6433', this.col);
      ga.tune('getaway');
      this.addVehicle(ga);
      this.getawayCar = ga;
    }
    const rx = Math.cos(heading), rz = -Math.sin(heading);
    ga.place(base.x + rx * 3.2, base.z + rz * 3.2, heading);
    ga.hp = 100;
    ga.wrecked = false;
  }

  isVisible(x: number, y: number, z: number) {
    return this.frustum.containsPoint(new THREE.Vector3(x, y, z));
  }

  hitstop(s: number) {
    this.hitstopT = Math.max(this.hitstopT, s);
  }

  // ------------------------------------------------------------------ events
  onCarjack(v: Vehicle) {
    this.peds.ejectDriver(v.pos.clone());
    this.audio.door();
    if (v.isCop) this.police.crime(Math.max(2, this.police.heat), 'stole a cruiser');
    else if (this.police.units.some((u) => u.pos.distanceTo(v.pos) < 40)) this.police.crime(1, 'carjacking');
  }

  onEnterVehicle(v: Vehicle) {
    if (v.isCop) {
      const i = this.police.units.indexOf(v);
      if (i >= 0) this.police.units.splice(i, 1);
    }
  }

  onCameraSpotted(c: SecCam, dt: number) {
    if (c.bank) this.heist.spotted('camera', dt);
    if (this.police.heat > 0) this.police.report(this.player.worldPos);
  }

  onGuardSpotted(dt: number) {
    this.heist.spotted('guard', dt);
  }

  onPedHit(pos: THREE.Vector3) {
    if (this.police.units.some((u) => u.pos.distanceTo(pos) < 45)) this.police.crime(1, 'hit-and-run');
  }

  onBusted() {
    if (this.player.busted || this.heist.outcome) return;
    this.player.busted = true;
    this.player.exitVehicle(true);
    this.player.busted = true;
    this.audio.busted();
    this.hud.toast('BUSTED', 'heat');
    this.bustT = 0;
  }

  onOutcome(o: Outcome) {
    if (o === 'won') {
      this.audio.win();
      this.hud.toast('CLEAN GETAWAY', 'win');
      this.police.setHeat(0);
    }
    this.resultT = 0;
  }

  // ------------------------------------------------------------------ loop
  private frame() {
    const realDt = Math.min(this.clock.getDelta(), 0.05);
    this.fpsT += realDt;
    this.fpsN++;
    if (this.fpsT > 1) { this.fps = this.fpsN / this.fpsT; this.fpsT = 0; this.fpsN = 0; }
    const inp = this.input;

    // global keys
    if (inp.pressed('KeyH')) this.hud.setVisible(!this.hud.visible);
    if (inp.pressed('F2')) this.hud.setPhoto(!this.hud.photo);
    if (inp.pressed('KeyM')) this.hud.toast(this.audio.toggleMute() ? 'MUTED' : 'SOUND ON', 'dim');
    if (inp.pressed('KeyR') && (this.state === 'results' || this.state === 'playing' || this.state === 'paused')) this.restart();
    if (inp.pressed('Escape') && this.state === 'paused') this.resume();
    else if (inp.pressed('KeyP') && this.state === 'playing') { this.input.unlock(); this.pause(); }

    if (this.hud.root.dataset.state !== this.state) this.hud.root.dataset.state = this.state;
    if (this.state === 'playing') this.update(realDt);
    else if (this.state === 'title') {
      // slow orbit behind the title
      this.time += realDt;
      const a = this.time * 0.05;
      this.camera.position.set(-84 + Math.cos(a) * 46, 18, -20 + Math.sin(a) * 46);
      this.camera.lookAt(-84, 4, -24);
      this.signals.update(realDt);
      this.traffic.update(realDt);
      for (const v of this.vehicles) v.update(realDt, this.impacts);
      collideVehicles(this.vehicles, this.impacts);
      this.impacts.length = 0;
      this.peds.update(realDt);
      this.env.follow(new THREE.Vector3(-84, 0, -20), this.time);
    } else if (this.state === 'results') {
      // slow orbit around the scene of the crime
      this.time += realDt * 0.3;
      const P = this.player.worldPos;
      const a = this.time * 0.4;
      this.camera.position.set(P.x + Math.cos(a) * 11, P.y + 5, P.z + Math.sin(a) * 11);
      this.camera.lookAt(P.x, P.y + 1, P.z);
      this.fx.update(realDt * 0.3);
    }
    this.post.render(this.scene, this.camera, realDt, this.time);
    inp.endFrame();
  }

  private update(realDt: number) {
    const inp = this.input;
    updateDebug(this);

    // time: hacker slow-mo + hitstop
    this.timeScale = damp(this.timeScale, this.hack.active ? 0.35 : 1, 12, realDt);
    let dt = realDt * this.timeScale;
    if (this.hitstopT > 0) { this.hitstopT -= realDt; dt *= 0.08; }
    this.time += dt;

    this.camera.updateMatrixWorld();
    this.pv.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);

    this.player.update(dt);
    this.traffic.update(dt);
    this.police.update(dt);
    for (const v of this.vehicles) {
      if (v.driver === 'none') { v.throttle = 0; v.steer = 0; v.handbrake = true; }
      v.update(dt, this.impacts);
    }
    collideVehicles(this.vehicles, this.impacts);
    this.handleImpacts();
    this.skids.update(this.vehicles);
    this.signals.update(dt);
    this.cameras.update(dt);
    this.guards.update(dt);
    this.peds.update(dt);
    this.hack.update(realDt, dt);
    this.heist.update(dt);
    this.bank.update(dt, this.time, this.heist.alarm);

    const pv = this.player.vehicle;
    if (pv) this.routes.record(pv.pos.x, pv.pos.z, pv.speedAbs * dt, dt);
    // damaged cars smoke, wrecks burn
    for (const v of this.vehicles) {
      if (v.hp < 40 && Math.random() < (v.wrecked ? 0.5 : 0.2) * dt * 60 * 0.3) {
        const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
        const p = new THREE.Vector3(v.pos.x + fx * 1.6, v.pos.y + 1.1, v.pos.z + fz * 1.6);
        this.fx.spawn(v.wrecked && Math.random() < 0.5 ? 'fire' : 'smoke', p, 1);
      }
    }
    this.fx.update(dt);

    // busted sequence
    if (this.bustT >= 0) {
      this.bustT += realDt;
      if (this.bustT > 2.2) { this.bustT = -1; this.heist.finish('busted'); }
    }
    if (this.resultT >= 0) {
      this.resultT += realDt;
      if (this.resultT > 1.6) {
        this.resultT = -1;
        this.state = 'results';
        this.hud.results(this);
        this.input.unlock();
      }
    }

    this.camRig.update(realDt, this);
    this.env.follow(this.player.worldPos, this.time);
    this.audio.listener.copy(this.player.worldPos);
    this.audio.update(realDt, { car: pv, sirenDist: this.police.nearestSiren(this.player.worldPos), hack: this.hack.active, time: this.time });
    this.post.damage = damp(this.post.damage, pv ? Math.max(0, (40 - pv.hp) / 40) * 0.6 : 0, 3, realDt) + this.police.bust * 0.5 * (1 - this.post.damage);
    this.hud.update(realDt, this);
    void inp;
  }

  private handleImpacts() {
    const pv = this.player.vehicle;
    for (const e of this.impacts) {
      e.v.lastImpact = Math.max(e.v.lastImpact, e.impact);
      if (e.other) e.other.lastImpact = Math.max(e.other.lastImpact, e.impact);
      const p = new THREE.Vector3(e.x, e.y, e.z);
      const big = e.impact > 9;
      this.fx.spawn('spark', p, big ? 16 : 6, undefined, Math.min(1.5, e.impact / 10));
      if (big) { this.fx.spawn('debris', p, 8, new THREE.Vector3(e.nx, 0, e.nz), 0.6); this.fx.spawn('glass', p, 6); }
      this.audio.crash(e.impact, p);
      const involvesPlayer = e.v === pv || e.other === pv;
      if (involvesPlayer) {
        this.camRig.addShake(Math.min(0.7, e.impact / 22));
        if (big) { this.post.triggerFlash('#ffffff', 0.12); this.hitstop(0.04); }
        const other = e.v === pv ? e.other : e.v;
        if (other && other.isCop && other.driver === 'cop' && e.impact > 5) this.police.crime(Math.max(1, this.police.heat), 'rammed police');
      }
    }
    this.impacts.length = 0;
  }
}
