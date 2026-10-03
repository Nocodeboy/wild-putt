import { hashString, Rng } from './rng';
import type { HoleDef, MoverDef, SpinnerDef, ThemeId } from './types';

// Hole generator (docs/diseno-v2.md §5.3). A hole is a fairway carved from a template (straight, dogleg, S-bend,
// U-turn, zigzag, open room, fork round an island, cup on an island), walled in, then dressed with the general
// obstacles and with its course's own mechanic. Everything comes from the seed, so every device builds the same hole.
// tools/route-table.ts plays every generated hole with the bot to pick a fair one and measure its par.

export interface GenOpts {
  course: ThemeId;
  seed: number;
  /** difficulty, 0 (first holes) to ~1.1 */
  d: number;
  champ?: boolean;
}

export interface GenHole {
  map: string[];
  spinners?: SpinnerDef[];
  movers?: MoverDef[];
  sway?: HoleDef['sway'];
  lavaRise?: number;
  tide?: HoleDef['tide'];
  gates?: HoleDef['gates'];
  bridge?: HoleDef['bridge'];
  gravity?: number;
  coins?: [number, number][];
  template: Template;
}

export type Template = 'straight' | 'dogleg' | 'sbend' | 'uturn' | 'zigzag' | 'room' | 'fork' | 'island';

