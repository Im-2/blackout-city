// Clothes stores, the barber, the corner shop and the wardrobe: one screen. The list
// sits on one side and the camera comes round to look at the real player model, so
// the preview is the character you actually get.
import * as THREE from 'three';
import { BEARDS, Good, GOODS, HAIR_COLOURS, HAIR_STYLES, Hair, ITEMS, Look, SLOTS, Slot, StoreId, clerkLook, describe, itemById, lookSig } from '../player/clothes';
import type { Game } from '../core/game';

interface Row {
  left: string;
  right?: string;
  sub?: string;
  color?: string;
  /** what the model should wear while this row is selected */
  look?: Look;
  hair?: Hair;
  primary?: { label: string; act: () => void };
  alt?: { label: string; act: () => void };
}
interface Section { name: string; rows: () => Row[]; }

export const OUTFIT_SLOTS = 6;

export class ShopUi {
  private el: HTMLDivElement;
  private sections: Section[] = [];
  private tab = 0;
  private sel = 0;
  private rows: Row[] = [];
  private title = '';
  private msg = '';
  private turn = 0;
  private spin = new THREE.Vector3();
  open_ = false;

  constructor(private g: Game) {
    this.el = document.createElement('div');
    this.el.className = 'panel home-ui shop-ui';
    this.el.style.display = 'none';
    g.hud.root.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-tab],[data-row],[data-close],[data-act]') as HTMLElement | null;
      if (!t) return;
      if (t.dataset.close !== undefined) { this.close(); return; }
      if (t.dataset.tab !== undefined) { this.tab = +t.dataset.tab; this.sel = 0; this.msg = ''; this.refresh(); return; }
      if (t.dataset.act !== undefined) { this.act(t.dataset.act as 'primary' | 'alt'); return; }
      this.sel = +t.dataset.row!;
      this.msg = '';
      this.refresh();
    });
  }

  // ------------------------------------------------------------------ what's on sale
  open(what: StoreId | 'barber' | 'goods', title: string) {
    this.show(title, what === 'barber' ? this.barber() : what === 'goods' ? this.goods() : this.store(what));
  }

  wardrobe() {
    this.show('WARDROBE', [{ name: 'OUTFITS', rows: () => this.outfitRows() }, ...SLOTS.map((s) => ({ name: s.name, rows: () => this.closetRows(s.id) })).filter((s) => s.rows().length > 0)]);
  }

  private store(id: StoreId): Section[] {
    return SLOTS.filter((s) => ITEMS.some((i) => i.store === id && i.slot === s.id)).map((s) => ({ name: s.name, rows: () => this.itemRows(s.id, id) }));
  }

  private tryItem(slot: Slot, id: string | null): Look {
    return { ...this.g.disguise.look, [slot]: id };
  }

  private itemRows(slot: Slot, store: StoreId): Row[] {
    const g = this.g, D = g.disguise;
    const price = (n: number) => Math.round(n * g.rep.priceScale);
    return ITEMS.filter((i) => i.store === store && i.slot === slot).map((i) => {
      const own = D.owned.has(i.id), on = D.equipped(i.id), p = price(i.price);
      return {
        left: i.name, right: on ? 'WEARING' : own ? 'OWNED' : `$${p.toLocaleString()}`, sub: i.desc ? `Witnesses will say: ${i.desc}` : 'Nobody remembers trousers.',
        color: (i.look.top ?? i.look.pants ?? i.look.shoes ?? i.look.cap ?? i.look.glassTint ?? '#c8c3b5') as string,
        look: this.tryItem(slot, i.id),
        primary: on ? undefined : own ? { label: 'WEAR', act: () => D.wear(this.tryItem(slot, i.id)) }
          : { label: `BUY $${p.toLocaleString()}`, act: () => { if (this.pay(p)) { D.buy(i.id); D.wear(this.tryItem(slot, i.id)); this.msg = `Bought: ${i.name}.`; } } },
      };
    });
  }

  private closetRows(slot: Slot): Row[] {
    const D = this.g.disguise;
    const rows: Row[] = ITEMS.filter((i) => i.slot === slot && D.owned.has(i.id)).map((i) => ({
      left: i.name, right: D.equipped(i.id) ? 'WEARING' : '', sub: i.desc ? `Witnesses will say: ${i.desc}` : undefined,
      color: (i.look.top ?? i.look.pants ?? i.look.shoes ?? i.look.cap ?? i.look.glassTint ?? '#c8c3b5') as string,
      look: this.tryItem(slot, i.id),
      primary: D.equipped(i.id) ? undefined : { label: 'WEAR', act: () => D.wear(this.tryItem(slot, i.id)) },
    }));
    const opt = SLOTS.find((s) => s.id === slot)!.optional;
    if (opt && rows.length) rows.unshift({ left: 'Nothing', right: D.look[slot] ? '' : 'WEARING', look: this.tryItem(slot, null), primary: D.look[slot] ? { label: 'TAKE IT OFF', act: () => D.wear(this.tryItem(slot, null)) } : undefined });
    return rows;
  }

  private status(look: Look) {
    const D = this.g.disguise;
    if (lookSig(look) === D.known) return 'POLICE ARE LOOKING FOR THIS';
    return D.onFile(look) ? 'ON THE NEWS' : 'CLEAN';
  }

  private outfitRows(): Row[] {
    const g = this.g, D = g.disguise, s = g.save.data;
    const rows: Row[] = [];
    const clean = s.outfitSlots.find((o) => o && !D.onFile(o.look) && lookSig(o.look) !== D.current.id);
    const news = D.knownDesc ? `The radio has you in ${D.knownDesc}.` : 'Nobody has described you yet.';
    rows.push({
      left: 'Wear a clean disguise', sub: news, color: '#7dffb0', look: clean?.look,
      primary: clean ? { label: 'CHANGE NOW', act: () => { D.wear(clean.look); this.msg = `Now in ${clean.name}.`; } } : undefined,
      right: clean ? clean.name.toUpperCase() : 'NONE SAVED',
    });
    for (let i = 0; i < OUTFIT_SLOTS; i++) {
      const o = s.outfitSlots[i];
      const save = { label: o ? 'SAVE OVER IT' : 'SAVE THIS LOOK', act: () => { s.outfitSlots[i] = { name: `Outfit ${i + 1}`, look: { ...D.look } }; this.msg = `Saved to slot ${i + 1}.`; } };
      if (!o) { rows.push({ left: `Slot ${i + 1}: empty`, sub: 'Saves what you\'re wearing now.', color: '#6a6f78', primary: save }); continue; }
      const on = lookSig(o.look) === D.current.id;
      rows.push({
        left: `Slot ${i + 1}: ${describe(o.look)}`, right: on ? 'WEARING' : this.status(o.look), sub: on ? undefined : `Witnesses will say: ${describe(o.look)}`,
        color: itemById(o.look.jacket)?.look.top ?? itemById(o.look.top)?.look.top ?? '#c8c3b5', look: o.look,
        primary: on ? save : { label: 'WEAR', act: () => D.wear(o.look) }, alt: on ? undefined : save,
      });
    }
    rows.push({ left: 'The tired clerk', sub: 'Back to the shirt and the green tie.', color: '#c9c8a8', look: clerkLook(), primary: { label: 'WEAR', act: () => D.wear(clerkLook()) } });
    return rows;
  }

  private barber(): Section[] {
    const D = this.g.disguise;
    const line = <T>(name: string, list: { id: T; name: string; price: number }[], cur: () => T, change: (id: T) => Hair, color: (id: T) => string): Section => ({
      name,
      rows: () => list.map((o) => {
        const on = cur() === o.id;
        return {
          left: o.name, right: on ? 'CURRENT' : `$${o.price}`, color: color(o.id), hair: change(o.id),
          primary: on ? undefined : { label: `PAY $${o.price}`, act: () => { if (this.pay(o.price)) { D.setHair(change(o.id)); this.msg = 'Looks good. Nobody will ever know.'; } } },
        };
      }),
    });
    return [
      line('HAIR', HAIR_STYLES, () => D.hair.style, (id) => ({ ...D.hair, style: id }), () => D.hair.color),
      line('COLOUR', HAIR_COLOURS, () => D.hair.color, (id) => ({ ...D.hair, color: id }), (id) => id),
      line('BEARD', BEARDS, () => D.hair.beard, (id) => ({ ...D.hair, beard: id }), (id) => id ?? '#d48a5c'),
    ];
  }

  private goods(): Section[] {
    return [{ name: 'SHELVES', rows: () => GOODS.map((o) => ({ left: o.name, right: `$${o.price}`, sub: o.sub, primary: { label: `BUY $${o.price}`, act: () => { this.msg = this.eat(o) ? `${o.name}: done.` : this.msg; } } })) }];
  }

  /** eat or drink something on the spot */
  eat(o: Good) {
    const g = this.g;
    if (o.energy && !o.sprint && g.hack.energy >= 100) { this.say('You\'re buzzing already.'); g.audio.deny(); return false; }
    if (!this.pay(o.price)) return false;
    if (o.energy) g.hack.energy = Math.min(100, g.hack.energy + o.energy);
    if (o.sprint) g.player.sprintT = Math.max(g.player.sprintT, o.sprint);
    g.audio.pop();
    if (!this.open_) g.hud.toast(o.name.toUpperCase(), 'cool');
    return true;
  }

  private say(m: string) {
    if (this.open_) this.msg = m;
    else this.g.hud.toast(m.toUpperCase(), 'dim');
  }

  private pay(n: number) {
    const g = this.g, s = g.save.data;
    if (s.cash < n) { this.say(`You need $${n.toLocaleString()}. You have $${s.cash.toLocaleString()}.`); g.audio.deny(); return false; }
    s.cash -= n;
    g.audio.cash();
    return true;
  }

  // ------------------------------------------------------------------ the screen
  private show(title: string, sections: Section[]) {
    const g = this.g;
    this.title = title;
    this.sections = sections;
    this.tab = this.sel = 0;
    this.msg = '';
    this.open_ = true;
    g.state = 'menu';
    g.input.unlock();
    this.el.style.display = 'flex';
    this.aimCamera();
    this.refresh();
  }

  close() {
    const g = this.g;
    this.open_ = false;
    this.el.style.display = 'none';
    g.player.setSkin(g.disguise.current.skin);
    g.input.endFrame();
    g.play();
  }

  /** stand back along whichever way has the most room, the player left of the list */
  private aimCamera() {
    const g = this.g, P = g.player.worldPos;
    let best = 0, bd = -1;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const d = Math.min(3, g.col.raycast(P.x, P.y + 1.3, P.z, Math.sin(a), 0, Math.cos(a), 3, false));
      if (d > bd) { bd = d; best = a; }
    }
    const dist = Math.max(1.4, bd - 0.3);
    const fx = Math.sin(best), fz = Math.cos(best);
    g.camera.position.set(P.x + fx * dist, P.y + 1.25, P.z + fz * dist);
    // looking back at the player; aim past them so they stand to the left of the screen
    const side = 0.26 * dist;
    this.spin.set(P.x + fz * side, P.y + 0.95, P.z - fx * side);
    g.camera.lookAt(this.spin);
    const yaw = g.player.view.root.rotation;
    yaw.y = best;
    this.turn = best;
  }

  update(dt: number) {
    const g = this.g, inp = g.input;
    if (inp.pressed('escape', 'back', 'interact')) { this.close(); return; }
    let dirty = false;
    const n = this.sections.length;
    if (inp.pressed('menuLeft') && n > 1) { this.tab = (this.tab - 1 + n) % n; this.sel = 0; dirty = true; }
    if (inp.pressed('menuRight') && n > 1) { this.tab = (this.tab + 1) % n; this.sel = 0; dirty = true; }
    const m = this.rows.length;
    if (m) {
      if (inp.pressed('menuDown')) { this.sel = (this.sel + 1) % m; dirty = true; }
      if (inp.pressed('menuUp')) { this.sel = (this.sel - 1 + m) % m; dirty = true; }
    }
    if (dirty) { this.msg = ''; this.refresh(); }
    if (inp.pressed('confirm')) this.act('primary');
    // a slow turn, so you see the back of it too
    this.turn += dt * 0.5;
    const v = g.player.view;
    v.root.rotation.y = this.turn;
    v.update(dt, 'idle', 0);
  }

  private act(which: 'primary' | 'alt') {
    const a = this.rows[this.sel]?.[which];
    if (!a) { this.g.audio.deny(); return; }
    a.act();
    if (this.open_) this.refresh();
  }

  private refresh() {
    const D = this.g.disguise;
    const sec = this.sections[this.tab];
    this.rows = sec.rows();
    if (this.sel >= this.rows.length) this.sel = 0;
    const r = this.rows[this.sel];
    const yawKeep = this.g.player.view.root.rotation.y;
    D.preview(r?.look ?? D.look, r?.hair ?? D.hair);
    this.g.player.view.root.rotation.y = yawKeep;
    const tabs = this.sections.length > 1 ? `<div class="hu-tabs">${this.sections.map((x, i) => `<button class="hu-tab ${i === this.tab ? 'on' : ''}" data-tab="${i}">${x.name}</button>`).join('')}</div>` : '';
    const rows = this.rows.map((x, i) => `
      <div class="hu-row can ${i === this.sel ? 'sel' : ''}" data-row="${i}">
        <i style="background:${x.color ?? '#c8c3b5'}"></i>
        <div class="hu-main"><div class="hu-l"><span>${x.left}</span><em>${x.right ?? ''}</em></div>${x.sub ? `<div class="hu-sub">${x.sub}</div>` : ''}</div>
      </div>`).join('');
    const btn = (kind: 'primary' | 'alt', a?: { label: string }) => (a ? `<button class="btn shop-btn ${kind}" data-act="${kind}">${a.label}</button>` : '');
    this.el.innerHTML = `
      <div class="hu-head"><span>${this.title}</span><b>$${this.g.save.data.cash.toLocaleString()}</b><button class="hu-close" data-close>✕</button></div>
      ${tabs}<div class="hu-list">${rows}</div>
      <div class="shop-msg">${this.msg}</div>
      <div class="shop-acts">${btn('primary', r?.primary)}${btn('alt', r?.alt)}</div>`;
    const sel = this.el.querySelector('.hu-row.sel');
    sel?.scrollIntoView({ block: 'nearest' });
  }
}
