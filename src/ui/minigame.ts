// The timed minigame: a cursor sweeps a bar, hit ACTION (or tap, or click) while
// it's in the green. Enough hits before the clock runs out wins. The world keeps
// running while you do it, and the player stands still.
import type { Game } from '../core/game';

export interface MinigameOpts {
  title: string;
  hits: number;
  time: number;
  /** sweeps per second */
  speed: number;
  /** width of the green zone, 0..1 */
  zone: number;
  onWin: () => void;
  onFail: () => void;
}

export class Minigame {
  active = false;
  private o: MinigameOpts | null = null;
  private el: HTMLDivElement;
  private cursor: HTMLElement;
  private zoneEl: HTMLElement;
  private info: HTMLElement;
  private pos = 0;
  private dir = 1;
  private zoneAt = 0.5;
  private got = 0;
  private t = 0;
  private age = 0;
  private flash = 0;

  constructor(private g: Game) {
    const el = (this.el = g.hud.addPanel('panel mg'));
    el.innerHTML = '<div class="label mg-title"></div><div class="mg-bar"><i class="mg-zone"></i><b class="mg-cur"></b></div><div class="mg-info"></div>';
    this.cursor = el.querySelector('.mg-cur')!;
    this.zoneEl = el.querySelector('.mg-zone')!;
    this.info = el.querySelector('.mg-info')!;
  }

  open(o: MinigameOpts) {
    this.o = o;
    this.active = true;
    this.got = 0;
    this.t = o.time;
    this.age = 0;
    this.pos = 0;
    this.dir = 1;
    this.moveZone();
    this.el.style.display = 'block';
    (this.el.querySelector('.mg-title') as HTMLElement).textContent = o.title;
  }

  /** stop without a verdict: the world reset, or you got cuffed */
  cancel() {
    this.active = false;
    this.o = null;
    this.el.style.display = 'none';
  }

  private moveZone() {
    const z = this.o!.zone;
    this.zoneAt = z / 2 + 0.05 + Math.random() * (0.9 - z);
    this.zoneEl.style.left = `${(this.zoneAt - z / 2) * 100}%`;
    this.zoneEl.style.width = `${z * 100}%`;
  }

  private finish(won: boolean) {
    const o = this.o!;
    this.cancel();
    if (won) o.onWin(); else o.onFail();
  }

  update(dt: number) {
    if (!this.active) return;
    const g = this.g, o = this.o!;
    if (g.player.busted || g.player.knockT > 0) { this.finish(false); return; }
    this.age += dt;
    this.t -= dt;
    this.flash -= dt;
    this.pos += this.dir * o.speed * dt;
    if (this.pos > 1) { this.pos = 2 - this.pos; this.dir = -1; }
    if (this.pos < 0) { this.pos = -this.pos; this.dir = 1; }
    this.cursor.style.left = `${this.pos * 100}%`;
    // the press that opened this mustn't count as the first hit
    if (this.age > 0.2 && g.input.pressed('interact', 'confirm', 'hackPrimary')) {
      if (Math.abs(this.pos - this.zoneAt) <= o.zone / 2) {
        this.got++;
        g.audio.unlock();
        this.flash = 0.15;
        if (this.got >= o.hits) { this.finish(true); return; }
        this.moveZone();
      } else {
        this.t -= 2;
        g.audio.deny();
        g.camRig.addShake(0.12);
      }
    }
    this.el.classList.toggle('hit', this.flash > 0);
    if (this.t <= 0) { this.finish(false); return; }
    this.info.innerHTML = `<span>${'■'.repeat(this.got)}${'□'.repeat(o.hits - this.got)}</span><em>${this.t.toFixed(1)}s</em>`;
  }
}
