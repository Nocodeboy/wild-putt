import { fmtPar, gameName, getLang, LANG_NAME, num, scoreName, t, tx } from '../i18n';
import { LANGS, type Lang } from '../sim/types';
import type { EdgeMark, Label } from '../render/view';
import type { Stage } from '../render/stage';
import { hexStr, THEMES } from '../render/themes';
import { COURSE_IC, IC } from './icons';

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

export function el(html: string): HTMLElement {
  const d = document.createElement('div');
  d.innerHTML = html.trim();
  return d.firstElementChild as HTMLElement;
}

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function starsTxt(n: number, max = 3): string {
  let o = '';
  for (let i = 0; i < max; i++) o += `<span class="${i < n ? 'star-on' : 'star-off'}">★</span>`;
  return o;
}

/** Coins balance; a tap opens the shop. */
export function walletHtml(coins: number, id = '') {
  return `<button class="wallet" data-a="shop" aria-label="${t('shop')}">${IC.coin}<b${id ? ` id="${id}"` : ''}>${num(coins)}</b><span class="plus">+</span></button>`;
}

/** Label of a button that plays an ad: always says so. */
export function adLabel(action: string): string {
  return `<span class="adlbl"><small>${esc(t('adWord'))}</small>${esc(action)}</span>`;
}

/** Animated number (coins). */
export function countUp(node: HTMLElement, from: number, to: number, ms: number, prefix = '', tick?: () => void) {
  const t0 = performance.now();
  let last = from;
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / ms);
    const v = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    node.textContent = prefix + num(v);
    if (tick && v !== last && Math.floor(v / 10) !== Math.floor(last / 10)) tick();
    last = v;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------------- screens ----------------
const screens = () => $('#screens');

/** A screen on top of the current one (offers, cards). */
export function overlay(node: HTMLElement) {
  screens().appendChild(node);
  node.querySelector<HTMLElement>('[data-focus]')?.focus({ preventScroll: true });
}

/** The studio's other games: a card each, opening its web (or its Play listing in the app) in a new tab. */
export function moreGamesScreen(o: { games: { id: string; name: string; tag: string; href: string; color: string; color2: string; icon: string }[]; onOpen: (id: string) => void; onBack: () => void }) {
  const cards = o.games
    .map(
      (g) => `<a class="game-card" href="${esc(g.href)}" target="_blank" rel="noopener" data-g="${esc(g.id)}" style="--c:${g.color};--c2:${g.color2}">
        <span class="gc-tile">${g.icon}</span>
        <span class="gc-info"><b>${esc(g.name)}</b><small>${esc(g.tag)}</small></span>
        <span class="gc-go">${t('playFree')}${IC.ext}</span>
      </a>`,
    )
    .join('');
  const n = el(`
  <div class="screen dim more-screen">
    <div class="panel">
      <div class="tape"></div>
      <div class="panel-head"><div class="eyebrow">${esc(t('studio'))}</div><h2 class="${fit(t('moreGames'), 10)}">${t('moreGames')}</h2></div>
      <div class="panel-body">
        <p class="muted">${t('moreGamesSub')}</p>
        ${cards}
        <div class="actions"><button class="btn ghost" data-a="back" data-focus>${IC.back}${t('back')}</button></div>
      </div>
    </div>
  </div>`);
  n.querySelectorAll<HTMLElement>('[data-g]').forEach((a) => a.addEventListener('click', () => o.onOpen(a.dataset.g!)));
  n.querySelector('[data-a=back]')!.addEventListener('click', o.onBack);
  show(n);
}

/** Mulligan: take the last putt again, for an ad or for coins (once per hole). */
export function mulliganScreen(o: { ad: boolean; cost: number; balance: number; onAd: () => void; onCoins: () => void; onNo: () => void }) {
  const poor = o.balance < o.cost;
  const n = el(`
  <div class="screen dim mull-screen">
    <div class="panel">
      <div class="tape"></div>
      <div class="panel-head" style="text-align:center"><div class="eyebrow">${t('mulligan')}</div></div>
      <div class="panel-body">
        <h2 class="end-title win fit1">${t('mullTitle')}</h2>
        <div class="tip">${IC.retry.replace('<svg', '<svg style="width:26px;height:26px;flex:none;color:#ffb21f"')}<p>${t('mullTip')}</p></div>
        ${o.ad ? `<button class="btn big amber ui-font" data-a="ad" data-focus>${IC.ad}${adLabel(t('mullAd'))}</button>` : ''}
        <button class="btn ${o.ad ? 'water' : 'big amber'} ui-font${poor ? ' poor' : ''}" data-a="coins"${o.ad ? '' : ' data-focus'}>${t('mullAd')}<span class="price">${IC.coin}${num(o.cost)}</span></button>
        <button class="btn ghost" data-a="no">${t('mullNo')}</button>
      </div>
    </div>
  </div>`);
  const btns = n.querySelectorAll<HTMLButtonElement>('button');
  n.querySelector('[data-a=ad]')?.addEventListener('click', () => {
    btns.forEach((b) => (b.disabled = true));
    o.onAd();
  });
  n.querySelector('[data-a=coins]')!.addEventListener('click', () => {
    if (poor) {
      toast(t('notEnough'), 'warn');
      return;
    }
    btns.forEach((b) => (b.disabled = true));
    o.onCoins();
  });
  n.querySelector('[data-a=no]')!.addEventListener('click', o.onNo);
  overlay(n);
}