const MAX_W = 15;
const MAX_H = 26;
const SIZE = 48; // scratch canvas
const DIRS: [number, number][] = [
  [0, -1], // up the screen (towards the cup)
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** Ground that the ball can roll on (and rest on). */
const OPEN = new Set(['.', ':', '_', '^', 'v', '<', '>', 'O', 'T', 'w', 'P', '8', '2', '4', '6', 'J', 'G', 'H', '=']);
const HAZARD = new Set([' ', '~', 'L', 'w']);

/** The hazard that lines a course's pools, pits and islands. */
const HAZ: Record<ThemeId, string> = {
  garden: '~',
  roofs: ' ',
  ship: ' ',
  fair: '~',
  glacier: '~',
  volcano: 'L',
  beach: '~',
  temple: ' ',
  castle: '~',
  neon: ' ',
  canyon: ' ',
  moon: ' ',
};
/** Courses where some stretches have no railing at all (the ball can roll off the edge). */
const OPEN_EDGES: Partial<Record<ThemeId, number>> = { roofs: 0.85, ship: 0.6, canyon: 0.7, moon: 0.45, neon: 0.4 };

class Canvas {
  c: string[][];
  /** fairway cells carved by the template (no features yet), with their segment */
  seg: Int16Array;
  constructor() {
    this.c = Array.from({ length: SIZE }, () => Array(SIZE).fill(' '));
    this.seg = new Int16Array(SIZE * SIZE).fill(-1);
  }
  in(x: number, z: number) {
    return x >= 0 && z >= 0 && x < SIZE && z < SIZE;
  }
  get(x: number, z: number): string {
    return this.in(x, z) ? this.c[z][x] : ' ';
  }
  set(x: number, z: number, ch: string) {
    if (this.in(x, z)) this.c[z][x] = ch;
  }
  carved(x: number, z: number) {
    return this.in(x, z) && this.seg[z * SIZE + x] >= 0;
  }
}

interface Seg {
  /** centre line from a to b (inclusive), axis aligned */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  dir: number;
  w: number;
}

interface Built {
  cv: Canvas;
  segs: Seg[];
  tee: { x: number; z: number };
  cup: { x: number; z: number };
  template: Template;
  /** open rooms: their rectangle */
  room?: { x0: number; z0: number; x1: number; z1: number };
}

function rectOf(s: Seg, ext0 = 0, ext1 = 0) {
  const r0 = Math.floor((s.w - 1) / 2);
  const r1 = s.w - 1 - r0;
  const [dx, dz] = DIRS[s.dir];
  // extend the segment backwards by ext0 and forwards by ext1 along its direction
  const ax = s.ax - dx * ext0;
  const az = s.az - dz * ext0;
  const bx = s.bx + dx * ext1;
  const bz = s.bz + dz * ext1;
  const horiz = dz === 0;
  return {
    x0: Math.min(ax, bx) - (horiz ? 0 : r0),
    x1: Math.max(ax, bx) + (horiz ? 0 : r1),
    z0: Math.min(az, bz) - (horiz ? r0 : 0),
    z1: Math.max(az, bz) + (horiz ? r1 : 0),
  };
}

/** Lays the template's fairway on a fresh canvas, or null if it folds onto itself. */
function layout(r: Rng, tpl: Template, d: number, champ: boolean): Built | null {
  const cv = new Canvas();
  const segs: Seg[] = [];
  const baseW = d < 0.25 ? r.int(4, 5) : d < 0.7 ? r.int(3, 5) : r.int(3, 4);
  const sx = Math.floor(SIZE / 2);
  const sz = SIZE - 6;

  if (tpl === 'room' || tpl === 'fork' || tpl === 'island') {
    const W = tpl === 'room' ? r.int(7, 11) : r.int(9, 11);
    const H = tpl === 'room' ? r.int(10, 15) + (champ ? 3 : 0) : r.int(12, 16) + (champ ? 2 : 0);
    const x0 = sx - Math.floor(W / 2);
    const z0 = sz - H + 1;
    for (let z = z0; z <= sz; z++)
      for (let x = x0; x < x0 + W; x++) {
        cv.set(x, z, '.');
        cv.seg[z * SIZE + x] = 0;
      }
    const teeX = x0 + (tpl === 'room' ? r.int(1, W - 2) : Math.floor(W / 2));
    const cupX = tpl === 'island' ? x0 + Math.floor(W / 2) : x0 + r.int(1, W - 2);
    const cupZ = tpl === 'island' ? z0 + r.int(3, Math.max(3, Math.floor(H / 2) - 2)) : z0 + 1;
    segs.push({ ax: teeX, az: sz - 1, bx: teeX, bz: z0, dir: 0, w: W });
    return { cv, segs, tee: { x: teeX, z: sz - 1 }, cup: { x: cupX, z: cupZ }, template: tpl, room: { x0, z0, x1: x0 + W - 1, z1: sz } };
  }

  // corridors: a turtle walk
  const turn = r.next() < 0.5 ? 1 : 3;
  const plan: { dir: number; len: number }[] = [];
  // longer stretches further into the tour
  const L = (a: number, b: number) => r.int(a, b) + Math.round(3 * Math.min(1, d)) + (champ ? 2 : 0);
  switch (tpl) {
    case 'straight':
      plan.push({ dir: 0, len: L(9, 14) });
      break;
    case 'dogleg':
      plan.push({ dir: 0, len: L(6, 10) }, { dir: turn, len: L(4, 8) });
      break;
    case 'sbend':
      plan.push({ dir: 0, len: L(4, 7) }, { dir: turn, len: r.int(3, 7) }, { dir: 0, len: L(4, 7) });
      break;
    case 'uturn': {
      plan.push({ dir: 0, len: L(6, 10) }, { dir: turn, len: baseW + r.int(2, 4) }, { dir: 2, len: r.int(3, 6) });
      break;
    }
    case 'zigzag': {
      const t2 = r.next() < 0.6 ? turn : (turn + 2) % 4;
      plan.push({ dir: 0, len: L(4, 6) }, { dir: turn, len: r.int(3, 6) }, { dir: 0, len: r.int(4, 6) }, { dir: t2, len: r.int(3, 6) });
      if (champ || r.next() < 0.4) plan.push({ dir: 0, len: r.int(3, 5) });
      break;
    }
  }
  let x = sx;
  let z = sz - 1;
  for (let k = 0; k < plan.length; k++) {
    const p = plan[k];
    const [dx, dz] = DIRS[p.dir];
    // corridors are a little narrower or wider from one stretch to the next
    const w = Math.max(3, Math.min(6, baseW + (k > 0 && r.next() < 0.35 ? (r.next() < 0.5 ? -1 : 1) : 0)));
    const s: Seg = { ax: x, az: z, bx: x + dx * p.len, bz: z + dz * p.len, dir: p.dir, w };
    const first = k === 0;
    const last = k === plan.length - 1;
    const rc = rectOf(s, first ? 1 : 0, last ? 1 : 0);
    // the new stretch must not touch older ones (except the one it comes from)
    for (let zz = rc.z0 - 1; zz <= rc.z1 + 1; zz++)
      for (let xx = rc.x0 - 1; xx <= rc.x1 + 1; xx++) {
        if (!cv.in(xx, zz) || xx < 1 || zz < 1 || xx >= SIZE - 1 || zz >= SIZE - 1) return null;
        const o = cv.seg[zz * SIZE + xx];
        if (o >= 0 && o < k - 1) return null;
      }
    for (let zz = rc.z0; zz <= rc.z1; zz++)
      for (let xx = rc.x0; xx <= rc.x1; xx++) {
        cv.set(xx, zz, '.');
        if (cv.seg[zz * SIZE + xx] < 0) cv.seg[zz * SIZE + xx] = k;
      }
    segs.push(s);
    x = s.bx;
    z = s.bz;
  }
  return { cv, segs, tee: { x: sx, z: sz - 1 }, cup: { x, z }, template: tpl };
}

// ---------- helpers on the built hole ----------
function line(b: Built): { x: number; z: number; seg: number; t: number }[] {
  // cells along the centre line from the tee to the cup, with their distance from the tee
  const out: { x: number; z: number; seg: number; t: number }[] = [];
  let t = 0;
  b.segs.forEach((s, k) => {
    const [dx, dz] = DIRS[s.dir];
    const n = Math.abs(s.bx - s.ax) + Math.abs(s.bz - s.az);
    for (let i = k === 0 ? 0 : 1; i <= n; i++) {
      out.push({ x: s.ax + dx * i, z: s.az + dz * i, seg: k, t: t++ });
    }
  });
  return out;
}

function near(a: { x: number; z: number }, x: number, z: number, r: number) {
  return Math.abs(a.x - x) <= r && Math.abs(a.z - z) <= r;
}

/** Is the cell free for a feature: carved, plain green, away from the tee and the cup. */
function free(b: Built, x: number, z: number, keep = 1) {
  return b.cv.carved(x, z) && b.cv.get(x, z) === '.' && !near(b.tee, x, z, keep) && !near(b.cup, x, z, keep + 1);
}

/** Cells across a segment's width at centre-line point (cx, cz). */
function across(s: Seg, cx: number, cz: number): [number, number][] {
  const r0 = Math.floor((s.w - 1) / 2);
  const r1 = s.w - 1 - r0;
  const horiz = DIRS[s.dir][1] === 0;
  const out: [number, number][] = [];
  for (let k = -r0; k <= r1; k++) out.push(horiz ? [cx, cz + k] : [cx + k, cz]);
  return out;
}

// ---------- features ----------
interface Ctx {
  r: Rng;
  b: Built;
  d: number;
  course: ThemeId;
  champ: boolean;
  spinners: { x: number; z: number; s: SpinnerDef }[];
  movers: MoverDef[];
  pts: ReturnType<typeof line>;
  out: GenHole;
}

/** A point on the centre line between fractions a and b of the way, on a straight stretch of width ≥ minW. */
function spot(c: Ctx, a: number, b: number, minW = 3): (ReturnType<typeof line>[number] & { s: Seg }) | null {
  const n = c.pts.length;
  const cand = c.pts.filter((p) => p.t >= a * n && p.t <= b * n && c.b.segs[p.seg].w >= minW && !near(c.b.tee, p.x, p.z, 2) && !near(c.b.cup, p.x, p.z, 2));
  // not on the corner cells of a turn
  const ok = cand.filter((p) => {
    const s = c.b.segs[p.seg];
    const fromA = Math.abs(p.x - s.ax) + Math.abs(p.z - s.az);
    const toB = Math.abs(p.x - s.bx) + Math.abs(p.z - s.bz);
    return (fromA >= Math.ceil(s.w / 2) || p.seg === 0) && (toB >= Math.ceil(s.w / 2) || p.seg === c.b.segs.length - 1);
  });
  if (!ok.length) return null;
  const p = c.r.pick(ok);
  return { ...p, s: c.b.segs[p.seg] };
}

/** A wall block in the middle of the fairway (only where there is room to roll past it). */
function block(c: Ctx, a = 0.25, b = 0.8) {
  const p = spot(c, a, b, 4);
  if (!p) return;
  const cells = across(p.s, p.x, p.z);
  const mid = Math.floor(cells.length / 2) - (cells.length % 2 === 0 && c.r.next() < 0.5 ? 1 : 0);
  const [x, z] = cells[mid];
  if (!free(c.b, x, z)) return;
  c.b.cv.set(x, z, '#');
  // a longer block along the stretch now and then
  const [dx, dz] = DIRS[p.s.dir];
  if (c.r.next() < 0.4 && free(c.b, x + dx, z + dz)) c.b.cv.set(x + dx, z + dz, '#');
}

/** A sand trap: a patch beside the cup or at a corner. */
function sand(c: Ctx) {
  const cup = c.b.cup;
  const cand: [number, number][] = [];
  for (let z = cup.z - 3; z <= cup.z + 3; z++) for (let x = cup.x - 3; x <= cup.x + 3; x++) if (free(c.b, x, z, 0) && !near(cup, x, z, 1)) cand.push([x, z]);
  if (!cand.length) return;
  const [x0, z0] = c.r.pick(cand);
  const n = c.r.int(2, 4);
  let x = x0;
  let z = z0;
  for (let i = 0; i < n; i++) {
    if (free(c.b, x, z, 0) && !near(cup, x, z, 0)) c.b.cv.set(x, z, ':');
    if (c.r.next() < 0.5) x += c.r.next() < 0.5 ? 1 : -1;
    else z += c.r.next() < 0.5 ? 1 : -1;
  }
}

/** A band of hazard right across the fairway, with a bridge (a gap) somewhere in it. */
function band(c: Ctx, ch: string, a = 0.3, b = 0.75, bridge = 1) {
  const p = spot(c, a, b, 3);
  if (!p) return false;
  const cells = across(p.s, p.x, p.z);
  const g0 = c.r.int(0, cells.length - bridge);
  cells.forEach(([x, z], i) => {
    if (i >= g0 && i < g0 + bridge) return;
    if (free(c.b, x, z, 1)) c.b.cv.set(x, z, ch);
  });
  return true;
}

/** A pool of hazard on one side of a stretch: the fairway gets wider there and the extra cells are hazard. */
function pool(c: Ctx, ch: string) {
  const p = spot(c, 0.2, 0.85, 3);
  if (!p) return;
  const [dx, dz] = DIRS[p.s.dir];
  const side = c.r.next() < 0.5 ? 1 : -1;
  const cells = across(p.s, p.x, p.z);
  const edge = side > 0 ? cells[cells.length - 1] : cells[0];
  const nx = dz === 0 ? 0 : side;
  const nz = dz === 0 ? side : 0;
  const len = c.r.int(2, 4);
  for (let i = -1; i < len - 1; i++) {
    const x = edge[0] + dx * i;
    const z = edge[1] + dz * i;
    // the pool takes the outermost lane (and one more cell out, so the fairway does not get narrower)
    for (const k of [0, 1]) {
      const xx = x + nx * k;
      const zz = z + nz * k;
      if (k === 0 && !free(c.b, xx, zz, 1)) continue;
      if (k === 1 && (c.b.cv.carved(xx, zz) || c.b.cv.get(xx, zz) !== ' ')) continue;
      c.b.cv.set(xx, zz, ch);
      if (k === 1) c.b.cv.seg[zz * SIZE + xx] = p.seg;
    }
  }
}

/** Two or three rows of slope across a stretch, pushing sideways or along the fairway. */
function slope(c: Ctx, towardsVoid = false) {
  const p = spot(c, 0.2, 0.75, 3);
  if (!p) return;
  const [dx, dz] = DIRS[p.s.dir];
  const horiz = dz === 0;
  let ch: string;
  if (towardsVoid && c.out.map) ch = horiz ? (c.r.next() < 0.5 ? '^' : 'v') : c.r.next() < 0.5 ? '<' : '>';
  else {
    const sideways = c.r.next() < 0.65;
    if (sideways) ch = horiz ? (c.r.next() < 0.5 ? '^' : 'v') : c.r.next() < 0.5 ? '<' : '>';
    // along the fairway: towards the tee (uphill to the cup) more often than downhill
    else ch = c.r.next() < 0.7 ? (p.s.dir === 0 ? 'v' : p.s.dir === 1 ? '<' : p.s.dir === 2 ? '^' : '>') : p.s.dir === 0 ? '^' : p.s.dir === 1 ? '>' : p.s.dir === 2 ? 'v' : '<';
  }
  const rows = c.r.int(2, 3);
  for (let i = 0; i < rows; i++) for (const [x, z] of across(p.s, p.x + dx * i, p.z + dz * i)) if (free(c.b, x, z, 1)) c.b.cv.set(x, z, ch);
}

/** Bumpers (round posts that bounce hard), a few in the open. */
function bumpers(c: Ctx, n: number) {
  for (let k = 0; k < n; k++) {
    const p = spot(c, 0.2, 0.85, 4);
    if (!p) return;
    const cells = across(p.s, p.x, p.z);
    const [x, z] = c.r.pick(cells.slice(1, -1));
    if (free(c.b, x, z, 1) && !hasAround(c, x, z, 'B')) c.b.cv.set(x, z, 'B');
  }
}
function hasAround(c: Ctx, x: number, z: number, ch: string, r = 1) {
  for (let zz = z - r; zz <= z + r; zz++) for (let xx = x - r; xx <= x + r; xx++) if (c.b.cv.get(xx, zz) === ch) return true;
  return false;
}

/** Take away the railing on one side of a straight stretch (the ball can roll off). */
function openEdge(c: Ctx) {
  const ok = c.b.segs.map((s, k) => ({ s, k })).filter(({ s }) => Math.abs(s.bx - s.ax) + Math.abs(s.bz - s.az) >= 4);
  if (!ok.length) return;
  const { s, k } = c.r.pick(ok);
  const side = c.r.next() < 0.5 ? 1 : -1;
  const [dx, dz] = DIRS[s.dir];
  const n = Math.abs(s.bx - s.ax) + Math.abs(s.bz - s.az);
  const a = c.r.int(1, Math.max(1, n - 4));
  const len = Math.min(n - a, c.r.int(3, 6));
  for (let i = a; i < a + len; i++) {
    const cells = across(s, s.ax + dx * i, s.az + dz * i);
    const [x, z] = side > 0 ? cells[cells.length - 1] : cells[0];
    const ox = x + (dz === 0 ? 0 : side);
    const oz = z + (dz === 0 ? side : 0);
    // mark the cell outside as "no railing" (stays void when walls go up)
    if (!c.b.cv.carved(ox, oz)) c.b.cv.seg[oz * SIZE + ox] = -2;
  }
  void k;
}

/** A spinning beam on a wide stretch; the stretch is widened to make room for its sweep. */
function spinner(c: Ctx) {
  for (let i = 0; i < 8; i++) if (trySpinner(c)) return;
}
function trySpinner(c: Ctx): boolean {
  const p = spot(c, 0.25, 0.8, 3);
  if (!p) return false;
  const len = c.r.range(1.6, 2.2);
  const R = Math.ceil(len + 0.35);
  // clear a square around it
  for (let z = p.z - R; z <= p.z + R; z++)
    for (let x = p.x - R; x <= p.x + R; x++) {
      if (near(c.b.cup, x, z, 1) || near(c.b.tee, x, z, 1)) return false;
    }
  for (let z = p.z - R; z <= p.z + R; z++)
    for (let x = p.x - R; x <= p.x + R; x++) {
      if (!c.b.cv.carved(x, z)) {
        // only widen into empty space (never into another stretch)
        for (let zz = z - 1; zz <= z + 1; zz++) for (let xx = x - 1; xx <= x + 1; xx++) if (c.b.cv.carved(xx, zz) && c.b.cv.seg[zz * SIZE + xx] !== p.seg && c.b.cv.seg[zz * SIZE + xx] >= 0) return false;
      }
    }
  for (let z = p.z - R; z <= p.z + R; z++)
    for (let x = p.x - R; x <= p.x + R; x++) {
      if (!c.b.cv.carved(x, z)) c.b.cv.seg[z * SIZE + x] = p.seg;
      c.b.cv.set(x, z, '.');
    }
  c.b.cv.set(p.x, p.z, 'S');
  const speed = c.r.range(1.1, 1.5 + 0.5 * c.d) * (c.r.next() < 0.5 ? 1 : -1);
  c.spinners.push({ x: p.x, z: p.z, s: { len, speed, phase: c.r.range(0, Math.PI) } });
  return true;
}

/** A block sliding right across a stretch. */
function mover(c: Ctx) {
  const p = spot(c, 0.25, 0.8, 4);
  if (!p) return;
  const cells = across(p.s, p.x, p.z);
  const horizSeg = DIRS[p.s.dir][1] === 0;
  const a = cells[0];
  const b = cells[cells.length - 1];
  // the block is 2 long across the stretch and 1 deep; centres from one wall to the other
  if (horizSeg) c.movers.push({ x0: a[0] + 0.5, z0: a[1] + 1, x1: b[0] + 0.5, z1: b[1], w: 1, h: 2, period: c.r.range(3.4, 4.8 - 1.2 * Math.min(1, c.d)), phase: c.r.next() });
  else c.movers.push({ x0: a[0] + 1, z0: a[1] + 0.5, x1: b[0], z1: b[1] + 0.5, w: 2, h: 1, period: c.r.range(3.4, 4.8 - 1.2 * Math.min(1, c.d)), phase: c.r.next() });
}

/** Turn whole stretches to ice (glacier). */
function ice(c: Ctx) {
  const all = c.r.next() < 0.3;
  const pick = new Set<number>();
  if (all) c.b.segs.forEach((_, k) => pick.add(k));
  else pick.add(c.r.int(0, c.b.segs.length - 1));
  for (let z = 0; z < SIZE; z++)
    for (let x = 0; x < SIZE; x++) if (pick.has(c.b.cv.seg[z * SIZE + x]) && c.b.cv.get(x, z) === '.' && !near(c.b.cup, x, z, 0) && !near(c.b.tee, x, z, 0)) c.b.cv.set(x, z, '_');
}

/** Rooms: obstacles spread around the open green. */
function roomStuff(c: Ctx) {
  const rm = c.b.room!;
  const n = 1 + Math.round(c.d * 3) + c.r.int(0, 1);
  for (let k = 0; k < n; k++) {
    const x = c.r.int(rm.x0 + 1, rm.x1 - 1);
    const z = c.r.int(rm.z0 + 2, rm.z1 - 3);
    if (!free(c.b, x, z, 1)) continue;
    const kind = c.r.next();
    if (kind < 0.45) {
      // a short wall
      const horiz = c.r.next() < 0.6;
      const len = c.r.int(2, 3);
      for (let i = 0; i < len; i++) if (free(c.b, x + (horiz ? i : 0), z + (horiz ? 0 : i), 1)) c.b.cv.set(x + (horiz ? i : 0), z + (horiz ? 0 : i), '#');
    } else if (kind < 0.65 && c.course !== 'volcano') c.b.cv.set(x, z, 'B');
    else c.b.cv.set(x, z, '#');
  }
}

/** Fork: an island of wall in the middle; one side wide and slow (sand), the other narrow and risky. */
function fork(c: Ctx) {
  const rm = c.b.room!;
  const W = rm.x1 - rm.x0 + 1;
  const ix0 = rm.x0 + Math.floor(W / 2) - 1 + (c.r.next() < 0.5 ? -1 : 1);
  const iz0 = rm.z0 + 3;
  const iz1 = rm.z1 - 4;
  for (let z = iz0; z <= iz1; z++) for (let x = ix0; x < ix0 + 3; x++) c.b.cv.set(x, z, '#');
  // the narrow side: the lane between the island and the outer wall, with hazard along the wall
  const leftW = ix0 - rm.x0;
  const rightW = rm.x1 - (ix0 + 2);
  const narrowLeft = leftW < rightW;
  const hz = HAZ[c.course] === ' ' ? ' ' : HAZ[c.course];
  for (let z = iz0 + 1; z <= iz1 - 1; z++) {
    const x = narrowLeft ? rm.x0 : rm.x1;
    if ((narrowLeft ? leftW : rightW) < 3) break;
    c.b.cv.set(x, z, hz);
    // a void lane has no railing outside it
    if (hz === ' ') c.b.cv.seg[z * SIZE + x + (narrowLeft ? -1 : 1)] = -2;
  }
  // the wide side gets sand
  for (let z = iz0 + 1; z <= iz1 - 1; z++) if (c.r.next() < 0.5) c.b.cv.set(narrowLeft ? rm.x1 : rm.x0, z, ':');
}

/** Island: the cup sits on an island ringed by hazard, with one or two ways across. */
function island(c: Ctx) {
  const cup = c.b.cup;
  const ring: [number, number][] = [];
  for (let z = cup.z - 2; z <= cup.z + 2; z++)
    for (let x = cup.x - 2; x <= cup.x + 2; x++) if (Math.max(Math.abs(x - cup.x), Math.abs(z - cup.z)) === 2 && c.b.cv.carved(x, z)) ring.push([x, z]);
  // ways across: the side facing the tee, and sometimes one more
  const gaps: [number, number][] = [[cup.x, cup.z + 2]];
  if (c.r.next() < 0.6) gaps.push(c.r.pick([[cup.x - 2, cup.z] as [number, number], [cup.x + 2, cup.z] as [number, number]]));
  const hz = HAZ[c.course];
  for (const [x, z] of ring) {
    if (gaps.some(([gx, gz]) => gx === x && gz === z)) continue;
    c.b.cv.set(x, z, hz);
  }
}


// ---------- the six new courses ----------
/** Beach: a band of wet sand right across the fairway that the tide covers now and then. */
function tideBand(c: Ctx) {
  const p = spot(c, 0.25, 0.8, 3);
  if (!p) return;
  const [dx, dz] = DIRS[p.s.dir];
  const rows = c.d > 0.5 && c.r.next() < 0.5 ? 2 : 1;
  for (let k = 0; k < rows; k++) for (const [x, z] of across(p.s, p.x + dx * k, p.z + dz * k)) if (free(c.b, x, z, 1)) c.b.cv.set(x, z, 'w');
}

/** Temple: a pair of tunnels; when `forced`, a wall seals the fairway between them and the tunnel is the way. */
function tunnels(c: Ctx, forced: boolean) {
  const a = spot(c, 0.12, 0.38, 3);
  const b = spot(c, 0.72, 0.95, 3);
  if (!a || !b || a.t >= b.t - 3) return;
  const pa = c.r.pick(across(a.s, a.x, a.z).filter(([x, z]) => free(c.b, x, z, 1)));
  const pb = c.r.pick(across(b.s, b.x, b.z).filter(([x, z]) => free(c.b, x, z, 1)));
  if (!pa || !pb) return;
  if (forced) {
    const w = spot(c, 0.45, 0.62, 3);
    if (!w || w.t <= a.t + 1 || w.t >= b.t - 1) return;
    for (const [x, z] of across(w.s, w.x, w.z)) c.b.cv.set(x, z, '#');
  }
  c.b.cv.set(pa[0], pa[1], 'P');
  c.b.cv.set(pb[0], pb[1], 'P');
}

/**
 * Castle: a row of portcullises right across the fairway. 'H' rows go up when the 'G' rows come down, so an 'H' row
 * only goes well away from the other rows (a ball needs time to roll from one to the next).
 */
const gateTs: number[] = [];
function gateRow(c: Ctx, ch: 'G' | 'H') {
  for (let k = 0; k < 6; k++) {
    const p = spot(c, 0.25, 0.8, 3);
    if (!p) return;
    if (gateTs.some((t) => Math.abs(t - p.t) < (ch === 'H' ? 5 : 2))) continue;
    for (const [x, z] of across(p.s, p.x, p.z)) if (free(c.b, x, z, 1)) c.b.cv.set(x, z, ch);
    gateTs.push(p.t);
    return;
  }
}

/** Castle: a moat across the fairway, with a drawbridge in the middle that rises now and then. */
function drawbridge(c: Ctx) {
  const p = spot(c, 0.3, 0.75, 3);
  if (!p) return;
  const cells = across(p.s, p.x, p.z);
  const mid = Math.floor((cells.length - 1) / 2);
  cells.forEach(([x, z], i) => {
    if (!free(c.b, x, z, 1)) return;
    c.b.cv.set(x, z, i === mid || (cells.length >= 5 && i === mid + 1) ? '=' : '~');
  });
}

/** Neon: booster pads down the middle of a stretch, pointing along it. */
function boosters(c: Ctx) {
  const p = spot(c, 0.1, 0.65, 3);
  if (!p) return;
  const ch = ['8', '6', '2', '4'][p.s.dir];
  const [dx, dz] = DIRS[p.s.dir];
  const n = c.r.int(1, 2);
  for (let k = 0; k < n; k++) if (free(c.b, p.x + dx * k, p.z + dz * k, 1)) c.b.cv.set(p.x + dx * k, p.z + dz * k, ch);
}

/** Canyon: a gap of void right across a stretch, with a row of ramps just before it. */
function chasm(c: Ctx) {
  const p = spot(c, 0.35, 0.68, 3);
  if (!p) return false;
  const [dx, dz] = DIRS[p.s.dir];
  const s = p.s;
  // the stretch must carry on for a few cells beyond the gap
  const toB = Math.abs(p.x - s.bx) + Math.abs(p.z - s.bz);
  const gap = c.d > 0.6 && c.r.next() < 0.5 ? 3 : 2;
  if (toB < gap + 2 && p.seg !== c.b.segs.length - 1) return false;
  const ramp = across(s, p.x - dx, p.z - dz);
  if (!ramp.every(([x, z]) => free(c.b, x, z, 1))) return false;
  for (let k = 0; k < gap; k++)
    for (const [x, z] of across(s, p.x + dx * k, p.z + dz * k)) {
      if (near(c.b.cup, x, z, 1)) return false;
    }
  for (const [x, z] of ramp) c.b.cv.set(x, z, 'J');
  for (let k = 0; k < gap; k++) {
    const cells = across(s, p.x + dx * k, p.z + dz * k);
    for (const [x, z] of cells) c.b.cv.set(x, z, ' ');
    // no rails along the sides of the gap
    const [x0, z0] = cells[0];
    const [x1, z1] = cells[cells.length - 1];
    const ox = dz === 0 ? 0 : 1;
    const oz = dz === 0 ? 1 : 0;
    if (!c.b.cv.carved(x0 - ox, z0 - oz)) c.b.cv.seg[(z0 - oz) * SIZE + x0 - ox] = -2;
    if (!c.b.cv.carved(x1 + ox, z1 + oz)) c.b.cv.seg[(z1 + oz) * SIZE + x1 + ox] = -2;
  }
  return true;
}

/** Moon: a gravity well at the side of a stretch (its black hole is a hazard). */
function well(c: Ctx) {
  const p = spot(c, 0.25, 0.8, 4);
  if (!p) return;
  const cells = across(p.s, p.x, p.z);
  const [x, z] = c.r.next() < 0.5 ? cells[0] : cells[cells.length - 1];
  if (free(c.b, x, z, 2) && !hasAround(c, x, z, 'M', 3)) c.b.cv.set(x, z, 'M');
}

// ---------- the course's own mechanic and dressing ----------
function dress(c: Ctx) {
  const { r, d, course } = c;
  const tpl = c.b.template;
  const roomy = tpl === 'room' || tpl === 'fork' || tpl === 'island';
  if (tpl === 'fork') fork(c);
  if (tpl === 'island') island(c);
  if (roomy) roomStuff(c);
  const p = (x: number) => r.next() < x;
  switch (course) {
    case 'garden':
      if (!roomy && p(0.45 + 0.3 * d)) block(c);
      if (p(0.6)) sand(c);
      if (d > 0.3 && p(0.4)) pool(c, '~');
      if (d > 0.45 && p(0.3)) slope(c);
      if (p(0.15)) bumpers(c, 1);
      break;
    case 'roofs':
      if (p(OPEN_EDGES.roofs!)) openEdge(c);
      if (d > 0.4 && p(0.4)) openEdge(c);
      if (p(0.55)) slope(c);
      if (!roomy && p(0.5)) block(c);
      if (d > 0.35 && p(0.25)) band(c, ' ', 0.3, 0.7, 2);
      break;
    case 'ship':
      if (p(OPEN_EDGES.ship!)) openEdge(c);
      if (!roomy && p(0.6)) block(c);
      if (d > 0.4 && p(0.3)) band(c, ' ', 0.3, 0.7, 2);
      if (p(0.2)) sand(c);
      c.out.sway = { amp: Math.round((1.4 + 1.4 * Math.min(1, d) + r.range(-0.2, 0.2)) * 10) / 10, period: Math.round(r.range(3.4, 5.2) * 10) / 10 };
      break;
    case 'fair':
      if (p(0.75)) spinner(c);
      if (d > 0.5 && p(0.35)) spinner(c);
      if (p(0.55)) bumpers(c, r.int(1, 3));
      if (p(0.25)) sand(c);
      break;
    case 'glacier':
      if (p(0.9)) ice(c);
      if (p(0.45)) band(c, '~', 0.3, 0.75, r.int(1, 2));
      if (p(0.45)) mover(c);
      if (p(0.4)) sand(c);
      break;
    case 'volcano': {
      if (p(0.55)) pool(c, 'L');
      if (d > 0.3 && p(0.35)) band(c, 'L', 0.3, 0.7, 2);
      if (!roomy && p(0.4)) block(c);
      // the lava that spreads: from behind the tee
      if (p(0.85)) {
        const s = c.b.segs[0];
        const [dx, dz] = DIRS[s.dir];
        for (const [x, z] of across(s, s.ax - dx * 2, s.az - dz * 2)) {
          c.b.cv.set(x, z, 'L');
          c.b.cv.seg[z * SIZE + x] = 0;
        }
        c.out.lavaRise = 2 + Math.round(2 * Math.min(1, d));
      }
      break;
    }
    case 'beach':
      if (p(0.9)) tideBand(c);
      if (d > 0.4 && p(0.45)) tideBand(c);
      if (p(0.5)) sand(c);
      if (p(0.35)) pool(c, '~');
      if (!roomy && p(0.35)) block(c);
      c.out.tide = { period: Math.round(r.range(7, 10) * 10) / 10, phase: Math.round(r.next() * 100) / 100, up: Math.round(r.range(0.36, 0.48) * 100) / 100 };
      break;
    case 'temple':
      tunnels(c, !roomy && p(0.45));
      if (p(0.4)) band(c, ' ', 0.3, 0.7, 2);
      if (p(0.4)) sand(c);
      if (!roomy && p(0.4)) block(c);
      break;
    case 'castle':
      gateTs.length = 0;
      if (p(0.75)) gateRow(c, 'G');
      if (d > 0.45 && p(0.45)) gateRow(c, 'H');
      if (p(0.5)) drawbridge(c);
      if (!roomy && p(0.4)) block(c);
      c.out.gates = { period: Math.round(r.range(4, 6) * 10) / 10, phase: Math.round(r.next() * 100) / 100 };
      c.out.bridge = { period: Math.round(r.range(7, 9) * 10) / 10, phase: Math.round(r.next() * 100) / 100 };
      break;
    case 'neon':
      if (p(0.85)) boosters(c);
      if (d > 0.4 && p(0.4)) boosters(c);
      if (p(OPEN_EDGES.neon!)) openEdge(c);
      if (p(0.45)) bumpers(c, r.int(1, 2));
      if (p(0.3)) slope(c);
      break;
    case 'canyon':
      if (!roomy) chasm(c);
      if (p(OPEN_EDGES.canyon!)) openEdge(c);
      if (p(0.35)) slope(c);
      if (p(0.3)) sand(c);
      break;
    case 'moon':
      c.out.gravity = 0.45;
      if (p(0.85)) well(c);
      if (d > 0.45 && p(0.45)) well(c);
      if (p(OPEN_EDGES.moon!)) openEdge(c);
      if (p(0.3)) band(c, ' ', 0.3, 0.7, 2);
      if (!roomy && p(0.35)) block(c);
      break;
    default:
      break;
  }
  if (c.champ) {
    // the cup trial: one more of everything
    if (!roomy) block(c, 0.15, 0.5);
    if (course === 'garden' || course === 'glacier') sand(c);
  }
}

// ---------- assembling and checking ----------
function walls(b: Built, course: ThemeId) {
  const cv = b.cv;
  const out: [number, number][] = [];
  for (let z = 0; z < SIZE; z++)
    for (let x = 0; x < SIZE; x++) {
      if (cv.carved(x, z) || cv.get(x, z) !== ' ') continue;
      if (cv.seg[z * SIZE + x] === -2) continue; // no railing here
      let touch = false;
      for (let dz = -1; dz <= 1 && !touch; dz++) for (let dx = -1; dx <= 1; dx++) if (cv.carved(x + dx, z + dz)) touch = true;
      if (touch) out.push([x, z]);
    }
  for (const [x, z] of out) cv.set(x, z, '#');
  void course;
}

function crop(cv: Canvas): { map: string[]; ox: number; oz: number } | null {
  let x0 = SIZE;
  let x1 = -1;
  let z0 = SIZE;
  let z1 = -1;
  for (let z = 0; z < SIZE; z++)
    for (let x = 0; x < SIZE; x++)
      if (cv.get(x, z) !== ' ' || cv.carved(x, z)) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z);
      }
  if (x1 < 0) return null;
  // keep a one-cell margin of void where a stretch has no railing
  x0 = Math.max(0, x0 - 1);
  z0 = Math.max(0, z0 - 1);
  x1 = Math.min(SIZE - 1, x1 + 1);
  z1 = Math.min(SIZE - 1, z1 + 1);
  // trim margins that are all void
  const rowEmpty = (z: number) => cv.c[z].slice(x0, x1 + 1).every((ch) => ch === ' ');
  const colEmpty = (x: number) => cv.c.slice(z0, z1 + 1).every((row) => row[x] === ' ');
  // (outside the map is void anyway, so empty margins go)
  while (z0 < z1 && rowEmpty(z0)) z0++;
  while (z1 > z0 && rowEmpty(z1)) z1--;
  while (x0 < x1 && colEmpty(x0)) x0++;
  while (x1 > x0 && colEmpty(x1)) x1--;
  if (x1 - x0 + 1 > MAX_W || z1 - z0 + 1 > MAX_H) return null;
  const map: string[] = [];
  for (let z = z0; z <= z1; z++) map.push(cv.c[z].slice(x0, x1 + 1).join(''));
  return { map, ox: x0, oz: z0 };
}

