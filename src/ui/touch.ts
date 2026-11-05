// Touch controls, on top of the input actions: a floating stick or wheel on one
// side, drag to look on the other, and buttons that change with what you're doing.
// Everything goes through Input.press/release/setAxis/addLook, so gameplay can't
// tell it apart from a keyboard. Pointer events handle any number of fingers.
import { clamp } from '../core/math';
import { device } from '../core/device';
import type { Action } from '../core/input';
import type { Game } from '../core/game';

type DriveMode = 'stick' | 'wheel' | 'tilt' | 'stickonly';
interface Settings { drive: DriveMode; size: 0 | 1 | 2; swap: boolean; look: 0 | 1 | 2; }

const KEY = 'blackoutcity.controls.v1';
const LOOK_SENS = [0.9, 1.5, 2.3];
const SIZES = [54, 66, 80];

/** one on-screen button: where it sits in the cluster (row and column from the corner) */
interface Btn { id: string; label: string; a: Action; r: number; c: number; big?: boolean; hot?: boolean; cls?: string; }

const STICK_R = 56;

export class TouchControls {
  private el: HTMLDivElement;
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private wheel: HTMLDivElement;
  private cluster: HTMLDivElement;
  private panel: HTMLDivElement;
  s: Settings = { drive: 'stick', size: 1, swap: false, look: 1 };
  private fingers = new Map<number, { kind: 'stick' | 'wheel' | 'look' | 'btn'; x0: number; y0: number; x: number; y: number; a?: Action; last?: number }>();
  private stickX = 0;
  private stickY = 0;
  private wheelA = 0;
  private tiltSteer = 0;
  private tiltOn = false;
  private ctxKey = '';
  private wasPlaying = false;
  private autoRun = false;

