import { COURSES } from './courses';
import { generate } from './gen';
import { hashString, Rng } from './rng';
import { ROUTE_TABLE } from './routeTable';
import type { CourseDef, HoleDef, ThemeId, Txt } from './types';

// The world tour: a route of 120 holes mixing the courses, never two in a row in the same place
// (docs/diseno-v2.md §5.2). Everything comes from fixed seeds, so every device gets the same route and the same holes.

/** Full route length once the 12 courses exist; the difficulty curve is always laid out on it. */
export const FULL_LEN = 120;
/** Courses in this build: the ones with their presentation hole drawn. */
export const READY: CourseDef[] = COURSES.filter((c) => c.holes.length > 0);
/** Holes in this build: 10 per course that exists. */
export const ROUTE_LEN = Math.min(FULL_LEN, READY.length * 10);
/** Holes where the next course of the tour opens. The courses that exist take the first slots. */
export const UNLOCK = [1, 2, 5, 9, 14, 21, 27, 35, 44, 55, 67, 81];

export interface RouteLevel {
  n: number;
  id: string;
  course: ThemeId;
  /** first hole on a new course (its presentation, drawn by hand) */
  intro: boolean;
  /** the course's cup hole (every 10 holes) */
  champ: boolean;
  /** earlier holes on this course */
  visit: number;
  seed: number;
  /** difficulty, 0 (first hole) to ~1.1 */
  d: number;
  /** hand-made hole for this slot (presentation and the next visits), if any */
  hand: HoleDef | null;
}

export function courseById(id: ThemeId): CourseDef {
  return COURSES.find((c) => c.id === id)!;
}

function buildRoute(): RouteLevel[] {
  const courses = READY;
  const unlock = new Map<ThemeId, number>();
  courses.forEach((c, i) => unlock.set(c.id, UNLOCK[i]));
  const introAt = new Map<number, CourseDef>();
  for (const c of courses) introAt.set(unlock.get(c.id)!, c);
  /** cup hole k is the one of the k-th course */
  const champCourse = (k: number) => courses[(k - 1) % courses.length];
  const forced = (n: number): CourseDef | null => introAt.get(n) ?? (n % 10 === 0 ? champCourse(n / 10) : null);
  const r = new Rng(hashString('wildputt/route/v2'));
  const visits = new Map<ThemeId, number>();
  const out: RouteLevel[] = [];
  let prev: ThemeId | null = null;
  let prev2: ThemeId | null = null;

  for (let n = 1; n <= ROUTE_LEN; n++) {
    let c = introAt.get(n) ?? null;
    const intro = !!c;
    const champ = !intro && n % 10 === 0;
    if (!c && champ) c = champCourse(n / 10);
    if (!c) {
      const next = forced(n + 1);
      const open = courses.filter((x) => unlock.get(x.id)! < n);
      const total = open.reduce((a, x) => a + (visits.get(x.id) ?? 0), 0);
      const avg = total / Math.max(1, open.length);
      const cand = open.filter((x) => x.id !== prev && x.id !== next?.id);
      const weights = cand.map((x) => {
        const since = n - unlock.get(x.id)!;
        let w = since <= 6 ? 3 : since <= 15 ? 1.6 : 1;
        w *= Math.pow(0.6, Math.max(0, (visits.get(x.id) ?? 0) - avg));
        if (x.id === prev2) w *= 0.4;
        return w;
      });
      let x = r.next() * weights.reduce((a, b) => a + b, 0);
      c = cand[cand.length - 1];
      for (let i = 0; i < cand.length; i++) {
        x -= weights[i];
        if (x <= 0) {
          c = cand[i];
          break;
        }
      }
    }
    const visit = visits.get(c.id) ?? 0;
    visits.set(c.id, visit + 1);
    // concave: the first holes climb quickly from the tutorial, the last ones slowly
    let d = Math.pow((n - 1) / (FULL_LEN - 1), 0.75);
    if (intro) d -= 0.14;
    if (champ) d += 0.06;
    if (n % 10 === 1 && n > 1) d -= 0.06;
    // the first visits to a course are a bit gentler
    if (!intro && visit <= 2 && n > 10) d -= 0.03 * (3 - visit);
    d = Math.max(0, Math.min(1.1, d));
    // hand-made holes: the presentation, then the next visits while there are any (never a cup hole)
    const hand = !champ && visit < c.holes.length ? c.holes[visit] : null;
    out.push({ n, id: `L${n}`, course: c.id, intro, champ, visit, seed: hashString(`wildputt/L${n}`), d, hand });
    prev2 = prev;
    prev = c.id;
  }
  return out;
}