export function clearScreens() {
  screens().innerHTML = '';
}

export function show(node: HTMLElement) {
  clearScreens();
  screens().appendChild(node);
  const first = node.querySelector<HTMLElement>('[data-focus]');
  first?.focus({ preventScroll: true });
}

function hex(n: number) {
  return '#' + n.toString(16).padStart(6, '0');
}

export interface TitleOpts {
  coins: number;
  trophies: number;
  maxTrophies: number;
  onShop: () => void;
  onCabinet: () => void;
  /** "More games" (the studio's other games); absent on CrazyGames */
  onMore?: () => void;
  playLabel: string;
  playLevel: number | null;
  stars: number;
  maxStars: number;
  dailyNum: number;
  dailyDone: boolean;
  streak: number;
  onPlay: () => void;
  onLevels: () => void;
  onDaily: () => void;
  onSettings: () => void;
  /** Privacy notice for new players (CrazyGames asks for it when the game collects its own stats). */
  privacyUrl?: string;
}
export function titleScreen(o: TitleOpts) {
  const es = getLang() === 'es';
  const n = el(`
  <div class="screen title-screen">
    ${walletHtml(o.coins)}
    <div class="logo">
      <h1>${es ? '<span class="ex">¡</span>EMBÓCALA<span class="ex">!</span>' : 'WILD<br>PUTT'}</h1>
      <div class="duo">${IC.ball}${IC.hole}</div>
      <div class="tape"></div>
      <p>${t('tagline')}</p>
    </div>
    <div class="menu">
      <button class="btn big" data-a="play" data-focus>${IC.play}${esc(o.playLabel)}${o.playLevel ? `<span class="lvtag">${o.playLevel}</span>` : ''}</button>
      <div class="row">
        <button class="btn ghost" data-a="levels">${IC.route}${t('routeBtn')}</button>
        <button class="btn amber daily-btn" data-a="daily">${IC.cal}#${o.dailyNum}${o.streak > 0 ? `<span class="badge">🔥 ${o.streak}</span>` : o.dailyDone ? `<span class="badge">✓</span>` : ''}</button>
      </div>
      <div class="foot">
        <button class="icon-btn" data-a="settings" aria-label="${t('settings')}">${IC.gear}</button>
        <span class="starcount"><span class="star-on">★</span> ${o.stars}/${o.maxStars}</span>
        <button class="starcount rs-count" data-a="cabinet" aria-label="${t('cabinet')}">${IC.trophy} ${o.trophies}/${o.maxTrophies}</button>
        <button class="icon-btn" data-a="shopbtn" aria-label="${t('shop')}">${IC.shop}</button>
      </div>
      <div class="credits-row"><span class="credits">${t('credits')}</span>${o.onMore ? `<button class="more-games" data-a="more">${IC.games}${t('moreGames')}</button>` : ''}</div>
      ${o.privacyUrl ? `<p class="privacy-note">${t('privacyNote')} <a href="${o.privacyUrl}" target="_blank" rel="noopener">${t('privacyPolicy')}</a></p>` : ''}
    </div>
  </div>`);
  n.querySelector('[data-a=play]')!.addEventListener('click', o.onPlay);
  n.querySelector('[data-a=levels]')!.addEventListener('click', o.onLevels);
  n.querySelector('[data-a=daily]')!.addEventListener('click', o.onDaily);
  n.querySelector('[data-a=settings]')!.addEventListener('click', o.onSettings);
  n.querySelector('[data-a=shop]')!.addEventListener('click', o.onShop);
  n.querySelector('[data-a=shopbtn]')!.addEventListener('click', o.onShop);
  n.querySelector('[data-a=cabinet]')!.addEventListener('click', o.onCabinet);
  n.querySelector('[data-a=more]')?.addEventListener('click', () => o.onMore?.());
  show(n);
}

