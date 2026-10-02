import { initAnalytics, localeProps, setAnalyticsEnabled, submitDaily, track } from './analytics';
import { cloudStore, exitApp, gameplayStart, gameplayStop, happytime, loadingDone, onAndroidBack, platformInit } from './platform';
import { audio, vibrate } from './audio';
import { detectLang, fmtPar, gameName, getLang, scoreName, setLang, t, tx } from './i18n';
import { Input } from './input';
import { Stage, type Tier } from './render/stage';
import { Bot, SKILL_DEMO, SKILL_PRO } from './sim/bot';
import { ALL_HOLES, COURSES } from './sim/courses';
import { dayKey, makeDaily, type Daily } from './sim/daily';
import { DAILY_SALTS } from './sim/dailyTable';
import type { CourseDef, HoleDef, HoleMods, SimEvent } from './sim/types';
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
  coursePar,
  el,
  endScreen,
  floater,
  goalsHtml,
  introScreen,
  levelsScreen,
  pauseScreen,
  resetHudCache,
  settingsScreen,
  titleScreen,
  toast,
  updateFloaters,
  updateHud,
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

type Mode = 'attract' | 'intro' | 'play' | 'between' | 'paused' | 'end';

interface Score {
  par: number;
  strokes?: number;
  maxed?: boolean;
}
interface Round {
  kind: 'course' | 'daily';
  index: number; // course index (course rounds)
  daily?: Daily;
  holes: { course: CourseDef; hole: HoleDef }[];
  mods: HoleMods;
  cur: number;
  scores: Score[];
  t0: number;
}

