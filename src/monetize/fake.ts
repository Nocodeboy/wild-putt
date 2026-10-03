// Test doubles for automated tests (local servers only):
//   ?fakeads=1     every ad "plays" for about a second behind a plain overlay and rewards the player
//   ?fakeads=fail  every ad fails
//   ?fakeiap=1     a fake Google Play store: every purchase succeeds (fail: all fail; pending: all wait for payment,
//                  which clears on the next launch)
// Counters for the tests live in window.__fakeads. The fake "store account" lives in localStorage:
//   wildputt.fakeiap             owned non-consumables (for Restore purchases)
//   wildputt.fakeiap.unfinished  paid purchases not consumed/acknowledged yet ({id, token}[]), like Google Play's
//   wildputt.fakeiap.pending     purchases waiting for payment; they become unfinished on the next launch
// (Ported from ¡Apágalo!.)
import { PRODUCTS, SUGGESTED_PRICE_USD, type AdProvider, type IapProvider, type PaidPurchase, type Placement, type ProductId, type Providers } from './types';

const ACCOUNT = 'wildputt.fakeiap';
const UNFINISHED = 'wildputt.fakeiap.unfinished';
const PENDING = 'wildputt.fakeiap.pending';

function read<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as T) ?? fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

const log = { rewarded: [] as string[], interstitial: [] as string[], purchases: [] as string[], finished: [] as string[] };

function fakeAds(mode: string): AdProvider {
  const fail = mode === 'fail';
  let showing = false;
  const play = (label: string, p: Placement) =>
    new Promise<void>((resolve) => {
      showing = true;
      const n = document.createElement('div');
      n.className = 'fake-ad';
      n.style.cssText = 'position:fixed;inset:0;z-index:100;display:grid;place-items:center;background:#000d;color:#fff;font:800 24px system-ui';
      n.textContent = `TEST AD · ${label} · ${p}`;
      document.body.appendChild(n);
      setTimeout(() => {
        n.remove();
        showing = false;
        resolve();
      }, 1000);
    });
  return {
    name: 'fake',
    init: async () => undefined,
    rewardedReady: () => true,
    interstitialReady: () => true,
    adShowing: () => showing,
    async showRewarded(p, onReward) {
      log.rewarded.push(p);
      await play('rewarded', p);
      if (!fail) onReward?.();
      return !fail;
    },
    async showInterstitial(p) {
      log.interstitial.push(p);
      await play('interstitial', p);
      return true;
    },
  };
}

function fakeStore(mode: string): IapProvider {
  const fail = mode === 'fail';
  const pending = mode === 'pending';
  const owned = new Set<ProductId>(read<ProductId[]>(ACCOUNT, []));
  // payments that were pending in the last session have cleared
  const cleared = read<PaidPurchase[]>(PENDING, []);
  if (cleared.length && !pending) {
    write(UNFINISHED, [...read<PaidPurchase[]>(UNFINISHED, []), ...cleared]);
    write(PENDING, []);
  }
  return {
    name: 'fake',
    init: async () => (Object.keys(PRODUCTS) as ProductId[]).map((id) => ({ id, price: `$${SUGGESTED_PRICE_USD[id]}` })),
    async purchase(id) {
      log.purchases.push(id);
      await new Promise((r) => setTimeout(r, 300));
      if (fail) return { status: 'failed' };
      const purchase = { id, token: `fake-${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
      if (pending) {
        write(PENDING, [...read<PaidPurchase[]>(PENDING, []), purchase]);
        return { status: 'pending' };
      }
      if (!PRODUCTS[id].consumable) {
        owned.add(id);
        write(ACCOUNT, [...owned]);
      }
      write(UNFINISHED, [...read<PaidPurchase[]>(UNFINISHED, []), purchase]);
      return { status: 'paid', purchase };
    },
    restore: async () => [...owned],
    unfinished: async () => read<PaidPurchase[]>(UNFINISHED, []),
    async finish(p) {
      log.finished.push(p.id);
      write(
        UNFINISHED,
        read<PaidPurchase[]>(UNFINISHED, []).filter((x) => x.token !== p.token),
      );
      if (!PRODUCTS[p.id].consumable) {
        owned.add(p.id);
        write(ACCOUNT, [...owned]);
      }
      return true;
    },
  };
}

/** `ads` / `iap`: the ?fakeads and ?fakeiap values (null: that provider is off). */
export function createFakeProviders(ads: string | null, iap: string | null): Providers {
  (window as unknown as { __fakeads: typeof log }).__fakeads = log;
  return { ads: ads ? fakeAds(ads) : null, iap: iap ? fakeStore(iap) : null };
}