// ---------------- the world tour ----------------
export interface RouteNode {
  n: number;
  color: string;
  stars: number;
  /** finished (stars may be 0 if the ball was picked up) */
  done: boolean;
  locked: boolean;
  next: boolean;
  intro: boolean;
  champ: boolean;
  course: string;
  courseId: string;
  won: boolean;
}
/** A winding path of holes from the bottom (hole 1) up, with a stamp where each course opens. */
export function routeScreen(o: { nodes: RouteNode[]; total: number; max: number; trophies: number; maxTrophies: number; more: boolean; onPick: (n: number) => void; onBack: () => void; onCabinet: () => void }) {
  const STEP = 84;
  const N = o.nodes.length;
  const H = N * STEP + 150;
  const pos = (n: number) => ({ x: 50 + Math.sin(n * 0.78) * 27, y: H - 80 - (n - 1) * STEP });
  const path = (list: RouteNode[]) => list.map((nd, i) => `${i ? 'L' : 'M'}${pos(nd.n).x.toFixed(1)} ${pos(nd.n).y}`).join(' ');
  const reached = o.nodes.filter((nd) => !nd.locked);
  const stampPos = (x: number) => {
    const free = x < 50 ? 100 - x : x;
    const left = x < 50 ? `calc(${((x + 100) / 2).toFixed(1)}% + 14px)` : `calc(${(x / 2).toFixed(1)}% - 14px)`;
    return `left:${left};--mw:calc(${free.toFixed(1)}% - 50px)`;
  };
  const nodes = o.nodes
    .map((nd) => {
      const p = pos(nd.n);
      const cls = `rnode${nd.champ ? ' big' : ''}${nd.locked ? ' locked' : ''}${nd.next ? ' next' : ''}${nd.done ? ' done' : ''}`;
      const inner = nd.locked ? IC.lock : nd.champ ? `${IC.trophy}<b>${nd.n}</b>` : `<b>${nd.n}</b>`;
      const stars = nd.done ? `<span class="rstars">${starsTxt(nd.stars)}</span>` : '';
      const stamp = nd.intro
        ? `<div class="stamp${nd.locked ? ' locked' : ''}" style="${stampPos(p.x)};top:${p.y}px;--c:${nd.color};--rot:${p.x < 50 ? 7 : -7}deg"><span class="st-ic">${COURSE_IC[nd.courseId] ?? ''}</span><b>${esc(nd.course)}</b></div>`
        : '';
      return `${stamp}<button class="${cls}" data-n="${nd.n}" style="left:${p.x}%;top:${p.y}px;--c:${nd.color}" aria-label="${t('hole')} ${nd.n}">${inner}${stars}${nd.champ ? `<span class="rbig">${nd.won ? '🏆 ' : ''}${t('cupShort')}</span>` : ''}</button>`;
    })
    .join('');
  const n = el(`
  <div class="screen route-screen">
    <div class="route-head"><div class="eyebrow"><span class="star-on">★</span> ${o.total}/${o.max}</div><h2>${t('route')}</h2></div>
    <div class="route-scroll">
      <div class="route" style="height:${H}px">
        <svg class="trail" viewBox="0 0 100 ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${path(o.nodes)}"/><path class="done" d="${path(reached)}"/></svg>
        ${o.more ? `<div class="route-more" style="top:20px">${esc(t('moreSoon'))}</div>` : ''}
        ${nodes}
      </div>
    </div>
    <div class="route-foot"><button class="btn ghost" data-a="back" data-focus aria-label="${t('back')}" style="flex:0 0 60px;padding:0">${IC.back}</button><button class="btn amber album-btn" data-a="cabinet">${IC.trophy}${t('cabinet')} <small>${o.trophies}/${o.maxTrophies}</small></button></div>
  </div>`);
  n.querySelector('[data-a=cabinet]')!.addEventListener('click', o.onCabinet);
  n.querySelectorAll<HTMLElement>('.rnode').forEach((b) =>
    b.addEventListener('click', () => {
      const k = Number(b.dataset.n);
      if (b.classList.contains('locked')) {
        toast(t('locked'), 'warn');
        return;
      }
      o.onPick(k);
    }),
  );
  n.querySelector('[data-a=back]')!.addEventListener('click', o.onBack);
  show(n);
  const next = n.querySelector<HTMLElement>('.rnode.next') ?? n.querySelector<HTMLElement>('.rnode:not(.locked)');
  const sc = n.querySelector<HTMLElement>('.route-scroll')!;
  if (next) sc.scrollTop = next.offsetTop - sc.clientHeight / 2;
  else sc.scrollTop = sc.scrollHeight;
}

/** What the stars of a hole ask for. */
export function holeGoalsHtml(par: number, now?: number): string {
  const mark = (ok: boolean) => (now === undefined ? '' : `<span class="gchk ${ok ? 'ok' : ''}">${ok ? '✓' : '·'}</span>`);
  return `<div class="goals">
    <div class="goal"><span class="stars">${starsTxt(1)}</span><span>${t('hgoal1')}</span>${mark(now !== undefined)}</div>
    <div class="goal"><span class="stars">${starsTxt(2)}</span><span>${t('hgoal2', { p: par })}</span>${mark(now !== undefined && now <= par)}</div>
    <div class="goal"><span class="stars">${starsTxt(3)}</span><span>${t('hgoal3', { p: par - 1 })}</span>${mark(now !== undefined && now <= par - 1)}</div>
  </div>`;
}

