// Things to do around the city that aren't missions: every spot has a map icon,
// a name, and a short intro card the first time you come near it.
import type { MissionType } from '../missions/types';
import { TYPE_INFO } from '../missions/types';
import type { Game } from '../core/game';

export interface ActivitySpot {
  id: string;
  name: string;
  type: MissionType;
  x: number;
  z: number;
  intro: string;
  /** stays on the edge of the minimap when out of range */
  pin?: boolean;
  /** letter on the map icon (defaults to the type's) */
  tag?: string;
}

const CARD_TIME = 7;

export class Activities {
  spots: ActivitySpot[] = [];
  private cardT = 0;

  constructor(private g: Game) {}

  add(s: ActivitySpot) {
    this.spots.push(s);
  }

  /** a card that isn't tied to a fixed spot */
  showCard(s: { name: string; type: MissionType; intro: string }) {
    const g = this.g;
    if (g.missions.run || g.missions.card) return;
    g.hud.infoCard(s);
    g.audio.ring();
    this.cardT = CARD_TIME;
  }

  iconColor(s: ActivitySpot) { return TYPE_INFO[s.type].color; }
  iconTag(s: ActivitySpot) { return s.tag ?? TYPE_INFO[s.type].tag; }

  update(dt: number) {
    const g = this.g;
    if (this.cardT > 0) {
      this.cardT -= dt;
      if (this.cardT <= 0 || g.missions.card) { this.cardT = 0; if (!g.missions.card) g.hud.missionCard(null); }
      return;
    }
    if (g.missions.run || g.missions.card) return;
    const P = g.player.worldPos, seen = g.save.data.seen;
    for (const s of this.spots) {
      if (seen[s.id] || Math.hypot(s.x - P.x, s.z - P.z) > 11) continue;
      seen[s.id] = true;
      g.hud.infoCard(s);
      g.audio.ring();
      this.cardT = CARD_TIME;
      return;
    }
  }
}
