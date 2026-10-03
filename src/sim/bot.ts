import { G } from './types';
import type { Sim } from './world';

export interface BotSkill {
  angles: number; // directions tried in the coarse search
  powers: number; // power levels tried
  refine: boolean; // fine search around the best coarse shot
  aimNoise: number; // radians of random error on the chosen shot
  powerNoise: number; // fraction of random error on the power
  delay: number; // seconds between "ready" and the putt (planning ahead for moving obstacles)
}
export const SKILL_PRO: BotSkill = { angles: 144, powers: 16, refine: true, aimNoise: 0, powerNoise: 0, delay: 0.6 };
/** Roughly a first-time player: picks a sensible line but misses by a few degrees and some power. */
export const SKILL_CASUAL: BotSkill = { angles: 72, powers: 10, refine: true, aimNoise: 0.07, powerNoise: 0.15, delay: 0.6 };
/** Behind the menus: cheap enough for a phone, still plays nicely. */
export const SKILL_DEMO: BotSkill = { angles: 60, powers: 9, refine: true, aimNoise: 0, powerNoise: 0, delay: 1.2 };

interface Cand {
  a: number;
  p: number;
}

/**
 * Putting bot. For every stroke it tries many putts (direction × power) on an imaginary copy of the ball, starting
 * at the exact moment it will hit (so moving obstacles and the swaying deck are taken into account), and scores
 * where each one ends with the walking distance to the cup through the hole. It plays the same game as the player:
 * it only calls sim.shoot(). The search runs in slices so the menu demo never freezes the page.
 */
export class Bot {
  private dist: Float32Array;
  private rnd: () => number;
  private queue: Cand[] = [];
  private best: Cand | null = null;
  private bestScore = Infinity;
  private planT = 0;
  private stage: 'idle' | 'coarse' | 'fine' | 'wait' = 'idle';
  private fromX = 0;
  private fromZ = 0;

  constructor(
    private sim: Sim,
    private skill: BotSkill,
    seed = 1,
  ) {
    let s = (seed * 2654435761) >>> 0 || 1;
    this.rnd = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    this.dist = sim.pathField();
  }

  private value(x: number, z: number): number {
    const s = this.sim;
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    const v = this.dist[cz * s.W + cx];
    if (v >= 1e8) return 60;
    // inside the cup's own cell: use the real distance
    if (v === 0) return Math.hypot(x - s.cup.x, z - s.cup.z) * 0.8;
    return v + Math.hypot(x - (cx + 0.5), z - (cz + 0.5)) * 0.3;
  }

  private score(c: Cand): number {
    const s = this.sim;
    const r = s.simulate(this.fromX, this.fromZ, c.a, c.p, this.planT);
    if (r.out === 'sunk') return -100 + c.p; // softest putt that drops
    if (r.out === 'water' || r.out === 'void' || r.out === 'lava') return this.value(this.fromX, this.fromZ) + 2.5;
    if (r.out === 'timeout') return this.value(r.x, r.z) + 1;
    // resting where the tide or the drawbridge comes up, or on a moving part: risky
    const ri = Math.floor(r.z) * s.W + Math.floor(r.x);
    if (s.dyn[ri]) return this.value(r.x, r.z) + (s.dyn[ri] <= 2 ? 1.6 : 0.4);
    // lava that will spread over the resting point next stroke
    if (s.lavaDist && s.def.lavaRise) {
      const i = Math.floor(r.z) * s.W + Math.floor(r.x);
      const d = s.lavaDist[i];
      if (d > 0 && d <= s.lavaLevel + s.def.lavaRise) return this.value(r.x, r.z) + 2.5;
    }
    return this.value(r.x, r.z);
  }

  private begin() {
    const s = this.sim;
    const k = this.skill;
    this.fromX = s.ball.x;
    this.fromZ = s.ball.z;
    this.planT = s.time + k.delay;
    this.queue = [];
    for (let i = 0; i < k.angles; i++)
      for (let j = 0; j < k.powers; j++) this.queue.push({ a: (i / k.angles) * Math.PI * 2, p: 0.08 + (0.92 * (j + 0.5)) / k.powers });
    this.best = null;
    this.bestScore = Infinity;
    this.stage = 'coarse';
  }

  /** Spend at most `budget` simulated putts thinking; returns true once the bot has putted this frame. */
  update(budget = 1e9): boolean {
    const s = this.sim;
    if (s.state !== 'aim') {
      this.stage = 'idle';
      return false;
    }
    if (this.stage === 'idle') this.begin();
    while ((this.stage === 'coarse' || this.stage === 'fine') && budget-- > 0) {
      const c = this.queue.pop();
      if (!c) {
        if (this.stage === 'coarse' && this.skill.refine && this.best && this.bestScore > -50) {
          const b = this.best;
          const da = (Math.PI * 2) / this.skill.angles;
          const dp = 0.92 / this.skill.powers;
          for (let i = -4; i <= 4; i++) for (let j = -3; j <= 3; j++) this.queue.push({ a: b.a + (i * da) / 4, p: Math.max(0.05, Math.min(1, b.p + (j * dp) / 3)) });
          this.stage = 'fine';
          continue;
        }
        this.stage = 'wait';
        break;
      }
      const v = this.score(c);
      if (v < this.bestScore) {
        this.bestScore = v;
        this.best = c;
      }
    }
    if (this.stage !== 'wait') return false;
    if (s.time + 1e-9 < this.planT) return false;
    const b = this.best ?? { a: -Math.PI / 2, p: 0.5 };
    const a = b.a + (this.rnd() - 0.5) * 2 * this.skill.aimNoise;
    const p = b.p * (1 + (this.rnd() - 0.5) * 2 * this.skill.powerNoise);
    s.shoot(a, p);
    this.stage = 'idle';
    return true;
  }
}
