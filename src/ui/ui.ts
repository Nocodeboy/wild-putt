import { fmtPar, gameName, getLang, scoreName, t, tx } from '../i18n';
import type { EdgeMark, Label } from '../render/view';
import type { Stage } from '../render/stage';
import { hexStr, THEMES } from '../render/themes';
import type { CourseDef } from '../sim/types';
import { IC } from './icons';

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

export function el(html: string): HTMLElement {
  const d = document.createElement('div');
  d.innerHTML = html.trim();
  return d.firstElementChild as HTMLElement;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function starsTxt(n: number, max = 3): string {
  let o = '';
  for (let i = 0; i < max; i++) o += `<span class="${i < n ? 'star-on' : 'star-off'}">★</span>`;
  return o;
}

// ---------------- screens ----------------
const screens = () => $('#screens');

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
    <div class="logo">
      <h1>${es ? '<span class="ex">¡</span>EMBÓCALA<span class="ex">!</span>' : 'WILD<br>PUTT'}</h1>
      <div class="duo">${IC.ball}${IC.hole}</div>
      <div class="tape"></div>
      <p>${t('tagline')}</p>
    </div>
    <div class="menu">
      <button class="btn big" data-a="play" data-focus>${IC.play}${esc(o.playLabel)}${o.playLevel ? `<span class="lvtag">${o.playLevel}</span>` : ''}</button>
      <div class="row">
        <button class="btn ghost" data-a="levels">${IC.grid}${t('levels')}</button>
        <button class="btn amber daily-btn" data-a="daily">${IC.cal}#${o.dailyNum}${o.streak > 0 ? `<span class="badge">🔥 ${o.streak}</span>` : o.dailyDone ? `<span class="badge">✓</span>` : ''}</button>
      </div>
      <div class="foot"><button class="icon-btn" data-a="settings" aria-label="${t('settings')}">${IC.gear}</button><span class="starcount"><span class="star-on">★</span> ${o.stars}/${o.maxStars}</span><span>${t('credits')}</span></div>
      ${o.privacyUrl ? `<p class="privacy-note">${t('privacyNote')} <a href="${o.privacyUrl}" target="_blank" rel="noopener">${t('privacyPolicy')}</a></p>` : ''}
    </div>
  </div>`);
  n.querySelector('[data-a=play]')!.addEventListener('click', o.onPlay);
  n.querySelector('[data-a=levels]')!.addEventListener('click', o.onLevels);
  n.querySelector('[data-a=daily]')!.addEventListener('click', o.onDaily);
  n.querySelector('[data-a=settings]')!.addEventListener('click', o.onSettings);
  show(n);
}

export function coursePar(c: CourseDef): number {
  return c.holes.reduce((a, h) => a + h.par, 0);
}

export function levelsScreen(courses: CourseDef[], stars: Record<string, number>, best: Record<string, number>, unlocked: (i: number) => boolean, onPick: (i: number) => void, onBack: () => void) {
  const total = courses.reduce((a, c) => a + (stars[c.id] ?? 0), 0);
  const cards = courses
    .map((c, i) => {
      const th = THEMES[c.id];
      const bg = `linear-gradient(160deg, ${hex(th.sky)} 0%, ${hex(th.outside)} 62%, ${th.green[1]} 100%)`;
      const lock = !unlocked(i);
      const b = best[c.id];
      return `<button class="lvl${lock ? ' locked' : ''}" data-i="${i}" style="background:${bg}" ${lock ? 'aria-disabled="true"' : ''}>
        <span class="num">${c.num}</span>${!lock && !stars[c.id] ? `<span class="new">${t('newTag')}</span>` : ''}
        <span class="nm">${esc(tx(c.name))}</span>
        <span class="st"><span>${lock ? '🔒' : starsTxt(stars[c.id] ?? 0)}</span>${b ? `<small>${b} (${fmtPar(b - coursePar(c))})</small>` : ''}</span>
      </button>`;
    })
    .join('');
  const n = el(`
  <div class="screen dim">
    <div class="panel wide">
      <div class="tape"></div>
      <div class="panel-head"><div class="eyebrow"><span class="star-on">★</span> ${total}/${courses.length * 3}</div><h2>${t('levels')}</h2></div>
      <div class="panel-body">
        <div class="levels">${cards}</div>
        <div class="actions"><button class="btn ghost" data-a="back" data-focus>${IC.back}${t('back')}</button></div>
      </div>
    </div>
  </div>`);
  n.querySelectorAll<HTMLElement>('.lvl').forEach((b) =>
    b.addEventListener('click', () => {
      const i = Number(b.dataset.i);
      if (!unlocked(i)) {
        toast(t('locked'), 'warn');
        return;
      }
      onPick(i);
    }),
  );
  n.querySelector('[data-a=back]')!.addEventListener('click', onBack);
  show(n);
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
  course: CourseDef;
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
  lang: 'es' | 'en';
  onChange: (k: string, v: string | boolean) => void;
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
        <div class="setting"><span>${t('language')}</span><button class="toggle" data-k="lang" id="set-lang">${o.lang === 'es' ? 'Español' : 'English'}</button></div>
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
        const v = b.textContent === 'Español' ? 'en' : 'es';
        o.onChange(k, v);
      } else {
        const on = !b.classList.contains('on');
        b.classList.toggle('on', on);
        b.textContent = on ? 'ON' : 'OFF';
        o.onChange(k, on);
      }
    }),
  );
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
export function buildHud(onPause: () => void, onCamera: () => void = () => undefined) {
  const hud = $('#hud');
  hud.innerHTML = `
    <div class="hud-row">
      <button class="icon-btn" id="hud-pause" aria-label="${t('pause')}">${IC.pause}</button>
      <div class="chip holechip" id="hud-hole"><span class="hn"></span><span class="hname"></span></div>
      <div class="chip parchip" id="hud-par"></div>
    </div>
    <div class="hud-row hud-right">
      <button class="icon-btn" id="hud-cam" aria-label="${t('camera')}" title="${t('camera')}">${IC.cam}</button>
    </div>
    <div class="hud-row">
      <div class="chip strokechip" id="hud-strokes">${IC.putter}<span></span></div>
      <div class="chip totchip" id="hud-total"></div>
    </div>`;
  $('#hud-pause').addEventListener('click', onPause);
  $('#hud-cam').addEventListener('click', onCamera);
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
  $('#hud-hole .hn').textContent = `${t('hole')} ${s.hole}/${s.holes}`;
  $('#hud-hole .hname').textContent = s.name;
  $('#hud-par').textContent = `${t('par')} ${s.par}`;
  const st = $('#hud-strokes');
  st.lastElementChild!.textContent = `${s.strokes}`;
  st.classList.toggle('bad', s.strokes >= s.max - 1);
  $('#hud-total').textContent = s.totalPar ? `${t('total')} ${fmtPar(s.total - s.totalPar)}` : `${t('total')} E`;
}
export function resetHudCache() {
  lastHud = '';
}
