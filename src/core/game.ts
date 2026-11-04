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
import { Traffic, pickKind, colorFor } from '../ai/traffic';
import { Police } from '../ai/police';
import { RouteMemory } from '../ai/routeMemory';
import { Pedestrians } from '../ai/pedestrians';
import { Guards } from '../ai/guards';
import { SecurityCameras, SecCam } from '../ai/cameras';
import { HackSystem } from '../hacking/hack';
import { Heist } from '../heist/heist';
import { Hud } from '../ui/hud';
import { Audio } from '../audio/audio';
import { updateDebug } from '../debug/debug';
import { loadCharacterModels } from '../characters/loader';
import { blockCenter } from '../world/layout';
import { Quality } from './quality';
import { Save } from '../save/save';
import { StreetLife } from '../world/streetlife';
import { Ambient } from '../render/ambient';
import { News } from '../ui/news';
import { Disguise } from '../player/disguise';
import { Buildings } from '../world/buildings';
import { Loot, Shop } from './economy';
import { Jobs } from '../heist/jobs';
import { WorldTime } from '../render/world';
import { Escapes } from '../ai/escapes';
import { Chunks } from '../map/chunks';
import { FastTravel } from '../map/fasttravel';
import { Gps } from '../map/gps';
import { Missions } from '../missions/missions';
import { FullMap } from '../ui/fullmap';
import { HomeUi } from '../ui/homeui';
import { Activities } from '../activities/activities';
import { Bikes } from '../activities/bikes';
import { Stunts } from '../activities/stunts';
import { Tricks } from '../activities/tricks';
import { Races } from '../activities/races';
import { Reputation } from '../reputation/reputation';
import { Records } from '../save/records';
import { Places } from '../map/places';
import { Minigame } from '../ui/minigame';
import { TruckJob } from '../activities/truck';
import { GetawayJob } from '../activities/getaway';
import { TailJob } from '../activities/tail';
import { Pranks } from '../activities/pranks';
import { Collection } from '../activities/collection';
import { TouchControls } from '../ui/touch';
import { device } from './device';
import { Home } from '../world/home';

export type GameState = 'loading' | 'title' | 'playing' | 'paused' | 'results' | 'map' | 'menu';

