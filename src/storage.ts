import type { Lang } from './sim/types';

export interface Settings {
  sfx: boolean;
  music: boolean;
  vibration: boolean;
  /** legacy field from v1 builds, ignored */
  quality?: 'high' | 'low';
  gfx: 'auto' | 'high' | 'medium' | 'low';
  /** last tier chosen by the automatic mode on this device */
  autoTier: 'high' | 'medium' | 'low' | null;
  lang: Lang | null;
  /** anonymous gameplay statistics (opt-out) */
  stats?: boolean;
  /** camera: behind the ball (default) or the whole hole from above */
  cam?: 'chase' | 'overview';
}
export interface DailyRecord {
  /** total strokes (lower is better) */
  score: number;
  stars: number;
  ratio: number;
  time: number;
  win: boolean;
}
export interface Save {
  v: 1;
  stars: Record<string, number>;
  best: Record<string, number>;
  daily: Record<string, DailyRecord>;
  streak: { count: number; last: string };
  settings: Settings;
  tutorialDone: boolean;
  firstOpen: boolean;
  seenTips: string[];
  /** hole-in-ones over all time (a stat for the end screens and, later, achievements) */
  aces: number;
}

const KEY = 'wildputt.v1';

function fresh(): Save {
  return {
    v: 1,
    stars: {},
    best: {},
    daily: {},
    streak: { count: 0, last: '' },
    settings: { sfx: true, music: true, vibration: true, gfx: 'auto', autoTier: null, lang: null, stats: true },
    tutorialDone: false,
    firstOpen: true,
    seenTips: [],
    aces: 0,
  };
}

let mem: Save = fresh();

export function load(): Save {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Save;
      mem = { ...fresh(), ...s, settings: { ...fresh().settings, ...s.settings } };
    }
  } catch {
    /* private mode or blocked storage: keep in memory */
  }
  return mem;
}

/** Portal-provided key/value store (CrazyGames SDK Data module: local for guests, cloud once logged in). */
export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
let cloud: KV | null = null;

/**
 * Switch the save to the portal store. The portal copy wins if it exists (it may come from another
 * device); otherwise the local save is copied into it. Mutates the live save object in place so
 * every reference held elsewhere stays valid. Returns true when the loaded progress changed.
 */
export function useCloud(kv: KV): boolean {
  cloud = kv;
  let raw: string | null = null;
  try {
    raw = kv.getItem(KEY);
  } catch {
    raw = null;
  }
  if (raw) {
    try {
      const s = JSON.parse(raw) as Save;
      const before = JSON.stringify(mem);
      const settings = { ...fresh().settings, ...s.settings };
      const merged = { ...fresh(), ...s };
      Object.assign(mem, merged, { settings: mem.settings });
      Object.assign(mem.settings, settings);
      try {
        localStorage.setItem(KEY, JSON.stringify(mem));
      } catch {
        /* ignore */
      }
      return JSON.stringify(mem) !== before;
    } catch {
      /* unreadable portal copy: keep the local save and overwrite it below */
    }
  }
  save();
  return false;
}

export function save() {
  const raw = JSON.stringify(mem);
  try {
    localStorage.setItem(KEY, raw);
  } catch {
    /* ignore */
  }
  try {
    cloud?.setItem(KEY, raw);
  } catch {
    /* the portal store must never break the game */
  }
}

export function data(): Save {
  return mem;
}

export function reset() {
  const settings = mem.settings;
  mem = fresh();
  mem.settings = settings;
  mem.firstOpen = false;
  save();
}

export function totalStars(): number {
  return Object.values(mem.stars).reduce((a, b) => a + b, 0);
}
