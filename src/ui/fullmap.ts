// Full map (M): zoom, pan, districts, mission markers, places, police, GPS route.
// Click sets a waypoint, right-click clears it.
import { HALF } from '../world/layout';
import { TYPE_INFO } from '../missions/types';
import { houseIcon } from './hud';
import type { Game } from '../core/game';

const LABELS: [string, number, number][] = [
  ['DOWNTOWN', 20, -110], ['OLD TOWN', -225, 50], ['DOCKS', 262, 30], ['RESIDENTIAL', -60, -275],
  ['RESIDENTIAL', 0, 195], ['PARK & WATERFRONT', -30, 305], ['HARBOUR', 120, 395],
];

const PLACES: [string, string, number, number, string][] = [
  ['G', 'Your garage: park a stolen car to keep it', -39.75, 47, '#7dffb0'],
  ['$', 'Pawn & Loan (fence)', -16.7, 10, '#ffd24a'],
  ['S', 'Mart 24', -40.5, 10, '#c8c3b5'],
  ['S', 'Gems & Co', -28, 10, '#c8a8d8'],
  ['P', 'Parking garage (respray)', 11, 84, '#8fb0d6'],
  ['P', 'Old Garage (drop)', 125, 141, '#8fb0d6'],
  ['COP', 'Police station', 84, 11, '#2b5ce0'],
  ['T', 'Vantage Tower', 28, 14, '#c8c3b5'],
];

export class FullMap {
  private el: HTMLDivElement;
  private c: HTMLCanvasElement;
  private x: CanvasRenderingContext2D;
  private tip: HTMLDivElement;
  private legend: HTMLDivElement;
  open = false;
  private ret: 'playing' | 'paused' | 'menu' = 'playing';
  private cx = 0;
  private cz = 0;
  private zoom = 1;
  private drag: { x: number; z: number; mx: number; mz: number; moved: boolean } | null = null;
  private mouse = { x: -1, y: -1 };
  private t = 0;

