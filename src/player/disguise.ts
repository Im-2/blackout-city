// Disguises: what you're wearing against what the police and the news have on file.
// The cop who last saw you remembers that outfit; anything they've had described
// before still rings a bell; something new only gets recognised up close.
import { buildSkin, clerkLook, describe, Hair, itemById, LEGACY, Look, lookSig, SLOTS, startHair, START_CLOSET } from './clothes';
import type { Skin } from '../characters/skins';
import type { Game } from '../core/game';

export interface Outfit { id: string; name: string; desc: string; skin: Skin; }

export const FULL_RANGE_DESCRIBED = 14, RANGE_FRESH = 8;

export class Disguise {
  owned = new Set<string>(START_CLOSET);
  look: Look = clerkLook();
  hair: Hair = startHair();
  current: Outfit = this.outfitOf(this.look, this.hair);
  /** the outfit the police are looking for (null = no description yet) */
  known: string | null = null;
  knownDesc = '';

  constructor(private g: Game) {}

  private outfitOf(look: Look, hair: Hair): Outfit {
    return { id: lookSig(look), name: itemById(look.jacket)?.name ?? itemById(look.top)?.name ?? 'Plain clothes', desc: describe(look), skin: buildSkin(look, hair) };
  }

  reset() {
    const s = this.g.save.data;
    // saves from before the shops stored one whole outfit
    for (const id of s.outfits) for (const it of LEGACY[id]?.items ?? []) if (!s.closet.includes(it)) s.closet.push(it);
    s.outfits = [];
    if (!s.look) s.look = { ...clerkLook(), ...(LEGACY[s.outfit]?.look ?? {}) };
    this.owned = new Set([...START_CLOSET, ...s.closet]);
    this.look = { ...clerkLook(), ...s.look };
    this.hair = { ...startHair(), ...s.hair };
    this.current = this.outfitOf(this.look, this.hair);
    this.known = null;
    this.knownDesc = '';
    this.g.player.setSkin(this.current.skin);
  }

  buy(id: string) {
    const s = this.g.save.data;
    this.owned.add(id);
    if (!s.closet.includes(id)) s.closet.push(id);
  }

  /** the model only: the shop screens use it while you browse */
  preview(look: Look, hair: Hair = this.hair) {
    this.g.player.setSkin(buildSkin(look, hair));
  }

  wear(look: Look, quiet = false) {
    this.look = { ...look };
    this.g.save.data.look = this.look;
    this.current = this.outfitOf(this.look, this.hair);
    this.g.player.setSkin(this.current.skin);
    this.g.fx.spawn('dust', this.g.player.pos.clone().setY(1), 14);
    const changed = this.known && this.known !== this.current.id;
    if (!quiet) this.g.hud.toast(changed ? `NEW LOOK: ${this.current.desc.toUpperCase()} — DESCRIPTION OUT OF DATE` : `WEARING ${this.current.desc.toUpperCase()}`, changed ? 'cool' : 'hack');
    if (changed) this.g.police.onDescriptionLost('outfit');
  }

  setHair(hair: Hair) {
    this.hair = hair;
    this.g.save.data.hair = hair;
    this.current = this.outfitOf(this.look, hair);
    this.g.player.setSkin(this.current.skin);
  }

  equipped(id: string) {
    return SLOTS.some((x) => this.look[x.id] === id);
  }

  /** has this outfit ever gone out over the radio? */
  onFile(look: Look) {
    return this.g.save.data.described.includes(lookSig(look));
  }

  /** Called whenever police get eyes on the player on foot. */
  seen() {
    if (this.known === this.current.id) return;
    this.known = this.current.id;
    this.knownDesc = this.current.desc;
    const d = this.g.save.data.described;
    if (!d.includes(this.known)) d.push(this.known);
  }

  /** the records room hack */
  forget() {
    this.known = null;
    this.knownDesc = '';
    this.g.save.data.described = [];
  }

  /** Recognition distance for a cop who has a description. */
  recogniseRange(normal: number) {
    if (!this.known || this.known === this.current.id) return normal;
    return Math.min(normal, this.onFile(this.look) ? FULL_RANGE_DESCRIBED : RANGE_FRESH);
  }
}
