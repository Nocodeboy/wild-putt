// Meta progression (docs/diseno-v2.md §5.5-5.6): coins per hole, the shop (balls and the aim line), free coins,
// the mulligan and store purchases. Pure rules on the save (no DOM, no analytics), shared by the game and the tools.
import { PRODUCTS, type ProductId } from './monetize/types';
import type { Save } from './storage';

// ---------- the shop ----------
/** Aim line levels: how much longer the dotted line is, and level 3 follows it past the first bounce. */
export const AIM_COSTS = [300, 900, 2000];
export const MAX_AIM = AIM_COSTS.length;
/** Length factor of the dotted line per level (level 3 also shows the second bounce). */
export const AIM_LEN = [1, 1.35, 1.7, 1.7];

export interface BallDef {
  id: string;
  price: number;
  /** body colour and, for patterned balls, the second colour */
  c1: number;
  c2?: number;
  pattern?: 'stripe' | 'tennis' | 'soccer' | 'pool' | 'melon' | 'disco' | 'planet' | 'comet';
  /** trail colour (RGB 0..1) */
  trail: [number, number, number];
  name: { en: string; es: string };
}

export const BALLS: BallDef[] = [
  { id: 'classic', price: 0, c1: 0xffffff, trail: [1, 1, 1], name: { en: 'Classic', es: 'Clásica' } },
  { id: 'tangerine', price: 200, c1: 0xff8a2a, trail: [1, 0.6, 0.2], name: { en: 'Tangerine', es: 'Mandarina' } },
  { id: 'mint', price: 200, c1: 0x5ee8b0, trail: [0.4, 1, 0.75], name: { en: 'Mint', es: 'Menta' } },
  { id: 'grape', price: 200, c1: 0x9a5af0, trail: [0.7, 0.45, 1], name: { en: 'Grape', es: 'Uva' } },
  { id: 'striped', price: 200, c1: 0xffffff, c2: 0xe8483a, pattern: 'stripe', trail: [1, 0.4, 0.35], name: { en: 'Striped', es: 'Rayas' } },
  { id: 'tennis', price: 450, c1: 0xd8f04a, c2: 0xffffff, pattern: 'tennis', trail: [0.85, 1, 0.3], name: { en: 'Tennis', es: 'Tenis' } },
  { id: 'soccer', price: 450, c1: 0xffffff, c2: 0x1a1a1a, pattern: 'soccer', trail: [1, 1, 1], name: { en: 'Soccer', es: 'Fútbol' } },
  { id: 'pool8', price: 700, c1: 0x141414, c2: 0xffffff, pattern: 'pool', trail: [0.6, 0.6, 0.7], name: { en: 'Pool 8', es: 'Bola 8' } },
  { id: 'melon', price: 700, c1: 0x3a9a3a, c2: 0x1e5a1e, pattern: 'melon', trail: [1, 0.35, 0.4], name: { en: 'Watermelon', es: 'Sandía' } },
  { id: 'disco', price: 1200, c1: 0xd8dce8, c2: 0x7a8aa8, pattern: 'disco', trail: [1, 0.5, 1], name: { en: 'Disco', es: 'Disco' } },
  { id: 'planet', price: 1200, c1: 0xe8a050, c2: 0xc8783a, pattern: 'planet', trail: [1, 0.8, 0.5], name: { en: 'Planet', es: 'Planeta' } },
  { id: 'comet', price: 2500, c1: 0x4ab8ff, c2: 0xffffff, pattern: 'comet', trail: [1, 0.55, 0.15], name: { en: 'Comet', es: 'Cometa' } },
];
export function ballById(id: string): BallDef {
  return BALLS.find((b) => b.id === id) ?? BALLS[0];
}

/** Cost of the next aim-line level, or null when it is maxed. */
export function aimCost(level: number): number | null {
  return level < MAX_AIM ? AIM_COSTS[level] : null;
}
/** Buys the next aim-line level. Returns the coins spent (0 if maxed or not affordable). */
export function buyAim(save: Save): number {
  const cost = aimCost(save.aim);
  if (cost === null || save.coins < cost) return 0;
  save.coins -= cost;
  save.aim++;
  return cost;
}
/** Buys a ball (and puts it in play). Returns the coins spent (0 if owned already or not affordable). */
export function buyBall(save: Save, id: string): number {
  const b = BALLS.find((x) => x.id === id);
  if (!b || save.balls.includes(id) || save.coins < b.price) return 0;
  save.coins -= b.price;
  save.balls.push(id);
  save.ball = id;
  return b.price;
}

