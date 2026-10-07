// Smooth outlines for a hole drawn on the ASCII grid (v1.1). The map stays the source of truth: every region (the
// walls, the ground under the hole, the ponds, the bunkers, the ice) is traced cell by cell, then
//   1. runs of small steps (a curve drawn with cells) become straight slopes through the middle of the steps,
//   2. every corner is rounded with a circular fillet: wide on the outside of a bend, tighter on the inside, and
//      concentric when the bend has a matching corner on the other side of the fairway,
// without ever moving the outline over the cup, the tee, a coin or any other key point, and keeping square the
// corners of the cells that need it (portcullises, bridges, the windmill...). The result is a list of closed loops
// made of segments and arcs: the physics bounces off the wall loops, and the renderer draws all of them.

export interface P2 {
  x: number;
  z: number;
}

/** A piece of an outline: a segment (k 0) or an arc (k 1) from angle a0 sweeping sw radians (z grows downwards). */
export type Prim = { k: 0; ax: number; az: number; bx: number; bz: number } | { k: 1; cx: number; cz: number; r: number; a0: number; sw: number };

export interface Loop {
  /** the outline sampled as a closed polyline (the first point is not repeated); the region is on its right */
  pts: P2[];
  prims: Prim[];
  /** > 0: an outer boundary, < 0: a hole in the region */
  area: number;
}

/** A point the outline must keep clear of by c. */
export interface KeyPt {
  x: number;
  z: number;
  c: number;
}

/** A corner of the cell outline. */
export interface Corner {
  x: number;
  z: number;
  /** +1 convex (the outline turns round the region), −1 reflex */
  turn: 1 | -1;
  /** incoming and outgoing directions: 0 +x, 1 +z, 2 −x, 3 −z */
  din: number;
  dout: number;
  /** length of the straight edges before and after it (cells) */
  lin: number;
  lout: number;
  sharp: boolean;
}

export interface SmoothOpts {
  /** wanted fillet radius at a corner (0: keep it square) */
  radius: (c: Corner) => number;
  /** cells whose corners stay square (and whose edges never turn into slopes) */
  protect?: (x: number, z: number) => boolean;
  keys?: KeyPt[];
  /** turn runs of small steps into slopes */
  stairs?: boolean;
}

export const DX = [1, 0, -1, 0];
export const DZ = [0, 1, 0, -1];

// ---------- tracing ----------
/** The corners of every boundary loop of a set of cells (the region on the right of travel). */
export function traceCorners(W: number, H: number, inside: (x: number, z: number) => boolean, protect?: (x: number, z: number) => boolean): Corner[][] {
  const ins = (x: number, z: number) => x >= 0 && z >= 0 && x < W && z < H && inside(x, z);
  const VW = W + 1;
  const vid = (x: number, z: number) => z * VW + x;
  const ex: number[] = [];
  const ez: number[] = [];
  const ed: number[] = [];
  const out = new Map<number, number[]>();
  const add = (x: number, z: number, d: number) => {
    const i = ex.length;
    ex.push(x);
    ez.push(z);
    ed.push(d);
    const k = vid(x, z);
    const l = out.get(k);
    if (l) l.push(i);
    else out.set(k, [i]);
  };
  for (let z = 0; z < H; z++)
    for (let x = 0; x < W; x++) {
      if (!ins(x, z)) continue;
      if (!ins(x, z - 1)) add(x, z, 0);
      if (!ins(x + 1, z)) add(x + 1, z, 1);
      if (!ins(x, z + 1)) add(x + 1, z + 1, 2);
      if (!ins(x - 1, z)) add(x, z + 1, 3);
    }
  const next = (e: number) => {
    const c = out.get(vid(ex[e] + DX[ed[e]], ez[e] + DZ[ed[e]]))!;
    if (c.length === 1) return c[0];
    // two cells touching only by a corner: keep hugging the same cell (turn right)
    return c.find((i) => ed[i] === (ed[e] + 1) % 4) ?? c[0];
  };
  const prot = (x: number, z: number) => !!protect && (protect(x - 1, z - 1) || protect(x, z - 1) || protect(x - 1, z) || protect(x, z));
  const used = new Uint8Array(ex.length);
  const loops: Corner[][] = [];
  for (let s = 0; s < ex.length; s++) {
    if (used[s]) continue;
    const raw: number[] = [];
    let e = s;
    do {
      used[e] = 1;
      raw.push(e);
      e = next(e);
    } while (e !== s && !used[e]);
    // corners: where the direction changes
    const cs: Corner[] = [];
    const n = raw.length;
    for (let i = 0; i < n; i++) {
      const a = raw[(i - 1 + n) % n];
      const b = raw[i];
      if (ed[a] === ed[b]) continue;
      const cr = DX[ed[a]] * DZ[ed[b]] - DZ[ed[a]] * DX[ed[b]];
      cs.push({ x: ex[b], z: ez[b], turn: cr > 0 ? 1 : -1, din: ed[a], dout: ed[b], lin: 0, lout: 0, sharp: prot(ex[b], ez[b]) });
    }
    const m = cs.length;
    for (let i = 0; i < m; i++) {
      const c = cs[i];
      const nx = cs[(i + 1) % m];
      const L = Math.abs(nx.x - c.x) + Math.abs(nx.z - c.z);
      c.lout = L;
      nx.lin = L;
    }
    if (m >= 4) loops.push(cs);
  }
  return loops;
}