/** Walkable from the tee to the cup (diagonals only past open corners). */
export function connected(map: string[]): boolean {
  const H = map.length;
  const W = Math.max(...map.map((r) => r.length));
  const at = (x: number, z: number) => (x < 0 || z < 0 || x >= W || z >= H ? ' ' : (map[z][x] ?? ' '));
  let tee: [number, number] | null = null;
  let cup: [number, number] | null = null;
  for (let z = 0; z < H; z++)
    for (let x = 0; x < W; x++) {
      if (at(x, z) === 'T') tee = [x, z];
      if (at(x, z) === 'O') cup = [x, z];
    }
  if (!tee || !cup) return false;
  // tunnels: each pair joins its two cells
  const portals: [number, number][] = [];
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) if (at(x, z) === 'P') portals.push([x, z]);
  const seen = new Uint8Array(W * H);
  const q: [number, number][] = [tee];
  seen[tee[1] * W + tee[0]] = 1;
  const walk = (ch: string) => OPEN.has(ch) || ch === 'B' || ch === 'S' || ch === 'M';
  while (q.length) {
    const [x, z] = q.pop()!;
    if (x === cup[0] && z === cup[1]) return true;
    const next: [number, number][] = [
      [x + 1, z],
      [x - 1, z],
      [x, z + 1],
      [x, z - 1],
    ];
    if (at(x, z) === 'P') {
      const i = portals.findIndex(([px, pz]) => px === x && pz === z);
      if (i >= 0 && portals[i ^ 1]) next.push(portals[i ^ 1]);
    }
    // ramps: a jump over up to 4 cells of void in the ramp's direction
    if (at(x, z) === 'J')
      for (const [dx, dz] of DIRS)
        if (at(x + dx, z + dz) === ' ')
          for (let k = 2; k <= 5; k++) {
            const ch = at(x + dx * k, z + dz * k);
            if (ch !== ' ') {
              if (walk(ch)) next.push([x + dx * k, z + dz * k]);
              break;
            }
          }
    for (const [nx, nz] of next) {
      if (nx < 0 || nz < 0 || nx >= W || nz >= H || seen[nz * W + nx]) continue;
      if (!walk(at(nx, nz))) continue;
      seen[nz * W + nx] = 1;
      q.push([nx, nz]);
    }
  }
  return false;
}

