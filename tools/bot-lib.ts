import { Bot, SKILL_CASUAL, SKILL_PRO } from '../src/sim/bot';
import type { HoleDef, HoleMods } from '../src/sim/types';
import { Sim } from '../src/sim/world';

/** Play one hole with the bot from a moment that depends on the seed (moving obstacles). */
export function playHole(def: HoleDef, skill: 'pro' | 'casual', seed: number, mods: HoleMods = {}) {
  const sim = new Sim(def, mods);
  for (let i = 0; i < (seed % 97) * 3; i++) sim.step();
  const bot = new Bot(sim, skill === 'pro' ? SKILL_PRO : SKILL_CASUAL, seed);
  let guard = 0;
  while (sim.state !== 'done' && guard++ < 120 * 400) {
    bot.update();
    sim.step();
    sim.events.length = 0;
  }
  return sim.result ?? { strokes: def.par + 4, par: def.par, maxed: true };
}
