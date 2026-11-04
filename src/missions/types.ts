// Data-driven missions: a mission is data plus a few small scripts.
import type * as THREE from 'three';
import type { Game } from '../core/game';
import type { District } from '../map/districts';

export type MissionType = 'heist' | 'hacker' | 'driving' | 'courier' | 'race' | 'side' | 'stunt' | 'bike' | 'intercept' | 'getaway' | 'tail' | 'prank' | 'rare';

export const TYPE_INFO: Record<MissionType, { label: string; color: string; tag: string }> = {
  heist: { label: 'Heist', color: '#e0322a', tag: 'H' },
  hacker: { label: 'Hacker', color: '#46e6ff', tag: 'X' },
  driving: { label: 'Driving', color: '#ffb000', tag: 'D' },
  courier: { label: 'Courier', color: '#7dffb0', tag: 'C' },
  race: { label: 'Race', color: '#ff5ad8', tag: 'R' },
  side: { label: 'Side activity', color: '#c9c8a8', tag: 'S' },
  stunt: { label: 'Stunts', color: '#b6ff3a', tag: 'T' },
  bike: { label: 'Bikes', color: '#b48cff', tag: 'B' },
  intercept: { label: 'Intercept', color: '#ff8a3a', tag: 'A' },
  getaway: { label: 'Getaway', color: '#ffd24a', tag: 'G' },
  tail: { label: 'Surveillance', color: '#9fe8ff', tag: 'E' },
  prank: { label: 'Prank', color: '#ff7ab8', tag: 'P' },
  rare: { label: 'Rare car', color: '#e6c84a', tag: '?' },
};

/** Handed to every mission script. `vars` is per-attempt scratch space. */
export interface MissionCtx {
  g: Game;
  vars: Record<string, unknown>;
  /** spawn a vehicle owned by this attempt (cleaned up afterwards if unused) */
  spawnVehicle: (kind: import('../vehicles/carMesh').CarKind, x: number, z: number, heading: number, color?: string) => import('../vehicles/vehicle').Vehicle;
}

type Dyn<T> = T | ((c: MissionCtx) => T);

export interface MissionStep {
  id: string;
  text: Dyn<string>;
  sub?: Dyn<string>;
  /** where the beam, arrow and GPS point */
  target?: (c: MissionCtx) => THREE.Vector3 | null;
  /** reaching the target within this radius completes the step (on foot or in any vehicle) */
  reach?: number;
  /** any other completion condition */
  done?: (c: MissionCtx) => boolean;
  enter?: (c: MissionCtx) => void;
  /** Retrying from here runs this after the world resets. */
  checkpoint?: { restore: (c: MissionCtx) => void };
}

export interface MissionDef {
  id: string;
  title: string;
  giver: string;
  district: District;
  type: MissionType;
  /** map icon, if not the default diamond */
  icon?: import('../ui/mapicons').IconKind;
  /** LOCATIONS tab, if not MISSIONS */
  category?: 'mission' | 'activity';
  /** the marker you walk or drive into */
  marker: { x: number; z: number; heading?: number };
  intro: string;
  unlock?: { missions?: string[]; cash?: number; reputation?: number; hint: string };
  steps: MissionStep[];
  /** seconds for the whole mission */
  timeLimit?: number;
  /** extra fail checks: return a reason to fail */
  failIf?: (c: MissionCtx) => string | null;
  /** fail if the car you're in is wrecked while the cops are on you */
  failOnWreck?: boolean;
  reward: { cash: Dyn<number>; reputation: number; label?: string };
  replay?: boolean;
  /** runs on every start and retry, before any checkpoint restore */
  setup?: (c: MissionCtx) => void;
  /** runs when the attempt ends, however it ends */
  cleanup?: (c: MissionCtx) => void;
  /** extra rows on the success screen */
  summary?: (c: MissionCtx) => [string, string][];
}
