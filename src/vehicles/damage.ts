// Every vehicle damage number, in one place. Tune here.
import type { CarKind } from './carMesh';

/** full health per vehicle: damage below is in the same points */
export const HEALTH: Record<CarKind, number> = {
  bicycle: 150, scooter: 180, motorbike: 220, policemoto: 240,
  hatchback: 320, sports: 320, sedan: 350, taxi: 350, muscle: 400,
  pickup: 450, police: 450, suv: 480,
  van: 550, ambulance: 600, foodtruck: 600,
  boxtruck: 750, garbage: 900, firetruck: 900, bus: 1000, swat: 1100,
};

export const DAMAGE = {
  /** impacts below this speed (m/s) do nothing: bumps, scrapes, parking */
  safeImpact: 8,
  /** damage = scale × (impact - safeImpact) ^ power: gentle at first, brutal when fast */
  scale: 0.6,
  power: 1.5,
  /** after a hit, only a harder hit can do more, for this long (seconds) */
  cooldown: 0.7,
  /** poles, trees, planters, barriers, ramps: anything that isn't a building or wall */
  lightObject: 0.15,
  /** bumping another car, before its mass is counted */
  otherCar: 0.5,
  /** on the receiving end of a police car: effective, but it takes several */
  policeRam: 1.1,
  /** a heavy vehicle hurts more and a light one less, within these limits */
  massMin: 0.5,
  massMax: 2,
  /** landing from a jump */
  landingSafe: 14,
  landingScale: 0.6,
  /** below this share of health the engine starts to go */
  limpBelow: 0.3,
  /** at zero health you still get this share of speed and acceleration */
  limpFloor: 0.72,
  /** smoke below this share, fire below the next */
  smokeBelow: 0.4,
  fireBelow: 0.15,
};

export function impactDamage(impact: number, safe: number = DAMAGE.safeImpact, scale: number = DAMAGE.scale) {
  return impact <= safe ? 0 : scale * (impact - safe) ** DAMAGE.power;
}

/** how much of `other`'s weight this vehicle feels */
export function massFactor(mine: number, other: number) {
  return Math.max(DAMAGE.massMin, Math.min(DAMAGE.massMax, Math.sqrt(other / mine)));
}