  constructor(private g: Game) {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.s = { ...this.s, ...JSON.parse(raw) };
    } catch { /* ignore */ }
    const root = g.hud.root;
    root.classList.add('touch');
    document.documentElement.classList.add('touch');
    const el = (this.el = document.createElement('div'));
    el.className = 'tc';
    el.innerHTML = '<div class="tc-base"><div class="tc-knob"></div></div><div class="tc-wheel"><i></i></div><div class="tc-cluster"></div><div class="tc-top"></div>';
    root.appendChild(el);
    this.base = el.querySelector('.tc-base')!;
    this.knob = el.querySelector('.tc-knob')!;
    this.wheel = el.querySelector('.tc-wheel')!;
    this.cluster = el.querySelector('.tc-cluster')!;
    const top = el.querySelector('.tc-top')!;
    top.innerHTML = '<div class="tc-btn tc-small" data-a="map">MAP</div><div class="tc-btn tc-small" data-a="pause">II</div>';
    el.addEventListener('pointerdown', (e) => this.down(e));
    addEventListener('pointermove', (e) => this.move(e), { passive: false });
    addEventListener('pointerup', (e) => this.up(e));
    addEventListener('pointercancel', (e) => this.up(e));
    this.panel = document.createElement('div');
    this.panel.className = 'panel tc-panel';
    this.panel.style.display = 'none';
    root.appendChild(this.panel);
    this.panel.addEventListener('click', (e) => this.panelClick(e));
    // the rotate screen
    const rot = document.createElement('div');
    rot.className = 'rotate-screen';
    rot.innerHTML = '<div class="logo">BLACKOUT<span>CITY</span></div><div class="rot-phone"></div><div class="lmsg">PLEASE ROTATE YOUR DEVICE</div>';
    document.body.appendChild(rot);
    // the page must not scroll, zoom or bounce; only real lists may scroll
    document.addEventListener('touchmove', (e) => { if (!(e.target as HTMLElement).closest?.('.ms-list, .hu-list, .tc-panel, .screen, .mission-card, .shop-ui .hu-tabs')) e.preventDefault(); }, { passive: false });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    // first touch: sound, fullscreen, landscape. These all need a user gesture.
    addEventListener('pointerup', () => this.firstGesture(), { once: true });
    addEventListener('deviceorientation', (e) => {
      if (e.beta === null) return;
      const angle = (screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 90) as number;
      this.tiltSteer = clamp((e.beta / 26) * (angle === 270 || angle === -90 ? -1 : 1), -1, 1);
    });
    this.applySettings();
  }

  private firstGesture() {
    this.g.audio.init();
    this.goFullscreen();
    if (device.iPhone && !device.standalone) {
      try {
        if (!localStorage.getItem('blackoutcity.a2hs')) {
          localStorage.setItem('blackoutcity.a2hs', '1');
          this.g.hud.hint('For full screen on iPhone: Share, then Add to Home Screen.');
        }
      } catch { /* ignore */ }
    }
  }

  private goFullscreen() {
    const d = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    try {
      if (!document.fullscreenElement) (d.requestFullscreen?.() ?? d.webkitRequestFullscreen?.());
      (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })?.lock?.('landscape')?.catch?.(() => {});
    } catch { /* not supported: fine */ }
  }

  private save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.s)); } catch { /* ignore */ }
  }

  private applySettings() {
    this.el.classList.toggle('swap', this.s.swap);
    this.el.style.setProperty('--tc', `${SIZES[this.s.size]}px`);
    this.ctxKey = '';
    this.tiltOn = this.s.drive === 'tilt';
  }

  // ------------------------------------------------------------------ fingers
  private down(e: PointerEvent) {
    e.preventDefault(); // stops the browser's fake mouse events
    const btn = (e.target as HTMLElement).closest('.tc-btn') as HTMLElement | null;
    const inp = this.g.input;
    if (btn) {
      const a = btn.dataset.a as Action;
      inp.press(a);
      btn.classList.add('on');
      this.fingers.set(e.pointerId, { kind: 'btn', a, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY });
      return;
    }
    const v = this.g.player.vehicle;
    const leftSide = this.s.swap ? e.clientX > innerWidth * 0.55 : e.clientX < innerWidth * 0.45;
    if (leftSide && !this.hasFinger('stick') && !this.hasFinger('wheel')) {
      if (v && this.s.drive === 'tilt') { this.fingers.set(e.pointerId, { kind: 'look', x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY }); return; }
      if (v && this.s.drive === 'wheel') {
        const c = this.wheelCentre();
        this.fingers.set(e.pointerId, { kind: 'wheel', x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, last: Math.atan2(e.clientY - c.y, e.clientX - c.x) });
        return;
      }
      // the stick appears under your thumb
      const m = STICK_R + 12;
      const bx = clamp(e.clientX, m, innerWidth - m), by = clamp(e.clientY, m, innerHeight - m);
      this.base.style.display = 'block';
      this.base.style.transform = `translate(${bx}px, ${by}px)`;
      this.fingers.set(e.pointerId, { kind: 'stick', x0: bx, y0: by, x: e.clientX, y: e.clientY });
      this.stickMoved(e.clientX, e.clientY, bx, by);
      return;
    }
    this.fingers.set(e.pointerId, { kind: 'look', x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY });
  }

  private hasFinger(kind: string) {
    for (const f of this.fingers.values()) if (f.kind === kind) return true;
    return false;
  }

  private wheelCentre() {
    const r = this.wheel.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  private stickMoved(x: number, y: number, bx: number, by: number) {
    let dx = (x - bx) / STICK_R, dy = (y - by) / STICK_R;
    const L = Math.hypot(dx, dy);
    if (L > 1) { dx /= L; dy /= L; }
    // a small dead zone so a resting thumb doesn't creep
    const dz = L < 0.14;
    this.stickX = dz ? 0 : dx;
    this.stickY = dz ? 0 : dy;
    this.knob.style.transform = `translate(${dx * STICK_R}px, ${dy * STICK_R}px)`;
  }

  private move(e: PointerEvent) {
    const f = this.fingers.get(e.pointerId);
    if (!f) return;
    e.preventDefault();
    if (f.kind === 'stick') this.stickMoved(e.clientX, e.clientY, f.x0, f.y0);
    else if (f.kind === 'look') this.g.input.addLook((e.clientX - f.x) * LOOK_SENS[this.s.look], (e.clientY - f.y) * LOOK_SENS[this.s.look]);
    else if (f.kind === 'wheel') {
      const c = this.wheelCentre();
      const a = Math.atan2(e.clientY - c.y, e.clientX - c.x);
      let d = a - f.last!;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      this.wheelA = clamp(this.wheelA + d, -2, 2);
      f.last = a;
    }
    f.x = e.clientX;
    f.y = e.clientY;
  }

  private up(e: PointerEvent) {
    const f = this.fingers.get(e.pointerId);
    if (!f) return;
    this.fingers.delete(e.pointerId);
    if (f.kind === 'btn') {
      this.g.input.release(f.a!);
      for (const b of Array.from(this.el.querySelectorAll('.tc-btn.on')) as HTMLElement[]) if (b.dataset.a === f.a) b.classList.remove('on');
    } else if (f.kind === 'stick') {
      this.stickX = this.stickY = 0;
      this.base.style.display = 'none';
      this.knob.style.transform = '';
    }
  }

  /** drop everything held, e.g. when a menu opens */
  private releaseAll() {
    const inp = this.g.input;
    for (const f of this.fingers.values()) if (f.a) inp.release(f.a);
    this.fingers.clear();
    this.stickX = this.stickY = 0;
    this.base.style.display = 'none';
    this.wheelA = 0;
    if (this.autoRun) { inp.release('run'); this.autoRun = false; }
    for (const a of ['moveX', 'moveY', 'steer', 'throttle'] as const) inp.setAxis(a, 0);
    for (const b of Array.from(this.el.querySelectorAll('.tc-btn.on'))) b.classList.remove('on');
  }

  // ------------------------------------------------------------------ what the buttons are right now
  private buttons(): Btn[] {
    const g = this.g, p = g.player, v = p.vehicle;
    if (g.minigame.active) return [{ id: 'tap', label: 'HIT', a: 'interact', r: 0, c: 0, big: true, hot: true }];
    if (g.missions.card) return [{ id: 'start', label: 'START', a: 'interact', r: 0, c: 0, big: true, hot: true }, { id: 'no', label: 'NOT NOW', a: 'back', r: 0, c: 1 }];
    if (g.travel.open) return [{ id: 'go', label: 'GO', a: 'confirm', r: 0, c: 0, big: true, hot: true }, { id: 'dn', label: '▼', a: 'menuDown', r: 0, c: 1 }, { id: 'up', label: '▲', a: 'menuUp', r: 1, c: 1 }, { id: 'x', label: 'CLOSE', a: 'back', r: 1, c: 0 }];
    if (g.jobs.phoneOpen) return [{ id: 'take', label: 'TAKE', a: 'confirm', r: 0, c: 0, big: true, hot: true }, { id: 'next', label: 'NEXT', a: 'phone', r: 0, c: 1 }, { id: 'x', label: 'CLOSE', a: 'back', r: 1, c: 0 }];
    const hack: Btn = { id: 'hack', label: 'HACK', a: 'hack', r: 2, c: 0, cls: 'cy' };
    if (g.hack.active) {
      return [
        { id: 'fire', label: g.hack.selected ? 'RUN IT' : 'AIM', a: 'hackPrimary', r: 0, c: 0, big: true, hot: !!g.hack.selected, cls: 'cy' },
        { id: 'alt', label: 'ALT', a: 'hackAlt', r: 1, c: 0, cls: 'cy' },
        { ...hack, r: 0, c: 1 },
      ];
    }
    if (p.aboard) return g.metro.canGetOff ? [{ id: 'off', label: 'GET OFF', a: 'interact', r: 0, c: 0, big: true, hot: true }] : [];
    if (p.hidden) return [{ id: 'out', label: 'COME OUT', a: 'interact', r: 0, c: 0, big: true, hot: true }];
    if (v) {
      const pedals = this.s.drive !== 'stickonly';
      const out: Btn[] = [
        ...(pedals ? [{ id: 'gas', label: 'GAS', a: 'accelerate' as Action, r: 0, c: 0, big: true, cls: 'gn' }, { id: 'brk', label: 'BRAKE', a: 'brake' as Action, r: 0, c: 1, cls: 'rd' }] : []),
        { id: 'hb', label: 'DRIFT', a: 'handbrake', r: 1, c: 0 },
        { id: 'use', label: g.carAction ? 'USE' : 'EXIT', a: 'interact', r: 1, c: 1, hot: !!g.carAction },
        { id: 'cam', label: 'CAM', a: 'carCamera', r: 2, c: 1, cls: 'q' },
        hack,
      ];
      if (v.two && !v.boat) out.push({ id: 'trick', label: 'TRICK', a: 'trick', r: 1, c: 2, cls: 'lm' });
      if (v.two ? v.kind !== 'bicycle' : v.kind === 'sports' || v.kind === 'muscle') out.push({ id: 'boost', label: 'BOOST', a: 'boost', r: 0, c: 2, cls: 'am' });
      return out;
    }
    return [
      { id: 'use', label: 'ACTION', a: 'interact', r: 0, c: 0, big: true, hot: !!p.focusLabel },
      { id: 'jump', label: 'JUMP', a: 'jump', r: 0, c: 1 },
      { id: 'run', label: 'RUN', a: 'run', r: 1, c: 1 },
      { id: 'phone', label: 'JOBS', a: 'phone', r: 2, c: 1, cls: 'q' },
      ...(g.jobs.active ? [{ id: 'quit', label: 'QUIT JOB', a: 'abandon' as Action, r: 2, c: 2, cls: 'q' }] : []),
      { ...hack, r: 1, c: 0 },
    ];
  }

  private drawButtons() {
    const list = this.buttons();
    const key = list.map((b) => `${b.id}:${b.label}:${b.hot ? 1 : 0}`).join('|');
    if (key === this.ctxKey) return;
    this.ctxKey = key;
    const held = new Set(Array.from(this.fingers.values()).filter((f) => f.a).map((f) => f.a));
    this.cluster.innerHTML = list.map((b) => {
      const pos = `--r:${b.r};--c:${b.c}`;
      return `<div class="tc-btn ${b.big ? 'big' : ''} ${b.hot ? 'hot' : ''} ${b.cls ?? ''} ${held.has(b.a) ? 'on' : ''}" style="${pos}" data-a="${b.a}">${b.label}</div>`;
    }).join('');
  }

  // ------------------------------------------------------------------ per frame
  update() {
    const g = this.g, inp = g.input;
    const playing = g.state === 'playing' && !this.portrait;
    if (!playing) {
      if (this.wasPlaying) this.releaseAll();
      this.wasPlaying = false;
      // no playing behind the rotate screen
      if (this.portrait && g.state === 'playing') g.pause();
      return;
    }
    this.wasPlaying = true;
    const v = g.player.vehicle;
    this.drawButtons();
    const wheel = !!v && this.s.drive === 'wheel';
    this.wheel.style.display = wheel ? 'block' : 'none';
    if (wheel) {
      if (!this.hasFinger('wheel')) this.wheelA *= 0.82; // it self-centres
      this.wheel.style.transform = `rotate(${this.wheelA}rad)`;
    }
    if (v) {
      let steer = this.stickX;
      if (this.s.drive === 'wheel') steer = clamp(this.wheelA / 1.4, -1, 1);
      else if (this.tiltOn) steer = Math.abs(this.tiltSteer) < 0.06 ? 0 : this.tiltSteer;
      inp.setAxis('steer', steer);
      inp.setAxis('throttle', this.s.drive === 'stickonly' ? -this.stickY : 0);
      inp.setAxis('moveX', 0);
      inp.setAxis('moveY', 0);
    } else {
      inp.setAxis('moveX', this.stickX);
      inp.setAxis('moveY', -this.stickY);
      inp.setAxis('steer', 0);
      inp.setAxis('throttle', 0);
    }
    // push the stick all the way to run
    const full = !v && Math.hypot(this.stickX, this.stickY) > 0.92;
    if (full !== this.autoRun) { this.autoRun = full; if (full) inp.press('run'); else inp.release('run'); }
  }

  private get portrait() { return innerHeight > innerWidth; }

  // ------------------------------------------------------------------ settings menu
  openSettings() {
    this.panel.style.display = 'flex';
    this.renderPanel();
  }

  private renderPanel() {
    const s = this.s, g = this.g;
    const row = (name: string, key: string, opts: [string | number, string][], cur: string | number) =>
      `<div class="tcp-row"><span>${name}</span><div>${opts.map(([v, l]) => `<button data-k="${key}" data-v="${v}" class="${v === cur ? 'on' : ''}">${l}</button>`).join('')}</div></div>`;
    this.panel.innerHTML = `
      <div class="hu-head"><span>CONTROLS</span></div>
      ${row('STEERING', 'drive', [['stick', 'STICK'], ['wheel', 'WHEEL'], ['tilt', 'TILT'], ['stickonly', 'STICK ONLY']], s.drive)}
      ${row('BUTTON SIZE', 'size', [[0, 'S'], [1, 'M'], [2, 'L']], s.size)}
      ${row('SIDES', 'swap', [[0, 'STICK LEFT'], [1, 'STICK RIGHT']], s.swap ? 1 : 0)}
      ${row('LOOK SPEED', 'look', [[0, 'SLOW'], [1, 'NORMAL'], [2, 'FAST']], s.look)}
      <div class="tcp-row"><span>QUALITY: ${g.quality.p.name}${g.quality.auto ? ' (AUTO)' : ''}</span><div><button data-k="quality">CHANGE</button><button data-k="full">FULLSCREEN</button></div></div>
      <button class="btn" data-k="close">DONE</button>`;
  }

  private panelClick(e: Event) {
    const b = e.target as HTMLElement;
    const k = b.dataset.k;
    if (!k) return;
    const v = b.dataset.v;
    const s = this.s;
    if (k === 'close') { this.panel.style.display = 'none'; return; }
    if (k === 'quality') this.g.quality.cycle();
    if (k === 'full') this.goFullscreen();
    if (k === 'drive') {
      s.drive = v as DriveMode;
      // iOS asks permission for the tilt sensor, from a tap
      const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
      if (s.drive === 'tilt') void DOE?.requestPermission?.().catch(() => {});
    }
    if (k === 'size') s.size = +v! as 0 | 1 | 2;
    if (k === 'swap') s.swap = v === '1';
    if (k === 'look') s.look = +v! as 0 | 1 | 2;
    this.save();
    this.applySettings();
    this.renderPanel();
  }
}
