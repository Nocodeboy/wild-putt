import * as THREE from 'three';
import type { Sim } from '../sim/world';
import type { ThemeId } from '../sim/types';
import { nightOf, THEMES, type Theme } from './themes';
import { LevelView } from './view';

/** Rendering tiers. `auto` picks one of these at runtime from the measured frame rate. */
export type Tier = 'high' | 'medium' | 'low';

/** chase: behind the ball, looking down the hole · overview: the whole hole from above */
export type CamMode = 'chase' | 'overview';

const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const OVERVIEW_PITCH = (62 * Math.PI) / 180;
const CHASE_PITCH = (47 * Math.PI) / 180;

interface Pose {
  x: number;
  z: number;
  yaw: number; // direction the camera looks along the ground
  pitch: number;
  dist: number;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const ease = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.3, 320);
  private sun = new THREE.DirectionalLight(0xffffff, 2);
  private hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  private sky: THREE.Mesh;
  view: LevelView | null = null;
  sim: Sim | null = null;
  theme: Theme = THEMES.garden;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private tmpV = new THREE.Vector3();
  private tmpN = new THREE.Vector2();
  private sunDir = new THREE.Vector3();
  tier: Tier = 'high';
  pxScale = 400;
  zoom = 1;
  zoomTarget = 1;
  /** When set, the camera frames this point (the cup when the ball drops, menus). */
  focus: { x: number; z: number } | null = null;
  readonly reducedMotion = REDUCED;
  private cssW = 1;
  private cssH = 1;
  private vf = 0.7;
  private hf = 0.7;
  // ---- camera state ----
  mode: CamMode = 'chase';
  private ov = 0; // 0 chase … 1 overview (smoothed)
  /** the yaw the chase camera wants (set by the game: along the path to the cup, or along the aim) */
  yawTarget = -Math.PI / 2;
  /** current chase yaw: the slingshot maps the screen to the world with it */
  yaw = -Math.PI / 2;
  /** while the player pulls the slingshot the camera must not turn */
  lockYaw = false;
  private chase: Pose = { x: 0, z: 0, yaw: -Math.PI / 2, pitch: CHASE_PITCH, dist: 10 };
  private introT = 1;
  private introDur = 1;
  private introFrom: Pose | null = null;
  private cur: Pose = { x: 0, z: 0, yaw: -Math.PI / 2, pitch: CHASE_PITCH, dist: 10 };

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // keeps bright greens and white walls from clipping to flat white
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.near = 1;
    sc.far = 90;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target, this.hemi);
    // sky dome with a vertical gradient (top colour → horizon fog colour)
    const sg = new THREE.SphereGeometry(280, 24, 12);
    this.sky = new THREE.Mesh(
      sg,
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } },
        vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying float h; void main(){ float k = smoothstep(-0.05, 0.6, h); gl_FragColor = vec4(mix(bottom, top, k), 1.0); }',
      }),
    );
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);
    this.resize();
  }

  setTier(t: Tier) {
    const changedShadows = (t === 'low') !== (this.tier === 'low');
    this.tier = t;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(Math.min(dpr, t === 'high' ? 2 : t === 'medium' ? 1.35 : 1));
    const shadows = t !== 'low';
    this.renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    const size = t === 'high' ? 2048 : 1024;
    this.sun.shadow.mapSize.set(size, size);
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
    if (changedShadows) {
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
        else if (m) m.needsUpdate = true;
      });
    }
    this.view?.setTier(t);
    this.resize();
  }

  setLevel(sim: Sim, themeId: ThemeId, night = false) {
    if (this.view) {
      this.scene.remove(this.view.group);
      this.view.dispose();
    }
    this.sim = sim;
    let t = THEMES[themeId];
    if (night) t = nightOf(t);
    this.theme = t;
    this.sunDir.set(...t.sunDir).normalize();
    this.scene.background = new THREE.Color(t.fog);
    this.scene.fog = new THREE.Fog(t.fog, t.fogNear, t.fogFar);
    const sm = this.sky.material as THREE.ShaderMaterial;
    sm.uniforms.top.value.setHex(t.sky);
    sm.uniforms.bottom.value.setHex(t.fog);
    this.sun.color.setHex(t.sun);
    this.sun.intensity = t.sunI;
    this.hemi.color.setHex(t.hemiSky);
    this.hemi.groundColor.setHex(t.hemiGround);
    this.hemi.intensity = t.hemiI;
    this.view = new LevelView(sim, t, this.tier);
    this.scene.add(this.view.group);
    this.focus = null;
    this.zoom = this.zoomTarget = 1;
    this.yaw = this.yawTarget = sim.guideAngle(sim.ball.x, sim.ball.z);
    this.introT = this.introDur = 1;
    this.introFrom = null;
    this.chase = this.chasePose(0, true);
    this.cur = this.blendPose();
    this.apply(this.cur);
  }

  /** Fly from above the flag down to behind the ball (start of a hole). */
  intro(duration = 1.8) {
    const s = this.sim;
    if (!s || REDUCED) return;
    const toCup = Math.atan2(s.cup.z - s.ball.z, s.cup.x - s.ball.x);
    this.introFrom = { x: s.cup.x, z: s.cup.z, yaw: toCup, pitch: (64 * Math.PI) / 180, dist: 8 };
    this.introT = 0;
    this.introDur = duration;
  }
  /** Jump to the end of the intro flyover (the player touched the screen). */
  skipIntro() {
    this.introT = this.introDur;
  }
  get introRunning(): boolean {
    return this.introT < this.introDur;
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.cssW = w;
    this.cssH = h;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    this.camera.fov = aspect < 1 ? 58 : 44;
    this.camera.updateProjectionMatrix();
    this.vf = (this.camera.fov * Math.PI) / 180;
    this.hf = 2 * Math.atan(Math.tan(this.vf / 2) * aspect);
    const bufH = this.renderer.getDrawingBufferSize(this.tmpN).y;
    this.pxScale = (bufH * 0.5) / Math.tan(this.vf / 2);
  }

  /** The whole hole from above, screen up = up the hole (−z). */
  private overviewPose(): Pose {
    const s = this.sim!;
    const W = s.W + 1.5;
    const H = s.H + 3;
    const byW = W / 2 / Math.tan(this.hf / 2);
    const byH = (H * Math.sin(OVERVIEW_PITCH)) / 2 / Math.tan(this.vf / 2);
    return { x: s.W / 2, z: s.H / 2 - 0.4, yaw: -Math.PI / 2, pitch: OVERVIEW_PITCH, dist: Math.min(40, Math.max(byW, byH)) };
  }

  /** Behind the ball, looking a few cells ahead of it; follows the ball while it rolls. */
  private chasePose(dt: number, snap = false): Pose {
    const s = this.sim!;
    const b = s.ball;
    const portrait = this.camera.aspect < 1;
    if (!this.lockYaw) {
      const k = snap ? 1 : 1 - Math.exp(-3.2 * dt);
      this.yaw += wrap(this.yawTarget - this.yaw) * k;
    }
    const f = { x: Math.cos(this.yaw), z: Math.sin(this.yaw) };
    const rolling = s.state === 'roll' || s.state === 'drop';
    const ahead = rolling ? 1.2 : portrait ? 3.4 : 2.6;
    let tx = b.x + f.x * ahead;
    let tz = b.z + f.z * ahead;
    if (this.focus) {
      tx = this.focus.x;
      tz = this.focus.z;
    }
    const dist = (portrait ? 11 : 9.5) * (rolling ? 1.08 : 1);
    const p = this.chase;
    const kp = snap ? 1 : 1 - Math.exp(-(rolling ? 4 : 3) * dt);
    return { x: p.x + (tx - p.x) * kp, z: p.z + (tz - p.z) * kp, yaw: this.yaw, pitch: CHASE_PITCH, dist: p.dist + (dist - p.dist) * kp };
  }

  private blendPose(): Pose {
    const a = this.chase;
    const b = this.overviewPose();
    const k = ease(this.ov);
    const pose: Pose = {
      x: a.x + (b.x - a.x) * k,
      z: a.z + (b.z - a.z) * k,
      yaw: a.yaw + wrap(b.yaw - a.yaw) * k,
      pitch: a.pitch + (b.pitch - a.pitch) * k,
      dist: a.dist + (b.dist - a.dist) * k,
    };
    if (this.introFrom && this.introT < this.introDur) {
      const u = ease(this.introT / this.introDur);
      const f = this.introFrom;
      return { x: f.x + (pose.x - f.x) * u, z: f.z + (pose.z - f.z) * u, yaw: f.yaw + wrap(pose.yaw - f.yaw) * u, pitch: f.pitch + (pose.pitch - f.pitch) * u, dist: f.dist + (pose.dist - f.dist) * u };
    }
    return pose;
  }

  private apply(p: Pose) {
    const d = p.dist * this.zoom;
    const shake = this.view && !REDUCED ? this.view.shake : 0;
    const sx = (Math.random() - 0.5) * shake * 0.5;
    const sz = (Math.random() - 0.5) * shake * 0.5;
    const back = Math.cos(p.pitch) * d;
    this.camera.position.set(p.x - Math.cos(p.yaw) * back + sx, Math.sin(p.pitch) * d, p.z - Math.sin(p.yaw) * back + sz);
    this.camera.lookAt(p.x + sx, 0, p.z + sz);
    this.sky.position.copy(this.camera.position);
    // shadow box around what the camera looks at
    const ext = Math.min(28, 6 + d * 0.9);
    const sc = this.sun.shadow.camera;
    if (sc.right !== ext) {
      sc.left = -ext;
      sc.right = ext;
      sc.top = ext;
      sc.bottom = -ext;
      sc.updateProjectionMatrix();
    }
    const texel = (ext * 2) / this.sun.shadow.mapSize.x;
    const bx = Math.round(p.x / texel) * texel;
    const bz = Math.round(p.z / texel) * texel;
    const sd = this.sunDir;
    this.sun.position.set(bx + sd.x * 40, sd.y * 40, bz + sd.z * 40);
    this.sun.target.position.set(bx, 0, bz);
  }

  frame(dt: number, time: number) {
    if (!this.sim || !this.view) return;
    this.ov += ((this.mode === 'overview' ? 1 : 0) - this.ov) * (1 - Math.exp(-5 * dt));
    if (this.introT < this.introDur) this.introT += dt;
    this.zoom += (this.zoomTarget - this.zoom) * (1 - Math.exp(-2.6 * dt));
    this.chase = this.chasePose(dt);
    this.cur = this.blendPose();
    this.apply(this.cur);
    this.view.camYaw = this.mode === 'overview' ? -Math.PI / 2 : this.yaw;
    this.view.update(dt, time, this.pxScale);
    this.hemi.intensity = this.theme.hemiI + this.view.flash * 2.5;
    this.renderer.render(this.scene, this.camera);
  }

  /** Yaw used to turn screen drags into world directions right now. */
  get controlYaw(): number {
    return this.mode === 'overview' ? -Math.PI / 2 : this.yaw;
  }

  /** World -> CSS pixel position (allocation-free result object is reused: copy what you need). */
  private sp = { x: 0, y: 0, on: false };
  toScreen(x: number, y: number, z: number): { x: number; y: number; on: boolean } {
    const v = this.tmpV.set(x, y, z).project(this.camera);
    const o = this.sp;
    o.x = (v.x * 0.5 + 0.5) * this.cssW;
    o.y = (-v.y * 0.5 + 0.5) * this.cssH;
    o.on = v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
    return o;
  }

  /** CSS pixel -> ground point (y = 0). */
  toGround(cx: number, cy: number): { x: number; z: number } | null {
    const r = this.canvas.getBoundingClientRect();
    this.tmpN.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.tmpN, this.camera);
    if (!this.ray.ray.intersectPlane(this.plane, this.tmpV)) return null;
    return { x: this.tmpV.x, z: this.tmpV.z };
  }
}
