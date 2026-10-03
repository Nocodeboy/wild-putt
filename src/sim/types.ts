export type Lang = 'es' | 'en';
export type Txt = { es: string; en: string };

/** The 12 courses of the world tour, in the order they open (docs/diseno-v2.md §5.1). */
export const THEME_IDS = ['garden', 'roofs', 'ship', 'fair', 'glacier', 'volcano', 'beach', 'temple', 'castle', 'neon', 'canyon', 'moon'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

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
  /** beach: wet sand ('w') goes under water for part of every cycle */
  tide?: { period: number; phase: number; up: number };
  /** castle: portcullis cells ('G', and 'H' half a cycle later) are walls while down */
  gates?: { period: number; phase: number };
  /** castle: drawbridge cells ('=') are water while the bridge is up */
  bridge?: { period: number; phase: number };
  /** moon: × rolling friction for the whole hole */
  gravity?: number;
  /** coins lying on the green (cell centres) */
  coins?: [number, number][];
  /** the course it belongs to (generated holes) */
  course?: ThemeId;
}

export interface CourseDef {
  id: ThemeId;
  num: number;
  name: Txt;
  tip: Txt;
  /** the trophy of its cup hole */
  cup: Txt;
  /** its colour on the tour (route nodes, stamps, trophy) */
  color: string;
  /** hand-made holes: the first is the course's presentation, the others come on its next visits */
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
  y: number; // only for the visual drop into the cup / into a hazard, and the arc of a jump
  state: BallState;
  /** canyon / moon ramps: flight time left and the whole flight (s) */
  air?: number;
  airDur?: number;
  /** temple tunnels: the tunnel the ball just came out of (ignored until it rolls clear) */
  lock?: number;
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
  | 'portal' // n = tunnel the ball went into
  | 'boost' // n = speed after the boost
  | 'jump' // n = flight time
  | 'land'
  | 'flood' // the tide (or the drawbridge) caught the resting ball
  | 'coin' // n = coin index
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
