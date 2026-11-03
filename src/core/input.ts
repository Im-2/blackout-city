// Keyboard + mouse state with per-frame "pressed" edges and pointer lock.

export class Input {
  private down = new Set<string>();
  private pressedSet = new Set<string>();
  private releasedSet = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  mouseDown = [false, false, false];
  private mousePressed = [false, false, false];
  locked = false;
  onLockChange: (locked: boolean) => void = () => {};

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      // Keep the browser from scrolling / tabbing / opening devtools-adjacent shortcuts while playing.
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F2'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressedSet.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.releasedSet.add(e.code);
    });
    window.addEventListener('blur', () => this.down.clear());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('mousedown', (e) => {
      if (e.button < 3) {
        this.mouseDown[e.button] = true;
        this.mousePressed[e.button] = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button < 3) this.mouseDown[e.button] = false;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => (this.wheel += Math.sign(e.deltaY)), { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      this.onLockChange(this.locked);
    });
  }

  lock() {
    if (!this.locked) this.canvas.requestPointerLock?.()?.catch?.(() => {});
  }
  unlock() {
    if (this.locked) document.exitPointerLock();
  }

  isDown(...codes: string[]) {
    return codes.some((c) => this.down.has(c));
  }
  pressed(...codes: string[]) {
    return codes.some((c) => this.pressedSet.has(c));
  }
  released(...codes: string[]) {
    return codes.some((c) => this.releasedSet.has(c));
  }
  clicked(button = 0) {
    return this.mousePressed[button];
  }
  axis(neg: string[], pos: string[]) {
    return (this.isDown(...pos) ? 1 : 0) - (this.isDown(...neg) ? 1 : 0);
  }

  /** Call at the end of each frame. */
  endFrame() {
    this.pressedSet.clear();
    this.releasedSet.clear();
    this.mouseDX = this.mouseDY = 0;
    this.wheel = 0;
    this.mousePressed = [false, false, false];
  }
}
