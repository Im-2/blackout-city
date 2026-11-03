import './style.css';
import { Game } from './core/game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(canvas);
game.init().catch((e) => {
  console.error(e);
  const ui = document.getElementById('ui')!;
  ui.innerHTML = `<div class="screen loading" style="display:flex"><div class="logo">BLACKOUT<span>CITY</span></div><div class="lmsg">FAILED TO START: ${String(e?.message ?? e)}</div></div>`;
});
// handy for debugging from the console
(window as unknown as { game: Game }).game = game;
