// Monetization contract shared by the game and the platform adapters (ported from Put It Out! through Round ’Em Up!).
// The game only talks to AdProvider / IapProvider; each platform (CrazyGames SDK, test double; Android with AdMob
// and Google Play Billing once the app exists) implements them in its own file. Keep this file free of platform code.
// Members marked "optional" were added later: the game works with providers that lack them.

/** Where an ad is shown. Rewarded placements are always opt-in (the player taps a button). */
export type RewardedPlacement = 'mulligan' | 'double_coins' | 'free_coins';
export type InterstitialPlacement = 'between_levels';
export type Placement = RewardedPlacement | InterstitialPlacement;

export interface AdProvider {
  readonly name: string;
  /** Load SDKs, preload the first ads. Never throws. */
  init(): Promise<void>;
  /** True when a rewarded ad can be shown right now (the game hides rewarded buttons otherwise). */
  rewardedReady(): boolean;
  /**
   * Shows a rewarded ad. Resolves true only if the player earned the reward. Never throws.
   * `onReward` (optional) is called the moment the reward is earned, even if the ad stays open for a while.
   */
  showRewarded(p: RewardedPlacement, onReward?: () => void): Promise<boolean>;
  /**
   * Shows an interstitial if one is loaded and resolves when it is closed (or right away if there is none).
   * Resolves false when no ad was shown. Never throws.
   */
  showInterstitial(p: InterstitialPlacement): Promise<boolean | void>;
  /** Optional: true when an interstitial is loaded (without it the game just calls showInterstitial). */
  interstitialReady?(): boolean;
  /** Optional: true while a full-screen ad is open (or the provider still waits for it to close). */
  adShowing?(): boolean;
}

export interface Product {
  id: ProductId;
  /** Localized price string from the store, e.g. "2,99 €" (null until the store answers). */
  price: string | null;
}

/** A paid store purchase, identified by the store's purchase token (unique per purchase). */
export interface PaidPurchase {
  id: ProductId;
  token: string;
}

/**
 * Outcome of IapProvider.purchase():
 * - `paid`: the player paid and the purchase is NOT finished yet. The game grants it, saves, and then calls
 *   finish() (consume / acknowledge). Until finish() succeeds the store keeps reporting it in unfinished().
 * - `pending`: the store accepted a slow payment method (cash at a shop...); it arrives later through unfinished().
 * - `cancelled` / `failed`: nothing was charged (as far as the provider knows).
 * Older providers resolve a boolean: true = paid and already finished by the provider, false = failed.
 */
export type PurchaseResult = { status: 'paid'; purchase: PaidPurchase } | { status: 'pending' } | { status: 'cancelled' } | { status: 'failed' };

export interface IapProvider {
  readonly name: string;
  /** Connects to the store and returns the products it knows. Never throws (returns [] on failure). */
  init(): Promise<Product[]>;
  /** Starts a purchase (see PurchaseResult). Never throws. */
  purchase(id: ProductId): Promise<PurchaseResult | boolean>;
  /** Non-consumables owned by this store account (used by "Restore purchases"). Never throws. */
  restore(): Promise<ProductId[]>;
  /**
   * Optional: paid purchases that are not finished yet (consumables not consumed, non-consumables not
   * acknowledged), e.g. the app was closed between payment and delivery. null when the store cannot be
   * reached. The game grants the ones it has not granted yet (it remembers tokens) and then finishes them.
   */
  unfinished?(): Promise<PaidPurchase[] | null>;
  /** Optional: consumes (consumables) or acknowledges (non-consumables) a granted purchase. True once done. Never throws. */
  finish?(p: PaidPurchase): Promise<boolean>;
}

/**
 * Store catalog (the studio's standard one, docs/negocio.md in nocodeboy-games). Ids must match the in-app products
 * created in Google Play Console. Nothing here buys stars: coins only buy balls and the aim line, which never counts
 * in the daily round. "remove_ads" removes the interstitials and keeps the opt-in rewarded ads.
 */
export const PRODUCTS = {
  remove_ads: { consumable: false, coins: 500 },
  starter_pack: { consumable: false, coins: 3000 },
  coins_s: { consumable: true, coins: 1000 },
  coins_m: { consumable: true, coins: 6000 },
  coins_l: { consumable: true, coins: 14000 },
} as const;
export type ProductId = keyof typeof PRODUCTS;
/** Suggested base prices (USD) to set in Play Console; the store localizes them per country. */
export const SUGGESTED_PRICE_USD: Record<ProductId, number> = {
  remove_ads: 2.99,
  starter_pack: 1.99,
  coins_s: 0.99,
  coins_m: 4.99,
  coins_l: 9.99,
};

export interface Providers {
  ads: AdProvider | null;
  iap: IapProvider | null;
}
