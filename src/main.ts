import { initAnalytics, localeProps, setAnalyticsEnabled, sourceProps, submitDaily, track } from './analytics';
import { cloudStore, exitApp, gameplayStart, gameplayStop, happytime, isAndroid, loadingDone, onAndroidBack, platformInit } from './platform';
import { audio, vibrate } from './audio';
import { gameLink, MORE_GAMES } from './crosspromo';
import { AIM_LEN, ballById, buyAim, buyBall, claimFreeCoins, dailyCoins, FREE_COINS, freeCoinsLeft, holeCoins, MULLIGAN_COST, takeDailyReward } from './economy';
import { detectLang, fmtPar, gameName, getLang, num, scoreName, setLang, t, tx } from './i18n';
import { adBusy, buy, canReward, hasStore, initMonetize, maybeInterstitial, noteLevelEnd, restorePurchases, showRewarded, storeProducts, type Delivered } from './monetize';
import type { ProductId } from './monetize/types';
import { IC } from './ui/icons';
import { shopScreen } from './ui/shop';
import { cabinetScreen, drawTrophyCard, shareImage, trophyModal } from './ui/trophy';
import { Input, screenToWorld, type Shot } from './input';
import { Stage, type CamMode, type Tier } from './render/stage';
import type { Aim } from './render/view';
import { Bot, SKILL_DEMO, SKILL_PRO } from './sim/bot';
import { dayKey, makeDaily, type Daily } from './sim/daily';
import { DAILY_SALTS } from './sim/dailyTable';
import { champLevel, courseById, holeDef, READY, ROUTE, ROUTE_LEN, FULL_LEN } from './sim/route';
import type { HoleDef, HoleMods, SimEvent, ThemeId } from './sim/types';
import { Sim, SIM_DT } from './sim/world';
import * as store from './storage';
import type { Settings } from './storage';
import {
  $,
  banner,
  buildHud,
  cardHtml,
  clearFloaters,
  clearScreens,
  el,
  endScreen,
  esc,
  floater,
  holeEndScreen,
  holeIntroScreen,
  introScreen,
  pauseScreen,
  resetHudCache,
  moreGamesScreen,
  mulliganScreen,
  routeScreen,
  settingsScreen,
  titleScreen,
  toast,
  updateFloaters,
  updateHud,
  holeGoalsHtml,
} from './ui/ui';

declare const __MUSIC__: { menu?: string; game?: string };
declare const __GAME_URL__: string;
declare const __TARGET__: string;
declare const __PRIVACY_URL__: string;
declare const __VERSION__: string;
const TARGET_CG = typeof __TARGET__ !== 'undefined' && __TARGET__ === 'crazygames';
const PRIVACY_URL = typeof __PRIVACY_URL__ !== 'undefined' ? __PRIVACY_URL__ : '';
const GAME_URL = typeof __GAME_URL__ !== 'undefined' ? __GAME_URL__ : '';
let dailyRank: { players: number; below: number } | null = null;

type Mode = 'attract' | 'intro' | 'play' | 'between' | 'fading' | 'paused' | 'end';

interface Score {
  par: number;
  strokes?: number;
  maxed?: boolean;
}
/** What is being played: one hole of the tour, or the daily round of six. */
type Current = { kind: 'level'; n: number } | { kind: 'daily'; daily: Daily; cur: number; scores: Score[]; t0: number };

const canvas = $<HTMLCanvasElement>('#c');
const stage = new Stage(canvas);
const input = new Input($('#touch'), $('#pad'));
let save = store.load();
const firstSession = save.firstOpen;
let mode: Mode = 'attract';
/** the mulligan of this hole attempt: unused, or used (with an ad or with coins) */
let mullUsed = false;
let sim: Sim | null = null;
let bot: Bot | null = null;
let current: Current | null = null;
let acc = 0;
let time = 0;
let last = performance.now();
let betweenT = 0;
let attractIdx = Math.floor(Math.random() * 1000);
let tutorialNodes: HTMLElement[] = [];
let tutT = 0;
/** first hole of a new player: a ring round the ball and an arrow that shows the pull */
let guide: { ring: HTMLElement; arrow: HTMLElement } | null = null;
const fps = { t: 0, n: 0, slow: 0, fast: 0, down: false, up: false };
let lastTick = 0;
let holeStart = 0;
let wakeLock: { release: () => Promise<void> } | null = null;
const flags = { sway: false, lastStroke: false };

// ---------- boot ----------
setLang(save.settings.lang ?? detectLang());
audio.setSfx(save.settings.sfx);
audio.musicOn = save.settings.music;
try {
  audio.setMusicTracks(typeof __MUSIC__ !== 'undefined' ? __MUSIC__ : {});
} catch {
  /* no music bundled */
}
const isMobile = 'ontouchstart' in window && Math.min(screen.width, screen.height) < 820;
function effectiveTier(): Tier {
  const g = save.settings.gfx ?? 'auto';
  return g === 'auto' ? (save.settings.autoTier ?? (isMobile ? 'medium' : 'high')) : g;
}
stage.setTier(effectiveTier());
setAnalyticsEnabled(save.settings.stats !== false);
initAnalytics();
platformInit().finally(() => {
  const kv = cloudStore();
  if (kv && store.useCloud(kv)) {
    setLang(save.settings.lang ?? detectLang());
    audio.setSfx(save.settings.sfx);
    audio.musicOn = save.settings.music;
    stage.setTier(effectiveTier());
    setAnalyticsEnabled(save.settings.stats !== false);
    if (document.querySelector('#screens .title-screen')) showTitle();
  }
  let loaded = false;
  const done = () => {
    if (loaded) return;
    loaded = true;
    loadingDone();
  };
  requestAnimationFrame(done);
  setTimeout(done, 400);
  // ads and the store after the portal SDK is ready
  initMonetize({ firstSession, onPause: adPause, onDelivered: purchasesDelivered }).then(() => {
    if (document.querySelector('#screens .title-screen')) showTitle();
  });
});
if (save.firstOpen) {
  track('first_open', { lang: getLang(), ...localeProps(), ...sourceProps() });
  save.firstOpen = false;
  store.save();
}
track('session_start', { stars: store.totalStars(), coins: save.coins, ...localeProps(), ...sourceProps() });
document.title = getLang() === 'es' ? '¡Embócala! · Minigolf' : 'Wild Putt · Mini golf';
buildHud(pauseGame, toggleCamera, offerMulligan);
input.onPause = pauseGame;
input.onCamera = toggleCamera;
input.vibration = save.settings.vibration;
onAndroidBack(() => {
  if (adBusy()) return;
  if (mode === 'play') {
    pauseGame();
    return;
  }
  const btn = document.querySelector<HTMLElement>('#screens [data-a=back], #screens [data-a=resume], #screens [data-a=menu]');
  if (btn) btn.click();
  else if (mode === 'attract') exitApp();
});
window.addEventListener('resize', () => stage.resize());
document.addEventListener('visibilitychange', () => {
  if (document.hidden && mode === 'play') pauseGame();
});
const unlock = () => {
  audio.unlock();
  audio.music(mode === 'play' || mode === 'between' ? 'game' : 'menu');
};
window.addEventListener('pointerdown', unlock, { once: true });
// a touch during the hole flyover skips it and starts the pull straight away
window.addEventListener(
  'pointerdown',
  () => {
    if (mode === 'play' && stage.introRunning) {
      stage.skipIntro();
      input.enabled = true;
    }
  },
  { capture: true },
);
window.addEventListener('keydown', unlock, { once: true });

