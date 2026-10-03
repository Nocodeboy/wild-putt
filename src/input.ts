// One-thumb slingshot.
//   Touch / mouse: put your thumb down anywhere and pull back. The putt goes the opposite way (relative to the
//   camera); the further you pull, the harder. The pad shows the power; pulling back to the middle shows ✕ and
//   letting go there cancels. A right click or Esc also cancels.
//   Keyboard: left/right (A/D) turn the aim, hold Space (or W/↑) to swing the power up and down, let go to putt.

import { vibrate } from './audio';

const DEAD_PX = 22; // inside this the pull is "cancel"

/** A putt in screen terms (dx, dy: unit direction of travel on screen) or already in world terms. */
export type Shot = { kind: 'screen'; dx: number; dy: number; power: number } | { kind: 'world'; angle: number; power: number };

export class Input {
  mode: 'touch' | 'mouse' = 'ontouchstart' in window ? 'touch' : 'mouse';
  enabled = false;
  vibration = true;
  onPause: () => void = () => undefined;
  onCamera: () => void = () => undefined;
  /** Live aim while pulling or charging; null when idle. */
  aim: Shot | null = null;
  private shot: Shot | null = null;
  private p: { id: number; ox: number; oy: number; x: number; y: number } | null = null;
  private keys = new Set<string>();
  private kbAngle = -Math.PI / 2;
  private kbT = 0;
  private kbCharging = false;
  private lastStep = 0;
  usedAim = false;
  usedShot = false;
  /** px of pull for a full-power putt (set from the screen size) */
  fullPx = 180;

