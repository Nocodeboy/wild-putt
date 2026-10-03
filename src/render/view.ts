import * as THREE from 'three';
import { G, type SimEvent } from '../sim/types';
import { BALL_R, type Sim } from '../sim/world';
import { box, cone, cyl, dode, ico, merge, part, type Part } from './geo';
import { FxList, Particles } from './particles';
import type { Theme } from './themes';

const PI = Math.PI;
const PX = 48; // texels per cell on the painted green
const RAIL_H = 0.26; // rail height (its rounded cap sits on top)
const RAIL_T = 0.2; // rail thickness, inside the wall cell, flush with the cell edge
const PIT = 0.34; // depth of the cup and of ponds

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
function hexNum(n: number, k = 1): number {
  const c = new THREE.Color(n);
  c.multiplyScalar(k);
  return c.getHex();
}

/** Ripples for water (and the sea): a small tileable texture whose offset scrolls. */
function rippleTexture(base: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = base;
  x.fillRect(0, 0, 128, 128);
  const rnd = lcg(42);
  for (let k = 0; k < 40; k++) {
    const px = rnd() * 128;
    const py = rnd() * 128;
    const w = 10 + rnd() * 26;
    x.strokeStyle = `rgba(255,255,255,${0.12 + rnd() * 0.25})`;
    x.lineWidth = 2;
    x.beginPath();
    for (const o of [-128, 0, 128]) {
      x.moveTo(px - w / 2 + o, py);
      x.quadraticCurveTo(px + o, py - 4, px + w / 2 + o, py);
    }
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Bubbling lava: bright core with dark crust blobs. */
function lavaTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, 128, 128);
  g.addColorStop(0, '#ff8a1a');
  g.addColorStop(0.5, '#ffcf4a');
  g.addColorStop(1, '#ff6a10');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  const rnd = lcg(7);
  for (let k = 0; k < 26; k++) {
    const px = rnd() * 128;
    const py = rnd() * 128;
    const r = 4 + rnd() * 12;
    for (const ox of [-128, 0, 128])
      for (const oy of [-128, 0, 128]) {
        x.fillStyle = `rgba(90,24,8,${0.45 + rnd() * 0.3})`;
        x.beginPath();
        x.arc(px + ox, py + oy, r, 0, PI * 2);
        x.fill();
      }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
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
  private inner = new THREE.Group();
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private ball: THREE.Mesh;
  private ballShadow: THREE.Mesh;
  private shown = { x: 0, z: 0 };
  private squash = 0;
  private squashDir = 0;
  private flag: THREE.Group;
  private flagCloth: THREE.Mesh;
  private flagUp = 0;
  private flagSpin = 0;
  private putter: THREE.Group;
  private putterHead: THREE.Group;
  private swing = -1; // time since the putt (−1: not swinging)
  private swingAngle = 0;
  private swingPull = 0;
  private putterFade = 0;
  private bumpers: THREE.Mesh[] = [];
  private spinners: THREE.Group[] = [];
  private movers: THREE.Mesh[] = [];
  private dots: THREE.Mesh[] = [];
  private dotMats: THREE.MeshBasicMaterial[] = [];
  private ghost: THREE.Mesh;
  private ring: THREE.Mesh;
  private waterTex: THREE.CanvasTexture | null = null;
  private seaTex: THREE.CanvasTexture | null = null;
  private lavaTex: THREE.CanvasTexture | null = null;
  private lavaMesh: THREE.InstancedMesh | null = null;
  private lavaCount = 0;
  private lavaLight: THREE.PointLight | null = null;
  private sparkP = new Particles(1000, { additive: true, soft: 0.2 });
  private puffP = new Particles(1000, { soft: 0.35 });
  private sparks = new FxList(800);
  private puffs = new FxList(800);
  private lights: THREE.PointLight[] = [];
  private bulbs: THREE.Mesh[] = [];
  private tier: 'high' | 'medium' | 'low' = 'high';
  private trailT = 0;
  private time = 0;
  private m4 = new THREE.Matrix4();
  aim: Aim | null = null;
  /** yaw of the camera (the resting putter faces the way the camera looks) */
  camYaw = -PI / 2;
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
    const inner = this.inner;
    this.hole.position.set(s.W / 2, 0, s.H / 2);
    inner.position.set(-s.W / 2, 0, -s.H / 2);
    this.hole.add(inner);
    this.group.add(this.hole);
    this.shown = { x: s.ball.x, z: s.ball.z };

    // ---- plate, rails, ponds, cup ----
    inner.add(this.buildPlate());
    inner.add(this.buildRails());
    this.buildWater();
    // ---- the painted surface (cut out where the cup and the ponds are) ----
    this.canvas = document.createElement('canvas');
    this.canvas.width = s.W * PX;
    this.canvas.height = s.H * PX;
    this.ctx = this.canvas.getContext('2d')!;
    this.paint();
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    const sg = new THREE.PlaneGeometry(s.W, s.H);
    sg.rotateX(-PI / 2);
    sg.translate(s.W / 2, 0.002, s.H / 2);
    const surface = new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ map: this.tex, alphaTest: 0.5 }));
    surface.receiveShadow = true;
    inner.add(surface);
    this.buildCup();
    // ---- flag ----
    this.flag = new THREE.Group();
    this.flag.position.set(s.cup.x, 0, s.cup.z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.9, 8), new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.4 }));
    pole.position.y = 0.95;
    pole.castShadow = true;
    this.flag.add(pole);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffd23a, roughness: 0.3, metalness: 0.4 }));
    knob.position.y = 1.92;
    this.flag.add(knob);
    const fg = new THREE.PlaneGeometry(0.78, 0.48, 8, 2);
    fg.translate(0.4, 1.6, 0);
    this.flagCloth = new THREE.Mesh(fg, new THREE.MeshLambertMaterial({ color: theme.flag, side: THREE.DoubleSide }));
    this.flagCloth.castShadow = true;
    this.flag.add(this.flagCloth);
    inner.add(this.flag);
    // ---- obstacles ----
    const vmat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const bumpGeo = merge([
      part(cyl(0.36, 0.4, 0.34, 18), 0xe8483a, 0, 0.17, 0),
      part(cyl(0.385, 0.385, 0.07, 18), 0xffffff, 0, 0.27, 0),
      part(ico(0.3, 1), 0xff6a5a, 0, 0.34, 0, 0, 0, 0, 1, 0.5, 1),
      part(ico(0.06), 0xffffff, -0.1, 0.48, -0.08),
      part(ico(0.05), 0xffffff, 0.12, 0.47, 0.04),
    ]);
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
      const post = new THREE.Mesh(merge([part(cyl(0.2, 0.24, 0.5, 12), 0x6a4a2e, 0, 0.25, 0), part(cone(0.28, 0.32, 12), theme.wallTop, 0, 0.66, 0), part(ico(0.06), 0xffd23a, 0, 0.84, 0)]), vmat);
      post.castShadow = true;
      g.add(post);
      const beam = new THREE.Group();
      const n = Math.max(2, Math.round(sp.len * 1.5));
      const P: Part[] = [];
      for (let k = 0; k < n * 2; k++) {
        const x = -sp.len + ((k + 0.5) * sp.len * 2) / (n * 2);
        P.push(part(box((sp.len * 2) / (n * 2) + 0.005, 0.26, 0.26), k % 2 ? 0xe8483a : 0xf4f0e6, x, 0.25, 0));
      }
      P.push(part(cyl(0.05, 0.05, 0.3, 8), 0x3a3a3a, sp.len, 0.25, 0, 0, 0, PI / 2), part(cyl(0.05, 0.05, 0.3, 8), 0x3a3a3a, -sp.len, 0.25, 0, 0, 0, PI / 2));
      const bm = new THREE.Mesh(merge(P), vmat);
      bm.castShadow = true;
      beam.add(bm);
      g.add(beam);
      inner.add(g);
      this.spinners.push(beam);
    }
    for (const mv of s.movers) {
      const m = new THREE.Mesh(
        merge([
          part(box(mv.hw * 2, 0.46, mv.hh * 2), 0xbfe6f6, 0, 0.23, 0),
          part(box(mv.hw * 2 + 0.02, 0.07, mv.hh * 2 + 0.02), 0xffffff, 0, 0.44, 0),
          part(box(mv.hw * 1.4, 0.02, 0.05), 0x8ac8e8, 0, 0.48, 0),
          part(box(0.05, 0.02, mv.hh * 1.4), 0x8ac8e8, mv.hw * 0.4, 0.48, 0),
        ]),
        vmat,
      );
      m.castShadow = true;
      inner.add(m);
      this.movers.push(m);
    }
    // ---- the ball ----
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 28, 18), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0 }));
    this.ball.castShadow = true;
    inner.add(this.ball);
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(BALL_R * 1.15, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
    this.ballShadow.rotation.x = -PI / 2;
    this.ballShadow.renderOrder = 2;
    inner.add(this.ballShadow);
    // ---- the putter ----
    this.putter = new THREE.Group();
    this.putterHead = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.25, metalness: 0.85 });
    const grip = new THREE.MeshStandardMaterial({ color: 0x1e1e22, roughness: 0.8 });
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.42), steel);
    head.position.y = 0.06;
    head.castShadow = true;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.02, 0.06), new THREE.MeshBasicMaterial({ color: 0xe8483a }));
    stripe.position.y = 0.112;
    this.putterHead.add(head, stripe);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.3, 8), steel);
    shaft.position.set(-0.17, 0.72, 0);
    shaft.rotation.z = 0.26;
    const gr = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.03, 0.36, 8), grip);
    gr.position.set(-0.32, 1.27, 0);
    gr.rotation.z = 0.26;
    this.putterHead.add(shaft, gr);
    this.putter.add(this.putterHead);
    this.putter.visible = false;
    inner.add(this.putter);
    // ---- aim: dotted line, a ghost ball at the end and a power ring ----
    const dg = new THREE.SphereGeometry(0.07, 8, 6);
    for (let k = 0; k < 26; k++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
      const d = new THREE.Mesh(dg, mat);
      d.visible = false;
      d.renderOrder = 6;
      inner.add(d);
      this.dots.push(d);
      this.dotMats.push(mat);
    }
    const gh = new THREE.RingGeometry(BALL_R * 0.8, BALL_R * 1.15, 24);
    gh.rotateX(-PI / 2);
    this.ghost = new THREE.Mesh(gh, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }));
    this.ghost.renderOrder = 6;
    this.ghost.visible = false;
    inner.add(this.ghost);
    const rg = new THREE.RingGeometry(0.3, 0.36, 40);
    rg.rotateX(-PI / 2);
    this.ring = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    this.ring.renderOrder = 6;
    inner.add(this.ring);
    // ---- lava (volcano): glowing tiles over the green, more of them after every putt ----
    if (s.lavaDist || s.ground.some((g) => g === G.Lava)) {
      this.lavaTex = lavaTexture();
      const lg = new THREE.PlaneGeometry(1, 1);
      lg.rotateX(-PI / 2);
      this.lavaMesh = new THREE.InstancedMesh(lg, new THREE.MeshBasicMaterial({ map: this.lavaTex }), s.W * s.H);
      this.lavaMesh.count = 0;
      inner.add(this.lavaMesh);
      this.lavaLight = new THREE.PointLight(0xff7a20, 8, 10, 1.6);
      this.lavaLight.position.set(s.W / 2, 1.5, s.H - 1);
      inner.add(this.lavaLight);
      this.syncLava();
    }
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
    this.sparks.cap = Math.round(800 * k);
    this.puffs.cap = Math.round(800 * k);
    this.lights.forEach((l, i) => (l.visible = t !== 'low' || i < 2));
  }

  // ---------- construction ----------
  private playable(x: number, z: number): boolean {
    const s = this.sim;
    if (x < 0 || z < 0 || x >= s.W || z >= s.H) return false;
    const g = s.ground[z * s.W + x];
    return g !== G.Wall && g !== G.Void;
  }

  /** The block the hole stands on. Ponds and the cup are pits sunk into it. */
  private buildPlate(): THREE.Object3D {
    const s = this.sim;
    const t = this.theme;
    const depth = -t.outsideY;
    const cupCell = Math.floor(s.cup.z) * s.W + Math.floor(s.cup.x);
    const P: Part[] = [];
    for (let z = 0; z < s.H; z++)
      for (let x = 0; x < s.W; x++) {
        const i = z * s.W + x;
        const g = s.ground[i];
        if (g === G.Void) continue;
        const top = g === G.Water || i === cupCell ? -PIT : 0;
        P.push(part(box(1, 0.14, 1), t.base[0], x + 0.5, top - 0.07, z + 0.5));
        const h = depth + top - 0.14;
        if (h > 0.02) P.push(part(box(1, h, 1), t.base[1], x + 0.5, top - 0.14 - h / 2, z + 0.5));
      }
    const plate = new THREE.Mesh(merge(P), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    plate.receiveShadow = true;
    const g = new THREE.Group();
    g.add(plate);
    if (t.surround === 'street') g.add(this.windows());
    return g;
  }

  /**
   * Rails: a thin rounded bar along every edge where a wall cell meets the playing surface (its inner face is
   * exactly where the ball bounces), with posts at the corners. Low decoration on the rest of the wall cells.
   */
  private buildRails(): THREE.Object3D {
    const s = this.sim;
    const t = this.theme;
    const R: Part[] = [];
    const C: Part[] = [];
    const D: Part[] = [];
    const posts = new Set<string>();
    const capC = hexNum(t.wall, 1.12);
    const rnd = lcg(s.W * 77 + s.H * 3);
    for (let z = 0; z < s.H; z++)
      for (let x = 0; x < s.W; x++) {
        if (s.ground[z * s.W + x] !== G.Wall) continue;
        let touches = false;
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          if (!this.playable(x + dx, z + dz)) continue;
          touches = true;
          // centre of the edge shared with the playable neighbour, pulled into this cell by half the thickness
          const ex = x + 0.5 + dx * (0.5 - RAIL_T / 2);
          const ez = z + 0.5 + dz * (0.5 - RAIL_T / 2);
          const along = dx === 0; // edge runs along x
          R.push(part(box(along ? 1 : RAIL_T, RAIL_H, along ? RAIL_T : 1), t.wall, ex, RAIL_H / 2, ez));
          C.push(part(cyl(RAIL_T / 2, RAIL_T / 2, 1, 10), capC, ex, RAIL_H, ez, along ? 0 : PI / 2, 0, along ? PI / 2 : 0));
          // the two corners of this edge get a post
          const cx0 = dx === 0 ? x : x + (dx > 0 ? 1 : 0);
          const cz0 = dz === 0 ? z : z + (dz > 0 ? 1 : 0);
          const ends = along
            ? [
                [cx0, cz0],
                [cx0 + 1, cz0],
              ]
            : [
                [cx0, cz0],
                [cx0, cz0 + 1],
              ];
          for (const [px, pz] of ends) {
            const key = `${px},${pz}`;
            if (posts.has(key)) continue;
            posts.add(key);
            // nudge the post into the wall side so it never sticks out into the green
            const ox = px - (x + 0.5) > 0 ? -RAIL_T / 2 : RAIL_T / 2;
            const oz = pz - (z + 0.5) > 0 ? -RAIL_T / 2 : RAIL_T / 2;
            const fx = along ? px + ox : ex;
            const fz = along ? ez : pz + oz;
            C.push(part(cyl(0.13, 0.14, RAIL_H + 0.12, 12), t.wallTop, fx, (RAIL_H + 0.12) / 2, fz));
            C.push(part(ico(0.1, 1), capC, fx, RAIL_H + 0.14, fz));
          }
        }
        // low decoration on wall cells: flowers, tiles, crates… away from the rails
        if (!touches && rnd() < 0.5) {
          const px = x + 0.25 + rnd() * 0.5;
          const pz = z + 0.25 + rnd() * 0.5;
          const c1 = t.props[Math.floor(rnd() * t.props.length)];
          switch (t.surround) {
            case 'lawn':
              D.push(part(ico(0.22), t.props[0], px, 0.12, pz, rnd(), 0, 0, 1, 0.7, 1));
              D.push(part(ico(0.06), t.props[2 + Math.floor(rnd() * 3)], px + 0.1, 0.24, pz));
              break;
            case 'street':
              D.push(part(box(0.3, 0.5, 0.3), 0xa84a32, px, 0.25, pz), part(box(0.36, 0.06, 0.36), 0x5a5050, px, 0.52, pz));
              break;
            case 'sea':
              D.push(part(cyl(0.18, 0.18, 0.4, 10), 0x8a5a30, px, 0.2, pz), part(cyl(0.19, 0.19, 0.04, 10), 0x3a2a1a, px, 0.3, pz));
              break;
            case 'fairground':
              D.push(part(cone(0.16, 0.4, 8), c1, px, 0.2, pz), part(ico(0.06), 0xffffff, px, 0.42, pz));
              break;
            case 'ice':
              D.push(part(ico(0.2), 0xffffff, px, 0.1, pz, rnd(), 0, 0, 1, 0.6, 1));
              break;
            case 'magma':
              D.push(part(dode(0.2), t.props[0], px, 0.12, pz, rnd(), rnd(), 0, 1, 0.8, 1));
              break;
          }
        }
      }
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    for (const list of [R, C, D]) {
      if (!list.length) continue;
      const m = new THREE.Mesh(merge(list), list === C ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }) : mat);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    return g;
  }

  /** Ponds: a rippling surface sunk into the plate. */
  private buildWater() {
    const s = this.sim;
    const quads: THREE.BufferGeometry[] = [];
    for (let i = 0; i < s.ground.length; i++) {
      if (s.ground[i] !== G.Water) continue;
      const g = new THREE.PlaneGeometry(1, 1);
      g.rotateX(-PI / 2);
      g.translate((i % s.W) + 0.5, -0.1, Math.floor(i / s.W) + 0.5);
      quads.push(g);
    }
    if (!quads.length) return;
    this.waterTex = rippleTexture(this.theme.water);
    this.waterTex.repeat.set(1, 1);
    const geo = merge(quads.map((q) => {
      // world-space UVs so the ripples flow across cells without seams
      const pos = q.attributes.position;
      const uv = new Float32Array(pos.count * 2);
      for (let k = 0; k < pos.count; k++) {
        uv[k * 2] = pos.getX(k) * 0.5;
        uv[k * 2 + 1] = pos.getZ(k) * 0.5;
      }
      q.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      q.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.count * 3).fill(1), 3));
      return q;
    }));
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: this.waterTex, transparent: true, opacity: 0.92 }));
    m.receiveShadow = true;
    this.inner.add(m);
  }

  /** The cup: a real hole (the green is cut out), a dark liner, a white rim. */
  private buildCup() {
    const s = this.sim;
    const r = s.cupR;
    const liner = new THREE.Mesh(new THREE.CylinderGeometry(r, r, PIT, 24, 1, true), new THREE.MeshLambertMaterial({ color: 0x3a3a3a, side: THREE.BackSide }));
    liner.position.set(s.cup.x, -PIT / 2, s.cup.z);
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(r, 24), new THREE.MeshBasicMaterial({ color: 0x0c0c0c }));
    bottom.rotation.x = -PI / 2;
    bottom.position.set(s.cup.x, -PIT + 0.01, s.cup.z);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r + 0.015, 0.025, 6, 32), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }));
    rim.rotation.x = PI / 2;
    rim.position.set(s.cup.x, 0.004, s.cup.z);
    this.inner.add(liner, bottom, rim);
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
          [0, -1],
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
    const ctx = this.ctx;
    const rnd = lcg(s.W * 977 + s.H * 13 + 5);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (let z = 0; z < s.H; z++) for (let x = 0; x < s.W; x++) this.paintCell(x, z, rnd);
    // soft shadow along the rails (ambient occlusion), painted over the playing surface
    for (let z = 0; z < s.H; z++)
      for (let x = 0; x < s.W; x++) {
        if (!this.playable(x, z)) continue;
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= s.W || nz >= s.H || s.ground[nz * s.W + nx] !== G.Wall) continue;
          const px = x * PX;
          const pz = z * PX;
          const w = PX * 0.3;
          const gx0 = dx > 0 ? px + PX : dx < 0 ? px : px;
          const gz0 = dz > 0 ? pz + PX : dz < 0 ? pz : pz;
          const g = dx ? ctx.createLinearGradient(gx0, 0, gx0 - dx * w, 0) : ctx.createLinearGradient(0, gz0, 0, gz0 - dz * w);
          g.addColorStop(0, 'rgba(0,0,0,0.28)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          if (dx) ctx.fillRect(dx > 0 ? px + PX - w : px, pz, w, PX);
          else ctx.fillRect(px, dz > 0 ? pz + PX - w : pz, PX, w);
        }
      }
    // the cup: cut a hole (transparent) with a darker collar around it
    const cx = s.cup.x * PX;
    const cz = s.cup.z * PX;
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.arc(cx, cz, s.cupR * PX * 1.6, 0, PI * 2);
    ctx.fill();
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx, cz, s.cupR * PX, 0, PI * 2);
    ctx.fill();
    ctx.restore();
    // the tee mat
    const tx = s.tee.x * PX;
    const tz = s.tee.z * PX;
    ctx.fillStyle = 'rgba(20,60,30,0.35)';
    ctx.fillRect(tx - PX * 0.45, tz - PX * 0.45, PX * 0.9, PX * 0.9);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    ctx.strokeRect(tx - PX * 0.45, tz - PX * 0.45, PX * 0.9, PX * 0.9);
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
      case G.Water:
        return;
      case G.Wall: {
        // rough ground around the rails
        ctx.fillStyle = t.rough[0];
        ctx.fillRect(px, pz, PX, PX);
        if (t.surround === 'street') {
          for (let k = 0; k < 4; k++) {
            ctx.fillStyle = shade(t.rough[k % 2], 0.9 + rnd() * 0.15);
            ctx.fillRect(px, pz + k * (PX / 4), PX, PX / 4 - 2);
          }
        } else if (t.surround === 'fairground') {
          ctx.fillStyle = t.rough[1];
          for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) if ((k + j + x + z) % 2) ctx.fillRect(px + (k * PX) / 2, pz + (j * PX) / 2, PX / 2, PX / 2);
        } else dots(t.rough[1], 22, 3, 3);
        return;
      }
      case G.Green: {
        if (t.surround === 'sea') {
          for (let k = 0; k < 4; k++) {
            ctx.fillStyle = shade(t.green[k % 2], 0.94 + ((x * 7 + k * 3) % 5) * 0.03);
            ctx.fillRect(px + k * (PX / 4), pz, PX / 4, PX);
            ctx.fillStyle = shade(t.green[0], 0.68);
            ctx.fillRect(px + k * (PX / 4), pz, 1.5, PX);
          }
          if ((z + x) % 3 === 0) {
            ctx.fillStyle = shade(t.green[0], 0.6);
            ctx.fillRect(px + 4, pz + PX - 3, PX - 8, 1.5);
            ctx.fillStyle = 'rgba(40,30,20,0.6)';
            ctx.fillRect(px + PX * 0.12, pz + PX - 6, 3, 3);
          }
        } else {
          // mowed stripes, two cells wide, with a soft grain
          const base = t.green[Math.floor(z / 2) % 2];
          ctx.fillStyle = base;
          ctx.fillRect(px, pz, PX, PX);
          dots(shade(base, 1.07), 14, 1, 3);
          dots(shade(base, 0.92), 14, 1, 3);
        }
        break;
      }
      case G.Sand:
        ctx.fillStyle = t.sand;
        ctx.fillRect(px, pz, PX, PX);
        dots(shade(t.sand, 0.86), 30, 2, 2);
        dots(shade(t.sand, 1.08), 16, 2, 1);
        // raked lines
        ctx.strokeStyle = shade(t.sand, 0.92);
        ctx.lineWidth = 1;
        for (let k = 1; k < 4; k++) {
          ctx.beginPath();
          ctx.moveTo(px, pz + (k * PX) / 4 + Math.sin(x + k) * 2);
          ctx.quadraticCurveTo(px + PX / 2, pz + (k * PX) / 4 + 3, px + PX, pz + (k * PX) / 4 + Math.sin(x + k + 1) * 2);
          ctx.stroke();
        }
        break;
      case G.Ice: {
        const gr = ctx.createLinearGradient(px, pz, px + PX, pz + PX);
        gr.addColorStop(0, shade(t.ice, 1.05));
        gr.addColorStop(1, shade(t.ice, 0.93));
        ctx.fillStyle = gr;
        ctx.fillRect(px, pz, PX, PX);
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 1.5;
        if (rnd() < 0.55) {
          ctx.beginPath();
          const sx = px + rnd() * PX;
          const sz = pz + rnd() * PX;
          ctx.moveTo(sx, sz);
          ctx.lineTo(sx + (rnd() - 0.5) * PX, sz + (rnd() - 0.5) * PX);
          ctx.lineTo(sx + (rnd() - 0.5) * PX, sz + (rnd() - 0.5) * PX);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fillRect(px + 4, pz + 4, PX * 0.35, 3);
        break;
      }
      case G.Lava:
        // drawn by the lava tiles on top: keep the green underneath
        ctx.fillStyle = t.green[0];
        ctx.fillRect(px, pz, PX, PX);
        break;
    }
    // slopes: white chevrons pointing downhill, plus a subtle light/dark gradient
    const sl = s.slope[i];
    if (sl) {
      ctx.save();
      ctx.translate(px + PX / 2, pz + PX / 2);
      ctx.rotate(sl === 1 ? -PI / 2 : sl === 2 ? PI / 2 : sl === 3 ? PI : 0);
      const gr = ctx.createLinearGradient(-PX / 2, 0, PX / 2, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0.12)');
      gr.addColorStop(1, 'rgba(0,0,0,0.14)');
      ctx.fillStyle = gr;
      ctx.fillRect(-PX / 2, -PX / 2, PX, PX);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const o of [-10, 7]) {
        ctx.beginPath();
        ctx.moveTo(o - 6, -11);
        ctx.lineTo(o + 6, 0);
        ctx.lineTo(o - 6, 11);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /** Lava tiles for every lava cell (the volcano adds more after each putt). */
  private syncLava() {
    const s = this.sim;
    if (!this.lavaMesh) return;
    let n = 0;
    for (let i = 0; i < s.ground.length; i++) {
      if (s.ground[i] !== G.Lava) continue;
      this.m4.makeTranslation((i % s.W) + 0.5, 0.012, Math.floor(i / s.W) + 0.5);
      this.lavaMesh.setMatrixAt(n++, this.m4);
    }
    if (n > this.lavaCount && this.lavaCount > 0 && this.tier !== 'low') {
      // new lava: a burst of sparks over the freshly molten cells
      for (let k = this.lavaCount; k < n; k++) {
        this.lavaMesh.getMatrixAt(k, this.m4);
        const e = this.m4.elements;
        for (let j = 0; j < 4; j++) this.sparks.add({ x: e[12] + Math.random() - 0.5, y: 0.1, z: e[14] + Math.random() - 0.5, vy: 1.5 + Math.random() * 2, life: 0.8, s0: 0.15, s1: 0.04, r: 1, g: 0.5, b: 0.15, grav: 3 });
      }
    }
    this.lavaCount = n;
    this.lavaMesh.count = n;
    this.lavaMesh.instanceMatrix.needsUpdate = true;
  }

  private buildSurround() {
    const s = this.sim;
    const t = this.theme;
    const rnd = lcg(s.W * 131 + s.H * 7 + 11);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    // the ground (or sea, or street) all around
    const og = new THREE.PlaneGeometry(400, 400);
    og.rotateX(-PI / 2);
    let outMat: THREE.Material = new THREE.MeshLambertMaterial({ color: t.outside });
    if (t.surround === 'sea') {
      this.seaTex = rippleTexture('#' + t.outside.toString(16).padStart(6, '0'));
      this.seaTex.repeat.set(60, 60);
      outMat = new THREE.MeshLambertMaterial({ map: this.seaTex });
    }
    const outside = new THREE.Mesh(og, outMat);
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
    // ---- ball: follows the sim, slides into the cup, squashes on impacts ----
    const kf = s.state === 'sunk' || s.state === 'done' ? 1 - Math.exp(-14 * dt) : 1;
    this.shown.x += (b.x - this.shown.x) * kf;
    this.shown.z += (b.z - this.shown.z) * kf;
    const inCup = Math.hypot(this.shown.x - s.cup.x, this.shown.z - s.cup.z) < s.cupR;
    const y = BALL_R + b.y;
    this.ball.position.set(this.shown.x, y, this.shown.z);
    const sp = Math.hypot(b.vx, b.vz);
    if (sp > 0.01) {
      this.ball.rotation.x += (b.vz / BALL_R) * dt;
      this.ball.rotation.z -= (b.vx / BALL_R) * dt;
    }
    this.squash = Math.max(0, this.squash - dt * 6);
    const q = Math.sin(this.squash * PI) * 0.22;
    this.ball.scale.set(1 + q * Math.abs(Math.cos(this.squashDir)), 1 - q * 0.6, 1 + q * Math.abs(Math.sin(this.squashDir)));
    this.ball.visible = b.y > -1.2;
    this.ballShadow.position.set(this.shown.x + 0.04, 0.004, this.shown.z + 0.05);
    this.ballShadow.visible = b.y > -0.05 && !inCup;
    // trail when it flies
    if (sp > 6 && this.tier !== 'low') {
      this.trailT += dt * sp;
      while (this.trailT > 0.45) {
        this.trailT -= 0.45;
        this.sparks.add({ x: b.x, y: BALL_R, z: b.z, life: 0.35, s0: 0.17, s1: 0.02, r: 1, g: 1, b: 1, a: 0.55 });
      }
    }
    // ---- flag: waves in the wind, pops up (with a spin) when the ball drops ----
    const want = s.state === 'sunk' || s.state === 'done' ? (s.result && !s.result.maxed ? 1 : s.state === 'sunk' ? 1 : 0) : 0;
    this.flagUp += (want - this.flagUp) * Math.min(1, dt * 7);
    this.flag.position.y = this.flagUp * 0.9 + Math.sin(this.flagUp * PI) * 0.25;
    if (want) this.flagSpin += dt * 9 * (1 - this.flagUp * 0.7);
    this.flag.rotation.y = this.flagSpin;
    const pos = this.flagCloth.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      pos.setZ(i, Math.sin(x * 6 - time * 7) * 0.07 * x);
    }
    pos.needsUpdate = true;
    // ---- obstacles ----
    s.spinners.forEach((sp2, k) => (this.spinners[k].rotation.y = -s.spinnerAngle(sp2, s.time)));
    s.movers.forEach((m, k) => {
      const p = s.moverPos(m, s.time);
      this.movers[k].position.set(p.x, 0, p.z);
    });
    s.bumpers.forEach((p, k) => {
      const u = Math.max(0, 1 - (s.time - p.hit) / 0.3);
      const w = Math.sin(u * PI * 3) * u;
      this.bumpers[k].scale.set(1 + w * 0.22, 1 - w * 0.18, 1 + w * 0.22);
    });
    // ---- liquids ----
    if (this.waterTex) this.waterTex.offset.set(time * 0.04, time * 0.025);
    if (this.seaTex) this.seaTex.offset.set(time * 0.012, time * 0.02);
    if (this.lavaTex) {
      this.lavaTex.offset.set(Math.sin(time * 0.3) * 0.2, time * 0.05);
      let n = 0;
      for (let i = 0; i < s.ground.length; i++) if (s.ground[i] === G.Lava) n++;
      if (n !== this.lavaCount) this.syncLava();
      if (this.lavaLight) this.lavaLight.intensity = 7 + Math.sin(time * 5) * 1.5 + Math.min(10, n * 0.3);
      if (this.tier !== 'low' && n && Math.random() < dt * 14) {
        const k = Math.floor(Math.random() * n);
        this.lavaMesh!.getMatrixAt(k, this.m4);
        const e = this.m4.elements;
        this.sparks.add({ x: e[12] + Math.random() - 0.5, y: 0.1, z: e[14] + Math.random() - 0.5, vy: 1 + Math.random(), life: 1.2, s0: 0.1, s1: 0.03, r: 1, g: 0.55, b: 0.2 });
      }
    }
    // glints on the sea
    if (this.theme.surround === 'sea' && this.tier !== 'low' && Math.random() < dt * 25) {
      const a = Math.random() * PI * 2;
      const r = Math.max(s.W, s.H) * 0.6 + Math.random() * 14;
      this.sparks.add({ x: s.W / 2 + Math.cos(a) * r, y: this.theme.outsideY + 0.05, z: s.H / 2 + Math.sin(a) * r, life: 1.2, s0: 0.35, s1: 0.1, r: 0.8, g: 0.95, b: 1, a: 0.7 });
    }
    for (let k = 0; k < this.bulbs.length; k++) this.bulbs[k].visible = (Math.floor(time * 3) + k) % 7 !== 0;
    this.updatePutter(dt);
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

  /** The putter: rests behind the ball, is drawn back with the power, swings through on the putt. */
  private updatePutter(dt: number) {
    const s = this.sim;
    const b = s.ball;
    let angle: number;
    let pull: number;
    let alpha: number;
    if (this.swing >= 0) {
      this.swing += dt;
      angle = this.swingAngle;
      const u = this.swing / 0.09;
      // whip forward through the ball, a short follow-through, then fade away
      pull = u < 1 ? this.swingPull * (1 - u) - 0.25 * u : -0.25 - Math.min(0.15, (this.swing - 0.09) * 0.8);
      alpha = Math.max(0, 1 - Math.max(0, this.swing - 0.25) * 3);
      if (alpha <= 0) this.swing = -1;
    } else if (s.state === 'aim') {
      const a = this.aim;
      angle = a ? a.angle : this.camYaw;
      pull = a ? 0.08 + a.power * 0.9 : 0.06;
      alpha = 1;
    } else {
      this.putter.visible = false;
      return;
    }
    this.putterFade += ((alpha > 0 ? 1 : 0) - this.putterFade) * Math.min(1, dt * 10);
    this.putter.visible = alpha > 0.02 && this.putterFade > 0.02;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const ox = this.swing >= 0 ? this.swingFrom.x : b.x;
    const oz = this.swing >= 0 ? this.swingFrom.z : b.z;
    const back = BALL_R + 0.1 + pull;
    this.putter.position.set(ox - dx * back, 0, oz - dz * back);
    // the face looks along the putt; the shaft leans back towards the player
    this.putter.rotation.y = -angle;
    this.putterHead.rotation.z = this.swing >= 0 ? -0.15 : Math.min(0.5, pull * 0.35);
    this.putter.scale.setScalar(1.35 * Math.max(0.05, this.swing >= 0 ? alpha : this.putterFade));
  }
  private swingFrom = { x: 0, z: 0 };

  private updateAim(time: number) {
    const s = this.sim;
    const a = this.aim;
    const rm = this.ring.material as THREE.MeshBasicMaterial;
    this.ring.position.set(s.ball.x, 0.01, s.ball.z);
    if (!a || s.state !== 'aim') {
      this.dots.forEach((d) => (d.visible = false));
      this.ghost.visible = false;
      rm.opacity = s.state === 'aim' ? 0.35 + Math.sin(time * 4) * 0.15 : 0;
      this.ring.scale.setScalar(1 + Math.sin(time * 4) * 0.08);
      rm.color.setHex(0xffffff);
      return;
    }
    const idle = a.power < 0.02;
    const p = idle ? 0.3 : a.power;
    const col = idle ? new THREE.Color(0xdddddd) : new THREE.Color().setHSL(0.33 - p * 0.33, 0.95, 0.55);
    rm.opacity = 0.9;
    rm.color.copy(col);
    this.ring.scale.setScalar(1 + p * 0.7);
    const pts = s.previewPath(a.angle, p, 2.5 + p * 7.5);
    const n = this.dots.length;
    let total = 0;
    const seg: number[] = [0];
    for (let i = 1; i < pts.length; i++) {
      total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      seg.push(total);
    }
    let j = 1;
    const march = (time * 1.6) % 1; // the dots flow forward
    for (let k = 0; k < n; k++) {
      const d = ((k + march) / n) * total;
      const dot = this.dots[k];
      if (pts.length < 2 || total < 0.05) {
        dot.visible = false;
        continue;
      }
      while (j < seg.length - 1 && seg[j] < d) j++;
      const u = (d - seg[j - 1]) / Math.max(1e-6, seg[j] - seg[j - 1]);
      dot.visible = true;
      dot.position.set(pts[j - 1].x + (pts[j].x - pts[j - 1].x) * u, 0.07, pts[j - 1].z + (pts[j].z - pts[j - 1].z) * u);
      dot.scale.setScalar(1 - (d / total) * 0.45);
      this.dotMats[k].color.copy(col);
      this.dotMats[k].opacity = (idle ? 0.45 : 0.95) * (1 - (d / total) * 0.6);
    }
    const last = pts[pts.length - 1];
    this.ghost.visible = !idle && pts.length > 1;
    this.ghost.position.set(last.x, 0.02, last.z);
    (this.ghost.material as THREE.MeshBasicMaterial).color.copy(col);
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
      case 'putt': {
        const b = s.ball;
        this.swing = 0;
        this.swingAngle = Math.atan2(b.vz, b.vx);
        this.swingPull = 0.08 + (ev.n ?? 0.5) * 0.9;
        this.swingFrom = { x, z };
        for (let k = 0; k < 6; k++) this.puffs.add({ x, y: 0.05, z, vy: 0.5, vx: (Math.random() - 0.5) * 0.8, vz: (Math.random() - 0.5) * 0.8, life: 0.5, s0: 0.1, s1: 0.3, r: 1, g: 1, b: 1, a: 0.4, drag: 2 });
        break;
      }
      case 'wall':
        this.burst(x, 0.25, z, 4, 1, 1, 0.9, 1.5, 0.3);
        this.squash = Math.min(1, (ev.n ?? 2) / 8);
        this.squashDir = Math.atan2(s.ball.vz, s.ball.vx);
        if ((ev.n ?? 0) > 7) this.shake = Math.max(this.shake, 0.08);
        break;
      case 'bumper':
        this.burst(x, 0.4, z, 14, 1, 0.4, 0.3, 3, 0.4);
        this.squash = 1;
        this.squashDir = Math.atan2(s.ball.vz, s.ball.vx);
        this.shake = Math.max(this.shake, 0.1);
        break;
      case 'spinner':
      case 'mover':
        this.burst(x, 0.3, z, 6, 1, 1, 1, 2, 0.3);
        this.squash = 0.7;
        break;
      case 'sunk': {
        const hio = ev.n === 1;
        this.confetti(s.cup.x, s.cup.z, hio ? 3 : 1);
        this.flagSpin = 0;
        this.shake = Math.max(this.shake, hio ? 0.3 : 0.1);
        break;
      }
      case 'water':
        for (let k = 0; k < 18; k++) this.puffs.add({ x, y: 0.05, z, vy: 2 + Math.random() * 2.5, vx: (Math.random() - 0.5) * 2, vz: (Math.random() - 0.5) * 2, grav: 9, life: 0.7, s0: 0.12, s1: 0.06, r: 0.75, g: 0.9, b: 1, a: 0.9 });
        for (let k = 0; k < 2; k++) this.puffs.add({ x, y: -0.05, z, life: 0.8, s0: 0.2, s1: 1.4, r: 1, g: 1, b: 1, a: 0.5 });
        break;
      case 'lava':
        this.burst(x, 0.1, z, 26, 1, 0.5, 0.15, 3, 0.8);
        for (let k = 0; k < 7; k++) this.puffs.add({ x, y: 0.2, z, vy: 1.2, vx: Math.random() - 0.5, life: 1.2, s0: 0.3, s1: 0.9, r: 0.3, g: 0.28, b: 0.28, a: 0.5 });
        this.flash = 0.4;
        break;
      case 'sand':
        for (let k = 0; k < 8; k++) this.puffs.add({ x, y: 0.05, z, vy: 0.8, vx: (Math.random() - 0.5) * 1.2, vz: (Math.random() - 0.5) * 1.2, life: 0.6, s0: 0.1, s1: 0.3, r: 0.95, g: 0.88, b: 0.65, a: 0.6, drag: 2 });
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
    for (let k = 0; k < 55 * scale; k++) {
      const [r, g, b] = palette[k % palette.length];
      const a = Math.random() * PI * 2;
      const e = Math.acos(Math.random() * 0.8 + 0.2);
      const v = 3 + Math.random() * 2 * scale;
      this.sparks.add({ x, y: 0.3, z, vx: Math.sin(e) * Math.cos(a) * v, vy: Math.cos(e) * v * 1.4, vz: Math.sin(e) * Math.sin(a) * v, grav: 5, drag: 1.2, life: 1.2 + Math.random() * 0.6, s0: 0.2, s1: 0.08, r, g, b });
    }
  }

  dispose() {
    this.tex.dispose();
    this.waterTex?.dispose();
    this.seaTex?.dispose();
    this.lavaTex?.dispose();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }
}