startAttract();
showTitle();
requestAnimationFrame(frame);

// ---------- helpers ----------
/** Around every ad: silence, stop the loop and tell the portal the game is not being played. */
function adPause(on: boolean) {
  if (on) {
    audio.duck(true);
    audio.stopLoops();
    gameplayStop();
  } else {
    audio.duck(false);
    last = performance.now();
  }
}
/** Purchases delivered outside a Buy tap (paid earlier, recovered at launch or on resume). */
function purchasesDelivered(d: Delivered) {
  if (d.coins) toast(t('bought', { n: num(d.coins) }), 'good', 3200);
  else if (d.ids.includes('remove_ads')) toast(t('boughtNoAds'), 'good', 3200);
  if (document.querySelector('#screens .shop-screen')) renderShop();
}
function lid(n: number): string {
  return `L${n}`;
}
/** A hole of the tour is open once the one before it has been finished (picked up counts). */
function unlocked(n: number): boolean {
  return n === 1 || save.best[lid(n - 1)] !== undefined;
}
function finished(n: number): boolean {
  return save.best[lid(n)] !== undefined;
}
/** The first hole not finished yet (or the last one). */
function nextLevel(): number {
  for (let n = 1; n <= ROUTE_LEN; n++) if (!finished(n)) return n;
  return ROUTE_LEN;
}
function todayDaily(): Daily {
  const base = makeDaily(new Date());
  const salt = DAILY_SALTS[base.num - 1] ?? 0;
  return salt ? makeDaily(new Date(), salt) : base;
}
function setHudVisible(v: boolean) {
  $('#hud').hidden = !v;
}
function isYesterday(key: string): boolean {
  if (!key) return false;
  const y = new Date();
  y.setDate(y.getDate() - 1);
  return dayKey(y) === key;
}
function roundStrokes(scores: Score[]): number {
  return scores.reduce((a, s) => a + (s.strokes ?? 0), 0);
}
function roundParPlayed(scores: Score[]): number {
  return scores.reduce((a, s) => a + (s.strokes !== undefined ? s.par : 0), 0);
}
function roundPar(scores: Score[]): number {
  return scores.reduce((a, s) => a + s.par, 0);
}
/** Stars of a hole: 3 under par, 2 at par, 1 finished, 0 picked up. */
function holeStars(strokes: number, par: number, maxed: boolean): number {
  return maxed ? 0 : strokes <= par - 1 ? 3 : strokes <= par ? 2 : 1;
}
/** A slingshot pull (screen) or keyboard aim (world) as a world-space putt. */
function toWorld(a: Shot): Aim {
  return a.kind === 'world' ? { angle: a.angle, power: a.power } : { angle: screenToWorld(a.dx, a.dy, stage.controlYaw), power: a.power };
}
function camMode(): CamMode {
  return save.settings.cam === 'overview' ? 'overview' : 'chase';
}
function toggleCamera() {
  if (mode !== 'play' || input.dragging) return;
  save.settings.cam = camMode() === 'chase' ? 'overview' : 'chase';
  store.save();
  stage.mode = camMode();
  audio.play('click');
  updateCamButton();
}
function updateCamButton() {
  const b = document.getElementById('hud-cam');
  if (b) b.classList.toggle('on', camMode() === 'overview');
}
/** Point the chase camera down the fairway from where the ball rests. */
function aimCamera() {
  if (!sim) return;
  stage.yawTarget = sim.guideAngle(sim.ball.x, sim.ball.z);
}
function courseOf(def: HoleDef): ThemeId {
  return def.course ?? 'garden';
}
function curHole(): { def: HoleDef; mods: HoleMods } | null {
  if (!current) return null;
  if (current.kind === 'level') return { def: holeDef(current.n), mods: {} };
  return { def: current.daily.holes[current.cur].hole, mods: current.daily.mods };
}
function levelProps(n: number): Record<string, string | number | boolean> {
  const L = ROUTE[n - 1];
  return { level: lid(n), num: n, course: L.course, champ: L.champ, intro: L.intro, par: holeDef(n).par };
}

// ---------- attract mode (the bot plays behind the menus) ----------
function startAttract() {
  // a hole from the part of the tour the player has seen (or the first stretch)
  const reach = Math.max(12, Math.min(ROUTE_LEN, nextLevel() + 4));
  const n = 1 + (attractIdx++ % reach);
  const def = holeDef(n);
  sim = new Sim(def);
  bot = new Bot(sim, SKILL_DEMO, attractIdx);
  stage.setLevel(sim, courseOf(def));
  stage.mode = 'overview';
  stage.zoom = stage.zoomTarget = 1.08;
  mode = 'attract';
  current = null;
  gameplayStop();
  setHudVisible(false);
  input.enabled = false;
  input.reset();
  clearTutorial();
}

