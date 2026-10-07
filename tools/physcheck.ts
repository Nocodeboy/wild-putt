// QA: plays every hole of the tour with the casual bot and reports balls that come to rest inside a wall, off the
// ground or overlapping the outline, and holes the bot cannot finish. Usage: npx tsx tools/physcheck.ts [runs] [from] [to]
import { Bot, SKILL_CASUAL } from '../src/sim/bot';
import { holeDef, ROUTE_LEN } from '../src/sim/route';
import { G } from '../src/sim/types';
import { BALL_R, Sim } from '../src/sim/world';

const runs = Number(process.argv[2] ?? 2);
const from = Number(process.argv[3] ?? 1);
const to = Number(process.argv[4] ?? ROUTE_LEN);
let bad = 0;
for (let n = from; n <= to; n++) {
  const def = { ...holeDef(n), par: 6 };
  for (let r = 0; r < runs; r++) {
    const sim = new Sim(def);
    for (let i = 0; i < r * 37; i++) sim.step();
    const bot = new Bot(sim, SKILL_CASUAL, 1 + r * 13);
    let guard = 0;
    while (sim.state !== 'done' && guard++ < 120 * 400) {
      bot.update();
      sim.step();
      for (const e of sim.events) {
        if (e.type !== 'rest') continue;
        const g = sim.fineAt(e.x, e.z);
        const wd = sim.wallDist(e.x, e.z);
        if (g === G.Wall || g === G.Void || wd < BALL_R - 0.03) {
          bad++;
          console.log(`L${n} run ${r}: rest at ${e.x.toFixed(2)},${e.z.toFixed(2)} ground ${g} wallDist ${wd.toFixed(2)}`);
        }
      }
      sim.events.length = 0;
    }
    if (!sim.result || sim.result.maxed) console.log(`L${n} run ${r}: picked up (${sim.result?.strokes})`);
  }
}
console.log(`done: ${bad} bad rests`);