export interface HoleIntroOpts {
  eyebrow: string;
  title: string;
  tip: string;
  par: number;
  color: string;
  courseId: string;
  /** the hole opens a new course: its card */
  course?: { name: string; star: string } | null;
  champ?: { trophy: string } | null;
  best?: number;
  extra?: string;
  onGo: () => void;
  onBack: () => void;
}
/** The card before a hole of the tour. */
export function holeIntroScreen(o: HoleIntroOpts) {
  const n = el(`
  <div class="screen dim">
    <div class="panel intro${o.champ ? ' champ' : ''}">
      <div class="tape"></div>
      <div class="panel-head"><div class="eyebrow">${esc(o.eyebrow)}</div><h2 class="${fit(o.title, 13)}">${esc(o.title)}</h2></div>
      <div class="panel-body">
        ${o.course ? `<div class="region-card" style="--c:${o.color}"><span class="rc-ic">${COURSE_IC[o.courseId] ?? ''}</span><div><small>${t('newCourse')}</small><b>${esc(o.course.star)}</b></div></div>` : ''}
        ${o.champ ? `<div class="region-card champ-card" style="--c:#ffc43d"><span class="rc-ic">${IC.trophy}</span><div><small>${t('cupHole')}</small><b>${esc(t('cupCard', { t: o.champ.trophy }))}</b></div></div>` : ''}
        ${o.course || o.champ ? '' : `<div class="tip"><span class="tipicons">${COURSE_IC[o.courseId] ?? IC.hole}</span><p>${esc(o.tip)}</p></div>`}
        ${holeGoalsHtml(o.par)}
        <div class="meta"><span class="pill">${IC.putter}${t('par')} ${o.par}</span>${o.best ? `<span class="pill">${IC.retry}${t('best')} ${o.best}</span>` : ''}${o.extra ?? ''}</div>
        <div class="actions">
          <button class="btn ghost" data-a="back" aria-label="${t('back')}" style="flex:0 0 60px;padding:0">${IC.back}</button>
          <button class="btn big" data-a="go" data-focus style="flex:1 1 160px">${t('go')}</button>
        </div>
      </div>
    </div>
  </div>`);
  n.querySelector('[data-a=go]')!.addEventListener('click', o.onGo);
  n.querySelector('[data-a=back]')!.addEventListener('click', o.onBack);
  show(n);
}

export interface HoleEndOpts {
  eyebrow: string;
  title: string;
  win: boolean;
  stars: number;
  strokes: number;
  par: number;
  best: number;
  newBest: boolean;
  hasNext: boolean;
  /** extra blocks (trophy) */
  extraHtml?: string;
  coins: number;
  balance: number;
  canDouble: boolean;
  onDouble: () => Promise<{ coins: number; balance: number } | null>;
  onShop: () => void;
  onTrophy?: () => void;
  onCoin?: () => void;
  onNext: () => void;
  onRetry: () => void;
  onMenu: () => void;
  onRoute: () => void;
  onStar: (i: number) => void;
}
/** The result of one hole of the tour. */
export function holeEndScreen(o: HoleEndOpts): HTMLElement {
  const n = el(`
  <div class="screen dim">
    <div class="panel">
      <div class="tape"></div>
      <div class="panel-head" style="text-align:center"><div class="eyebrow">${esc(o.eyebrow)}</div></div>
      <div class="panel-body">
        <h2 class="end-title ${o.win ? 'win' : 'lose'} ${fit(o.title, 11)}">${esc(o.title)}</h2>
        <div class="bigstars"><span>★</span><span>★</span><span>★</span></div>
        <div class="bigscore"><b>${o.strokes}</b><span>${t('par')} ${o.par} · ${fmtPar(o.strokes - o.par)}</span></div>
        ${o.newBest ? `<div class="newbest">${t('newBest')}</div>` : o.best > 0 && o.best < o.strokes ? `<div class="muted" style="text-align:center">${t('best')}: ${o.best}</div>` : ''}
        ${o.extraHtml ?? ''}
        <div class="coinbox">
          <div class="earn" aria-label="${t('coins')}">${IC.coin}<b id="end-coins">+0</b></div>
          ${o.canDouble ? `<button class="btn amber sm" data-a="double" aria-label="${t('doubleAria')}">${IC.ad}${adLabel(t('double'))}</button>` : ''}
          ${walletHtml(o.balance - o.coins, 'end-balance')}
        </div>
        <div class="actions">
          ${o.hasNext ? `<button class="btn big" data-a="next" data-focus style="flex:1 1 100%">${t('nextHole')}${IC.next}</button>` : `<button class="btn big" data-a="route" data-focus style="flex:1 1 100%">${IC.route}${t('route')}</button>`}
        </div>
        <div class="actions">
          <button class="btn ghost" data-a="retry" aria-label="${t('restart')}" style="flex:0 0 60px;padding:0">${IC.retry}</button>
          ${o.hasNext ? `<button class="btn ghost" data-a="route" style="flex:1 1 120px;padding:0 12px;min-width:0">${IC.route}${t('route')}</button>` : ''}
          <button class="btn ghost" data-a="menu" aria-label="${t('menu')}" style="flex:0 0 60px;padding:0">${IC.home}</button>
        </div>
      </div>
    </div>
  </div>`);
  n.querySelector('[data-a=next]')?.addEventListener('click', o.onNext);
  n.querySelectorAll('[data-a=route]').forEach((b) => b.addEventListener('click', o.onRoute));
  n.querySelector('[data-a=retry]')!.addEventListener('click', o.onRetry);
  n.querySelector('[data-a=menu]')!.addEventListener('click', o.onMenu);
  n.querySelector('[data-a=shop]')!.addEventListener('click', o.onShop);
  n.querySelector('[data-a=trophy]')?.addEventListener('click', () => o.onTrophy?.());
  const earned = n.querySelector<HTMLElement>('#end-coins')!;
  const balance = n.querySelector<HTMLElement>('#end-balance')!;
  const dbl = n.querySelector<HTMLButtonElement>('[data-a=double]');
  let doubled = false;
  dbl?.addEventListener('click', async () => {
    dbl.disabled = true;
    const res = await o.onDouble();
    if (!res) {
      dbl.disabled = false;
      return;
    }
    doubled = true;
    dbl.remove();
    countUp(earned, o.coins, res.coins, 700, '+', o.onCoin);
    countUp(balance, res.balance - res.coins + o.coins, res.balance, 700);
  });
  show(n);
  const stars = n.querySelectorAll<HTMLElement>('.bigstars span');
  stars.forEach((st, i) => {
    setTimeout(() => {
      st.classList.add('show');
      if (i < o.stars) {
        st.classList.add('on');
        o.onStar(i);
      }
    }, 350 + i * 380);
  });
  setTimeout(() => {
    if (doubled) return;
    countUp(earned, 0, o.coins, 700, '+', o.onCoin);
    countUp(balance, o.balance - o.coins, o.balance, 700);
  }, 350 + 3 * 380);
  return n;
}

