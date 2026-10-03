// Game-side monetization (ported from ¡Apágalo!): picks the ad and store providers for this build, applies the ad
// rules (interstitial caps, pause and mute while an ad plays), delivers every paid purchase exactly once and reports
// ads and purchases to analytics. The rest of the game only calls the functions exported here.
import { track } from '../analytics';
import { grantProduct, isNonConsumable } from '../economy';
import { adsAvailable, onAppResume } from '../platform';
import * as store from '../storage';
import { androidPrivacyOptionsRequired, createAndroidProviders, showAndroidPrivacyOptions } from './android';
import { createCrazyGamesAds } from './crazygames';
import { createFakeProviders } from './fake';
import type { AdProvider, PaidPurchase, Product, ProductId, Providers, PurchaseResult, RewardedPlacement } from './types';

// Interstitial between levels (Next on the end screen, which leads to the level intro, never straight into play).
// It only shows if all of these hold, and never in the player's first session.
const INTERSTITIAL_MIN_LEVEL_ENDS = 3; // level ends in total
const INTERSTITIAL_EVERY_LEVEL_ENDS = 2; // level ends since the last one
const INTERSTITIAL_GAP_MS = 120_000; // time since the last full-screen ad of any kind (rewarded ones too)

/**
 * Backstop for a provider that never settles: longer than the providers' own limits, so it only fires on a bug or
 * while an ad still covers the game (the game stays paused while the provider says an ad is open, up to
 * WATCHDOG_HARD_MS). A reward already earned is kept.
 */
const WATCHDOG_MS = 6 * 60_000;
const WATCHDOG_HARD_MS = 20 * 60_000;
const WATCHDOG_POLL_MS = 5_000;

/** Purchase tokens remembered in the save (newest last); far more than can be unfinished at once. */
const MAX_TOKENS = 50;
/** Unfinished purchases are looked for at launch and when the app comes back, at most this often. */
const RECOVER_MIN_GAP_MS = 10_000;

declare const __TARGET__: string;
const TARGET = typeof __TARGET__ !== 'undefined' ? __TARGET__ : 'web';

/** Purchases delivered outside a Buy tap (paid earlier, app closed before delivery, slow payment cleared). */
export interface Delivered {
  ids: ProductId[];
  coins: number;
}

let P: Providers = { ads: null, iap: null };
let products: Product[] = [];
let firstSession = true;
let busy = false;
let pause: (on: boolean) => void = () => undefined;
let delivered: (d: Delivered) => void = () => undefined;

// The test doubles only exist on local servers: on the live web or CrazyGames they would hand out free coins
const LOCAL_HOST = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

function pick(): Providers {
  const q = LOCAL_HOST ? new URLSearchParams(location.search) : null;
  const fakeAds = q?.get('fakeads') ?? null;
  const fakeIap = q?.get('fakeiap') ?? null;
  if (TARGET === 'android') return createAndroidProviders();
  if (fakeAds || fakeIap) return createFakeProviders(fakeAds, fakeIap);
  // CrazyGames: ads only once the game is out of Basic Launch (the build sets CG_ADS=1); no purchases there
  if (TARGET === 'crazygames' && adsAvailable()) return { ads: createCrazyGamesAds(), iap: null };
  // Web: no ads and no purchases (Android: AdMob and Google Play Billing, above).
  return { ads: null, iap: null };
}

/**
 * Loads the providers (SDKs, store catalog), quietly restores the non-consumables the store account owns and
 * delivers purchases paid but not delivered yet. `onPause(true)` runs before every ad and `onPause(false)` after it.
 * `onDelivered` reports purchases delivered at launch or when the app comes back to the foreground.
 */
export async function initMonetize(o: { firstSession: boolean; onPause: (on: boolean) => void; onDelivered?: (d: Delivered) => void }): Promise<void> {
  firstSession = o.firstSession;
  pause = o.onPause;
  delivered = o.onDelivered ?? (() => undefined);
  try {
    P = pick();
  } catch {
    P = { ads: null, iap: null };
  }
  const ads = P.ads;
  const iap = P.iap;
  await Promise.all([
    (async () => {
      try {
        await ads?.init();
      } catch {
        P.ads = null;
      }
    })(),
    (async () => {
      if (!iap) return;
      try {
        products = (await iap.init()).filter((p) => p.price);
      } catch {
        products = [];
      }
      await restorePurchases();
      await recoverInBackground();
      onAppResume(() => void recoverInBackground());
    })(),
  ]);
}

/** Name of the ad provider in use ('' when there is none). */
export function adProvider(): string {
  return P.ads?.name ?? '';
}

export function canReward(): boolean {
  try {
    return !busy && !!P.ads?.rewardedReady();
  } catch {
    return false;
  }
}