  constructor(
    private layer: HTMLElement,
    private pad: HTMLElement,
  ) {
    pad.innerHTML = '<i></i><b class="pw"><s></s></b><em class="pct"></em>';
    layer.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e), { passive: false });
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e, true));
    layer.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.cancel();
    });
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (!e.repeat) this.keys.add(k);
      if (!this.enabled) return;
      if (k === 'escape') {
        if (this.p || this.kbCharging) this.cancel();
        else this.onPause();
      }
      if (k === 'p') this.onPause();
      if (k === 'c' && !e.repeat) this.onCamera();
      if (k === ' ' || k.startsWith('arrow')) e.preventDefault();
      if ((k === ' ' || k === 'w' || k === 'arrowup') && !e.repeat && !this.p) {
        this.kbCharging = true;
        this.kbT = 0;
      }
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      if ((k === ' ' || k === 'w' || k === 'arrowup') && this.kbCharging && this.enabled) {
        this.kbCharging = false;
        if (this.aim && this.aim.power > 0.03) {
          this.shot = { ...this.aim };
          this.usedShot = true;
        }
        this.aim = null;
      }
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.cancel();
    });
    const fit = () => (this.fullPx = Math.max(120, Math.min(240, Math.min(window.innerWidth, window.innerHeight) * 0.34)));
    fit();
    window.addEventListener('resize', fit);
  }

  /** True while a thumb is pulling (the camera must not turn). */
  get dragging(): boolean {
    return !!this.p;
  }

  reset() {
    this.p = null;
    this.aim = null;
    this.shot = null;
    this.kbCharging = false;
    this.render();
  }
  cancel() {
    this.p = null;
    this.aim = null;
    this.kbCharging = false;
    this.render();
  }

  private down(e: PointerEvent) {
    if (!this.enabled || this.p) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.mode = e.pointerType === 'mouse' ? 'mouse' : 'touch';
    if (e.cancelable) e.preventDefault();
    this.p = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
    this.lastStep = 0;
    this.update();
    this.render();
  }
  private move(e: PointerEvent) {
    const p = this.p;
    if (!p || p.id !== e.pointerId) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (e.cancelable) e.preventDefault();
    this.update();
    this.render();
  }
  private up(e: PointerEvent, cancelled = false) {
    const p = this.p;
    if (!p || p.id !== e.pointerId) return;
    this.update();
    if (!cancelled && this.enabled && this.aim && this.aim.power > 0) {
      this.shot = { ...this.aim };
      this.usedShot = true;
    }
    this.p = null;
    this.aim = null;
    this.render();
  }

  private update() {
    const p = this.p;
    if (!p) return;
    const dx = p.x - p.ox;
    const dy = p.y - p.oy;
    const d = Math.hypot(dx, dy);
    if (d < DEAD_PX) {
      this.aim = this.aim && this.aim.kind === 'screen' ? { ...this.aim, power: 0 } : { kind: 'screen', dx: 0, dy: -1, power: 0 };
      return;
    }
    this.usedAim = true;
    // a gentle curve: fine control at low power, full power still reachable
    const u = Math.min(1, (d - DEAD_PX) / this.fullPx);
    const power = Math.max(0.03, Math.pow(u, 1.15));
    this.aim = { kind: 'screen', dx: -dx / d, dy: -dy / d, power };
    // a tick every 25 % of power (phones that support it)
    const step = Math.floor(power * 4.0001);
    if (step !== this.lastStep) {
      if (this.vibration && step > this.lastStep) vibrate(step >= 4 ? 18 : 6);
      this.lastStep = step;
    }
  }

  private render() {
    const p = this.p;
    if (!p) {
      this.pad.classList.remove('on');
      return;
    }
    const a = this.aim;
    const cancel = !a || a.power <= 0;
    this.pad.classList.add('on');
    this.pad.classList.toggle('cancel', cancel);
    this.pad.style.transform = `translate(${p.ox}px, ${p.oy}px)`;
    const knob = this.pad.firstElementChild as HTMLElement;
    let dx = p.x - p.ox;
    let dy = p.y - p.oy;
    const d = Math.hypot(dx, dy);
    const max = 46;
    if (d > max) {
      dx = (dx / d) * max;
      dy = (dy / d) * max;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const pw = Math.round((a?.power ?? 0) * 100);
    (this.pad.querySelector('.pw s') as HTMLElement).style.height = `${pw}%`;
    this.pad.style.setProperty('--pw', String(a?.power ?? 0));
    (this.pad.querySelector('.pct') as HTMLElement).textContent = cancel ? '✕' : `${pw}%`;
  }

  /** The putt the player just released, once. */
  takeShot(): Shot | null {
    const s = this.shot;
    this.shot = null;
    return s;
  }

  /** Keyboard aiming; call every frame. Returns true while the keyboard is driving the aim. */
  poll(dt: number, defaultAngle: number): boolean {
    if (this.p || !this.enabled) return false;
    const k = this.keys;
    let turn = 0;
    if (k.has('arrowleft') || k.has('a')) turn -= 1;
    if (k.has('arrowright') || k.has('d')) turn += 1;
    if (!turn && !this.kbCharging) return this.aim?.kind === 'world';
    if (!this.aim || this.aim.kind !== 'world') this.kbAngle = defaultAngle;
    this.usedAim = true;
    this.kbAngle += turn * dt * (k.has('shift') ? 0.3 : 1.2);
    let power = this.aim?.power ?? 0;
    if (this.kbCharging) {
      // the power swings 0 → 1 → 0 every 2 s while the key is held
      this.kbT += dt;
      const u = this.kbT % 2;
      power = u < 1 ? u : 2 - u;
    }
    this.aim = { kind: 'world', angle: this.kbAngle, power };
    return true;
  }
  /** Forget the keyboard aim (new stroke). */
  resetAim() {
    if (!this.p && !this.kbCharging) this.aim = null;
    this.usedAim = false;
  }
}

/** Screen-space direction → world angle, given the camera yaw (direction the camera looks along the ground). */
export function screenToWorld(dx: number, dy: number, yaw: number): number {
  // screen up = forward f = (cos yaw, sin yaw); screen right = r = (−sin yaw, cos yaw)
  const fx = Math.cos(yaw);
  const fz = Math.sin(yaw);
  const rx = -fz;
  const rz = fx;
  const wx = rx * dx + fx * -dy;
  const wz = rz * dx + fz * -dy;
  return Math.atan2(wz, wx);
}