/** Shrinks a long title on small screens. */
export function fit(s: string, max: number): string {
  return s.length > max + 6 ? 'fit2' : s.length > max ? 'fit1' : '';
}

export function goalsHtml(holes: number, par: number): string {
  return `<div class="goals">
    <div class="goal"><span class="stars">${starsTxt(1)}</span><span>${t('goal1', { n: holes })}</span></div>
    <div class="goal"><span class="stars">${starsTxt(2)}</span><span>${t('goal2', { p: par })}</span></div>
    <div class="goal"><span class="stars">${starsTxt(3)}</span><span>${t('goal3', { p: par - 2 })}</span></div>
  </div>`;
}

/** The scorecard: one column per hole, par row and strokes row. */
export function cardHtml(holes: { par: number; strokes?: number; maxed?: boolean }[], highlight = -1): string {
  const cell = (h: { par: number; strokes?: number; maxed?: boolean }) => {
    if (h.strokes === undefined) return '<td class="sc-empty">·</td>';
    const d = h.strokes - h.par;
    const cls = h.strokes === 1 ? 'hio' : d < 0 ? 'under' : d === 0 ? 'even' : d === 1 ? 'over1' : 'over2';
    return `<td class="sc ${cls}">${h.strokes}</td>`;
  };
  const par = holes.reduce((a, h) => a + h.par, 0);
  const played = holes.filter((h) => h.strokes !== undefined);
  const tot = played.reduce((a, h) => a + (h.strokes ?? 0), 0);
  const parPlayed = played.reduce((a, h) => a + h.par, 0);
  return `<div class="card-wrap"><table class="card">
    <tr><th>${t('hole')}</th>${holes.map((_, i) => `<th class="${i === highlight ? 'cur' : ''}">${i + 1}</th>`).join('')}<th>${t('total')}</th></tr>
    <tr class="parrow"><th>${t('par')}</th>${holes.map((h) => `<td>${h.par}</td>`).join('')}<td>${par}</td></tr>
    <tr><th>${t('strokes')}</th>${holes.map(cell).join('')}<td class="tot">${played.length ? `${tot} <small>${fmtPar(tot - parPlayed)}</small>` : '·'}</td></tr>
  </table></div>`;
}

export interface IntroOpts {
  eyebrow: string;
  title: string;
  tip: string;
  holes: { par: number }[];
  extra?: string;
  onGo: () => void;
  onBack: () => void;
}
export function introScreen(o: IntroOpts) {
  const par = o.holes.reduce((a, h) => a + h.par, 0);
  const n = el(`
  <div class="screen dim">
    <div class="panel">
      <div class="tape"></div>
      <div class="panel-head"><div class="eyebrow">${esc(o.eyebrow)}</div><h2>${esc(o.title)}</h2></div>
      <div class="panel-body">
        <div class="tip"><span class="tipicons">${IC.hole}</span><p>${esc(o.tip)}</p></div>
        ${goalsHtml(o.holes.length, par)}
        ${cardHtml(o.holes)}
        <div class="meta"><span class="pill">${IC.hole}${t('holesN', { n: o.holes.length })}</span><span class="pill">${IC.putter}${t('par')} ${par}</span>${o.extra ?? ''}</div>
        <div class="actions">
          <button class="btn ghost" data-a="back" aria-label="${t('back')}" style="flex:0 0 60px;padding:0">${IC.back}</button>
          <button class="btn big" data-a="go" data-focus style="flex:1 1 160px">${t('go')}</button>
        </div>
      </div>
    </div>
  </div>`);
  n.querySelector('[data-a=go]')!.addEventListener('click', o.onGo);
  n.querySelector('[data-a=back]')!.addEventListener('click', o.onBack);
  show(n);
}

