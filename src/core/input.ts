// Player input goes through named actions, never raw keys: gameplay asks
// `input.held('handbrake')`, the table below says what triggers it. Touch controls
// can drive the same actions with press()/release()/setAxis()/addLook().
// Only debug.ts reads raw keys (clip tools).

export type Action =
  | 'moveForward' | 'moveBack' | 'moveLeft' | 'moveRight' | 'run' | 'jump'
  | 'accelerate' | 'brake' | 'steerLeft' | 'steerRight' | 'handbrake' | 'boost' | 'carCamera' | 'trick'
  | 'interact' | 'hack' | 'hackPrimary' | 'hackAlt'
  | 'map' | 'phone' | 'abandon' | 'retry' | 'retryCheckpoint'
  | 'pause' | 'escape' | 'confirm' | 'back' | 'menuUp' | 'menuDown' | 'menuLeft' | 'menuRight'
  | 'toggleHud' | 'photoMode' | 'mute' | 'debugOverlay' | 'cycleQuality';

import { device } from './device';

export type Axis = 'moveX' | 'moveY' | 'steer' | 'throttle';

const BINDINGS: Record<Action, { keys?: string[]; mouse?: number[] }> = {
  moveForward: { keys: ['KeyW', 'ArrowUp'] },
  moveBack: { keys: ['KeyS', 'ArrowDown'] },
  moveLeft: { keys: ['KeyA', 'ArrowLeft'] },
  moveRight: { keys: ['KeyD', 'ArrowRight'] },
  run: { keys: ['ShiftLeft', 'ShiftRight'] },
  jump: { keys: ['Space'] },
  accelerate: { keys: ['KeyW', 'ArrowUp'] },
  brake: { keys: ['KeyS', 'ArrowDown'] },
  steerLeft: { keys: ['KeyA', 'ArrowLeft'] },
  steerRight: { keys: ['KeyD', 'ArrowRight'] },
  handbrake: { keys: ['Space'] },
  boost: { keys: ['ShiftLeft', 'ShiftRight'] },
  carCamera: { keys: ['KeyC'] },
  trick: { keys: ['KeyF'] },
  interact: { keys: ['KeyE'] },
  hack: { keys: ['KeyQ', 'Tab'] },
  hackPrimary: { keys: ['KeyE'], mouse: [0] },
  hackAlt: { mouse: [2] },
  map: { keys: ['KeyM'] },
  phone: { keys: ['KeyJ'] },
  abandon: { keys: ['KeyX'] },
  retry: { keys: ['KeyR'] },
  retryCheckpoint: { keys: ['KeyC'] },
  pause: { keys: ['KeyP'] },
  escape: { keys: ['Escape'] },
  confirm: { keys: ['Enter'] },
  back: { keys: ['Backspace'] },
  menuUp: { keys: ['ArrowUp', 'KeyW'] },
  menuDown: { keys: ['ArrowDown', 'KeyS'] },
  menuLeft: { keys: ['ArrowLeft', 'KeyA'] },
  menuRight: { keys: ['ArrowRight', 'KeyD'] },
  toggleHud: { keys: ['KeyH'] },
  photoMode: { keys: ['F2'] },
  mute: { keys: ['KeyZ'] },
  debugOverlay: { keys: ['F3'] },
  cycleQuality: { keys: ['F4'] },
};

export class Input {
  private down = new Set<string>();
  private pressedSet = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private mouseDown = [false, false, false];
  private mousePressed = [false, false, false];
  /** actions held or tapped by something other than the keyboard and mouse */
  private virtualDown = new Set<Action>();
  private virtualPressed = new Set<Action>();
  private axes: Partial<Record<Axis, number>> = {};
  locked = false;
  onLockChange: (locked: boolean) => void = () => {};

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return; // typing in a text box isn't playing
      // Keep the browser from scrolling / tabbing / opening devtools-adjacent shortcuts while playing.
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F2'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressedSet.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('mousedown', (e) => {
      if (device.touch) return; // taps on menus aren't hack clicks
      if (e.button < 3) {
        this.mouseDown[e.button] = true;
        this.mousePressed[e.button] = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button < 3) this.mouseDown[e.button] = false;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      this.onLockChange(this.locked);
    });
  }

  lock() {
    if (device.touch) return;
    if (!this.locked) this.canvas.requestPointerLock?.()?.catch?.(() => {});
  }
  unlock() {
    if (this.locked) document.exitPointerLock();
  }

  // ------------------------------------------------------------------ actions
  held(...actions: Action[]) {
    return actions.some((a) => {
      if (this.virtualDown.has(a)) return true;
      const b = BINDINGS[a];
      return !!b.keys?.some((k) => this.down.has(k)) || !!b.mouse?.some((m) => this.mouseDown[m]);
    });
  }
  /** went down this frame */
  pressed(...actions: Action[]) {
    return actions.some((a) => {
      if (this.virtualPressed.has(a)) return true;
      const b = BINDINGS[a];
      return !!b.keys?.some((k) => this.pressedSet.has(k)) || !!b.mouse?.some((m) => this.mousePressed[m]);
    });
  }

  private axis(name: Axis, neg: Action, pos: Action) {
    const analog = this.axes[name];
    if (analog) return analog;
    return (this.held(pos) ? 1 : 0) - (this.held(neg) ? 1 : 0);
  }
  get moveX() { return this.axis('moveX', 'moveLeft', 'moveRight'); }
  get moveY() { return this.axis('moveY', 'moveBack', 'moveForward'); }
  get steer() { return this.axis('steer', 'steerLeft', 'steerRight'); }
  get throttle() { return this.axis('throttle', 'brake', 'accelerate'); }
  get lookX() { return this.mouseDX; }
  get lookY() { return this.mouseDY; }

  // ------------------------------------------------------------------ other input sources
  press(a: Action) {
    if (!this.virtualDown.has(a)) this.virtualPressed.add(a);
    this.virtualDown.add(a);
  }
  release(a: Action) {
    this.virtualDown.delete(a);
  }
  setAxis(name: Axis, value: number) {
    this.axes[name] = value;
  }
  addLook(dx: number, dy: number) {
    this.mouseDX += dx;
    this.mouseDY += dy;
  }

  /** clip tools only: everything else uses actions */
  debugKey(code: string) {
    return this.pressedSet.has(code);
  }

  /** Call at the end of each frame. */
  endFrame() {
    this.pressedSet.clear();
    this.virtualPressed.clear();
    this.mouseDX = this.mouseDY = 0;
    this.mousePressed = [false, false, false];
  }
}