// ---------- screens ----------
function showTitle() {
  if (mode !== 'attract') startAttract();
  audio.music('menu');
  const d = todayDaily();
  const done = !!save.daily[d.key];
  const next = nextLevel();
  const any = finished(1);
  titleScreen({
    coins: save.coins,
    trophies: save.trophies.length,
    maxTrophies: READY.length,
    onShop: () => {
      audio.play('click');
      showShop('title');
    },
    onCabinet: () => {
      audio.play('click');
      showCabinet('title');
    },
    onMore: TARGET_CG
      ? undefined
      : () => {
          audio.play('click');
          showMoreGames();
        },
    playLabel: any ? t('continue') : t('play'),
    playLevel: any ? next : null,
    stars: store.totalStars(),
    maxStars: ROUTE_LEN * 3,
    dailyNum: d.num,
    dailyDone: done,
    streak: save.streak.last === d.key || isYesterday(save.streak.last) ? save.streak.count : 0,
    privacyUrl: TARGET_CG && PRIVACY_URL && save.settings.stats !== false && !any ? PRIVACY_URL : undefined,
    onPlay: () => {
      audio.play('click');
      openLevel(next);
    },
    onLevels: () => {
      audio.play('click');
      showRoute();
    },
    onDaily: () => {
      audio.play('click');
      openDaily();
    },
    onSettings: () => {
      audio.play('click');
      showSettings();
    },
  });
}

function showRoute() {
  const next = nextLevel();
  routeScreen({
    nodes: ROUTE.map((L) => {
      const c = courseById(L.course);
      return {
        n: L.n,
        color: c.color,
        stars: save.stars[lid(L.n)] ?? 0,
        done: finished(L.n),
        locked: !unlocked(L.n),
        next: L.n === next && !finished(L.n),
        intro: L.intro,
        champ: L.champ,
        course: tx(c.name),
        courseId: c.id,
        won: L.champ && save.trophies.includes(c.id),
      };
    }),
    total: store.totalStars(),
    max: ROUTE_LEN * 3,
    trophies: save.trophies.length,
    maxTrophies: READY.length,
    more: ROUTE_LEN < FULL_LEN,
    onPick: (n) => {
      audio.play('click');
      openLevel(n);
    },
    onBack: () => {
      audio.play('click');
      showTitle();
    },
    onCabinet: () => {
      audio.play('click');
      showCabinet('route');
    },
  });
}

function showMoreGames() {
  track('more_games');
  moreGamesScreen({
    games: MORE_GAMES.map((g) => ({ id: g.id, name: tx(g.name), tag: tx(g.tag), href: gameLink(g, 'wildputt', isAndroid), color: g.color, color2: g.color2, icon: g.icon })),
    onOpen: (id) => track('crosspromo', { game: id }),
    onBack: () => {
      audio.play('click');
      showTitle();
    },
  });
}

// ---------- shop ----------
let shopFrom: 'title' | 'end' | 'route' = 'title';
function showShop(from: 'title' | 'end' | 'route') {
  shopFrom = from;
  track('shop_open', { from, coins: save.coins });
  renderShop();
}
function renderShop() {
  const today = dayKey();
  shopScreen({
    save,
    free: canReward() ? { left: freeCoinsLeft(save, today), amount: FREE_COINS } : null,
    products: hasStore() ? storeProducts() : null,
    onAim: () => {
      const cost = buyAim(save);
      if (!cost) return;
      store.save();
      audio.play('star', save.aim);
      track('upgrade', { up: 'aim', lvl: save.aim });
      track('coins_spend', { what: 'aim', n: cost });
      renderShop();
    },
    onBall: (id) => {
      if (save.balls.includes(id)) {
        save.ball = id;
        store.save();
        audio.play('click');
      } else {
        const cost = buyBall(save, id);
        if (!cost) return;
        store.save();
        audio.play('star', 2);
        toast(t('newBall'), 'good');
        track('ball', { id });
        track('coins_spend', { what: 'ball', n: cost });
      }
      renderShop();
    },
    onFree: async () => {
      const ok = await showRewarded('free_coins');
      if (ok) {
        const n = claimFreeCoins(save, dayKey());
        if (n) {
          store.save();
          audio.play('coin');
          toast(`+${num(n)}`, 'good');
          track('coins_earn', { src: 'free_coins', n });
        }
      } else toast(t('adFailed'), 'warn');
      renderShop();
    },
    onBuy: async (id: ProductId) => {
      const r = await buy(id);
      if (r === 'pending') toast(t('pendingPay'), 'good', 3200);
      else if (r === null) toast(t('buyFailed'), 'warn');
      else if (id === 'remove_ads') toast(t('boughtNoAds'), 'good', 3200);
      else toast(t('bought', { n: num(r) }), 'good', 3200);
      renderShop();
    },
    onRestore: async () => {
      const got = await restorePurchases();
      toast(got.length ? t('restored') : t('nothingToRestore'), got.length ? 'good' : '');
      renderShop();
    },
    onBack: () => {
      audio.play('click');
      if (shopFrom === 'end' && current?.kind === 'level') showRoute();
      else if (shopFrom === 'route') showRoute();
      else showTitle();
    },
  });
}

// ---------- trophies ----------
function showCabinet(from: 'title' | 'route') {
  cabinetScreen({
    slots: READY.map((c) => ({ id: c.id, name: tx(c.name), trophy: tx(c.cup), color: c.color, level: champLevel(c.id), have: save.trophies.includes(c.id) })),
    onOpen: (id) => void openTrophy(id),
    onBack: () => {
      audio.play('click');
      if (from === 'route') showRoute();
      else showTitle();
    },
  });
}
async function openTrophy(id: string, fresh = false) {
  const c = READY.find((x) => x.id === id);
  const info = save.trophyInfo[id];
  if (!c || !info) return;
  const cv = await drawTrophyCard({ course: tx(c.name), courseId: c.id, trophy: tx(c.cup), color: c.color, level: info.level, strokes: info.strokes, par: info.par, game: gameName(), url: GAME_URL });
  trophyModal({
    title: fresh ? t('trophyWon') : tx(c.cup),
    canvas: cv,
    onShare: async () => {
      const r = await shareImage(cv, `wildputt-${id}.png`, t('trophyText', { t: tx(c.cup), g: gameName() }) + (GAME_URL ? ' ' + GAME_URL : ''), gameName());
      if (r !== 'failed') track('share', { what: 'trophy', course: id });
    },
    onClose: () => undefined,
  });
}

