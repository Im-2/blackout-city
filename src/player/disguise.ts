// Disguises: swap the player's outfit. Police remember the outfit they last
// saw; in a different outfit they only recognise you up close.
import { PLAYER_SKIN, Skin } from '../characters/skins';
import type { Game } from '../core/game';

export interface Outfit { id: string; name: string; desc: string; price: number; skin: Skin; }

const mk = (id: string, name: string, desc: string, price: number, o: Partial<Skin>): Outfit => ({
  id, name, desc, price, skin: { ...PLAYER_SKIN, key: `player-${id}`, props: [], ...o },
});

export const OUTFITS: Outfit[] = [
  mk('clerk', 'Tired clerk', 'a green tie', 0, {}),
  mk('hoodie', 'Grey hoodie', 'a grey hoodie', 0, { top: '#6e6a62', topStyle: 'hoodie', sleeves: 'long', tie: undefined, cap: '#1e1e1e', pants: '#2c2e3c', shoes: '#2a2a2a' }),
  mk('courier', 'Courier', 'an orange courier jacket', 400, { top: '#c96a3a', topStyle: 'hoodie', sleeves: 'rolled', tie: undefined, cap: '#c96a3a', props: ['backpack'], shoes: '#d0c8b8', sole: '#e0d8c4' }),
  mk('worker', 'Road crew', 'a hi-vis vest', 600, { top: '#d8782a', topStyle: 'tee', hivis: true, sleeves: 'short', tie: undefined, props: ['hardhat'], pants: '#3b4a5c', shoes: '#4a3424' }),
  mk('suit', 'Navy suit', 'a navy suit', 900, { top: '#23283a', tie: '#7a1c1c', sleeves: 'long', pants: '#23283a', shoes: '#1e1e1e', hairStyle: 'short' }),
  mk('tourist', 'Tourist', 'a striped shirt and camera', 500, { top: '#c4a03c', topStyle: 'stripes', stripe: '#f0f0e8', under: '#e6e0d4', sleeves: 'short', tie: undefined, cap: '#d8d0bc', props: ['camera'], pants: '#b39a73' }),
];

export class Disguise {
  owned = new Set<string>(['clerk', 'hoodie']);
  current: Outfit = OUTFITS[0];
  /** outfit the police are looking for (null = no description yet) */
  known: string | null = null;

  constructor(private g: Game) {}

  reset() {
    this.owned = new Set(['clerk', 'hoodie']);
    this.current = OUTFITS.find((o) => o.id === this.g.save.data.outfit) ?? OUTFITS[0];
    for (const id of this.g.save.data.outfits) this.owned.add(id);
    this.known = null;
    this.g.player.setSkin(this.current.skin);
  }

  wear(id: string) {
    const o = OUTFITS.find((x) => x.id === id);
    if (!o) return;
    this.current = o;
    this.g.player.setSkin(o.skin);
    this.g.save.data.outfit = id;
    this.g.fx.spawn('dust', this.g.player.pos.clone().setY(1), 14);
    const changed = this.known && this.known !== id;
    this.g.hud.toast(changed ? `NEW LOOK: ${o.name.toUpperCase()} — DESCRIPTION OUT OF DATE` : `OUTFIT: ${o.name.toUpperCase()}`, changed ? 'cool' : 'hack');
    if (changed) this.g.police.onDescriptionLost('outfit');
  }

  /** Called whenever police get eyes on the player on foot. */
  seen() {
    this.known = this.current.id;
  }

  /** Recognition distance for a cop who has a description. */
  recogniseRange(normal: number) {
    if (!this.known || this.known === this.current.id) return normal;
    return Math.min(normal, 8);
  }
}
