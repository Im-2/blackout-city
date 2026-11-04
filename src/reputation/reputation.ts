// Street reputation, overall and per district. Crimes, missions, races and stunts
// earn it. Higher tiers change what people do: pedestrians recognise you, clerks
// stop reaching for the phone, the fence pays better, the news talks about you.
import { DISTRICTS, District, districtAt } from '../map/districts';
import type { Game } from '../core/game';

const TIERS: [number, string][] = [[0, 'NOBODY'], [10, 'SMALL-TIME'], [50, 'KNOWN'], [150, 'WANTED NAME'], [400, 'CITY LEGEND']];

const tierOf = (n: number) => {
  let t = 0;
  for (let i = 0; i < TIERS.length; i++) if (n >= TIERS[i][0]) t = i;
  return t;
};

export const repTitle = (n: number) => TIERS[tierOf(n)][1];

const GREET: Record<string, string[]> = {
  mart: ['Evening. Exact change, please.', 'You look familiar. Do I know you?', 'I saw you on the news. Please, no trouble.', 'Take what you want. I never saw you.', 'It\'s an honour. And please don\'t hurt me.'],
  pawn: ['Buying or selling? Don\'t waste my time.', 'I hear your name around. I might pay a little more.', 'For you, a better rate on the goods.', 'You\'re good for business. Best rates in town.', 'Anything for the legend of the city.'],
  jewel: ['We close soon. Don\'t touch the glass.', 'Sir or madam, may I see your hands?', 'Security! No, wait. Please.', 'Take it. Insurance will pay.', 'I always knew you\'d come here.'],
};

export class Reputation {
  private t = 1;
  private site: string | null = null;
  private greeted = new Set<string>();

  constructor(private g: Game) {}

  get overall() { return this.g.save.data.rep.overall; }

  district(d: District) { return this.g.save.data.rep.districts[d] ?? 0; }

  /** how known you are where you're standing: local rep plus a share of your overall name */
  get tierHere() {
    const P = this.g.player.worldPos;
    return tierOf(this.district(districtAt(P.x, P.z)) + this.overall * 0.25);
  }

  /** the fence's cut shrinks as your name grows */
  get fenceBonus() { return this.tierHere * 0.02; }
  /** the pawn shop's clothes get cheaper */
  get priceScale() { return 1 - this.tierHere * 0.05; }

  add(d: District, n: number) {
    if (n <= 0) return;
    const r = this.g.save.data.rep;
    const beforeAll = tierOf(r.overall), beforeHere = tierOf(r.districts[d] ?? 0);
    r.overall += n;
    r.districts[d] = (r.districts[d] ?? 0) + n;
    const name = DISTRICTS[d].name;
    if (tierOf(r.overall) > beforeAll) {
      const title = repTitle(r.overall);
      this.g.hud.toast(`THE CITY KNOWS YOU: ${title}`, 'win');
      this.g.news.headline(`Police call a new figure a "${title.toLowerCase()}" in the city's underworld`);
    } else if (tierOf(r.districts[d]) > beforeHere) {
      this.g.hud.toast(`${name.toUpperCase()}: ${repTitle(r.districts[d])}`, 'hack');
      this.g.news.headline(`${name} residents talk about ${this.g.disguise.current.desc ? `someone in ${this.g.disguise.current.desc}` : 'a stranger'}`);
    }
  }

  reset() {
    this.site = null;
    this.greeted.clear();
  }

  update(dt: number) {
    const g = this.g;
    // shopkeepers say something the first time you walk in
    const P = g.player.pos;
    const site = g.player.vehicle ? null : g.buildings.siteAt(P.x, P.z, P.y)?.id ?? null;
    if (site !== this.site) {
      this.site = site;
      if (site && GREET[site] && !this.greeted.has(site)) {
        this.greeted.add(site);
        g.hud.say(site === 'mart' ? 'CLERK' : site === 'pawn' ? 'FENCE' : 'CLERK', GREET[site][this.tierHere]);
      }
    }
    // pedestrians notice you
    this.t -= dt;
    if (this.t <= 0) {
      this.t = 1.3;
      const tier = this.tierHere;
      const stale = !!g.disguise.known && g.disguise.known !== g.disguise.current.id;
      if (tier >= 1 && !g.player.vehicle) g.peds.recognise(tier, stale);
    }
  }
}
