// Android (Capacitor) adapters for the monetization contract in ./types.ts:
//   ads -> AdMob through @capacitor-community/admob 8: rewarded + interstitial, with Google UMP consent (EEA/UK)
//   iap -> Google Play Billing 9 through @capgo/native-purchases 8: one-time products, consumables and non-consumables
// The native plugins are reached through window.Capacitor.Plugins, which the Android bridge injects before the game
// script runs (same approach as platform.ts). Only types come from the npm packages, so no Capacitor JS ends up in
// the web or CrazyGames bundles. Every public method is guarded: nothing throws and every promise settles.
// Ported from Put It Out! through Round ’Em Up!. Owner guide (AdMob, Play Console, testing): docs/publicar.md §4
import type {
  AdMobPlugin,
  AdmobConsentInfo,
  InterstitialAdPluginEvents,
  MaxAdContentRating,
  RewardAdPluginEvents,
} from '@capacitor-community/admob';
import type { NativePurchasesPlugin, PURCHASE_TYPE, Transaction } from '@capgo/native-purchases';
import { PRODUCTS } from './types';
import type { AdProvider, IapProvider, PaidPurchase, Product, ProductId, Providers, PurchaseResult } from './types';

// =====================================================================================================================
// ADMOB CONFIG — the only block the owner edits. Before a release with real ads:
//   1. Paste the two ad unit ids from AdMob (Apps > Wild Putt > Ad units) below.
//   2. Paste the AdMob APP id (the one with "~") in android/app/src/main/AndroidManifest.xml
//      (meta-data com.google.android.gms.ads.APPLICATION_ID). It must belong to the same AdMob app as the units.
//   3. Set USE_TEST_ADS to false.
// While USE_TEST_ADS is true, Google's demo ad units are used: they always serve "Test Ad" creatives, earn nothing
// and are safe to tap. Never tap your own real ads (AdMob can suspend the account): use TEST_DEVICE_IDS instead.
// =====================================================================================================================
export const ADMOB_CONFIG = {
  USE_TEST_ADS: false,
  REAL_AD_UNITS: {
    rewarded: 'ca-app-pub-7807308787501735/5217320546', // AdMob › Wild Putt › android_rewarded
    interstitial: 'ca-app-pub-7807308787501735/1478134512', // AdMob › Wild Putt › android_interstitial
  },
  /** Hashed ids of your own phones (Logcat prints them on the first ad request). They get test ads even with the
   *  real units, and they are the only devices where DEBUG_CONSENT_IN_EEA applies. */
  TEST_DEVICE_IDS: [] as string[],
  /** Testing only: UMP treats the TEST_DEVICE_IDS phones as if they were in the EEA, so the consent form shows. */
  DEBUG_CONSENT_IN_EEA: false,
  /** Highest ad content rating allowed. The store audience is 13+ and the game is family friendly. */
  MAX_AD_CONTENT_RATING: 'ParentalGuidance' as 'General' | 'ParentalGuidance' | 'Teen' | 'MatureAudience',
};

/** Google's official demo ad units: https://developers.google.com/admob/android/test-ads */
const TEST_AD_UNITS = {
  rewarded: 'ca-app-pub-3940256099942544/5224354917',
  interstitial: 'ca-app-pub-3940256099942544/1033173712',
};

