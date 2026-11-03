// DOM HUD + screens. Pixel font, dark navy panels (art bible §6).
import * as THREE from 'three';
import { HACK_INFO, HackKind } from '../hacking/hack';
import { BLOCKS, HALF, PITCH, ROAD_HALF, blockBounds, BANK_BLOCK, DROP_BLOCK } from '../world/layout';
import type { Game } from '../core/game';

const h = (tag: string, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

const CONTROLS = `
<div class="ctl-grid">
  <div><b>WASD</b> move / drive</div><div><b>Mouse</b> look</div>
  <div><b>Shift</b> run</div><div><b>Space</b> vault / handbrake</div>
  <div><b>E</b> interact · enter / exit car</div><div><b>C</b> car camera</div>
  <div><b>Hold Q</b> or <b>Tab</b> hacker mode</div><div><b>LMB / E</b> hack · <b>RMB</b> all-red</div>
  <div><b>H</b> toggle HUD</div><div><b>F2</b> photo / clip mode</div>
  <div><b>M</b> mute</div><div><b>Esc</b> pause · <b>R</b> restart</div>
</div>
<div class="ctl-sub">CLIP TOOLS: <b>0-5</b> set heat · <b>T</b> bank · <b>Y</b> drop · <b>U</b> mid-city · <b>G</b> spawn getaway car · <b>L</b> give loot · <code>?clip</code> URL = instant chase</div>`;

export class Hud {
  root: HTMLDivElement;
  private hudLayer: HTMLDivElement;
  private objective: HTMLDivElement;
  private objSub: HTMLDivElement;
  private heatEl: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private energyFill: HTMLDivElement;
  private energyText: HTMLDivElement;
  private cdEls: Record<string, HTMLDivElement> = {};
  private speedEl: HTMLDivElement;
  private speedNum: HTMLDivElement;
  private hpFill: HTMLDivElement;
  private prompt: HTMLDivElement;
  private toasts: HTMLDivElement;
  private hintEl: HTMLDivElement;
  private hintT = 0;
  private bustEl: HTMLDivElement;
  private susEl: HTMLDivElement;
  private marker: HTMLDivElement;
  private crosshair: HTMLDivElement;
  private mini: HTMLCanvasElement;
  private miniCtx: CanvasRenderingContext2D;
  private mapBase: HTMLCanvasElement | null = null;
  private letterbox: HTMLDivElement;
  screens: Record<string, HTMLDivElement> = {};
  visible = true;
  photo = false;
  private v = new THREE.Vector3();
  private t = 0;

  constructor() {
    this.root = document.getElementById('ui') as HTMLDivElement;
    this.hudLayer = h('div', 'hud') as HTMLDivElement;
    this.root.appendChild(this.hudLayer);

    const obj = h('div', 'panel objective');
    obj.appendChild(h('div', 'label', 'OBJECTIVE'));
    this.objective = h('div', 'obj-main') as HTMLDivElement;
    this.objSub = h('div', 'obj-sub') as HTMLDivElement;
    obj.append(this.objective, this.objSub);
    this.hudLayer.appendChild(obj);

    const heat = h('div', 'panel heat');
    this.heatEl = h('div', 'stars') as HTMLDivElement;
    for (let i = 0; i < 5; i++) this.heatEl.appendChild(h('div', 'star'));
    this.statusEl = h('div', 'status') as HTMLDivElement;
    heat.append(h('div', 'label', 'HEAT'), this.heatEl, this.statusEl);
    this.hudLayer.appendChild(heat);

    const en = h('div', 'panel energy');
    this.energyText = h('div', 'label', 'HACK ENERGY') as HTMLDivElement;
    const bar = h('div', 'bar');
    this.energyFill = h('div', 'fill') as HTMLDivElement;
    bar.appendChild(this.energyFill);
    const cds = h('div', 'cds');
    for (const k of Object.keys(HACK_INFO) as HackKind[]) {
      const c = h('div', 'cd', `<span>${HACK_INFO[k].tag}</span><i></i>`) as HTMLDivElement;
      this.cdEls[k] = c;
      cds.appendChild(c);
    }
    en.append(this.energyText, bar, cds, h('div', 'hint-q', 'HOLD <b>Q</b> TO HACK'));
    this.hudLayer.appendChild(en);

    this.speedEl = h('div', 'panel speed') as HTMLDivElement;
    this.speedNum = h('div', 'num') as HTMLDivElement;
    const hp = h('div', 'bar hp');
    this.hpFill = h('div', 'fill') as HTMLDivElement;
    hp.appendChild(this.hpFill);
    this.speedEl.append(this.speedNum, h('div', 'label', 'KM/H'), hp);
    this.hudLayer.appendChild(this.speedEl);

    this.mini = document.createElement('canvas');
    this.mini.width = this.mini.height = 200;
    this.mini.className = 'panel minimap';
    this.miniCtx = this.mini.getContext('2d')!;
    this.hudLayer.appendChild(this.mini);

    this.prompt = h('div', 'prompt') as HTMLDivElement;
    this.toasts = h('div', 'toasts') as HTMLDivElement;
    this.hintEl = h('div', 'panel hintbox') as HTMLDivElement;
    this.bustEl = h('div', 'bust', '<div class="ring"></div><div class="txt">BUSTED</div>') as HTMLDivElement;
    this.susEl = h('div', 'sus', '<div class="txt">SUSPICION</div><div class="bar"><div class="fill"></div></div>') as HTMLDivElement;
    this.marker = h('div', 'marker', '<div class="dia"></div><div class="dist"></div>') as HTMLDivElement;
    this.crosshair = h('div', 'crosshair') as HTMLDivElement;
    this.hudLayer.append(this.prompt, this.toasts, this.hintEl, this.bustEl, this.susEl, this.marker, this.crosshair);

    this.letterbox = h('div', 'letterbox', '<div></div><div></div>') as HTMLDivElement;
    this.root.appendChild(this.letterbox);

    // screens
    this.screens.loading = h('div', 'screen loading', `<div class="logo">BLACKOUT<span>CITY</span></div><div class="lbar"><div class="lfill"></div></div><div class="lmsg">BOOTING…</div>`) as HTMLDivElement;
    this.screens.title = h('div', 'screen title', `
      <div class="logo big">BLACKOUT<span>CITY</span></div>
      <div class="tagline">CUT THE POWER. ROB THE CITY.</div>
      <button class="btn start">CLICK TO START</button>
      ${CONTROLS}
      <div class="credits">Every texture, model and sound is generated in code.</div>`) as HTMLDivElement;
    this.screens.pause = h('div', 'screen pause', `
      <div class="logo">PAUSED</div>
      <button class="btn resume">RESUME</button>
      <button class="btn restart">RESTART (R)</button>
      <button class="btn mute">MUTE (M)</button>
      <button class="btn forget">CLEAR POLICE ROUTE MEMORY</button>
      ${CONTROLS}`) as HTMLDivElement;
    this.screens.results = h('div', 'screen results', '') as HTMLDivElement;
    for (const s of Object.values(this.screens)) { s.style.display = 'none'; this.root.appendChild(s); }
  }

  show(name: string | null) {
    for (const [k, s] of Object.entries(this.screens)) s.style.display = k === name ? 'flex' : 'none';
  }

  loading(p: number, msg: string) {
    const s = this.screens.loading;
    (s.querySelector('.lfill') as HTMLDivElement).style.width = `${Math.round(p * 100)}%`;
    (s.querySelector('.lmsg') as HTMLDivElement).textContent = msg.toUpperCase();
  }

  toast(text: string, kind: 'hack' | 'heat' | 'cool' | 'dim' | 'win' = 'hack') {
    const t = h('div', `toast ${kind}`, text);
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 3) this.toasts.firstChild!.remove();
    setTimeout(() => t.classList.add('out'), 1800);
    setTimeout(() => t.remove(), 2400);
  }

  hint(text: string) {
    this.hintEl.innerHTML = `<span class="eye">◉</span> ${text}`;
    this.hintEl.classList.add('on');
    this.hintT = 6;
  }

  setVisible(v: boolean) {
    this.visible = v;
    this.root.classList.toggle('hud-hidden', !v);
  }

  setPhoto(on: boolean) {
    this.photo = on;
    this.root.classList.toggle('photo', on);
  }

  results(g: Game) {
    const s = g.heist.stats;
    const o = g.heist.outcome!;
    const title = o === 'won' ? 'CLEAN GETAWAY' : o === 'busted' ? 'BUSTED' : 'WRECKED';
    const sub = o === 'won' ? 'The city never saw you coming.' : o === 'busted' ? 'Cuffed on the pavement. Try another route.' : 'The getaway car gave up. So did you.';
    const mm = Math.floor(s.time / 60), ss = Math.floor(s.time % 60).toString().padStart(2, '0');
    const learned = g.routes.topStreets(3).map((r) => r.name.toUpperCase()).join(' · ') || '—';
    this.screens.results.className = `screen results ${o}`;
    this.screens.results.innerHTML = `
      <div class="logo">${title}</div>
      <div class="tagline">${sub}</div>
      <table class="stats">
        <tr><td>TIME</td><td>${mm}:${ss}</td></tr>
        <tr><td>LOOT</td><td>$${s.loot.toLocaleString()}</td></tr>
        <tr><td>HEAT PEAK</td><td>${'★'.repeat(s.heatPeak)}${'☆'.repeat(5 - s.heatPeak)}</td></tr>
        <tr><td>HACKS USED</td><td>${s.hacks}</td></tr>
        <tr><td>SILENT ENTRY</td><td>${s.alarmBeforeLoot ? 'NO' : 'YES +$50,000'}</td></tr>
        <tr><td>POLICE NOW WATCH</td><td>${learned}</td></tr>
      </table>
      <button class="btn restart">PRESS R TO RESTART</button>`;
    this.show('results');
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number, g: Game) {
    this.t += dt;
    const p = g.player;
    const v = p.vehicle;
    this.objective.textContent = g.heist.objective;
    this.objSub.textContent = g.heist.sub;

    // heat
    const pol = g.police;
    const stars = this.heatEl.children;
    const flash = pol.status === 'pursuit' && Math.sin(this.t * 10) > 0;
    for (let i = 0; i < 5; i++) {
      const s = stars[i] as HTMLDivElement;
      s.className = 'star' + (i < pol.heat ? (flash ? (i % 2 ? ' on red' : ' on blue') : ' on') : '') + (i === pol.heat && pol.heat < 5 ? ' prog' : '');
      if (i === pol.heat && pol.heat < 5) s.style.setProperty('--p', `${Math.max(0, pol.progress) * 100}%`);
    }
    this.statusEl.textContent = pol.status === 'pursuit' ? 'PURSUIT' : pol.status === 'search' ? `SEARCHING · UNSEEN ${Math.min(99, pol.lastSeenT).toFixed(0)}s` : g.heist.alarm ? 'ALARM' : 'CLEAR';
    this.statusEl.className = 'status ' + pol.status;

    // energy
    const e = g.hack.energy;
    this.energyFill.style.width = `${e}%`;
    this.energyFill.classList.toggle('low', e < 20);
    for (const k of Object.keys(HACK_INFO) as HackKind[]) {
      const cd = g.hack.cooldowns[k] / HACK_INFO[k].cd;
      const el = this.cdEls[k];
      (el.querySelector('i') as HTMLElement).style.height = `${cd * 100}%`;
      el.classList.toggle('afford', e >= HACK_INFO[k].cost);
    }

    // speed
    this.speedEl.style.display = v ? 'block' : 'none';
    if (v) {
      this.speedNum.textContent = String(Math.round(Math.abs(v.speed) * 3.6));
      this.hpFill.style.width = `${v.hp}%`;
      this.hpFill.classList.toggle('low', v.hp < 35);
    }

    // prompt
    const label = g.hack.active ? '' : p.focusLabel;
    this.prompt.textContent = label ? `[E] ${label}` : v && v.speedAbs < 6 ? '' : '';
    this.prompt.style.display = label ? 'block' : 'none';

    // hints
    this.hintT -= dt;
    if (this.hintT <= 0) this.hintEl.classList.remove('on');

    // bust ring
    this.bustEl.style.display = pol.bust > 0.01 && !p.busted ? 'flex' : 'none';
    (this.bustEl.querySelector('.ring') as HTMLDivElement).style.setProperty('--p', `${pol.bust * 100}%`);

    // suspicion
    const sus = g.heist.suspicion;
    this.susEl.style.display = sus > 0.01 && !g.heist.alarm ? 'block' : 'none';
    (this.susEl.querySelector('.fill') as HTMLDivElement).style.width = `${sus * 100}%`;

    // crosshair
    this.crosshair.style.display = g.hack.active ? 'block' : 'none';
    this.crosshair.classList.toggle('locked', !!g.hack.selected);

    this.updateMarker(g);
    this.drawMinimap(g);
  }

  private updateMarker(g: Game) {
    const tgt = g.heist.target;
    const P = g.player.worldPos;
    const d = Math.hypot(tgt.x - P.x, tgt.z - P.z);
    const m = this.marker;
    if (g.heist.outcome || d < 3) { m.style.display = 'none'; return; }
    m.style.display = 'block';
    this.v.copy(tgt).project(g.camera);
    const W = innerWidth, H = innerHeight;
    let x = (this.v.x * 0.5 + 0.5) * W, y = (-this.v.y * 0.5 + 0.5) * H;
    const behind = this.v.z > 1;
    const pad = 46;
    const off = behind || x < pad || x > W - pad || y < pad || y > H - pad;
    if (off) {
      // pin to the screen edge in the target's direction
      let dx = this.v.x, dy = -this.v.y;
      if (behind) { dx = -dx; dy = -dy; }
      const ang = Math.atan2(dy, dx);
      const cx = W / 2, cy = H / 2;
      const r = Math.min(cx - pad, cy - pad) / Math.max(Math.abs(Math.cos(ang)) * Math.min(cx - pad, cy - pad) / (cx - pad), Math.abs(Math.sin(ang)) * Math.min(cx - pad, cy - pad) / (cy - pad));
      x = cx + Math.cos(ang) * r;
      y = cy + Math.sin(ang) * r;
      m.classList.add('edge');
      (m.querySelector('.dia') as HTMLDivElement).style.transform = `rotate(${ang + Math.PI / 2}rad)`;
    } else {
      m.classList.remove('edge');
      (m.querySelector('.dia') as HTMLDivElement).style.transform = '';
    }
    m.style.transform = `translate(${x | 0}px, ${y | 0}px)`;
    (m.querySelector('.dist') as HTMLDivElement).textContent = `${Math.round(d)}m`;
  }

  // ------------------------------------------------------------------ minimap
  private buildMapBase() {
    const S = 2; // px per metre
    const E = HALF + 30;
    const c = document.createElement('canvas');
    c.width = c.height = Math.ceil(E * 2 * S);
    const x = c.getContext('2d')!;
    x.fillStyle = '#1b2029';
    x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#3a3e45';
    x.fillRect((E - HALF - ROAD_HALF) * S, (E - HALF - ROAD_HALF) * S, (HALF + ROAD_HALF) * 2 * S, (HALF + ROAD_HALF) * 2 * S);
    for (let bj = 0; bj < BLOCKS; bj++)
      for (let bi = 0; bi < BLOCKS; bi++) {
        const b = blockBounds(bi, bj);
        const isBank = bi === BANK_BLOCK[0] && bj === BANK_BLOCK[1];
        const isDrop = bi === DROP_BLOCK[0] && bj === DROP_BLOCK[1];
        x.fillStyle = isBank ? '#4a5a3a' : isDrop ? '#5a4a2a' : '#262b33';
        x.fillRect((b.x0 + E) * S, (b.z0 + E) * S, (b.x1 - b.x0) * S, (b.z1 - b.z0) * S);
      }
    this.mapBase = c;
    void PITCH;
  }

  private drawMinimap(g: Game) {
    if (!this.mapBase) this.buildMapBase();
    const c = this.miniCtx;
    const W = 200, S = 2, E = HALF + 30;
    const P = g.player.worldPos;
    const yaw = g.camRig.yaw;
    c.save();
    c.fillStyle = '#10141b';
    c.fillRect(0, 0, W, W);
    c.translate(W / 2, W / 2);
    // camera-up: rotate so the view direction points up
    c.rotate(Math.PI + yaw);
    c.scale(1, 1);
    const zoom = g.player.vehicle ? 0.55 : 0.85;
    c.scale(zoom, zoom);
    c.drawImage(this.mapBase!, (-P.x - E) * S, (-P.z - E) * S);
    // route memory heat on edges
    const pulse = 0.5 + Math.sin(this.t * 5) * 0.5;
    for (const e of g.city.graph.edges) {
      const it = g.routes.intensity(e);
      const watched = g.police.watched.includes(e.name) && g.police.heat > 0;
      if (it < 0.05 && !watched) continue;
      const A = g.city.graph.nodes[e.a], B = g.city.graph.nodes[e.b];
      c.strokeStyle = watched ? `rgba(255,${60 + pulse * 60},40,${0.5 + it * 0.5})` : `rgba(224,50,42,${it * 0.85})`;
      c.lineWidth = (watched ? 7 : 5) / zoom;
      c.beginPath();
      c.moveTo((A.x - P.x) * S, (A.z - P.z) * S);
      c.lineTo((B.x - P.x) * S, (B.z - P.z) * S);
      c.stroke();
    }
    // blackouts
    for (const b of g.hack.blackouts) {
      c.fillStyle = `rgba(70,230,255,${0.18 * b.s})`;
      c.beginPath();
      c.arc((b.x - P.x) * S, (b.z - P.z) * S, b.r * S, 0, Math.PI * 2);
      c.fill();
    }
    // drop + bank markers
    const dz = g.city.dropZone;
    c.fillStyle = '#ffb000';
    c.fillRect((dz.x - P.x) * S - 8, (dz.z - P.z) * S - 8, 16, 16);
    c.fillStyle = '#9fb06a';
    c.fillRect((-84 - P.x) * S - 7, (-27 - P.z) * S - 7, 14, 14);
    // cops
    const blink = Math.sin(this.t * 12) > 0;
    for (const u of g.police.units) {
      c.fillStyle = blink ? '#e0322a' : '#2b5ce0';
      c.fillRect((u.pos.x - P.x) * S - 5, (u.pos.z - P.z) * S - 5, 10, 10);
    }
    for (const o of g.police.officers) {
      c.fillStyle = '#7aa0ff';
      c.fillRect((o.pos.x - P.x) * S - 3, (o.pos.z - P.z) * S - 3, 6, 6);
    }
    if (g.police.heli) {
      c.strokeStyle = '#ffe8a0';
      c.lineWidth = 2 / zoom;
      c.beginPath();
      c.arc((g.police.heli.spotPos.x - P.x) * S, (g.police.heli.spotPos.z - P.z) * S, 13, 0, Math.PI * 2);
      c.stroke();
    }
    // objective
    const t = g.heist.target;
    c.fillStyle = '#ffd24a';
    c.save();
    c.translate((t.x - P.x) * S, (t.z - P.z) * S);
    c.rotate(Math.PI / 4);
    c.fillRect(-6, -6, 12, 12);
    c.restore();
    c.restore();
    // player arrow (always up)
    c.fillStyle = '#46e6ff';
    c.beginPath();
    const heading = (g.player.vehicle ? g.player.vehicle.heading : g.player.heading) - yaw;
    c.save();
    c.translate(W / 2, W / 2);
    c.rotate(-heading);
    c.moveTo(0, -9);
    c.lineTo(6, 7);
    c.lineTo(0, 3);
    c.lineTo(-6, 7);
    c.closePath();
    c.fill();
    c.restore();
    // north tick
    c.fillStyle = '#c8c3b5';
    c.font = '16px VT323, monospace';
    const na = Math.PI + yaw;
    const nx = W / 2 + Math.sin(-na) * 84 * -1, ny = W / 2 - Math.cos(na) * 84;
    c.fillText('N', nx - 4, ny + 5);
  }
}