/** True while an ad is being shown (the game ignores input and the back button). */
export function adBusy(): boolean {
  return busy;
}

/** The game showed an opt-in rewarded button. */
export function adOffered(pl: RewardedPlacement) {
  track('ad_offer', { pl });
}

/**
 * Pauses the game around an ad. Resolves with the provider's answer, or `onTimeout()` if it throws or never
 * settles (after the watchdog, and only once the provider no longer reports an ad on screen).
 */
async function whilePaused<T>(p: AdProvider, run: () => Promise<T>, onTimeout: () => T): Promise<T> {
  busy = true;
  pause(true);
  try {
    return await new Promise<T>((resolve) => {
      let done = false;
      let timer = 0;
      const end = (value: () => T) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        let v: T;
        try {
          v = value();
        } catch {
          v = undefined as T;
        }
        resolve(v);
      };
      const watch = (ms: number, waited: number) => {
        timer = window.setTimeout(() => {
          let showing = false;
          try {
            showing = !!p.adShowing?.();
          } catch {
            showing = false;
          }
          if (showing && waited + ms < WATCHDOG_HARD_MS) watch(WATCHDOG_POLL_MS, waited + ms);
          else end(onTimeout);
        }, ms);
      };
      watch(WATCHDOG_MS, 0);
      Promise.resolve()
        .then(run)
        .then(
          (v) => end(() => v),
          () => end(onTimeout),
        );
    });
  } finally {
    busy = false;
    pause(false);
  }
}

/** A full-screen ad just ran (or was attempted): the interstitial gap counts from now. */
function noteFullscreen() {
  store.data().ads.lastFullscreen = Date.now();
  store.save();
}

/** Shows a rewarded ad. True only if the player earned the reward. */
export async function showRewarded(pl: RewardedPlacement): Promise<boolean> {
  const p = P.ads;
  if (!p || busy) return false;
  track('ad_show', { pl, type: 'rewarded' });
  let earned = false;
  const onReward = () => {
    earned = true;
  };
  const ok = await whilePaused(p, async () => (await p.showRewarded(pl, onReward)) || earned, () => earned);
  // closed early or failed to show: still counts for the gap before the next interstitial
  noteFullscreen();
  track(ok ? 'ad_reward' : 'ad_fail', { pl });
  return ok;
}

/** Counts a level end (won or lost, levels and daily) for the interstitial caps. */
export function noteLevelEnd() {
  const a = store.data().ads;
  a.levelEnds++;
  a.sinceInterstitial++;
}

function interstitialDue(): boolean {
  const s = store.data();
  const since = Date.now() - s.ads.lastFullscreen;
  return (
    !firstSession &&
    !s.owned.remove_ads &&
    s.ads.levelEnds >= INTERSTITIAL_MIN_LEVEL_ENDS &&
    s.ads.sinceInterstitial >= INTERSTITIAL_EVERY_LEVEL_ENDS &&
    // a clock set back (now before the last ad) must not block ads until it catches up
    (since >= INTERSTITIAL_GAP_MS || since < 0)
  );
}

/**
 * Next on the end screen: shows the interstitial if the caps allow it and one is loaded. Resolves when the game can
 * go on. The caps and `ad_show` only count an ad that actually played.
 */
export async function maybeInterstitial(): Promise<void> {
  const p = P.ads;
  if (!p || busy || !interstitialDue()) return;
  try {
    if (p.interstitialReady && !p.interstitialReady()) return;
  } catch {
    return;
  }
  const shown = await whilePaused(p, () => p.showInterstitial('between_levels'), () => undefined);
  if (shown === false) return;
  const a = store.data().ads;
  a.lastInterstitial = a.lastFullscreen = Date.now();
  a.sinceInterstitial = 0;
  store.save();
  track('ad_show', { pl: 'between_levels', type: 'interstitial' });
}

// ---------- purchases ----------
/** A store is available (Android with Google Play, or the local test double). The shop hides purchases otherwise. */
export function hasStore(): boolean {
  return !!P.iap;
}

/** Products the store returned with a price (the shop hides the rest). */
export function storeProducts(): Product[] {
  return products;
}

function grant(id: ProductId, src: 'iap' | 'restore'): number {
  const n = grantProduct(store.data(), id);
  store.save();
  if (n) track('coins_earn', { src, n });
  return n;
}

/**
 * Grants a paid purchase unless its token was granted before, and saves right away: the store is only told to
 * consume/acknowledge it afterwards. Returns the coins added, or null if this token was already granted.
 */
function deliver(p: PaidPurchase): number | null {
  const s = store.data();
  if (s.iapTokens.includes(p.token)) return null;
  const n = grantProduct(s, p.id);
  s.iapTokens.push(p.token);
  if (s.iapTokens.length > MAX_TOKENS) s.iapTokens.splice(0, s.iapTokens.length - MAX_TOKENS);
  store.save();
  if (n) track('coins_earn', { src: 'iap', n });
  return n;
}