// ---------- coins ----------
export const COIN_VALUE = 5; // each coin picked up on the green
export const FREE_COINS = 150;
/** Repeat the last stroke, for an ad or for these coins (once per hole, never in the daily round). */
export const MULLIGAN_COST = 100;
export const FREE_COINS_PER_DAY = 3;
/** Daily-round rewards allowed per rolling 24 h (normally one a day; 3 leaves room around midnight). */
export const DAILY_REWARDS_PER_DAY = 3;
const DAY_MS = 86_400_000;

/** A hole of the tour: 10 + 10 per star, +50 for a hole in one, plus the coins picked up; cup holes pay double. */
export function holeCoins(stars: number, strokes: number, picked: number, champ = false): number {
  const base = 10 + 10 * stars + (strokes === 1 ? 50 : 0) + picked * COIN_VALUE;
  return base * (champ && stars >= 2 ? 2 : 1);
}

/** First result of the day in the daily round: 100 + 10 per star of its six holes (up to 280). */
export function dailyCoins(stars: number): number {
  return 100 + 10 * Math.max(0, Math.min(18, stars));
}

/**
 * Claims made in the last 24 h. Guard against changing the phone's date: the per-day counters are keyed to the
 * local date, these timestamps are not. A timestamp in the future (the clock went back) is clamped to now, so it
 * blocks at most 24 h. Mutates the list (clamped, trimmed to the last `max`).
 */
function recentClaims(times: number[], now: number, max: number): number {
  for (let i = 0; i < times.length; i++) times[i] = Math.min(times[i], now);
  times.splice(0, Math.max(0, times.length - max));
  return times.filter((t) => now - t < DAY_MS).length;
}

export function freeCoinsLeft(save: Save, today: string, now = Date.now()): number {
  const byDay = save.ads.freeDay === today ? Math.max(0, FREE_COINS_PER_DAY - save.ads.freeClaims) : FREE_COINS_PER_DAY;
  return Math.min(byDay, Math.max(0, FREE_COINS_PER_DAY - recentClaims(save.ads.freeTimes, now, FREE_COINS_PER_DAY)));
}

/** Rewarded "free coins" in the shop. Returns the coins added (0 when today's claims are used up). */
export function claimFreeCoins(save: Save, today: string, now = Date.now()): number {
  if (freeCoinsLeft(save, today, now) <= 0) return 0;
  if (save.ads.freeDay !== today) {
    save.ads.freeDay = today;
    save.ads.freeClaims = 0;
  }
  save.ads.freeClaims++;
  save.ads.freeTimes.push(now);
  save.coins += FREE_COINS;
  return FREE_COINS;
}

/** The daily round's first-result reward is still allowed (at most 3 per rolling 24 h). Records it when true. */
export function takeDailyReward(save: Save, now = Date.now()): boolean {
  if (recentClaims(save.dailyTimes, now, DAILY_REWARDS_PER_DAY) >= DAILY_REWARDS_PER_DAY) return false;
  save.dailyTimes.push(now);
  return true;
}

// ---------- store purchases (Android; defined everywhere, harmless where there is no store) ----------
export type NonConsumable = { [K in ProductId]: (typeof PRODUCTS)[K]['consumable'] extends false ? K : never }[ProductId];

export function isNonConsumable(id: ProductId): id is NonConsumable {
  return !PRODUCTS[id].consumable;
}

/**
 * Applies a completed (or restored) purchase. Idempotent for non-consumables: a product already owned by this save
 * grants nothing again. Returns the coins added.
 */
export function grantProduct(save: Save, id: ProductId): number {
  if (isNonConsumable(id)) {
    if (save.owned[id]) return 0;
    save.owned[id] = true;
  }
  save.coins += PRODUCTS[id].coins;
  return PRODUCTS[id].coins;
}