/** Coins: off the easy line, on plain green, reachable. Drawn from their own seed so they never change the hole. */
function placeCoins(map: string[], seed: number, d: number, champ: boolean): [number, number][] {
  const r = new Rng(seed ^ 0x5eed);
  const n = champ ? 3 : r.next() < 0.35 + 0.3 * Math.min(1, d) ? r.int(1, 3) : 0;
  if (!n) return [];
  const H = map.length;
  const W = Math.max(...map.map((row) => row.length));
  let tee = [0, 0];
  let cup = [0, 0];
  for (let z = 0; z < H; z++)
    for (let x = 0; x < W; x++) {
      if (map[z][x] === 'T') tee = [x, z];
      if (map[z][x] === 'O') cup = [x, z];
    }
  const lineDist = (x: number, z: number) => {
    const ax = tee[0];
    const az = tee[1];
    const bx = cup[0] - ax;
    const bz = cup[1] - az;
    const L = Math.hypot(bx, bz) || 1;
    return Math.abs((x - ax) * bz - (z - az) * bx) / L;
  };
  const cand: [number, number][] = [];
  for (let z = 1; z < H - 1; z++)
    for (let x = 1; x < W - 1; x++) {
      if (map[z][x] !== '.') continue;
      let ok = true;
      for (let dz = -1; dz <= 1 && ok; dz++) for (let dx = -1; dx <= 1; dx++) if (!OPEN.has(map[z + dz]?.[x + dx] ?? ' ') || HAZARD.has(map[z + dz]?.[x + dx] ?? ' ')) ok = false;
      if (!ok) continue;
      if (Math.hypot(x - tee[0], z - tee[1]) < 2.5 || Math.hypot(x - cup[0], z - cup[1]) < 2.5) continue;
      if (lineDist(x, z) < 1.5) continue;
      cand.push([x, z]);
    }
  const out: [number, number][] = [];
  for (let k = 0; k < n && cand.length; k++) {
    const i = r.int(0, cand.length - 1);
    const [x, z] = cand.splice(i, 1)[0];
    if (out.some(([a, b]) => Math.hypot(a - x - 0.5, b - z - 0.5) < 2)) continue;
    out.push([x + 0.5, z + 0.5]);
  }
  return out;
}

