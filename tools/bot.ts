// Headless difficulty bot: plays holes of the tour N times and reports the average strokes against par.
// Usage: npx tsx tools/bot.ts [runs] [L12 | course id | daily]
import { makeDaily } from '../src/sim/daily';
import { holeDef, ROUTE, ROUTE_LEN } from '../src/sim/route';
import { playHole } from './bot-lib';

const runs = Number(process.argv[2] ?? 4);
const only = process.argv[3];

function report(n: number) {
  const def = holeDef(n);
  const t0 = Date.now();
  const pro = Array.from({ length: Math.max(1, Math.ceil(runs / 3)) }, (_, r) => playHole(def, 'pro', 5 + r * 29).strokes);
  const cas = Array.from({ length: runs }, (_, r) => playHole(def, 'casual', 1 + r * 13).strokes);
  const avg = cas.reduce((a, b) => a + b, 0) / cas.length;
  const L = ROUTE[n - 1];
  console.log(
    `L${String(n).padEnd(3)} ${L.course.padEnd(8)} ${(L.intro ? 'intro' : L.champ ? 'CUP' : '').padEnd(5)} par ${def.par}  casual ${avg.toFixed(2)} (${(avg - def.par >= 0 ? '+' : '') + (avg - def.par).toFixed(2)}) [${cas.join(' ')}]  pro [${pro.join(' ')}]  ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
}

if (only !== 'daily')
  for (let n = 1; n <= ROUTE_LEN; n++) {
    const L = ROUTE[n - 1];
    if (only && only !== `L${n}` && only !== L.course) continue;
    report(n);
  }
if (!only || only === 'daily') {
  for (let k = 0; k < 3; k++) {
    const d = makeDaily(new Date(2026, 9, 3 + k));
    let tot = 0;
    let par = 0;
    for (const h of d.holes) {
      const r = playHole(h.hole, 'pro', 7, d.mods);
      tot += r.strokes;
      par += r.par;
    }
    console.log(`daily#${d.num} ${d.mod.key.padEnd(7)} ${d.holes.map((x) => `L${x.n}`).join(',')}  pro ${tot} (par ${par})`);
  }
}