// ---------- geometry helpers ----------
function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax;
  const vz = bz - az;
  const L2 = vx * vx + vz * vz;
  let u = L2 > 0 ? ((px - ax) * vx + (pz - az) * vz) / L2 : 0;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  return Math.hypot(px - ax - vx * u, pz - az - vz * u);
}
function polyDist(px: number, pz: number, pts: P2[], closed: boolean): number {
  let d = Infinity;
  const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    d = Math.min(d, segDist(px, pz, a.x, a.z, b.x, b.z));
  }
  return d;
}
/** Even-odd: is (px, pz) inside the closed polygon? */
export function inPoly(px: number, pz: number, pts: P2[]): boolean {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.z > pz !== b.z > pz && px < ((b.x - a.x) * (pz - a.z)) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
}
function inTri(px: number, pz: number, a: P2, b: P2, c: P2): boolean {
  const s1 = (b.x - a.x) * (pz - a.z) - (b.z - a.z) * (px - a.x);
  const s2 = (c.x - b.x) * (pz - b.z) - (c.z - b.z) * (px - b.x);
  const s3 = (a.x - c.x) * (pz - c.z) - (a.z - c.z) * (px - c.x);
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
}
const TAU = Math.PI * 2;
/** Is angle `a` within the sweep that starts at a0 and turns sw radians? */
export function inSweep(a: number, a0: number, sw: number): boolean {
  if (sw >= 0) return ((((a - a0) % TAU) + TAU) % TAU) <= sw + 1e-9;
  return ((((a0 - a) % TAU) + TAU) % TAU) <= -sw + 1e-9;
}
/** Closest point of a primitive to (px, pz). */
export function closest(p: Prim, px: number, pz: number): [number, number] {
  if (p.k === 0) {
    const vx = p.bx - p.ax;
    const vz = p.bz - p.az;
    const L2 = vx * vx + vz * vz;
    let u = L2 > 0 ? ((px - p.ax) * vx + (pz - p.az) * vz) / L2 : 0;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    return [p.ax + vx * u, p.az + vz * u];
  }
  const vx = px - p.cx;
  const vz = pz - p.cz;
  const a = Math.atan2(vz, vx);
  if (inSweep(a, p.a0, p.sw)) {
    const d = Math.hypot(vx, vz) || 1;
    return [p.cx + (vx / d) * p.r, p.cz + (vz / d) * p.r];
  }
  const ax = p.cx + Math.cos(p.a0) * p.r;
  const az = p.cz + Math.sin(p.a0) * p.r;
  const bx = p.cx + Math.cos(p.a0 + p.sw) * p.r;
  const bz = p.cz + Math.sin(p.a0 + p.sw) * p.r;
  return Math.hypot(px - ax, pz - az) <= Math.hypot(px - bx, pz - bz) ? [ax, az] : [bx, bz];
}

