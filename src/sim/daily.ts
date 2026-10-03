import { hashString, Rng } from './rng';
import { holeDef, ROUTE, ROUTE_LEN } from './route';
import type { HoleDef, HoleMods, ThemeId, Txt } from './types';

// The daily round (docs/diseno-v2.md §5.9): six holes of the route from six different courses, the same for
// everybody, with a modifier. No aim-line upgrade and no mulligan.

export const DAILY_EPOCH = Date.UTC(2026, 9, 3); // Daily #1 = 3 Oct 2026
export const DAILY_HOLES = 6;

export interface DailyModifier {
  key: 'none' | 'ice' | 'sticky' | 'wind' | 'mirror' | 'tiny';
  label: Txt;
}
export const MODS: DailyModifier[] = [
  { key: 'none', label: { es: 'Recorrido clásico', en: 'Classic round' } },
  { key: 'ice', label: { es: 'Greens helados', en: 'Icy greens' } },
  { key: 'sticky', label: { es: 'Hierba alta', en: 'Long grass' } },
  { key: 'wind', label: { es: 'Viento', en: 'Windy' } },
  { key: 'mirror', label: { es: 'Espejo', en: 'Mirror' } },
  { key: 'tiny', label: { es: 'Hoyos pequeños', en: 'Tiny cups' } },
];

export interface DailyHole {
  n: number;
  course: ThemeId;
  hole: HoleDef;
}
export interface Daily {
  num: number;
  key: string;
  holes: DailyHole[];
  mods: HoleMods;
  mod: DailyModifier;
}

export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dailyNumber(d = new Date()): number {
  const local = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.max(1, Math.floor((local - DAILY_EPOCH) / 86400000) + 1);
}

/** Same 6 holes and modifier for everybody on the same day. */
export function makeDaily(d = new Date(), salt = 0): Daily {
  const key = dayKey(d);
  const num = dailyNumber(d);
  const rng = new Rng(hashString('wildputt-' + key + (salt ? '#' + salt : '')));
  // candidates: ordinary holes of the route (no presentations, no cups), from the 3rd on
  const pool = ROUTE.filter((L) => L.n >= 3 && L.n <= ROUTE_LEN && !L.intro && !L.champ);
  const courses = [...new Set(pool.map((L) => L.course))];
  for (let i = courses.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [courses[i], courses[j]] = [courses[j], courses[i]];
  }
  const holes: DailyHole[] = courses.slice(0, DAILY_HOLES).map((c) => {
    const L = rng.pick(pool.filter((x) => x.course === c));
    return { n: L.n, course: c, hole: holeDef(L.n) };
  });
  // easiest first: the round warms up
  holes.sort((a, b) => a.hole.par - b.hole.par || a.n - b.n);
  const mod = rng.pick(MODS);
  const ang = rng.range(0, Math.PI * 2);
  const mods: HoleMods = {
    friction: mod.key === 'ice' ? 0.55 : mod.key === 'sticky' ? 1.5 : 1,
    wind: mod.key === 'wind' ? { x: Math.cos(ang) * 0.9, z: Math.sin(ang) * 0.9 } : undefined,
    mirror: mod.key === 'mirror',
    cup: mod.key === 'tiny' ? 0.8 : 1,
  };
  return { num, key, holes, mods, mod };
}