export const ROUTE: RouteLevel[] = buildRoute();

/** Hole where each course opens in this build. */
export function unlockLevel(id: ThemeId): number {
  const i = READY.findIndex((c) => c.id === id);
  return i >= 0 ? UNLOCK[i] : Infinity;
}

/** The cup hole of a course (the one that wins its trophy), or 0 if this build has none. */
export function champLevel(id: ThemeId): number {
  return ROUTE.find((L) => L.champ && L.course === id)?.n ?? 0;
}

// ---------- tips on the hole card ----------
const CHAMP_TIP: Txt = {
  en: 'Cup hole! Longer, with everything this course has. Finish it at par or better to take home the trophy.',
  es: '¡Hoyo de copa! Más largo y con todo lo de este recorrido. Acábalo en el par o mejor y te llevas el trofeo.',
};
const GENERIC: Txt[] = [
  { en: 'Bank off the walls: the dotted line shows the first bounce.', es: 'Rebota en las paredes: la línea de puntos enseña el primer rebote.' },
  { en: 'Soft putts drop. A fast ball rolls straight over the cup.', es: 'Los golpes suaves entran. Una bola rápida pasa por encima del hoyo.' },
  { en: 'Coins off the easy line: worth a stroke?', es: 'Monedas fuera de la línea fácil: ¿valen un golpe?' },
  { en: 'Lay up short of trouble, then go for the cup.', es: 'Quédate antes del peligro y luego ve a por el hoyo.' },
  { en: 'Press the camera button to see the whole hole.', es: 'Pulsa el botón de la cámara para ver el hoyo entero.' },
];

function tipFor(L: RouteLevel, c: CourseDef): Txt {
  if (L.intro) return c.tip;
  if (L.champ) return CHAMP_TIP;
  if (L.hand?.tip) return L.hand.tip;
  const r = new Rng(L.seed ^ 0x7177);
  return r.next() < 0.45 ? c.tip : GENERIC[(L.n * 7) % GENERIC.length];
}

// ---------- hole definition ----------
const cache = new Map<number, HoleDef>();

/** Provisional par before tools/route-table.ts has measured the hole. */
const PAR_GUESS = 3;

/** Full definition of a hole of the route (built the first time it is asked for). `salt` picks another layout. */
export function holeDef(n: number, salt?: number): HoleDef {
  const hit = salt === undefined ? cache.get(n) : undefined;
  if (hit) return hit;
  const L = ROUTE[n - 1];
  const c = courseById(L.course);
  const table = ROUTE_TABLE[n - 1];
  const par = (salt === undefined ? table?.[1] : undefined) ?? L.hand?.par ?? PAR_GUESS;
  let def: HoleDef;
  if (L.hand) {
    def = { ...L.hand, id: L.id, par, tip: tipFor(L, c), course: c.id };
  } else {
    const s = salt ?? table?.[0] ?? 0;
    const g = generate({ course: c.id, seed: L.seed + s * 104729, d: L.d, champ: L.champ });
    def = {
      id: L.id,
      name: L.champ ? c.cup : c.name,
      tip: tipFor(L, c),
      par,
      map: g.map,
      spinners: g.spinners,
      movers: g.movers,
      sway: g.sway,
      lavaRise: g.lavaRise,
      tide: g.tide,
      gates: g.gates,
      bridge: g.bridge,
      gravity: g.gravity,
      coins: g.coins,
      course: c.id,
    };
  }
  if (salt === undefined) cache.set(n, def);
  return def;
}

/** Display name: a hand-made hole's own name, or the course (the cup's name on a cup hole). */
export function holeName(n: number): Txt {
  return holeDef(n).name;
}
