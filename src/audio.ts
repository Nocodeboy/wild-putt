// Sound effects are synthesised live with WebAudio (no licences, ~0 KB).
// Music is played from audio files when available (see setMusicTracks).

type Mode = 'menu' | 'game' | 'none';

export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private musicGain!: GainNode;
  private noise!: AudioBuffer;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private birdT = 0; // next ambient sound (bird, gull, fair tune…)
  sfxOn = true;
  musicOn = true;
  private tracks: Partial<Record<Exclude<Mode, 'none'>, string>> = {};
  private musicEl: HTMLAudioElement | null = null;
  private musicMode: Mode = 'none';
  private last: Record<string, number> = {};

  setMusicTracks(t: Partial<Record<Exclude<Mode, 'none'>, string>>) {
    this.tracks = t;
  }

  /** Must be called from a user gesture. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.sfxOn ? 1 : 0;
    this.sfx.connect(this.master);
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.5;
    this.musicGain.connect(this.master);
    // white noise buffer
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // wind over the meadow (low-passed noise; rain in the storm)
    const cr = ctx.createBufferSource();
    cr.buffer = this.noise;
    cr.loop = true;
    cr.playbackRate.value = 0.5;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    cr.connect(this.windFilter).connect(this.windGain).connect(this.sfx);
    cr.start();
    if (this.musicMode !== 'none') this.music(this.musicMode, true);
  }

  setSfx(on: boolean) {
    this.sfxOn = on;
    if (this.ctx) this.sfx.gain.value = on ? 1 : 0;
  }
  setMusic(on: boolean) {
    this.musicOn = on;
    if (!on && this.musicEl) this.musicEl.pause();
    if (on) this.music(this.musicMode, true);
  }

  music(mode: Mode, force = false) {
    if (mode === this.musicMode && !force) return;
    this.musicMode = mode;
    const src = mode === 'none' ? undefined : this.tracks[mode];
    if (this.musicEl) {
      const old = this.musicEl;
      const fade = setInterval(() => {
        old.volume = Math.max(0, old.volume - 0.08);
        if (old.volume <= 0.01) {
          old.pause();
          clearInterval(fade);
        }
      }, 40);
      this.musicEl = null;
    }
    if (!src || !this.musicOn || !this.ctx) return;
    const el = new window.Audio(src);
    el.loop = true;
    el.volume = 0;
    el.play().catch(() => undefined);
    const target = mode === 'game' ? 0.32 : 0.42;
    const up = setInterval(() => {
      el.volume = Math.min(target, el.volume + 0.03);
      if (el.volume >= target) clearInterval(up);
    }, 60);
    this.musicEl = el;
  }

  duck(on: boolean) {
    if (this.musicEl) this.musicEl.volume = on ? 0.12 : this.musicMode === 'game' ? 0.32 : 0.42;
  }

  // ---------- continuous ----------
  /** Ambience of each course: wind and birds, the sea, the city, the fair, the glacier wind or the volcano's rumble. */
  loops(kind: string, dt: number) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    const gust = 0.5 + 0.5 * Math.sin(t * 0.37) * Math.sin(t * 0.11);
    const cfg: Record<string, [number, number]> = {
      lawn: [0.03, 450],
      street: [0.05, 300],
      sea: [0.09, 700],
      fairground: [0.04, 900],
      ice: [0.08, 1200],
      magma: [0.1, 140],
      beach: [0.08, 600],
      desert: [0.07, 1100],
      castle: [0.03, 500],
      city: [0.05, 220],
      canyon: [0.09, 900],
      space: [0.02, 160],
    };
    const [g, f] = cfg[kind] ?? cfg.lawn;
    const swell = kind === 'sea' || kind === 'beach' ? 0.5 + 0.5 * Math.sin(t * 0.8) : gust;
    this.windGain.gain.setTargetAtTime(g * (0.6 + swell * 0.8), t, 0.5);
    this.windFilter.frequency.setTargetAtTime(f * (0.7 + swell * 0.6), t, 0.5);
    this.birdT -= dt;
    if (this.birdT <= 0) {
      this.birdT = 1.5 + Math.random() * 4;
      if (kind === 'lawn' || kind === 'castle') this.bird();
      else if (kind === 'beach' && Math.random() < 0.5) {
        this.tone(1400, 0.25, 'sawtooth', 0.02, 0, 1900);
        this.tone(1900, 0.3, 'sawtooth', 0.018, 0.22, 1200);
      } else if (kind === 'space' && Math.random() < 0.4) this.tone(1200 + Math.random() * 800, 0.08, 'sine', 0.012, 0, 1600)
      else if (kind === 'sea' && Math.random() < 0.6) {
        // a gull
        this.tone(1400, 0.25, 'sawtooth', 0.02, 0, 1900);
        this.tone(1900, 0.3, 'sawtooth', 0.018, 0.22, 1200);
      } else if (kind === 'fairground' && Math.random() < 0.5) {
        [784, 988, 1175].forEach((fq, i) => this.tone(fq, 0.18, 'triangle', 0.015, i * 0.16));
      } else if (kind === 'magma') this.tone(45 + Math.random() * 15, 1.2, 'sine', 0.06, 0, 30);
    }
  }

  stopLoops() {
    const c = this.ctx;
    if (!c) return;
    this.windGain.gain.setTargetAtTime(0, c.currentTime, 0.1);
  }

  // ---------- one-shots ----------
  private limit(key: string, gap: number): boolean {
    const now = performance.now();
    if (now - (this.last[key] ?? 0) < gap * 1000) return false;
    this.last[key] = now;
    return true;
  }

  private noiseBurst(dur: number, type: BiquadFilterType, f0: number, f1: number, vol: number, q = 0.8, delay = 0) {
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.03, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random() * 1.0, dur + 0.05);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, slideTo?: number) {
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  play(name: string, n = 0) {
    if (!this.ctx || !this.sfxOn) return;
    switch (name) {
      case 'putt': {
        // the putter's "tock": a short pitched knock, louder with power
        const v = 0.08 + n * 0.14;
        this.tone(1250 + n * 300, 0.06, 'triangle', v, 0, 700);
        this.noiseBurst(0.04, 'bandpass', 3200, 1800, v * 0.8, 2);
        break;
      }
      case 'wall':
        if (!this.limit('wall', 0.06)) return;
        this.tone(520 + Math.random() * 60, 0.07, 'square', Math.min(0.08, 0.02 + n * 0.006), 0, 300);
        this.noiseBurst(0.05, 'lowpass', 2000, 600, Math.min(0.12, 0.03 + n * 0.01));
        break;
      case 'bumper':
        this.tone(330, 0.25, 'sine', 0.16, 0, 660);
        this.tone(660, 0.18, 'triangle', 0.06, 0.02, 990);
        break;
      case 'spinner':
        this.tone(220, 0.12, 'square', 0.07, 0, 140);
        this.noiseBurst(0.08, 'lowpass', 1200, 300, 0.1);
        break;
      case 'mover':
        this.tone(900, 0.08, 'triangle', 0.08, 0, 1400);
        break;
      case 'cup':
        // the rattle in the cup, then the drop
        this.tone(1600, 0.05, 'triangle', 0.1);
        this.tone(1300, 0.05, 'triangle', 0.09, 0.06);
        this.tone(900, 0.12, 'triangle', 0.1, 0.13);
        this.noiseBurst(0.15, 'lowpass', 900, 200, 0.12, 0.8, 0.15);
        break;
      case 'cheer': {
        // a small crowd: lots of noisy "yay" bands, bigger for better scores
        const big = n;
        this.noiseBurst(1.2 + big * 0.6, 'bandpass', 1300, 900, 0.12 + big * 0.06, 0.7, 0.05);
        this.noiseBurst(1.0 + big * 0.6, 'bandpass', 2400, 1700, 0.06 + big * 0.04, 1.2, 0.1);
        for (let i = 0; i < 4 + big * 6; i++) this.noiseBurst(0.04, 'highpass', 3000, 2500, 0.05, 1, 0.1 + Math.random() * (0.8 + big * 0.4));
        if (big >= 2) [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.08, 0.2 + i * 0.1));
        break;
      }
      case 'groan':
        this.tone(220, 0.5, 'sawtooth', 0.04, 0, 150);
        this.noiseBurst(0.6, 'bandpass', 600, 350, 0.08, 0.8);
        break;
      case 'lip':
        this.tone(1500, 0.05, 'triangle', 0.08);
        this.tone(1100, 0.08, 'triangle', 0.06, 0.07, 800);
        break;
      case 'water':
        this.noiseBurst(0.5, 'lowpass', 2500, 300, 0.35);
        this.tone(600, 0.2, 'sine', 0.06, 0.05, 200);
        break;
      case 'void':
        this.tone(900, 0.8, 'sine', 0.08, 0, 120);
        break;
      case 'lava':
        this.noiseBurst(0.8, 'highpass', 3000, 900, 0.25, 0.6);
        this.tone(80, 0.6, 'sine', 0.15, 0, 50);
        break;
      case 'lavaRise':
        this.noiseBurst(1.0, 'lowpass', 300, 80, 0.25, 0.7);
        this.tone(55, 0.9, 'sine', 0.12, 0, 40);
        break;
      case 'sand':
        if (!this.limit('sand', 0.3)) return;
        this.noiseBurst(0.25, 'bandpass', 1800, 900, 0.12, 0.8);
        break;
      case 'starLost':
        this.tone(740, 0.12, 'square', 0.08);
        this.tone(494, 0.22, 'square', 0.08, 0.1);
        break;
      case 'click':
        this.tone(900, 0.05, 'triangle', 0.1);
        break;
      case 'star':
        this.tone(880 * Math.pow(1.26, n), 0.5, 'triangle', 0.16);
        this.tone(1760 * Math.pow(1.26, n), 0.35, 'sine', 0.06);
        break;
      case 'win':
        [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, i === 5 ? 0.6 : 0.15, 'sawtooth', 0.07, i * 0.11));
        [262, 330, 392].forEach((f) => this.tone(f, 0.9, 'triangle', 0.08, 0.55));
        break;
      case 'tick':
        this.tone(1500, 0.04, 'square', 0.04);
        break;
      case 'lose':
        [392, 349, 311].forEach((f, i) => this.tone(f, i === 2 ? 0.5 : 0.18, 'triangle', 0.09, i * 0.16));
        break;
      case 'portal':
        this.tone(300, 0.35, 'sine', 0.1, 0, 1400);
        this.tone(1400, 0.3, 'triangle', 0.05, 0.18, 500);
        break;
      case 'boost':
        if (!this.limit('boost', 0.15)) return;
        this.tone(220, 0.3, 'sawtooth', 0.06, 0, 880);
        this.noiseBurst(0.25, 'bandpass', 2400, 4000, 0.08, 1);
        break;
      case 'jump':
        this.tone(330, 0.25, 'triangle', 0.08, 0, 660);
        break;
      case 'land':
        this.tone(110, 0.15, 'sine', 0.18, 0, 70);
        this.noiseBurst(0.15, 'lowpass', 900, 300, 0.12);
        break;
      case 'coin':
        this.tone(1319, 0.08, 'square', 0.06);
        this.tone(1976, 0.25, 'square', 0.06, 0.07);
        break;
    }
  }

  private bird() {
    const f = 2600 + Math.random() * 1800;
    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) this.tone(f * (1 + (i % 2) * 0.12), 0.07, 'sine', 0.018, i * 0.1, f * (i % 2 ? 0.8 : 1.25));
  }
}

export const audio = new Audio();

export function vibrate(ms: number | number[]) {
  try {
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch {
    /* ignore */
  }
}
