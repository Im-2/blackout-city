// The six districts of the 12x12 city: who lives there, what drives there,
// how it's tinted. Pure data. Districts differ by tint, props and signage only
// (same art-bible rules everywhere).
import { BLOCKS, HALF, PITCH } from '../world/layout';
import type { CarKind } from '../vehicles/carMesh';
import type { PedType } from '../characters/pedTypes';
import type { FacadeStyle } from '../assets/textures';

export type District = 'downtown' | 'oldtown' | 'docks' | 'residential' | 'park';

export interface DistrictDef {
  id: District;
  name: string;
  /** multiplies building and sidewalk colours */
  tint: [number, number, number];
  map: string; // minimap block colour
  /** facade style weights */
  styles: [FacadeStyle, number][];
  floors: [number, number];
  traffic: [CarKind, number][];
  peds: [PedType, number][];
  /** walkers per block relative to the average */
  crowd: number;
}

export const DISTRICTS: Record<District, DistrictDef> = {
  downtown: {
    id: 'downtown', name: 'Downtown', tint: [0.96, 0.98, 1.03], map: '#2a303a',
    styles: [['office', 4], ['tower', 2], ['concrete', 2], ['tan', 1], ['brick', 1]], floors: [6, 12],
    traffic: [['sedan', 5], ['taxi', 3], ['sports', 1], ['suv', 2], ['hatchback', 2], ['van', 1], ['scooter', 1], ['motorbike', 0.6], ['bicycle', 0.8], ['foodtruck', 0.4], ['boxtruck', 0.5]],
    peds: [['office', 7], ['local', 3], ['tourist', 2], ['courier', 2], ['teen', 1], ['jogger', 0.5]], crowd: 1.5,
  },
  oldtown: {
    id: 'oldtown', name: 'Old Town', tint: [1.06, 0.96, 0.86], map: '#3a2c26',
    styles: [['brick', 6], ['tan', 3], ['sage', 1]], floors: [2, 4],
    traffic: [['hatchback', 4], ['sedan', 2], ['taxi', 1], ['scooter', 2], ['bicycle', 2], ['van', 1], ['muscle', 0.5]],
    peds: [['local', 5], ['tourist', 4], ['teen', 2], ['dogwalker', 1], ['office', 1]], crowd: 1.1,
  },
  docks: {
    id: 'docks', name: 'Docks & Industrial', tint: [0.88, 0.9, 0.93], map: '#24272a',
    styles: [['concrete', 5], ['brick', 2], ['slate', 1]], floors: [2, 4],
    traffic: [['boxtruck', 3], ['pickup', 3], ['van', 2], ['garbage', 1], ['sedan', 1], ['muscle', 1], ['motorbike', 0.5]],
    peds: [['construction', 6], ['local', 2], ['courier', 1], ['security', 0.5]], crowd: 0.5,
  },
  residential: {
    id: 'residential', name: 'Residential', tint: [1.0, 1.0, 0.95], map: '#2c3029',
    styles: [['tan', 3], ['slate', 3], ['sage', 2], ['brick', 2]], floors: [3, 7],
    traffic: [['hatchback', 3], ['sedan', 3], ['suv', 2], ['muscle', 0.8], ['pickup', 1], ['bicycle', 1.2], ['scooter', 1], ['motorbike', 0.8], ['van', 0.6]],
    peds: [['local', 5], ['dogwalker', 3], ['jogger', 2], ['teen', 2], ['courier', 1]], crowd: 0.9,
  },
  park: {
    id: 'park', name: 'Park & Waterfront', tint: [0.98, 1.03, 0.94], map: '#2b3a24',
    styles: [['sage', 2], ['tan', 1]], floors: [1, 2],
    traffic: [['bicycle', 3], ['scooter', 2], ['motorbike', 1], ['hatchback', 2], ['sports', 0.6], ['sedan', 1]],
    peds: [['jogger', 4], ['tourist', 4], ['dogwalker', 3], ['local', 2], ['teen', 2]], crowd: 1,
  },
};

/** Which district owns a block. The old 6x6 city sits at blocks 3..8. */
export function districtOfBlock(bi: number, bj: number): District {
  if (bi >= 9 || (bi >= 8 && bj >= 7 && bj <= 9)) return 'docks';
  if (bj >= 10) return 'park';
  if (bi === 6 && bj === 5) return 'park'; // the downtown square
  if ((bi <= 3 && bj >= 3 && bj <= 9) || (bj === 6 && bi <= 5)) return 'oldtown';
  if (bi >= 4 && bi <= 8 && bj >= 2 && bj <= 6) return 'downtown';
  return 'residential';
}

export function districtAt(x: number, z: number): District {
  // the shop-row block straddles the line: pawn shop in Old Town, safehouse in Residential
  if (x > -49 && x < -7 && z > 25 && z < 49) return 'residential';
  const bi = Math.max(0, Math.min(BLOCKS - 1, Math.floor((x + HALF) / PITCH)));
  const bj = Math.max(0, Math.min(BLOCKS - 1, Math.floor((z + HALF) / PITCH)));
  return districtOfBlock(bi, bj);
}