// ---------- smoothing ----------
interface QV {
  x: number;
  z: number;
  r: number;
}

/** Turn runs of small steps into slopes; returns the outline's vertices with the radius each one wants. */
function unstep(cs: Corner[], o: SmoothOpts): QV[] {
  const n = cs.length;
  const want = cs.map((c) => (c.sharp ? 0 : Math.max(0, o.radius(c))));
  const plain = cs.map((c, i) => ({ x: c.x, z: c.z, r: want[i] }));
  if (!o.stairs) return plain;
  // edge i runs from corner i to corner i+1
  const step = cs.map((c, i) => {
    const d = cs[(i + 1) % n];
    return c.lout <= 3 && c.turn !== d.turn && !c.sharp && !d.sharp;
  });
  const link = cs.map((c, i) => step[i] && step[(i + 1) % n] && Math.min(c.lout, cs[(i + 1) % n].lout) === 1);
  const inRun = cs.map((_, i) => link[i] || link[(i - 1 + n) % n]);
  if (!inRun.some(Boolean)) return plain;
  if (inRun.every(Boolean)) {
    // the whole loop is a staircase (a round blob): the middles of its edges
    return cs.map((c, i) => {
      const d = cs[(i + 1) % n];
      return { x: (c.x + d.x) / 2, z: (c.z + d.z) / 2, r: 6 };
    });
  }
  // runs: maximal chains of linked edges; check each one against the key points before taking it
  const runs: [number, number][] = [];
  let s0 = 0;
  while (inRun[s0]) s0++;
  for (let k = 1; k <= n; k++) {
    const i = (s0 + k) % n;
    if (inRun[i] && !inRun[(i - 1 + n) % n]) {
      let j = i;
      while (inRun[(j + 1) % n]) j = (j + 1) % n;
      runs.push([i, j]);
    }
  }
  const take = new Uint8Array(n);
  const P = (i: number) => cs[((i % n) + n) % n];
  for (const [a, b] of runs) {
    const len = ((b - a + n) % n) + 1;
    // a real staircase: four edges or more, or a short one made of single steps (not a corner with a long flat)
    let maxL = 0;
    for (let k = 0; k < len; k++) maxL = Math.max(maxL, P(a + k).lout);
    if (len < 4 && maxL > 1) continue;
    // the corners it replaces, with the edges on each side
    const before = P(a - 1);
    const first = P(a);
    const last = P(b + 1);
    const after = P(b + 2);
    const ua = Math.min(0.5, before.lout / 2);
    const ub = Math.min(0.5, last.lout / 2);
    const da = { x: Math.sign(first.x - before.x), z: Math.sign(first.z - before.z) };
    const db = { x: Math.sign(after.x - last.x), z: Math.sign(after.z - last.z) };
    const ta = { x: first.x - da.x * ua, z: first.z - da.z * ua };
    const tb = { x: last.x + db.x * ub, z: last.z + db.z * ub };
    const orig: P2[] = [ta];
    const neu: P2[] = [ta];
    for (let k = 0; k <= len; k++) orig.push(P(a + k));
    for (let k = 0; k < len; k++) {
      const c = P(a + k);
      const d = P(a + k + 1);
      neu.push({ x: (c.x + d.x) / 2, z: (c.z + d.z) / 2 });
    }
    orig.push(tb);
    neu.push(tb);
    let ok = true;
    for (const kp of o.keys ?? []) {
      const changed = [...orig, ...[...neu].reverse()];
      if (inPoly(kp.x, kp.z, changed)) {
        ok = false;
        break;
      }
      const dn = polyDist(kp.x, kp.z, neu, false);
      if (dn < kp.c && dn < polyDist(kp.x, kp.z, orig, false) - 1e-6) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    for (let k = 0; k < len; k++) take[(a + k) % n] = 1;
  }
  if (!take.some(Boolean)) return plain;
  // rebuild: corners next to a taken run go, the middles of the run's edges and two transition points come in
  const gone = cs.map((_, i) => take[i] || take[(i - 1 + n) % n]);
  const out: QV[] = [];
  let start = 0;
  while (gone[start]) start++;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    const c = cs[i];
    const d = cs[(i + 1) % n];
    if (!gone[i]) out.push({ x: c.x, z: c.z, r: want[i] });
    const ux = Math.sign(d.x - c.x);
    const uz = Math.sign(d.z - c.z);
    if (take[i]) {
      out.push({ x: (c.x + d.x) / 2, z: (c.z + d.z) / 2, r: 6 });
      continue;
    }
    const u = Math.min(0.5, c.lout / 2);
    // (where a slope meets a straight edge: a short blend)
    if (gone[i]) out.push({ x: c.x + ux * u, z: c.z + uz * u, r: 1.4 });
    if (gone[(i + 1) % n]) out.push({ x: d.x - ux * u, z: d.z - uz * u, r: 1.4 });
  }
  return out;
}

