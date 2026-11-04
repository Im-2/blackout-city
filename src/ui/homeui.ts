// Screens you open at home: hacker desk tabs (missions, map, collection,
// reputation, upgrades), wardrobe, stash, trophies. Pauses the world while up.
import { TYPE_INFO } from '../missions/types';
import { DISTRICTS, District } from '../map/districts';
import { OUTFITS } from '../player/disguise';
import { UPGRADES } from '../core/economy';
import { Races } from '../activities/races';
import { repTitle } from '../reputation/reputation';
import type { Game } from '../core/game';

export type HomeTab = 'missions' | 'map' | 'collection' | 'rep' | 'upgrades' | 'wardrobe' | 'stash' | 'trophies' | 'records';

interface Row { left: string; right?: string; sub?: string; color?: string; act?: () => void; bar?: number; }

const TAB_NAMES: Record<HomeTab, string> = {
  missions: 'MISSIONS', map: 'MAP', collection: 'COLLECTION', rep: 'REPUTATION', upgrades: 'UPGRADES',
  wardrobe: 'OUTFITS', stash: 'STASH', trophies: 'TROPHIES', records: 'RECORDS',
};

const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export class HomeUi {
  private el: HTMLDivElement;
  private tabs: HomeTab[] = [];
  private tab = 0;
  private sel = 0;
  private title = '';
  private rows: Row[] = [];
  open_ = false;

  constructor(private g: Game) {
    this.el = document.createElement('div');
    this.el.className = 'panel home-ui';
    this.el.style.display = 'none';
    g.hud.root.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-tab],[data-row],[data-close]') as HTMLElement | null;
      if (!t) return;
      if (t.dataset.close !== undefined) { this.close(); return; }
      if (t.dataset.tab !== undefined) { this.tab = +t.dataset.tab; this.sel = 0; this.render(); return; }
      this.sel = +t.dataset.row!;
      this.activate();
    });
  }

  open(tabs: HomeTab[], title: string) {
    const g = this.g;
    this.tabs = tabs;
    this.tab = 0;
    this.sel = 0;
    this.title = title;
    this.open_ = true;
    g.state = 'menu';
    g.input.unlock();
    this.el.style.display = 'block';
    this.render();
  }

  close() {
    this.open_ = false;
    this.el.style.display = 'none';
    this.g.input.endFrame(); // the key that closed this mustn't also hit the desk again
    this.g.play();
  }

  /** the map was opened from here */
  hide() { this.el.style.display = 'none'; }
  reveal() { this.el.style.display = 'block'; this.render(); }

  update() {
    const inp = this.g.input;
    if (inp.pressed('escape', 'back', 'interact')) { this.close(); return; }
    let dirty = false;
    if (inp.pressed('menuLeft') && this.tabs.length > 1) { this.tab = (this.tab - 1 + this.tabs.length) % this.tabs.length; this.sel = 0; dirty = true; }
    if (inp.pressed('menuRight') && this.tabs.length > 1) { this.tab = (this.tab + 1) % this.tabs.length; this.sel = 0; dirty = true; }
    const n = this.rows.length;
    if (n) {
      if (inp.pressed('menuDown')) { this.sel = (this.sel + 1) % n; dirty = true; }
      if (inp.pressed('menuUp')) { this.sel = (this.sel - 1 + n) % n; dirty = true; }
    }
    if (dirty) this.render();
    if (inp.pressed('confirm')) this.activate();
  }

  private activate() {
    const r = this.rows[this.sel];
    if (!r?.act) { this.g.audio.deny(); return; }
    r.act();
    if (this.open_ && this.g.state === 'menu') this.render();
  }

  private rowsFor(tab: HomeTab): Row[] {
    const g = this.g, s = g.save.data;
    switch (tab) {
      case 'missions':
        return g.missions.defs.map((d) => {
          const st = g.missions.status(d), done = s.completed[d.id];
          return {
            left: d.title,
            right: st === 'locked' ? 'LOCKED' : done ? `DONE · BEST ${fmtTime(done.best)}` : 'OPEN',
            sub: st === 'locked' ? (d.unlock?.hint ?? '') : `${TYPE_INFO[d.type].label} · ${d.giver} · ${DISTRICTS[d.district].name}`,
            color: st === 'locked' ? '#6a6f78' : TYPE_INFO[d.type].color,
            act: st === 'open' ? () => { g.gps.setWaypoint(d.marker.x, d.marker.z); g.hud.toast(`GPS SET: ${d.title.toUpperCase()}`, 'hack'); this.close(); } : undefined,
          };
        });
      case 'map':
        return [{ left: 'Open the full map', sub: 'Pan, zoom and set a waypoint.', act: () => { this.hide(); g.map.show('menu'); } }];
      case 'collection':
        if (!s.ownedVehicles.length) return [{ left: 'Nothing yet', sub: 'Drive a stolen vehicle into your garage and park it.' }];
        return s.ownedVehicles.map((o) => {
          const here = s.garage?.kind === o.kind && s.garage?.color === o.color;
          return { left: o.label, right: here ? 'IN THE GARAGE' : 'BRING IT HERE', color: o.color, act: here ? undefined : () => g.home.fetch(o) };
        });
      case 'rep': {
        const dist = (Object.keys(DISTRICTS) as District[]).map((d) => {
          const n = s.rep.districts[d] ?? 0;
          return { left: DISTRICTS[d].name, right: `${n} · ${repTitle(n)}`, bar: Math.min(1, n / 150) };
        });
        return [{ left: 'THE WHOLE CITY', right: `${s.rep.overall} · ${repTitle(s.rep.overall)}`, bar: Math.min(1, s.rep.overall / 400), color: '#ffd24a' }, ...dist];
      }
      case 'upgrades':
        return UPGRADES.map((u) => {
          const lvl = s.upgrades[u.id], cost = u.cost[lvl];
          return { left: u.name, right: cost === undefined ? 'MAXED' : `LV ${lvl} · $${cost.toLocaleString()}`, act: cost === undefined ? undefined : () => g.shop.buy(u.id) };
        });
      case 'wardrobe':
        return OUTFITS.map((o) => {
          const owned = g.disguise.owned.has(o.id), on = g.disguise.current.id === o.id;
          return { left: o.name, right: on ? 'WEARING' : owned ? 'WEAR' : `$${o.price} AT PAWN & LOAN`, sub: `Witnesses will say: ${o.desc}`, color: owned ? o.skin.top : '#6a6f78', act: owned && !on ? () => g.disguise.wear(o.id) : undefined };
        });
      case 'stash': {
        const total = s.stash.reduce((n, i) => n + i.value, 0);
        const rows: Row[] = s.stash.map((i) => ({ left: i.name, right: `$${i.value.toLocaleString()}` }));
        if (!rows.length) return [{ left: 'Empty', sub: 'Carried loot is lost if you get busted. Goods in here are safe.' }];
        return [{ left: `Take it all to sell ($${total.toLocaleString()})`, sub: 'The fence is at Pawn & Loan. You lose it if you get busted on the way.', color: '#ffd24a', act: () => { g.loot.carried.push(...s.stash); s.stash = []; g.home.refreshDisplays(); g.hud.toast('STASH EMPTIED — GOODS IN YOUR BAG', 'cool'); this.close(); } }, ...rows];
      }
      case 'records': {
        const r = g.records;
        const tricks: Row[] = r.tricks.length ? r.tricks.map((e, i) => ({ left: `#${i + 1} ${e.bike}`, right: e.score.toLocaleString(), color: '#b6ff3a' })) : [{ left: 'No trick scores yet', sub: 'Do a wheelie on any bike, then land something at Stunt Park.', color: '#b6ff3a' }];
        const races: Row[] = Races.titles().map(([id, title]) => ({ left: title, right: r.races[id] !== undefined ? fmtTime(r.races[id]) : 'NOT RACED', color: '#ff5ad8' }));
        return [...tricks, ...races];
      }
      case 'trophies': {
        const cups = g.missions.defs.filter((d) => s.completed[d.id]).map((d) => ({ left: d.title, right: `×${s.completed[d.id].n} · BEST ${fmtTime(s.completed[d.id].best)}`, color: TYPE_INFO[d.type].color }));
        return [
          { left: 'Cash earned', right: `$${s.earned.toLocaleString()}`, color: '#7ea858' },
          { left: 'Cash on hand', right: `$${s.cash.toLocaleString()}`, color: '#7ea858' },
          { left: 'Goods in the stash', right: `$${s.stash.reduce((n, i) => n + i.value, 0).toLocaleString()}` },
          { left: 'Vehicles collected', right: String(s.ownedVehicles.length) },
          { left: 'Fixer jobs done', right: String(s.jobsDone) },
          ...cups,
        ];
      }
    }
  }

  private render() {
    const t = this.tabs[this.tab];
    this.rows = this.rowsFor(t);
    if (this.sel >= this.rows.length) this.sel = 0;
    const tabs = this.tabs.length > 1 ? `<div class="hu-tabs">${this.tabs.map((x, i) => `<button class="hu-tab ${i === this.tab ? 'on' : ''}" data-tab="${i}">${TAB_NAMES[x]}</button>`).join('')}</div>` : '';
    const rows = this.rows.map((r, i) => `
      <div class="hu-row ${i === this.sel ? 'sel' : ''} ${r.act ? 'can' : ''}" data-row="${i}">
        <i style="background:${r.color ?? '#c8c3b5'}"></i>
        <div class="hu-main"><div class="hu-l"><span>${r.left}</span><em>${r.right ?? ''}</em></div>
        ${r.sub ? `<div class="hu-sub">${r.sub}</div>` : ''}
        ${r.bar !== undefined ? `<div class="bar"><div class="fill" style="width:${r.bar * 100}%"></div></div>` : ''}</div>
      </div>`).join('');
    const nav = `${this.tabs.length > 1 ? '[←→] TAB · ' : ''}[↑↓] CHOOSE · [ENTER] SELECT · [E] CLOSE`;
    this.el.innerHTML = `
      <div class="hu-head"><span>${this.title}</span><b>$${this.g.save.data.cash.toLocaleString()}</b><button class="hu-close" data-close>✕</button></div>
      ${tabs}<div class="hu-list">${rows}</div>
      <div class="hu-foot" data-close>${nav}</div>`;
  }
}
