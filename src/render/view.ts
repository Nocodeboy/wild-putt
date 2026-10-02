import * as THREE from 'three';
import { G, type SimEvent } from '../sim/types';
import { BALL_R, type Sim } from '../sim/world';
import { box, cone, cyl, dode, ico, merge, part, prism, type Part } from './geo';
import { FxList, Particles } from './particles';
import { hexStr, type Theme } from './themes';

const PI = Math.PI;
const PX = 32; // texels per cell on the painted green
const WALL_H = 0.42;

function lcg(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * k)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * k)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * k)));
  return `rgb(${r},${g},${b})`;
}

export interface Aim {
  angle: number;
  power: number;
}

/** Kept for the shared UI code (world icons): this game draws no labels. */
export interface Label {
  x: number;
  y: number;
  z: number;
  kind: 'leader' | 'target' | 'tame';
  v: number;
  ent: number;
}
export interface EdgeMark {
  x: number;
  z: number;
  kind: 'leader' | 'camp';
}

export class LevelView {
  readonly group = new THREE.Group();
  /** everything that belongs to the hole (it tilts on the ship) */
  private hole = new THREE.Group();
  private surface: THREE.Mesh;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private ball: THREE.Mesh;
  private ballShadow: THREE.Mesh;
  private flag: THREE.Group;
  private flagCloth: THREE.Mesh;
  private flagUp = 0;
  private bumpers: THREE.Mesh[] = [];
  private spinners: THREE.Group[] = [];
  private movers: THREE.Mesh[] = [];
  private dots: THREE.Mesh[] = [];
  private dotMats: THREE.MeshBasicMaterial[] = [];
  private ring: THREE.Mesh;
  private lavaPainted: Uint8Array;
  private sparkP = new Particles(900, { additive: true, soft: 0.2 });
  private puffP = new Particles(900, { soft: 0.35 });
  private sparks = new FxList(700);
  private puffs = new FxList(700);
  private lights: THREE.PointLight[] = [];
  private bulbs: THREE.Mesh[] = [];
  private tier: 'high' | 'medium' | 'low' = 'high';
  private trailT = 0;
  private time = 0;
  aim: Aim | null = null;
  labels: Label[] = [];
  edges: EdgeMark[] = [];
  shake = 0;
  flash = 0;