export interface PauseOpts {
  goals: string;
  sfx: boolean;
  music: boolean;
  onResume: () => void;
  onRestart: () => void;
  onMenu: () => void;
  onSfx: (on: boolean) => void;
  onMusic: (on: boolean) => void;
}
export function pauseScreen(o: PauseOpts) {
  const n = el(`
  <div class="screen dim">
    <div class="panel">
      <div class="tape"></div>
      <div class="panel-head"><h2>${t('pause')}</h2></div>
      <div class="panel-body">
        ${o.goals}
        <button class="btn big" data-a="resume" data-focus>${IC.play}${t('resume')}</button>
        <div class="actions">
          <button class="btn ghost" data-a="restart">${IC.retry}${t('restartHole')}</button>
          <button class="btn ghost" data-a="menu">${IC.home}${t('menu')}</button>
        </div>
        <div class="setting"><span>${t('sound')}</span><button class="toggle${o.sfx ? ' on' : ''}" data-a="sfx">${o.sfx ? 'ON' : 'OFF'}</button></div>
        <div class="setting"><span>${t('music')}</span><button class="toggle${o.music ? ' on' : ''}" data-a="music">${o.music ? 'ON' : 'OFF'}</button></div>
      </div>
    </div>
  </div>`);
  n.querySelector('[data-a=resume]')!.addEventListener('click', o.onResume);
  n.querySelector('[data-a=restart]')!.addEventListener('click', o.onRestart);
  n.querySelector('[data-a=menu]')!.addEventListener('click', o.onMenu);
  const tg = (a: string, cb: (on: boolean) => void) => {
    const b = n.querySelector<HTMLElement>(`[data-a=${a}]`)!;
    b.addEventListener('click', () => {
      const on = !b.classList.contains('on');
      b.classList.toggle('on', on);
      b.textContent = on ? 'ON' : 'OFF';
      cb(on);
    });
  };
  tg('sfx', o.onSfx);
  tg('music', o.onMusic);
  show(n);
}

export interface EndOpts {
  stars: number;
  eyebrow: string;
  card: string;
  total: number;
  par: number;
  best: number;
  newBest: boolean;
  hasNext: boolean;
  shareText: string | (() => string);
  extraHtml?: string;
  footer?: string;
  onNext: () => void;
  onRetry: () => void;
  onMenu: () => void;
  onShared: () => void;
  onStar: (i: number) => void;
}
export function endScreen(o: EndOpts) {
  const n = el(`
  <div class="screen dim">
    <div class="panel">
      <div class="tape"></div>
      <div class="panel-head" style="text-align:center"><div class="eyebrow">${esc(o.eyebrow)}</div></div>
      <div class="panel-body">
        <h2 class="end-title win">${t('courseDone')}</h2>
        <div class="bigstars"><span>★</span><span>★</span><span>★</span></div>
        <div class="bigscore"><b>${o.total}</b><span>${fmtPar(o.total - o.par)}</span></div>
        ${o.card}
        ${o.newBest ? `<div class="newbest">${t('newBest')}</div>` : o.best > 0 ? `<div class="muted" style="text-align:center">${t('best')}: ${o.best} (${fmtPar(o.best - o.par)})</div>` : ''}
        ${o.extraHtml ?? ''}
        ${o.footer ? `<div class="muted" style="text-align:center">${esc(o.footer)}</div>` : ''}
        <div class="actions">
          ${o.hasNext ? `<button class="btn big" data-a="next" data-focus style="flex:1 1 100%">${t('next')}${IC.next}</button>` : `<button class="btn big water" data-a="share" data-focus style="flex:1 1 100%">${IC.share}${t('share')}</button>`}
        </div>
        <div class="actions">
          <button class="btn ghost" data-a="retry" aria-label="${t('restart')}" style="flex:0 0 60px;padding:0">${IC.retry}</button>
          ${o.hasNext ? `<button class="btn water" data-a="share" style="flex:1 1 120px;padding:0 12px;min-width:0">${IC.share}${t('share')}</button>` : ''}
          <button class="btn ghost" data-a="menu" aria-label="${t('menu')}" style="${o.hasNext ? 'flex:0 0 60px;padding:0' : 'flex:1 1 100%'}">${IC.home}${o.hasNext ? '' : t('menu')}</button>
        </div>
      </div>
    </div>
  </div>`);
  n.querySelector('[data-a=next]')?.addEventListener('click', o.onNext);
  n.querySelector('[data-a=retry]')!.addEventListener('click', o.onRetry);
  n.querySelector('[data-a=menu]')!.addEventListener('click', o.onMenu);
  n.querySelector('[data-a=share]')?.addEventListener('click', () => {
    shareText(typeof o.shareText === 'function' ? o.shareText() : o.shareText, n.querySelector('.panel-body')!);
    o.onShared();
  });
  show(n);
  const stars = n.querySelectorAll<HTMLElement>('.bigstars span');
  stars.forEach((s, i) => {
    setTimeout(() => {
      s.classList.add('show');
      if (i < o.stars) {
        s.classList.add('on');
        o.onStar(i);
      }
    }, 350 + i * 380);
  });
}