/** new games and reloads begin in the bedroom at home */
const HOME = Home.START;

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
  quality: Quality;
  save = new Save();
  street!: StreetLife;
  ambient!: Ambient;
  news!: News;
  disguise!: Disguise;
  buildings!: Buildings;
  loot!: Loot;
  shop!: Shop;
  jobs!: Jobs;
  world!: WorldTime;
  escapes!: Escapes;
  chunks!: Chunks;
  travel!: FastTravel;
  gps!: Gps;
  missions!: Missions;
  map!: FullMap;
  home!: Home;
  activities!: Activities;
  bikes!: Bikes;
  stunts!: Stunts;
  tricks!: Tricks;
  races!: Races;
  rep!: Reputation;
  records = new Records();
  places = new Places(this);
  minigame!: Minigame;
  truck!: TruckJob;
  getaway!: GetawayJob;
  tail!: TailJob;
  pranks!: Pranks;
  collection!: Collection;
  /** a route the current mission wants drawn on the maps */
  routeLine: { x: number; z: number }[] | null = null;
  touch: TouchControls | null = null;
  homeUi!: HomeUi;
  /** context action for E while driving (e.g. respray booth) */
  carAction: { label: string; action: () => void } | null = null;
  private fade: { t: number; to: THREE.Vector3; heading: number; label: string; done: boolean; mid?: () => void } | null = null;
  debugOverlay = false;
  frameMs = 16;
  private shadowTick = 0;
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
  private wasLocked = false;
  private rng = new Rng(555);
  clipMode = new URLSearchParams(location.search).has('clip');
  private fpsT = 0;
  private fpsN = 0;
  fps = 60;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, device.mobile ? 1 : 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    this.input = new Input(canvas);
    this.quality = new Quality(this);
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
    this.city = new City(this.col);
    Buildings.reserve(this.city);
    this.city.build();
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
    this.street = new StreetLife(this.city, this.col).build();
    this.scene.add(this.street.group);
    this.city.finalize();
    this.chunks = new Chunks(this);
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
    this.world = new WorldTime(this);
    this.loot = new Loot(this);
    this.shop = new Shop(this);
    this.jobs = new Jobs(this);
    this.rep = new Reputation(this);
    this.activities = new Activities(this);
    this.hack = new HackSystem(this);
    await step(0.82, 'opening shops');
    this.buildings = new Buildings(this).build();
    this.home = this.buildings.home;
    this.escapes = new Escapes(this).build();
    this.travel = new FastTravel(this).build();
    this.stunts = new Stunts(this).build();
    this.bikes = new Bikes(this).build();
    this.tricks = new Tricks(this);
    this.races = new Races(this);
    this.minigame = new Minigame(this);
    this.truck = new TruckJob(this);
    this.getaway = new GetawayJob(this);
    this.tail = new TailJob(this);
    this.pranks = new Pranks(this);
    this.collection = new Collection(this).build();
    this.gps = new Gps(this);
    this.missions = new Missions(this);
    this.map = new FullMap(this);
    this.homeUi = new HomeUi(this);
    if (device.touch) this.touch = new TouchControls(this);
    this.hack.build();
    this.heist = new Heist(this);
    this.news = new News(this);
    this.disguise = new Disguise(this);
    this.ambient = new Ambient(this);
    await step(0.9, 'compiling shaders');
    this.quality.apply();
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
    const start = S.title.querySelector('.start') as HTMLElement, fresh = S.title.querySelector('.newgame') as HTMLElement;
    start.textContent = this.save.hasProgress ? 'CONTINUE' : 'NEW GAME';
    fresh.style.display = this.save.hasProgress ? '' : 'none';
    this.confirmButton(fresh, () => { this.newGame(); });
    this.confirmButton(S.pause.querySelector('.newgame') as HTMLElement, () => this.newGame());
    for (const s of [S.title, S.pause]) s.querySelector('.ctl')?.addEventListener('click', () => this.touch?.openSettings());
    S.pause.querySelector('.resume')!.addEventListener('click', () => this.resume());
    S.pause.querySelector('.restart')!.addEventListener('click', () => { if (this.missions.run) this.missions.retry(false); else this.hud.toast('NO MISSION RUNNING', 'dim'); });
    S.pause.querySelector('.quitm')!.addEventListener('click', () => { if (this.missions.run) this.missions.quit(); else this.hud.toast('NO MISSION RUNNING', 'dim'); });
    S.pause.querySelector('.map')!.addEventListener('click', () => this.map.show('paused'));
    S.pause.querySelector('.mute')!.addEventListener('click', () => this.hud.toast(this.audio.toggleMute() ? 'MUTED' : 'SOUND ON', 'dim'));
    S.pause.querySelector('.forget')!.addEventListener('click', () => { this.routes.clear(); this.hud.toast('ROUTE MEMORY CLEARED', 'dim'); });
    S.results.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).dataset.act;
      if (act) this.missions.action(act);
    });
  }

  /** destructive buttons ask twice */
  private confirmButton(el: HTMLElement, fn: () => void) {
    const label = el.textContent ?? '';
    let armed = 0;
    el.addEventListener('click', () => {
      if (performance.now() - armed < 4000) { el.textContent = label; armed = 0; fn(); return; }
      armed = performance.now();
      el.textContent = 'ERASE SAVE? CLICK AGAIN';
      setTimeout(() => { el.textContent = label; }, 4000);
    });
  }

  /** wipes progress and starts over at home */
  newGame() {
    this.save.wipe();
    this.routes.clear();
    this.gps.clearWaypoint();
    (this.hud.screens.title.querySelector('.start') as HTMLElement).textContent = 'NEW GAME';
    this.reset(false);
    this.play();
    this.hud.toast('NEW GAME', 'hack');
    this.hud.hint('You\'re home. E at the front door to head out, M for the map.');
  }

  private startPlaying() {
    this.audio.init();
    this.hud.show(null);
    this.state = 'playing';
    this.input.lock();
    if (!this.clipMode) {
      this.hud.toast('CUT THE POWER. ROB THE CITY.', 'hack');
      this.hud.hint('You\'re home. E at the front door to head out, M for the map.');
    }
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.hud.show('pause');
    (this.hud.screens.pause.querySelector('.p-progress') as HTMLElement).textContent = this.collection.progress;
  }

  resume() {
    this.play();
  }

  /** back into the game from any screen */
  play() {
    this.state = 'playing';
    this.hud.show(null);
    this.audio.init();
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
    this.missions.onWorldReset();
    for (const v of [...this.vehicles]) this.removeVehicle(v);
    this.vehicles = [];
    this.parked = [];
    this.getawayCar = null;
    this.bustT = -1;
    this.hitstopT = 0;
    this.timeScale = 1;
    this.routes.newRun();
    this.signals.reset();
    this.hack.reset();
    this.heist.reset();
    this.police.reset();
    this.cameras.reset();
    this.post.damage = 0;

    // the getaway car behind the bank
    const gs = this.bank.getawaySpot;
    const ga = new Vehicle('sedan', '#5b6433', this.col);
    ga.tune('getaway');
    ga.place(gs.x, gs.z, gs.heading);
    ga.handbrake = true;
    this.addVehicle(ga);
    this.getawayCar = ga;

    this.player.spawn(HOME.x, HOME.z, HOME.heading);
    this.camRig.snapBehind(HOME.heading);
    this.camRig.pitch = -0.12;
    this.chunks.reset();
    this.traffic.reset();
    this.peds.reset();
    this.guards.reset();
    this.ambient.reset();
    this.loot.reset();
    this.jobs.reset();
    this.world.reset();
    this.buildings.reset();
    this.escapes.reset();
    this.carAction = null;
    this.fade = null;
    // cruisers parked behind the police station (locked, stealable)
    for (const s of this.buildings.policeLot) {
      const v = new Vehicle('police', '#1c1c1e', this.col);
      v.place(s.x, s.z, s.h);
      v.locked = true;
      v.handbrake = true;
      this.addVehicle(v);
    }
    // cars on the parking garage decks
    for (const [x, z, y] of [[14.5, 70, 0], [23.5, 70, 0], [32.5, 70, 3.8], [20.5, 70, 3.8], [26, 98, 7.6]]) {
      const kind = pickKind(this.rng, 'downtown');
      const v = new Vehicle(kind === 'bus' ? 'sedan' : kind, colorFor(this.rng, kind), this.col);
      v.place(x, z, 0);
      v.pos.y = y + (y > 0 ? 0 : 0.15);
      v.locked = !v.two;
      v.handbrake = true;
      this.addVehicle(v);
    }
    this.news.reset();
    this.disguise.reset();
    this.home.onWorldReset();
    this.bikes.reset();
    this.tricks.reset();
    this.collection.reset();
    this.rep.reset();
    this.home.refreshDisplays();

    if (clip) {
      // instant chase: mid-city, next to the getaway car, heat 3
      this.missions.startAt('bank_heist', 'escape');
      const c = blockCenter(6, 6);
      ga.place(c.x - 30, c.z + 4, 0);
      this.player.spawn(c.x - 32.9, c.z + 4, 0);
      this.camRig.snapBehind(0);
      this.police.setHeat(3, 'clip mode');
      this.chunks.update();
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

  /** places the clip keys [ and ] teleport between */
  sites(): { name: string; x: number; z: number; heading: number }[] {
    return [
      { name: 'Bank', x: this.bank.playerStart.x, z: this.bank.playerStart.z, heading: Math.PI },
      ...this.travel.stands.map((s) => ({ name: `District: ${s.name}`, x: s.x + 1.6, z: s.z + 1.2, heading: 0 })),
      ...this.buildings.sites.map((s) => ({ name: s.name, ...s.approach })),
      { name: 'Old Garage drop', x: this.city.dropZone.doorX - 18, z: this.city.dropZone.doorZ, heading: Math.PI / 2 },
      ...this.escapes.stations.map((s) => ({ name: `${s.name} station`, x: s.entrance.x, z: s.entrance.z + 3, heading: Math.PI })),
    ];
  }

  /** which enclosed site a point is in: 'bank', a building id, or null (outdoors) */
  siteAt(x: number, z: number, y = 0): string | null {
    if (this.bank.isInside(x, z)) return 'bank';
    if (y < -2) return 'subway';
    return this.buildings.siteAt(x, z, y)?.id ?? null;
  }

  /** interior ceiling height for camera clamping (99 = open sky) */
  ceilingAt(x: number, z: number, y: number): number {
    if (this.bank.isInside(x, z)) return 6;
    if (y < -2) return this.escapes.ceiling;
    const s = this.buildings.siteAt(x, z, y);
    if (!s || s.ceiling > 50) return 99;
    return y + s.ceiling;
  }

  /** where the HUD marker and GPS point: mission, then side job, then waypoint */
  missionTarget(): THREE.Vector3 | null {
    if (this.missions.run) return this.missions.target();
    return this.jobs.target() ?? this.gps.waypoint;
  }

  /** cut-to-black teleport (elevators, subway, sewers) */
  fadeTeleport(x: number, y: number, z: number, heading: number, label: string, mid?: () => void) {
    this.fade = { t: 0, to: new THREE.Vector3(x, y, z), heading, label, done: false, mid };
  }

  get fading() { return !!this.fade && !this.fade.done; }

  isVisible(x: number, y: number, z: number) {
    return this.frustum.containsPoint(new THREE.Vector3(x, y, z));
  }

  hitstop(s: number) {
    this.hitstopT = Math.max(this.hitstopT, s);
  }

  // ------------------------------------------------------------------ events
  onCarjack(v: Vehicle) {
    this.peds.ejectDriver(v.pos.clone());
    this.news.report('carjack', v.pos.x, v.pos.z);
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
    this.peds.witnessCrime(pos, 'hit-and-run', 1);
    if (this.police.units.some((u) => u.pos.distanceTo(pos) < 45)) this.police.crime(1, 'hit-and-run');
  }

  onBusted() {
    if (this.player.busted || this.missions.ended) return;
    this.player.busted = true;
    this.player.exitVehicle(true);
    this.player.busted = true;
    if (this.loot.carried.length) this.hud.toast(`LOOT CONFISCATED ($${this.loot.carriedValue.toLocaleString()})`, 'heat');
    this.loot.confiscate();
    this.audio.busted();
    this.hud.toast('BUSTED', 'heat');
    this.bustT = 0;
  }

  /** free-roam bust: a fine and a walk out of the station, no game over */
  private freeRoamBusted() {
    const fine = Math.min(this.save.data.cash, 250);
    this.save.data.cash -= fine;
    this.police.reset();
    this.fadeTeleport(84, 0.15, 8, 0, fine ? `RELEASED — $${fine} FINE` : 'RELEASED WITH A WARNING');
  }

  // ------------------------------------------------------------------ loop
  private frame() {
    const rawDt = this.clock.getDelta();
    const realDt = Math.min(rawDt, 0.05);
    this.frameMs = rawDt * 1000;
    if (this.state === 'playing') this.quality.sample(this.frameMs, realDt);
    this.fpsT += realDt;
    this.fpsN++;
    if (this.fpsT > 1) { this.fps = this.fpsN / this.fpsT; this.fpsT = 0; this.fpsN = 0; }
    const inp = this.input;
    this.touch?.update();

    // global keys
    if (inp.pressed('toggleHud')) this.hud.setVisible(!this.hud.visible);
    if (inp.pressed('photoMode')) this.hud.setPhoto(!this.hud.photo);
    if (inp.pressed('mute')) this.hud.toast(this.audio.toggleMute() ? 'MUTED' : 'SOUND ON', 'dim');
    if (inp.pressed('debugOverlay')) this.debugOverlay = !this.debugOverlay;
    if (inp.pressed('cycleQuality')) this.quality.cycle();
    if (inp.pressed('retry') && (this.state === 'playing' || this.state === 'paused') && this.missions.run && !this.missions.ended) this.missions.retry(false);
    if (inp.pressed('escape') && this.state === 'paused') this.resume();
    else if (inp.pressed('pause') && this.state === 'playing') { this.input.unlock(); this.pause(); }
    if (this.state === 'map') this.map.update(realDt);
    else if (this.state === 'menu') this.homeUi.update();
    else if (inp.pressed('map') && (this.state === 'playing' || this.state === 'paused')) this.map.show(this.state);

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
      this.missions.updateResults();
      // slow orbit around the scene of the crime
      this.time += realDt * 0.3;
      const P = this.player.worldPos;
      const a = this.time * 0.4;
      this.camera.position.set(P.x + Math.cos(a) * 11, P.y + 5, P.z + Math.sin(a) * 11);
      this.camera.lookAt(P.x, P.y + 1, P.z);
      this.fx.update(realDt * 0.3);
    }
    // lower presets refresh the shadow map at 30 Hz
    const sh = this.env.sun.shadow;
    sh.autoUpdate = false;
    this.shadowTick++;
    // the flat is unlit by the sun, so nothing in view needs fresh shadows
    sh.needsUpdate = !this.home?.inHouse && (this.quality.level >= 2 || this.shadowTick % 2 === 0);
    this.renderer.info.reset();
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
    this.signals.followWave(this.player.worldPos.x, this.player.worldPos.z);
    this.cameras.update(dt);
    this.guards.update(dt);
    this.peds.update(dt);
    this.ambient.update(dt);
    this.street.update(dt);
    this.chunks.update();
    const LP = this.player.worldPos;
    for (const v of this.vehicles) { const d = Math.abs(v.pos.x - LP.x) + Math.abs(v.pos.z - LP.z); v.setLod(d < 35 ? 0 : d < 110 ? 1 : 2); }
    this.city.flushInstances();
    this.travel.update();
    this.buildings.update(dt);
    this.bikes.update();
    this.escapes.update(dt);
    this.jobs.update(dt);
    this.world.update(dt);
    this.home.update(dt, realDt);
    this.updateFade(realDt);
    this.news.update(realDt);
    this.hack.update(realDt, dt);
    this.heist.update(dt);
    this.races.update(dt);
    this.truck.update(dt);
    this.getaway.update(dt);
    this.tail.update(dt);
    this.pranks.update(dt);
    this.collection.update(dt);
    this.minigame.update(realDt);
    this.missions.update(dt);
    this.tricks.update(dt);
    this.activities.update(realDt);
    this.rep.update(dt);
    this.gps.update(realDt);
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
      if (this.bustT > 2.2) {
        this.bustT = -1;
        if (this.missions.run) this.missions.fail('Busted');
        else this.freeRoamBusted();
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

  private updateFade(dt: number) {
    const f = this.fade;
    if (!f) return;
    f.t += dt;
    this.post.flash = Math.max(this.post.flash, Math.min(1, f.t < 0.35 ? f.t / 0.35 : 1 - (f.t - 0.35) / 0.4) * 1.8);
    (this.post.mat.uniforms.uFlashColor.value as THREE.Color).set('#000000');
    if (!f.done && f.t > 0.35) {
      f.done = true;
      f.mid?.();
      const v = this.player.vehicle;
      if (v) { v.place(f.to.x, f.to.z, f.heading); v.pos.y = f.to.y; }
      else { this.player.spawn(f.to.x, f.to.z, f.heading); this.player.pos.y = f.to.y; }
      this.camRig.snapBehind(f.heading);
      if (f.label) this.hud.toast(f.label, 'dim');
    }
    if (f.t > 0.75) this.fade = null;
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
      if (involvesPlayer && pv && pv.two && e.impact > 8.5) this.player.thrownOff(pv.vx, pv.vz);
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