// ---------- mulligan ----------
function mulliganAllowed(): boolean {
  return !!sim && mode === 'play' && current?.kind === 'level' && current.n > 1 && !mullUsed && sim.canMulligan() && !stage.introRunning;
}
function updateMulliganButton() {
  const b = document.getElementById('hud-mull');
  if (b) b.hidden = !mulliganAllowed();
}
function offerMulligan() {
  if (!mulliganAllowed() || input.dragging) return;
  audio.play('click');
  mode = 'paused';
  gameplayStop();
  input.reset();
  const resume = () => {
    document.querySelector('.mull-screen')?.remove();
    mode = 'play';
    gameplayStart();
    last = performance.now();
  };
  const apply = (how: 'ad' | 'coins') => {
    if (sim?.mulligan()) {
      mullUsed = true;
      for (const ev of sim.events) handleEvent(ev);
      sim.events.length = 0;
      track('mulligan', { ...levelProps((current as { n: number }).n), how });
      audio.play('portal');
    }
    resume();
  };
  mulliganScreen({
    ad: canReward(),
    cost: MULLIGAN_COST,
    balance: save.coins,
    onAd: async () => {
      const ok = await showRewarded('mulligan');
      if (ok) apply('ad');
      else {
        toast(t('adFailed'), 'warn');
        resume();
      }
    },
    onCoins: () => {
      if (save.coins < MULLIGAN_COST) return;
      save.coins -= MULLIGAN_COST;
      store.save();
      track('coins_spend', { what: 'mulligan', n: MULLIGAN_COST });
      apply('coins');
    },
    onNo: () => {
      audio.play('click');
      resume();
    },
  });
}

function showSettings() {
  const st = save.settings;
  settingsScreen({
    sfx: st.sfx,
    music: st.music,
    vibration: st.vibration,
    stats: st.stats !== false,
    privacyUrl: PRIVACY_URL || undefined,
    version: typeof __VERSION__ !== 'undefined' ? __VERSION__ : '',
    gfx: st.gfx ?? 'auto',
    lang: getLang(),
    onChange: (k, v) => {
      if (k === 'sfx') {
        st.sfx = v as boolean;
        audio.setSfx(st.sfx);
      } else if (k === 'music') {
        st.music = v as boolean;
        audio.setMusic(st.music);
      } else if (k === 'vibration') {
        st.vibration = v as boolean;
        input.vibration = st.vibration;
      } else if (k === 'stats') {
        st.stats = v as boolean;
        setAnalyticsEnabled(st.stats);
      } else if (k === 'gfx') {
        st.gfx = v as Settings['gfx'];
        stage.setTier(effectiveTier());
        fps.t = fps.n = fps.slow = fps.fast = 0;
      } else if (k === 'lang') {
        st.lang = v as 'es' | 'en';
        setLang(st.lang);
        buildHud(pauseGame, toggleCamera, offerMulligan);
        store.save();
        showSettings();
        return;
      }
      store.save();
      audio.play('click');
    },
    onReset: () => {
      store.reset();
      save = store.data();
      toast('OK', 'good');
      showTitle();
    },
    onBack: () => {
      audio.play('click');
      showTitle();
    },
  });
}

/** Show a hole on screen (card or play) without starting it. */
function loadHole() {
  const h = curHole();
  if (!h) return;
  sim = new Sim(h.def, h.mods);
  bot = null;
  stage.setLevel(sim, courseOf(h.def));
  applyLooks(current?.kind === 'daily');
  mullUsed = false;
  flags.sway = false;
  flags.lastStroke = false;
  clearFloaters();
  input.reset();
  input.resetAim();
  stage.mode = camMode();
}

/** The player's ball and aim line on the hole on screen (the daily round always has the plain aim line). */
function applyLooks(daily: boolean) {
  const v = stage.view;
  if (!v) return;
  const b = ballById(save.ball);
  v.setBall(b.c1, b.c2, b.pattern, b.trail);
  const lvl = daily ? 0 : save.aim;
  v.aimLen = AIM_LEN[lvl];
  v.aimBounces = lvl >= 3 ? 2 : 1;
}

/** A hole of the tour: its card, or straight onto the green for the first two holes (one click to play). */
function openLevel(n: number) {
  n = Math.max(1, Math.min(ROUTE_LEN, n));
  current = { kind: 'level', n };
  loadHole();
  if (n <= 2 && !finished(n)) {
    startPlay();
    return;
  }
  const L = ROUTE[n - 1];
  const def = holeDef(n);
  const c = courseById(L.course);
  mode = 'intro';
  setHudVisible(false);
  input.enabled = false;
  stage.zoomTarget = stage.reducedMotion ? 1 : 1.12;
  holeIntroScreen({
    eyebrow: `${t('holeNum', { n })} · ${tx(c.name)}`,
    title: tx(def.name),
    tip: tx(def.tip ?? c.tip),
    par: def.par,
    color: c.color,
    courseId: c.id,
    course: L.intro ? { name: tx(c.name), star: tx(c.tip) } : null,
    champ: L.champ ? { trophy: tx(c.cup) } : null,
    best: save.best[lid(n)],
    onGo: () => startPlay(),
    onBack: () => {
      audio.play('click');
      startAttract();
      showRoute();
    },
  });
}

function openDaily() {
  const d = todayDaily();
  current = { kind: 'daily', daily: d, cur: 0, scores: d.holes.map((h) => ({ par: h.hole.par })), t0: performance.now() };
  loadHole();
  mode = 'intro';
  setHudVisible(false);
  input.enabled = false;
  const rec = save.daily[d.key];
  const par = d.holes.reduce((a, h) => a + h.hole.par, 0);
  introScreen({
    eyebrow: t('daily'),
    title: t('dailyTitle', { n: d.num }),
    tip: rec ? t('dailyPlayed', { s: `${rec.score} (${fmtPar(rec.score - par)})` }) : tx(d.mod.label),
    holes: d.holes.map((h) => h.hole),
    extra: `<span class="pill">⚡ ${tx(d.mod.label)}</span>`,
    onGo: () => startPlay(),
    onBack: () => {
      audio.play('click');
      startAttract();
      showTitle();
    },
  });
  track('daily_open', { num: d.num, mod: d.mod.key, played: !!rec });
}

