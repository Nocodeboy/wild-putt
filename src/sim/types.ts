export type Lang = 'es' | 'en';
export type Txt = { es: string; en: string };

export type ThemeId = 'garden' | 'roofs' | 'ship' | 'fair' | 'glacier' | 'volcano';

/** A rotating beam (windmill paddle) around a centre cell. */
export interface SpinnerDef {
  len: number; // half length of the beam (cells)
  speed: number; // rad/s (negative = clockwise)
  phase?: number;
}

/** A block sliding back and forth between two points. */
export interface MoverDef {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  w: number; // size (cells)
  h: number;
  period: number; // seconds for a full back-and-forth
  phase?: number; // 0..1
}

export interface HoleDef {
  id: string;
  name: Txt;
  tip?: Txt;
  par: number;
  map: string[];
  spinners?: SpinnerDef[]; // one per 'S' in reading order
  movers?: MoverDef[];
  /** ship: the deck tilts left/right, a slope that changes with time */
  sway?: { amp: number; period: number };
  /** volcano: the lava spreads this many cells after every stroke */
  lavaRise?: number;
}

export interface CourseDef {
  id: ThemeId;
  num: number;
  name: Txt;
  tip: Txt;
  holes: HoleDef[];
}

// Ground types
export const G = {
  Void: 0, // no ground: the ball falls (+1)
  Green: 1,
  Sand: 2,
  Water: 3, // hazard (+1)
  Ice: 4,
  Lava: 5, // hazard (+1)
  Wall: 6,
} as const;
export type Ground = (typeof G)[keyof typeof G];

export type BallState = 'rest' | 'roll' | 'sunk' | 'drop';

export interface Ball {
  x: number;
  z: number;
  vx: number;
  vz: number;
  y: number; // only for the visual drop into the cup / into a hazard
  state: BallState;
}

export type SimEventType =
  | 'putt' // n = power 0..1
  | 'wall' // n = impact speed
  | 'bumper' // n = bumper index
  | 'spinner' // n = spinner index
  | 'mover' // n = mover index
  | 'lip' // rolled over the cup too fast
  | 'sunk' // n = strokes
  | 'water'
  | 'void'
  | 'lava'
  | 'sand'
  | 'lavaRise'
  | 'rest'
  | 'maxed'; // ran out of strokes: picked up

export interface SimEvent {
  type: SimEventType;
  x: number;
  z: number;
  n?: number;
}

/** A modifier for the daily round. */
export interface HoleMods {
  friction?: number; // × rolling friction
  wind?: { x: number; z: number }; // constant push (cells/s²)
  mirror?: boolean;
  cup?: number; // × cup radius
}