/** Round every corner of a polygon with a fillet of (up to) its wanted radius, keeping clear of the key points. */
function filletLoop(q0: QV[], keys: KeyPt[]): Loop {
  // drop repeated points
  const q: QV[] = [];
  for (const v of q0) {
    const p = q[q.length - 1];
    if (!p || Math.hypot(v.x - p.x, v.z - p.z) > 1e-6) q.push(v);
  }
  while (q.length > 2 && Math.hypot(q[0].x - q[q.length - 1].x, q[0].z - q[q.length - 1].z) < 1e-6) q.pop();
  const n = q.length;
  const din: P2[] = [];
  const L: number[] = []; // edge i: q[i] -> q[i+1]
  for (let i = 0; i < n; i++) {
    const a = q[i];
    const b = q[(i + 1) % n];
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    L.push(l);
    din.push({ x: (b.x - a.x) / l, z: (b.z - a.z) / l });
  }
  const th: number[] = [];
  const ts: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = din[(i - 1 + n) % n];
    const b = din[i];
    const t = Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z);
    th.push(t);
    ts.push(Math.abs(t) < 1e-4 ? 0 : q[i].r * Math.tan(Math.abs(t) / 2));
  }
  // share every edge between the fillets at its two ends
  const k = L.map((l, i) => {
    const s = ts[i] + ts[(i + 1) % n];
    return s > l ? l / s : 1;
  });
  const t = ts.map((v, i) => v * Math.min(k[(i - 1 + n) % n], k[i]));
  const prims: Prim[] = [];
  const arcs: ({ ax: number; az: number; bx: number; bz: number; c: Prim & { k: 1 } } | null)[] = [];
  for (let i = 0; i < n; i++) {
    const Q = q[i];
    const a = din[(i - 1 + n) % n];
    const b = din[i];
    const prev = q[(i - 1 + n) % n];
    const nxt = q[(i + 1) % n];
    let ti = t[i];
    let arc: (typeof arcs)[number] = null;
    for (let tries = 0; ti > 0.01 && tries < 14; tries++) {
      const half = Math.tan(Math.abs(th[i]) / 2);
      const r = ti / half;
      const A = { x: Q.x - a.x * ti, z: Q.z - a.z * ti };
      const B = { x: Q.x + b.x * ti, z: Q.z + b.z * ti };
      const s = th[i] > 0 ? 1 : -1;
      const C = { x: A.x - a.z * r * s, z: A.z + a.x * r * s };
      const a0 = Math.atan2(A.z - C.z, A.x - C.x);
      const c: Prim & { k: 1 } = { k: 1, cx: C.x, cz: C.z, r, a0, sw: th[i] };
      let bad = false;
      for (const kp of keys) {
        if (Math.hypot(kp.x - Q.x, kp.z - Q.z) > ti + kp.c + 0.01) continue;
        if (inTri(kp.x, kp.z, A, Q, B) && Math.hypot(kp.x - C.x, kp.z - C.z) > r) {
          bad = true;
          break;
        }
        const [cx, cz] = closest(c, kp.x, kp.z);
        const dArc = Math.hypot(kp.x - cx, kp.z - cz);
        const dOrig = Math.min(segDist(kp.x, kp.z, prev.x, prev.z, Q.x, Q.z), segDist(kp.x, kp.z, Q.x, Q.z, nxt.x, nxt.z));
        if (dArc < Math.min(kp.c, dOrig) - 1e-6) {
          bad = true;
          break;
        }
      }
      if (!bad) {
        arc = { ax: A.x, az: A.z, bx: B.x, bz: B.z, c };
        break;
      }
      ti *= 0.72;
    }
    arcs.push(arc);
  }
  for (let i = 0; i < n; i++) {
    const arc = arcs[i];
    const nx = arcs[(i + 1) % n];
    const ex = arc ? arc.bx : q[i].x;
    const ez = arc ? arc.bz : q[i].z;
    const sx = nx ? nx.ax : q[(i + 1) % n].x;
    const sz = nx ? nx.az : q[(i + 1) % n].z;
    if (arc) prims.push(arc.c);
    if (Math.hypot(sx - ex, sz - ez) > 1e-6) prims.push({ k: 0, ax: ex, az: ez, bx: sx, bz: sz });
  }
  const pts = sample(prims);
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const r = pts[(i + 1) % pts.length];
    area += p.x * r.z - r.x * p.z;
  }
  return { pts, prims, area: area / 2 };
}

