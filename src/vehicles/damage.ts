// Every vehicle damage number, in one place. Tune here. Which table applies depends
// on who's driving, checked at the moment of each hit: empty and parked vehicles use
// the AI table until the player gets in. Health is kept as a share, so it carries over.
import type { CarKind } from './carMesh';

export interface Durability {
  /** full health per vehicle */
  health: Record<CarKind, number>;
  /** walls and buildings: damage = scale × (impact - safeImpact) ^ power, impact in m/s */
  safeImpact: number;
  scale: number;
  power: number;
  /** poles, trees, planters, barriers, ramps: anything that isn't a building or wall */
  lightObject: number;
  /** another vehicle, same formula */
  carSafeImpact: number;
  carScale: number;
  /** × when the other vehicle is police and you're not */
  policeRam: number;
  /** × (other's mass / my mass) ^ massPower, within these limits */
  massPower: number;
  massMin: number;
  massMax: number;
  /** landing from a jump */
  landingSafe: number;
  landingScale: number;
  /** after a hit, only a harder hit can do more, for this long (seconds) */
  cooldown: number;
  /** below this share of health the engine starts to go... */
  limpBelow: number;
  /** ...down to this share of speed and acceleration at zero */
  limpFloor: number;
}

export const playerVehicleDurability: Durability = {
  health: {
    bicycle: 150, scooter: 180, motorbike: 220, policemoto: 240,
    hatchback: 320, sports: 320, sedan: 350, taxi: 350, muscle: 400,
    pickup: 450, police: 450, suv: 480,
    van: 550, ambulance: 600, foodtruck: 600,
    boxtruck: 750, garbage: 900, firetruck: 900, bus: 1000, swat: 1100,
  },
  safeImpact: 8, scale: 0.6, power: 1.5,
  lightObject: 0.15,
  carSafeImpact: 8, carScale: 0.3,
  policeRam: 2.2,
  massPower: 0.5, massMin: 0.5, massMax: 2,
  landingSafe: 14, landingScale: 0.6,
  cooldown: 0.7,
  limpBelow: 0.3, limpFloor: 0.72,
};

const allAt = (n: number) => Object.fromEntries(Object.keys(playerVehicleDurability.health).map((k) => [k, n])) as Record<CarKind, number>;

/** traffic, taxis, buses, police, rivals, NPC drivers, and anything parked or empty */
export const aiVehicleDurability: Durability = {
  health: allAt(100),
  safeImpact: 7, scale: 2.2, power: 1,
  lightObject: 1,
  carSafeImpact: 6, carScale: 1.6,
  policeRam: 1,
  massPower: 1, massMin: 0, massMax: Infinity,
  landingSafe: 14, landingScale: 2,
  cooldown: 0,
  limpBelow: 0, limpFloor: 1,
};

export const DAMAGE = {
  /** smoke below this share of health, fire below the next */
  smokeBelow: 0.4,
  fireBelow: 0.15,
};

export function impactDamage(D: Durability, impact: number) {
  return impact <= D.safeImpact ? 0 : D.scale * (impact - D.safeImpact) ** D.power;
}

export function landingDamage(D: Durability, impact: number) {
  return impact <= D.landingSafe ? 0 : D.landingScale * (impact - D.landingSafe) ** D.power;
}

export function crashDamage(D: Durability, impact: number, myMass: number, otherMass: number, rammedByCop: boolean) {
  if (impact <= D.carSafeImpact) return 0;
  const mass = Math.max(D.massMin, Math.min(D.massMax, (otherMass / myMass) ** D.massPower));
  return D.carScale * (impact - D.carSafeImpact) ** D.power * mass * (rammedByCop ? D.policeRam : 1);
}
