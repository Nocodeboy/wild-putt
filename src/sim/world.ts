import { closest, DX, DZ, fill, smooth, traceCorners, type Corner, type KeyPt, type Loop, type Prim } from './shape';
import type { Ball, Ground, HoleDef, HoleMods, SimEvent, SimEventType } from './types';
import { G } from './types';

// Wild Putt ball physics. The hole is a grid of 1×1 cells seen from above (x to the right, z towards the camera).
// The ball is a disc that rolls with friction that depends on the ground, gets pushed by slopes (and by the
// swaying deck of the ship), bounces off walls, bumpers, spinning beams and sliding blocks, and drops into the cup
// when it rolls over it slowly enough. Everything moving is a pure function of the hole's clock, so the bot can
// replay any shot from any moment exactly.

export const SIM_DT = 1 / 120;
export const BALL_R = 0.2;
const CUP_R = 0.32;
export const VMAX = 13; // speed of a full-power putt (cells/s)
const SINK_SPEED = 3.4; // faster than this over the cup: lip out
const SLOPE_ACC = 3.0;
const BUMPER_R = 0.36;
const BEAM_W = 0.14; // half thickness of a spinning beam
const STATIC = 2.0; // a resting ball stays put under pushes weaker than this
const MAX_ROLL = 25; // seconds: a roll never takes longer than this
const DROP_TIME = 0.75;
const BOOST_SPEED = 9; // a booster sends the ball off at least this fast (cells/s)
const JUMP_MIN = 3.2; // slower than this up a ramp: no take-off, the ball rolls off the edge
const WELL_R = 2.6; // reach of a gravity well
const WELL_K = 7; // its pull at the centre (cells/s²)
const WELL_CORE = 0.42; // the black hole in the middle (+1)
const PORTAL_R = 0.38;
/** fine samples per cell for the ground (the outlines are smooth, the grid is not) */
export const FINE = 8;
const MILL_BLOCK = 0.36; // a sail blocks the door this far (rad) either side of pointing straight down
const LOOP_MIN = 5.2; // slower than this into a loop-the-loop: it rolls back out
export const LOOP_R = 0.5;
const HILL_K = 9; // a mound pushes the ball down its sides: HILL_K × slope (cells/s²)

/** Cells that are more than their ground. */
export const K_BRIDGE = 1; // 'b': planks over the water, with low rails
export const K_MILL = 2; // 'W': the windmill's door (and K_HOUSE its walls)
export const K_HOUSE = 3;
export const K_LOOP = 4; // 'Q': a loop-the-loop (and K_LOOPWALL beside it)
export const K_LOOPWALL = 5;

/** The smooth outlines of the hole (shape.ts). */
export interface Shapes {
  walls: Loop[];
  /** the ground under the hole (everything but the void) */
  land: Loop[];
  /** ponds (and the water under the bridges) */
  pond: Loop[];
  sand: Loop[];
  ice: Loop[];
}

export interface Mill {
  x: number;
  z: number;
  /** 0: the ball goes through along x, 1: along z */
  ax: 0 | 1;
  /** the side the sails turn on (towards the tee) */
  front: 1 | -1;
  speed: number;
  phase: number;
}
export interface LoopQ {
  x: number;
  z: number;
  ax: 0 | 1;
}
export interface Hill {
  x: number;
  z: number;
  r: number;
  h: number;
}

/** Cells whose ground changes with the hole's clock. */
const DYN_TIDE = 1;
const DYN_BRIDGE = 2;
const DYN_GATE = 3;
const DYN_GATE2 = 4;

interface Friction {
  a: number; // constant deceleration
  k: number; // + k × speed
}
const FRICTION: Record<number, Friction> = {
  [G.Green]: { a: 1.7, k: 0.24 },
  [G.Sand]: { a: 7.5, k: 1.0 },
  [G.Ice]: { a: 0.3, k: 0.04 },
};

export interface Bumper {
  x: number;
  z: number;
  hit: number; // time of the last hit (visual)
}
export interface Spinner {
  x: number;
  z: number;
  len: number;
  speed: number;
  phase: number;
}
export interface Mover {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  hw: number; // half sizes
  hh: number;
  period: number;
  phase: number;
}

export type Outcome = 'rest' | 'sunk' | 'water' | 'void' | 'lava' | 'timeout' | 'roll';

export interface HoleResult {
  strokes: number;
  par: number;
  maxed: boolean;
}

function frac(x: number): number {
  return x - Math.floor(x);
}

