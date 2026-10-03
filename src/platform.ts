// Portal integrations. Only the CrazyGames build loads their SDK; every call is a no-op elsewhere.

declare const __TARGET__: string;
declare const __CG_ADS__: boolean;
const TARGET = typeof __TARGET__ !== 'undefined' ? __TARGET__ : 'web';
/** Ads only from Full Launch on (CG_ADS=1 at build time): in Basic Launch CrazyGames serves none. */
const CG_ADS = typeof __CG_ADS__ !== 'undefined' ? __CG_ADS__ : false;

interface CGSDK {
  init: () => Promise<void>;
  environment: 'local' | 'crazygames' | 'disabled';
  game: { loadingStart: () => void; loadingStop: () => void; gameplayStart: () => void; gameplayStop: () => void; happytime: () => void };
  data?: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void };
  ad?: { requestAd: (type: 'midgame' | 'rewarded', cb: { adStarted?: () => void; adFinished?: () => void; adError?: (e: unknown) => void }) => void };
}

let sdk: CGSDK | null = null;
let playing = false;

function cg(): CGSDK | null {
  const w = window as unknown as { CrazyGames?: { SDK?: CGSDK } };
  return w.CrazyGames?.SDK ?? null;
}

function safe(f: () => void) {
  try {
    if (sdk && sdk.environment !== 'disabled') f();
  } catch {
    /* the portal SDK must never break the game */
  }
}

export async function platformInit() {
  if (TARGET !== 'crazygames') return;
  const s = cg();
  if (!s) return;
  try {
    await s.init();
    sdk = s;
    safe(() => s.game.loadingStart());
  } catch {
    sdk = null;
  }
}

/** CrazyGames Data module for progress save (null elsewhere or when the SDK is unavailable). */
export function cloudStore(): { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void } | null {
  if (!sdk || sdk.environment === 'disabled' || !sdk.data) return null;
  const d = sdk.data;
  return { getItem: (k) => d.getItem(k), setItem: (k, v) => d.setItem(k, v) };
}

export function loadingDone() {
  safe(() => sdk!.game.loadingStop());
}

export function gameplayStart() {
  if (playing) return;
  playing = true;
  safe(() => sdk!.game.gameplayStart());
}

export function gameplayStop() {
  if (!playing) return;
  playing = false;
  safe(() => sdk!.game.gameplayStop());
}

export function happytime() {
  safe(() => sdk!.game.happytime());
}

export const isCrazyGames = TARGET === 'crazygames';

/** CrazyGames video ads can be requested (CG_ADS build, SDK ready, ad module present). The web build has none. */
export function adsAvailable(): boolean {
  return CG_ADS && !!sdk && sdk.environment !== 'disabled' && !!sdk.ad;
}
export const isAndroid = TARGET === 'android';

interface CapApp {
  addListener: (ev: 'backButton' | 'resume', cb: () => void) => unknown;
  exitApp: () => Promise<void>;
}
function capApp(): CapApp | null {
  const w = window as unknown as { Capacitor?: { Plugins?: { App?: CapApp } } };
  return w.Capacitor?.Plugins?.App ?? null;
}

/** Android hardware/gesture back: the game decides what "back" means on each screen. */
export function onAndroidBack(handler: () => void) {
  if (!isAndroid) return;
  try {
    capApp()?.addListener('backButton', handler);
  } catch {
    /* not running inside the app */
  }
}

export function exitApp() {
  capApp()
    ?.exitApp()
    .catch(() => undefined);
}

/** The app comes back to the foreground (Android): look for purchases paid meanwhile. A no-op elsewhere. */
export function onAppResume(handler: () => void) {
  if (!isAndroid) return;
  try {
    capApp()?.addListener('resume', handler);
  } catch {
    /* not running inside the app */
  }
}
