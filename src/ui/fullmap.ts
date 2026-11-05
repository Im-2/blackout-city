// Full map (M): the map on the left, LOCATIONS on the right. Markers never overlap:
// minor ones merge into count badges that split as you zoom in, and anything still
// crowded is nudged aside with a leader line back to its true position.
import { HALF } from '../world/layout';
import { Place, PlaceCategory, PRIO } from '../map/places';
import { drawIcon, iconUrl, ICON_R, IconKind } from './mapicons';
import { device } from '../core/device';
import type { Game } from '../core/game';

const LABELS: [string, number, number][] = [
  ['DOWNTOWN', 20, -110], ['OLD TOWN', -225, 50], ['DOCKS', 262, 30], ['RESIDENTIAL', -60, -275],
  ['RESIDENTIAL', 0, 195], ['PARK & WATERFRONT', -30, 305], ['HARBOUR', 120, 395],
];

type Filter = 'all' | PlaceCategory;
const FILTERS: [Filter, string][] = [['all', 'ALL'], ['mission', 'MISSIONS'], ['race', 'RACES'], ['activity', 'ACTIVITIES'], ['shop', 'SHOPS'], ['home', 'HOMES'], ['service', 'SERVICES']];

const LEGEND: [IconKind, string, string, string?][] = [
  ['diamond', '#e0322a', 'Mission', 'H'], ['flag', '#ff5ad8', 'Race'], ['house', '#7dffb0', 'Home'], ['property', '#ffd24a', 'For sale', '$'], ['property', '#7dffb0', 'Owned', 'O'], ['bank', '#e6c84a', 'Bank'],
  ['shield', '#4a7cff', 'Police'], ['tower', '#c8c3b5', 'Tower'], ['ramp', '#b6ff3a', 'Stunts'], ['circle', '#5ac8c8', 'Shop', 'S'],
  ['coin', '#ffd24a', 'Fence', '$'], ['garage', '#8fb0d6', 'Garage', 'P'], ['taxi', '#d8b84a', 'Taxi'], ['metro', '#6a9fd8', 'Metro'],
  ['wheel', '#b48cff', 'Bike rack'], ['wheelpay', '#b48cff', 'Bike rental'], ['police', '#e0322a', 'Patrol car'], ['truck', '#ff8a3a', 'Intercept'], ['getaway', '#ffd24a', 'Getaway'], ['eye', '#9fe8ff', 'Tailing'], ['bolt', '#ff7ab8', 'Prank'], ['rarecar', '#e6c84a', 'Rare car'], ['hanger', '#ff9a5a', 'Clothes'], ['scissors', '#9fd0ff', 'Barber'], ['cup', '#7de0a0', 'Snacks'], ['stand', '#ffb84a', 'Food stand'], ['cluster', '#c8c3b5', 'Group', '3'],
];

/** one thing on the map after decluttering */
export interface MapItem {
  places: Place[];
  /** true position on screen */
  rx: number; ry: number;
  /** where it's drawn */
  x: number; y: number;
  r: number;
}

const fmtDist = (d: number) => (d >= 1000 ? `${(d / 1000).toFixed(1)}km` : `${Math.round(d / 5) * 5}m`);

export class FullMap {
  private el: HTMLDivElement;
  private c: HTMLCanvasElement;
  private x: CanvasRenderingContext2D;
  private tip: HTMLDivElement;
  private side: HTMLDivElement;
  private listEl!: HTMLDivElement;
  private actEl!: HTMLDivElement;
  private tabsEl!: HTMLDivElement;
  private sortEl!: HTMLButtonElement;
  private searchEl!: HTMLInputElement;
  open = false;
  private ret: 'playing' | 'paused' | 'menu' = 'playing';
  private cx = 0;
  private cz = 0;
  private zoom = 1;
  /** eased pan + zoom after picking a place */
  private fly: { x: number; z: number; zoom: number } | null = null;
  private drag: { x: number; z: number; mx: number; mz: number; moved: boolean } | null = null;
  private mouse = { x: -1, y: -1 };
  private t = 0;
  places: Place[] = [];
  /** what's on screen after decluttering: exposed so tests can check for overlaps */
  layout: MapItem[] = [];
  private shown: Place[] = [];
  private filter: Filter = 'all';
  private sortBy: 'distance' | 'type' = 'distance';
  private query = '';
  selected: string | null = null;
  private hoverRow: string | null = null;
  private hoverItem: MapItem | null = null;

