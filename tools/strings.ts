// Every English text of the game, for the dictionaries in src/locales/ (Portuguese, French, German, Italian).
// Usage: npx tsx tools/strings.ts [lang]   → prints the texts missing from src/locales/<lang>.json (all of them without a lang)
import { readFileSync } from 'node:fs';
import { BALLS } from '../src/economy';
import { MORE_GAMES } from '../src/crosspromo';
import { STRINGS } from '../src/i18n';
import { COURSES } from '../src/sim/courses';
import { MODS } from '../src/sim/daily';
import { ROUTE_TIPS } from '../src/sim/route';

export function allStrings(): string[] {
  const out = new Set<string>();
  for (const v of Object.values(STRINGS)) out.add(v.en);
  for (const c of COURSES) {
    out.add(c.name.en);
    out.add(c.tip.en);
    out.add(c.cup.en);
    for (const h of c.holes) {
      out.add(h.name.en);
      if (h.tip) out.add(h.tip.en);
    }
  }
  for (const m of MODS) out.add(m.label.en);
  for (const b of BALLS) out.add(b.name.en);
  for (const g of MORE_GAMES) out.add(g.tag.en);
  for (const tip of ROUTE_TIPS) out.add(tip.en);
  return [...out];
}

const lang = process.argv[2];
const all = allStrings();
if (!lang) console.log(JSON.stringify(all, null, 1));
else {
  const d = JSON.parse(readFileSync(new URL(`../src/locales/${lang}.json`, import.meta.url), 'utf8')) as Record<string, string>;
  const missing = all.filter((s) => d[s] === undefined);
  const extra = Object.keys(d).filter((k) => !all.includes(k));
  console.log(JSON.stringify({ missing, extra }, null, 1));
}