/** The outline as a closed polyline: segments as they are, arcs every ~0.12 cells (at most 10° a step). */
export function sample(prims: Prim[]): P2[] {
  const pts: P2[] = [];
  for (const p of prims) {
    if (p.k === 0) {
      pts.push({ x: p.ax, z: p.az });
      continue;
    }
    const n = Math.max(2, Math.ceil(Math.abs(p.sw) / Math.min(Math.PI / 18, 0.12 / p.r)));
    for (let i = 0; i < n; i++) {
      const a = p.a0 + (p.sw * i) / n;
      pts.push({ x: p.cx + Math.cos(a) * p.r, z: p.cz + Math.sin(a) * p.r });
    }
  }
  return pts;
}

/** Smooth outlines of traced corners. */
export function smooth(loops: Corner[][], o: SmoothOpts): Loop[] {
  return loops.map((cs) => filletLoop(unstep(cs, o), o.keys ?? []));
}

/** Trace and smooth a set of cells in one go. */
export function smoothRegion(W: number, H: number, inside: (x: number, z: number) => boolean, o: SmoothOpts): Loop[] {
  return smooth(traceCorners(W, H, inside, o.protect), o);
}

// ---------- using the loops ----------
/** Fill a fine grid (S samples per cell) with `label` inside the loops (even-odd), or outside them with `invert`. */
export function fill(loops: Loop[], W: number, H: number, S: number, grid: Uint8Array, label: number, invert = false) {
  const FW = W * S;
  const xs: number[] = [];
  for (let j = 0; j < H * S; j++) {
    const z = (j + 0.5) / S;
    xs.length = 0;
    for (const lp of loops) {
      const p = lp.pts;
      for (let i = 0, k = p.length - 1; i < p.length; k = i++) {
        const a = p[i];
        const b = p[k];
        if (a.z > z !== b.z > z) xs.push(a.x + ((z - a.z) * (b.x - a.x)) / (b.z - a.z));
      }
    }
    xs.sort((a, b) => a - b);
    let inside = false;
    let x0 = 0;
    const row = j * FW;
    const span = (from: number, to: number) => {
      const i0 = Math.max(0, Math.ceil(from * S - 0.5));
      const i1 = Math.min(FW - 1, Math.ceil(to * S - 0.5) - 1);
      for (let i = i0; i <= i1; i++) grid[row + i] = label;
    };
    for (const x of xs) {
      if (inside !== invert) span(x0, x);
      inside = !inside;
      x0 = x;
    }
    if (inside !== invert) span(x0, W);
  }
}

/** Even-odd test against a set of loops. */
export function inLoops(loops: Loop[], x: number, z: number): boolean {
  let c = false;
  for (const lp of loops) if (inPoly(x, z, lp.pts)) c = !c;
  return c;
}