/** Big centred result after each hole ("BIRDIE!"). */
export function holeBanner(strokes: number, par: number, maxed: boolean) {
  const d = strokes - par;
  banner(scoreName(strokes, par, maxed), strokes === 1 || d < 0 ? 'win' : d === 0 ? 'win' : 'lose');
}

export function shareText(text: string, host: HTMLElement) {
  // Android app: native share sheet (Capacitor Share plugin). Phones on the web: Web Share API.
  const cap = (window as unknown as { Capacitor?: { Plugins?: { Share?: { share: (o: { text: string; dialogTitle?: string }) => Promise<unknown> } } } }).Capacitor;
  const nativeShare = cap?.Plugins?.Share;
  if (nativeShare) {
    nativeShare.share({ text, dialogTitle: gameName() }).catch(() => undefined);
    return;
  }
  if (typeof navigator.share === 'function' && matchMedia('(pointer: coarse)').matches) {
    navigator.share({ text }).catch(() => undefined);
    return;
  }
  const fallback = () => {
    let ta = host.querySelector<HTMLTextAreaElement>('textarea.sharebox');
    if (!ta) {
      ta = document.createElement('textarea');
      ta.className = 'sharebox';
      ta.id = 'sharebox';
      ta.readOnly = true;
      host.appendChild(ta);
    }
    ta.value = text;
    ta.focus();
    ta.select();
  };
  try {
    const p = navigator.clipboard?.writeText(text);
    if (p) p.then(() => toast(t('copied'), 'good')).catch(fallback);
    else fallback();
  } catch {
    fallback();
  }
}

export interface SettingsOpts {
  sfx: boolean;
  music: boolean;
  vibration: boolean;
  stats: boolean;
  privacyUrl?: string;
  version?: string;
  gfx: 'auto' | 'high' | 'medium' | 'low';
  lang: Lang;
  onChange: (k: string, v: string | boolean) => void;
  /** Android in the EEA/UK: change the ad consent (Google UMP) */
  onAdChoices?: () => void;
  onReset: () => void;
  onBack: () => void;
}
export function settingsScreen(o: SettingsOpts) {
  const tog = (k: string, on: boolean) => `<button class="toggle${on ? ' on' : ''}" data-k="${k}" id="set-${k}">${on ? 'ON' : 'OFF'}</button>`;
  const n = el(`
  <div class="screen dim">
    <div class="panel">
      <div class="tape"></div>
      <div class="panel-head"><h2>${t('settings')}</h2></div>
      <div class="panel-body">
        <div class="setting"><span>${t('sound')}</span>${tog('sfx', o.sfx)}</div>
        <div class="setting"><span>${t('music')}</span>${tog('music', o.music)}</div>
        <div class="setting"><span>${t('vibration')}</span>${tog('vibration', o.vibration)}</div>
        <div class="setting"><span>${t('stats')}<small class="muted" style="display:block;font-size:13px;font-weight:600">${t('statsNote')}</small></span>${tog('stats', o.stats)}</div>
        <div class="setting"><span>${t('quality')}</span><button class="toggle" data-k="gfx" data-v="${o.gfx}" id="set-gfx">${t(('gfx_' + o.gfx) as 'gfx_auto')}</button></div>
        <div class="setting"><span>${t('language')}</span><button class="toggle" data-k="lang" data-v="${o.lang}" id="set-lang">${LANG_NAME[o.lang]}</button></div>
        ${o.onAdChoices ? `<button class="linkbtn" data-a="adchoices">${t('adChoices')}</button>` : ''}
        <div class="actions">
          <button class="btn ghost" data-a="back" data-focus>${IC.back}${t('back')}</button>
          <button class="btn ghost" data-a="reset" style="color:#ffb8ae">${t('reset')}</button>
        </div>
        ${o.privacyUrl ? `<p class="muted" style="text-align:center;font-size:14px"><a href="${o.privacyUrl}" target="_blank" rel="noopener" style="color:#7fd6ff">${t('privacy')}</a> · v${o.version ?? ''}</p>` : ''}
      </div>
    </div>
  </div>`);
  n.querySelectorAll<HTMLElement>('.toggle').forEach((b) =>
    b.addEventListener('click', () => {
      const k = b.dataset.k!;
      if (k === 'gfx') {
        const order = ['auto', 'high', 'medium', 'low'] as const;
        const v = order[(order.indexOf(b.dataset.v as (typeof order)[number]) + 1) % order.length];
        b.dataset.v = v;
        b.textContent = t(('gfx_' + v) as 'gfx_auto');
        o.onChange(k, v);
      } else if (k === 'lang') {
        const v = LANGS[(LANGS.indexOf(b.dataset.v as Lang) + 1) % LANGS.length];
        o.onChange(k, v);
      } else {
        const on = !b.classList.contains('on');
        b.classList.toggle('on', on);
        b.textContent = on ? 'ON' : 'OFF';
        o.onChange(k, on);
      }
    }),
  );
  n.querySelector('[data-a=adchoices]')?.addEventListener('click', () => o.onAdChoices?.());
  let armed = false;
  const rb = n.querySelector<HTMLElement>('[data-a=reset]')!;
  rb.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      rb.textContent = t('resetConfirm');
      return;
    }
    o.onReset();
  });
  n.querySelector('[data-a=back]')!.addEventListener('click', o.onBack);
  show(n);
}

