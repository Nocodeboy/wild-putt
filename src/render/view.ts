import * as THREE from 'three';
import { inPoly, type P2 } from '../sim/shape';
import { G, type SimEvent } from '../sim/types';
import { BALL_R, K_BRIDGE, LOOP_R, type Sim } from '../sim/world';
import { box, cone, cyl, dode, ico, merge, part, type Part } from './geo';
import { FxList, Particles } from './particles';
import type { Theme } from './themes';

const PI = Math.PI;
const PX = 48; // texels per cell on the painted green
const RAIL_H = 0.26; // rail height (its rounded cap sits on top)
const RAIL_T = 0.2; // rail thickness, inside the wall cell, flush with the cell edge
const PIT = 0.34; // depth of the cup and of ponds
const LAVA_PX = 16; // texels per cell of the lava's mask

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

/** A spiral for the tunnels (drawn white; the material tints it). */
function swirlTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.translate(64, 64);
  for (let arm = 0; arm < 3; arm++) {
    g.beginPath();
    for (let k = 0; k < 60; k++) {
      const u = k / 60;
      const a = arm * ((PI * 2) / 3) + u * PI * 3;
      const r = u * 62;
      if (k) g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      else g.moveTo(0, 0);
    }
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 7;
    g.stroke();
  }
  const rg = g.createRadialGradient(0, 0, 0, 0, 0, 64);
  rg.addColorStop(0, 'rgba(255,255,255,0.9)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg;
  g.fillRect(-64, -64, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
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
  private lavaMesh: THREE.Mesh | null = null;
  private lavaMask: HTMLCanvasElement | null = null;
  private lavaMaskTex: THREE.CanvasTexture | null = null;
  private lavaCells: P2[] = [];
  private lavaCount = 0;
  /** tunnels look like pipes (the classic minigolf ones), except in the temple and in neon city */
  private pipes = true;
  private lavaLight: THREE.PointLight | null = null;
  private sparkP = new Particles(1000, { additive: true, soft: 0.2 });
  private puffP = new Particles(1000, { soft: 0.35 });
  private sparks = new FxList(800);
  private puffs = new FxList(800);
  private lights: THREE.PointLight[] = [];
  private bulbs: THREE.Mesh[] = [];
  // the new courses' moving parts
  private tideMesh: THREE.Mesh | null = null;
  private tideTex: THREE.CanvasTexture | null = null;
  private bridge: THREE.Group | null = null;
  private bridgeL = 0;
  private gates: { g: THREE.Object3D; kind: number; y: number }[] = [];
  private boostMat: THREE.MeshBasicMaterial | null = null;
  private portalDiscs: THREE.Mesh[] = [];
  private wellParts: { ring: THREE.Mesh; pull: THREE.Mesh[] }[] = [];
  private coinMeshes: THREE.Mesh[] = [];
  private sails: THREE.Object3D[] = [];
  private coinY: number[] = [];
  private swirlTex: THREE.CanvasTexture | null = null;
  private tier: 'high' | 'medium' | 'low' = 'high';
  private trailT = 0;
  private time = 0;
  private m4 = new THREE.Matrix4();
  aim: Aim | null = null;
  /** the aim-line upgrade from the shop: length factor and bounces shown */
  aimLen = 1;
  aimBounces = 1;
  private trailRGB: [number, number, number] = [1, 1, 1];
  private comet = false;
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

    this.pipes = !theme.glow && theme.floor !== 'tiles';
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
    const hilly = s.hills.length > 0;
    const sg = new THREE.PlaneGeometry(s.W, s.H, hilly ? s.W * 4 : 1, hilly ? s.H * 4 : 1);
    sg.rotateX(-PI / 2);
    sg.translate(s.W / 2, 0.002, s.H / 2);
    if (hilly) {
      // the mounds: the painted surface rises over them
      const sp = sg.attributes.position;
      for (let k = 0; k < sp.count; k++) sp.setY(k, 0.002 + s.heightAt(sp.getX(k), sp.getZ(k)));
      sg.computeVertexNormals();
    }
    const surface = new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ map: this.tex, alphaTest: 0.5 }));
    surface.receiveShadow = true;
    inner.add(surface);
    this.buildCup();
    // ---- flag ----
    this.flag = new THREE.Group();
    this.cupY = s.heightAt(s.cup.x, s.cup.z);
    this.flag.position.set(s.cup.x, this.cupY, s.cup.z);
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
    // the shaft leans to the player's side (not back over the ball, where it would hide it from the camera)
    shaft.position.set(-0.07, 0.7, 0.2);
    shaft.rotation.set(0.3, 0, 0.1);
    const gr = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.03, 0.36, 8), grip);
    gr.position.set(-0.13, 1.22, 0.37);
    gr.rotation.set(0.3, 0, 0.1);
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
      this.lavaTex.repeat.set(s.W, s.H);
      this.lavaMask = document.createElement('canvas');
      this.lavaMask.width = s.W * LAVA_PX;
      this.lavaMask.height = s.H * LAVA_PX;
      this.lavaMaskTex = new THREE.CanvasTexture(this.lavaMask);
      const lg = new THREE.PlaneGeometry(s.W, s.H);
      lg.rotateX(-PI / 2);
      lg.translate(s.W / 2, 0.012, s.H / 2);
      this.lavaMesh = new THREE.Mesh(lg, new THREE.MeshBasicMaterial({ map: this.lavaTex, alphaMap: this.lavaMaskTex, alphaTest: 0.5 }));
      inner.add(this.lavaMesh);
      this.lavaLight = new THREE.PointLight(0xff7a20, 8, 10, 1.6);
      this.lavaLight.position.set(s.W / 2, 1.5, s.H - 1);
      inner.add(this.lavaLight);
      this.syncLava();
    }
    // ---- the new courses: tide, drawbridge, portcullises, boosters, ramps, tunnels, wells; and the coins ----
    this.buildDynamic();
    this.buildClassics();
    // ---- surroundings ----
    this.buildSurround();
    this.group.add(this.sparkP.points, this.puffP.points);
    this.puffP.points.renderOrder = 3;
    this.sparkP.points.renderOrder = 4;
    this.setTier(tier);
  }


  /** The new courses' moving parts, and the coins. */
  private buildDynamic() {
    const s = this.sim;
    const t = this.theme;
    const glow = t.glow ?? 0x36e0ff;
    const vmat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const cellOf = (i: number) => ({ x: i % s.W, z: Math.floor(i / s.W) });
    // ---- tide: a sheet of water over the wet sand that rises and falls ----
    const tq: THREE.BufferGeometry[] = [];
    for (let i = 0; i < s.dyn.length; i++) {
      if (s.dyn[i] !== 1) continue;
      const { x, z } = cellOf(i);
      const g = new THREE.PlaneGeometry(1, 1);
      g.rotateX(-PI / 2);
      g.translate(x + 0.5, 0, z + 0.5);
      const pos = g.attributes.position;
      const uv = new Float32Array(pos.count * 2);
      for (let k = 0; k < pos.count; k++) {
        uv[k * 2] = pos.getX(k) * 0.5;
        uv[k * 2 + 1] = pos.getZ(k) * 0.5;
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.count * 3).fill(1), 3));
      tq.push(g);
    }
    if (tq.length) {
      this.tideTex = rippleTexture(t.water);
      this.tideMesh = new THREE.Mesh(merge(tq), new THREE.MeshLambertMaterial({ map: this.tideTex, transparent: true, opacity: 0, depthWrite: false }));
      this.tideMesh.renderOrder = 1;
      this.inner.add(this.tideMesh);
    }
    // ---- drawbridge: planks that lift clear of the moat ----
    const bp: Part[] = [];
    for (let i = 0; i < s.dyn.length; i++) {
      if (s.dyn[i] !== 2) continue;
      const { x, z } = cellOf(i);
      for (let k = 0; k < 4; k++) bp.push(part(box(0.96, 0.08, 0.22), k % 2 ? 0x8a5a30 : 0x9a6a3a, x + 0.5, -0.04, z + 0.14 + k * 0.24));
      bp.push(part(box(0.1, 0.1, 1), 0x4a2a14, x + 0.1, 0.0, z + 0.5), part(box(0.1, 0.1, 1), 0x4a2a14, x + 0.9, 0.0, z + 0.5));
    }
    if (bp.length) {
      this.bridge = new THREE.Group();
      const m = new THREE.Mesh(merge(bp), vmat);
      m.castShadow = true;
      m.receiveShadow = true;
      this.bridge.add(m);
      this.inner.add(this.bridge);
    }
    // ---- portcullises: an iron grid per row (G and H), under a stone lintel ----
    for (const kind of [3, 4]) {
      const P: Part[] = [];
      const L: Part[] = [];
      for (let i = 0; i < s.dyn.length; i++) {
        if (s.dyn[i] !== kind) continue;
        const { x, z } = cellOf(i);
        const along = (x > 0 && s.dyn[i - 1] === kind) || (x < s.W - 1 && s.dyn[i + 1] === kind) || !(z > 0 && s.dyn[i - s.W] === kind);
        const cx = x + 0.5;
        const cz = z + 0.5;
        for (let b = 0; b < 4; b++) {
          const o = -0.375 + b * 0.25;
          P.push(part(box(along ? 0.06 : 0.07, 0.86, along ? 0.07 : 0.06), 0x3a3a42, cx + (along ? o : 0), 0.45, cz + (along ? 0 : o)));
          P.push(part(cone(0.05, 0.14, 4), 0x2a2a30, cx + (along ? o : 0), 0.0, cz + (along ? 0 : o), PI));
        }
        for (const y of [0.25, 0.6, 0.86]) P.push(part(box(along ? 1 : 0.07, 0.06, along ? 0.07 : 1), 0x4a4a52, cx, y, cz));
        L.push(part(box(along ? 1.02 : 0.34, 0.22, along ? 0.34 : 1.02), t.wall, cx, 1.18, cz), part(box(along ? 1.04 : 0.38, 0.06, along ? 0.38 : 1.04), t.wallTop, cx, 1.31, cz));
      }
      if (!P.length) continue;
      const g = new THREE.Mesh(merge(P), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.6 }));
      g.castShadow = true;
      this.inner.add(g);
      const lintel = new THREE.Mesh(merge(L), vmat);
      lintel.castShadow = true;
      this.inner.add(lintel);
      this.gates.push({ g, kind, y: 0 });
    }
    // ---- boosters: a glow that pulses over the painted pads ----
    const bq: Part[] = [];
    for (let i = 0; i < s.boost.length; i++) {
      if (!s.boost[i]) continue;
      const { x, z } = cellOf(i);
      const g = new THREE.PlaneGeometry(0.92, 0.92);
      g.rotateX(-PI / 2);
      g.translate(x + 0.5, 0.01, z + 0.5);
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
      bq.push(g);
    }
    if (bq.length) {
      this.boostMat = new THREE.MeshBasicMaterial({ color: glow, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false });
      const m = new THREE.Mesh(merge(bq), this.boostMat);
      m.renderOrder = 2;
      this.inner.add(m);
    }
    // ---- ramps: a striped slab rising towards the edge ----
    const rp: Part[] = [];
    for (let i = 0; i < s.ramp.length; i++) {
      const r = s.ramp[i];
      if (!r) continue;
      const { x, z } = cellOf(i);
      const [dx, dz] = r === 1 ? [0, -1] : r === 2 ? [0, 1] : r === 3 ? [-1, 0] : [1, 0];
      const tilt = 0.17;
      // rotation: lift the end that faces the edge
      const rx = dz ? -dz * tilt : 0;
      const rz = dx ? dx * tilt : 0;
      rp.push(part(box(0.98, 0.06, 0.98), t.wall, x + 0.5, 0.09, z + 0.5, rx, 0, rz));
      for (let k = -1; k <= 1; k++) {
        const ox = dz ? k * 0.3 : 0;
        const oz = dx ? k * 0.3 : 0;
        rp.push(part(box(dz ? 0.12 : 0.98, 0.012, dx ? 0.12 : 0.98), 0xffd23a, x + 0.5 + ox, 0.125 + (dx * ox + dz * oz) * tilt, z + 0.5 + oz, rx, 0, rz));
      }
      rp.push(part(box(dz ? 0.98 : 0.06, 0.18, dx ? 0.98 : 0.06), hexNum(t.wall, 0.7), x + 0.5 + dx * 0.47, 0.09, z + 0.5 + dz * 0.47));
    }
    if (rp.length) {
      const m = new THREE.Mesh(merge(rp), vmat);
      m.castShadow = true;
      m.receiveShadow = true;
      this.inner.add(m);
    }
    // ---- tunnels: pipe mouths (one colour per pair), or a glowing ring and a swirl in the temple and neon city ----
    if (s.portals.length && this.pipes) {
      s.portals.forEach((p, k) => {
        const c = [0xe8483a, 0x3a8ae8, 0xf2c23a][(k >> 1) % 3];
        const liner = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, PIT, 20, 1, true), new THREE.MeshLambertMaterial({ color: 0x15151a, side: THREE.BackSide }));
        liner.position.set(p.x, -PIT / 2, p.z);
        const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.34, 20), new THREE.MeshBasicMaterial({ color: 0x050507 }));
        bottom.rotation.x = -PI / 2;
        bottom.position.set(p.x, -PIT + 0.01, p.z);
        const mouth = new THREE.Mesh(
          merge([part(new THREE.TorusGeometry(0.4, 0.075, 8, 28), c, 0, 0.035, 0, PI / 2), part(new THREE.TorusGeometry(0.4, 0.03, 6, 28), 0xffffff, 0, 0.1, 0, PI / 2)]),
          new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.2 }),
        );
        mouth.position.set(p.x, 0, p.z);
        mouth.castShadow = true;
        this.inner.add(liner, bottom, mouth);
      });
    } else if (s.portals.length) {
      this.swirlTex = swirlTexture();
      s.portals.forEach((p, k) => {
        const c = k < 2 ? glow : 0xff8a3a;
        const liner = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, PIT, 20, 1, true), new THREE.MeshLambertMaterial({ color: 0x1a1a24, side: THREE.BackSide }));
        liner.position.set(p.x, -PIT / 2, p.z);
        const disc = new THREE.Mesh(new THREE.CircleGeometry(0.34, 24), new THREE.MeshBasicMaterial({ map: this.swirlTex, color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        disc.rotation.x = -PI / 2;
        disc.position.set(p.x, -PIT + 0.03, p.z);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.035, 8, 32), new THREE.MeshBasicMaterial({ color: c }));
        ring.rotation.x = PI / 2;
        ring.position.set(p.x, 0.01, p.z);
        this.inner.add(liner, disc, ring);
        this.portalDiscs.push(disc);
      });
    }
    // ---- gravity wells: a black hole with a glowing ring, and rings flowing in ----
    for (const w of s.wells) {
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.5, 28), new THREE.MeshBasicMaterial({ color: 0x000000 }));
      hole.rotation.x = -PI / 2;
      hole.position.set(w.x, 0.006, w.z);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.06, 8, 40), new THREE.MeshBasicMaterial({ color: glow, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = PI / 2 - 0.25;
      ring.position.set(w.x, 0.08, w.z);
      const pull: THREE.Mesh[] = [];
      for (let k = 0; k < 3; k++) {
        const rg = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 48), new THREE.MeshBasicMaterial({ color: glow, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        rg.rotation.x = -PI / 2;
        rg.position.set(w.x, 0.012, w.z);
        pull.push(rg);
        this.inner.add(rg);
      }
      this.inner.add(hole, ring);
      this.wellParts.push({ ring, pull });
    }
    // ---- coins ----
    if (s.coins.length) {
      const cg = new THREE.CylinderGeometry(0.19, 0.19, 0.05, 20);
      cg.rotateX(PI / 2);
      const cm = new THREE.MeshStandardMaterial({ color: 0xffc43d, roughness: 0.3, metalness: 0.7, emissive: 0x6a4a00, emissiveIntensity: 0.6 });
      for (const c of s.coins) {
        const m = new THREE.Mesh(cg, cm);
        this.coinY.push(s.heightAt(c.x, c.z));
        m.position.set(c.x, 0.32, c.z);
        m.castShadow = true;
        this.inner.add(m);
        this.coinMeshes.push(m);
      }
    }
  }

  /** The classic minigolf pieces: windmills, loop-the-loops, wooden bridges. */
  private buildClassics() {
    const s = this.sim;
    const t = this.theme;
    const vmat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    // ---- windmills: a house with a door right through it, a tower, four sails sweeping past the door ----
    const HUB = 1.45;
    const BL = HUB - 0.13;
    for (const m of s.mills) {
      const g = new THREE.Group();
      g.position.set(m.x, 0, m.z);
      g.rotation.y = m.ax === 1 ? (m.front > 0 ? 0 : PI) : m.front > 0 ? PI / 2 : -PI / 2;
      const wallC = hexNum(t.wall, 1.05);
      const roofC = 0xc0503a;
      const P: Part[] = [];
      for (const sd of [-1, 1]) P.push(part(box(1.08, 0.95, 1), wallC, sd * 0.96, 0.475, 0));
      P.push(part(box(0.84, 0.33, 1), wallC, 0, 0.785, 0));
      // door frame and the dark tunnel through the house
      P.push(part(box(0.1, 0.66, 1.02), 0x6a4a2e, -0.45, 0.33, 0), part(box(0.1, 0.66, 1.02), 0x6a4a2e, 0.45, 0.33, 0), part(box(1.0, 0.1, 1.02), 0x6a4a2e, 0, 0.66, 0));
      P.push(part(box(0.8, 0.02, 1.0), 0x2a2a2a, 0, 0.62, 0));
      // windows and a little roof over each side
      for (const sd of [-1, 1]) {
        P.push(part(box(0.3, 0.3, 0.04), 0x6ab8e8, sd * 0.95, 0.55, 0.51), part(box(0.36, 0.05, 0.06), 0xffffff, sd * 0.95, 0.72, 0.52));
        P.push(part(box(1.14, 0.08, 1.12), roofC, sd * 0.96, 0.99, 0));
      }
      // the tower and its cap
      P.push(part(cyl(0.55, 0.78, 1.3, 8), hexNum(wallC, 0.95), 0, 0.95 + 0.65, -0.05));
      P.push(part(cyl(0.6, 0.6, 0.08, 8), 0x6a4a2e, 0, 0.95 + 1.3, -0.05));
      P.push(part(cone(0.66, 0.62, 8), roofC, 0, 0.95 + 1.3 + 0.35, -0.05));
      P.push(part(ico(0.08), 0xffd23a, 0, 0.95 + 1.3 + 0.7, -0.05));
      P.push(part(box(0.32, 0.4, 0.05), 0x5a3a22, 0, 1.25, 0.66, -0.14, 0, 0));
      const house = new THREE.Mesh(merge(P), vmat);
      house.castShadow = true;
      house.receiveShadow = true;
      g.add(house);
      // the sails (they turn about the hub, in front of the tower)
      const sails = new THREE.Group();
      sails.position.set(0, HUB, 0.78);
      const S: Part[] = [part(cyl(0.11, 0.11, 0.16, 10), 0x4a3a2a, 0, 0, 0, PI / 2), part(ico(0.07), 0xffd23a, 0, 0, 0.1)];
      for (let k = 0; k < 4; k++) {
        const a = (k * PI) / 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        S.push(part(box(BL, 0.06, 0.05), 0x6a4a2e, (ca * BL) / 2, (sa * BL) / 2, 0, 0, 0, a));
        // the cloth: a frame with a red stripe, offset to one side of the spar
        const L = BL - 0.28;
        const mid = 0.28 + L / 2;
        const ox = -sa * 0.17;
        const oz = ca * 0.17;
        S.push(part(box(L, 0.3, 0.025), 0xf4f0e6, ca * mid + ox, sa * mid + oz, 0.01, 0, 0, a));
        S.push(part(box(L, 0.07, 0.03), t.flag, ca * mid + ox * 1.6, sa * mid + oz * 1.6, 0.012, 0, 0, a));
      }
      const sm = new THREE.Mesh(merge(S), vmat);
      sm.castShadow = true;
      sails.add(sm);
      g.add(sails);
      this.inner.add(g);
      this.sails.push(sails);
    }
    // ---- loop-the-loops: two steel rails on the ball's own path round the loop, on white supports ----
    for (const L of s.loops) {
      const g = new THREE.Group();
      g.position.set(L.x, 0, L.z);
      g.rotation.y = L.ax === 1 ? -PI / 2 : 0;
      const R = LOOP_R + BALL_R;
      const P: Part[] = [];
      // the track: a band the ball rolls round the inside of, with a steel edge on each side
      const path = (u: number) => {
        const e = Math.min(1, Math.max(0, u));
        return { x: -0.5 + u + R * Math.sin(2 * PI * e), y: Math.max(0.01, R - R * Math.cos(2 * PI * e)), nx: -Math.sin(2 * PI * e), ny: Math.cos(2 * PI * e) };
      };
      const band: number[] = [];
      const N = 96;
      for (let k = 0; k < N; k++) {
        const a = path(-0.06 + (k / N) * 1.12);
        const b = path(-0.06 + ((k + 1) / N) * 1.12);
        for (const [p, q, r] of [
          [a, b, 0],
          [a, b, 1],
        ] as const) {
          void r;
          band.push(p.x, p.y, -0.21, q.x, q.y, -0.21, q.x, q.y, 0.21, p.x, p.y, -0.21, q.x, q.y, 0.21, p.x, p.y, 0.21);
          break;
        }
      }
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.Float32BufferAttribute(band, 3));
      bg.computeVertexNormals();
      const track = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ color: t.flag, roughness: 0.4, metalness: 0.2, side: THREE.DoubleSide }));
      track.castShadow = true;
      g.add(track);
      for (const lat of [-0.22, 0.22]) {
        const pts: THREE.Vector3[] = [];
        for (let k = 0; k <= 72; k++) {
          const p = path(-0.06 + (k / 72) * 1.12);
          pts.push(new THREE.Vector3(p.x + p.nx * 0.05, p.y + p.ny * 0.05, lat));
        }
        P.push(part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 90, 0.035, 6, false), 0xd8dce4));
      }
      // cross ties every so often, and the supports
      for (let k = 0; k < 12; k++) {
        const u = (k + 0.5) / 12;
        const sx = -0.5 + u + R * Math.sin(2 * PI * u);
        const sy = R - R * Math.cos(2 * PI * u);
        P.push(part(box(0.05, 0.05, 0.36), t.flag, sx + Math.sin(2 * PI * u) * 0.04, Math.max(0.03, sy) - Math.cos(2 * PI * u) * -0.04, 0));
      }
      for (const sx of [-0.62, 0.62]) {
        P.push(part(box(0.07, R * 2 + 0.2, 0.07), 0xffffff, sx, R + 0.1, -0.32), part(box(0.07, R * 2 + 0.2, 0.07), 0xffffff, sx, R + 0.1, 0.32));
        P.push(part(box(0.07, 0.07, 0.7), 0xffffff, sx, R * 2 + 0.2, 0));
      }
      P.push(part(box(1.3, 0.06, 0.07), 0xffffff, 0, R * 2 + 0.2, -0.32), part(box(1.3, 0.06, 0.07), 0xffffff, 0, R * 2 + 0.2, 0.32));
      const mesh = new THREE.Mesh(merge(P), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.35 }));
      mesh.castShadow = true;
      g.add(mesh);
      this.inner.add(g);
    }
    // ---- bridges: planks across, beams under, low rails along the water ----
    const B: Part[] = [];
    const pondy = (x: number, z: number) => {
      if (x < 0 || z < 0 || x >= s.W || z >= s.H) return true;
      const i = z * s.W + x;
      return s.ground[i] === G.Water || s.ground[i] === G.Void || s.kind[i] === K_BRIDGE;
    };
    for (let i = 0; i < s.kind.length; i++) {
      if (s.kind[i] !== K_BRIDGE) continue;
      const x = i % s.W;
      const z = (i - x) / s.W;
      const sideWater = pondy(x - 1, z) || pondy(x + 1, z);
      const endWater = pondy(x, z - 1) && pondy(x, z + 1);
      const alongZ = !(endWater && !sideWater) && (sideWater || !endWater);
      for (let k = 0; k < 5; k++) {
        const o = -0.4 + k * 0.2;
        const c = k % 2 ? 0x9a6a3a : 0x8a5a30;
        B.push(part(box(alongZ ? 1 : 0.18, 0.06, alongZ ? 0.18 : 1), c, x + 0.5 + (alongZ ? 0 : o), -0.025, z + 0.5 + (alongZ ? o : 0)));
      }
      for (const o of [-0.42, 0.42]) B.push(part(box(alongZ ? 0.1 : 1, 0.1, alongZ ? 1 : 0.1), 0x5a3a20, x + 0.5 + (alongZ ? o : 0), -0.1, z + 0.5 + (alongZ ? 0 : o)));
    }
    for (const r of s.rails) {
      const len = Math.hypot(r.bx - r.ax, r.bz - r.az);
      const horiz = Math.abs(r.bz - r.az) < 1e-6;
      for (const [px, pz] of [
        [r.ax, r.az],
        [r.bx, r.bz],
      ])
        B.push(part(box(0.09, 0.34, 0.09), 0x6a4426, px, 0.17, pz));
      B.push(part(box(horiz ? len : 0.07, 0.06, horiz ? 0.07 : len), 0x8a5a30, (r.ax + r.bx) / 2, 0.29, (r.az + r.bz) / 2));
      B.push(part(box(horiz ? len : 0.05, 0.05, horiz ? 0.05 : len), 0x7a4c28, (r.ax + r.bx) / 2, 0.14, (r.az + r.bz) / 2));
    }
    if (B.length) {
      const m = new THREE.Mesh(merge(B), vmat);
      m.castShadow = true;
      m.receiveShadow = true;
      this.inner.add(m);
    }
  }

  /** The ball from the shop: colours, a painted pattern, its trail. */
  setBall(c1: number, c2: number | undefined, pattern: string | undefined, trail: [number, number, number]) {
    const mat = this.ball.material as THREE.MeshStandardMaterial;
    this.trailRGB = trail;
    this.comet = pattern === 'comet';
    mat.map?.dispose();
    mat.map = null;
    mat.color.setHex(pattern ? 0xffffff : c1);
    mat.metalness = pattern === 'disco' ? 0.7 : 0;
    mat.roughness = pattern === 'disco' ? 0.2 : 0.32;
    mat.emissive.setHex(this.comet ? 0x1a4a8a : 0x000000);
    if (pattern) {
      const cv = document.createElement('canvas');
      cv.width = 256;
      cv.height = 128;
      const g = cv.getContext('2d')!;
      const h1 = '#' + c1.toString(16).padStart(6, '0');
      const h2 = '#' + (c2 ?? c1).toString(16).padStart(6, '0');
      g.fillStyle = h1;
      g.fillRect(0, 0, 256, 128);
      g.fillStyle = h2;
      g.strokeStyle = h2;
      switch (pattern) {
        case 'stripe':
          g.fillRect(0, 44, 256, 40);
          break;
        case 'tennis':
          g.lineWidth = 7;
          g.beginPath();
          for (let x = 0; x <= 256; x += 4) g.lineTo(x, 64 + Math.sin((x / 256) * PI * 4) * 34);
          g.stroke();
          break;
        case 'soccer':
          for (let k = 0; k < 12; k++) {
            const x = (k % 6) * 43 + (k < 6 ? 0 : 21);
            const y = k < 6 ? 36 : 92;
            g.beginPath();
            for (let j = 0; j < 5; j++) g.lineTo(x + 12 * Math.cos((j * 2 * PI) / 5), y + 12 * Math.sin((j * 2 * PI) / 5));
            g.fill();
          }
          break;
        case 'pool':
          g.beginPath();
          g.arc(64, 64, 26, 0, PI * 2);
          g.fill();
          g.fillStyle = '#141414';
          g.font = 'bold 34px Arial';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText('8', 64, 66);
          break;
        case 'melon':
          for (let x = 0; x < 256; x += 32) g.fillRect(x, 0, 12, 128);
          break;
        case 'disco':
          for (let x = 0; x < 256; x += 16) for (let y = 0; y < 128; y += 16) {
            g.fillStyle = (x + y) % 32 ? h2 : '#ffffff';
            g.fillRect(x + 1, y + 1, 14, 14);
          }
          break;
        case 'planet':
          for (let y = 10; y < 128; y += 22) g.fillRect(0, y, 256, 9);
          break;
        case 'comet':
          g.globalAlpha = 0.6;
          for (let k = 0; k < 14; k++) {
            g.beginPath();
            g.arc((k * 53) % 256, (k * 37) % 128, 6 + (k % 3) * 4, 0, PI * 2);
            g.fill();
          }
          break;
      }
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      mat.map = tex;
    }
    mat.needsUpdate = true;
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

  /** The fine ground at (x, z) is something the ball rolls over (not a wall, not the void). */
  private openAt(x: number, z: number): boolean {
    const g = this.sim.fineAt(x, z);
    return g !== G.Wall && g !== G.Void;
  }

  /** Three.js shapes from outlines: loops with a positive area are outer edges, the others holes in the smallest one
   *  around them. Shape coordinates are (x, −z): see extrude(). */
  private shapes(loops: { pts: P2[]; area: number }[]): THREE.Shape[] {
    const outers = loops.filter((l) => l.area > 0).sort((a, b) => a.area - b.area);
    const holes = loops.filter((l) => l.area < 0);
    const trace = (path: THREE.Path, pts: P2[]) => {
      pts.forEach((p, i) => (i ? path.lineTo(p.x, -p.z) : path.moveTo(p.x, -p.z)));
      path.closePath();
    };
    const out = outers.map((l) => {
      const sh = new THREE.Shape();
      trace(sh, l.pts);
      return sh;
    });
    for (const h of holes) {
      const p0 = h.pts[0];
      const k = outers.findIndex((o) => inPoly(p0.x, p0.z, o.pts));
      if (k < 0) continue;
      const path = new THREE.Path();
      trace(path, h.pts);
      out[k].holes.push(path);
    }
    return out;
  }

  /** The block the hole stands on: its edge follows the smooth outline; ponds, the cup and the tunnels are pits. */
  private buildPlate(): THREE.Object3D {
    const s = this.sim;
    const t = this.theme;
    const depth = Math.max(-t.outsideY, PIT + 0.14);
    const ring = (c: P2, r: number): { pts: P2[]; area: number } => ({
      pts: Array.from({ length: 28 }, (_, k) => ({ x: c.x + Math.cos((k / 28) * PI * 2) * r, z: c.z + Math.sin((k / 28) * PI * 2) * r })),
      area: -1,
    });
    const land = this.shapes(s.shape.land);
    const top = this.shapes([
      ...s.shape.land,
      ...s.shape.pond.map((l) => ({ pts: [...l.pts].reverse(), area: -l.area })),
      ring(s.cup, s.cupR),
      ...s.portals.map((p) => ring(p, 0.34)),
    ]);
    const extrude = (sh: THREE.Shape[], y0: number, y1: number, color: number) => {
      const g = new THREE.ExtrudeGeometry(sh, { depth: y1 - y0, bevelEnabled: false, curveSegments: 1, steps: 1 });
      g.rotateX(-PI / 2);
      g.translate(0, y0, 0);
      return part(g, color);
    };
    const P: Part[] = [extrude(top, -0.14, 0, t.base[0]), extrude(top, -PIT, -0.14, t.base[1]), extrude(land, -depth, -PIT, t.base[1])];
    const plate = new THREE.Mesh(merge(P), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    plate.receiveShadow = true;
    const g = new THREE.Group();
    g.add(plate);
    if (t.surround === 'street') g.add(this.windows());
    return g;
  }

  /**
   * Rails: a rounded bar along the walls' smooth outline wherever the ball can reach it (its inner face is exactly where
   * the ball bounces), posts now and then, and low decoration on the rest of the walls.
   */
  private buildRails(): THREE.Object3D {
    const s = this.sim;
    const t = this.theme;
    const capC = hexNum(t.wall, 1.12);
    const C: Part[] = [];
    const D: Part[] = [];
    const runs: P2[][] = [];
    const closed: boolean[] = [];
    for (const lp of s.shape.walls) {
      const pts = lp.pts;
      const n = pts.length;
      // a rail along every stretch with open ground on the outside (the walls are on the right of the outline)
      const on = pts.map((a, i) => {
        const b = pts[(i + 1) % n];
        const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        const mx = (a.x + b.x) / 2 + ((b.z - a.z) / L) * 0.3;
        const mz = (a.z + b.z) / 2 - ((b.x - a.x) / L) * 0.3;
        return this.openAt(mx, mz);
      });
      // (close single gaps)
      for (let i = 0; i < n; i++) if (!on[i] && on[(i - 1 + n) % n] && on[(i + 1) % n]) on[i] = true;
      if (on.every(Boolean)) {
        runs.push([...pts, pts[0]]);
        closed.push(true);
        // a small island of wall (a post, a short block): solid, with a cap level with the rails
        if (lp.area > 0 && lp.area < 3.6) {
          const sh = this.shapes([lp]);
          const g = new THREE.ExtrudeGeometry(sh, { depth: RAIL_H + RAIL_T * 0.42, bevelEnabled: false, curveSegments: 1 });
          g.rotateX(-PI / 2);
          C.push(part(g, t.wallTop));
        }
        continue;
      }
      let i0 = on.findIndex((v) => !v);
      for (let k = 1; k <= n; k++) {
        const i = (i0 + k) % n;
        if (!on[i] || on[(i - 1 + n) % n]) continue;
        const run: P2[] = [pts[i]];
        let j = i;
        while (on[j % n] && run.length <= n) {
          run.push(pts[(j + 1) % n]);
          j++;
        }
        runs.push(run);
        closed.push(false);
      }
      void i0;
    }
    const pos: number[] = [];
    const nor: number[] = [];
    const col: number[] = [];
    const cw = new THREE.Color(t.wall);
    const cc = new THREE.Color(capC);
    // the bar's cross-section: inner face, rounded cap, outer face (offset into the wall, height)
    const prof: { o: number; y: number; no: number; ny: number; cap: boolean }[][] = [];
    prof.push([
      { o: 0, y: 0, no: -1, ny: 0, cap: false },
      { o: 0, y: RAIL_H, no: -1, ny: 0, cap: false },
    ]);
    const capPts: { o: number; y: number; no: number; ny: number; cap: boolean }[] = [];
    for (let k = 0; k <= 6; k++) {
      const a = PI - (k / 6) * PI;
      capPts.push({ o: RAIL_T / 2 + (Math.cos(a) * RAIL_T) / 2, y: RAIL_H + (Math.sin(a) * RAIL_T) / 2, no: Math.cos(a), ny: Math.sin(a), cap: true });
    }
    prof.push(capPts);
    prof.push([
      { o: RAIL_T, y: RAIL_H, no: 1, ny: 0, cap: false },
      { o: RAIL_T, y: 0, no: 1, ny: 0, cap: false },
    ]);
    runs.forEach((run, r) => {
      const m = run.length;
      if (m < 2) return;
      // into the wall at every point (mitred at sharp corners)
      const inw = run.map((p, i) => {
        const a = run[Math.max(0, i - 1)];
        const b = run[Math.min(m - 1, i + 1)];
        let tx: number;
        let tz: number;
        if (closed[r] && (i === 0 || i === m - 1)) {
          const a2 = run[m - 2];
          const b2 = run[1];
          tx = b2.x - a2.x;
          tz = b2.z - a2.z;
        } else {
          tx = b.x - a.x;
          tz = b.z - a.z;
        }
        const L = Math.hypot(tx, tz) || 1;
        tx /= L;
        tz /= L;
        // mitre: keep the bar's thickness through a corner
        let k = 1;
        if (i > 0 && i < m - 1) {
          const ax = p.x - a.x;
          const az = p.z - a.z;
          const la = Math.hypot(ax, az) || 1;
          const c = (ax / la) * tx + (az / la) * tz;
          k = 1 / Math.max(0.5, c);
        }
        return { x: -tz * k, z: tx * k, nx: -tz, nz: tx };
      });
      for (const seg of prof)
        for (let q = 0; q + 1 < seg.length; q++) {
          const A = seg[q];
          const B = seg[q + 1];
          for (let i = 0; i + 1 < m; i++) {
            const quad = [
              [i, A],
              [i + 1, B],
              [i + 1, A],
              [i, A],
              [i, B],
              [i + 1, B],
            ] as const;
            for (const [k, P] of quad) {
              const p = run[k];
              const w = inw[k];
              pos.push(p.x + w.x * P.o, P.y, p.z + w.z * P.o);
              nor.push(w.nx * P.no, P.ny, w.nz * P.no);
              const c = P.cap ? cc : cw;
              col.push(c.r, c.g, c.b);
            }
          }
        }
      // posts: at the ends of a stretch and every few cells along it
      let acc = 0;
      const post = (p: P2, w: { nx: number; nz: number }) => {
        const fx = p.x + w.nx * RAIL_T * 0.5;
        const fz = p.z + w.nz * RAIL_T * 0.5;
        C.push(part(cyl(0.13, 0.14, RAIL_H + 0.12, 12), t.wallTop, fx, (RAIL_H + 0.12) / 2, fz));
        C.push(part(ico(0.1, 1), capC, fx, RAIL_H + 0.14, fz));
      };
      if (!closed[r]) {
        post(run[0], inw[0]);
        post(run[m - 1], inw[m - 1]);
      }
      for (let i = 1; i < m - 1; i++) {
        acc += Math.hypot(run[i].x - run[i - 1].x, run[i].z - run[i - 1].z);
        if (acc > 3.2) {
          acc = 0;
          post(run[i], inw[i]);
        }
      }
    });
    // low decoration on the walls, well away from the rails: flowers, tiles, crates…
    const rnd = lcg(s.W * 77 + s.H * 3);
    for (let z = 0; z < s.H; z++)
      for (let x = 0; x < s.W; x++) {
        if (s.ground[z * s.W + x] !== G.Wall || s.kind[z * s.W + x]) continue;
        if (rnd() >= 0.5) continue;
        const px = x + 0.25 + rnd() * 0.5;
        const pz = z + 0.25 + rnd() * 0.5;
        if (s.fineAt(px, pz) !== G.Wall || s.wallDist(px, pz) < 0.42) continue;
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
          case 'beach':
            if (rnd() < 0.5) D.push(part(ico(0.13), 0xffb08a, px, 0.05, pz, 0, rnd(), 0, 1, 0.4, 1));
            else D.push(part(cone(0.12, 0.2, 5), 0xf4ead2, px, 0.08, pz, PI / 2, rnd() * 3, 0));
            break;
          case 'desert':
            D.push(part(cyl(0.12, 0.17, 0.3, 8), 0xc0703a, px, 0.15, pz), part(cyl(0.07, 0.1, 0.08, 8), 0xa85a2a, px, 0.33, pz));
            break;
          case 'castle':
            D.push(part(cyl(0.16, 0.16, 0.34, 10), 0x7a5230, px, 0.17, pz), part(cyl(0.165, 0.165, 0.04, 10), 0x3a3a3a, px, 0.28, pz));
            break;
          case 'city':
            D.push(part(box(0.5, 0.06, 0.06), c1, px, 0.1, pz, 0, rnd() * 3, 0));
            break;
          case 'canyon':
            D.push(part(dode(0.17), t.props[1], px, 0.08, pz, rnd(), rnd(), 0, 1, 0.7, 1));
            break;
          case 'space':
            D.push(part(cyl(0.03, 0.03, 0.4, 6), 0xd8dce6, px, 0.2, pz), part(ico(0.06), 0xff4a3a, px, 0.42, pz));
            break;
        }
      }
    const g = new THREE.Group();
    if (pos.length) {
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      rg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      rg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const rail = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
      rail.castShadow = true;
      rail.receiveShadow = true;
      g.add(rail);
    }
    for (const list of [C, D]) {
      if (!list.length) continue;
      const m = new THREE.Mesh(merge(list), list === C ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }) : new THREE.MeshLambertMaterial({ vertexColors: true }));
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    return g;
  }

  /** Ponds: a rippling surface sunk into the plate, the shape of the pond. */
  private buildWater() {
    const s = this.sim;
    if (!s.shape.pond.length) return;
    const geo = new THREE.ShapeGeometry(this.shapes(s.shape.pond), 1);
    geo.rotateX(-PI / 2);
    geo.translate(0, -0.1, 0);
    // world-space UVs so the ripples flow across without seams
    const pos = geo.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let k = 0; k < pos.count; k++) {
      uv[k * 2] = pos.getX(k) * 0.5;
      uv[k * 2 + 1] = pos.getZ(k) * 0.5;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.waterTex = rippleTexture(this.theme.water);
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: this.waterTex, transparent: true, opacity: 0.92 }));
    m.receiveShadow = true;
    this.inner.add(m);
  }

  /** The cup: a real hole (the green is cut out), a dark liner, a white rim — on top of its mound, if it has one. */
  private buildCup() {
    const s = this.sim;
    const r = s.cupR;
    const hy = s.heightAt(s.cup.x, s.cup.z);
    const liner = new THREE.Mesh(new THREE.CylinderGeometry(r, r, PIT + hy, 24, 1, true), new THREE.MeshLambertMaterial({ color: 0x3a3a3a, side: THREE.BackSide }));
    liner.position.set(s.cup.x, (hy - PIT) / 2, s.cup.z);
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(r, 24), new THREE.MeshBasicMaterial({ color: 0x0c0c0c }));
    bottom.rotation.x = -PI / 2;
    bottom.position.set(s.cup.x, -PIT + 0.01, s.cup.z);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r + 0.015, 0.025, 6, 32), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }));
    rim.rotation.x = PI / 2;
    rim.position.set(s.cup.x, hy + 0.004, s.cup.z);
    this.inner.add(liner, bottom, rim);
  }

  /** Lit windows on the sides of the building the rooftop hole stands on. */
  private windows(): THREE.Object3D {
    const s = this.sim;
    const P: Part[] = [];
    const rnd = lcg(s.W * 31 + s.H);
    const pts = s.shape.land.flatMap((l) => (l.area > 0 ? [l.pts] : []));
    for (const lp of pts) {
      let acc = 0;
      for (let i = 0; i < lp.length; i++) {
        const a = lp[i];
        const b = lp[(i + 1) % lp.length];
        const L = Math.hypot(b.x - a.x, b.z - a.z);
        acc += L;
        if (acc < 0.9 || L < 1e-6) continue;
        acc = 0;
        // facing out of the building (the plate is on the right of its outline)
        const nx = (b.z - a.z) / L;
        const nz = -(b.x - a.x) / L;
        const ang = Math.atan2(nx, nz);
        for (let fl = 0; fl < 4; fl++) {
          if (rnd() < 0.35) continue;
          const c = rnd() < 0.6 ? 0xffd27a : 0x3a3a4a;
          P.push(part(box(0.5, 0.7, 0.02), c, b.x + nx * 0.02, -1.4 - fl * 2, b.z + nz * 0.02, 0, ang, 0));
        }
      }
    }
    if (!P.length) return new THREE.Group();
    return new THREE.Mesh(merge(P), new THREE.MeshBasicMaterial({ vertexColors: true }));
  }

  /** Path of a set of outlines on the painted canvas. */
  private path(loops: { pts: P2[] }[], frame = false) {
    const ctx = this.ctx;
    ctx.beginPath();
    if (frame) ctx.rect(-PX, -PX, this.canvas.width + PX * 2, this.canvas.height + PX * 2);
    for (const l of loops) {
      l.pts.forEach((p, i) => (i ? ctx.lineTo(p.x * PX, p.z * PX) : ctx.moveTo(p.x * PX, p.z * PX)));
      ctx.closePath();
    }
  }

  /** Paint the cells near a region (kind) inside its smooth outline only. */
  private paintRegion(loops: { pts: P2[] }[], kind: number, cells: (x: number, z: number) => boolean, rnd: () => number) {
    if (!loops.length) return;
    const s = this.sim;
    const ctx = this.ctx;
    ctx.save();
    this.path(loops);
    ctx.clip('evenodd');
    for (let z = 0; z < s.H; z++)
      for (let x = 0; x < s.W; x++) {
        let near = false;
        for (let dz = -1; dz <= 1 && !near; dz++) for (let dx = -1; dx <= 1; dx++) if (cells(x + dx, z + dz)) near = true;
        if (near) this.paintBase(x, z, kind, rnd);
      }
    ctx.restore();
  }

  private paint() {
    const s = this.sim;
    const ctx = this.ctx;
    const rnd = lcg(s.W * 977 + s.H * 13 + 5);
    const at = (x: number, z: number) => (x < 0 || z < 0 || x >= s.W || z >= s.H ? G.Void : s.ground[z * s.W + x]);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // the playing surface everywhere, then the bunkers, the ice and the rough around the rails in their own shapes
    for (let z = 0; z < s.H; z++) for (let x = 0; x < s.W; x++) if (at(x, z) !== G.Void) this.paintBase(x, z, G.Green, rnd);
    this.paintRegion(s.shape.ice, G.Ice, (x, z) => at(x, z) === G.Ice, rnd);
    this.paintRegion(s.shape.sand, G.Sand, (x, z) => at(x, z) === G.Sand, rnd);
    this.paintRegion(s.shape.walls, G.Wall, (x, z) => at(x, z) === G.Wall, rnd);
    for (let z = 0; z < s.H; z++) for (let x = 0; x < s.W; x++) if (this.playable(x, z)) this.paintOverlay(x, z);
    // mounds: lit on the sun's side, in shade on the other, with a darker foot
    for (const h of s.hills) {
      const cx = h.x * PX;
      const cz = h.z * PX;
      const R = h.r * PX;
      const lit = ctx.createRadialGradient(cx - R * 0.3, cz + R * 0.25, 0, cx, cz, R);
      lit.addColorStop(0, 'rgba(255,255,230,0.22)');
      lit.addColorStop(0.55, 'rgba(255,255,230,0.05)');
      lit.addColorStop(1, 'rgba(255,255,230,0)');
      ctx.fillStyle = lit;
      ctx.beginPath();
      ctx.arc(cx, cz, R, 0, PI * 2);
      ctx.fill();
      const shade2 = ctx.createRadialGradient(cx + R * 0.35, cz - R * 0.3, R * 0.2, cx, cz, R);
      shade2.addColorStop(0, 'rgba(0,0,0,0)');
      shade2.addColorStop(0.75, 'rgba(0,20,0,0.1)');
      shade2.addColorStop(1, 'rgba(0,20,0,0)');
      ctx.fillStyle = shade2;
      ctx.beginPath();
      ctx.arc(cx, cz, R, 0, PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,30,0,0.12)';
      ctx.lineWidth = 2;
      for (const k of [0.45, 0.78]) {
        ctx.beginPath();
        ctx.arc(cx, cz, R * k, 0, PI * 2);
        ctx.stroke();
      }
    }
    // soft shadow along the rails (ambient occlusion), on the playing side only
    if (s.shape.walls.length) {
      ctx.save();
      this.path(s.shape.walls, true);
      ctx.clip('evenodd');
      this.path(s.shape.walls);
      ctx.lineJoin = 'round';
      for (const [w, a] of [
        [0.56, 0.07],
        [0.38, 0.08],
        [0.2, 0.1],
      ]) {
        ctx.lineWidth = w * PX;
        ctx.strokeStyle = `rgba(0,0,0,${a})`;
        ctx.stroke();
      }
      ctx.restore();
    }
    // cut out the ponds and everything off the plate
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    if (s.shape.pond.length) {
      // (not under the walls: the ponds' square corners hide there)
      ctx.save();
      this.path(s.shape.walls, true);
      ctx.clip('evenodd');
      this.path(s.shape.pond);
      ctx.fill('evenodd');
      ctx.restore();
    }
    this.path(s.shape.land, true);
    ctx.fill('evenodd');
    ctx.restore();
    // the cup: cut a hole (transparent) with a darker collar around it
    const cx = s.cup.x * PX;
    const cz = s.cup.z * PX;
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.arc(cx, cz, s.cupR * PX * 1.6, 0, PI * 2);
    ctx.fill();
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(cx, cz, s.cupR * PX, 0, PI * 2);
    ctx.fill();
    ctx.restore();
    // tunnels: a hole with a collar, like the cup
    s.portals.forEach((p, k) => {
      const gx = p.x * PX;
      const gz = p.z * PX;
      if (this.pipes) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath();
        ctx.arc(gx, gz, PX * 0.5, 0, PI * 2);
        ctx.fill();
      } else {
        const c = k < 2 ? (this.theme.glow ?? 0x36e0ff) : 0xff8a3a;
        const col = '#' + c.toString(16).padStart(6, '0');
        const g = ctx.createRadialGradient(gx, gz, PX * 0.3, gx, gz, PX * 0.55);
        g.addColorStop(0, col);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(gx, gz, PX * 0.55, 0, PI * 2);
        ctx.fill();
      }
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(gx, gz, PX * 0.34, 0, PI * 2);
      ctx.fill();
      ctx.restore();
    });
    // the tee mat
    const tx = s.tee.x * PX;
    const tz = s.tee.z * PX;
    ctx.fillStyle = 'rgba(20,60,30,0.35)';
    ctx.beginPath();
    ctx.roundRect(tx - PX * 0.45, tz - PX * 0.45, PX * 0.9, PX * 0.9, PX * 0.18);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /** The texture of one kind of ground over a whole cell (green or the course's floor, sand, ice, the rough). */
  private paintBase(x: number, z: number, kind: number, rnd: () => number) {
    const s = this.sim;
    const t = this.theme;
    const ctx = this.ctx;
    const px = x * PX;
    const pz = z * PX;
    const dots = (c: string, n: number, w = 2, h = 2) => {
      ctx.fillStyle = c;
      for (let k = 0; k < n; k++) ctx.fillRect(px + rnd() * (PX - w), pz + rnd() * (PX - h), w, h);
    };
    switch (kind) {
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
        return;
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
        return;
      }
    }
    // green (or the course's own floor)
    if (t.floor && t.floor !== 'grass' && t.floor !== 'deck') {
      this.paintFloor(px, pz, x, z, rnd);
      return;
    }
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
      return;
    }
    // mowed stripes, two cells wide, with a soft grain
    const base = t.green[Math.floor(z / 2) % 2];
    ctx.fillStyle = base;
    ctx.fillRect(px, pz, PX, PX);
    dots(shade(base, 1.07), 14, 1, 3);
    dots(shade(base, 0.92), 14, 1, 3);
    void s;
  }

  /** What is painted over a playable cell: wet sand, slopes, boosters, the portcullises' groove. */
  private paintOverlay(x: number, z: number) {
    const s = this.sim;
    const t = this.theme;
    const ctx = this.ctx;
    const i = z * s.W + x;
    const px = x * PX;
    const pz = z * PX;
    if (s.dyn[i] === 1) {
      // wet sand that the tide covers: darker, with ripple marks
      ctx.fillStyle = shade(t.sand, 0.8);
      ctx.fillRect(px, pz, PX, PX);
      ctx.strokeStyle = shade(t.sand, 0.68);
      ctx.lineWidth = 1.5;
      for (let k = 1; k < 5; k++) {
        ctx.beginPath();
        ctx.moveTo(px, pz + (k * PX) / 5);
        for (let u = 0; u <= PX; u += 6) ctx.lineTo(px + u, pz + (k * PX) / 5 + Math.sin((u + x * PX) * 0.25) * 1.5);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      for (let k = 0; k < 5; k++) ctx.fillRect(px + ((k * 17 + x * 7) % PX), pz + ((k * 29 + z * 11) % PX), 2, 2);
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
    const glow = '#' + (t.glow ?? 0x36e0ff).toString(16).padStart(6, '0');
    // boosters: a pad with bright chevrons
    const bo = s.boost[i];
    if (bo) {
      ctx.save();
      ctx.translate(px + PX / 2, pz + PX / 2);
      ctx.rotate(bo === 1 ? -PI / 2 : bo === 2 ? PI / 2 : bo === 3 ? PI : 0);
      ctx.fillStyle = 'rgba(10,10,30,0.75)';
      ctx.fillRect(-PX / 2 + 3, -PX / 2 + 3, PX - 6, PX - 6);
      ctx.strokeStyle = glow;
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = glow;
      ctx.shadowBlur = 8;
      for (const o of [-12, 0, 12]) {
        ctx.beginPath();
        ctx.moveTo(o - 6, -12);
        ctx.lineTo(o + 6, 0);
        ctx.lineTo(o - 6, 12);
        ctx.stroke();
      }
      ctx.restore();
    }
    // portcullis track: a groove across the fairway
    const dy2 = s.dyn[i];
    if (dy2 === 3 || dy2 === 4) {
      const along = (x > 0 && s.dyn[i - 1] === dy2) || (x < s.W - 1 && s.dyn[i + 1] === dy2) || !(z > 0 && s.dyn[i - s.W] === dy2);
      ctx.fillStyle = 'rgba(30,30,36,0.55)';
      if (along) ctx.fillRect(px, pz + PX / 2 - 4, PX, 8);
      else ctx.fillRect(px + PX / 2 - 4, pz, 8, PX);
    }
  }

  /** Floors of the new courses: sandstone tiles, a neon carpet, packed red earth, metal plates. */
  private paintFloor(px: number, pz: number, x: number, z: number, rnd: () => number) {
    const ctx = this.ctx;
    const t = this.theme;
    const base = t.green[(x + z) % 2];
    ctx.fillStyle = base;
    ctx.fillRect(px, pz, PX, PX);
    switch (t.floor) {
      case 'tiles': {
        ctx.fillStyle = shade(base, 1.06);
        ctx.fillRect(px + 2, pz + 2, PX - 4, PX - 4);
        ctx.strokeStyle = shade(base, 0.72);
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 1, pz + 1, PX - 2, PX - 2);
        // a carved glyph now and then
        if (rnd() < 0.18) {
          ctx.strokeStyle = shade(base, 0.78);
          ctx.lineWidth = 2;
          ctx.beginPath();
          const k = Math.floor(rnd() * 3);
          if (k === 0) ctx.arc(px + PX / 2, pz + PX / 2, 8, 0, PI * 2);
          else if (k === 1) {
            ctx.moveTo(px + PX / 2, pz + 10);
            ctx.lineTo(px + PX / 2, pz + PX - 10);
            ctx.moveTo(px + PX / 2 - 8, pz + 18);
            ctx.lineTo(px + PX / 2 + 8, pz + 18);
          } else {
            ctx.moveTo(px + 12, pz + PX - 12);
            ctx.lineTo(px + PX / 2, pz + 12);
            ctx.lineTo(px + PX - 12, pz + PX - 12);
          }
          ctx.stroke();
        }
        break;
      }
      case 'carpet': {
        const glow = '#' + (t.glow ?? 0x36e0ff).toString(16).padStart(6, '0');
        ctx.fillStyle = 'rgba(255,255,255,0.025)';
        for (let k = 0; k < 18; k++) ctx.fillRect(px + rnd() * PX, pz + rnd() * PX, 2, 2);
        ctx.strokeStyle = glow;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(px + 0.5, pz + 0.5, PX - 1, PX - 1);
        ctx.globalAlpha = 1;
        break;
      }
      case 'earth': {
        for (let k = 0; k < 26; k++) {
          ctx.fillStyle = shade(base, 0.9 + rnd() * 0.18);
          ctx.fillRect(px + rnd() * PX, pz + rnd() * PX, 3, 2);
        }
        if (rnd() < 0.3) {
          ctx.strokeStyle = shade(base, 0.75);
          ctx.lineWidth = 1;
          ctx.beginPath();
          const sx = px + rnd() * PX;
          const sz = pz + rnd() * PX;
          ctx.moveTo(sx, sz);
          ctx.lineTo(sx + (rnd() - 0.5) * 20, sz + (rnd() - 0.5) * 20);
          ctx.lineTo(sx + (rnd() - 0.5) * 30, sz + (rnd() - 0.5) * 30);
          ctx.stroke();
        }
        break;
      }
      case 'plates': {
        const gr = ctx.createLinearGradient(px, pz, px + PX, pz + PX);
        gr.addColorStop(0, shade(base, 1.08));
        gr.addColorStop(1, shade(base, 0.92));
        ctx.fillStyle = gr;
        ctx.fillRect(px + 1, pz + 1, PX - 2, PX - 2);
        ctx.strokeStyle = shade(base, 0.7);
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 1, pz + 1, PX - 2, PX - 2);
        ctx.fillStyle = shade(base, 0.6);
        for (const [a, b] of [
          [5, 5],
          [PX - 7, 5],
          [5, PX - 7],
          [PX - 7, PX - 7],
        ])
          ctx.fillRect(px + a, pz + b, 2.5, 2.5);
        break;
      }
    }
  }

  /** Lava: one glowing sheet, masked to the molten cells (rounded where the flow ends), never over the walls. */
  private syncLava() {
    const s = this.sim;
    if (!this.lavaMesh || !this.lavaMask) return;
    const lava = (x: number, z: number) => x >= 0 && z >= 0 && x < s.W && z < s.H && s.ground[z * s.W + x] === G.Lava;
    const c = this.lavaMask;
    const g = c.getContext('2d')!;
    const k = LAVA_PX;
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = '#fff';
    const cells: P2[] = [];
    for (let z = 0; z < s.H; z++)
      for (let x = 0; x < s.W; x++) {
        if (!lava(x, z)) continue;
        cells.push({ x: x + 0.5, z: z + 0.5 });
        const corner = (dx: number, dz: number) => (lava(x + dx, z) || lava(x, z + dz) ? 0 : k * 0.38);
        g.beginPath();
        g.roundRect(x * k - 0.5, z * k - 0.5, k + 1, k + 1, [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]);
        g.fill();
      }
    // never over the walls
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.scale(k / PX, k / PX);
    g.beginPath();
    for (const l of s.shape.walls) {
      l.pts.forEach((p, i) => (i ? g.lineTo(p.x * PX, p.z * PX) : g.moveTo(p.x * PX, p.z * PX)));
      g.closePath();
    }
    g.fill('evenodd');
    g.restore();
    this.lavaMaskTex!.needsUpdate = true;
    const n = cells.length;
    if (n > this.lavaCells.length && this.lavaCells.length > 0 && this.tier !== 'low') {
      // new lava: a burst of sparks over the freshly molten cells
      for (const p of cells) {
        if (this.lavaCells.some((q) => q.x === p.x && q.z === p.z)) continue;
        for (let j = 0; j < 4; j++) this.sparks.add({ x: p.x + Math.random() - 0.5, y: 0.1, z: p.z + Math.random() - 0.5, vy: 1.5 + Math.random() * 2, life: 0.8, s0: 0.15, s1: 0.04, r: 1, g: 0.5, b: 0.15, grav: 3 });
      }
    }
    this.lavaCells = cells;
    this.lavaCount = n;
    this.lavaMesh.visible = n > 0;
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
      case 'beach': {
        // the sea beyond the top of the hole, palms, parasols and towels on the sand
        this.seaTex = rippleTexture('#2fbccc');
        this.seaTex.repeat.set(40, 20);
        const sg = new THREE.PlaneGeometry(400, 200);
        sg.rotateX(-PI / 2);
        const sea = new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ map: this.seaTex }));
        sea.position.set(s.W / 2, y0 + 0.03, -7 - 100);
        this.group.add(sea);
        P.push(part(box(400, 0.04, 0.6), 0xffffff, s.W / 2, y0 + 0.05, -7));
        for (let k = 0; k < 16; k++) {
          const [x, z] = far(2, 14);
          if (z < -6) continue;
          const sc = 0.9 + rnd() * 0.6;
          const lean = (rnd() - 0.5) * 0.5;
          for (let j = 0; j < 5; j++) P.push(part(cyl(0.11 * sc, 0.14 * sc, 0.62 * sc, 6), j % 2 ? 0x9a7048 : 0x8a6038, x + lean * j * 0.6 * sc, y0 + (0.3 + j * 0.6) * sc, z, 0, 0, -lean * 0.4));
          const tx = x + lean * 3 * sc;
          const ty = y0 + 3.2 * sc;
          for (let j = 0; j < 6; j++) {
            const a = (j / 6) * PI * 2 + k;
            P.push(part(box(1.5 * sc, 0.05, 0.35 * sc), pick(j % 2), tx + Math.cos(a) * 0.7 * sc, ty - 0.2, z + Math.sin(a) * 0.7 * sc, 0, -a, -0.35));
          }
        }
        for (let k = 0; k < 9; k++) {
          const [x, z] = far(1.8, 9);
          if (z < -6) continue;
          if (k % 2) {
            P.push(part(cyl(0.04, 0.04, 1.8, 6), 0xf4f4f0, x, y0 + 0.9, z), part(cone(1.0, 0.45, 10), pick(2 + (k % 3)), x, y0 + 1.85, z));
          } else P.push(part(box(0.7, 0.03, 1.5), pick(2 + (k % 3)), x, y0 + 0.02, z, 0, rnd() * 2, 0));
        }
        break;
      }
      case 'desert': {
        // dunes, sandstone columns (some broken), an obelisk and pyramids far away
        for (let k = 0; k < 18; k++) {
          const [x, z] = far(3, 26);
          P.push(part(ico(2.2 + rnd() * 2.4, 1), 0xe8b46e, x, y0 - 0.6, z, 0, rnd() * 3, 0, 1.6, 0.35, 1));
        }
        for (let k = 0; k < 10; k++) {
          const [x, z] = far(1.6, 7);
          const h = k % 3 === 0 ? 1.2 + rnd() : 3.2;
          P.push(part(box(0.9, 0.25, 0.9), 0xd9b07a, x, y0 + 0.12, z), part(cyl(0.32, 0.36, h, 10), 0xe6c08a, x, y0 + 0.25 + h / 2, z));
          if (h > 3) P.push(part(box(0.95, 0.3, 0.95), 0xd9b07a, x, y0 + 0.25 + h + 0.15, z));
        }
        {
          const [x, z] = [s.W + 4.5, -2];
          P.push(part(cyl(0.45, 0.8, 6.5, 4), 0xe6c08a, x, y0 + 3.25, z, 0, PI / 4, 0), part(cone(0.5, 0.9, 4), 0xffd23a, x, y0 + 6.95, z, 0, PI / 4, 0));
        }
        for (let k = 0; k < 3; k++) P.push(part(cone(9 + k * 3, 8 + k * 2, 4), 0xd8a860, -12 + k * 16, y0 + 4 + k, -38 - k * 6, 0, PI / 4, 0));
        break;
      }
      case 'castle': {
        // battlements round three sides, towers at the corners, banners
        const wallC = 0xa8a49a;
        const ring = (x0: number, z0: number, x1: number, z1: number) => {
          const len = Math.hypot(x1 - x0, z1 - z0);
          const n = Math.max(2, Math.round(len / 1.2));
          for (let k = 0; k < n; k++) {
            const u = (k + 0.5) / n;
            const x = x0 + (x1 - x0) * u;
            const z = z0 + (z1 - z0) * u;
            const horiz = Math.abs(z1 - z0) < 0.01;
            P.push(part(box(horiz ? len / n + 0.02 : 1.4, 3, horiz ? 1.4 : len / n + 0.02), wallC, x, y0 + 1.5, z));
            if (k % 2 === 0) P.push(part(box(horiz ? 0.6 : 1.4, 0.6, horiz ? 1.4 : 0.6), wallC, x, y0 + 3.3, z));
          }
        };
        const m = 4.5;
        ring(-m, -m, s.W + m, -m);
        ring(-m, -m, -m, s.H + 2);
        ring(s.W + m, -m, s.W + m, s.H + 2);
        for (const [x, z] of [
          [-m, -m],
          [s.W + m, -m],
          [-m, s.H + 2],
          [s.W + m, s.H + 2],
        ]) {
          P.push(part(cyl(1.5, 1.6, 5.5, 12), 0xb8b4aa, x, y0 + 2.75, z), part(cone(1.9, 2.4, 12), pick(2), x, y0 + 6.7, z), part(cyl(0.04, 0.04, 1.2, 6), 0x3a3a3a, x, y0 + 8.4, z), part(box(0.7, 0.4, 0.04), pick(3), x + 0.36, y0 + 8.7, z));
        }
        for (let k = 0; k < 10; k++) {
          const [x, z] = far(1.5, 3.5);
          if (k % 2) P.push(part(cyl(0.3, 0.3, 0.6, 10), 0x7a5230, x, y0 + 0.3, z));
          else P.push(part(box(0.6, 0.6, 0.6), 0x8a6a40, x, y0 + 0.3, z));
        }
        break;
      }
      case 'city': {
        // dark towers rising from the street far below, lit windows and neon signs
        const N: Part[] = [];
        for (let k = 0; k < 38; k++) {
          const [x, z] = far(2.5, 22);
          const w = 2 + rnd() * 3;
          const d = 2 + rnd() * 3;
          const top = -2.5 + rnd() * 6;
          const hgt = top - y0;
          P.push(part(box(w, hgt, d), k % 2 ? 0x1e1a2e : 0x2a2440, x, y0 + hgt / 2, z));
          const c = pick(k);
          N.push(part(box(w + 0.05, 0.12, d + 0.05), c, x, top - 0.3, z));
          if (rnd() < 0.5) N.push(part(box(0.12, hgt * 0.6, d + 0.06), pick(k + 1), x - w / 2, y0 + hgt * 0.55, z));
          for (let f = 0; f < 5; f++) if (rnd() < 0.55) N.push(part(box(w * 0.7, 0.18, d + 0.04), 0xffe2a0, x, top - 1.2 - f * 1.4, z));
        }
        for (let k = 0; k < 3; k++) {
          const [x, z] = far(1.2, 3);
          N.push(part(box(1.6, 0.7, 0.08), pick(k), x, 1.2, z), part(box(1.7, 0.08, 0.1), 0x1a1a24, x, 0.8, z));
          P.push(part(box(0.08, 1.2, 0.08), 0x3a3a4a, x, 0.2, z));
        }
        this.group.add(new THREE.Mesh(merge(N), new THREE.MeshBasicMaterial({ vertexColors: true })));
        for (let k = 0; k < 3; k++) {
          const l = new THREE.PointLight(pick(k), 12, 16, 1.3);
          l.position.set(k === 1 ? s.W + 1.5 : -1.5, 2.6, s.H * (0.2 + k * 0.3));
          this.group.add(l);
          this.lights.push(l);
        }
        break;
      }
      case 'canyon': {
        // mesas of layered red rock, cacti on top, the canyon floor far below
        for (let k = 0; k < 22; k++) {
          const [x, z] = far(3, 26);
          const w = 3 + rnd() * 5;
          const d = 3 + rnd() * 5;
          const top = -3 + rnd() * 4.5;
          const hgt = top - y0;
          const layers = 3;
          for (let j = 0; j < layers; j++) {
            const h = hgt / layers;
            P.push(part(box(w * (1 - j * 0.06), h, d * (1 - j * 0.06)), j % 2 ? 0xb45a34 : 0xc8703e, x, y0 + h * (j + 0.5), z));
          }
          if (rnd() < 0.6) P.push(part(cyl(0.18, 0.2, 1.2, 8), 0x3a8a4a, x, top + 0.6, z), part(cyl(0.12, 0.12, 0.5, 8), 0x3a8a4a, x + 0.3, top + 0.8, z, 0, 0, -0.9));
        }
        for (let k = 0; k < 8; k++) {
          const [x, z] = far(0.8, 2.4);
          P.push(part(cyl(0.12, 0.14, 0.8, 8), 0x3a8a4a, x, 0.0, z), part(cyl(0.08, 0.08, 0.35, 8), 0x3a8a4a, x + 0.18, 0.15, z, 0, 0, -1));
        }
        break;
      }
      case 'space': {
        // grey dust with craters, a domed base, the Earth in a sky full of stars
        for (let k = 0; k < 24; k++) {
          const [x, z] = far(2, 26);
          const r = 0.8 + rnd() * 2.4;
          P.push(part(cyl(r, r * 1.1, 0.15, 16), 0x6e7078, x, y0 + 0.02, z), part(cyl(r * 0.8, r * 0.8, 0.06, 16), 0x5a5c64, x, y0 + 0.1, z));
        }
        for (let k = 0; k < 16; k++) {
          const [x, z] = far(1.5, 18);
          P.push(part(dode(0.4 + rnd() * 0.9), pick(k % 2), x, y0 + 0.2, z, k, k, 0, 1, 0.6, 1));
        }
        {
          const bx = -6;
          const bz = -4;
          P.push(part(new THREE.SphereGeometry(3, 16, 8, 0, PI * 2, 0, PI / 2), 0xd8dce6, bx, y0, bz), part(cyl(3.05, 3.05, 0.4, 16), 0x9aa0b0, bx, y0 + 0.2, bz));
          P.push(part(cyl(0.08, 0.08, 4, 6), 0xd8dce6, s.W + 4, y0 + 2, -3), part(new THREE.SphereGeometry(0.9, 12, 6, 0, PI * 2, 0, PI / 2), 0xd8dce6, s.W + 4, y0 + 4.2, -3, PI * 0.75));
        }
        const earth = new THREE.Mesh(new THREE.IcosahedronGeometry(7, 2), new THREE.MeshLambertMaterial({ color: 0x2a6ad8, emissive: 0x0a1a4a, fog: false }));
        earth.position.set(s.W / 2 + 34, 26, -70);
        const land = new THREE.Mesh(merge([part(ico(3.2, 1), 0x3aa85a, -2, 2.6, 5.3), part(ico(2.4, 1), 0x3aa85a, 3, -1.5, 5.6), part(ico(2.6, 1), 0xffffff, 0, 6.4, 1.5, 0, 0, 0, 1.2, 0.5, 1)]), new THREE.MeshLambertMaterial({ vertexColors: true, fog: false }));
        land.position.copy(earth.position);
        this.group.add(earth, land);
        const pts = new Float32Array(700 * 3);
        const r2 = lcg(99);
        for (let k = 0; k < 700; k++) {
          const a = r2() * PI * 2;
          const e = r2() * 0.9 + 0.05;
          pts[k * 3] = s.W / 2 + Math.cos(a) * Math.cos(e) * 150;
          pts[k * 3 + 1] = Math.sin(e) * 150;
          pts[k * 3 + 2] = s.H / 2 + Math.sin(a) * Math.cos(e) * 150;
        }
        const sg = new THREE.BufferGeometry();
        sg.setAttribute('position', new THREE.BufferAttribute(pts, 3));
        this.group.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false })));
        break;
      }
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
    const hy = s.heightAt(this.shown.x, this.shown.z);
    const y = BALL_R + b.y + hy;
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
    this.ballShadow.position.set(this.shown.x + 0.04, 0.004 + hy, this.shown.z + 0.05);
    this.ballShadow.visible = b.y > -0.05 && !inCup;
    // trail when it flies (the ball's own colour; the comet always burns)
    if ((sp > 6 || (this.comet && sp > 1.5)) && this.tier !== 'low') {
      this.trailT += dt * sp;
      const [r, g, bl] = this.trailRGB;
      while (this.trailT > 0.45) {
        this.trailT -= 0.45;
        this.sparks.add({ x: b.x, y: BALL_R + b.y, z: b.z, life: this.comet ? 0.5 : 0.35, s0: this.comet ? 0.24 : 0.17, s1: 0.02, r, g, b: bl, a: 0.6 });
      }
    }
    // ---- flag: waves in the wind, pops up (with a spin) when the ball drops ----
    const want = s.state === 'sunk' || s.state === 'done' ? (s.result && !s.result.maxed ? 1 : s.state === 'sunk' ? 1 : 0) : 0;
    this.flagUp += (want - this.flagUp) * Math.min(1, dt * 7);
    this.flag.position.y = this.cupY + this.flagUp * 0.9 + Math.sin(this.flagUp * PI) * 0.25;
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
    s.mills.forEach((m, k) => (this.sails[k].rotation.z = s.millAngle(m, s.time)));
    s.movers.forEach((m, k) => {
      const p = s.moverPos(m, s.time);
      this.movers[k].position.set(p.x, 0, p.z);
    });
    s.bumpers.forEach((p, k) => {
      const u = Math.max(0, 1 - (s.time - p.hit) / 0.3);
      const w = Math.sin(u * PI * 3) * u;
      this.bumpers[k].scale.set(1 + w * 0.22, 1 - w * 0.18, 1 + w * 0.22);
    });
    // ---- the new courses' moving parts ----
    if (this.tideMesh) {
      const up = s.def.tide?.up ?? 0.45;
      const u = s.cycle(1, s.time);
      // full while the tide is in; it starts creeping up just before (a warning), and drains at the end
      const L = u < up ? (u > up - 0.05 ? (up - u) / 0.05 : 1) : u > 0.9 ? ((u - 0.9) / 0.1) * 0.8 : 0;
      this.tideMesh.position.y = -0.05 + L * 0.08;
      (this.tideMesh.material as THREE.MeshLambertMaterial).opacity = L * 0.88;
      this.tideTex!.offset.set(time * 0.05, time * 0.03);
    }
    if (this.bridge) {
      const target = s.floodUp(2, s.time) ? 1 : 0;
      this.bridgeL += (target - this.bridgeL) * Math.min(1, dt * 7);
      this.bridge.position.y = this.bridgeL * 0.85;
    }
    for (const gt of this.gates) {
      const target = s.gateDown(gt.kind, s.time) ? 0 : 0.95;
      gt.y += (target - gt.y) * Math.min(1, dt * 16);
      gt.g.position.y = gt.y;
    }
    if (this.boostMat) this.boostMat.opacity = 0.22 + Math.sin(time * 7) * 0.12;
    for (const d of this.portalDiscs) d.rotation.z -= dt * 3;
    for (const w of this.wellParts) {
      w.ring.rotation.z += dt * 2.5;
      w.pull.forEach((rg, k) => {
        const u = 1 - ((time * 0.45 + k / 3) % 1);
        rg.scale.setScalar(0.6 + u * 2);
        (rg.material as THREE.MeshBasicMaterial).opacity = 0.32 * (1 - u) * u * 4 * 0.5;
      });
    }
    this.coinMeshes.forEach((m, k) => {
      m.visible = !s.coinsGot.includes(k);
      m.rotation.y = time * 2.4 + k;
      m.position.y = 0.32 + Math.sin(time * 3 + k) * 0.05 + this.coinY[k];
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
        const c = this.lavaCells[Math.floor(Math.random() * this.lavaCells.length)];
        if (c) this.sparks.add({ x: c.x + Math.random() - 0.5, y: 0.1, z: c.z + Math.random() - 0.5, vy: 1 + Math.random(), life: 1.2, s0: 0.1, s1: 0.03, r: 1, g: 0.55, b: 0.2 });
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
    this.putter.position.set(ox - dx * back, s.heightAt(ox - dx * back, oz - dz * back), oz - dz * back);
    // the face looks along the putt; the shaft leans back towards the player
    this.putter.rotation.y = -angle;
    this.putterHead.rotation.z = this.swing >= 0 ? -0.15 : Math.min(0.5, pull * 0.35);
    this.putter.scale.setScalar(1.35 * Math.max(0.05, this.swing >= 0 ? alpha : this.putterFade));
  }
  private swingFrom = { x: 0, z: 0 };
  private cupY = 0;

  private updateAim(time: number) {
    const s = this.sim;
    const a = this.aim;
    const rm = this.ring.material as THREE.MeshBasicMaterial;
    this.ring.position.set(s.ball.x, 0.01 + s.heightAt(s.ball.x, s.ball.z), s.ball.z);
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
    const pts = s.previewPath(a.angle, p, (2.5 + p * 7.5) * this.aimLen, this.aimBounces);
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
      const dx2 = pts[j - 1].x + (pts[j].x - pts[j - 1].x) * u;
      const dz2 = pts[j - 1].z + (pts[j].z - pts[j - 1].z) * u;
      dot.position.set(dx2, 0.07 + s.heightAt(dx2, dz2), dz2);
      dot.scale.setScalar(1 - (d / total) * 0.45);
      this.dotMats[k].color.copy(col);
      this.dotMats[k].opacity = (idle ? 0.45 : 0.95) * (1 - (d / total) * 0.6);
    }
    const last = pts[pts.length - 1];
    this.ghost.visible = !idle && pts.length > 1;
    this.ghost.position.set(last.x, 0.02 + s.heightAt(last.x, last.z), last.z);
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
      case 'flood':
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
      case 'portal': {
        const c = new THREE.Color((ev.n ?? 0) < 2 ? (this.theme.glow ?? 0x36e0ff) : 0xff8a3a);
        this.burst(x, 0.15, z, 12, c.r, c.g, c.b, 2, 0.4);
        const o = s.portals[(ev.n ?? 0) ^ 1];
        if (o) this.burst(o.x, 0.15, o.z, 12, c.r, c.g, c.b, 2, 0.4);
        // (the ball jumps straight to the other tunnel: no sliding across the hole)
        this.shown.x = s.ball.x;
        this.shown.z = s.ball.z;
        break;
      }
      case 'boost': {
        const c = new THREE.Color(this.theme.glow ?? 0x36e0ff);
        this.burst(x, 0.1, z, 10, c.r, c.g, c.b, 2.5, 0.35);
        this.squash = 0.6;
        this.squashDir = Math.atan2(s.ball.vz, s.ball.vx);
        break;
      }
      case 'jump':
        for (let k = 0; k < 8; k++) this.puffs.add({ x, y: 0.1, z, vy: 0.6, vx: (Math.random() - 0.5) * 1.2, vz: (Math.random() - 0.5) * 1.2, life: 0.5, s0: 0.12, s1: 0.35, r: 0.95, g: 0.85, b: 0.7, a: 0.5, drag: 2 });
        break;
      case 'land':
        for (let k = 0; k < 10; k++) this.puffs.add({ x, y: 0.05, z, vy: 0.5, vx: (Math.random() - 0.5) * 1.6, vz: (Math.random() - 0.5) * 1.6, life: 0.5, s0: 0.1, s1: 0.35, r: 0.95, g: 0.9, b: 0.8, a: 0.5, drag: 2 });
        this.squash = 1;
        this.squashDir = Math.atan2(s.ball.vz, s.ball.vx);
        this.shake = Math.max(this.shake, 0.08);
        break;
      case 'coin':
        this.burst(x, 0.35, z, 16, 1, 0.82, 0.25, 2.2, 0.5);
        break;
      case 'mill':
        this.burst(x, 0.3, z, 8, 1, 0.95, 0.85, 2, 0.35);
        this.squash = 0.8;
        this.squashDir = Math.atan2(s.ball.vz, s.ball.vx);
        break;
      case 'loop':
        if (ev.n) this.shake = Math.max(this.shake, 0.05);
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
    this.lavaMaskTex?.dispose();
    this.tideTex?.dispose();
    this.swirlTex?.dispose();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }
}
