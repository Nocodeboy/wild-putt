// CrazyGames SDK v3 video ads: "midgame" (our interstitial) and "rewarded".
// https://docs.crazygames.com/sdk/video-ads/  Only used when the build sets __CG_ADS__ (CrazyGames does
// not allow ads during Basic Launch). The game mutes the audio and calls gameplayStop around every ad
// (src/monetize/index.ts), as the portal requires. No purchases on CrazyGames. (Ported from ¡Apágalo!.)
import type { AdProvider } from './types';

interface CGAdError {
  code: 'unfilled' | 'adsDisabledBasicLaunch' | 'adblock' | 'adCooldown' | 'other';
  message: string;
}
interface CGAdModule {
  requestAd(type: 'midgame' | 'rewarded', cb: { adStarted?: () => void; adFinished?: () => void; adError?: (e: CGAdError) => void }): void;
  hasAdblock?: () => Promise<boolean>;
}

/**
 * CrazyGames asks to keep the game blocked until adFinished or adError: a request runs several auctions and can
 * take a while. This is only a backstop for an SDK that never answers before the ad starts; once it has started,
 * the game's own watchdog (src/monetize/index.ts) applies, and it keeps waiting while adShowing() is true.
 */
const START_TIMEOUT_MS = 60_000;

function adModule(): CGAdModule | null {
  const sdk = (window as unknown as { CrazyGames?: { SDK?: { environment?: string; ad?: CGAdModule } } }).CrazyGames?.SDK;
  return sdk && sdk.environment !== 'disabled' && sdk.ad ? sdk.ad : null;
}

export function createCrazyGamesAds(): AdProvider {
  // ads unavailable for the rest of the session (ad blocker, or the game is still in Basic Launch)
  let off = false;
  // a request is waiting for adFinished / adError
  let open = false;

  /** Resolves `started` (the ad played, even if it ended with an error) and `finished` (adFinished: reward earned). */
  const request = (type: 'midgame' | 'rewarded') =>
    new Promise<{ started: boolean; finished: boolean }>((resolve) => {
      const ad = adModule();
      if (!ad || off) {
        resolve({ started: false, finished: false });
        return;
      }
      let started = false;
      let done = false;
      open = true;
      const end = (finished: boolean) => {
        if (done) return;
        done = true;
        open = false;
        clearTimeout(timer);
        resolve({ started: started || finished, finished });
      };
      const timer = setTimeout(() => {
        if (!started) end(false);
      }, START_TIMEOUT_MS);
      try {
        ad.requestAd(type, {
          adStarted: () => (started = true),
          adFinished: () => end(true),
          adError: (e) => {
            if (e?.code === 'adblock' || e?.code === 'adsDisabledBasicLaunch') off = true;
            end(false);
          },
        });
      } catch {
        end(false);
      }
    });

  return {
    name: 'crazygames',
    async init() {
      try {
        if (await adModule()?.hasAdblock?.()) off = true;
      } catch {
        /* keep trying ads; a failed request resolves false */
      }
    },
    rewardedReady: () => !off && !open && !!adModule(),
    interstitialReady: () => !off && !open && !!adModule(),
    adShowing: () => open,
    async showRewarded(_p, onReward) {
      const r = await request('rewarded');
      if (r.finished) onReward?.();
      return r.finished;
    },
    async showInterstitial() {
      return (await request('midgame')).started;
    },
  };
}