function startPlay() {
  if (!sim || !current) return;
  audio.unlock();
  audio.music('game');
  clearScreens();
  resetHudCache();
  setHudVisible(true);
  stage.focus = null;
  stage.zoomTarget = 1;
  mode = 'play';
  gameplayStart();
  input.enabled = true;
  input.reset();
  input.resetAim();
  stage.mode = camMode();
  stage.intro();
  updateCamButton();
  acc = 0;
  holeStart = performance.now();
  if (current.kind === 'level') {
    track('level_start', levelProps(current.n));
    if (current.n === 1 && !save.tutorialDone) showTutorial();
  } else {
    if (current.cur === 0) track('daily_start', { num: current.daily.num });
    track('level_start', { level: `daily-${current.daily.num}`, hole: current.cur + 1, src: lid(current.daily.holes[current.cur].n) });
  }
  showHoleName();
  try {
    (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock
      ?.request('screen')
      .then((w) => (wakeLock = w))
      .catch(() => undefined);
  } catch {
    /* ignore */
  }
}

/** Big card while the camera flies in: hole number, name and par (and, on a skipped presentation, the tip). */
function showHoleName() {
  if (!current || !sim) return;
  document.querySelector('.holecard')?.remove();
  const def = sim.def;
  const small = current.kind === 'level' ? t('holeNum', { n: current.n }) : `${t('hole')} ${current.cur + 1}/${current.daily.holes.length}`;
  const L = current.kind === 'level' ? ROUTE[current.n - 1] : null;
  const tip = L && L.intro && current.kind === 'level' && current.n <= 2 && current.n > 1 ? `<i>${esc(tx(courseById(L.course).tip))}</i>` : '';
  const n = el(`<div class="holecard${tip ? ' long' : ''}"><small>${small}</small><b>${esc(tx(def.name))}</b><span>${t('par')} ${def.par}</span>${tip}</div>`);
  $('#app').appendChild(n);
  const ms = tip ? 3600 : 1700;
  setTimeout(() => n.classList.add('out'), ms);
  setTimeout(() => n.remove(), ms + 500);
}

function pauseGame() {
  if (mode !== 'play' || !current || !sim) return;
  mode = 'paused';
  gameplayStop();
  input.reset();
  audio.stopLoops();
  audio.duck(true);
  const goals =
    current.kind === 'daily'
      ? `<div class="eyebrow">${t('goalsNow')}</div>` + cardHtml(current.scores, current.cur)
      : `<div class="eyebrow">${t('goalsNow')}</div>` + holeGoalsHtml(sim.def.par);
  pauseScreen({
    goals,
    sfx: save.settings.sfx,
    music: save.settings.music,
    onResume: () => {
      clearScreens();
      mode = 'play';
      gameplayStart();
      audio.duck(false);
      last = performance.now();
    },
    onRestart: () => {
      audio.duck(false);
      retry();
    },
    onMenu: () => {
      audio.duck(false);
      track('level_quit', current?.kind === 'level' ? levelProps(current.n) : { level: sim?.def.id ?? '' });
      startAttract();
      showTitle();
    },
    onSfx: (on) => {
      save.settings.sfx = on;
      audio.setSfx(on);
      store.save();
    },
    onMusic: (on) => {
      save.settings.music = on;
      audio.setMusic(on);
      store.save();
    },
  });
}

/** Play the same hole (or the daily round) again, straight away. */
function retry() {
  if (!current) return;
  if (current.kind === 'daily') {
    const d = current.daily;
    current = { kind: 'daily', daily: d, cur: 0, scores: d.holes.map((h) => ({ par: h.hole.par })), t0: performance.now() };
  }
  loadHole();
  startPlay();
}

// ---------- tutorial and the first-hole guide ----------
function showTutorial() {
  clearTutorial();
  const app = $('#app');
  if (input.mode === 'touch') tutorialNodes = [el(`<div class="tut one"><div class="ghost pull"><i></i></div><div>${t('tutTouch')}<br><b>${t('tutTouch2')}</b></div></div>`)];
  else tutorialNodes = [el(`<div class="tut desk">${t('tutDesk')}</div>`)];
  tutorialNodes.forEach((n) => app.appendChild(n));
  input.usedAim = false;
  input.usedShot = false;
  tutT = 0;
  guide = { ring: el('<div class="guide-ring"></div>'), arrow: el('<div class="guide-arrow"><i></i></div>') };
  app.appendChild(guide.ring);
  app.appendChild(guide.arrow);
}
function clearTutorial() {
  tutorialNodes.forEach((n) => n.remove());
  tutorialNodes = [];
  guide?.ring.remove();
  guide?.arrow.remove();
  guide = null;
}
/** Keep the guide on the ball: the ring round it, the arrow showing which way to pull (straight back from the cup). */
function updateGuide() {
  if (!guide || !sim) return;
  const show = mode === 'play' && sim.state === 'aim' && sim.strokes === 0 && !input.dragging && !stage.introRunning;
  guide.ring.style.opacity = guide.arrow.style.opacity = show ? '1' : '0';
  if (!show) return;
  const b = sim.ball;
  const p = stage.toScreen(b.x, 0.2, b.z);
  // pull direction on screen: from the cup back past the ball
  const c = stage.toScreen(sim.cup.x, 0, sim.cup.z);
  const ang = Math.atan2(p.y - c.y, p.x - c.x);
  guide.ring.style.transform = `translate(${p.x}px, ${p.y}px)`;
  guide.arrow.style.transform = `translate(${p.x}px, ${p.y}px) rotate(${ang}rad)`;
}

// ---------- events -> feedback ----------
function handleEvent(ev: SimEvent) {
  const s = sim!;
  stage.view?.onEvent(ev);
  const vib = save.settings.vibration;
  switch (ev.type) {
    case 'putt':
      audio.play('putt', ev.n ?? 0.5);
      if (vib) vibrate(10);
      if (s.def.sway && !flags.sway) {
        flags.sway = true;
        toast(t('tSway'), '', 2200);
      }
      break;
    case 'wall':
      audio.play('wall', ev.n ?? 1);
      break;
    case 'bumper':
      audio.play('bumper');
      if (vib) vibrate(15);
      break;
    case 'spinner':
      audio.play('spinner');
      break;
    case 'mover':
      audio.play('mover');
      break;
    case 'lip':
      audio.play('lip');
      floater(t('tLip'), ev.x, 0.8, ev.z, 'warn');
      break;
    case 'sand':
      audio.play('sand');
      break;
    case 'water':
      audio.play('water');
      floater(t('tWater'), ev.x, 1, ev.z, 'bad');
      if (vib) vibrate([30, 30, 40]);
      break;
    case 'void':
      audio.play('void');
      floater(t('tVoid'), ev.x, 1, ev.z, 'bad');
      if (vib) vibrate([30, 30, 40]);
      break;
    case 'lava':
      audio.play('lava');
      floater(t('tLava'), ev.x, 1, ev.z, 'bad');
      if (vib) vibrate([40, 30, 60]);
      break;
    case 'lavaRise':
      audio.play('lavaRise');
      toast(t('tLavaRise'), 'warn', 1600);
      break;
    case 'sunk': {
      audio.play('cup');
      const d = (ev.n ?? 3) - s.def.par;
      const great = ev.n === 1 ? 3 : d <= -1 ? 2 : d === 0 ? 1 : 0;
      setTimeout(() => audio.play('cheer', great), 250);
      if (vib) vibrate(great >= 2 ? [20, 40, 20, 40, 60] : 20);
      if (ev.n === 1) save.aces = (save.aces ?? 0) + 1;
      // the camera drops in on the cup
      stage.focus = { x: s.cup.x, z: s.cup.z };
      if (!stage.reducedMotion) stage.zoomTarget = ev.n === 1 ? 0.6 : 0.75;
      break;
    }
    case 'maxed':
      audio.play('groan');
      break;
    case 'portal':
      audio.play('portal');
      if (vib) vibrate(12);
      break;
    case 'boost':
      audio.play('boost');
      if (vib) vibrate(12);
      break;
    case 'jump':
      audio.play('jump');
      break;
    case 'land':
      audio.play('land');
      if (vib) vibrate(18);
      break;
    case 'flood':
      audio.play('water');
      floater(t('tFlood'), ev.x, 1, ev.z, 'bad');
      if (vib) vibrate([30, 30, 40]);
      break;
    case 'coin':
      audio.play('coin');
      floater('+5', ev.x, 0.8, ev.z, 'good');
      if (vib) vibrate(8);
      break;
    case 'rest':
      aimCamera();
      if (s.strokes === s.maxStrokes - 1 && !flags.lastStroke) {
        flags.lastStroke = true;
        toast(t('tLastStroke'), 'warn', 1800);
      }
      break;
  }
}

/** The hole is over: score it, then the end screen (tour) or the next hole (daily). */
function holeDone() {
  const s = sim!;
  const cur = current!;
  const res = s.result!;
  const name = scoreName(res.strokes, res.par, res.maxed);
  const d = res.strokes - res.par;
  banner(name, d <= 0 && !res.maxed ? 'win' : 'lose');
  const dur = Math.round((performance.now() - holeStart) / 1000);
  input.enabled = false;
  input.reset();
  clearTutorial();
  if (cur.kind === 'daily') {
    cur.scores[cur.cur].strokes = res.strokes;
    cur.scores[cur.cur].maxed = res.maxed;
    track('level_complete', { level: `daily-${cur.daily.num}`, hole: cur.cur + 1, strokes: res.strokes, par: res.par, maxed: res.maxed, dur });
    mode = 'between';
    betweenT = 2.0;
    return;
  }
  const n = cur.n;
  const id = lid(n);
  const st = holeStars(res.strokes, res.par, res.maxed);
  const prevBest = save.best[id];
  const newBest = prevBest !== undefined && res.strokes < prevBest;
  if (prevBest === undefined || res.strokes < prevBest) save.best[id] = res.strokes;
  save.stars[id] = Math.max(save.stars[id] ?? 0, st);
  if (n === 1) save.tutorialDone = true;
  const L = ROUTE[n - 1];
  const c = courseById(L.course);
  let trophy = false;
  if (L.champ && !res.maxed && res.strokes <= res.par && !save.trophies.includes(c.id)) {
    trophy = true;
    save.trophies.push(c.id);
    save.trophyInfo[c.id] = { level: n, strokes: res.strokes, par: res.par, at: Date.now() };
    track('trophy', { course: c.id, level: id, strokes: res.strokes, par: res.par });
  }
  const picked = s.coinsGot.length;
  const coins = holeCoins(st, res.strokes, picked, L.champ);
  save.coins += coins;
  noteLevelEnd();
  store.save();
  track('coins_earn', { src: 'hole', n: coins });
  track('level_complete', { ...levelProps(n), strokes: res.strokes, stars: st, maxed: res.maxed, dur, picked, mull: mullUsed });
  mode = 'end';
  gameplayStop();
  wakeLock?.release().catch(() => undefined);
  wakeLock = null;
  if (st === 3) happytime();
  setTimeout(() => showHoleEnd(n, res.strokes, res.par, res.maxed, st, newBest, trophy, coins), 1500);
}

/** Leaving the end screen with Next: the interstitial (if its caps allow one) and then the next hole. */
async function leaveEnd(go: () => void) {
  await maybeInterstitial();
  go();
}

function showHoleEnd(n: number, strokes: number, par: number, maxed: boolean, st: number, newBest: boolean, trophy: boolean, coins: number) {
  if (mode !== 'end' || current?.kind !== 'level' || current.n !== n) return;
  setHudVisible(false);
  audio.play(st >= 2 ? 'win' : 'lose');
  const L = ROUTE[n - 1];
  const c = courseById(L.course);
  const hasNext = n < ROUTE_LEN;
  const extra = trophy ? `<button class="trophy-won" data-a="trophy" style="--c:${c.color}"><span>🏆</span><b>${esc(tx(c.cup))}</b></button>` : '';
  let doubled = false;
  if (trophy) setTimeout(() => void openTrophy(c.id, true), 2600);
  holeEndScreen({
    eyebrow: `${t('holeNum', { n })} · ${tx(c.name)}`,
    title: maxed ? t('pickedUp') : scoreName(strokes, par, false),
    win: !maxed && strokes <= par,
    stars: st,
    strokes,
    par,
    best: save.best[lid(n)] ?? 0,
    newBest,
    hasNext,
    extraHtml: extra,
    coins,
    balance: save.coins,
    canDouble: canReward() && coins > 0,
    onDouble: async () => {
      if (doubled) return null;
      const ok = await showRewarded('double_coins');
      if (!ok) {
        toast(t('adFailed'), 'warn');
        return null;
      }
      doubled = true;
      save.coins += coins;
      store.save();
      track('coins_earn', { src: 'double_coins', n: coins });
      return { coins: coins * 2, balance: save.coins };
    },
    onShop: () => {
      audio.play('click');
      showShop('end');
    },
    onTrophy: () => void openTrophy(c.id),
    onCoin: () => audio.play('tick'),
    onNext: () => {
      audio.play('click');
      // the first holes go straight on; later ones show their card
      void leaveEnd(() => openLevel(n + 1));
    },
    onRetry: () => {
      audio.play('click');
      retry();
    },
    onMenu: () => {
      audio.play('click');
      startAttract();
      showTitle();
    },
    onRoute: () => {
      audio.play('click');
      startAttract();
      showRoute();
    },
    onStar: (i) => {
      audio.play('star', i);
      if (save.settings.vibration) vibrate(15);
    },
  });
}

/** Daily round: on to the next of its six holes. */
function nextHole() {
  const cur = current;
  if (!cur || cur.kind !== 'daily') return;
  if (cur.cur + 1 < cur.daily.holes.length) {
    const fade = $('#fade');
    fade.classList.add('on');
    setTimeout(() => {
      cur.cur++;
      loadHole();
      mode = 'play';
      input.enabled = true;
      stage.focus = null;
      stage.zoom = stage.zoomTarget = 1;
      stage.intro();
      holeStart = performance.now();
      track('level_start', { level: `daily-${cur.daily.num}`, hole: cur.cur + 1, src: lid(cur.daily.holes[cur.cur].n) });
      showHoleName();
      fade.classList.remove('on');
    }, 260);
    mode = 'fading';
  } else finishDaily();
}

function roundStars(total: number, par: number): number {
  return total <= par - 2 ? 3 : total <= par ? 2 : 1;
}

function shareFor(cur: Extract<Current, { kind: 'daily' }>): string {
  const tot = roundStrokes(cur.scores);
  const par = roundPar(cur.scores);
  const row = cur.scores.map((s) => (s.strokes === 1 ? '⭐' : (s.strokes ?? 9) < s.par ? '🟩' : s.strokes === s.par ? '🟨' : (s.strokes ?? 9) === s.par + 1 ? '🟧' : '🟥')).join('');
  const head = `${gameName()} ⛳ ${t('dailyTitle', { n: cur.daily.num })}`;
  const rank = dailyRank && dailyRank.players > 1 ? ` · 🏆 Top ${Math.max(1, 100 - rankPct(dailyRank))}%` : '';
  return `${head}\n${tot} (${fmtPar(tot - par)}) ${row}${rank}${GAME_URL ? '\n' + GAME_URL : ''}`;
}
function rankPct(rk: { players: number; below: number }): number {
  return Math.round((rk.below / Math.max(1, rk.players - 1)) * 100);
}
function rankText(rk: { players: number; below: number }): string {
  return rk.players <= 1 ? t('dailyFirst') : t('dailyRank', { p: rankPct(rk), n: rk.players.toLocaleString() });
}

function finishDaily() {
  const cur = current;
  if (!cur || cur.kind !== 'daily') return;
  const d = cur.daily;
  const tot = roundStrokes(cur.scores);
  const par = roundPar(cur.scores);
  const st = roundStars(tot, par);
  const dur = Math.round((performance.now() - cur.t0) / 1000);
  const prev = save.daily[d.key];
  let newBest = false;
  if (!prev || tot < prev.score) {
    newBest = !!prev;
    save.daily[d.key] = { score: tot, stars: st, ratio: tot / par, time: dur, win: true };
  }
  if (save.streak.last !== d.key) {
    save.streak.count = isYesterday(save.streak.last) ? save.streak.count + 1 : 1;
    save.streak.last = d.key;
  }
  const best = save.daily[d.key].score;
  // the first result of the day pays coins (at most 3 times in 24 h, whatever the phone's date)
  let dCoins = 0;
  if (!prev && takeDailyReward(save)) {
    const holeSt = cur.scores.reduce((a, sc) => a + holeStars(sc.strokes ?? sc.par + 3, sc.par, !!sc.maxed), 0);
    dCoins = dailyCoins(holeSt);
    save.coins += dCoins;
    track('coins_earn', { src: 'daily', n: dCoins });
  }
  noteLevelEnd();
  dailyRank = null;
  // the shared leaderboard ranks higher scores better: send "par − strokes" so fewer strokes rank higher
  submitDaily(d.key, d.num, 1000 + par - tot, st, tot / par, dur).then((rk) => {
    dailyRank = rk;
    const node = document.getElementById('end-rank');
    if (!node || !rk) return;
    node.hidden = false;
    node.textContent = rankText(rk);
  });
  track('daily_complete', { num: d.num, strokes: tot, par, stars: st, mod: d.mod.key, dur });
  store.save();
  mode = 'end';
  gameplayStop();
  if (st === 3) happytime();
  setHudVisible(false);
  clearTutorial();
  wakeLock?.release().catch(() => undefined);
  wakeLock = null;
  audio.play('win');
  endScreen({
    stars: st,
    eyebrow: t('dailyTitle', { n: d.num }),
    card: cardHtml(cur.scores),
    total: tot,
    par,
    best,
    newBest,
    hasNext: false,
    footer: t('dailyAgain', { n: d.num + 1 }),
    extraHtml: `<div id="end-rank" class="rank" hidden></div>${dCoins ? `<div class="coinbox"><div class="earn">${IC.coin}<b>+${num(dCoins)}</b></div></div>` : ''}`,
    shareText: () => shareFor(cur),
    onNext: () => undefined,
    onRetry: () => {
      audio.play('click');
      retry();
    },
    onMenu: () => {
      audio.play('click');
      startAttract();
      showTitle();
    },
    onShared: () => track('share', { level: `daily-${d.num}`, strokes: tot }),
    onStar: (i) => {
      audio.play('star', i);
      if (save.settings.vibration) vibrate(15);
    },
  });
}

// ---------- main loop ----------
function adaptQuality(raw: number) {
  if ((save.settings.gfx ?? 'auto') !== 'auto' || document.hidden || mode === 'paused') return;
  if (raw > 0.2) return;
  fps.t += raw;
  fps.n++;
  if (fps.t < 2.5) return;
  const avg = fps.t / fps.n;
  fps.t = fps.n = 0;
  fps.slow = avg > 1 / 40 ? fps.slow + 1 : 0;
  fps.fast = avg < 1 / 55 ? fps.fast + 1 : 0;
  const tier = stage.tier;
  let next: Tier | null = null;
  if (fps.slow >= 2 && tier !== 'low') {
    next = tier === 'high' ? 'medium' : 'low';
    fps.down = true;
  } else if (fps.fast >= 5 && tier === 'medium' && !fps.down && !fps.up) {
    next = 'high';
    fps.up = true;
  }
  if (next) {
    fps.slow = fps.fast = 0;
    stage.setTier(next);
    save.settings.autoTier = next;
    store.save();
    track('quality_tier', { tier: next, ms: Math.round(avg * 1000) });
  }
}

const raf = { prev: 0, samples: [] as number[], cap: false };
function frame(now: number) {
  requestAnimationFrame(frame);
  if (raf.samples.length < 40) {
    if (raf.prev) raf.samples.push(now - raf.prev);
    raf.prev = now;
    if (raf.samples.length === 40) {
      const sorted = [...raf.samples].sort((a, b) => a - b);
      raf.cap = sorted[20] < 9.6;
    }
  }
  if (raf.cap && now - lastTick < 12) return;
  lastTick = now;
  const raw = (now - last) / 1000;
  let dt = raw;
  last = now;
  if (dt > 0.1) dt = 0.1;
  if (dt < 0) dt = 0;
  if (rec.manual) return;
  adaptQuality(raw);
  tick(dt);
}

/** Offline recording (promo videos, covers): the page stops its own loop and advances exactly when asked. */
const rec = { manual: false, driver: null as Bot | null, render: true };

function tick(dt: number) {
  const s = sim;
  if (!s) return;
  let steps = 0;
  if (mode === 'play' || mode === 'between' || (mode === 'end' && current?.kind === 'level')) {
    // the player can putt once the camera has flown in
    input.enabled = mode === 'play' && !stage.introRunning;
    stage.lockYaw = input.dragging;
    if (mode === 'play' && s.state === 'aim') {
      const kb = input.poll(dt, stage.yaw);
      // keyboard aiming turns the chase camera with the aim
      if (kb && input.aim?.kind === 'world') stage.yawTarget = input.aim.angle;
      const driver = rec.driver;
      if (driver) driver.update();
      else {
        const shot = input.takeShot();
        if (shot) {
          const w = toWorld(shot);
          s.shoot(w.angle, w.power);
          input.resetAim();
        }
      }
    }
    acc += dt;
    while (acc >= SIM_DT && steps < 14) {
      s.step();
      for (const ev of s.events) handleEvent(ev);
      s.events.length = 0;
      acc -= SIM_DT;
      steps++;
    }
    if (acc > SIM_DT * 3) acc = 0;
    if (mode === 'play' && s.state === 'done') holeDone();
  } else if (mode === 'attract' && bot) {
    bot.update(30);
    acc += dt;
    while (acc >= SIM_DT && steps < 14) {
      s.step();
      for (const ev of s.events) stage.view?.onEvent(ev);
      s.events.length = 0;
      acc -= SIM_DT;
      steps++;
    }
    if (s.state === 'done') {
      startAttract();
      return;
    }
  } else if (mode === 'intro') {
    // moving obstacles keep moving while the card is up
    acc += dt;
    while (acc >= SIM_DT && steps < 14) {
      s.step();
      s.events.length = 0;
      acc -= SIM_DT;
      steps++;
    }
  }
  if (stage.view) stage.view.aim = mode === 'play' && s.state === 'aim' && input.aim ? toWorld(input.aim) : null;
  const paused = mode === 'paused';
  time += paused ? 0 : dt;
  if (rec.render) stage.frame(paused ? 0 : dt, time);

  if (current && (mode === 'play' || mode === 'between' || mode === 'fading')) {
    audio.loops(stage.theme.surround, dt);
    if (current.kind === 'level') {
      updateHud({ hole: current.n, holes: 0, name: tx(s.def.name), par: s.def.par, strokes: s.strokes, max: s.maxStrokes, total: 0, totalPar: -1 });
    } else {
      const cur = current;
      updateHud({
        hole: cur.cur + 1,
        holes: cur.daily.holes.length,
        name: tx(s.def.name),
        par: s.def.par,
        strokes: s.strokes,
        max: s.maxStrokes,
        total: roundStrokes(cur.scores),
        totalPar: roundParPlayed(cur.scores),
      });
    }
    if (tutorialNodes.length) {
      tutT += dt;
      if (input.usedShot || tutT > 40) {
        tutorialNodes.forEach((n) => n.remove());
        tutorialNodes = [];
      }
    }
  }
  updateGuide();
  updateMulliganButton();
  if (mode === 'between') {
    betweenT -= dt;
    if (betweenT <= 0) nextHole();
  }
  updateFloaters(stage, dt);
}

// test hook (used by the screenshot and video tools)
(window as unknown as { __golf: unknown }).__golf = {
  get mode() {
    return mode;
  },
  get sim() {
    return sim;
  },
  get current() {
    return current;
  },
  get input() {
    return input;
  },
  get save() {
    return save;
  },
  get info() {
    const r = stage.renderer.info;
    return { calls: r.render.calls, tris: r.render.triangles, geos: r.memory.geometries, tex: r.memory.textures };
  },
  stage,
  openLevel,
  openDaily,
  startPlay,
  showRoute,
  champLevel,
  /** jump to a hole of the daily round (testing only) */
  goHole(i: number) {
    if (current?.kind !== 'daily') return;
    current.cur = i;
    loadHole();
  },
  /** let the PRO bot putt for the next `sec` seconds (testing only) */
  bot(sec: number) {
    if (!sim) return;
    rec.driver = new Bot(sim, SKILL_PRO);
    const n = Math.round(sec / SIM_DT);
    for (let i = 0; i < n && sim.state !== 'done'; i++) {
      if (sim.state === 'aim') rec.driver.update();
      sim.step();
      for (const ev of sim.events) handleEvent(ev);
      sim.events.length = 0;
      if (i % 6 === 0) stage.view?.update(SIM_DT * 6, (time += SIM_DT * 6), stage.pxScale);
    }
    rec.driver = null;
  },
  /** promo recording: take over the loop; the bot plays */
  recStart() {
    rec.manual = true;
    rec.driver = sim ? new Bot(sim, SKILL_PRO) : null;
  },
  recTick(dt: number, n = 1) {
    for (let i = 0; i < n; i++) {
      rec.render = i === n - 1;
      tick(dt);
    }
    rec.render = true;
  },
};
