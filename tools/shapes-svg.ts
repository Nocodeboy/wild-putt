// Debug: draws the smooth outlines of some holes as SVG (walls, ground, ponds, sand, ice) over the cell grid.
// Usage: npx tsx tools/shapes-svg.ts out-dir [L1 L2 … | hand | gen:course:n]
import { mkdirSync, writeFileSync } from 'node:fs';
import { COURSES } from '../src/sim/courses';
import { holeDef, ROUTE } from '../src/sim/route';
import { generate } from '../src/sim/gen';
import type { HoleDef, ThemeId } from '../src/sim/types';
import { G } from '../src/sim/types';
import { Sim } from '../src/sim/world';

const out = process.argv[2] ?? 'build/shapes';
mkdirSync(out, { recursive: true });
const args = process.argv.slice(3);
const defs: HoleDef[] = [];
for (const a of args.length ? args : ['hand']) {
  if (a === 'hand') for (const c of COURSES) for (const h of c.holes) defs.push(h);
  else if (a.startsWith('L')) defs.push(holeDef(Number(a.slice(1))));
  else if (a === 'route') for (const L of ROUTE) defs.push(holeDef(L.n));
  else if (a.startsWith('gen:')) {
    // gen:course:count[:d] — fresh holes straight from the generator
    const [, course, cnt, dd] = a.split(':');
    for (let k = 0; k < Number(cnt); k++) {
      const g = generate({ course: course as ThemeId, seed: 1000 + k * 7919, d: dd ? Number(dd) : 0.5 });
      defs.push({ id: `${course}-${k}-${g.template}`, name: { en: '', es: '' }, par: 3, map: g.map, spinners: g.spinners, movers: g.movers, coins: g.coins, hills: g.hills, mills: g.mills, course: course as ThemeId });
    }
  }
}
const K = 24;
for (const d of defs) {
  const s = new Sim(d);
  const W = s.W * K;
  const H = s.H * K;
  const col: Record<number, string> = { [G.Void]: '#222', [G.Green]: '#4caf50', [G.Sand]: '#e8d38a', [G.Water]: '#3a8ee6', [G.Ice]: '#cfeefa', [G.Lava]: '#ff7a1a', [G.Wall]: '#7a5a3a' };
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  // the fine ground
  const S = 8;
  for (let j = 0; j < s.H * S; j++)
    for (let i = 0; i < s.W * S; i++) {
      const g = s.fine[j * s.W * S + i];
      svg += `<rect x="${(i * K) / S}" y="${(j * K) / S}" width="${K / S + 0.3}" height="${K / S + 0.3}" fill="${col[g]}"/>`;
    }
  // cell grid
  for (let x = 0; x <= s.W; x++) svg += `<line x1="${x * K}" y1="0" x2="${x * K}" y2="${H}" stroke="#000" stroke-opacity="0.15"/>`;
  for (let z = 0; z <= s.H; z++) svg += `<line x1="0" y1="${z * K}" x2="${W}" y2="${z * K}" stroke="#000" stroke-opacity="0.15"/>`;
  const path = (loops: { pts: { x: number; z: number }[] }[], stroke: string, w = 1.5) => {
    for (const l of loops) svg += `<polygon points="${l.pts.map((p) => `${(p.x * K).toFixed(1)},${(p.z * K).toFixed(1)}`).join(' ')}" fill="none" stroke="${stroke}" stroke-width="${w}"/>`;
  };
  path(s.shape.land, '#fff', 1);
  path(s.shape.walls, '#ff0', 2);
  path(s.shape.pond, '#0ff', 1);
  path(s.shape.sand, '#f80', 1);
  for (const r of s.rails) svg += `<line x1="${r.ax * K}" y1="${r.az * K}" x2="${r.bx * K}" y2="${r.bz * K}" stroke="#f0f" stroke-width="3"/>`;
  for (const h of s.hills) svg += `<circle cx="${h.x * K}" cy="${h.z * K}" r="${h.r * K}" fill="#fff" fill-opacity="0.25" stroke="#fff" stroke-dasharray="3 3"/>`;
  for (const m of s.mills) svg += `<rect x="${(m.x - 0.5) * K}" y="${(m.z - 0.5) * K}" width="${K}" height="${K}" fill="#c0503a"/><text x="${m.x * K}" y="${(m.z + 0.3) * K}" font-size="14" text-anchor="middle" fill="#fff">W</text>`;
  for (const l of s.loops) svg += `<rect x="${(l.x - 0.5) * K}" y="${(l.z - 0.5) * K}" width="${K}" height="${K}" fill="#e83aa8"/><text x="${l.x * K}" y="${(l.z + 0.3) * K}" font-size="14" text-anchor="middle" fill="#fff">Q</text>`;
  for (const p of s.portals) svg += `<circle cx="${p.x * K}" cy="${p.z * K}" r="${0.34 * K}" fill="#222" stroke="#f33" stroke-width="3"/>`;
  for (let i = 0; i < s.ramp.length; i++) if (s.ramp[i]) svg += `<rect x="${(i % s.W) * K + 3}" y="${Math.floor(i / s.W) * K + 3}" width="${K - 6}" height="${K - 6}" fill="none" stroke="#ff0" stroke-width="2"/>`;
  svg += `<circle cx="${s.cup.x * K}" cy="${s.cup.z * K}" r="${s.cupR * K}" fill="#000"/>`;
  svg += `<circle cx="${s.tee.x * K}" cy="${s.tee.z * K}" r="${0.2 * K}" fill="#fff"/>`;
  svg += '</svg>';
  writeFileSync(`${out}/${d.id}.svg`, svg);
}
console.log(`${defs.length} holes -> ${out}`);
