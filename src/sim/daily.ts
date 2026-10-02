import { ALL_HOLES } from './courses';
import { hashString, Rng } from './rng';
import type { CourseDef, HoleDef, HoleMods, Txt } from './types';

export const DAILY_EPOCH = Date.UTC(2026, 9, 3); // Daily #1 = 3 Oct 2026
export const DAILY_HOLES = 6;

export interface DailyModifier {
  key: 'none' | 'ice' | 'sticky' | 'wind' | 'mirror' | 'tiny';
  label: Txt;
}
const MODS: DailyModifier[] = [
  { key: 'none', label: { es: 'Recorrido clásico', en: 'Classic round' } },
  { key: 'ice', label: { es: 'Greens helados', en: 'Icy greens' } },
  { key: 'sticky', label: { es: 'Hierba alta', en: 'Long grass' } },
  { key: 'wind', label: { es: 'Viento', en: 'Windy' } },
  { key: 'mirror', label: { es: 'Espejo', en: 'Mirror' } },
  { key: 'tiny', label: { es: 'Hoyos pequeños', en: 'Tiny cups' } },
];

export interface Daily {
  num: number;
  key: string;
  holes: { course: CourseDef; hole: HoleDef }[];
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
  // one hole from each course, so every daily tours all the worlds
  const holes = [] as { course: CourseDef; hole: HoleDef }[];
  const byCourse = new Map<string, typeof ALL_HOLES>();
  for (const h of ALL_HOLES) {
    if (!byCourse.has(h.course.id)) byCourse.set(h.course.id, []);
    byCourse.get(h.course.id)!.push(h);
  }
  for (const list of byCourse.values()) {
    const pick = list[Math.floor(rng.next() * list.length)];
    holes.push({ course: pick.course, hole: pick.hole });
  }
  const mod = rng.pick(MODS);
  const ang = rng.range(0, Math.PI * 2);
  const mods: HoleMods = {
    friction: mod.key === 'ice' ? 0.55 : mod.key === 'sticky' ? 1.5 : 1,
    wind: mod.key === 'wind' ? { x: Math.cos(ang) * 0.9, z: Math.sin(ang) * 0.9 } : undefined,
    mirror: mod.key === 'mirror',
    cup: mod.key === 'tiny' ? 0.8 : 1,
  };
  return { num, key, holes: holes.slice(0, DAILY_HOLES), mods, mod };
}