// Time limits (ms). The game never waits longer than these, even if a native callback never comes.
const INIT_WAIT_MS = 20_000; // ads.init() resolves by then; consent and loading carry on in the background
const CONSENT_INFO_TIMEOUT_MS = 12_000;
const CONSENT_FORM_TIMEOUT_MS = 10 * 60_000; // the player is reading the form
const SDK_INIT_TIMEOUT_MS = 15_000;
const AD_LOAD_TIMEOUT_MS = 45_000;
// An ad session ends when the ad closes. Without any sign of the ad (no Showed event, show() not answered)
// it ends after AD_START_TIMEOUT_MS, and in any case after the *_MAX_MS below; but while the game's page is
// hidden (the ad's own activity, or the Play Store opened from the ad, covers it) it keeps waiting, checking
// every AD_RECHECK_MS, up to AD_HARD_MAX_MS. The game's own watchdog (src/monetize/index.ts) is longer.
const AD_START_TIMEOUT_MS = 15_000;
const REWARDED_MAX_MS = 5 * 60_000;
const INTERSTITIAL_MAX_MS = 3 * 60_000;
const AD_HARD_MAX_MS = 15 * 60_000;
const AD_RECHECK_MS = 5_000;
const REWARD_GRACE_MS = 500; // some networks report the reward right after the close event
const CONSENT_RETRY_MS = 60_000;
const CONSENT_RETRIES = 3;
const STORE_TIMEOUT_MS = 25_000; // billing connection (up to ~11 s with retries) + query
// The player may be adding a card or a payment method. If Play answers later than this, the purchase is not lost:
// the game looks for unfinished purchases right after, and again when the app comes back to the foreground.
const PURCHASE_TIMEOUT_MS = 10 * 60_000;

// ---------------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------------

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** Runs a plugin call and always settles: never throws, never waits longer than `ms`. */
function settle<T>(call: () => Promise<T> | T, ms: number): Promise<Settled<T>> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: Settled<T>) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, error: { code: 'TIMEOUT', message: `no answer in ${ms} ms` } }), ms);
    try {
      Promise.resolve(call()).then(
        (value) => finish({ ok: true, value }),
        (error: unknown) => finish({ ok: false, error }),
      );
    } catch (error) {
      finish({ ok: false, error });
    }
  });
}

