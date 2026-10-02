// One-thumb slingshot.
//   Touch / mouse: put your thumb down anywhere and pull back. The putt goes the opposite way; the further you pull,
//   the harder. Let go to putt. Drag back to where you started (or press Esc / right click) to cancel.
//   Keyboard: left/right arrows (A/D) turn the aim, hold Space to set the power (it swings up and down), let go to putt.

const CANCEL_PX = 18;

export interface Shot {
  angle: number;
  power: number;
}

export class Input {
  mode: 'touch' | 'mouse' = 'ontouchstart' in window ? 'touch' : 'mouse';
  enabled = false;
  onPause: () => void = () => undefined;
  /** Live aim while pulling (or charging with the keyboard); null when idle. */
  aim: Shot | null = null;
  /** Set once when the player lets go; main.ts takes it. */
  private shot: Shot | null = null;
  private p: { id: number; ox: number; oy: number; x: number; y: number } | null = null;
  private keys = new Set<string>();
  private kbAngle = -Math.PI / 2;
  private kbT = 0;
  private kbCharging = false;
  /** world-space putt angle = screen drag angle + this (the camera looks straight up the screen) */
  usedAim = false;
  usedShot = false;
  /** px of pull for a full-power putt (set from the screen size) */
  fullPx = 180;

  constructor(
    private layer: HTMLElement,
    private pad: HTMLElement,
  ) {
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
      if (k === ' ' || k.startsWith('arrow')) e.preventDefault();
      if (k === ' ' && !e.repeat && !this.p) {
        this.kbCharging = true;
        this.kbT = 0;
      }
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      if (k === ' ' && this.kbCharging && this.enabled) {
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
    const fit = () => (this.fullPx = Math.max(120, Math.min(260, Math.min(window.innerWidth, window.innerHeight) * 0.36)));
    fit();
    window.addEventListener('resize', fit);
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
    if (d < CANCEL_PX) {
      this.aim = { angle: this.aim?.angle ?? -Math.PI / 2, power: 0 };
      return;
    }
    this.usedAim = true;
    // pulling down-screen putts up-screen: screen x → world x, screen y → world z
    this.aim = { angle: Math.atan2(-dy, -dx), power: Math.min(1, (d - CANCEL_PX) / this.fullPx) };
  }

  private render() {
    const p = this.p;
    if (!p) {
      this.pad.classList.remove('on');
      return;
    }
    this.pad.classList.add('on');
    this.pad.classList.toggle('cancel', !this.aim || this.aim.power <= 0);
    this.pad.style.transform = `translate(${p.ox}px, ${p.oy}px)`;
    const knob = this.pad.firstElementChild as HTMLElement;
    let dx = p.x - p.ox;
    let dy = p.y - p.oy;
    const d = Math.hypot(dx, dy);
    const max = this.fullPx * 0.45;
    if (d > max) {
      dx = (dx / d) * max;
      dy = (dy / d) * max;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  /** The putt the player just released, once. */
  takeShot(): Shot | null {
    const s = this.shot;
    this.shot = null;
    return s;
  }

  /** Keyboard aiming; call every frame with dt. `defaultAngle` points at the cup when nothing is aimed yet. */
  poll(dt: number, defaultAngle: number) {
    if (this.p || !this.enabled) return;
    const k = this.keys;
    let turn = 0;
    if (k.has('arrowleft') || k.has('a')) turn -= 1;
    if (k.has('arrowright') || k.has('d')) turn += 1;
    if (turn && !this.aim) this.kbAngle = this.aim ? this.kbAngle : this.kbAngle;
    if (turn || this.kbCharging) {
      if (!this.aim) this.kbAngle = this.usedAim ? this.kbAngle : defaultAngle;
      this.usedAim = true;
      this.kbAngle += turn * dt * (k.has('shift') ? 0.35 : 1.4);
      let power = this.aim?.power ?? 0;
      if (this.kbCharging) {
        // the power swings 0 → 1 → 0 every 2 s while Space is held
        this.kbT += dt;
        const u = (this.kbT / 1.0) % 2;
        power = u < 1 ? u : 2 - u;
      }
      this.aim = { angle: this.kbAngle, power };
    }
  }
  /** Point the keyboard aim at the cup for a new stroke. */
  resetKeyboardAim(angle: number) {
    this.kbAngle = angle;
    if (!this.p && !this.kbCharging) this.aim = null;
    this.usedAim = false;
  }
}
