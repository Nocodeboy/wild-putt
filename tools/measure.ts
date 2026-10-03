// How hard a hole is, measured with the bot (docs/diseno-v2.md §5.4). Shared by tools/route-table.ts and tools/bot.ts.
import type { RouteLevel } from '../src/sim/route';
import type { HoleDef, HoleMods } from '../src/sim/types';
import { playHole } from './bot-lib';

export const CASUAL_RUNS = 8;
export const PRO_RUNS = 2;
/** Room to count strokes while the par is still unknown. */
const MEASURE_PAR = 6;

export interface Measure {
  casual: number[];
  pro: number[];
  casualMean: number;
  proMax: number;
}

export function measure(def: HoleDef, champ = false, mods: HoleMods = {}): Measure {
  const d = { ...def, par: MEASURE_PAR };
  const casual: number[] = [];
  const pro: number[] = [];
  for (let r = 0; r < CASUAL_RUNS; r++) casual.push(playHole(d, 'casual', 1 + r * 13, mods).strokes);
  for (let r = 0; r < PRO_RUNS; r++) pro.push(playHole(d, 'pro', 5 + r * 29, mods).strokes);
  void champ;
  return { casual, pro, casualMean: casual.reduce((a, b) => a + b, 0) / casual.length, proMax: Math.max(...pro) };
}

/** Par: the casual bot's average rounded up from .35, between 2 and 5, never below the PRO's worst + 1. */
export function parFrom(m: Measure): number {
  return Math.max(2, Math.min(5, Math.max(Math.floor(m.casualMean + 0.65), m.proMax + 1)));
}

/** Is this layout fair for its place on the route? `bad` ranks the rejects (lower is closer to fair). */
export function verdict(m: Measure, L: Pick<RouteLevel, 'n' | 'champ' | 'd'>): { ok: boolean; bad: number; why: string } {
  const par = parFrom(m);
  const maxed = m.casual.filter((s) => s >= par + 3).length;
  const why: string[] = [];
  let bad = 0;
  if (maxed > 1) {
    why.push(`casual picked up ${maxed}×`);
    bad += maxed;
  }
  if (m.casualMean > 4.6) {
    why.push(`casual mean ${m.casualMean.toFixed(2)}`);
    bad += m.casualMean - 4.6;
  }
  if (m.proMax > (L.champ ? 3 : 2)) {
    why.push(`pro ${m.proMax}`);
    bad += m.proMax - 2;
  }
  // too easy for its place on the route (the cup holes, a bit more)
  const floor = L.n <= 8 ? 0 : 1.5 + 1.1 * Math.min(1, L.d) + (L.champ ? 0.4 : 0);
  if (m.casualMean < floor) {
    why.push(`too easy (${m.casualMean.toFixed(2)} < ${floor.toFixed(2)})`);
    bad += floor - m.casualMean;
  }
  return { ok: why.length === 0, bad, why: why.join(', ') || 'ok' };
}
