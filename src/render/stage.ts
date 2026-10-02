import * as THREE from 'three';
import type { Sim } from '../sim/world';
import type { ThemeId } from '../sim/types';
import { nightOf, THEMES, type Theme } from './themes';
import { LevelView } from './view';

/** Rendering tiers. `auto` picks one of these at runtime from the measured frame rate. */
export type Tier = 'high' | 'medium' | 'low';

const PITCH = (60 * Math.PI) / 180;
const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.5, 260);
  private sun = new THREE.DirectionalLight(0xffffff, 2);
  private hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  view: LevelView | null = null;
  sim: Sim | null = null;
  theme: Theme = THEMES.garden;
  private target = new THREE.Vector3();
  private dist = 30;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private tmpV = new THREE.Vector3();
  private tmpN = new THREE.Vector2();
  private sunDir = new THREE.Vector3();
  tier: Tier = 'high';
  pxScale = 400;
  zoom = 1;
  zoomTarget = 1;
  /** When set, the camera frames this point instead of the rider (level intro, the camp at the end). */
  focus: { x: number; z: number } | null = null;
  readonly reducedMotion = REDUCED;
  private cssW = 1;
  private cssH = 1;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.near = 1;
    sc.far = 90;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 2.5;
    this.scene.add(this.sun, this.sun.target, this.hemi);
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
      // shadow on/off changes shader defines: force recompilation
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
    this.scene.background = new THREE.Color(t.sky);
    this.scene.fog = new THREE.Fog(t.fog, t.fogNear, t.fogFar);
    this.sun.color.setHex(t.sun);
    this.sun.intensity = t.sunI;
    this.hemi.color.setHex(t.hemiSky);
    this.hemi.groundColor.setHex(t.hemiGround);
    this.hemi.intensity = t.hemiI;
    this.view = new LevelView(sim, t, this.tier);
    this.scene.add(this.view.group);
    this.focus = null;
    this.zoom = this.zoomTarget = 1;
    this.fit();
    const c = this.desired();
    this.target.set(c.x, 0, c.z);
    this.placeCamera(0, true);
  }

  private vf = 0.7;
  private hf = 0.7;
  private fitDist = 20;
  private follow = false;

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.cssW = w;
    this.cssH = h;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    this.camera.fov = aspect < 1 ? 46 : 36;
    this.camera.updateProjectionMatrix();
    this.vf = (this.camera.fov * Math.PI) / 180;
    this.hf = 2 * Math.atan(Math.tan(this.vf / 2) * aspect);
    const bufH = this.renderer.getDrawingBufferSize(this.tmpN).y;
    this.pxScale = (bufH * 0.5) / Math.tan(this.vf / 2);
    this.fit();
  }

  /** Camera distance that shows the whole hole; holes too big for the screen follow the ball instead. */
  private fit() {
    const s = this.sim;
    const W = s ? s.W + 1.5 : 12;
    const H = s ? s.H + 2.5 : 16; // room for the HUD on top
    const byW = W / 2 / Math.tan(this.hf / 2);
    const byH = (H * Math.sin(PITCH)) / 2 / Math.tan(this.vf / 2);
    const need = Math.max(byW, byH);
    const max = 30;
    this.fitDist = Math.min(need, max);
    this.follow = need > max;
    const ext = Math.max(W, H) * 0.75 + 4;
    const sc = this.sun.shadow.camera;
    sc.left = -ext;
    sc.right = ext;
    sc.top = ext;
    sc.bottom = -ext;
    sc.updateProjectionMatrix();
  }

  /** Point the camera looks at: the middle of the hole (a bit towards the ball on big holes). */
  private desired(): { x: number; z: number } {
    const s = this.sim!;
    if (this.focus) return this.focus;
    const cx = s.W / 2;
    const cz = s.H / 2 - 0.6;
    if (!this.follow) return { x: cx, z: cz };
    const b = s.ball;
    return { x: cx * 0.5 + b.x * 0.5, z: cz * 0.35 + b.z * 0.65 };
  }

  private placeCamera(dt: number, snap = false) {
    const s = this.sim;
    if (!s) return;
    const d0 = this.desired();
    const k = snap ? 1 : 1 - Math.exp(-(this.focus ? 2.4 : 3) * dt);
    this.target.x += (d0.x - this.target.x) * k;
    this.target.z += (d0.z - this.target.z) * k;
    this.zoom += (this.zoomTarget - this.zoom) * (snap ? 1 : 1 - Math.exp(-2.6 * dt));
    const d = this.fitDist * this.zoom;
    const shake = this.view && !REDUCED ? this.view.shake : 0;
    const sx = (Math.random() - 0.5) * shake * 0.6;
    const sz = (Math.random() - 0.5) * shake * 0.6;
    this.camera.position.set(this.target.x + sx, Math.sin(PITCH) * d, this.target.z + Math.cos(PITCH) * d + sz);
    this.camera.lookAt(this.target.x + sx, 0, this.target.z + sz);
    const texel = (this.sun.shadow.camera.right * 2) / this.sun.shadow.mapSize.x;
    const bx = Math.round(this.target.x / texel) * texel;
    const bz = Math.round(this.target.z / texel) * texel;
    const sd = this.sunDir;
    this.sun.position.set(bx + sd.x * 40, sd.y * 40, bz + sd.z * 40);
    this.sun.target.position.set(bx, 0, bz);
  }

  frame(dt: number, time: number) {
    if (!this.sim || !this.view) return;
    this.placeCamera(dt);
    this.view.update(dt, time, this.pxScale);
    this.hemi.intensity = this.theme.hemiI + this.view.flash * 2.5;
    this.renderer.render(this.scene, this.camera);
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