  constructor(
    private sim: Sim,
    private theme: Theme,
    tier: 'high' | 'medium' | 'low' = 'high',
  ) {
    const s = sim;
    this.hole.position.set(s.W / 2, 0, s.H / 2);
    const inner = new THREE.Group();
    inner.position.set(-s.W / 2, 0, -s.H / 2);
    this.hole.add(inner);
    this.group.add(this.hole);
    this.lavaPainted = new Uint8Array(s.W * s.H);

    // ---- the plate the hole stands on, and the walls ----
    inner.add(this.buildPlate());
    // ---- the painted surface ----
    this.canvas = document.createElement('canvas');
    this.canvas.width = s.W * PX;
    this.canvas.height = s.H * PX;
    this.ctx = this.canvas.getContext('2d')!;
    this.paint();
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const sg = new THREE.PlaneGeometry(s.W, s.H);
    sg.rotateX(-PI / 2);
    sg.translate(s.W / 2, 0.002, s.H / 2);
    this.surface = new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ map: this.tex, transparent: true, alphaTest: 0.5 }));
    this.surface.receiveShadow = true;
    inner.add(this.surface);
    // ---- the cup: rim and flag ----
    const rim = new THREE.Mesh(new THREE.TorusGeometry(s.cupR + 0.02, 0.035, 6, 24), new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }));
    rim.rotation.x = PI / 2;
    rim.position.set(s.cup.x, 0.01, s.cup.z);
    inner.add(rim);
    this.flag = new THREE.Group();
    this.flag.position.set(s.cup.x, 0, s.cup.z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.9, 6), new THREE.MeshLambertMaterial({ color: 0xf4f4f0 }));
    pole.position.y = 0.95;
    pole.castShadow = true;
    this.flag.add(pole);
    const fg = new THREE.PlaneGeometry(0.75, 0.46, 6, 1);
    fg.translate(0.39, 1.62, 0);
    this.flagCloth = new THREE.Mesh(fg, new THREE.MeshLambertMaterial({ color: theme.flag, side: THREE.DoubleSide }));
    this.flagCloth.castShadow = true;
    this.flag.add(this.flagCloth);
    inner.add(this.flag);
    // ---- obstacles ----
    const bumpGeo = merge([part(cyl(0.36, 0.4, 0.42, 14), 0xe8483a, 0, 0.21, 0), part(cyl(0.38, 0.38, 0.08, 14), 0xffffff, 0, 0.3, 0), part(ico(0.3, 1), 0xff6a5a, 0, 0.42, 0, 0, 0, 0, 1, 0.45, 1)]);
    const vmat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    for (const b of s.bumpers) {
      const m = new THREE.Mesh(bumpGeo, vmat);
      m.position.set(b.x, 0, b.z);
      m.castShadow = true;
      inner.add(m);
      this.bumpers.push(m);
    }
    for (const sp of s.spinners) {
      const g = new THREE.Group();
      g.position.set(sp.x, 0, sp.z);
      const post = new THREE.Mesh(merge([part(cyl(0.22, 0.26, 0.55, 10), 0x6a4a2e, 0, 0.27, 0), part(cone(0.3, 0.3, 10), theme.wallTop, 0, 0.7, 0)]), vmat);
      post.castShadow = true;
      g.add(post);
      const beam = new THREE.Group();
      beam.add(
        new THREE.Mesh(
          merge([
            part(box(sp.len * 2, 0.3, 0.28), 0xf4f0e6, 0, 0.3, 0),
            part(box(sp.len * 0.5, 0.31, 0.29), 0xe8483a, sp.len * 0.6, 0.3, 0),
            part(box(sp.len * 0.5, 0.31, 0.29), 0xe8483a, -sp.len * 0.6, 0.3, 0),
          ]),
          vmat,
        ),
      );
      beam.children[0].castShadow = true;
      g.add(beam);
      inner.add(g);
      this.spinners.push(beam);
    }
    for (const mv of s.movers) {
      const m = new THREE.Mesh(
        merge([part(box(mv.hw * 2, 0.5, mv.hh * 2), 0xbfe6f6, 0, 0.25, 0), part(box(mv.hw * 2 + 0.02, 0.08, mv.hh * 2 + 0.02), 0xffffff, 0, 0.46, 0), part(box(mv.hw * 1.2, 0.02, 0.06), 0x8ac8e8, 0, 0.51, 0)]),
        vmat,
      );
      m.castShadow = true;
      inner.add(m);
      this.movers.push(m);
    }
    // ---- the ball ----
    this.ball = new THREE.Mesh(new THREE.IcosahedronGeometry(BALL_R, 2), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }));
    this.ball.castShadow = true;
    inner.add(this.ball);
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(BALL_R * 1.1, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }));
    this.ballShadow.rotation.x = -PI / 2;
    inner.add(this.ballShadow);
    // ---- aim: dotted line and a power ring ----
    const dg = new THREE.SphereGeometry(0.06, 6, 4);
    for (let k = 0; k < 22; k++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
      const d = new THREE.Mesh(dg, mat);
      d.visible = false;
      d.renderOrder = 6;
      inner.add(d);
      this.dots.push(d);
      this.dotMats.push(mat);
    }
    const rg = new THREE.RingGeometry(0.34, 0.42, 32, 1, 0, PI * 2);
    rg.rotateX(-PI / 2);
    this.ring = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    this.ring.renderOrder = 6;
    inner.add(this.ring);
    // ---- surroundings ----
    this.buildSurround();
    this.group.add(this.sparkP.points, this.puffP.points);
    this.puffP.points.renderOrder = 3;
    this.sparkP.points.renderOrder = 4;
    this.setTier(tier);
  }

  setTier(t: 'high' | 'medium' | 'low') {
    this.tier = t;
    const k = t === 'high' ? 1 : t === 'medium' ? 0.6 : 0.3;
    this.sparks.cap = Math.round(700 * k);
    this.puffs.cap = Math.round(700 * k);
    this.lights.forEach((l, i) => (l.visible = t !== 'low' || i < 2));
  }

  // ---------- construction ----------
  private buildPlate(): THREE.Object3D {
    const s = this.sim;
    const t = this.theme;
    const depth = -t.outsideY;
    const P: Part[] = [];
    const W: Part[] = [];
    for (let z = 0; z < s.H; z++)
      for (let x = 0; x < s.W; x++) {
        const g = s.ground[z * s.W + x];
        if (g === G.Void) continue;
        // body of the plate: a thin coloured layer under the surface, then the base down to the surroundings
        P.push(part(box(1, 0.16, 1), t.base[0], x + 0.5, -0.08, z + 0.5));
        if (depth > 0.2) P.push(part(box(1, depth - 0.16, 1), t.base[1], x + 0.5, -0.16 - (depth - 0.16) / 2, z + 0.5));
        if (g === G.Wall) {
          // the rail: a solid block, its top in the theme's rail colour with a darker band where it meets the green
          W.push(part(box(1, WALL_H, 1), t.wall, x + 0.5, WALL_H / 2, z + 0.5));
          for (const [dx, dz] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const nx = x + dx;
            const nz = z + dz;
            if (nx < 0 || nz < 0 || nx >= s.W || nz >= s.H) continue;
            const ng = s.ground[nz * s.W + nx];
            if (ng === G.Wall || ng === G.Void) continue;
            W.push(part(box(dx ? 0.1 : 1.0, 0.03, dz ? 0.1 : 1.0), t.wallTop, x + 0.5 + dx * 0.45, WALL_H + 0.012, z + 0.5 + dz * 0.45));
          }
        }
      }
    // roofs: windows on the building sides; ship: hull planks — a few stripes on the outer faces
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const plate = new THREE.Mesh(merge(P), mat);
    plate.receiveShadow = true;
    g.add(plate);
    if (W.length) {
      const walls = new THREE.Mesh(merge(W), mat);
      walls.castShadow = true;
      walls.receiveShadow = true;
      g.add(walls);
    }
    if (t.surround === 'street') g.add(this.windows());
    return g;
  }

  /** Lit windows on the sides of the building the rooftop hole stands on. */
  private windows(): THREE.Object3D {
    const s = this.sim;
    const P: Part[] = [];
    const rnd = lcg(s.W * 31 + s.H);
    const solid = (x: number, z: number) => x >= 0 && z >= 0 && x < s.W && z < s.H && s.ground[z * s.W + x] !== G.Void;
    for (let z = 0; z < s.H; z++)
      for (let x = 0; x < s.W; x++) {
        if (!solid(x, z)) continue;
        for (const [dx, dz] of [
          [0, 1],
          [1, 0],
          [-1, 0],
        ]) {
          if (solid(x + dx, z + dz)) continue;
          for (let fl = 0; fl < 4; fl++) {
            if (rnd() < 0.35) continue;
            const y = -1.4 - fl * 2;
            const c = rnd() < 0.6 ? 0xffd27a : 0x3a3a4a;
            const px = x + 0.5 + dx * 0.51;
            const pz = z + 0.5 + dz * 0.51;
            P.push(part(box(dx ? 0.02 : 0.5, 0.7, dz ? 0.02 : 0.5), c, px, y, pz));
          }
        }
      }
    if (!P.length) return new THREE.Group();
    return new THREE.Mesh(merge(P), new THREE.MeshBasicMaterial({ vertexColors: true }));
  }

  private paint() {
    const s = this.sim;
    const t = this.theme;
    const ctx = this.ctx;
    const rnd = lcg(s.W * 977 + s.H * 13 + 5);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (let z = 0; z < s.H; z++)
      for (let x = 0; x < s.W; x++) this.paintCell(x, z, rnd);
    // the cup
    const cx = s.cup.x * PX;
    const cz = s.cup.z * PX;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.arc(cx, cz, s.cupR * PX * 1.45, 0, PI * 2);
    ctx.fill();
    ctx.fillStyle = '#141414';
    ctx.beginPath();
    ctx.arc(cx, cz, s.cupR * PX, 0, PI * 2);
    ctx.fill();
    // the tee mat
    const tx = s.tee.x * PX;
    const tz = s.tee.z * PX;
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(tx - PX * 0.42, tz - PX * 0.42, PX * 0.84, PX * 0.84);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.arc(tx, tz, 3, 0, PI * 2);
    ctx.fill();
  }

  private paintCell(x: number, z: number, rnd: () => number) {
    const s = this.sim;
    const t = this.theme;
    const ctx = this.ctx;
    const i = z * s.W + x;
    const g = s.ground[i];
    const px = x * PX;
    const pz = z * PX;
    ctx.clearRect(px, pz, PX, PX);
    const dots = (c: string, n: number, w = 2, h = 2) => {
      ctx.fillStyle = c;
      for (let k = 0; k < n; k++) ctx.fillRect(px + rnd() * (PX - w), pz + rnd() * (PX - h), w, h);
    };
    switch (g) {
      case G.Void:
      case G.Wall:
        return;
      case G.Green: {
        if (t.surround === 'sea') {
          // deck planks running along z
          for (let k = 0; k < 4; k++) {
            ctx.fillStyle = shade(t.green[k % 2], 0.94 + ((x * 7 + k * 3) % 5) * 0.03);
            ctx.fillRect(px + k * (PX / 4), pz, PX / 4, PX);
            ctx.fillStyle = shade(t.green[0], 0.7);
            ctx.fillRect(px + k * (PX / 4), pz, 1, PX);
          }
          if ((z + x) % 3 === 0) {
            ctx.fillStyle = shade(t.green[0], 0.6);
            ctx.fillRect(px + 4, pz + PX - 3, PX - 8, 1);
          }
        } else {
          // mowed stripes (two rows per stripe)
          ctx.fillStyle = t.green[Math.floor(z / 2) % 2];
          ctx.fillRect(px, pz, PX, PX);
          dots(shade(t.green[0], 1.1), 6, 1, 2);
          dots(shade(t.green[1], 0.9), 6, 1, 2);
        }
        break;
      }
      case G.Sand:
        ctx.fillStyle = t.sand;
        ctx.fillRect(px, pz, PX, PX);
        dots(shade(t.sand, 0.85), 18, 2, 2);
        dots(shade(t.sand, 1.08), 10, 2, 1);
        break;
      case G.Ice:
        ctx.fillStyle = t.ice;
        ctx.fillRect(px, pz, PX, PX);
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = 1.5;
        if (rnd() < 0.5) {
          ctx.beginPath();
          ctx.moveTo(px + rnd() * PX, pz + rnd() * PX);
          ctx.lineTo(px + rnd() * PX, pz + rnd() * PX);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(px + 2, pz + 2, PX * 0.4, 3);
        break;
      case G.Water:
        ctx.fillStyle = t.water;
        ctx.fillRect(px, pz, PX, PX);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        for (let k = 0; k < 2; k++) ctx.fillRect(px + rnd() * (PX - 10), pz + rnd() * (PX - 2), 10, 2);
        break;
      case G.Lava: {
        const grd = ctx.createRadialGradient(px + PX / 2, pz + PX / 2, 2, px + PX / 2, pz + PX / 2, PX * 0.8);
        grd.addColorStop(0, '#ffe080');
        grd.addColorStop(0.5, t.lava);
        grd.addColorStop(1, '#b8300a');
        ctx.fillStyle = grd;
        ctx.fillRect(px, pz, PX, PX);
        ctx.fillStyle = 'rgba(60,20,10,0.55)';
        for (let k = 0; k < 3; k++) {
          ctx.beginPath();
          ctx.arc(px + rnd() * PX, pz + rnd() * PX, 2 + rnd() * 4, 0, PI * 2);
          ctx.fill();
        }
        this.lavaPainted[i] = 1;
        break;
      }
    }
    // slopes: a column of white chevrons pointing downhill
    const sl = s.slope[i];
    if (sl) {
      ctx.save();
      ctx.translate(px + PX / 2, pz + PX / 2);
      ctx.rotate(sl === 1 ? -PI / 2 : sl === 2 ? PI / 2 : sl === 3 ? PI : 0);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (const o of [-7, 5]) {
        ctx.beginPath();
        ctx.moveTo(o - 4, -8);
        ctx.lineTo(o + 4, 0);
        ctx.lineTo(o - 4, 8);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /** The world around the hole. */
  private buildSurround() {
    const s = this.sim;
    const t = this.theme;
    const rnd = lcg(s.W * 131 + s.H * 7 + 11);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    // the ground (or sea, or street) all around
    const og = new THREE.PlaneGeometry(400, 400);
    og.rotateX(-PI / 2);
    const outside = new THREE.Mesh(og, new THREE.MeshLambertMaterial({ color: t.outside }));
    outside.position.set(s.W / 2, t.outsideY, s.H / 2);
    outside.receiveShadow = true;
    this.group.add(outside);
    const far = (min: number, max: number): [number, number] => {
      // a point around the hole, outside its rectangle
      for (;;) {
        const x = rnd() * (s.W + max * 2) - max;
        const z = rnd() * (s.H + max * 2) - max;
        const dx = Math.max(-x, x - s.W, 0);
        const dz = Math.max(-z, z - s.H, 0);
        const d = Math.max(dx, dz);
        if (d >= min && d <= max) return [x, z];
      }
    };
    const y0 = t.outsideY;
    const P: Part[] = [];
    const pick = (k: number) => t.props[Math.abs(k) % t.props.length];
    switch (t.surround) {
      case 'lawn':
        for (let k = 0; k < 46; k++) {
          const [x, z] = far(1.5, 16);
          const sc = 0.8 + rnd() * 0.7;
          if (rnd() < 0.55) {
            P.push(part(cyl(0.12 * sc, 0.18 * sc, 1.2 * sc, 6), 0x7a5231, x, y0 + 0.6 * sc, z));
            P.push(part(ico(0.85 * sc), pick(k % 2), x, y0 + 1.7 * sc, z, k, k, 0));
            P.push(part(ico(0.55 * sc), pick((k + 1) % 2), x + 0.35 * sc, y0 + 2.1 * sc, z + 0.2 * sc, k, 0, 0));
          } else {
            P.push(part(ico(0.45 * sc), pick(k % 2), x, y0 + 0.3 * sc, z, k, 0, 0, 1, 0.75, 1));
            for (let f = 0; f < 3; f++) P.push(part(ico(0.08), pick(2 + ((f + k) % 3)), x + Math.cos(f * 2 + k) * 0.4, y0 + 0.55 * sc, z + Math.sin(f * 2 + k) * 0.4));
          }
        }
        // a little picket fence along the bottom edge
        for (let x = -2; x < s.W + 2; x += 0.5) P.push(part(box(0.1, 0.6, 0.06), 0xffffff, x, y0 + 0.3, s.H + 1.2));
        P.push(part(box(s.W + 4, 0.08, 0.05), 0xffffff, s.W / 2, y0 + 0.45, s.H + 1.2));
        break;
      case 'street':
        // the neighbouring buildings, rising from the street to around the rooftop
        for (let k = 0; k < 40; k++) {
          const [x, z] = far(2.5, 22);
          const w = 2 + rnd() * 3;
          const d = 2 + rnd() * 3;
          const top = -2.2 + rnd() * 3.2;
          const hgt = top - y0;
          P.push(part(box(w, hgt, d), pick(k), x, y0 + hgt / 2, z));
          P.push(part(box(w + 0.2, 0.2, d + 0.2), 0xd8c4a8, x, top, z));
          if (rnd() < 0.6) P.push(part(box(0.5, 0.9, 0.5), 0x8a3a28, x + w * 0.25, top + 0.45, z - d * 0.2));
          if (rnd() < 0.5) P.push(part(cyl(0.5, 0.5, 0.9, 8), 0x6a5a50, x - w * 0.2, top + 0.45, z + d * 0.2));
        }
        // chimneys and an antenna on the hole's own building edges
        for (let k = 0; k < 6; k++) {
          const [x, z] = far(0.6, 1.4);
          P.push(part(box(0.55, 1.2, 0.55), 0xa84a32, x, -0.6, z));
          P.push(part(box(0.65, 0.12, 0.65), 0x5a5050, x, 0.05, z));
        }
        break;
      case 'sea':
        // hull sides, masts with sails and a few rocks in the sea
        for (const side of [-1, 1]) {
          const x = side < 0 ? -0.9 : s.W + 0.9;
          P.push(part(cyl(0.14, 0.18, 9, 8), 0x6a4020, x, 4.4, s.H * 0.35));
          P.push(part(box(0.08, 3.4, 2.8), 0xf2ece0, x + side * 0.15, 5.2, s.H * 0.35));
          P.push(part(box(0.06, 0.6, 1.0), 0x1a1a1a, x, 9.1, s.H * 0.35));
        }
        for (let k = 0; k < 10; k++) {
          const [x, z] = far(6, 30);
          P.push(part(dode(0.8 + rnd() * 1.6), 0x6a7a80, x, y0 + 0.2, z, k, k, 0, 1, 0.6, 1));
        }
        break;
      case 'fairground':
        // striped tents, a ferris wheel and posts with strings of bulbs
        for (let k = 0; k < 10; k++) {
          const [x, z] = far(3, 14);
          const c = pick(k);
          P.push(part(cyl(1.2, 1.2, 1.4, 8), c, x, y0 + 0.7, z));
          P.push(part(cone(1.4, 1.2, 8), 0xffffff, x, y0 + 2.0, z));
          P.push(part(cone(0.2, 0.5, 6), c, x, y0 + 2.8, z));
        }
        {
          const wx = s.W + 7;
          const wz = -3;
          const R = 5;
          for (let k = 0; k < 12; k++) {
            const a = (k / 12) * PI * 2;
            P.push(part(box(0.12, R, 0.12), 0xf2f2f2, wx + Math.cos(a) * R * 0.5, y0 + R + 1 + Math.sin(a) * R * 0.5, wz, 0, 0, a + PI / 2));
            P.push(part(box(0.7, 0.6, 0.7), pick(k), wx + Math.cos(a) * R, y0 + R + 1 + Math.sin(a) * R, wz));
          }
          P.push(part(box(0.3, R + 1.5, 0.3), 0xd8d8d8, wx - 1, y0 + (R + 1) / 2, wz, 0, 0, 0.25));
          P.push(part(box(0.3, R + 1.5, 0.3), 0xd8d8d8, wx + 1, y0 + (R + 1) / 2, wz, 0, 0, -0.25));
        }
        // bulbs around the hole: point lights at a few of them
        {
          const bulbGeo = new THREE.SphereGeometry(0.1, 8, 6);
          const n = Math.round((s.W + s.H) * 1.2);
          for (let k = 0; k < n; k++) {
            const u = k / n;
            const per = 2 * (s.W + s.H);
            let d = u * per;
            let x = 0;
            let z = 0;
            if (d < s.W) [x, z] = [d, -0.6];
            else if ((d -= s.W) < s.H) [x, z] = [s.W + 0.6, d];
            else if ((d -= s.H) < s.W) [x, z] = [s.W - d, s.H + 0.6];
            else [x, z] = [-0.6, s.H - (d - s.W)];
            const m = new THREE.Mesh(bulbGeo, new THREE.MeshBasicMaterial({ color: pick(k) }));
            m.position.set(x, 1.1 + Math.sin(u * PI * 16) * 0.12, z);
            this.group.add(m);
            this.bulbs.push(m);
          }
          for (let k = 0; k < 4; k++) {
            const l = new THREE.PointLight(pick(k + 1), 10, 14, 1.4);
            l.position.set(k % 2 ? s.W + 1 : -1, 2.4, k < 2 ? s.H * 0.25 : s.H * 0.75);
            this.group.add(l);
            this.lights.push(l);
          }
        }
        for (let x = -1; x <= s.W + 1; x += s.W + 2)
          for (let z = -1; z <= s.H + 1; z += (s.H + 2) / 2) P.push(part(box(0.12, 1.3, 0.12), 0x8a8a9a, x, y0 + 0.9, z));
        break;
      case 'ice':
        for (let k = 0; k < 34; k++) {
          const [x, z] = far(1.5, 18);
          const sc = 0.7 + rnd() * 1.2;
          if (rnd() < 0.5) {
            P.push(part(cyl(0.1 * sc, 0.14 * sc, 0.6 * sc, 6), 0x5a3e28, x, y0 + 0.3 * sc, z));
            P.push(part(cone(0.8 * sc, 1.3 * sc, 7), pick(3), x, y0 + 1.1 * sc, z));
            P.push(part(cone(0.55 * sc, 1.0 * sc, 7), 0xffffff, x, y0 + 1.75 * sc, z));
          } else P.push(part(dode(0.7 * sc), pick(k % 3), x, y0 + 0.3 * sc, z, k, k * 2, 0, 1, 0.8 + rnd(), 1));
        }
        break;
      case 'magma': {
        for (let k = 0; k < 30; k++) {
          const [x, z] = far(1.5, 18);
          const sc = 0.8 + rnd() * 1.5;
          P.push(part(dode(0.8 * sc), pick(k % 2), x, y0 + 0.4 * sc, z, k, k, 0, 1, 0.7 + rnd() * 0.8, 1));
        }
        // glowing cracks on the ground around
        const cracks: Part[] = [];
        for (let k = 0; k < 18; k++) {
          const [x, z] = far(1, 20);
          cracks.push(part(box(0.25, 0.02, 2 + rnd() * 4), 0xff6a1a, x, y0 + 0.01, z, 0, rnd() * PI, 0));
        }
        this.group.add(new THREE.Mesh(merge(cracks), new THREE.MeshBasicMaterial({ vertexColors: true })));
        const l = new THREE.PointLight(0xff6a1a, 18, 16, 1.4);
        l.position.set(s.W / 2, 2, s.H + 1);
        this.group.add(l);
        this.lights.push(l);
        break;
      }
    }
    if (P.length) {
      const m = new THREE.Mesh(merge(P), mat);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }
    if (t.night && t.surround !== 'fairground' && t.surround !== 'magma') {
      const l = new THREE.PointLight(0xfff0d0, 16, 30, 1.2);
      l.position.set(s.W / 2, 6, s.H / 2);
      this.group.add(l);
      this.lights.push(l);
    }
  }

  // ---------- per frame ----------
  update(dt: number, time: number, pxScale: number) {
    this.time = time;
    const s = this.sim;
    const b = s.ball;
    // the ship's deck tilts with the swell
    if (s.def.sway) {
      const k = s.swayAt(s.time) / s.def.sway.amp;
      this.hole.rotation.z = -k * 0.07;
      this.hole.position.y = Math.sin((s.time / s.def.sway.period) * PI * 4) * 0.06;
    }
    // ball
    const y = BALL_R + b.y;
    this.ball.position.set(b.x, y, b.z);
    const sp = Math.hypot(b.vx, b.vz);
    if (sp > 0.01) {
      this.ball.rotation.x += (b.vz / BALL_R) * dt;
      this.ball.rotation.z -= (b.vx / BALL_R) * dt;
    }
    this.ball.visible = b.y > -0.9;
    this.ballShadow.position.set(b.x + 0.05, 0.004, b.z + 0.05);
    this.ballShadow.visible = b.y > -0.05;
    // trail when it flies
    if (sp > 6 && this.tier !== 'low') {
      this.trailT += dt * sp;
      while (this.trailT > 0.5) {
        this.trailT -= 0.5;
        this.sparks.add({ x: b.x, y: BALL_R, z: b.z, life: 0.35, s0: 0.16, s1: 0.02, r: 1, g: 1, b: 1, a: 0.6 });
      }
    }
    // flag: waves in the wind, pops up when the ball drops
    const want = s.state === 'sunk' || s.state === 'done' ? (s.result && !s.result.maxed ? 1 : 0) : 0;
    this.flagUp += (want - this.flagUp) * Math.min(1, dt * 6);
    this.flag.position.y = this.flagUp * 0.9;
    const pos = this.flagCloth.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      pos.setZ(i, Math.sin(x * 6 - time * 7) * 0.06 * x);
    }
    pos.needsUpdate = true;
    // obstacles
    s.spinners.forEach((sp2, k) => (this.spinners[k].rotation.y = -s.spinnerAngle(sp2, s.time)));
    s.movers.forEach((m, k) => {
      const p = s.moverPos(m, s.time);
      this.movers[k].position.set(p.x, 0, p.z);
    });
    s.bumpers.forEach((p, k) => {
      const u = Math.max(0, 1 - (s.time - p.hit) / 0.25);
      this.bumpers[k].scale.set(1 + u * 0.25, 1 - u * 0.15, 1 + u * 0.25);
    });
    // lava grew: repaint those cells
    if (s.lavaDist) {
      const rnd = lcg(Math.floor(time * 1000));
      let any = false;
      for (let i = 0; i < s.ground.length; i++)
        if (s.ground[i] === G.Lava && !this.lavaPainted[i]) {
          this.paintCell(i % s.W, Math.floor(i / s.W), rnd);
          any = true;
          if (this.tier !== 'low') for (let k = 0; k < 4; k++) this.sparks.add({ x: (i % s.W) + Math.random(), y: 0.1, z: Math.floor(i / s.W) + Math.random(), vy: 1.5 + Math.random() * 2, life: 0.8, s0: 0.15, s1: 0.04, r: 1, g: 0.5, b: 0.15, grav: 3 });
        }
      if (any) this.tex.needsUpdate = true;
      // embers above the lava
      if (this.tier !== 'low' && Math.random() < dt * 12) {
        const i = Math.floor(Math.random() * s.ground.length);
        if (s.ground[i] === G.Lava) this.sparks.add({ x: (i % s.W) + Math.random(), y: 0.1, z: Math.floor(i / s.W) + Math.random(), vy: 1 + Math.random(), life: 1.2, s0: 0.1, s1: 0.03, r: 1, g: 0.55, b: 0.2 });
      }
    }
    // glints on the sea
    if (this.theme.surround === 'sea' && this.tier !== 'low' && Math.random() < dt * 25) {
      const a = Math.random() * PI * 2;
      const r = Math.max(s.W, s.H) * 0.6 + Math.random() * 14;
      this.sparks.add({ x: s.W / 2 + Math.cos(a) * r, y: this.theme.outsideY + 0.05, z: s.H / 2 + Math.sin(a) * r, life: 1.2, s0: 0.35, s1: 0.1, r: 0.8, g: 0.95, b: 1, a: 0.7 });
    }
    for (let k = 0; k < this.bulbs.length; k++) this.bulbs[k].visible = (Math.floor(time * 3) + k) % 7 !== 0;
    this.updateAim(time);
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.sparks.update(dt);
    this.puffs.update(dt);
    this.sparkP.begin();
    this.sparks.draw(this.sparkP, 0.02);
    this.sparkP.end(pxScale);
    this.puffP.begin();
    this.puffs.draw(this.puffP, 0.1);
    this.puffP.end(pxScale);
  }

  private updateAim(time: number) {
    const s = this.sim;
    const a = this.aim;
    const rm = this.ring.material as THREE.MeshBasicMaterial;
    if (!a || s.state !== 'aim') {
      this.dots.forEach((d) => (d.visible = false));
      rm.opacity = s.state === 'aim' ? 0.35 + Math.sin(time * 4) * 0.15 : 0;
      this.ring.position.set(s.ball.x, 0.01, s.ball.z);
      this.ring.scale.setScalar(1);
      rm.color.setHex(0xffffff);
      return;
    }
    // power colour: green → yellow → red
    const idle = a.power < 0.02;
    const p = idle ? 0.3 : a.power;
    const col = idle ? new THREE.Color(0xdddddd) : new THREE.Color().setHSL(0.33 - p * 0.33, 0.9, 0.55);
    rm.opacity = 0.9;
    rm.color.copy(col);
    this.ring.position.set(s.ball.x, 0.01, s.ball.z);
    this.ring.scale.setScalar(1 + p * 0.6);
    const pts = s.previewPath(a.angle, p, 2.5 + p * 7);
    const n = this.dots.length;
    // spread the dots evenly along the path
    let total = 0;
    const seg: number[] = [0];
    for (let i = 1; i < pts.length; i++) {
      total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      seg.push(total);
    }
    let j = 1;
    for (let k = 0; k < n; k++) {
      const d = ((k + 1) / n) * total;
      const dot = this.dots[k];
      if (pts.length < 2 || total < 0.05) {
        dot.visible = false;
        continue;
      }
      while (j < seg.length - 1 && seg[j] < d) j++;
      const u = (d - seg[j - 1]) / Math.max(1e-6, seg[j] - seg[j - 1]);
      dot.visible = true;
      dot.position.set(pts[j - 1].x + (pts[j].x - pts[j - 1].x) * u, 0.08, pts[j - 1].z + (pts[j].z - pts[j - 1].z) * u);
      this.dotMats[k].color.copy(col);
      this.dotMats[k].opacity = (idle ? 0.45 : 0.95) * (1 - (k / n) * 0.7);
    }
  }

  // ---------- events -> effects ----------
  private burst(x: number, y: number, z: number, n: number, r: number, g: number, b: number, speed = 3, life = 0.6) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * PI * 2;
      const v = speed * (0.3 + Math.random());
      this.sparks.add({ x, y, z, vx: Math.cos(a) * v, vz: Math.sin(a) * v, vy: 1 + Math.random() * speed, grav: 9, life: life * (0.6 + Math.random() * 0.6), s0: 0.14, s1: 0.04, r, g, b });
    }
  }

  onEvent(ev: SimEvent) {
    const { x, z } = ev;
    const s = this.sim;
    switch (ev.type) {
      case 'putt':
        for (let k = 0; k < 5; k++) this.puffs.add({ x, y: 0.05, z, vy: 0.4, vx: (Math.random() - 0.5) * 0.8, vz: (Math.random() - 0.5) * 0.8, life: 0.5, s0: 0.1, s1: 0.3, r: 1, g: 1, b: 1, a: 0.4, drag: 2 });
        break;
      case 'wall':
        this.burst(x, 0.25, z, 4, 1, 1, 0.9, 1.5, 0.3);
        if ((ev.n ?? 0) > 7) this.shake = Math.max(this.shake, 0.08);
        break;
      case 'bumper':
        this.burst(x, 0.4, z, 12, 1, 0.4, 0.3, 3, 0.4);
        this.shake = Math.max(this.shake, 0.1);
        break;
      case 'spinner':
      case 'mover':
        this.burst(x, 0.3, z, 6, 1, 1, 1, 2, 0.3);
        break;
      case 'sunk': {
        const hio = ev.n === 1;
        this.confetti(s.cup.x, s.cup.z, hio ? 3 : 1);
        this.shake = Math.max(this.shake, hio ? 0.3 : 0.1);
        break;
      }
      case 'water':
        for (let k = 0; k < 14; k++) this.puffs.add({ x, y: 0.05, z, vy: 2 + Math.random() * 2, vx: (Math.random() - 0.5) * 2, vz: (Math.random() - 0.5) * 2, grav: 9, life: 0.7, s0: 0.12, s1: 0.06, r: 0.75, g: 0.9, b: 1, a: 0.9 });
        break;
      case 'lava':
        this.burst(x, 0.1, z, 24, 1, 0.5, 0.15, 3, 0.8);
        for (let k = 0; k < 6; k++) this.puffs.add({ x, y: 0.2, z, vy: 1.2, vx: (Math.random() - 0.5), life: 1.2, s0: 0.3, s1: 0.9, r: 0.3, g: 0.28, b: 0.28, a: 0.5 });
        this.flash = 0.4;
        break;
      case 'sand':
        for (let k = 0; k < 6; k++) this.puffs.add({ x, y: 0.05, z, vy: 0.8, vx: (Math.random() - 0.5) * 1.2, vz: (Math.random() - 0.5) * 1.2, life: 0.6, s0: 0.1, s1: 0.3, r: 0.95, g: 0.88, b: 0.65, a: 0.6, drag: 2 });
        break;
      case 'lavaRise':
        this.shake = Math.max(this.shake, 0.15);
        break;
    }
  }

  private confetti(x: number, z: number, scale = 1) {
    const palette = [
      [1, 0.3, 0.3],
      [1, 0.85, 0.3],
      [0.4, 1, 0.5],
      [0.5, 0.6, 1],
      [1, 0.5, 0.9],
    ];
    for (let k = 0; k < 50 * scale; k++) {
      const [r, g, b] = palette[k % palette.length];
      const a = Math.random() * PI * 2;
      const e = Math.acos(Math.random() * 0.8 + 0.2);
      const v = 3 + Math.random() * 2 * scale;
      this.sparks.add({ x, y: 0.3, z, vx: Math.sin(e) * Math.cos(a) * v, vy: Math.cos(e) * v * 1.4, vz: Math.sin(e) * Math.sin(a) * v, grav: 5, drag: 1.2, life: 1.2 + Math.random() * 0.6, s0: 0.2, s1: 0.08, r, g, b });
    }
  }

  dispose() {
    this.tex.dispose();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }
}

void prism;
void hexStr;