// ---------------- big banner (level end) ----------------
export function banner(text: string, kind: 'win' | 'lose') {
  const host = $('#app');
  host.querySelector('.banner')?.remove();
  const n = el(`<div class="banner ${kind}"><span>${esc(text)}</span></div>`);
  host.appendChild(n);
  setTimeout(() => n.classList.add('out'), 1500);
  setTimeout(() => n.remove(), 2000);
}

// ---------------- toasts ----------------
export function toast(text: string, kind: '' | 'warn' | 'good' = '', ms = 2200) {
  const host = $('#toast');
  while (host.children.length > 1) host.firstElementChild!.remove();
  const n = el(`<div class="toast ${kind}">${esc(text)}</div>`);
  host.appendChild(n);
  setTimeout(() => n.classList.add('out'), ms);
  setTimeout(() => n.remove(), ms + 350);
}

// ---------------- floating world texts ----------------
interface Floater {
  node: HTMLElement;
  x: number;
  y: number;
  z: number;
  t: number;
}
const floaters: Floater[] = [];
export function floater(text: string, x: number, y: number, z: number, kind = '') {
  const host = $('#floaters');
  if (floaters.length > 10) {
    const f = floaters.shift()!;
    f.node.remove();
  }
  const node = el(`<div class="fl ${kind}">${esc(text)}</div>`);
  host.appendChild(node);
  floaters.push({ node, x, y, z, t: 0 });
}
export function updateFloaters(stage: Stage, dt: number) {
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.t += dt;
    const k = f.t / 1.3;
    if (k >= 1) {
      f.node.remove();
      floaters.splice(i, 1);
      continue;
    }
    const p = stage.toScreen(f.x, f.y, f.z);
    const w = f.node.offsetWidth;
    const sc = k < 0.15 ? 0.6 + (k / 0.15) * 0.5 : 1.1 - Math.min(0.1, (k - 0.15) * 0.3);
    f.node.style.transform = `translate(${p.x - w / 2}px, ${p.y - 40 - k * 50}px) scale(${sc})`;
    f.node.style.opacity = String(k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1);
  }
}
export function clearFloaters() {
  for (const f of floaters) f.node.remove();
  floaters.length = 0;
}

// ---------------- world icons (none in this game; kept for the shared main loop) ----------------
export function updateIcons(stage: Stage, labels: Label[], edges: EdgeMark[]) {
  void stage;
  void labels;
  void edges;
}

// ---------------- HUD ----------------
export function buildHud(onPause: () => void, onCamera: () => void = () => undefined, onMulligan: () => void = () => undefined) {
  const hud = $('#hud');
  hud.innerHTML = `
    <div class="hud-row">
      <button class="icon-btn" id="hud-pause" aria-label="${t('pause')}">${IC.pause}</button>
      <div class="chip holechip" id="hud-hole"><span class="hn"></span><span class="hname"></span></div>
      <div class="chip parchip" id="hud-par"></div>
    </div>
    <div class="hud-row hud-right">
      <button class="icon-btn" id="hud-cam" aria-label="${t('camera')}" title="${t('camera')}">${IC.cam}</button>
      <button class="mull-btn" id="hud-mull" hidden>${IC.retry}<span>${t('mulligan')}</span></button>
    </div>
    <div class="hud-row">
      <div class="chip strokechip" id="hud-strokes">${IC.putter}<span></span></div>
      <div class="chip totchip" id="hud-total"></div>
    </div>`;
  $('#hud-pause').addEventListener('click', onPause);
  $('#hud-cam').addEventListener('click', onCamera);
  $('#hud-mull').addEventListener('click', onMulligan);
}

export interface HudState {
  hole: number; // 1-based
  holes: number;
  name: string;
  par: number;
  strokes: number;
  max: number;
  total: number; // strokes in the round so far (finished holes)
  totalPar: number;
}
let lastHud = '';
export function setStarLostHandler(f: () => void) {
  void f;
}
export function updateHud(s: HudState) {
  const key = JSON.stringify(s);
  if (key === lastHud) return;
  lastHud = key;
  $('#hud-hole .hn').textContent = s.holes ? `${t('hole')} ${s.hole}/${s.holes}` : t('holeNum', { n: s.hole });
  $('#hud-hole .hname').textContent = s.name;
  $('#hud-par').textContent = `${t('par')} ${s.par}`;
  const st = $('#hud-strokes');
  st.lastElementChild!.textContent = `${s.strokes}`;
  st.classList.toggle('bad', s.strokes >= s.max - 1);
  const tot = $('#hud-total');
  // (the tour plays one hole at a time: no round total)
  tot.hidden = s.totalPar < 0;
  tot.textContent = s.totalPar > 0 ? `${t('total')} ${fmtPar(s.total - s.totalPar)}` : `${t('total')} E`;
}
export function resetHudCache() {
  lastHud = '';
}