/** Consume / acknowledge after granting. A failure is retried on the next launch or resume (never granted twice). */
async function finish(p: PaidPurchase): Promise<void> {
  try {
    await P.iap?.finish?.(p);
  } catch {
    /* retried later */
  }
}

let recovering: Promise<{ id: ProductId; coins: number }[]> | null = null;

/** Delivers the paid purchases the store still reports as unfinished and finishes them. Returns what was granted now. */
function recover(): Promise<{ id: ProductId; coins: number }[]> {
  const iap = P.iap;
  if (!iap?.unfinished) return Promise.resolve([]);
  if (recovering) return recovering;
  recovering = (async () => {
    let list: PaidPurchase[] | null = null;
    try {
      list = await iap.unfinished!();
    } catch {
      list = null;
    }
    const out: { id: ProductId; coins: number }[] = [];
    for (const p of list ?? []) {
      if (!p || !p.token || !p.id) continue;
      const n = deliver(p);
      if (n !== null) {
        out.push({ id: p.id, coins: n });
        track('iap_recover', { id: p.id });
      }
      await finish(p);
    }
    return out;
  })().finally(() => {
    recovering = null;
  });
  return recovering;
}

let lastRecover = -Infinity;
/** At launch and when the app comes back: deliver what was paid but not delivered, and tell the game. */
async function recoverInBackground(): Promise<void> {
  if (!P.iap?.unfinished || busy) return; // during a purchase, buy() looks by itself
  const now = performance.now();
  if (now - lastRecover < RECOVER_MIN_GAP_MS) return;
  lastRecover = now;
  const got = await recover();
  if (!got.length) return;
  try {
    delivered({ ids: got.map((d) => d.id), coins: got.reduce((a, d) => a + d.coins, 0) });
  } catch {
    /* the game's callback must not break the store */
  }
}

/** Coins added (0 for a product that adds none or was owned already), 'pending' (slow payment), or null (no purchase). */
export type BuyResult = number | 'pending' | null;

/** Buys and grants a product. */
export async function buy(id: ProductId): Promise<BuyResult> {
  const iap = P.iap;
  if (!iap || busy) return null;
  busy = true;
  track('iap_start', { id });
  try {
    // Paid before but never delivered (app closed mid-purchase, slow payment approved later): deliver that one
    // instead of charging again. This also finishes granted purchases whose consume did not go through.
    const prior = (await recover()).find((d) => d.id === id);
    if (prior) {
      track('iap_ok', { id });
      return prior.coins;
    }
    let r: PurchaseResult | boolean;
    try {
      r = await iap.purchase(id);
    } catch {
      r = { status: 'failed' };
    }
    if (r === true) {
      // older providers finish the purchase themselves
      track('iap_ok', { id });
      return grant(id, 'iap');
    }
    const status = r && typeof r === 'object' ? r.status : 'failed';
    if (r && typeof r === 'object' && r.status === 'paid' && r.purchase?.token) {
      const p = r.purchase;
      const n = deliver(p);
      void finish(p);
      if (n !== null) {
        track('iap_ok', { id });
        return n;
      }
      // a purchase this save already got (the store handed back an old one): nothing new was charged
    } else if (status === 'pending') {
      track('iap_pending', { id });
      return 'pending';
    } else if (status !== 'cancelled') {
      // failed or no answer in time: the payment may still have gone through, so look again
      const late = (await recover()).find((d) => d.id === id);
      if (late) {
        track('iap_ok', { id });
        return late.coins;
      }
    }
    track('iap_fail', { id });
    return null;
  } finally {
    busy = false;
  }
}

/** Grants the non-consumables owned by the store account that this save lacks. Returns those ids. */
export async function restorePurchases(): Promise<ProductId[]> {
  const iap = P.iap;
  if (!iap) return [];
  let ids: ProductId[] = [];
  try {
    ids = await iap.restore();
  } catch {
    ids = [];
  }
  const s = store.data();
  const missing = ids.filter((id) => isNonConsumable(id) && !s.owned[id]);
  for (const id of missing) grant(id, 'restore');
  return missing;
}

// ---------- ad consent ----------
/** Google's EU consent rules: players in the EEA/UK must be able to change their ad choice later (Settings). */
export function privacyOptionsAvailable(): boolean {
  try {
    return TARGET === 'android' && androidPrivacyOptionsRequired();
  } catch {
    return false;
  }
}

export async function openPrivacyOptions(): Promise<void> {
  if (TARGET === 'android') await showAndroidPrivacyOptions();
}