const canvas = $<HTMLCanvasElement>('#c');
const stage = new Stage(canvas);
const input = new Input($('#touch'), $('#pad'));
let save = store.load();
let mode: Mode = 'attract';
let sim: Sim | null = null;
let bot: Bot | null = null;
let round: Round | null = null;
let acc = 0;
let time = 0;
let last = performance.now();
let betweenT = 0;
let attractIdx = Math.floor(Math.random() * ALL_HOLES.length);
let tutorialNodes: HTMLElement[] = [];
let tutT = 0;
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
});
if (save.firstOpen) {
  track('first_open', { lang: getLang(), ...localeProps() });
  save.firstOpen = false;
  store.save();
}
track('session_start', { stars: store.totalStars(), ...localeProps() });
document.title = getLang() === 'es' ? '¡Embócala! · Minigolf' : 'Wild Putt · Mini golf';
buildHud(pauseGame);
input.onPause = pauseGame;
onAndroidBack(() => {
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
window.addEventListener('keydown', unlock, { once: true });

startAttract();
showTitle();
requestAnimationFrame(frame);

// ---------- helpers ----------
function unlocked(i: number): boolean {
  if (i === 0) return true;
  return (save.stars[COURSES[i - 1].id] ?? 0) >= 1;
}
function nextCourseIndex(): number {
  for (let i = 0; i < COURSES.length; i++) if (!save.stars[COURSES[i].id]) return unlocked(i) ? i : Math.max(0, i - 1);
  return COURSES.length - 1;
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
function roundStrokes(r: Round): number {
  return r.scores.reduce((a, s) => a + (s.strokes ?? 0), 0);
}
function roundParPlayed(r: Round): number {
  return r.scores.reduce((a, s) => a + (s.strokes !== undefined ? s.par : 0), 0);
}
function roundPar(r: Round): number {
  return r.scores.reduce((a, s) => a + s.par, 0);
}
function cupAngle(s: Sim): number {
  return Math.atan2(s.cup.z - s.ball.z, s.cup.x - s.ball.x);
}

// ---------- attract mode (the bot plays behind the menus) ----------
function startAttract() {
  const h = ALL_HOLES[attractIdx % ALL_HOLES.length];
  attractIdx++;
  sim = new Sim(h.hole);
  bot = new Bot(sim, SKILL_DEMO, attractIdx);
  stage.setLevel(sim, h.course.id);
  stage.zoom = stage.zoomTarget = 1.08;
  mode = 'attract';
  round = null;
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
  const next = nextCourseIndex();
  const anyStars = store.totalStars() > 0;
  titleScreen({
    playLabel: anyStars ? t('continue') : t('play'),
    playLevel: anyStars ? COURSES[next].num : null,
    stars: store.totalStars(),
    maxStars: COURSES.length * 3,
    dailyNum: d.num,
    dailyDone: done,
    streak: save.streak.last === d.key || isYesterday(save.streak.last) ? save.streak.count : 0,
    privacyUrl: TARGET_CG && PRIVACY_URL && save.settings.stats !== false && !anyStars ? PRIVACY_URL : undefined,
    onPlay: () => {
      audio.play('click');
      // very first game: straight onto hole 1 (the tutorial explains it) — one click from the title to playing
      if (!anyStars && !save.tutorialDone && next === 0) startCourse(0, true);
      else openCourse(next);
    },
    onLevels: () => {
      audio.play('click');
      showLevels();
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

function showLevels() {
  levelsScreen(
    COURSES,
    save.stars,
    save.best,
    unlocked,
    (i) => {
      audio.play('click');
      openCourse(i);
    },
    () => {
      audio.play('click');
      showTitle();
    },
  );
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
      } else if (k === 'vibration') st.vibration = v as boolean;
      else if (k === 'stats') {
        st.stats = v as boolean;
        setAnalyticsEnabled(st.stats);
      } else if (k === 'gfx') {
        st.gfx = v as Settings['gfx'];
        stage.setTier(effectiveTier());
        fps.t = fps.n = fps.slow = fps.fast = 0;
      } else if (k === 'lang') {
        st.lang = v as 'es' | 'en';
        setLang(st.lang);
        buildHud(pauseGame);
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

/** Show a hole on screen (intro or play) without starting it. */
function loadHole(r: Round) {
  const h = r.holes[r.cur];
  sim = new Sim(h.hole, r.mods);
  bot = null;
  stage.setLevel(sim, h.course.id);
  flags.sway = false;
  flags.lastStroke = false;
  clearFloaters();
  input.reset();
  input.resetKeyboardAim(cupAngle(sim));
}

function newRound(kind: Round['kind'], index: number, holes: Round['holes'], mods: HoleMods, daily?: Daily): Round {
  return { kind, index, daily, holes, mods, cur: 0, scores: holes.map((h) => ({ par: h.hole.par })), t0: performance.now() };
}

function openCourse(i: number) {
  const c = COURSES[i];
  round = newRound('course', i, c.holes.map((hole) => ({ course: c, hole })), {});
  loadHole(round);
  mode = 'intro';
  setHudVisible(false);
  input.enabled = false;
  stage.zoomTarget = stage.reducedMotion ? 1 : 1.12;
  introScreen({
    course: c,
    eyebrow: `${t('course')} ${c.num}`,
    title: tx(c.name),
    tip: tx(c.tip),
    holes: c.holes,
    onGo: () => startPlay(),
    onBack: () => {
      audio.play('click');
      startAttract();
      showLevels();
    },
  });
}

function startCourse(i: number, quick = false) {
  const c = COURSES[i];
  round = newRound('course', i, c.holes.map((hole) => ({ course: c, hole })), {});
  loadHole(round);
  if (quick) startPlay();
}

function openDaily() {
  const d = todayDaily();
  round = newRound('daily', 0, d.holes, d.mods, d);
  loadHole(round);
  mode = 'intro';
  setHudVisible(false);
  input.enabled = false;
  const rec = save.daily[d.key];
  introScreen({
    course: d.holes[0].course,
    eyebrow: t('daily'),
    title: t('dailyTitle', { n: d.num }),
    tip: rec ? t('dailyPlayed', { s: `${rec.score} (${fmtPar(rec.score - d.holes.reduce((a, h) => a + h.hole.par, 0))})` }) : tx(d.mod.label),
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
  if (!sim || !round) return;
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
  input.resetKeyboardAim(cupAngle(sim));
  acc = 0;
  holeStart = performance.now();
  const id = round.kind === 'daily' ? `daily-${round.daily!.num}` : COURSES[round.index].id;
  if (round.cur === 0) {
    track(round.kind === 'daily' ? 'daily_start' : 'course_start', { level: id, num: round.daily?.num ?? null });
    if (round.kind === 'course' && round.index === 0 && !save.tutorialDone) showTutorial();
  }
  track('level_start', { level: round.holes[round.cur].hole.id, round: id });
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

function showHoleName() {
  if (!round) return;
  const h = round.holes[round.cur];
  toast(`${t('hole')} ${round.cur + 1} · ${tx(h.hole.name)} · ${t('par')} ${h.hole.par}`, '', 2000);
}

function pauseGame() {
  if (mode !== 'play' || !round) return;
  mode = 'paused';
  gameplayStop();
  input.reset();
  audio.stopLoops();
  audio.duck(true);
  pauseScreen({
    goals: `<div class="eyebrow">${t('goalsNow')}</div>` + cardHtml(round.scores, round.cur) + (round.kind === 'course' ? goalsHtml(round.holes.length, roundPar(round)) : ''),
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
      track('level_quit', { level: sim?.def.id ?? '' });
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

function retry() {
  if (!round) return;
  if (round.kind === 'course') startCourse(round.index);
  else {
    const d = round.daily!;
    round = newRound('daily', 0, d.holes, d.mods, d);
    loadHole(round);
  }
  startPlay();
}

// ---------- tutorial ----------
function showTutorial() {
  clearTutorial();
  const app = $('#app');
  if (input.mode === 'touch') tutorialNodes = [el(`<div class="tut one"><div class="ghost pull"><i></i></div><div>${t('tutTouch')}<br><b>${t('tutTouch2')}</b></div></div>`)];
  else tutorialNodes = [el(`<div class="tut desk">${t('tutDesk')}</div>`)];
  tutorialNodes.forEach((n) => app.appendChild(n));
  input.usedAim = false;
  input.usedShot = false;
  tutT = 0;
}
function clearTutorial() {
  tutorialNodes.forEach((n) => n.remove());
  tutorialNodes = [];
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
      if (ev.n === 1) {
        save.aces = (save.aces ?? 0) + 1;
        if (!stage.reducedMotion) stage.zoomTarget = 0.85;
      }
      break;
    }
    case 'maxed':
      audio.play('groan');
      break;
    case 'rest':
      if (s.strokes === s.maxStrokes - 1 && !flags.lastStroke) {
        flags.lastStroke = true;
        toast(t('tLastStroke'), 'warn', 1800);
      }
      break;
  }
}

/** The hole is over: score it, then the next hole (or the end of the round). */
function holeDone() {
  const s = sim!;
  const r = round!;
  const res = s.result!;
  r.scores[r.cur].strokes = res.strokes;
  r.scores[r.cur].maxed = res.maxed;
  const name = scoreName(res.strokes, res.par, res.maxed);
  const d = res.strokes - res.par;
  banner(name, d <= 0 && !res.maxed ? 'win' : 'lose');
  track(res.maxed ? 'level_fail' : 'level_complete', { level: s.def.id, strokes: res.strokes, par: res.par, dur: Math.round((performance.now() - holeStart) / 1000) });
  mode = 'between';
  betweenT = 2.0;
  input.enabled = false;
  input.reset();
}

function nextHole() {
  const r = round!;
  if (r.cur + 1 < r.holes.length) {
    r.cur++;
    loadHole(r);
    mode = 'play';
    input.enabled = true;
    stage.zoomTarget = 1;
    holeStart = performance.now();
    track('level_start', { level: r.holes[r.cur].hole.id });
    showHoleName();
  } else finishRound();
}

function stars(total: number, par: number): number {
  return total <= par - 2 ? 3 : total <= par ? 2 : 1;
}

function shareFor(r: Round): string {
  const tot = roundStrokes(r);
  const par = roundPar(r);
  const row = r.scores.map((s) => (s.strokes === 1 ? '⭐' : (s.strokes ?? 9) < s.par ? '🟩' : s.strokes === s.par ? '🟨' : (s.strokes ?? 9) === s.par + 1 ? '🟧' : '🟥')).join('');
  const head = r.kind === 'daily' ? `${gameName()} ⛳ ${t('dailyTitle', { n: r.daily!.num })}` : `${gameName()} ⛳ ${tx(COURSES[r.index].name)}`;
  const rank = r.kind === 'daily' && dailyRank && dailyRank.players > 1 ? ` · 🏆 Top ${Math.max(1, 100 - rankPct(dailyRank))}%` : '';
  return `${head}\n${tot} (${fmtPar(tot - par)}) ${row}${rank}${GAME_URL ? '\n' + GAME_URL : ''}`;
}
function rankPct(rk: { players: number; below: number }): number {
  return Math.round((rk.below / Math.max(1, rk.players - 1)) * 100);
}
function rankText(rk: { players: number; below: number }): string {
  return rk.players <= 1 ? t('dailyFirst') : t('dailyRank', { p: rankPct(rk), n: rk.players.toLocaleString() });
}

function finishRound() {
  const r = round!;
  const tot = roundStrokes(r);
  const par = roundPar(r);
  const st = stars(tot, par);
  const dur = Math.round((performance.now() - r.t0) / 1000);
  let best = 0;
  let newBest = false;
  let hasNext = false;
  let footer: string | undefined;
  let extra = '';
  let eyebrow = '';
  let unlockedNext: number | null = null;
  if (r.kind === 'course') {
    const c = COURSES[r.index];
    const wasLocked = r.index < COURSES.length - 1 && !unlocked(r.index + 1);
    save.stars[c.id] = Math.max(save.stars[c.id] ?? 0, st);
    const prev = save.best[c.id];
    if (!prev || tot < prev) {
      newBest = !!prev;
      save.best[c.id] = tot;
    }
    best = save.best[c.id];
    if (r.index === 0) save.tutorialDone = true;
    hasNext = r.index < COURSES.length - 1;
    if (wasLocked && unlocked(r.index + 1)) unlockedNext = r.index + 2;
    eyebrow = `${t('course')} ${c.num} · ${tx(c.name)}`;
    track('course_complete', { level: c.id, strokes: tot, par, stars: st, dur });
  } else {
    const d = r.daily!;
    eyebrow = t('dailyTitle', { n: d.num });
    const prev = save.daily[d.key];
    if (!prev || tot < prev.score) {
      newBest = !!prev;
      save.daily[d.key] = { score: tot, stars: st, ratio: tot / par, time: dur, win: true };
    }
    if (save.streak.last !== d.key) {
      save.streak.count = isYesterday(save.streak.last) ? save.streak.count + 1 : 1;
      save.streak.last = d.key;
    }
    best = save.daily[d.key].score;
    footer = t('dailyAgain', { n: d.num + 1 });
    dailyRank = null;
    // the shared leaderboard ranks higher scores better: send "par − strokes" so fewer strokes rank higher
    submitDaily(d.key, d.num, 1000 + par - tot, st, tot / par, dur).then((rk) => {
      dailyRank = rk;
      const node = document.getElementById('end-rank');
      if (!node || !rk) return;
      node.hidden = false;
      node.textContent = rankText(rk);
    });
    extra = `<div id="end-rank" class="rank" hidden></div>`;
    track('daily_complete', { num: d.num, strokes: tot, par, stars: st, mod: d.mod.key, dur });
  }
  store.save();
  mode = 'end';
  gameplayStop();
  if (st === 3) happytime();
  setHudVisible(false);
  clearTutorial();
  wakeLock?.release().catch(() => undefined);
  wakeLock = null;
  audio.play('win');
  if (unlockedNext) {
    const n = unlockedNext;
    setTimeout(() => {
      if (mode === 'end') {
        toast(t('unlocked', { n }), 'good', 3200);
        audio.play('star', 3);
      }
    }, 1700);
  }
  endScreen({
    stars: st,
    eyebrow,
    card: cardHtml(r.scores),
    total: tot,
    par,
    best,
    newBest,
    hasNext,
    footer,
    extraHtml: extra,
    shareText: () => shareFor(r),
    onNext: () => {
      audio.play('click');
      openCourse(r.index + 1);
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
    onShared: () => track('share', { level: r.kind === 'daily' ? `daily-${r.daily!.num}` : COURSES[r.index].id, strokes: tot }),
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
  if (mode === 'play' || mode === 'between') {
    if (mode === 'play' && s.state === 'aim') {
      input.poll(dt, cupAngle(s));
      const driver = rec.driver;
      if (driver) driver.update();
      else {
        const shot = input.takeShot();
        if (shot) {
          s.shoot(shot.angle, shot.power);
          input.resetKeyboardAim(cupAngle(s));
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
    else if (mode === 'play' && s.state === 'aim' && rec.driver === null && input.aim === null) input.resetKeyboardAim(cupAngle(s));
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
    // moving obstacles keep moving while the intro card is up
    acc += dt;
    while (acc >= SIM_DT && steps < 14) {
      s.step();
      s.events.length = 0;
      acc -= SIM_DT;
      steps++;
    }
  }
  if (stage.view) stage.view.aim = mode === 'play' && s.state === 'aim' ? input.aim : null;
  const paused = mode === 'paused';
  time += paused ? 0 : dt;
  if (rec.render) stage.frame(paused ? 0 : dt, time);

  if (mode === 'play' || mode === 'between') {
    const r = round!;
    audio.loops(stage.theme.surround, dt);
    updateHud({
      hole: r.cur + 1,
      holes: r.holes.length,
      name: tx(r.holes[r.cur].hole.name),
      par: s.def.par,
      strokes: s.strokes,
      max: s.maxStrokes,
      total: roundStrokes(r),
      totalPar: roundParPlayed(r),
    });
    if (tutorialNodes.length) {
      tutT += dt;
      if (input.usedShot || tutT > 40) clearTutorial();
    }
  }
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
  get round() {
    return round;
  },
  get input() {
    return input;
  },
  get info() {
    const r = stage.renderer.info;
    return { calls: r.render.calls, tris: r.render.triangles, geos: r.memory.geometries, tex: r.memory.textures };
  },
  stage,
  openCourse,
  openDaily,
  startPlay,
  /** jump to a hole of the open round (testing only) */
  goHole(i: number) {
    if (!round) return;
    round.cur = i;
    loadHole(round);
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

void coursePar;
