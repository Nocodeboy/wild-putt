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
    this.frictionMul = (mods.friction ?? 1) * (def.gravity ?? 1);
    this.cupR = CUP_R * (mods.cup ?? 1);
    let cup = { x: 1.5, z: 1.5 };
    let tee = { x: 1.5, z: this.H - 1.5 };
    const spinCells: { x: number; z: number }[] = [];
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
        if (nx < 0 || nz < 0 || nx >= this.W || nz >= this.H || this.ground[nz * this.W + nx] === G.Void) {
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
  }

  // ---------- helpers ----------
  private emit(type: SimEventType, x: number, z: number, n?: number) {
    this.events.push({ type, x, z, n });
  }
  groundAt(x: number, z: number): Ground {
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    if (cx < 0 || cz < 0 || cx >= this.W || cz >= this.H) return G.Void;
    return this.ground[cz * this.W + cx] as Ground;
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
    return this.ground[i] as Ground;
  }
  /** A cell the ball bounces off at time t (walls, and portcullises while they are down). */
  solid(cx: number, cz: number, t: number): boolean {
    if (cx < 0 || cz < 0 || cx >= this.W || cz >= this.H) return false;
    const i = cz * this.W + cx;
    return this.ground[i] === G.Wall || this.gateDown(this.dyn[i], t);
  }
  /** Cells where a ball must not be put back after a penalty (or left by the bot). */
  unsafe(i: number): boolean {
    return !!(this.slope[i] || this.dyn[i] || this.boost[i] || this.ramp[i]) || this.portals.some((p) => Math.floor(p.z) * this.W + Math.floor(p.x) === i);
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
    // walls: the solid grid cells around the ball (twice, for corners)
    for (let it = 0; it < 2; it++) {
      const x0 = Math.floor(b.x - R);
      const x1 = Math.floor(b.x + R);
      const z0 = Math.floor(b.z - R);
      const z1 = Math.floor(b.z + R);
      let best = 0;
      let bnx = 0;
      let bnz = 0;
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
          }
        }
      if (best <= 0) break;
      b.x += bnx * best;
      b.z += bnz * best;
      const v = this.bounce(b, bnx, bnz, 0.72);
      if (fx && v > 0.8 && t - this.lastWallT > 0.08) {
        this.lastWallT = t;
        this.emit('wall', b.x, b.z, v);
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
          if (this.ground[j] === G.Void) continue;
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

  /** Nearest cell centre (from x,z) where a ball can rest safely. */
  safeSpot(x: number, z: number): { x: number; z: number } {
    const ok = (gx: number, gz: number) => {
      if (gx < 0 || gz < 0 || gx >= this.W || gz >= this.H) return false;
      const g = this.ground[gz * this.W + gx];
      return g === G.Green || g === G.Sand || g === G.Ice;
    };
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    if (ok(cx, cz) && !this.unsafe(cz * this.W + cx)) {
      // stay where it was, but clear of the walls
      return { x: Math.max(cx + BALL_R + 0.02, Math.min(cx + 1 - BALL_R - 0.02, x)), z: Math.max(cz + BALL_R + 0.02, Math.min(cz + 1 - BALL_R - 0.02, z)) };
    }
    let best = { x: this.tee.x, z: this.tee.z };
    let bd = Infinity;
    for (let gz = 0; gz < this.H; gz++)
      for (let gx = 0; gx < this.W; gx++) {
        if (!ok(gx, gz) || this.unsafe(gz * this.W + gx)) continue;
        const d = Math.hypot(gx + 0.5 - x, gz + 0.5 - z) + Math.hypot(gx + 0.5 - this.cup.x, gz + 0.5 - this.cup.z) * 0.02;
        if (d < bd) {
          bd = d;
          best = { x: gx + 0.5, z: gz + 0.5 };
        }
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
