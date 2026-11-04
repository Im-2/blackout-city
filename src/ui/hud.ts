// DOM HUD + screens. Pixel font, dark navy panels (art bible §6).
import * as THREE from 'three';
import { HACK_INFO, HackKind } from '../hacking/hack';
import { BLOCKS, HALF, PITCH, ROAD_HALF, SHORE, blockBounds, BANK_BLOCK, DROP_BLOCK } from '../world/layout';
import { DISTRICTS, districtOfBlock } from '../map/districts';
import { TYPE_INFO, MissionDef } from '../missions/types';
import type { Missions } from '../missions/missions';
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
  <div><b>M</b> full map · click to set a waypoint</div><div><b>Esc</b> pause · <b>R</b> retry mission</div>
  <div><b>Z</b> mute</div><div><b>Backspace</b> decline a mission</div>
  <div><b>Shift</b> in vehicle: boost</div><div><b>Hold E</b> pick a lock</div>
  <div><b>J</b> phone · <b>Enter</b> take job</div><div><b>X</b> abandon job</div>
  <div><b>E</b> at a taxi stand: fast travel</div><div><b>↑↓ Enter</b> pick a destination</div>
  <div><b>E</b> at your front door: go home</div><div><b>Sleep</b> in your bed to save</div>
</div>
<div class="ctl-sub">CLIP TOOLS: <b>0-5</b> set heat · <b>T</b> bank · <b>Y</b> drop · <b>U</b> mid-city · <b>G</b> spawn getaway car · <b>L</b> start heist's escape · <b>\`</b> unlock all · <b>B</b> bicycle · <b>N</b> motorbike · <b>V</b> next vehicle · <b>K</b> crowd · <b>[ ]</b> teleport to sites · <b>O</b> +3 hours · <b>I</b> rain · <b>F3</b> debug · <b>F4</b> quality · <code>?clip</code> URL = instant chase</div>`;

/** the HOME icon, on the minimap and the full map */
export function houseIcon(c: CanvasRenderingContext2D, x: number, y: number, s: number) {
  c.fillStyle = '#0f141c';
  c.fillRect(x - 11 * s, y - 11 * s, 22 * s, 22 * s);
  c.fillStyle = '#7dffb0';
  c.beginPath();
  c.moveTo(x, y - 10 * s);
  c.lineTo(x + 10 * s, y);
  c.lineTo(x - 10 * s, y);
  c.closePath();
  c.fill();
  c.fillRect(x - 7 * s, y, 14 * s, 9 * s);
  c.fillStyle = '#0f141c';
  c.fillRect(x - 2 * s, y + 3 * s, 4 * s, 6 * s);
}