function errorCode(e: unknown): string {
  const code = e && typeof e === 'object' ? (e as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : '';
}

function errorText(e: unknown): string {
  if (e && typeof e === 'object') {
    const { code, message } = e as { code?: unknown; message?: unknown };
    return [code, message].filter((x) => typeof x === 'string' && x).join(': ') || 'error';
  }
  return String(e);
}

/** The game's page is covered (a full-screen ad activity, the Play Store) or the app is in the background. */
function pageHidden(): boolean {
  try {
    return document.visibilityState === 'hidden';
  } catch {
    return false;
  }
}

function log(...args: unknown[]) {
  try {
    console.info('[monetize/android]', ...args);
  } catch {
    /* no console */
  }
}

type CapacitorWindow = { Capacitor?: { Plugins?: Record<string, unknown> } };

/** Native plugin proxy injected by the Capacitor Android bridge, or null outside the app. */
function nativePlugin<T>(name: string): T | null {
  try {
    const p = (window as unknown as CapacitorWindow).Capacitor?.Plugins?.[name];
    return p ? (p as T) : null;
  } catch {
    return null;
  }
}

/** Plugin event listener. The bridge's addListener returns a handle or a promise depending on the Capacitor path. */
function listen(plugin: unknown, event: string, cb: () => void) {
  try {
    const r = (plugin as { addListener: (e: string, f: () => void) => unknown }).addListener(event, cb);
    void Promise.resolve(r).catch(() => undefined);
  } catch {
    /* plugin without events */
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Ads: AdMob + UMP
// ---------------------------------------------------------------------------------------------------------------------

type AdKind = 'rewarded' | 'interstitial';

// Event names of the plugin; `satisfies` checks them against the plugin's own enums at compile time.
const REWARDED_EVENTS = {
  loaded: 'onRewardedVideoAdLoaded',
  failedToLoad: 'onRewardedVideoAdFailedToLoad',
  showed: 'onRewardedVideoAdShowed',
  failedToShow: 'onRewardedVideoAdFailedToShow',
  dismissed: 'onRewardedVideoAdDismissed',
  reward: 'onRewardedVideoAdReward',
} as const satisfies Record<string, `${RewardAdPluginEvents}`>;
const INTERSTITIAL_EVENTS = {
  loaded: 'interstitialAdLoaded',
  failedToLoad: 'interstitialAdFailedToLoad',
  showed: 'interstitialAdShowed',
  failedToShow: 'interstitialAdFailedToShow',
  dismissed: 'interstitialAdDismissed',
} as const satisfies Record<string, `${InterstitialAdPluginEvents}`>;

interface Slot {
  state: 'idle' | 'loading' | 'ready' | 'showing';
  failures: number;
  retry: ReturnType<typeof setTimeout> | null;
}

interface ShowSession {
  kind: AdKind;
  /** the ad opened: Showed event, or a later event that implies it (reward, dismissed) */
  showed: boolean;
  /** show() answered: for an interstitial, the SDK was told to show it (FailedToShow follows otherwise) */
  called: boolean;
  failed: boolean;
  rewarded: boolean;
  /** Marks the reward as earned (once) and tells the game right away. */
  reward(): void;
  /** Ends the session after `delayMs` (0 = now). */
  end(delayMs: number): void;
}

const adState = {
  sdkReady: false,
  /** true = ask for non-personalized ads (consent not confirmed). With a UMP consent string the SDK decides by itself. */
  npa: true,
  canRequestAds: false,
  privacyOptionsRequired: false,
  consentRetries: 0,
  booting: false,
  /** Starts consent + SDK again (set by createAds); used after the player changes the privacy options. */
  reboot: null as null | (() => void),
};

function applyConsent(info: AdmobConsentInfo) {
  const status = String(info.status);
  adState.canRequestAds = !!info.canRequestAds;
  adState.npa = !(status === 'OBTAINED' || status === 'NOT_REQUIRED');
  adState.privacyOptionsRequired = String(info.privacyOptionsRequirementStatus) === 'REQUIRED';
}

function createAds(): AdProvider {
  const admob = () => nativePlugin<AdMobPlugin>('AdMob');
  const units = ADMOB_CONFIG.USE_TEST_ADS ? TEST_AD_UNITS : ADMOB_CONFIG.REAL_AD_UNITS;
  const slots: Record<AdKind, Slot> = {
    rewarded: { state: 'idle', failures: 0, retry: null },
    interstitial: { state: 'idle', failures: 0, retry: null },
  };
  let session: ShowSession | null = null;
  let initPromise: Promise<void> | null = null;
  let eventsWired = false;

  function scheduleReload(kind: AdKind) {
    const slot = slots[kind];
    if (slot.retry) return;
    // Exponential backoff on failures (no fill, offline): 10 s, 20 s, 40 s... up to 5 min.
    const delay = slot.failures ? Math.min(10_000 * 2 ** Math.min(slot.failures - 1, 5), 300_000) : 0;
    slot.retry = setTimeout(() => {
      slot.retry = null;
      void load(kind);
    }, delay);
  }

  async function load(kind: AdKind) {
    const slot = slots[kind];
    const plugin = admob();
    const adId = units[kind];
    if (!adState.sdkReady || !plugin || !adId || slot.state !== 'idle') return;
    slot.state = 'loading';
    const options = { adId, isTesting: false, npa: adState.npa, immersiveMode: true };
    const r = await settle<unknown>(
      () => (kind === 'rewarded' ? plugin.prepareRewardVideoAd(options) : plugin.prepareInterstitial(options)),
      AD_LOAD_TIMEOUT_MS,
    );
    if (slot.state !== 'loading') return; // the Loaded event got here first
    if (r.ok) {
      slot.state = 'ready';
      slot.failures = 0;
    } else {
      slot.state = 'idle';
      slot.failures++;
      log(`${kind} ad not loaded (${errorText(r.error)}); retrying later`);
      scheduleReload(kind);
    }
  }

  function wireEvents(plugin: AdMobPlugin) {
    if (eventsWired) return;
    eventsWired = true;
    const wire = (kind: AdKind, ev: { loaded: string; failedToLoad: string; showed: string; failedToShow: string; dismissed: string }) => {
      listen(plugin, ev.loaded, () => {
        const slot = slots[kind];
        if (slot.state === 'idle' || slot.state === 'loading') {
          slot.state = 'ready';
          slot.failures = 0;
        }
      });
      // Also fired by the plugin when show() finds no prepared ad.
      listen(plugin, ev.failedToLoad, () => {
        const slot = slots[kind];
        if (slot.state === 'ready') {
          slot.state = 'idle';
          scheduleReload(kind);
        }
      });
      listen(plugin, ev.showed, () => {
        if (session?.kind === kind) session.showed = true;
      });
      listen(plugin, ev.failedToShow, () => {
        if (session?.kind !== kind) return;
        session.failed = true;
        session.end(0);
      });
      listen(plugin, ev.dismissed, () => {
        if (session?.kind !== kind) return;
        session.showed = true;
        session.end(kind === 'rewarded' ? REWARD_GRACE_MS : 0);
      });
    };
    wire('rewarded', REWARDED_EVENTS);
    wire('interstitial', INTERSTITIAL_EVENTS);
    listen(plugin, REWARDED_EVENTS.reward, () => {
      if (session?.kind === 'rewarded') session.reward();
    });
  }

  /** UMP: refresh the consent info on every launch and show Google's form when it is required (EEA/UK). */
  async function gatherConsent(plugin: AdMobPlugin, allowForm: boolean): Promise<boolean> {
    const debug = ADMOB_CONFIG.TEST_DEVICE_IDS.length > 0;
    const info = await settle(
      () =>
        plugin.requestConsentInfo({
          ...(debug ? { testDeviceIdentifiers: ADMOB_CONFIG.TEST_DEVICE_IDS } : {}),
          ...(debug && ADMOB_CONFIG.DEBUG_CONSENT_IN_EEA ? { debugGeography: 1 } : {}), // 1 = EEA
        }),
      CONSENT_INFO_TIMEOUT_MS,
    );
    if (!info.ok) {
      log(`consent info not available (${errorText(info.error)})`);
      return false;
    }
    applyConsent(info.value);
    if (allowForm && String(info.value.status) === 'REQUIRED' && info.value.isConsentFormAvailable !== false) {
      const form = await settle(() => plugin.showConsentForm(), CONSENT_FORM_TIMEOUT_MS);
      if (form.ok) applyConsent(form.value);
      else log(`consent form not shown (${errorText(form.error)})`);
    }
    return true;
  }

  async function startSdk(plugin: AdMobPlugin) {
    if (adState.sdkReady) return;
    const testing = ADMOB_CONFIG.TEST_DEVICE_IDS.length > 0;
    const r = await settle(
      () =>
        plugin.initialize({
          initializeForTesting: testing,
          testingDevices: ADMOB_CONFIG.TEST_DEVICE_IDS,
          maxAdContentRating: ADMOB_CONFIG.MAX_AD_CONTENT_RATING as MaxAdContentRating,
        }),
      SDK_INIT_TIMEOUT_MS,
    );
    // The SDK also initializes itself on the first request, so a slow initialize() is not fatal.
    if (!r.ok) log(`AdMob initialize: ${errorText(r.error)}`);
    adState.sdkReady = true;
    scheduleReload('rewarded');
    scheduleReload('interstitial');
  }

  /** Consent first, then the SDK and the first ads. Retries (without the form) when UMP could not be reached. */
  async function boot(allowForm: boolean) {
    const plugin = admob();
    if (!plugin || adState.booting || adState.sdkReady) return;
    if (!units.rewarded && !units.interstitial) {
      log('no ad unit ids: paste them in ADMOB_CONFIG.REAL_AD_UNITS or turn USE_TEST_ADS on');
      return;
    }
    adState.booting = true;
    try {
      wireEvents(plugin);
      const reached = await gatherConsent(plugin, allowForm);
      // Google's policy: no ad requests until UMP says so (it stays true once consent was given in a past session).
      // Test ads skip the rule so the flow can be tested before the AdMob app and its consent message exist
      // (with the demo app id there is no message of yours to show); they go out as non-personalized.
      if (adState.canRequestAds || ADMOB_CONFIG.USE_TEST_ADS) {
        await startSdk(plugin);
      } else if (!reached && adState.consentRetries < CONSENT_RETRIES) {
        adState.consentRetries++;
        setTimeout(() => void boot(false), CONSENT_RETRY_MS);
      } else {
        log('ads disabled for this session: no consent to request ads');
      }
    } finally {
      adState.booting = false;
    }
  }

  /**
   * Shows a loaded ad and resolves when it is closed. `showed`: the ad was on screen; `rewarded`: the reward was
   * earned (rewarded ads only; `onReward` is also called the moment it is earned).
   */
  function runSession(
    kind: AdKind,
    show: () => Promise<unknown>,
    maxMs: number,
    onReward?: () => void,
  ): Promise<{ showed: boolean; rewarded: boolean }> {
    return new Promise((resolve) => {
      const timers: ReturnType<typeof setTimeout>[] = [];
      let done = false;
      const s: ShowSession = {
        kind,
        showed: false,
        called: false,
        failed: false,
        rewarded: false,
        reward() {
          s.showed = true;
          if (s.rewarded) return;
          s.rewarded = true;
          try {
            onReward?.();
          } catch {
            /* the game's callback must not break the session */
          }
        },
        end(delayMs) {
          timers.push(setTimeout(finish, delayMs));
        },
      };
      function finish() {
        if (done) return;
        done = true;
        for (const t of timers) clearTimeout(t);
        if (session === s) session = null;
        resolve({ showed: s.showed || (s.called && !s.failed), rewarded: s.rewarded });
      }
      /** After `ms`, ends the session if `due()` holds; while the page is hidden it rechecks instead (up to AD_HARD_MAX_MS). */
      function limit(ms: number, waited: number, due: () => boolean) {
        timers.push(
          setTimeout(() => {
            if (done || !due()) return;
            if (pageHidden() && waited + ms < AD_HARD_MAX_MS) limit(AD_RECHECK_MS, waited + ms, due);
            else finish();
          }, ms),
        );
      }
      session = s;
      // No sign of the ad yet: give up, unless the page is hidden (the ad most likely covers it and its Showed
      // event is only late). Then the max limit, also deferred while an ad or the Play Store covers the game.
      limit(AD_START_TIMEOUT_MS, 0, () => !(s.showed || s.called));
      limit(maxMs, 0, () => true);
      try {
        Promise.resolve(show()).then(
          () => {
            s.called = true;
            // showRewardVideoAd() resolves only when the reward is earned; showInterstitial() right after show()
            if (kind === 'rewarded') s.reward();
          },
          () => {
            // not prepared, activity gone...: the ad did not open
            if (!s.showed) {
              s.failed = true;
              finish();
            }
          },
        );
      } catch {
        s.failed = true;
        finish();
      }
    });
  }

  function afterShow(kind: AdKind) {
    slots[kind].state = 'idle';
    scheduleReload(kind);
  }

  adState.reboot = () => void boot(false);

  return {
    name: 'admob',
    init() {
      if (!initPromise) initPromise = boot(true).catch(() => undefined);
      return settle(() => initPromise!, INIT_WAIT_MS).then(() => undefined);
    },
    rewardedReady() {
      return adState.sdkReady && slots.rewarded.state === 'ready' && !session;
    },
    interstitialReady() {
      if (slots.interstitial.state === 'idle' && adState.sdkReady) scheduleReload('interstitial');
      return adState.sdkReady && slots.interstitial.state === 'ready' && !session;
    },
    adShowing() {
      return !!session;
    },
    async showRewarded(_p, onReward) {
      try {
        const plugin = admob();
        if (!plugin || !adState.sdkReady || slots.rewarded.state !== 'ready' || session) {
          if (slots.rewarded.state === 'idle') scheduleReload('rewarded');
          return false;
        }
        slots.rewarded.state = 'showing';
        const r = await runSession('rewarded', () => plugin.showRewardVideoAd(), REWARDED_MAX_MS, onReward);
        afterShow('rewarded');
        return r.rewarded;
      } catch {
        afterShow('rewarded');
        return false;
      }
    },
    async showInterstitial() {
      try {
        const plugin = admob();
        if (!plugin || !adState.sdkReady || slots.interstitial.state !== 'ready' || session) {
          if (slots.interstitial.state === 'idle') scheduleReload('interstitial');
          return false;
        }
        slots.interstitial.state = 'showing';
        const r = await runSession('interstitial', () => plugin.showInterstitial(), INTERSTITIAL_MAX_MS);
        afterShow('interstitial');
        return r.showed;
      } catch {
        afterShow('interstitial');
        return false;
      }
    },
  };
}

/**
 * Extra to the contract: Google's EU consent policy requires a way to change the ad consent later. When this is true
 * (users in the EEA/UK, after ads.init()), show a "Privacy options" / "Opciones de privacidad" button in Settings
 * that calls showAndroidPrivacyOptions().
 */
export function androidPrivacyOptionsRequired(): boolean {
  return adState.privacyOptionsRequired;
}

/** Opens Google's privacy options form (UMP) and applies the new choice to the next ad requests. Never throws. */
export async function showAndroidPrivacyOptions(): Promise<void> {
  const plugin = nativePlugin<AdMobPlugin>('AdMob');
  if (!plugin) return;
  await settle(() => plugin.showPrivacyOptionsForm(), CONSENT_FORM_TIMEOUT_MS);
  const info = await settle(() => plugin.requestConsentInfo(), CONSENT_INFO_TIMEOUT_MS);
  if (!info.ok) return;
  applyConsent(info.value);
  if (!adState.sdkReady && adState.canRequestAds) adState.reboot?.();
}

// ---------------------------------------------------------------------------------------------------------------------
// In-app purchases: Google Play Billing
// ---------------------------------------------------------------------------------------------------------------------

// One-time products only ("inapp"). Typed through the plugin enum without importing its runtime code.
const INAPP = 'inapp' as unknown as PURCHASE_TYPE;
const PRODUCT_IDS = Object.keys(PRODUCTS) as ProductId[];
const isProductId = (x: unknown): x is ProductId => typeof x === 'string' && Object.prototype.hasOwnProperty.call(PRODUCTS, x);

/** The plugin rejects a purchase left waiting for a slow payment method with this message (no code). */
const isPendingError = (e: unknown) => /pending/i.test(errorText(e));

function createIap(): IapProvider {
  const store = () => nativePlugin<NativePurchasesPlugin>('NativePurchases');

  // The plugin keeps a single billing connection that each call opens and closes (a new call closes the previous
  // one, losing its answer), so calls must not overlap.
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(task: () => Promise<T>, fallback: T): Promise<T> {
    const run = queue.then(task).catch(() => fallback);
    queue = run;
    return run;
  }

  /** Completed (paid) one-time purchases this Google account still owns: non-consumables, and consumables not consumed yet. */
  async function owned(): Promise<Transaction[] | null> {
    const s = store();
    if (!s) return null;
    const r = await settle(() => s.getPurchases({ productType: INAPP }), STORE_TIMEOUT_MS);
    if (!r.ok) {
      log(`purchases not available (${errorText(r.error)})`);
      return null;
    }
    // purchaseState "1" = PURCHASED ("2" = pending payment, e.g. cash at a shop: not granted until it clears)
    return (r.value?.purchases ?? []).filter((p) => p && p.purchaseState === '1' && !!p.purchaseToken);
  }

  // Order of a purchase (Google's recommendation): Play reports it paid -> the game grants it and saves ->
  // finish() consumes (coins) or acknowledges (the rest). If the app dies in between, unfinished() still lists it
  // on the next launch or resume and the game delivers it then; the game remembers the tokens it granted, so a
  // retried finish() never grants twice. A consumable is never consumed before it is granted.
  return {
    name: 'google-play',
    init() {
      return serial(async () => {
        const s = store();
        if (!s) return [];
        const r = await settle(() => s.getProducts({ productIdentifiers: PRODUCT_IDS, productType: INAPP }), STORE_TIMEOUT_MS);
        if (!r.ok) {
          log(`products not available (${errorText(r.error)})`);
          return [];
        }
        const found = new Map<ProductId, Product>();
        for (const sp of r.value?.products ?? []) {
          // A product with several offers comes once per offer: keep the first (base) one.
          if (sp && isProductId(sp.identifier) && !found.has(sp.identifier)) {
            found.set(sp.identifier, { id: sp.identifier, price: sp.priceString || null });
          }
        }
        return PRODUCT_IDS.filter((id) => found.has(id)).map((id) => found.get(id)!);
      }, [] as Product[]);
    },
    purchase(id) {
      if (!isProductId(id)) return Promise.resolve<PurchaseResult>({ status: 'failed' });
      return serial<PurchaseResult>(async () => {
        const s = store();
        if (!s) return { status: 'failed' };
        // The plugin's own auto-consume/acknowledge is fire-and-forget and runs before the game grants anything,
        // so both are off: the game calls finish() once the purchase is granted and saved.
        const r = await settle(
          () => s.purchaseProduct({ productIdentifier: id, productType: INAPP, isConsumable: false, autoAcknowledgePurchases: false }),
          PURCHASE_TIMEOUT_MS,
        );
        if (!r.ok) {
          const code = errorCode(r.error);
          if (code === 'USER_CANCELED') return { status: 'cancelled' };
          if (isPendingError(r.error)) return { status: 'pending' };
          if (code === 'ITEM_ALREADY_OWNED') {
            // paid before and not finished: hand it over (the game grants it only if it never did)
            const again = (await owned())?.find((p) => p.productIdentifier === id);
            return again ? { status: 'paid', purchase: { id, token: again.purchaseToken! } } : { status: 'failed' };
          }
          log(`purchase of ${id} not completed (${errorText(r.error)})`);
          return { status: 'failed' };
        }
        const tx = r.value;
        if (tx?.purchaseState === '2') return { status: 'pending' };
        if (!tx || tx.purchaseState !== '1' || !tx.purchaseToken || (tx.productIdentifier && tx.productIdentifier !== id)) return { status: 'failed' };
        return { status: 'paid', purchase: { id, token: tx.purchaseToken } };
      }, { status: 'failed' });
    },
    restore() {
      // Only lists them: the game grants the missing ones, and unfinished()/finish() acknowledge them afterwards.
      return serial(async () => {
        const list = await owned();
        if (!list) return [];
        const out: ProductId[] = [];
        for (const p of list) {
          const id = p.productIdentifier;
          if (isProductId(id) && !PRODUCTS[id].consumable && !out.includes(id)) out.push(id);
        }
        return out;
      }, [] as ProductId[]);
    },
    unfinished() {
      return serial<PaidPurchase[] | null>(async () => {
        const list = await owned();
        if (!list) return null;
        const out: PaidPurchase[] = [];
        for (const p of list) {
          const id = p.productIdentifier;
          if (isProductId(id) && (PRODUCTS[id].consumable || !p.isAcknowledged)) out.push({ id, token: p.purchaseToken! });
        }
        return out;
      }, null);
    },
    finish(p) {
      if (!isProductId(p.id) || !p.token) return Promise.resolve(false);
      return serial(async () => {
        const s = store();
        if (!s) return false;
        const consumable = PRODUCTS[p.id].consumable;
        const purchaseToken = p.token;
        const r = await settle<unknown>(
          () => (consumable ? s.consumePurchase({ purchaseToken }) : s.acknowledgePurchase({ purchaseToken })),
          STORE_TIMEOUT_MS,
        );
        if (r.ok) return true;
        // No answer in time or an error: it may have gone through anyway (slow network). Ask Play what is left;
        // if it is still there the game retries on the next launch or resume (without granting it again).
        log(`${consumable ? 'consume' : 'acknowledge'} of ${p.id} not confirmed (${errorText(r.error)}); checking`);
        const list = await owned();
        if (!list) return false; // Play not reachable: retried later
        const left = list.find((x) => x.purchaseToken === purchaseToken);
        if (!left) return true; // consumed after all
        return !consumable && !!left.isAcknowledged;
      }, false);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------

let providers: Providers | null = null;

/** Providers for the Android app. Null parts when the native plugin is missing (e.g. the Android bundle in a browser). */
export function createAndroidProviders(): Providers {
  if (!providers) {
    providers = {
      ads: nativePlugin('AdMob') ? createAds() : null,
      iap: nativePlugin('NativePurchases') ? createIap() : null,
    };
  }
  return providers;
}
