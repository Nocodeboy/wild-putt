// Headless difficulty bot: plays every hole N times and reports the average strokes against par.
// Usage: npx tsx tools/bot.ts [runs] [holeId|daily]
import { Bot, SKILL_CASUAL, SKILL_PRO, type BotSkill } from '../src/sim/bot';
import { ALL_HOLES } from '../src/sim/courses';
import { makeDaily } from '../src/sim/daily';
import type { HoleDef, HoleMods } from '../src/sim/types';
import { playHole as play } from './bot-lib';

const runs = Number(process.argv[2] ?? 4);
const only = process.argv[3];

function playHole(def: HoleDef, skill: BotSkill, seed: number, mods: HoleMods = {}) {
  return play(def, skill === SKILL_PRO ? 'pro' : 'casual', seed, mods);
}

function report(name: string, def: HoleDef, skill: BotSkill, mods: HoleMods = {}) {
  const res = [];
  const t0 = Date.now();
  for (let r = 0; r < runs; r++) res.push(playHole(def, skill, 1 + r * 13, mods));
  const avg = res.reduce((a, b) => a + b.strokes, 0) / runs;
  const hist = res.map((r) => r.strokes).join(' ');
  console.log(`${name.padEnd(22)} par ${def.par}  avg ${avg.toFixed(2).padStart(5)}  (${(avg - def.par >= 0 ? '+' : '') + (avg - def.par).toFixed(2)})  [${hist}]  ${((Date.now() - t0) / runs / 1000).toFixed(1)}s/run`);
}

for (const { course, hole } of ALL_HOLES) {
  if (only && only !== hole.id && only !== course.id) continue;
  report(`${hole.id} PRO`, hole, SKILL_PRO);
  report(`${hole.id} casual`, hole, SKILL_CASUAL);
}
if (!only || only === 'daily') {
  for (let k = 0; k < 3; k++) {
    const d = makeDaily(new Date(2026, 9, 3 + k));
    let tot = 0;
    let par = 0;
    for (const hd of d.holes) {
      const r = playHole(hd.hole, SKILL_PRO, 7, d.mods);
      tot += r.strokes;
      par += r.par;
    }
    console.log(`daily#${d.num} ${d.mod.key.padEnd(7)} ${d.holes.map((x) => x.hole.id).join(',')}  ${tot} (par ${par})`);
  }
}