function p2stale(g: Game) {
  const v = g.player.vehicle;
  if (v) { const k = g.police.knownVehicle; return !!k && (k.id !== v.id || k.color !== v.color); }
  return !!g.disguise.known && g.disguise.known !== g.disguise.current.id;
}

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
  private radioEl: HTMLDivElement;
  private moneyEl: HTMLDivElement;
  private jobEl: HTMLDivElement;
  private phoneEl: HTMLDivElement;
  private escEl: HTMLDivElement;
  private descEl: HTMLDivElement;
  private vehEl: HTMLDivElement;
  private lastHtml: Record<string, string> = {};
  private miniT = 0;
  private objLabel: HTMLDivElement;
  private timerEl: HTMLDivElement;
  private cardEl: HTMLDivElement;
  private taxiEl: HTMLDivElement;
  private bannerEl: HTMLDivElement;
  private bannerT = 0;
  private radioT = 0;
  private debugEl: HTMLDivElement;
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
    this.objLabel = h('div', 'label', 'FREE ROAM') as HTMLDivElement;
    obj.appendChild(this.objLabel);
    this.objective = h('div', 'obj-main') as HTMLDivElement;
    this.objSub = h('div', 'obj-sub') as HTMLDivElement;
    this.timerEl = h('div', 'm-timer') as HTMLDivElement;
    obj.append(this.objective, this.objSub, this.timerEl);
    this.moneyEl = h('div', 'money') as HTMLDivElement;
    this.jobEl = h('div', 'job') as HTMLDivElement;
    obj.append(this.moneyEl, this.jobEl);
    this.hudLayer.appendChild(obj);
    this.phoneEl = h('div', 'panel phone') as HTMLDivElement;
    this.escEl = h('div', 'panel escapes') as HTMLDivElement;
    this.taxiEl = h('div', 'panel phone taxi') as HTMLDivElement;
    this.bannerEl = h('div', 'district-banner') as HTMLDivElement;
    this.cardEl = h('div', 'panel mission-card') as HTMLDivElement;
    this.cardEl.style.display = 'none';
    this.hudLayer.append(this.phoneEl, this.escEl, this.taxiEl, this.bannerEl, this.cardEl);

    const heat = h('div', 'panel heat');
    this.heatEl = h('div', 'stars') as HTMLDivElement;
    for (let i = 0; i < 5; i++) this.heatEl.appendChild(h('div', 'star'));
    this.statusEl = h('div', 'status') as HTMLDivElement;
    this.descEl = h('div', 'desc') as HTMLDivElement;
    heat.append(h('div', 'label', 'HEAT'), this.heatEl, this.statusEl, this.descEl);
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
    this.vehEl = h('div', 'label') as HTMLDivElement;
    this.speedEl.append(this.speedNum, this.vehEl, hp);
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

    this.radioEl = h('div', 'panel radio') as HTMLDivElement;
    this.debugEl = h('div', 'debugov') as HTMLDivElement;
    this.hudLayer.append(this.radioEl);
    this.root.appendChild(this.debugEl);
    this.letterbox = h('div', 'letterbox', '<div></div><div></div>') as HTMLDivElement;
    this.root.appendChild(this.letterbox);

    // screens
    this.screens.loading = h('div', 'screen loading', `<div class="logo">BLACKOUT<span>CITY</span></div><div class="lbar"><div class="lfill"></div></div><div class="lmsg">BOOTING…</div>`) as HTMLDivElement;
    this.screens.title = h('div', 'screen title', `
      <div class="logo big">BLACKOUT<span>CITY</span></div>
      <div class="tagline">CUT THE POWER. ROB THE CITY.</div>
      <button class="btn start">NEW GAME</button>
      <button class="btn newgame">NEW GAME</button>
      ${CONTROLS}
      <div class="credits">Every texture, model and sound is generated in code.</div>`) as HTMLDivElement;
    this.screens.pause = h('div', 'screen pause', `
      <div class="logo">PAUSED</div>
      <button class="btn resume">RESUME</button>
      <button class="btn map">MAP (M)</button>
      <button class="btn restart">RETRY MISSION (R)</button>
      <button class="btn quitm">QUIT MISSION</button>
      <button class="btn mute">MUTE (Z)</button>
      <button class="btn newgame">NEW GAME</button>
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
    for (const c of Array.from(this.toasts.children)) if (c.innerHTML === text && !c.classList.contains('out')) return; // no duplicate spam
    const t = h('div', `toast ${kind}`, text);
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 3) this.toasts.firstChild!.remove();
    setTimeout(() => t.classList.add('out'), 1800);
    setTimeout(() => t.remove(), 2400);
  }

  /** big fade-in name when crossing into a new district */
  districtBanner(name: string) {
    this.bannerEl.textContent = name;
    this.bannerEl.classList.add('on');
    this.bannerT = 3;
  }

  radio(text: string) {
    this.radioEl.innerHTML = `<span class="tag">RADIO</span> ${text}`;
    this.radioEl.classList.add('on');
    this.radioT = 6;
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

  /** intro card when you step into a marker (null hides it) */
  missionCard(d: MissionDef | null) {
    this.cardEl.style.display = d ? 'block' : 'none';
    if (!d) return;
    const t = TYPE_INFO[d.type];
    this.cardEl.style.borderLeftColor = t.color;
    this.cardEl.innerHTML = `
      <div class="label" style="color:${t.color}">${t.label} · ${DISTRICTS[d.district].name}</div>
      <div class="c-title">${d.title}</div>
      <div class="c-giver">${d.giver}</div>
      <div class="c-intro">${d.intro}</div>
      <div class="label">[E] START · [BACKSPACE] NOT NOW</div>`;
  }

  /** success / fail screen */
  missionEnd(m: Missions) {
    const e = m.ended!;
    const won = e.kind === 'success';
    const rows = e.rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
    const hasCp = !!m.run && m.run.checkpoint > 0;
    this.screens.results.className = `screen results ${won ? 'won' : 'busted'}`;
    this.screens.results.innerHTML = `
      <div class="label">${TYPE_INFO[e.def.type].label}: ${e.def.title}</div>
      <div class="logo">${won ? 'MISSION PASSED' : 'MISSION FAILED'}</div>
      ${won ? '' : `<div class="tagline">${e.reason ?? ''}</div>`}
      ${won ? `<table class="stats">${rows}</table>` : ''}
      ${won ? '<button class="btn" data-act="continue">CONTINUE [ENTER]</button>' : `
        <button class="btn" data-act="checkpoint">${hasCp ? 'RETRY FROM CHECKPOINT' : 'RETRY'} [ENTER]</button>
        ${hasCp ? '<button class="btn" data-act="mission">RETRY MISSION [R]</button>' : ''}
        <button class="btn" data-act="quit">QUIT [X]</button>`}`;
    this.show('results');
  }

  mapCanvas() {
    if (!this.mapBase) this.buildMapBase();
    return this.mapBase!;
  }

  get mapExtent() {
    return HALF + 30;
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number, g: Game) {
    this.t += dt;
    const p = g.player;
    const v = p.vehicle;
    this.objLabel.textContent = g.missions.panelTitle;
    this.objective.textContent = g.missions.objective;
    this.objSub.textContent = g.missions.sub;
    const tl = g.missions.timeLeft;
    const tgt = g.missions.run ? g.missions.target() : null;
    const dist = tgt ? Math.hypot(tgt.x - g.player.worldPos.x, tgt.z - g.player.worldPos.z) : 0;
    const timeTxt = tl !== null ? `<b class="${tl < 15 ? 'low' : ''}">${Math.floor(tl / 60)}:${String(Math.floor(tl % 60)).padStart(2, '0')}</b>` : '';
    this.set(this.timerEl, 'timer', tl !== null || tgt ? `${timeTxt}${tgt ? ` <span>${Math.round(dist)}m</span>` : ''}` : '');

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
      el.style.display = cd > 0 ? 'block' : 'none';
    }

    // speed
    this.speedEl.style.display = v ? 'block' : 'none';
    if (v) {
      this.speedNum.textContent = String(Math.round(Math.abs(v.speed) * 3.6));
      this.vehEl.textContent = `KM/H · ${v.label}`;
      this.hpFill.style.width = `${v.hp}%`;
      this.hpFill.classList.toggle('low', v.hp < 35);
    }

    // prompt
    const label = g.hack.active || g.travel.open ? '' : v && g.carAction ? g.carAction.label : p.pick > 0 ? `PICKING LOCK ${'█'.repeat(Math.round(p.pick * 10))}${'░'.repeat(10 - Math.round(p.pick * 10))}` : p.focusLabel;
    this.prompt.textContent = label ? `[E] ${label}` : v && v.speedAbs < 6 ? '' : '';
    this.prompt.style.display = label ? 'block' : 'none';

    this.updateMissionPanels(g);
    this.set(this.taxiEl, 'taxi', g.travel.menuHtml());
    this.bannerT -= dt;
    if (this.bannerT <= 0) this.bannerEl.classList.remove('on');
    this.radioT -= dt;
    if (this.radioT <= 0) this.radioEl.classList.remove('on');
    this.debugEl.style.display = g.debugOverlay ? 'block' : 'none';
    if (g.debugOverlay && Math.floor(this.t * 4) !== Math.floor((this.t - dt) * 4)) {
      const i = g.renderer.info.render;
      const c = g.peds.stats;
      this.debugEl.textContent = [
        `FPS ${g.fps.toFixed(0)}  FRAME ${g.frameMs.toFixed(1)}ms (avg ${g.quality.ema.toFixed(1)})`,
        `QUALITY ${g.quality.p.name}${g.quality.auto ? ' AUTO' : ''}  [F4]`,
        `DRAW ${i.calls}  TRIS ${(i.triangles / 1000).toFixed(0)}k`,
        `CHUNKS ${g.chunks.active}/${g.chunks.total}  VIEW ${g.quality.p.view}m  ${DISTRICTS[g.chunks.district].name.toUpperCase()}`,
        `PEDS ${c.total}  FULL ${c.full}  GHOST ${c.ghost}  CALLING ${c.calling}`,
        `VEHICLES ${g.vehicles.length}  TRAFFIC ${g.traffic.cars.length}  COPS ${g.police.units.length}  OFFICERS ${g.police.officers.length}`,
        `HEAT ${g.police.heat} (${g.police.progress.toFixed(2)})  UNSEEN ${g.police.lastSeenT.toFixed(1)}s`,
        `POS ${g.player.worldPos.x.toFixed(0)},${g.player.worldPos.z.toFixed(0)}`,
      ].join('\n');
    }
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
    // 15 Hz is plenty for the minimap and it's the HUD's costliest piece
    this.miniT -= dt;
    if (this.miniT <= 0) { this.miniT = 1 / 15; this.drawMinimap(g); }
  }

  private set(el: HTMLElement, key: string, html: string) {
    if (this.lastHtml[key] !== html) { el.innerHTML = html; this.lastHtml[key] = html; }
    el.style.display = html ? 'block' : 'none';
  }

  /** cash, job tracker, fixer phone, escape options, police description */
  private updateMissionPanels(g: Game) {
    const carried = g.loot.carriedValue;
    this.set(this.moneyEl, 'money', `$${g.loot.cash.toLocaleString()}${carried ? ` <span>· CARRYING $${carried.toLocaleString()}</span>` : ''}`);
    const a = g.jobs.active;
    this.set(this.jobEl, 'job', a ? `<b>JOB: ${a.title}</b> ${Math.ceil(a.t)}s · ${a.done.filter(Boolean).length}/${a.done.length} <i>[X] abandon</i>` : g.missions.run ? '' : '<i>[M] MAP · [J] FIXER JOBS</i>');
    if (g.jobs.phoneOpen) {
      const rows = g.jobs.offers.map((o, i) => `<div class="${i === g.jobs.offer ? 'sel' : ''}">${i === g.jobs.offer ? '▶' : '&nbsp;'} ${o.title} <em>$${o.pay.toLocaleString()}</em></div>`).join('');
      this.set(this.phoneEl, 'phone', `<div class="label">FIXER</div>${rows}<div class="brief">${g.jobs.offers[g.jobs.offer].brief}</div><div class="label">[J] NEXT · [ENTER] TAKE IT · [BACKSPACE] CLOSE</div>`);
    } else this.set(this.phoneEl, 'phone', '');
    const opts = g.police.heat > 0 ? g.escapes.options() : [];
    this.set(this.escEl, 'esc', opts.length ? `<div class="label">ESCAPE OPTIONS</div>${opts.map((o) => `<div>${o.label} <em>${Math.round(o.d / 5) * 5}m</em></div>`).join('')}` : '');
    let desc = '';
    if (g.police.heat > 0) {
      const stale = p2stale(g);
      desc = stale ? `<span class="stale">DESCRIPTION OUT OF DATE</span>` : `SEEKING: ${g.news.description()}`;
    }
    this.set(this.descEl, 'desc', desc);
  }

  private updateMarker(g: Game) {
    const tgt = g.missionTarget();
    const P = g.player.worldPos;
    const m = this.marker;
    if (!tgt || g.missions.ended) { m.style.display = 'none'; return; }
    const d = Math.hypot(tgt.x - P.x, tgt.z - P.z);
    if (d < 3) { m.style.display = 'none'; return; }
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
    x.fillStyle = '#16303c'; // the harbour
    x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#1b2029';
    x.fillRect(0, 0, (E + SHORE) * S, (E + SHORE) * S);
    x.fillStyle = '#3a3e45';
    x.fillRect((E - HALF - ROAD_HALF) * S, (E - HALF - ROAD_HALF) * S, (HALF + ROAD_HALF) * 2 * S, (HALF + ROAD_HALF) * 2 * S);
    for (let bj = 0; bj < BLOCKS; bj++)
      for (let bi = 0; bi < BLOCKS; bi++) {
        const b = blockBounds(bi, bj);
        const isBank = bi === BANK_BLOCK[0] && bj === BANK_BLOCK[1];
        const isDrop = bi === DROP_BLOCK[0] && bj === DROP_BLOCK[1];
        x.fillStyle = isBank ? '#4a5a3a' : isDrop ? '#5a4a2a' : DISTRICTS[districtOfBlock(bi, bj)].map;
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
    // only the part of the big map around the player
    const R = Math.ceil((W * 0.8) / zoom), sx = Math.round((P.x + E) * S), sz = Math.round((P.z + E) * S);
    c.drawImage(this.mapBase!, sx - R, sz - R, R * 2, R * 2, -R, -R, R * 2, R * 2);
    // route memory heat on edges
    const pulse = 0.5 + Math.sin(this.t * 5) * 0.5;
    for (const e of g.city.graph.edges) {
      const it = g.routes.intensity(e);
      const watched = g.police.watched.includes(e.name) && g.police.heat > 0;
      if (it < 0.05 && !watched) continue;
      const A = g.city.graph.nodes[e.a], B = g.city.graph.nodes[e.b];
      if (Math.abs((A.x + B.x) / 2 - P.x) > 170 || Math.abs((A.z + B.z) / 2 - P.z) > 170) continue;
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
    // GPS route line
    const path = g.gps.path;
    if (path.length) {
      c.strokeStyle = g.missions.run ? '#ffd24a' : '#46e6ff';
      c.lineWidth = 4 / zoom;
      c.beginPath();
      path.forEach((p, i) => (i ? c.lineTo((p.x - P.x) * S, (p.z - P.z) * S) : c.moveTo((p.x - P.x) * S, (p.z - P.z) * S)));
      c.stroke();
    }
    // things pinned to the edge of the minimap when out of range
    const pin = (x: number, z: number) => {
      let dx = (x - P.x) * S, dz = (z - P.z) * S;
      const L = Math.hypot(dx, dz), max = 88 / zoom;
      if (L > max) { dx *= max / L; dz *= max / L; }
      return [dx, dz];
    };
    // mission markers, coloured by type (grey = locked; hidden while on a mission)
    if (!g.missions.run) {
      for (const d of g.missions.defs) {
        const st = g.missions.status(d);
        if (st === 'done') continue;
        const [mx, mz] = pin(d.marker.x, d.marker.z);
        c.save();
        c.translate(mx, mz);
        c.rotate(-(Math.PI + yaw)); // keep icons upright
        c.scale(1 / zoom, 1 / zoom);
        c.fillStyle = '#0f141c';
        c.fillRect(-9, -9, 18, 18);
        c.fillStyle = st === 'locked' ? '#6a6f78' : TYPE_INFO[d.type].color;
        c.fillRect(-7, -7, 14, 14);
        c.fillStyle = '#0a1218';
        c.font = '14px VT323, monospace';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(TYPE_INFO[d.type].tag, 0, 1);
        c.restore();
      }
    }
    // home, always pinned on the map
    const [hx, hz] = pin(-28, 46);
    c.save();
    c.translate(hx, hz);
    c.rotate(-(Math.PI + yaw));
    c.scale(1 / zoom, 1 / zoom);
    houseIcon(c, 0, 0, 0.8);
    c.restore();
    // current target
    const t = g.missionTarget();
    if (t) {
      const [tx, tz] = pin(t.x, t.z);
      c.fillStyle = g.missions.run || g.jobs.active ? '#ffd24a' : '#46e6ff';
      c.save();
      c.translate(tx, tz);
      c.rotate(Math.PI / 4);
      c.fillRect(-6 / zoom, -6 / zoom, 12 / zoom, 12 / zoom);
      c.restore();
    }
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
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    c.fillText('N', nx - 4, ny + 5);
  }
}