  constructor(private g: Game) {
    this.el = document.createElement('div');
    this.el.className = 'fullmap';
    this.el.style.display = 'none';
    this.c = document.createElement('canvas');
    this.x = this.c.getContext('2d')!;
    this.tip = document.createElement('div');
    this.tip.className = 'map-tip';
    this.legend = document.createElement('div');
    this.legend.className = 'panel map-legend';
    const help = document.createElement('div');
    help.className = 'map-help';
    help.textContent = '[DRAG] PAN · [WHEEL] ZOOM · [CLICK] SET WAYPOINT · [RIGHT-CLICK] CLEAR · [M] CLOSE';
    this.el.append(this.c, this.tip, this.legend, help);
    g.hud.root.appendChild(this.el);
    this.c.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.drag = { x: this.cx, z: this.cz, mx: e.clientX, mz: e.clientY, moved: false };
      if (e.button === 2) { g.gps.clearWaypoint(); }
    });
    addEventListener('mousemove', (e) => {
      this.mouse = { x: e.clientX, y: e.clientY };
      const d = this.drag;
      if (!d) return;
      const dx = e.clientX - d.mx, dy = e.clientY - d.mz;
      if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
      this.cx = d.x - dx / this.zoom;
      this.cz = d.z - dy / this.zoom;
    });
    addEventListener('mouseup', (e) => {
      const d = this.drag;
      this.drag = null;
      if (!d || d.moved || !this.open || e.target !== this.c) return;
      const w = this.toWorld(e.clientX, e.clientY);
      if (Math.abs(w.x) < HALF + 8 && Math.abs(w.z) < HALF + 8) g.gps.setWaypoint(w.x, w.z);
    });
    this.c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const before = this.toWorld(e.clientX, e.clientY);
      this.zoom = Math.max(this.fit() * 0.8, Math.min(8, this.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
      const after = this.toWorld(e.clientX, e.clientY);
      this.cx += before.x - after.x;
      this.cz += before.z - after.z;
    }, { passive: false });
  }

  private fit() {
    return Math.min(innerWidth, innerHeight) / (2 * (HALF + 40));
  }

  private toWorld(sx: number, sy: number) {
    return { x: this.cx + (sx - innerWidth / 2) / this.zoom, z: this.cz + (sy - innerHeight / 2) / this.zoom };
  }

  private sx(x: number) { return innerWidth / 2 + (x - this.cx) * this.zoom; }
  private sy(z: number) { return innerHeight / 2 + (z - this.cz) * this.zoom; }

  show(from: 'playing' | 'paused' | 'menu') {
    const g = this.g;
    this.ret = from;
    this.open = true;
    g.state = 'map';
    g.hud.show(null);
    this.el.style.display = 'block';
    this.c.width = innerWidth;
    this.c.height = innerHeight;
    this.zoom = this.fit();
    this.cx = 0;
    this.cz = 0;
    g.input.unlock();
    this.fillLegend();
  }

  close() {
    const g = this.g;
    this.open = false;
    this.el.style.display = 'none';
    if (this.ret === 'paused') { g.state = 'paused'; g.hud.show('pause'); }
    else if (this.ret === 'menu') { g.state = 'menu'; g.homeUi.reveal(); }
    else g.play();
  }

  private fillLegend() {
    const g = this.g;
    const rows = g.missions.defs.map((d) => {
      const st = g.missions.status(d);
      const col = st === 'locked' ? '#6a6f78' : TYPE_INFO[d.type].color;
      const done = g.save.data.completed[d.id];
      return `<div class="row"><i style="background:${col}"></i>${d.title}${done ? ' ✓' : ''}${st === 'locked' ? ' <em>LOCKED</em>' : ''}</div>`;
    }).join('');
    const types = Object.values(TYPE_INFO).map((t) => `<span style="color:${t.color}">■ ${t.label}</span>`).join(' ');
    const places = g.activities.spots.filter((s) => s.pin || s.tag === 'J').map((s) => `<div class="row"><i style="background:${g.activities.iconColor(s)}"></i>${s.name}</div>`).join('');
    this.legend.innerHTML = `<div class="label">MISSIONS + RACES</div>${rows}<div class="label" style="margin-top:6px">STUNT SPOTS</div>${places}<div class="label" style="margin-top:6px">TYPES</div><div class="types">${types}</div>`;
  }

  update(dt: number) {
    this.t += dt;
    const g = this.g;
    if (g.input.pressed('map', 'escape')) { this.close(); return; }
    this.draw();
  }

  private box(x: number, y: number, label: string, col: string) {
    const c = this.x;
    c.font = '15px VT323, monospace';
    const w = Math.max(14, c.measureText(label).width + 6);
    c.fillStyle = '#0f141c';
    c.fillRect(x - w / 2 - 1, y - 9, w + 2, 18);
    c.fillStyle = col;
    c.fillRect(x - w / 2, y - 8, w, 16);
    c.fillStyle = '#0a1218';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(label, x, y + 1);
  }

  private draw() {
    const g = this.g, c = this.x;
    const W = innerWidth, H = innerHeight;
    if (this.c.width !== W || this.c.height !== H) { this.c.width = W; this.c.height = H; }
    c.imageSmoothingEnabled = false;
    c.fillStyle = '#16303c';
    c.fillRect(0, 0, W, H);
    const base = g.hud.mapCanvas();
    const E = g.hud.mapExtent;
    c.drawImage(base, this.sx(-E), this.sy(-E), base.width / 2 * this.zoom, base.height / 2 * this.zoom);

    // labels
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `${Math.max(16, Math.min(30, 26 * this.zoom))}px VT323, monospace`;
    c.fillStyle = 'rgba(232,226,208,0.55)';
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

    // places
    for (const s of g.travel.stands) this.box(this.sx(s.x), this.sy(s.z), 'TAXI', '#c4a03c');
    for (const s of g.escapes.stations) this.box(this.sx(s.entrance.x), this.sy(s.entrance.z), 'M', '#6a9fd8');
    for (const [t, , x, z, col] of PLACES) this.box(this.sx(x), this.sy(z), t, col);
    houseIcon(c, this.sx(-28), this.sy(46), 1);
    for (const s of g.activities.spots) this.box(this.sx(s.x), this.sy(s.z), g.activities.iconTag(s), g.activities.iconColor(s));

    // police activity
    const blink = Math.sin(this.t * 12) > 0;
    for (const u of g.police.units) {
      c.fillStyle = blink ? '#e0322a' : '#2b5ce0';
      c.fillRect(this.sx(u.pos.x) - 4, this.sy(u.pos.z) - 4, 8, 8);
    }

    // missions + tooltip
    let tip = '';
    const mx = this.mouse.x, my = this.mouse.y;
    for (const d of g.missions.defs) {
      const st = g.missions.status(d);
      if (st === 'done') continue;
      const x = this.sx(d.marker.x), y = this.sy(d.marker.z);
      const col = st === 'locked' ? '#6a6f78' : TYPE_INFO[d.type].color;
      c.save();
      c.translate(x, y);
      c.rotate(Math.PI / 4);
      c.fillStyle = '#0f141c';
      c.fillRect(-11, -11, 22, 22);
      c.fillStyle = col;
      c.fillRect(-9, -9, 18, 18);
      c.restore();
      c.fillStyle = '#0a1218';
      c.font = '17px VT323, monospace';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(TYPE_INFO[d.type].tag, x, y + 1);
      if (Math.hypot(mx - x, my - y) < 16) {
        tip = `<b>${d.title}</b> · ${TYPE_INFO[d.type].label} · ${d.giver}<br>${st === 'locked' ? `LOCKED: ${d.unlock?.hint}` : d.intro}`;
      }
    }
    for (const s of g.activities.spots) if (!tip && Math.hypot(mx - this.sx(s.x), my - this.sy(s.z)) < 12) tip = `<b>${s.name}</b> · ${TYPE_INFO[s.type].label}<br>${s.intro}`;
    if (!tip && Math.hypot(mx - this.sx(-28), my - this.sy(46)) < 14) tip = '<b>Home</b> · front door, taxi stand. Sleep here to save.';
    for (const [, name, x, z] of PLACES) if (!tip && Math.hypot(mx - this.sx(x), my - this.sy(z)) < 12) tip = name;
    for (const s of g.travel.stands) if (!tip && Math.hypot(mx - this.sx(s.x), my - this.sy(s.z)) < 12) tip = `Taxi stand: ${s.name}`;
    for (const s of g.escapes.stations) if (!tip && Math.hypot(mx - this.sx(s.entrance.x), my - this.sy(s.entrance.z)) < 10) tip = `Metro: ${s.name}`;

    // waypoint
    const wp = g.gps.waypoint;
    if (wp) {
      const x = this.sx(wp.x), y = this.sy(wp.z);
      c.fillStyle = '#46e6ff';
      c.fillRect(x - 1, y - 16, 2, 16);
      c.fillRect(x, y - 16, 10, 7);
    }
    // player
    const P = g.player.worldPos;
    const heading = g.player.vehicle ? g.player.vehicle.heading : g.player.heading;
    c.save();
    c.translate(this.sx(P.x), this.sy(P.z));
    c.rotate(Math.PI - heading);
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(0, -11);
    c.lineTo(8, 9);
    c.lineTo(0, 4);
    c.lineTo(-8, 9);
    c.closePath();
    c.fill();
    c.restore();

    if (tip) {
      this.tip.innerHTML = tip;
      this.tip.style.display = 'block';
      this.tip.style.transform = `translate(${Math.min(W - 340, mx + 16)}px, ${Math.min(H - 110, my + 12)}px)`;
    } else this.tip.style.display = 'none';
  }
}
