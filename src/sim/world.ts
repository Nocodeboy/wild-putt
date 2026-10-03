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
  private field: Float32Array | null = null;

  constructor(def: HoleDef, mods: HoleMods = {}) {
    this.def = def;
    this.mods = mods;
    const rows = mods.mirror ? def.map.map((r) => [...r].reverse().join('').replace(/[<>]/g, (c) => (c === '<' ? '>' : '<'))) : def.map;
    this.H = rows.length;
    this.W = Math.max(...rows.map((r) => r.length));
    const N = this.W * this.H;
    this.ground = new Uint8Array(N);
    this.slope = new Uint8Array(N);
    this.frictionMul = mods.friction ?? 1;
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
          default:
            throw new Error(`Hole ${def.id}: unknown char '${ch}' at ${x},${z}`);
        }
        this.ground[i] = g;
      }
    this.cup = cup;
    this.tee = tee;
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
    const g2 = this.groundAt(b.x, b.z);
    if (g2 === G.Water) return 'water';
    if (g2 === G.Void) return 'void';
    if (g2 === G.Lava) return 'lava';
    if (fx) {
      const sand = g2 === G.Sand;
      if (sand && !this.onSand) this.emit('sand', b.x, b.z);
      this.onSand = sand;
    }
    sp = Math.hypot(b.vx, b.vz);
    if (sp < 0.07) {
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
          if (cx < 0 || cz < 0 || cx >= this.W || cz >= this.H) continue;
          if (this.ground[cz * this.W + cx] !== G.Wall) continue;
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
  /** Putt the ball. angle: direction of travel (0 = +x, π/2 = +z); power 0..1. */
  shoot(angle: number, power: number) {
    if (this.state !== 'aim') return;
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
    }
    this.field = d;
    return d;
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
    if (ok(cx, cz) && !this.slope[cz * this.W + cx]) {
      // stay where it was, but clear of the walls
      return { x: Math.max(cx + BALL_R + 0.02, Math.min(cx + 1 - BALL_R - 0.02, x)), z: Math.max(cz + BALL_R + 0.02, Math.min(cz + 1 - BALL_R - 0.02, z)) };
    }
    let best = { x: this.tee.x, z: this.tee.z };
    let bd = Infinity;
    for (let gz = 0; gz < this.H; gz++)
      for (let gx = 0; gx < this.W; gx++) {
        if (!ok(gx, gz) || this.slope[gz * this.W + gx]) continue;
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
  previewPath(angle: number, power: number, maxLen: number): { x: number; z: number }[] {
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
        if (bounces > 1) break;
        maxLen = Math.min(maxLen, len + 1.6);
      }
    }
    return pts;
  }
}