  constructor(private g: Game) {
    this.el = document.createElement('div');
    this.el.className = 'fullmap';
    this.el.style.display = 'none';
    this.c = document.createElement('canvas');
    this.x = this.c.getContext('2d')!;
    this.tip = document.createElement('div');
    this.tip.className = 'map-tip';
    this.side = document.createElement('div');
    this.side.className = 'map-side';
    const help = document.createElement('div');
    help.className = 'map-help';
    help.textContent = '[DRAG] PAN · [WHEEL] ZOOM · [CLICK] SELECT OR SET WAYPOINT · [RIGHT-CLICK] CLEAR · [M] CLOSE';
    this.el.append(this.c, help, this.side, this.tip);
    g.hud.root.appendChild(this.el);
    this.buildSide();
    this.c.addEventListener('mousedown', (e) => {
      this.searchEl.blur();
      if (e.button === 0) this.drag = { x: this.cx, z: this.cz, mx: e.clientX, mz: e.clientY, moved: false };
      if (e.button === 2) { g.gps.clearWaypoint(); this.renderList(); }
    });
    addEventListener('mousemove', (e) => {
      this.mouse = { x: e.clientX, y: e.clientY };
      const d = this.drag;
      if (!d) return;
      const dx = e.clientX - d.mx, dy = e.clientY - d.mz;
      if (Math.abs(dx) + Math.abs(dy) > 4) { d.moved = true; this.fly = null; }
      this.cx = d.x - dx / this.zoom;
      this.cz = d.z - dy / this.zoom;
    });
    addEventListener('mouseup', (e) => {
      const d = this.drag;
      this.drag = null;
      if (!d || d.moved || !this.open || e.target !== this.c) return;
      this.clickMap(e.clientX, e.clientY);
    });
    this.c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.fly = null;
      const before = this.toWorld(e.clientX, e.clientY);
      this.zoom = this.clampZoom(this.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2));
      const after = this.toWorld(e.clientX, e.clientY);
      this.cx += before.x - after.x;
      this.cz += before.z - after.z;
    }, { passive: false });
    if (device.touch) this.bindTouch();
  }

  /** one finger pans, two pinch, a tap is a click */
  private bindTouch() {
    let start: { d: number; zoom: number; cx: number; cz: number; mx: number; my: number; moved: boolean; n: number } | null = null;
    const read = (e: TouchEvent) => {
      const a = e.touches[0], b = e.touches[1];
      return b ? { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), mx: (a.clientX + b.clientX) / 2, my: (a.clientY + b.clientY) / 2, n: 2 } : { d: 0, mx: a.clientX, my: a.clientY, n: 1 };
    };
    const c = this.c;
    c.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.searchEl.blur();
      this.fly = null;
      const r = read(e);
      start = { ...r, zoom: this.zoom, cx: this.cx, cz: this.cz, moved: r.n > 1 };
    }, { passive: false });
    c.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (!start || !e.touches.length) return;
      const r = read(e);
      if (r.n !== start.n) { start = { ...r, zoom: this.zoom, cx: this.cx, cz: this.cz, moved: true }; return; }
      if (Math.hypot(r.mx - start.mx, r.my - start.my) > 8) start.moved = true;
      if (r.n === 2 && start.d > 0) this.zoom = this.clampZoom(start.zoom * (r.d / start.d));
      this.cx = start.cx - (r.mx - start.mx) / this.zoom;
      this.cz = start.cz - (r.my - start.my) / this.zoom;
    }, { passive: false });
    c.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (start && !start.moved && !e.touches.length) this.clickMap(start.mx, start.my);
      if (!e.touches.length) start = null;
    }, { passive: false });
  }

  // ------------------------------------------------------------------ geometry
  private get mapW() { return Math.max(200, innerWidth - this.side.offsetWidth); }
  private get mapH() { return innerHeight; }
  private fit() { return Math.min(this.mapW, this.mapH) / (2 * (HALF + 40)); }
  private clampZoom(z: number) { return Math.max(this.fit() * 0.8, Math.min(8, z)); }
  private toWorld(sx: number, sy: number) { return { x: this.cx + (sx - this.mapW / 2) / this.zoom, z: this.cz + (sy - this.mapH / 2) / this.zoom }; }
  private sx(x: number) { return this.mapW / 2 + (x - this.cx) * this.zoom; }
  private sy(z: number) { return this.mapH / 2 + (z - this.cz) * this.zoom; }
  /** markers grow gently with zoom: readable zoomed out, never huge zoomed in */
  private get iconScale() { return Math.max(0.85, Math.min(1.3, 0.85 + 0.22 * Math.log2(this.zoom / this.fit()))); }

  // ------------------------------------------------------------------ open / close
  show(from: 'playing' | 'paused' | 'menu') {
    const g = this.g;
    this.ret = from;
    this.open = true;
    g.state = 'map';
    g.hud.show(null);
    this.el.style.display = 'block';
    this.zoom = this.fit();
    this.cx = 0;
    this.cz = 0;
    this.fly = null;
    g.input.unlock();
    this.places = g.places.list();
    this.renderList();
  }

  close() {
    const g = this.g;
    this.open = false;
    this.el.style.display = 'none';
    this.tip.style.display = 'none';
    if (this.ret === 'paused') { g.state = 'paused'; g.hud.show('pause'); }
    else if (this.ret === 'menu') { g.state = 'menu'; g.homeUi.reveal(); }
    else g.play();
  }

  // ------------------------------------------------------------------ the panel
  private buildSide() {
    const s = this.side;
    s.innerHTML = `
      <div class="ms-head">LOCATIONS<button class="ms-close">✕</button></div>
      <div class="ms-progress"></div>
      <div class="ms-tabs"></div>
      <div class="ms-tools"><input class="ms-search" placeholder="SEARCH" spellcheck="false"/><button class="ms-sort"></button><button class="ms-key">KEY</button></div>
      <div class="ms-list" tabindex="0"></div>
      <div class="ms-act"></div>
      <div class="ms-legend">${LEGEND.map(([k, col, name, tag]) => `<span><img src="${iconUrl(k, col, tag)}" alt=""/>${name}</span>`).join('')}</div>`;
    this.tabsEl = s.querySelector('.ms-tabs')!;
    this.listEl = s.querySelector('.ms-list')!;
    this.actEl = s.querySelector('.ms-act')!;
    this.sortEl = s.querySelector('.ms-sort')!;
    s.querySelector('.ms-close')!.addEventListener('click', () => this.close());
    s.querySelector('.ms-key')!.addEventListener('click', () => s.classList.toggle('show-key'));
    this.searchEl = s.querySelector('.ms-search')!;
    this.tabsEl.innerHTML = FILTERS.map(([f, name]) => `<button data-f="${f}">${name}</button>`).join('');
    this.tabsEl.addEventListener('click', (e) => {
      const f = (e.target as HTMLElement).dataset.f as Filter | undefined;
      if (f) { this.filter = f; this.renderList(); }
    });
    this.sortEl.addEventListener('click', () => { this.sortBy = this.sortBy === 'distance' ? 'type' : 'distance'; this.renderList(); });
    this.searchEl.addEventListener('input', () => { this.query = this.searchEl.value.trim().toLowerCase(); this.renderList(); });
    this.searchEl.addEventListener('keydown', (e) => { if (e.code === 'Escape' || e.code === 'Enter') this.searchEl.blur(); });
    const rowOf = (e: Event) => (e.target as HTMLElement).closest('[data-id]') as HTMLElement | null;
    this.listEl.addEventListener('click', (e) => { const r = rowOf(e); if (r) this.select(r.dataset.id!, true); });
    this.listEl.addEventListener('dblclick', (e) => { const r = rowOf(e); if (r) { this.select(r.dataset.id!, false); this.toggleGps(); } });
    this.listEl.addEventListener('mouseover', (e) => { const r = rowOf(e); this.hoverRow = r ? r.dataset.id! : null; });
    this.listEl.addEventListener('mouseleave', () => { this.hoverRow = null; });
    this.actEl.addEventListener('click', (e) => { if ((e.target as HTMLElement).dataset.gps !== undefined) this.toggleGps(); });
  }

  private get P() { return this.g.player.worldPos; }
  private dist(p: Place) { return Math.hypot(p.x - this.P.x, p.z - this.P.z); }

  private isGps(p: Place) {
    const w = this.g.gps.waypoint;
    return !!w && Math.hypot(w.x - p.x, w.z - p.z) < 1;
  }

  private filtered() {
    const q = this.query;
    const list = this.places.filter((p) => (this.filter === 'all' || p.category === this.filter) && (!q || p.name.toLowerCase().includes(q) || p.district.toLowerCase().includes(q)));
    if (this.sortBy === 'distance') list.sort((a, b) => this.dist(a) - this.dist(b));
    else list.sort((a, b) => b.prio - a.prio || a.icon.localeCompare(b.icon) || a.name.localeCompare(b.name));
    return list;
  }

  private renderList() {
    this.shown = this.filtered();
    for (const b of Array.from(this.tabsEl.children) as HTMLElement[]) b.classList.toggle('on', b.dataset.f === this.filter);
    (this.side.querySelector('.ms-progress') as HTMLElement).textContent = this.g.collection.progress;
    this.sortEl.textContent = this.sortBy === 'distance' ? 'SORT: NEAR' : 'SORT: TYPE';
    this.listEl.innerHTML = this.shown.length ? this.shown.map((p) => {
      const gps = this.isGps(p);
      return `<div class="ms-row ${p.id === this.selected ? 'sel' : ''} ${p.locked ? 'locked' : ''} ${p.done ? 'done' : ''}" data-id="${p.id}">
        <img src="${iconUrl(p.icon, p.color, p.tag)}" alt=""/>
        <div class="ms-main"><div class="ms-name">${p.name}${gps ? ' <b>GPS</b>' : ''}</div>
        <div class="ms-sub">${p.district} · ${fmtDist(this.dist(p))}</div>
        <div class="ms-status">${p.status}</div></div>
      </div>`;
    }).join('') : '<div class="ms-none">NOTHING MATCHES</div>';
    this.renderAct();
  }

  private renderAct() {
    const p = this.places.find((q) => q.id === this.selected);
    if (!p) { this.actEl.innerHTML = '<div class="ms-hint">↑↓ OR CLICK TO PICK · ENTER OR DOUBLE-CLICK FOR GPS</div>'; return; }
    this.actEl.innerHTML = `<div class="ms-desc"><b>${p.name}</b> ${p.desc}</div><button class="btn" data-gps>${this.isGps(p) ? 'CLEAR GPS [ENTER]' : 'SET GPS [ENTER]'}</button>`;
  }

  /** pick a place: highlights it, and (from the list) flies the map to it */
  private select(id: string, flyTo: boolean) {
    this.selected = id;
    const p = this.places.find((q) => q.id === id);
    this.renderAct(); // first: it changes the list's height
    for (const r of Array.from(this.listEl.children) as HTMLElement[]) {
      const on = r.dataset.id === id;
      r.classList.toggle('sel', on);
      if (on) r.scrollIntoView({ block: 'nearest' });
    }
    if (p && flyTo) this.fly = { x: p.x, z: p.z, zoom: this.clampZoom(Math.max(this.zoom, this.fit() * 2.6)) };
  }

  private toggleGps() {
    const g = this.g;
    const p = this.places.find((q) => q.id === this.selected);
    if (!p) return;
    if (this.isGps(p)) g.gps.clearWaypoint();
    else g.gps.setWaypoint(p.x, p.z);
    const y = this.listEl.scrollTop;
    this.renderList();
    this.listEl.scrollTop = y;
    g.audio.pop();
  }

  private clickMap(mx: number, my: number) {
    const g = this.g;
    const hit = this.itemAt(mx, my);
    if (hit) {
      if (hit.places.length > 1) {
        // a group: zoom in until it splits
        this.fly = { x: this.toWorld(hit.rx, hit.ry).x, z: this.toWorld(hit.rx, hit.ry).z, zoom: this.clampZoom(this.zoom * 1.9) };
        return;
      }
      const p = hit.places[0];
      if (this.filter !== 'all' && p.category !== this.filter) { this.filter = 'all'; this.renderList(); }
      this.select(p.id, false);
      return;
    }
    const w = this.toWorld(mx, my);
    if (Math.abs(w.x) < HALF + 8 && Math.abs(w.z) < HALF + 8) { g.gps.setWaypoint(w.x, w.z); this.selected = null; this.renderList(); }
  }

  private itemAt(mx: number, my: number) {
    let best: MapItem | null = null, bd = Infinity;
    for (const it of this.layout) {
      const d = Math.hypot(it.x - mx, it.y - my);
      if (d < it.r + 4 && d < bd) { bd = d; best = it; }
    }
    return best;
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number) {
    this.t += dt;
    const g = this.g, inp = g.input;
    if (inp.pressed('map', 'escape')) { this.close(); return; }
    if (inp.pressed('menuDown', 'menuUp') && this.shown.length) {
      const i = this.shown.findIndex((p) => p.id === this.selected);
      const n = this.shown.length;
      const next = i < 0 ? 0 : (i + (inp.pressed('menuDown') ? 1 : -1) + n) % n;
      this.select(this.shown[next].id, true);
    }
    if (inp.pressed('menuLeft', 'menuRight')) {
      const i = FILTERS.findIndex(([f]) => f === this.filter);
      this.filter = FILTERS[(i + (inp.pressed('menuRight') ? 1 : -1) + FILTERS.length) % FILTERS.length][0];
      this.renderList();
    }
    if (inp.pressed('confirm')) this.toggleGps();
    g.gps.update(dt); // the world is paused, but the route has to show as soon as you pick one
    if (this.fly) {
      const f = this.fly, k = 1 - Math.exp(-7 * dt);
      this.cx += (f.x - this.cx) * k;
      this.cz += (f.z - this.cz) * k;
      this.zoom += (f.zoom - this.zoom) * k;
      if (Math.abs(f.x - this.cx) + Math.abs(f.z - this.cz) < 0.5 && Math.abs(f.zoom - this.zoom) < 0.01) this.fly = null;
    }
    this.draw();
  }

  /** merge crowded minor places, then push anything still touching out of the way */
  private buildLayout() {
    const s = this.iconScale;
    const W = this.mapW, H = this.mapH;
    const focus = this.hoverRow ?? this.selected;
    const items: MapItem[] = [];
    // important places (and whatever you're looking at) stay individual; finished one-offs leave the map
    const sorted = this.places.filter((p) => !(p.missionMarker && p.done && !p.pin)).sort((a, b) => b.prio - a.prio);
    const minors: MapItem[] = [];
    for (const p of sorted) {
      const rx = this.sx(p.x), ry = this.sy(p.z);
      if (rx < -40 || ry < -40 || rx > W + 40 || ry > H + 40) continue;
      const r = (ICON_R[p.icon] + 2) * s;
      const item: MapItem = { places: [p], rx, ry, x: rx, y: ry, r };
      if (p.prio > PRIO.shop || p.id === focus) { items.push(item); continue; }
      const near = minors.find((m) => Math.hypot(m.rx - rx, m.ry - ry) < 25 * s);
      if (near) near.places.push(p);
      else minors.push(item);
    }
    for (const m of minors) {
      if (m.places.length > 1) {
        m.rx = m.places.reduce((n, p) => n + this.sx(p.x), 0) / m.places.length;
        m.ry = m.places.reduce((n, p) => n + this.sy(p.z), 0) / m.places.length;
        m.x = m.rx; m.y = m.ry;
        m.r = (ICON_R.cluster + 2) * s;
      }
      items.push(m);
    }
    // highest priority first: it keeps its place, later ones move
    const placed: MapItem[] = [];
    const px = this.sx(this.P.x), py = this.sy(this.P.z);
    const free = (x: number, y: number, r: number) => placed.every((o) => Math.hypot(o.x - x, o.y - y) >= o.r + r + 1) && Math.hypot(px - x, py - y) >= r + 11;
    for (const it of items) {
      if (!free(it.x, it.y, it.r)) {
        let done = false;
        for (let ring = 1; ring <= 14 && !done; ring++) {
          const dist = ring * (it.r + 3);
          const n = 8 + ring * 4;
          for (let k = 0; k < n; k++) {
            const a = (k / n) * Math.PI * 2 + 0.4;
            const x = it.rx + Math.cos(a) * dist, y = it.ry + Math.sin(a) * dist;
            if (free(x, y, it.r)) { it.x = x; it.y = y; done = true; break; }
          }
        }
      }
      placed.push(it);
    }
    this.layout = placed;
  }

  private draw() {
    const g = this.g, c = this.x;
    const W = this.mapW, H = this.mapH;
    if (this.c.width !== W || this.c.height !== H) { this.c.width = W; this.c.height = H; }
    c.imageSmoothingEnabled = false;
    c.fillStyle = '#16303c';
    c.fillRect(0, 0, W, H);
    const base = g.hud.mapCanvas();
    const E = g.hud.mapExtent;
    c.drawImage(base, this.sx(-E), this.sy(-E), base.width / 2 * this.zoom, base.height / 2 * this.zoom);

    // district names, faint, behind everything
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `${Math.max(16, Math.min(30, 26 * this.zoom))}px VT323, monospace`;
    c.fillStyle = 'rgba(232,226,208,0.22)';
    for (const [t, x, z] of LABELS) c.fillText(t, this.sx(x), this.sy(z));

    // route memory the police have learned
    for (const e of g.city.graph.edges) {
      const it = g.routes.intensity(e);
      if (it < 0.05) continue;
      const A = g.city.graph.nodes[e.a], B = g.city.graph.nodes[e.b];
      c.strokeStyle = `rgba(224,50,42,${it * 0.8})`;
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(this.sx(A.x), this.sy(A.z));
      c.lineTo(this.sx(B.x), this.sy(B.z));
      c.stroke();
    }

    // GPS route
    const path = g.gps.path;
    if (path.length) {
      c.strokeStyle = g.missions.run ? '#ffd24a' : '#46e6ff';
      c.lineWidth = 3;
      c.beginPath();
      path.forEach((p, i) => (i ? c.lineTo(this.sx(p.x), this.sy(p.z)) : c.moveTo(this.sx(p.x), this.sy(p.z))));
      c.stroke();
    }

    // a route a mission wants you to see (the armored truck's round)
    if (g.routeLine) {
      c.strokeStyle = 'rgba(255,138,58,0.8)';
      c.lineWidth = 2;
      c.setLineDash([6, 5]);
      c.beginPath();
      g.routeLine.forEach((p, i) => (i ? c.lineTo(this.sx(p.x), this.sy(p.z)) : c.moveTo(this.sx(p.x), this.sy(p.z))));
      c.stroke();
      c.setLineDash([]);
    }

    // patrol cars sit under the markers
    const s = this.iconScale;
    const blink = Math.sin(this.t * 12) > 0;
    for (const u of g.police.units) drawIcon(c, 'police', this.sx(u.pos.x), this.sy(u.pos.z), s, blink ? '#e0322a' : '#2b5ce0');

    this.buildLayout();
    const mx = this.mouse.x, my = this.mouse.y;
    this.hoverItem = mx < W ? this.itemAt(mx, my) : null;

    // leader lines from nudged markers back to where they really are
    c.lineWidth = 1;
    for (const it of this.layout) {
      if (it.x === it.rx && it.y === it.ry) continue;
      c.strokeStyle = 'rgba(232,226,208,0.7)';
      c.beginPath();
      c.moveTo(it.rx, it.ry);
      c.lineTo(it.x, it.y);
      c.stroke();
      c.fillStyle = '#e8e2d0';
      c.fillRect(it.rx - 1.5, it.ry - 1.5, 3, 3);
    }
    const focus = this.hoverRow ?? this.selected;
    // lowest priority first, so the important ones are on top
    for (let i = this.layout.length - 1; i >= 0; i--) {
      const it = this.layout[i];
      const p = it.places[0];
      const hot = it === this.hoverItem || it.places.some((q) => q.id === focus);
      if (it.places.length > 1) drawIcon(c, 'cluster', it.x, it.y, s, '#c8c3b5', String(it.places.length), hot);
      else drawIcon(c, p.icon, it.x, it.y, s, p.color, p.tag, hot);
    }

    // waypoint flag
    const wp = g.gps.waypoint;
    if (wp) {
      const x = this.sx(wp.x), y = this.sy(wp.z);
      c.fillStyle = '#46e6ff';
      c.fillRect(x - 1, y - 18, 2, 18);
      c.fillRect(x, y - 18, 11, 7);
    }
    // player
    const P = this.P;
    const heading = g.player.vehicle ? g.player.vehicle.heading : g.player.heading;
    c.save();
    c.translate(this.sx(P.x), this.sy(P.z));
    c.rotate(Math.PI - heading);
    c.fillStyle = '#0f141c';
    c.beginPath();
    c.moveTo(0, -13);
    c.lineTo(10, 11);
    c.lineTo(0, 6);
    c.lineTo(-10, 11);
    c.closePath();
    c.fill();
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(0, -11);
    c.lineTo(8, 9);
    c.lineTo(0, 4);
    c.lineTo(-8, 9);
    c.closePath();
    c.fill();
    c.restore();

    this.updateTip();
  }

  /** name and description for what's under the cursor or picked, placed clear of other markers */
  private updateTip() {
    const hoverP = this.hoverRow ? this.places.find((p) => p.id === this.hoverRow) : null;
    const it = this.hoverItem ?? (hoverP ? this.layout.find((l) => l.places.includes(hoverP)) ?? null : null);
    let html = '';
    if (it) {
      if (it.places.length > 1) html = `<b>${it.places.length} places here</b>${it.places.slice(0, 5).map((p) => `<br>${p.name}`).join('')}<br><i>Click or zoom in to split</i>`;
      else {
        const p = it.places[0];
        html = `<b>${p.name}</b> · ${p.district}<br>${p.desc}${p.locked ? `<br><i>${p.status}</i>` : ''}`;
      }
    }
    if (!html || !it) { this.tip.style.display = 'none'; return; }
    if (this.tip.innerHTML !== html) this.tip.innerHTML = html;
    this.tip.style.display = 'block';
    const w = this.tip.offsetWidth, h = this.tip.offsetHeight, W = this.mapW, H = this.mapH, gap = it.r + 8;
    const opts: [number, number][] = [
      [it.x + gap, it.y - h / 2], [it.x - gap - w, it.y - h / 2], [it.x - w / 2, it.y - gap - h], [it.x - w / 2, it.y + gap],
      [it.x + gap, it.y + gap], [it.x - gap - w, it.y - gap - h], [it.x + gap, it.y - gap - h], [it.x - gap - w, it.y + gap],
    ];
    let best = opts[0], bs = Infinity;
    for (const [x, y] of opts) {
      if (x < 4 || y < 4 || x + w > W - 4 || y + h > H - 4) continue;
      let covered = 0;
      for (const o of this.layout) if (o !== it && o.x + o.r > x && o.x - o.r < x + w && o.y + o.r > y && o.y - o.r < y + h) covered++;
      if (covered < bs) { bs = covered; best = [x, y]; }
    }
    this.tip.style.transform = `translate(${Math.round(best[0])}px, ${Math.round(best[1])}px)`;
  }
}