const TEMPLATES: { t: Template; w: (d: number, champ: boolean) => number }[] = [
  { t: 'straight', w: (d) => (d < 0.3 ? 2 : 0.6) },
  { t: 'dogleg', w: () => 2.4 },
  { t: 'sbend', w: (d) => (d < 0.15 ? 0.6 : 1.6) },
  { t: 'uturn', w: (d) => (d < 0.3 ? 0 : 1.1) },
  { t: 'zigzag', w: (d, champ) => (champ ? 3 : d < 0.45 ? 0 : 1) },
  { t: 'room', w: (d) => (d < 0.2 ? 0.8 : 1.3) },
  { t: 'fork', w: (d) => (d < 0.35 ? 0 : 0.8) },
  { t: 'island', w: (d) => (d < 0.4 ? 0 : 0.7) },
];

/** Build the hole for a seed; tries further sub-seeds until a valid one comes out. */
export function generate(o: GenOpts): GenHole {
  const d = Math.max(0, Math.min(1.1, o.d));
  for (let attempt = 0; attempt < 200; attempt++) {
    const r = new Rng(hashString(`${o.course}/${o.seed}/${attempt}`));
    // (a canyon hole needs a straight stretch for its gap: no open rooms there)
    const pool = TEMPLATES.map((x) => ({ t: x.t, w: x.w(d, !!o.champ) })).filter((x) => x.w > 0 && !(o.course === 'canyon' && (x.t === 'room' || x.t === 'fork' || x.t === 'island')));
    let pickW = r.next() * pool.reduce((a, x) => a + x.w, 0);
    let tpl: Template = pool[0].t;
    for (const x of pool) {
      pickW -= x.w;
      if (pickW <= 0) {
        tpl = x.t;
        break;
      }
    }
    const b = layout(r, tpl, d, !!o.champ);
    if (!b) continue;
    const out: GenHole = { map: [], template: tpl };
    const c: Ctx = { r, b, d, course: o.course, champ: !!o.champ, spinners: [], movers: [], pts: line(b), out };
    dress(c);
    b.cv.set(b.tee.x, b.tee.z, 'T');
    b.cv.set(b.cup.x, b.cup.z, 'O');
    walls(b, o.course);
    const cr = crop(b.cv);
    if (!cr) continue;
    if (!connected(cr.map)) continue;
    // the cup sits on flat green with nothing nasty right next to it
    const okCup = (() => {
      const cx = b.cup.x - cr.ox;
      const cz = b.cup.z - cr.oz;
      for (let zz = cz - 1; zz <= cz + 1; zz++)
        for (let xx = cx - 1; xx <= cx + 1; xx++) {
          const ch = cr.map[zz]?.[xx] ?? ' ';
          if (HAZARD.has(ch) && !(o.course === 'roofs' || o.course === 'canyon' || o.course === 'moon' || o.course === 'neon' || o.course === 'temple') ) return false;
          if (ch === ' ' && !(xx === cx && zz === cz)) return false;
          if ('^v<>'.includes(ch)) return false;
        }
      return true;
    })();
    if (!okCup) continue;
    // every course keeps its mechanic: a canyon hole with no gap, a temple with no tunnel… try again
    const has = (ch: string) => cr.map.some((row) => row.includes(ch));
    const need: Partial<Record<ThemeId, string>> = { canyon: 'J', temple: 'P', beach: 'w', neon: '8246', castle: 'GH=' };
    const nd = need[o.course];
    if (nd && attempt < 150 && ![...nd].some(has)) continue;
    out.map = cr.map;
    const sh = (v: number, ax: 'x' | 'z') => v - (ax === 'x' ? cr.ox : cr.oz);
    // (one definition per 'S', in reading order)
    if (c.spinners.length) out.spinners = [...c.spinners].sort((a, b2) => a.z - b2.z || a.x - b2.x).map((x) => x.s);
    if (c.movers.length) out.movers = c.movers.map((m) => ({ ...m, x0: sh(m.x0, 'x'), x1: sh(m.x1, 'x'), z0: sh(m.z0, 'z'), z1: sh(m.z1, 'z') }));
    out.coins = placeCoins(cr.map, o.seed + attempt * 7919, d, !!o.champ);
    return out;
  }
  // (never reached in practice: a plain straight hole)
  return { map: ['#####', '#.O.#', '#...#', '#...#', '#...#', '#...#', '#.T.#', '#####'], template: 'straight' };
}