/** Slope directions: 0 none, 1 towards -z (up the screen), 2 +z, 3 -x, 4 +x. */
const SLOPE_V: [number, number][] = [
  [0, 0],
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

export class Sim {
  readonly def: HoleDef;
  readonly mods: HoleMods;
  readonly W: number;
  readonly H: number;
  readonly ground: Uint8Array;
  readonly slope: Uint8Array;
  readonly cup: { x: number; z: number };
  readonly cupR: number;
  readonly tee: { x: number; z: number };
  readonly bumpers: Bumper[] = [];
  readonly spinners: Spinner[] = [];
  readonly movers: Mover[] = [];
  readonly maxStrokes: number;
  readonly frictionMul: number;
  /** tide, drawbridge and portcullis cells (DYN_*), 0 elsewhere */
  readonly dyn: Uint8Array;
  /** boosters: direction code (as slopes: 1 −z, 2 +z, 3 −x, 4 +x) */
  readonly boost: Uint8Array;
  /** ramps: direction code of the take-off (towards the void beside them) */
  readonly ramp: Uint8Array;
  /** tunnels, by pairs (0↔1, 2↔3…) */
  readonly portals: { x: number; z: number }[] = [];
  /** gravity wells (their black hole is a void cell) */
  readonly wells: { x: number; z: number }[] = [];
  /** bridges, windmills and loops: K_* per cell */
  readonly kind: Uint8Array;
  readonly mills: Mill[] = [];
  readonly loops: LoopQ[] = [];
  readonly hills: Hill[] = [];
  /** smooth outlines, the ground on a fine grid (FINE per cell) and what the ball bounces off */
  readonly shape: Shapes;
  readonly fine: Uint8Array;
  readonly prims: Prim[] = [];
  /** low rails along the sides of the bridges (also in prims) */
  readonly rails: { ax: number; az: number; bx: number; bz: number }[] = [];
  private bucketAt!: Int32Array;
  private bucket!: Int32Array;
  /** coins on the green, and the ones the real ball has rolled over this attempt */
  readonly coins: { x: number; z: number }[] = [];
  coinsGot: number[] = [];
  ball: Ball;
  strokes = 0;
  time = 0;
  rollT = 0;
  state: 'aim' | 'roll' | 'drop' | 'sunk' | 'done' = 'aim';
  result: HoleResult | null = null;
  events: SimEvent[] = [];
  /** where the ball last came to rest (penalties put it back there) */
  lastRest: { x: number; z: number };
  /** volcano: how far the lava has spread (flow distance from its sources) and that distance per cell */
  lavaLevel = 0;
  readonly lavaDist: Int16Array | null = null;
  private dropT = 0;
  private dropKind: 'water' | 'void' | 'lava' = 'water';
  private lipped = false;
  private lastWallT = -1;
  private onSand = false;
  private lastBoost = -1;
  private field: Float32Array | null = null;

  constructor(def: HoleDef, mods: HoleMods = {}) {
    this.def = def;
    this.mods = mods;
    const swap: Record<string, string> = { '<': '>', '>': '<', '4': '6', '6': '4' };
    const rows = mods.mirror ? def.map.map((r) => [...r].reverse().join('').replace(/[<>46]/g, (c) => swap[c])) : def.map;
    this.H = rows.length;
    this.W = Math.max(...rows.map((r) => r.length));
    const N = this.W * this.H;
    this.ground = new Uint8Array(N);
    this.slope = new Uint8Array(N);
    this.dyn = new Uint8Array(N);
    this.boost = new Uint8Array(N);
    this.ramp = new Uint8Array(N);
    this.kind = new Uint8Array(N);
    this.frictionMul = (mods.friction ?? 1) * (def.gravity ?? 1);
    this.cupR = CUP_R * (mods.cup ?? 1);
    let cup = { x: 1.5, z: 1.5 };
    let tee = { x: 1.5, z: this.H - 1.5 };
    const spinCells: { x: number; z: number }[] = [];
    const millCells: number[] = [];
    let hasLava = false;
    for (let z = 0; z < this.H; z++)
      for (let x = 0; x < this.W; x++) {
        const ch = rows[z][x] ?? ' ';
        const i = z * this.W + x;
        let g: Ground = G.Green;
        switch (ch) {
          case ' ':
            g = G.Void;
            break;
          case '#':
            g = G.Wall;
            break;
          case ':':
            g = G.Sand;
            break;
          case '~':
            g = G.Water;
            break;
          case '_':
            g = G.Ice;
            break;
          case 'L':
            g = G.Lava;
            hasLava = true;
            break;
          case '^':
            this.slope[i] = 1;
            break;
          case 'v':
            this.slope[i] = 2;
            break;
          case '<':
            this.slope[i] = 3;
            break;
          case '>':
            this.slope[i] = 4;
            break;
          case 'O':
            cup = { x: x + 0.5, z: z + 0.5 };
            break;
          case 'T':
            tee = { x: x + 0.5, z: z + 0.5 };
            break;
          case 'B':
            this.bumpers.push({ x: x + 0.5, z: z + 0.5, hit: -9 });
            break;
          case 'S':
            spinCells.push({ x: x + 0.5, z: z + 0.5 });
            break;
          case '.':
            break;
          case 'w':
            this.dyn[i] = DYN_TIDE;
            break;
          case '=':
            this.dyn[i] = DYN_BRIDGE;
            break;
          case 'G':
            this.dyn[i] = DYN_GATE;
            break;
          case 'H':
            this.dyn[i] = DYN_GATE2;
            break;
          case '8':
            this.boost[i] = 1;
            break;
          case '2':
            this.boost[i] = 2;
            break;
          case '4':
            this.boost[i] = 3;
            break;
          case '6':
            this.boost[i] = 4;
            break;
          case 'J':
            this.ramp[i] = 9; // direction worked out below, once the whole map is read
            break;
          case 'P':
            this.portals.push({ x: x + 0.5, z: z + 0.5 });
            break;
          case 'M':
            g = G.Void;
            this.wells.push({ x: x + 0.5, z: z + 0.5 });
            break;
          case 'b':
            this.kind[i] = K_BRIDGE;
            break;
          case 'W':
            this.kind[i] = K_MILL;
            millCells.push(i);
            break;
          case 'Q':
            this.kind[i] = K_LOOP;
            this.loops.push({ x: x + 0.5, z: z + 0.5, ax: 1 });
            break;
          default:
            throw new Error(`Hole ${def.id}: unknown char '${ch}' at ${x},${z}`);
        }
        this.ground[i] = g;
      }
    this.cup = cup;
    this.tee = tee;
    // ramps take off towards the void next to them
    for (let i = 0; i < N; i++) {
      if (this.ramp[i] !== 9) continue;
      const x = i % this.W;
      const z = (i - x) / this.W;
      this.ramp[i] = 0;
      for (let k = 1; k <= 4; k++) {
        const [dx, dz] = SLOPE_V[k];
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= this.W || nz >= this.H || this.ground[nz * this.W + nx] === G.Void || this.ground[nz * this.W + nx] === G.Water) {
          this.ramp[i] = k;
          break;
        }
      }
    }
    if (this.portals.length % 2) this.portals.pop();
    for (const [cx, cz] of def.coins ?? []) this.coins.push({ x: mods.mirror ? this.W - cx : cx, z: cz });
    spinCells.forEach((c, k) => {
      const s = def.spinners?.[k] ?? { len: 2, speed: 1.2 };
      this.spinners.push({ x: c.x, z: c.z, len: s.len, speed: mods.mirror ? -s.speed : s.speed, phase: s.phase ?? 0 });
    });
    for (const m of def.movers ?? []) {
      const mx = (x: number) => (mods.mirror ? this.W - x : x);
      this.movers.push({ x0: mx(m.x0), z0: m.z0, x1: mx(m.x1), z1: m.z1, hw: m.w / 2, hh: m.h / 2, period: m.period, phase: m.phase ?? 0 });
    }
    // windmills and loops: which way the ball goes through, and the walls beside them
    const wallAt = (x: number, z: number) => x >= 0 && z >= 0 && x < this.W && z < this.H && this.ground[z * this.W + x] === G.Wall;
    const axisOf = (i: number): 0 | 1 => {
      const x = i % this.W;
      const z = (i - x) / this.W;
      return wallAt(x - 1, z) && wallAt(x + 1, z) ? 1 : wallAt(x, z - 1) && wallAt(x, z + 1) ? 0 : 1;
    };
    const sides = (i: number, ax: 0 | 1, k: number) => {
      const x = i % this.W;
      const z = (i - x) / this.W;
      for (const s of [-1, 1]) {
        const nx = x + (ax === 1 ? s : 0);
        const nz = z + (ax === 0 ? s : 0);
        if (wallAt(nx, nz)) this.kind[nz * this.W + nx] = k;
      }
    };
    millCells.forEach((i, k) => {
      const ax = axisOf(i);
      sides(i, ax, K_HOUSE);
      const md = def.mills?.[k] ?? { speed: 1.1 };
      this.mills.push({ x: (i % this.W) + 0.5, z: Math.floor(i / this.W) + 0.5, ax, front: 1, speed: mods.mirror ? -md.speed : md.speed, phase: md.phase ?? 0 });
    });
    for (const L of this.loops) {
      const i = Math.floor(L.z) * this.W + Math.floor(L.x);
      L.ax = axisOf(i);
      sides(i, L.ax, K_LOOPWALL);
    }
    for (const [hx, hz, r, h] of def.hills ?? []) this.hills.push({ x: mods.mirror ? this.W - hx : hx, z: hz, r, h });
    this.maxStrokes = def.par + 3;
    this.ball = { x: tee.x, z: tee.z, vx: 0, vz: 0, y: 0, state: 'rest' };
    this.lastRest = { ...tee };
    if (hasLava && def.lavaRise) {
      // flow distance from the lava sources through open ground; the cup and its surroundings never melt
      const d = new Int16Array(N).fill(-1);
      const q: number[] = [];
      for (let i = 0; i < N; i++)
        if (this.ground[i] === G.Lava) {
          d[i] = 0;
          q.push(i);
        }
      for (let h = 0; h < q.length; h++) {
        const i = q[h];
        const x = i % this.W;
        const z = (i - x) / this.W;
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= this.W || nz >= this.H) continue;
          const j = nz * this.W + nx;
          if (d[j] >= 0 || this.ground[j] === G.Wall || this.ground[j] === G.Void) continue;
          d[j] = d[i] + 1;
          q.push(j);
        }
      }
      for (let i = 0; i < N; i++) {
        const x = (i % this.W) + 0.5;
        const z = Math.floor(i / this.W) + 0.5;
        if (Math.hypot(x - cup.x, z - cup.z) < 1.6) d[i] = -1;
      }
      this.lavaDist = d;
    }
    const sh = this.buildShapes();
    this.shape = sh.shape;
    this.fine = sh.fine;
    this.buildBuckets();
    // the sails turn on the side the ball comes from
    const pf = this.pathField();
    for (const m of this.mills) {
      const cx = Math.floor(m.x);
      const cz = Math.floor(m.z);
      const a = m.ax === 0 ? pf[cz * this.W + cx - 1] : pf[(cz - 1) * this.W + cx];
      const b = m.ax === 0 ? pf[cz * this.W + cx + 1] : pf[(cz + 1) * this.W + cx];
      m.front = (a ?? 1e9) > (b ?? 1e9) ? -1 : 1;
    }
  }

  // ---------- smooth outlines ----------
  /** Points the outlines must keep clear of. */
  private keyPoints(): KeyPt[] {
    const k: KeyPt[] = [
      { x: this.tee.x, z: this.tee.z, c: 0.34 },
      { x: this.cup.x, z: this.cup.z, c: this.cupR + 0.14 },
    ];
    for (const c of this.coins) k.push({ x: c.x, z: c.z, c: 0.32 });
    for (const b of this.bumpers) k.push({ x: b.x, z: b.z, c: BUMPER_R + 0.1 });
    for (const s of this.spinners) k.push({ x: s.x, z: s.z, c: 0.34 });
    for (const p of this.portals) k.push({ x: p.x, z: p.z, c: 0.48 });
    for (const w of this.wells) k.push({ x: w.x, z: w.z, c: 0.6 });
    for (const h of this.hills) k.push({ x: h.x, z: h.z, c: Math.max(0.4, h.r * 0.75) });
    return k;
  }

  private buildShapes(): { shape: Shapes; fine: Uint8Array } {
    const W = this.W;
    const H = this.H;
    const at = (x: number, z: number): number => (x < 0 || z < 0 || x >= W || z >= H ? G.Void : this.ground[z * W + x]);
    // cells whose corners stay square: the moving and special cells
    const prot = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) if (this.dyn[i] || this.boost[i] || this.ramp[i] || this.kind[i]) prot[i] = 1;
    const protect = (x: number, z: number) => x >= 0 && z >= 0 && x < W && z < H && prot[z * W + x] === 1;
    const keys = this.keyPoints();
    const gk = (x: number, z: number) => z * (W + 1) + x;
    // walls: wide fillets on the outside of a bend, concentric with the inside one when the bend has both
    const isWall = (x: number, z: number) => at(x, z) === G.Wall;
    const wc = traceCorners(W, H, isWall, protect);
    const wmap = new Map<number, Corner>();
    for (const l of wc) for (const c of l) wmap.set(gk(c.x, c.z), c);
    const wr = new Map<Corner, number>();
    for (const l of wc)
      for (const c of l) {
        if (c.turn !== -1 || c.sharp) continue;
        const dx = DX[c.dout] - DX[c.din];
        const dz = DZ[c.dout] - DZ[c.din];
        for (let k = 1; k <= 6; k++) {
          if (isWall(Math.floor(c.x + dx * (k - 0.5)), Math.floor(c.z + dz * (k - 0.5)))) break;
          const p = wmap.get(gk(c.x + dx * k, c.z + dz * k));
          if (!p || p.turn !== 1 || p.sharp || DX[p.din] - DX[p.dout] !== -dx || DZ[p.din] - DZ[p.dout] !== -dz) continue;
          if (k < 2) break;
          const ri = Math.max(0.8, Math.min(1.5, 0.3 * k));
          wr.set(c, k + ri);
          wr.set(p, Math.min(wr.get(p) ?? ri, ri));
          break;
        }
      }
    const walls = smooth(wc, { radius: (c) => wr.get(c) ?? (c.turn === 1 ? 0.9 : 2.4), keys, stairs: true });
    // the ground under the hole: its edge runs parallel to the walls' outline, one cell further out
    const lc = traceCorners(W, H, (x, z) => at(x, z) !== G.Void, protect);
    const land = smooth(lc, {
      radius: (c) => {
        const vx = DX[c.dout] - DX[c.din];
        const vz = DZ[c.dout] - DZ[c.din];
        if (c.turn === 1) {
          const o = wmap.get(gk(c.x + vx, c.z + vz));
          if (o && o.turn === -1 && isWall(Math.floor(c.x + vx * 0.5), Math.floor(c.z + vz * 0.5))) return (wr.get(o) ?? 2.4) + 1;
          return 1.2;
        }
        const ii = wmap.get(gk(c.x - vx, c.z - vz));
        if (ii && ii.turn === 1 && isWall(Math.floor(c.x - vx * 0.5), Math.floor(c.z - vz * 0.5))) return Math.max(0, (wr.get(ii) ?? 0.9) - 1);
        return 0.5;
      },
      keys,
      stairs: true,
    });
    // ponds, bunkers, ice: blobs, square where they meet a wall (the corner goes under the wall's own curve)
    const sharp = (x: number, z: number) => protect(x, z) || isWall(x, z);
    const blob = (cell: (x: number, z: number) => boolean, cvx: number, rfx: number) =>
      smooth(traceCorners(W, H, cell, sharp), { radius: (c) => (c.turn === 1 ? cvx : rfx), keys, protect: sharp, stairs: true });
    const inMap = (x: number, z: number) => x >= 0 && z >= 0 && x < W && z < H;
    const pond = blob((x, z) => inMap(x, z) && (at(x, z) === G.Water || this.dyn[z * W + x] === DYN_BRIDGE || this.kind[z * W + x] === K_BRIDGE), 0.9, 0.6);
    const sand = blob((x, z) => at(x, z) === G.Sand, 0.9, 0.6);
    const ice = blob((x, z) => at(x, z) === G.Ice, 1.2, 0.8);
    // the ground on the fine grid
    const S = FINE;
    const fine = new Uint8Array(W * S * H * S).fill(G.Green);
    fill(ice, W, H, S, fine, G.Ice);
    fill(sand, W, H, S, fine, G.Sand);
    fill(pond, W, H, S, fine, G.Water);
    fill(walls, W, H, S, fine, G.Wall);
    fill(land, W, H, S, fine, G.Void, true);
    // special cells keep their own ground, square; lava too (where it is not under a wall)
    for (let i = 0; i < W * H; i++) {
      const lava = this.ground[i] === G.Lava;
      if (!prot[i] && !lava) continue;
      const x = i % W;
      const z = (i - x) / W;
      for (let j = 0; j < S; j++)
        for (let k = 0; k < S; k++) {
          const f = (z * S + j) * W * S + x * S + k;
          if (!lava || fine[f] !== G.Wall) fine[f] = this.ground[i];
        }
    }
    // what the ball bounces off: the walls' outlines and the bridges' rails
    for (const l of walls) for (const p of l.prims) this.prims.push(p);
    for (let i = 0; i < W * H; i++) {
      if (this.kind[i] !== K_BRIDGE) continue;
      const x = i % W;
      const z = (i - x) / W;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d];
        const nz = z + DZ[d];
        const g = at(nx, nz);
        if (g !== G.Water && g !== G.Void) continue;
        if (inMap(nx, nz) && this.kind[nz * W + nx] === K_BRIDGE) continue;
        // the edge shared with the water
        const ex = d === 0 ? x + 1 : x;
        const ez = d === 1 ? z + 1 : z;
        const r = d === 0 || d === 2 ? { ax: ex, az: z, bx: ex, bz: z + 1 } : { ax: x, az: ez, bx: x + 1, bz: ez };
        this.rails.push(r);
        this.prims.push({ k: 0, ...r });
      }
    }
    return { shape: { walls, land, pond, sand, ice }, fine };
  }

  /** Which outline pieces are near each cell. */
  private buildBuckets() {
    const W = this.W;
    const H = this.H;
    const M = BALL_R + 0.16;
    const lists: number[][] = Array.from({ length: W * H }, () => []);
    this.prims.forEach((p, k) => {
      let x0: number;
      let x1: number;
      let z0: number;
      let z1: number;
      if (p.k === 0) {
        x0 = Math.min(p.ax, p.bx);
        x1 = Math.max(p.ax, p.bx);
        z0 = Math.min(p.az, p.bz);
        z1 = Math.max(p.az, p.bz);
      } else {
        x0 = z0 = Infinity;
        x1 = z1 = -Infinity;
        for (let i = 0; i <= 12; i++) {
          const a = p.a0 + (p.sw * i) / 12;
          const x = p.cx + Math.cos(a) * p.r;
          const z = p.cz + Math.sin(a) * p.r;
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          z0 = Math.min(z0, z);
          z1 = Math.max(z1, z);
        }
        // (the sag of the arc between two samples)
        const sag = p.r * (1 - Math.cos(Math.abs(p.sw) / 24));
        x0 -= sag;
        z0 -= sag;
        x1 += sag;
        z1 += sag;
      }
      for (let z = Math.max(0, Math.floor(z0 - M)); z <= Math.min(H - 1, Math.floor(z1 + M)); z++)
        for (let x = Math.max(0, Math.floor(x0 - M)); x <= Math.min(W - 1, Math.floor(x1 + M)); x++) lists[z * W + x].push(k);
    });
    this.bucketAt = new Int32Array(W * H + 1);
    let n = 0;
    lists.forEach((l, i) => {
      this.bucketAt[i] = n;
      n += l.length;
    });
    this.bucketAt[W * H] = n;
    this.bucket = new Int32Array(n);
    lists.forEach((l, i) => this.bucket.set(l, this.bucketAt[i]));
  }

  /** Distance from (x, z) to the nearest wall or rail within reach (capped at 1). */
  wallDist(x: number, z: number): number {
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    if (cx < 0 || cz < 0 || cx >= this.W || cz >= this.H) return 0;
    const i = cz * this.W + cx;
    let d = 1;
    for (let k = this.bucketAt[i]; k < this.bucketAt[i + 1]; k++) {
      const [px, pz] = closest(this.prims[this.bucket[k]], x, z);
      d = Math.min(d, Math.hypot(x - px, z - pz));
    }
    return d;
  }

  /** Ground on the fine grid (static: no tide, no drawbridge). */
  fineAt(x: number, z: number): Ground {
    if (x < 0 || z < 0 || x >= this.W || z >= this.H) return G.Void;
    return this.fine[Math.floor(z * FINE) * this.W * FINE + Math.floor(x * FINE)] as Ground;
  }

  // ---------- helpers ----------
  private emit(type: SimEventType, x: number, z: number, n?: number) {
    this.events.push({ type, x, z, n });
  }
  groundAt(x: number, z: number): Ground {
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    if (cx < 0 || cz < 0 || cx >= this.W || cz >= this.H) return G.Void;
    // (the lava spreads cell by cell)
    if (this.ground[cz * this.W + cx] === G.Lava) return G.Lava;
    return this.fine[Math.floor(z * FINE) * this.W * FINE + Math.floor(x * FINE)] as Ground;
  }
  slopeAt(x: number, z: number): number {
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    if (cx < 0 || cz < 0 || cx >= this.W || cz >= this.H) return 0;
    return this.slope[cz * this.W + cx];
  }
  /** Tide or drawbridge up at time t: the cell is water. */
  floodUp(kind: number, t: number): boolean {
    if (kind === DYN_TIDE) {
      const c = this.def.tide ?? { period: 8, phase: 0, up: 0.45 };
      return frac(t / c.period + c.phase) < c.up;
    }
    if (kind === DYN_BRIDGE) {
      const c = this.def.bridge ?? { period: 8, phase: 0 };
      return frac(t / c.period + c.phase) < 0.4;
    }
    return false;
  }
  /** How far the tide / bridge is through its cycle (0..1), for the visuals. */
  cycle(kind: number, t: number): number {
    if (kind === DYN_TIDE) {
      const c = this.def.tide ?? { period: 8, phase: 0, up: 0.45 };
      return frac(t / c.period + c.phase);
    }
    if (kind === DYN_BRIDGE) {
      const c = this.def.bridge ?? { period: 8, phase: 0 };
      return frac(t / c.period + c.phase);
    }
    const c = this.def.gates ?? { period: 5, phase: 0 };
    return frac(t / c.period + c.phase + (kind === DYN_GATE2 ? 0.5 : 0));
  }
  /** A portcullis is down (a wall) for the first half of its cycle. */
  gateDown(kind: number, t: number): boolean {
    return (kind === DYN_GATE || kind === DYN_GATE2) && this.cycle(kind, t) < 0.5;
  }
  /** Ground under (x, z) at time t: the tide and the drawbridge turn cells to water. */
  groundAtT(x: number, z: number, t: number): Ground {
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    if (cx < 0 || cz < 0 || cx >= this.W || cz >= this.H) return G.Void;
    const i = cz * this.W + cx;
    const k = this.dyn[i];
    if ((k === DYN_TIDE || k === DYN_BRIDGE) && this.floodUp(k, t)) return G.Water;
    return this.groundAt(x, z);
  }
  /** A portcullis cell that is down at time t (the walls themselves are smooth outlines: see prims). */
  solid(cx: number, cz: number, t: number): boolean {
    if (cx < 0 || cz < 0 || cx >= this.W || cz >= this.H) return false;
    return this.gateDown(this.dyn[cz * this.W + cx], t);
  }
  /** Cells where a ball must not be put back after a penalty (or left by the bot). */
  unsafe(i: number): boolean {
    const k = this.kind[i];
    return !!(this.slope[i] || this.dyn[i] || this.boost[i] || this.ramp[i] || k === K_MILL || k === K_LOOP) || this.portals.some((p) => Math.floor(p.z) * this.W + Math.floor(p.x) === i);
  }
  /** A windmill's sail is down across its door at time t. */
  millBlocked(m: Mill, t: number): boolean {
    const q = Math.PI / 2;
    const u = ((((m.phase + m.speed * t + q) % q) + q) % q);
    return Math.min(u, q - u) < MILL_BLOCK;
  }
  /** The windmill's sails' angle (for the visuals): a sail points straight down when this is −π/2 (mod π/2). */
  millAngle(m: Mill, t: number): number {
    return m.phase + m.speed * t;
  }
  /** Height of the ground (the mounds) at (x, z). */
  heightAt(x: number, z: number): number {
    let y = 0;
    for (const h of this.hills) {
      const d = Math.hypot(x - h.x, z - h.z);
      if (d < h.r) y += h.h * 0.5 * (1 + Math.cos((Math.PI * d) / h.r));
    }
    return y;
  }

  /** The deck's sideways tilt right now (ship), as an acceleration along x. */
  swayAt(t: number): number {
    const s = this.def.sway;
    return s ? s.amp * Math.sin((t / s.period) * Math.PI * 2) : 0;
  }
  spinnerAngle(s: Spinner, t: number): number {
    return s.phase + s.speed * t;
  }
  moverPos(m: Mover, t: number): { x: number; z: number; vx: number; vz: number } {
    const w = (Math.PI * 2) / m.period;
    const u = 0.5 - 0.5 * Math.cos(w * t + m.phase * Math.PI * 2);
    const du = 0.5 * Math.sin(w * t + m.phase * Math.PI * 2) * w;
    return { x: m.x0 + (m.x1 - m.x0) * u, z: m.z0 + (m.z1 - m.z0) * u, vx: (m.x1 - m.x0) * du, vz: (m.z1 - m.z0) * du };
  }
  private external(x: number, z: number, t: number): [number, number] {
    const sv = SLOPE_V[this.slopeAt(x, z)];
    let ax = sv[0] * SLOPE_ACC + this.swayAt(t);
    let az = sv[1] * SLOPE_ACC;
    for (const h of this.hills) {
      const dx = x - h.x;
      const dz = z - h.z;
      const d = Math.hypot(dx, dz);
      if (d >= h.r || d < 1e-6) continue;
      // down the side of the mound
      const a = HILL_K * h.h * (Math.PI / (2 * h.r)) * Math.sin((Math.PI * d) / h.r);
      ax += (dx / d) * a;
      az += (dz / d) * a;
    }
    const w = this.mods.wind;
    if (w) {
      ax += w.x;
      az += w.z;
    }
    return [ax, az];
  }
  isHazard(g: Ground): boolean {
    return g === G.Water || g === G.Void || g === G.Lava;
  }

  // ---------- one physics step for any ball (also used by the bot) ----------
  /**
   * Advance a rolling ball by dt at hole time t. Returns what happened. With `fx`, it reports bounces as events
   * (the real ball); the bot's imaginary balls run silently.
   */
  integrate(b: Ball, t: number, dt: number, fx = false): Outcome {
    if (b.loop) return this.loopStep(b, dt);
    // in the air (a ramp jump): no friction, no slopes, no hazards until it lands
    if (b.air && b.air > 0) {
      b.air -= dt;
      const dur = b.airDur ?? 0.5;
      const u = 1 - Math.max(0, b.air) / dur;
      b.y = 4 * (0.3 + dur * 0.55) * u * (1 - u);
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      b.x = Math.max(BALL_R, Math.min(this.W - BALL_R, b.x));
      b.z = Math.max(BALL_R, Math.min(this.H - BALL_R, b.z));
      if (b.air > 0) return 'roll';
      b.air = 0;
      b.y = 0;
      // a landing knocks some speed off
      b.vx *= 0.82;
      b.vz *= 0.82;
      if (fx) this.emit('land', b.x, b.z);
      const gl = this.groundAtT(b.x, b.z, t);
      if (gl === G.Void) return 'void';
      if (gl === G.Water) return 'water';
      if (gl === G.Lava) return 'lava';
      if (gl === G.Wall) {
        // landed on top of a rail or a block: it drops back onto the green beside it
        const p = this.safeSpot(b.x, b.z);
        b.x = p.x;
        b.z = p.z;
      }
      return 'roll';
    }
    let sp = Math.hypot(b.vx, b.vz);
    const g = this.groundAt(b.x, b.z);
    const [ex, ez] = this.external(b.x, b.z, t);
    // forces: slopes and sway push, friction drags against the motion
    const fr = FRICTION[g] ?? FRICTION[G.Green];
    const decel = (fr.a + fr.k * sp) * this.frictionMul;
    if (sp > 1e-6) {
      const nx = b.vx / sp;
      const nz = b.vz / sp;
      const drop = Math.min(sp, decel * dt);
      b.vx -= nx * drop;
      b.vz -= nz * drop;
    }
    b.vx += ex * dt;
    b.vz += ez * dt;
    // gravity wells pull the ball in; their black hole swallows it
    for (const w of this.wells) {
      const dx = w.x - b.x;
      const dz = w.z - b.z;
      const d = Math.hypot(dx, dz);
      if (d < WELL_CORE) return 'void';
      if (d < WELL_R) {
        const a = WELL_K * (1 - d / WELL_R);
        b.vx += (dx / d) * a * dt;
        b.vz += (dz / d) * a * dt;
      }
    }
    // the cup: slow balls are pulled in and drop, fast ones lip out
    const dcx = this.cup.x - b.x;
    const dcz = this.cup.z - b.z;
    const dc = Math.hypot(dcx, dcz);
    sp = Math.hypot(b.vx, b.vz);
    if (dc < this.cupR + 0.1 && sp < SINK_SPEED) {
      const pull = 5 * dt;
      b.vx += (dcx / (dc || 1)) * pull;
      b.vz += (dcz / (dc || 1)) * pull;
    }
    if (dc < this.cupR) {
      if (sp < SINK_SPEED) return 'sunk';
      if (fx && !this.lipped) {
        this.lipped = true;
        this.emit('lip', b.x, b.z);
      }
      // rattling over the edge slows it and nudges it off line
      b.vx *= 0.985;
      b.vz *= 0.985;
    } else if (dc > this.cupR + 0.3) this.lipped = false;
    // move
    b.x += b.vx * dt;
    b.z += b.vz * dt;
    this.collide(b, t, dt, fx);
    const ci = Math.floor(b.z) * this.W + Math.floor(b.x);
    const inMap = b.x >= 0 && b.z >= 0 && b.x < this.W && b.z < this.H;
    // boosters: at least BOOST_SPEED in their direction, and most of the sideways speed goes
    const bo = inMap ? this.boost[ci] : 0;
    if (bo) {
      const [dx, dz] = SLOPE_V[bo];
      const along = b.vx * dx + b.vz * dz;
      const side = b.vx * -dz + b.vz * dx;
      const na = Math.max(along, BOOST_SPEED);
      if (fx && along < BOOST_SPEED - 0.5 && this.lastBoost !== ci) this.emit('boost', b.x, b.z, na);
      if (fx) this.lastBoost = ci;
      b.vx = dx * na + -dz * side * 0.55;
      b.vz = dz * na + dx * side * 0.55;
    } else if (fx) this.lastBoost = -1;
    // ramps: fast enough towards the edge, the ball takes off
    const rp = inMap ? this.ramp[ci] : 0;
    if (rp) {
      const [dx, dz] = SLOPE_V[rp];
      const along = b.vx * dx + b.vz * dz;
      if (along > JUMP_MIN) {
        const dur = Math.min(1.15, 0.16 + along * 0.075) * (this.def.gravity ? 1.35 : 1);
        b.air = b.airDur = dur;
        if (fx) this.emit('jump', b.x, b.z, dur);
        return 'roll';
      }
    }
    // loop-the-loop: round it if fast enough, otherwise it rolls back out
    for (let k = 0; k < this.loops.length; k++) {
      const L = this.loops[k];
      const s = L.ax === 0 ? b.x - L.x : b.z - L.z;
      const lat = L.ax === 0 ? b.z - L.z : b.x - L.x;
      if (Math.abs(s) >= 0.42 || Math.abs(lat) >= 0.5) continue;
      const va = L.ax === 0 ? b.vx : b.vz;
      const v = Math.abs(va);
      const ok = v >= LOOP_MIN;
      const dir = va > 0 || (va === 0 && s < 0) ? 1 : -1;
      const th = Math.PI * Math.min(0.92, (v / LOOP_MIN) ** 2);
      b.loop = { k, t: 0, dur: ok ? Math.max(0.45, (1 + 2 * Math.PI * LOOP_R) / (0.8 * v)) : 0.45 + 0.35 * (th / Math.PI), dir, ok, v };
      if (fx) this.emit('loop', L.x, L.z, ok ? 1 : 0);
      return this.loopStep(b, 0);
    }
    // tunnels: in through one, out of its pair with the same speed
    if (this.portals.length) {
      if (b.lock !== undefined && Math.hypot(b.x - this.portals[b.lock].x, b.z - this.portals[b.lock].z) > 0.62) b.lock = undefined;
      for (let k = 0; k < this.portals.length; k++) {
        if (k === b.lock) continue;
        const p = this.portals[k];
        if (Math.hypot(b.x - p.x, b.z - p.z) >= PORTAL_R) continue;
        const o = this.portals[k ^ 1];
        const v = Math.hypot(b.vx, b.vz) || 1;
        b.x = o.x + (b.vx / v) * 0.05;
        b.z = o.z + (b.vz / v) * 0.05;
        b.lock = k ^ 1;
        if (fx) this.emit('portal', p.x, p.z, k);
        break;
      }
    }
    // coins (only the real ball collects them)
    if (fx)
      for (let k = 0; k < this.coins.length; k++) {
        if (this.coinsGot.includes(k)) continue;
        const c = this.coins[k];
        if (Math.hypot(b.x - c.x, b.z - c.z) < 0.42) {
          this.coinsGot.push(k);
          this.emit('coin', c.x, c.z, k);
        }
      }
    const g2 = this.groundAtT(b.x, b.z, t);
    if (g2 === G.Water) return 'water';
    if (g2 === G.Void) return 'void';
    if (g2 === G.Lava) return 'lava';
    if (fx) {
      const sand = g2 === G.Sand;
      if (sand && !this.onSand) this.emit('sand', b.x, b.z);
      this.onSand = sand;
    }
    sp = Math.hypot(b.vx, b.vz);
    if (sp < 0.07 && !bo) {
      const [ax, az] = this.external(b.x, b.z, t);
      if (Math.hypot(ax, az) < STATIC * this.frictionMul || g2 === G.Sand) {
        b.vx = b.vz = 0;
        return 'rest';
      }
    }
    return 'roll';
  }

  /** Round the loop (or up it and back): the ball follows the track; it comes out on the far side, or back. */
  private loopStep(b: Ball, dt: number): Outcome {
    const lp = b.loop!;
    const L = this.loops[lp.k];
    lp.t += dt;
    const u = Math.min(1, lp.t / lp.dur);
    let s: number;
    let y: number;
    if (lp.ok) {
      s = -0.5 + u + LOOP_R * Math.sin(2 * Math.PI * u);
      y = LOOP_R * (1 - Math.cos(2 * Math.PI * u));
    } else {
      const th = Math.PI * Math.min(0.92, (lp.v / LOOP_MIN) ** 2) * Math.sin(Math.PI * u);
      s = -0.5 + LOOP_R * Math.sin(th);
      y = LOOP_R * (1 - Math.cos(th));
    }
    const ux = L.ax === 0 ? lp.dir : 0;
    const uz = L.ax === 0 ? 0 : lp.dir;
    b.x = L.x + ux * s;
    b.z = L.z + uz * s;
    b.y = y;
    // (the speed along the track, for the rolling ball and the trail)
    const v = lp.ok ? lp.v * 0.85 : lp.v * Math.cos(Math.PI * u);
    b.vx = ux * v;
    b.vz = uz * v;
    if (u < 1) return 'roll';
    b.y = 0;
    b.loop = undefined;
    if (lp.ok) {
      b.x = L.x + ux * 0.52;
      b.z = L.z + uz * 0.52;
      b.vx = ux * lp.v * 0.78;
      b.vz = uz * lp.v * 0.78;
    } else {
      const back = Math.max(1.6, lp.v * 0.7);
      b.x = L.x - ux * 0.52;
      b.z = L.z - uz * 0.52;
      b.vx = -ux * back;
      b.vz = -uz * back;
    }
    return 'roll';
  }

  private bounce(b: Ball, nx: number, nz: number, rest: number, ovx = 0, ovz = 0): number {
    // reflect the velocity relative to the obstacle along the contact normal
    const rvx = b.vx - ovx;
    const rvz = b.vz - ovz;
    const vn = rvx * nx + rvz * nz;
    if (vn >= 0) return 0;
    b.vx = rvx - (1 + rest) * vn * nx + ovx;
    b.vz = rvz - (1 + rest) * vn * nz + ovz;
    // a bit of tangential damping on every bounce
    const vt = (b.vx - ovx) * -nz + (b.vz - ovz) * nx;
    b.vx -= -nz * vt * 0.04;
    b.vz -= nx * vt * 0.04;
    return -vn;
  }

  private collide(b: Ball, t: number, dt: number, fx: boolean) {
    const R = BALL_R;
    // walls: the smooth outlines near the ball, the portcullises that are down and the windmills' sails (twice, for
    // corners)
    for (let it = 0; it < 2; it++) {
      const x0 = Math.floor(b.x - R);
      const x1 = Math.floor(b.x + R);
      const z0 = Math.floor(b.z - R);
      const z1 = Math.floor(b.z + R);
      let best = 0;
      let bnx = 0;
      let bnz = 0;
      let rest = 0.72;
      let sail = -1;
      const cx0 = Math.floor(b.x);
      const cz0 = Math.floor(b.z);
      if (cx0 >= 0 && cz0 >= 0 && cx0 < this.W && cz0 < this.H) {
        const i = cz0 * this.W + cx0;
        for (let k = this.bucketAt[i]; k < this.bucketAt[i + 1]; k++) {
          const [px, pz] = closest(this.prims[this.bucket[k]], b.x, b.z);
          const dx = b.x - px;
          const dz = b.z - pz;
          const d = Math.hypot(dx, dz);
          if (d >= R || d < 1e-9 || R - d <= best) continue;
          best = R - d;
          bnx = dx / d;
          bnz = dz / d;
        }
      }
      this.mills.forEach((m, k) => {
        if (!this.millBlocked(m, t)) return;
        // the sail: a board right across the front of the door
        const fx0 = m.ax === 0 ? m.x + m.front * 0.5 : m.x - 0.5;
        const fz0 = m.ax === 0 ? m.z - 0.5 : m.z + m.front * 0.5;
        const fx1 = m.ax === 0 ? fx0 : m.x + 0.5;
        const fz1 = m.ax === 0 ? m.z + 0.5 : fz0;
        const [px, pz] = closest({ k: 0, ax: fx0, az: fz0, bx: fx1, bz: fz1 }, b.x, b.z);
        const dx = b.x - px;
        const dz = b.z - pz;
        const d = Math.hypot(dx, dz);
        if (d >= R + 0.06 || d < 1e-9 || R + 0.06 - d <= best) return;
        best = R + 0.06 - d;
        bnx = dx / d;
        bnz = dz / d;
        rest = 0.5;
        sail = k;
      });
      for (let cz = z0; cz <= z1; cz++)
        for (let cx = x0; cx <= x1; cx++) {
          if (!this.solid(cx, cz, t)) continue;
          const px = Math.max(cx, Math.min(b.x, cx + 1));
          const pz = Math.max(cz, Math.min(b.z, cz + 1));
          let dx = b.x - px;
          let dz = b.z - pz;
          let d = Math.hypot(dx, dz);
          if (d >= R) continue;
          if (d < 1e-6) {
            // centre inside the wall (should not happen): push out the nearest way
            dx = b.x - (cx + 0.5);
            dz = b.z - (cz + 0.5);
            d = Math.hypot(dx, dz) || 1;
          }
          const pen = R - d;
          if (pen > best) {
            best = pen;
            bnx = dx / d;
            bnz = dz / d;
            rest = 0.72;
            sail = -1;
          }
        }
      if (best <= 0) break;
      b.x += bnx * best;
      b.z += bnz * best;
      const v = this.bounce(b, bnx, bnz, rest);
      if (fx && v > 0.8 && t - this.lastWallT > 0.08) {
        this.lastWallT = t;
        if (sail >= 0) this.emit('mill', b.x, b.z, sail);
        else this.emit('wall', b.x, b.z, v);
      }
    }
    // bumpers: bouncy round posts
    this.bumpers.forEach((p, k) => {
      const dx = b.x - p.x;
      const dz = b.z - p.z;
      const d = Math.hypot(dx, dz);
      const min = R + BUMPER_R;
      if (d >= min || d < 1e-6) return;
      const nx = dx / d;
      const nz = dz / d;
      b.x = p.x + nx * min;
      b.z = p.z + nz * min;
      const v = this.bounce(b, nx, nz, 1.0);
      // kick: a bumper always sends the ball off with some speed
      const out = b.vx * nx + b.vz * nz;
      if (out < 4.5) {
        b.vx += nx * (4.5 - out);
        b.vz += nz * (4.5 - out);
      }
      if (fx) {
        p.hit = t;
        this.emit('bumper', b.x, b.z, k);
      }
      void v;
    });
    // spinning beams
    this.spinners.forEach((s, k) => {
      const a = this.spinnerAngle(s, t);
      const ux = Math.cos(a);
      const uz = Math.sin(a);
      const rx = b.x - s.x;
      const rz = b.z - s.z;
      const along = Math.max(-s.len, Math.min(s.len, rx * ux + rz * uz));
      const px = s.x + ux * along;
      const pz = s.z + uz * along;
      let dx = b.x - px;
      let dz = b.z - pz;
      const d = Math.hypot(dx, dz);
      const min = R + BEAM_W;
      if (d >= min) return;
      if (d < 1e-6) {
        dx = -uz;
        dz = ux;
      }
      const dd = d < 1e-6 ? 1 : d;
      const nx = dx / dd;
      const nz = dz / dd;
      b.x = px + nx * min;
      b.z = pz + nz * min;
      // the beam's own velocity at the contact point
      const ovx = -s.speed * (pz - s.z);
      const ovz = s.speed * (px - s.x);
      const v = this.bounce(b, nx, nz, 0.6, ovx, ovz);
      if (fx && v > 0.6 && t - this.lastWallT > 0.08) {
        this.lastWallT = t;
        this.emit('spinner', b.x, b.z, k);
      }
    });
    // sliding blocks
    this.movers.forEach((m, k) => {
      const p = this.moverPos(m, t);
      const qx = Math.max(p.x - m.hw, Math.min(b.x, p.x + m.hw));
      const qz = Math.max(p.z - m.hh, Math.min(b.z, p.z + m.hh));
      let dx = b.x - qx;
      let dz = b.z - qz;
      let d = Math.hypot(dx, dz);
      if (d >= R) return;
      if (d < 1e-6) {
        // the block ran over the ball's centre: push it out along the block's motion
        const sp = Math.hypot(p.vx, p.vz) || 1;
        dx = p.vx / sp;
        dz = p.vz / sp;
        d = 0;
        b.x = (Math.abs(dx) > Math.abs(dz) ? p.x + Math.sign(dx) * (m.hw + R) : b.x);
        b.z = (Math.abs(dz) >= Math.abs(dx) ? p.z + Math.sign(dz) * (m.hh + R) : b.z);
      } else {
        dx /= d;
        dz /= d;
        b.x += dx * (R - d);
        b.z += dz * (R - d);
      }
      const v = this.bounce(b, dx, dz, 0.6, p.vx, p.vz);
      if (fx && v > 0.6 && t - this.lastWallT > 0.08) {
        this.lastWallT = t;
        this.emit('mover', b.x, b.z, k);
      }
      void dt;
    });
    // never leave the map
    b.x = Math.max(R, Math.min(this.W - R, b.x));
    b.z = Math.max(R, Math.min(this.H - R, b.z));
  }

  // ---------- the real ball ----------
  /** Where things stood before the last putt (for the mulligan). */
  private snap: { x: number; z: number; strokes: number; lavaLevel: number; ground: Uint8Array | null; lastRest: { x: number; z: number }; coins: number[] } | null = null;

  /** The last putt can be taken again (the ball has settled and the hole is not over). */
  canMulligan(): boolean {
    return !!this.snap && this.state === 'aim' && this.strokes > 0;
  }
  /** Mulligan: back to before the last putt (ball, strokes, lava and coins); the hole's clock runs on. */
  mulligan(): boolean {
    const p = this.snap;
    if (!p || !this.canMulligan()) return false;
    const b = this.ball;
    b.x = p.x;
    b.z = p.z;
    b.vx = b.vz = 0;
    b.y = 0;
    b.air = 0;
    b.lock = undefined;
    b.state = 'rest';
    this.strokes = p.strokes;
    this.lavaLevel = p.lavaLevel;
    if (p.ground) this.ground.set(p.ground);
    this.lastRest = { ...p.lastRest };
    this.coinsGot = [...p.coins];
    this.snap = null;
    this.events.push({ type: 'rest', x: b.x, z: b.z });
    return true;
  }

  /** Putt the ball. angle: direction of travel (0 = +x, π/2 = +z); power 0..1. */
  shoot(angle: number, power: number) {
    if (this.state !== 'aim') return;
    this.snap = { x: this.ball.x, z: this.ball.z, strokes: this.strokes, lavaLevel: this.lavaLevel, ground: this.lavaDist ? this.ground.slice() : null, lastRest: { ...this.lastRest }, coins: [...this.coinsGot] };
    const p = Math.max(0.04, Math.min(1, power));
    const v = VMAX * p;
    this.ball.vx = Math.cos(angle) * v;
    this.ball.vz = Math.sin(angle) * v;
    this.ball.state = 'roll';
    this.state = 'roll';
    this.rollT = 0;
    this.strokes++;
    this.lipped = false;
    this.onSand = false;
    this.emit('putt', this.ball.x, this.ball.z, p);
  }

  step() {
    if (this.state === 'done') return;
    const dt = SIM_DT;
    this.time += dt;
    if (this.state === 'aim' && this.dyn.length) {
      // the tide (or the drawbridge) comes up under a resting ball: +1, as if it had rolled in
      const b = this.ball;
      if (this.groundAtT(b.x, b.z, this.time) === G.Water) {
        this.state = 'drop';
        b.state = 'drop';
        this.dropKind = 'water';
        this.dropT = 0;
        this.emit('flood', b.x, b.z);
        return;
      }
    }
    if (this.state === 'roll') {
      this.rollT += dt;
      const b = this.ball;
      const out = this.rollT > MAX_ROLL ? 'rest' : this.integrate(b, this.time, dt, true);
      if (out === 'sunk') {
        b.state = 'sunk';
        b.vx = b.vz = 0;
        b.x = this.cup.x;
        b.z = this.cup.z;
        this.state = 'sunk';
        this.dropT = 0;
        this.emit('sunk', b.x, b.z, this.strokes);
      } else if (out === 'water' || out === 'void' || out === 'lava') {
        this.state = 'drop';
        b.state = 'drop';
        this.dropKind = out;
        this.dropT = 0;
        this.emit(out, b.x, b.z);
      } else if (out === 'rest') {
        b.state = 'rest';
        this.lastRest = { x: b.x, z: b.z };
        this.emit('rest', b.x, b.z);
        this.afterStroke();
      }
    } else if (this.state === 'drop') {
      this.dropT += dt;
      const b = this.ball;
      b.y = this.dropKind === 'void' ? -this.dropT * this.dropT * 9 : -Math.min(0.3, this.dropT * 0.8);
      b.vx *= 0.9;
      b.vz *= 0.9;
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      if (this.dropT >= DROP_TIME) {
        // one stroke penalty, back to where it was
        this.strokes++;
        const p = this.safeSpot(this.lastRest.x, this.lastRest.z);
        b.x = p.x;
        b.z = p.z;
        b.y = 0;
        b.vx = b.vz = 0;
        b.state = 'rest';
        this.afterStroke();
      }
    } else if (this.state === 'sunk') {
      this.dropT += dt;
      this.ball.y = -Math.min(0.35, this.dropT * 1.6);
      if (this.dropT > 0.6) this.finish(false);
    }
  }

  /** After a stroke settles: lava spreads, then the next stroke (or the hole ends at the stroke limit). */
  private afterStroke() {
    this.state = 'aim';
    if (this.lavaDist && this.def.lavaRise) {
      this.lavaLevel += this.def.lavaRise;
      let grew = false;
      for (let i = 0; i < this.ground.length; i++) {
        const d = this.lavaDist[i];
        if (d > 0 && d <= this.lavaLevel && this.ground[i] !== G.Lava) {
          this.ground[i] = G.Lava;
          grew = true;
        }
      }
      if (grew) this.emit('lavaRise', this.ball.x, this.ball.z, this.lavaLevel);
      const b = this.ball;
      if (this.groundAt(b.x, b.z) === G.Lava) {
        // the lava reached the ball: +1 and out of it
        this.strokes++;
        this.emit('lava', b.x, b.z);
        const p = this.safeSpot(b.x, b.z);
        b.x = p.x;
        b.z = p.z;
        this.lastRest = { ...p };
      }
    }
    if (this.strokes >= this.maxStrokes) {
      this.emit('maxed', this.ball.x, this.ball.z);
      this.finish(true);
    }
  }

  /** Walking distance to the cup from every cell (through green, sand and ice; hazards and walls blocked). */
  pathField(): Float32Array {
    if (this.field) return this.field;
    const N = this.W * this.H;
    const d = new Float32Array(N).fill(1e9);
    const done = new Uint8Array(N);
    const open = (i: number) => {
      const g = this.ground[i];
      return g === G.Green || g === G.Sand || g === G.Ice;
    };
    d[Math.floor(this.cup.z) * this.W + Math.floor(this.cup.x)] = 0;
    for (;;) {
      let u = -1;
      let bd = 1e9;
      for (let i = 0; i < N; i++)
        if (!done[i] && d[i] < bd) {
          bd = d[i];
          u = i;
        }
      if (u < 0) break;
      done[u] = 1;
      const x = u % this.W;
      const z = (u - x) / this.W;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= this.W || nz >= this.H) continue;
          const j = nz * this.W + nx;
          if (!open(j)) continue;
          if (dx && dz && (!open(z * this.W + nx) || !open(nz * this.W + x))) continue;
          const c = (dx && dz ? 1.414 : 1) * (this.ground[j] === G.Sand ? 1.8 : 1);
          if (d[u] + c < d[j]) d[j] = d[u] + c;
        }
      // (the field runs from the cup outwards: a cell reaches the cup through a tunnel or over a jump)
      for (const [j, c] of this.links(u)) if (d[u] + c < d[j]) d[j] = d[u] + c;
    }
    this.field = d;
    return d;
  }

  /** Cells that lead into cell u without rolling there: the far end of a tunnel, a ramp that jumps onto it. */
  private linkCache: Map<number, [number, number][]> | null = null;
  links(u: number): [number, number][] {
    if (!this.linkCache) {
      const m = new Map<number, [number, number][]>();
      const add = (to: number, from: number, c: number) => {
        if (!m.has(to)) m.set(to, []);
        m.get(to)!.push([from, c]);
      };
      const cell = (p: { x: number; z: number }) => Math.floor(p.z) * this.W + Math.floor(p.x);
      for (let k = 0; k + 1 < this.portals.length; k += 2) {
        const a = cell(this.portals[k]);
        const b = cell(this.portals[k + 1]);
        add(a, b, 1);
        add(b, a, 1);
      }
      for (let i = 0; i < this.ramp.length; i++) {
        const r = this.ramp[i];
        if (!r) continue;
        const [dx, dz] = SLOPE_V[r];
        const x = i % this.W;
        const z = (i - x) / this.W;
        for (let k = 2; k <= 6; k++) {
          const nx = x + dx * k;
          const nz = z + dz * k;
          if (nx < 0 || nz < 0 || nx >= this.W || nz >= this.H) break;
          const j = nz * this.W + nx;
          if (this.ground[j] === G.Void || this.ground[j] === G.Water) continue;
          if (this.ground[j] === G.Green || this.ground[j] === G.Sand || this.ground[j] === G.Ice) add(j, i, k);
          break;
        }
      }
      this.linkCache = m;
    }
    return this.linkCache.get(u) ?? [];
  }

  /**
   * Which way a player would naturally look from (x, z): along the walking path to the cup, a few cells ahead
   * (so on a dogleg the camera looks down the fairway, not through the wall). Angle in the x/z plane.
   */
  guideAngle(x: number, z: number): number {
    const d = this.pathField();
    let cx = Math.floor(x);
    let cz = Math.floor(z);
    if (d[cz * this.W + cx] >= 1e8) return Math.atan2(this.cup.z - z, this.cup.x - x);
    for (let k = 0; k < 5; k++) {
      let best = d[cz * this.W + cx];
      let bx = cx;
      let bz = cz;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= this.W || nz >= this.H) continue;
          const v = d[nz * this.W + nx];
          if (v < best) {
            best = v;
            bx = nx;
            bz = nz;
          }
        }
      if (bx === cx && bz === cz) break;
      cx = bx;
      cz = bz;
      // straight line of sight to the cup from here: look at the cup itself
      if (best === 0) break;
    }
    const tx = d[cz * this.W + cx] === 0 ? this.cup.x : cx + 0.5;
    const tz = d[cz * this.W + cx] === 0 ? this.cup.z : cz + 0.5;
    if (Math.hypot(tx - x, tz - z) < 0.3) return Math.atan2(this.cup.z - z, this.cup.x - x);
    return Math.atan2(tz - z, tx - x);
  }

  /** Can a ball rest at (x, z): on safe ground all round, clear of the walls, not on the side of a mound. */
  restable(x: number, z: number): boolean {
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    if (cx < 0 || cz < 0 || cx >= this.W || cz >= this.H) return false;
    const i = cz * this.W + cx;
    const g0 = this.ground[i];
    if ((g0 !== G.Green && g0 !== G.Sand && g0 !== G.Ice) || this.unsafe(i)) return false;
    for (const [ox, oz] of [
      [0, 0],
      [0.26, 0],
      [-0.26, 0],
      [0, 0.26],
      [0, -0.26],
    ]) {
      const g = this.fineAt(x + ox, z + oz);
      if (g !== G.Green && g !== G.Sand && g !== G.Ice) return false;
    }
    if (this.wallDist(x, z) < BALL_R + 0.04) return false;
    if (this.hills.length) {
      const [ax, az] = this.external(x, z, 0);
      if (Math.hypot(ax - this.swayAt(0), az) >= STATIC * 0.9) return false;
    }
    return true;
  }

  /** Nearest point (from x,z) where a ball can rest safely. */
  safeSpot(x: number, z: number): { x: number; z: number } {
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    if (this.restable(x, z)) return { x, z };
    // the same cell, a little further from its edges
    const cl = { x: Math.max(cx + 0.3, Math.min(cx + 0.7, x)), z: Math.max(cz + 0.3, Math.min(cz + 0.7, z)) };
    if (this.restable(cl.x, cl.z)) return cl;
    let best = { x: this.tee.x, z: this.tee.z };
    let bd = Infinity;
    for (let gz = 0; gz < this.H; gz++)
      for (let gx = 0; gx < this.W; gx++)
        for (const [ox, oz] of [
          [0.5, 0.5],
          [0.27, 0.27],
          [0.73, 0.27],
          [0.27, 0.73],
          [0.73, 0.73],
        ]) {
          const px = gx + ox;
          const pz = gz + oz;
          const d = Math.hypot(px - x, pz - z) + Math.hypot(px - this.cup.x, pz - this.cup.z) * 0.02 + (ox === 0.5 ? 0 : 0.05);
          if (d >= bd || !this.restable(px, pz)) continue;
          bd = d;
          best = { x: px, z: pz };
        }
    return best;
  }

  private finish(maxed: boolean) {
    this.state = 'done';
    this.result = { strokes: Math.min(this.strokes, this.maxStrokes), par: this.def.par, maxed };
  }

  /**
   * Where would a putt end up if hit at time t0 from (x, z)? For the aim preview and the bot.
   * Returns the outcome, the resting point and the path (every `every` steps) if asked.
   */
  simulate(x: number, z: number, angle: number, power: number, t0: number, path?: { x: number; z: number }[], every = 6, maxT = MAX_ROLL): { out: Outcome; x: number; z: number; t: number } {
    const v = VMAX * Math.max(0.04, Math.min(1, power));
    const b: Ball = { x, z, vx: Math.cos(angle) * v, vz: Math.sin(angle) * v, y: 0, state: 'roll' };
    let t = t0;
    let n = 0;
    while (t - t0 < maxT) {
      t += SIM_DT;
      const out = this.integrate(b, t, SIM_DT, false);
      if (path && n++ % every === 0) path.push({ x: b.x, z: b.z });
      if (out !== 'roll') return { out, x: b.x, z: b.z, t };
    }
    return { out: 'timeout', x: b.x, z: b.z, t };
  }

  /** The first stretch of a putt until its first bounce (the aim line shows only this much). */
  previewPath(angle: number, power: number, maxLen: number, maxBounces = 1): { x: number; z: number }[] {
    const v = VMAX * Math.max(0.04, Math.min(1, power));
    const b: Ball = { x: this.ball.x, z: this.ball.z, vx: Math.cos(angle) * v, vz: Math.sin(angle) * v, y: 0, state: 'roll' };
    const pts = [{ x: b.x, z: b.z }];
    let len = 0;
    let t = this.time;
    let bounces = 0;
    for (let i = 0; i < 1800 && len < maxLen; i++) {
      const pvx = b.vx;
      const pvz = b.vz;
      t += SIM_DT;
      const px = b.x;
      const pz = b.z;
      const out = this.integrate(b, t, SIM_DT, false);
      len += Math.hypot(b.x - px, b.z - pz);
      if (i % 3 === 0) pts.push({ x: b.x, z: b.z });
      if (out !== 'roll') break;
      // stop the line a short way after the first bounce
      if ((pvx * b.vx + pvz * b.vz) < 0.6 * Math.hypot(pvx, pvz) * Math.hypot(b.vx, b.vz)) {
        bounces++;
        if (bounces > maxBounces) break;
        if (bounces === maxBounces) maxLen = Math.min(maxLen, len + 1.6);
      }
    }
    return pts;
  }
}
