import type { Lang, ThemeId } from './sim/types';

export interface Settings {
  sfx: boolean;
  music: boolean;
  vibration: boolean;
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
export interface TrophyRecord {
  level: number;
  strokes: number;
  par: number;
  /** when it was won (ms) */
  at: number;
}
export interface AdCounters {
  /** hole ends (route holes and daily rounds) since the install */
  levelEnds: number;
  sinceInterstitial: number;
  lastInterstitial: number;
  /** last full-screen ad of any kind (rewarded ones too) */
  lastFullscreen: number;
  /** free coins in the shop: local date of the last claims, how many, and when (24 h guard) */
  freeDay: string;
  freeClaims: number;
  freeTimes: number[];
}
/** Store purchases that are kept for good (non-consumables). */
export interface Owned {
  remove_ads: boolean;
  starter_pack: boolean;
}
export interface Save {
  v: 2;
  /** stars per route hole id ("L1".."L120"): 0 when finished by picking up, 1-3 otherwise */
  stars: Record<string, number>;
  /** fewest strokes per route hole */
  best: Record<string, number>;
  daily: Record<string, DailyRecord>;
  streak: { count: number; last: string };
  settings: Settings;
  tutorialDone: boolean;
  firstOpen: boolean;
  seenTips: string[];
  /** hole-in-ones over all time */
  aces: number;
  coins: number;
  /** aim line level (0-3), never used in the daily round */
  aim: number;
  /** balls bought, and the one in play */
  balls: string[];
  ball: string;
  /** courses whose cup hole has been won at par or better */
  trophies: ThemeId[];
  trophyInfo: Record<string, TrophyRecord>;
  ads: AdCounters;
  /** daily-round rewards in the last 24 h (whatever the phone's date says) */
  dailyTimes: number[];
  /** store purchases (non-consumables) and the purchase tokens already granted: they survive a progress reset */
  owned: Owned;
  iapTokens: string[];
}

const KEY = 'wildputt.v2';

function fresh(): Save {
  return {
    v: 2,
    stars: {},
    best: {},
    daily: {},
    streak: { count: 0, last: '' },
    settings: { sfx: true, music: true, vibration: true, gfx: 'auto', autoTier: null, lang: null, stats: true },
    tutorialDone: false,
    firstOpen: true,
    seenTips: [],
    aces: 0,
    coins: 0,
    aim: 0,
    balls: ['classic'],
    ball: 'classic',
    trophies: [],
    trophyInfo: {},
    ads: { levelEnds: 0, sinceInterstitial: 0, lastInterstitial: 0, lastFullscreen: 0, freeDay: '', freeClaims: 0, freeTimes: [] },
    dailyTimes: [],
    owned: { remove_ads: false, starter_pack: false },
    iapTokens: [],
  };
}

/** Any stored save (local or from the portal) -> a complete, sane v2 save. */
export function migrate(raw: unknown): Save {
  const f = fresh();
  if (!raw || typeof raw !== 'object') return f;
  const s = raw as Partial<Save>;
  const out: Save = {
    ...f,
    ...s,
    v: 2,
    settings: { ...f.settings, ...(s.settings ?? {}) },
    ads: { ...f.ads, ...(s.ads ?? {}), freeTimes: [...(s.ads?.freeTimes ?? [])] },
    stars: { ...(s.stars ?? {}) },
    best: { ...(s.best ?? {}) },
    trophies: [...(s.trophies ?? [])],
    trophyInfo: { ...(s.trophyInfo ?? {}) },
    balls: Array.isArray(s.balls) && s.balls.length ? [...new Set(['classic', ...s.balls.filter((x) => typeof x === 'string')])] : ['classic'],
    dailyTimes: [...(s.dailyTimes ?? [])],
    owned: { remove_ads: !!s.owned?.remove_ads, starter_pack: !!s.owned?.starter_pack },
    iapTokens: Array.isArray(s.iapTokens) ? s.iapTokens.filter((x) => typeof x === 'string') : [],
    coins: Math.max(0, Math.floor(Number(s.coins) || 0)),
    aim: Math.max(0, Math.min(3, Math.floor(Number(s.aim) || 0))),
  };
  if (!out.balls.includes(out.ball)) out.ball = 'classic';
  return out;
}

let mem: Save = fresh();

export function load(): Save {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) mem = migrate(JSON.parse(raw));
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
      const before = JSON.stringify(mem);
      const merged = migrate(JSON.parse(raw));
      const settings = merged.settings;
      Object.assign(mem, merged, { settings: mem.settings });
      Object.assign(mem.settings, settings);
      if (JSON.stringify(mem) !== raw) save();
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

/**
 * Wipes progress, coins, balls and trophies; keeps the settings, the ad counters (so resetting never shows more ads)
 * and what was bought in the store (remove ads, the starter pack and the tokens already granted).
 */
export function reset() {
  const { settings, ads, owned, iapTokens } = mem;
  const fr = fresh();
  Object.keys(mem).forEach((k) => delete (mem as unknown as Record<string, unknown>)[k]);
  Object.assign(mem, fr, { settings, ads, owned, iapTokens, firstOpen: false });
  save();
}

export function totalStars(): number {
  return Object.values(mem.stars).reduce((a, b) => a + b, 0);
}
