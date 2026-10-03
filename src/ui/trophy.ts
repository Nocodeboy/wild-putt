// Trophies: won at each course's cup hole (at par or better). A cabinet with one slot per course, and a card drawn on
// a canvas to share as an image (the cup, its name, the course and the strokes). Ported from Round ’Em Up!'s rosettes.
import { t } from '../i18n';
import { COURSE_IC, IC } from './icons';
import { el, esc, fit, show, toast } from './ui';

/** The trophy cup as an SVG, in the course's colour, with its symbol on the front. */
export function trophySvg(color: string, symbol: string, size = 120): string {
  const sym = symbol.replace('<svg ', '<svg x="40" y="34" width="40" height="40" ').replace('stroke="currentColor"', 'stroke="#fff6e6"').replace(/fill="currentColor"/g, 'fill="#fff6e6"');
  return `<svg viewBox="0 0 120 130" width="${size}" height="${(size * 130) / 120}" aria-hidden="true">
    <path d="M30 22 H8 a6 6 0 0 0-6 6 c0 16 12 28 28 28" fill="none" stroke="#ffc43d" stroke-width="7"/>
    <path d="M90 22 H112 a6 6 0 0 1 6 6 c0 16-12 28-28 28" fill="none" stroke="#ffc43d" stroke-width="7"/>
    <path d="M26 12 H94 V42 a34 34 0 0 1-68 0 Z" fill="#ffc43d" stroke="#c98f0a" stroke-width="3"/>
    <path d="M34 14 h8 v30 a22 22 0 0 0 8 17 a26 26 0 0 1-16-21 Z" fill="#fff4c8" opacity="0.6"/>
    <rect x="52" y="74" width="16" height="16" fill="#e0a52a"/>
    <rect x="36" y="90" width="48" height="10" rx="3" fill="#ffc43d" stroke="#c98f0a" stroke-width="2"/>
    <rect x="28" y="100" width="64" height="22" rx="4" fill="${color}" stroke="rgba(0,0,0,0.3)" stroke-width="2"/>
    <rect x="40" y="106" width="40" height="10" rx="2" fill="#fff6e6" opacity="0.85"/>
    <circle cx="60" cy="52" r="20" fill="${color}" stroke="#c98f0a" stroke-width="2"/>
    ${sym}
  </svg>`;
}

function loadSvg(svg: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.includes('xmlns') ? svg : svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '));
  });
}

function fitText(ctx: CanvasRenderingContext2D, text: string, font: (px: number) => string, px: number, maxW: number) {
  let s = px;
  ctx.font = font(s);
  while (s > 12 && ctx.measureText(text).width > maxW) {
    s -= 2;
    ctx.font = font(s);
  }
}

export interface TrophyCard {
  course: string;
  courseId: string;
  trophy: string;
  color: string;
  level: number;
  strokes: number;
  par: number;
  game: string;
  url: string;
}

/** The shareable card: 1080×1080. */
export async function drawTrophyCard(c: TrophyCard): Promise<HTMLCanvasElement> {
  try {
    await Promise.all([document.fonts.load("80px 'Bungee'"), document.fonts.load("800 34px 'Baloo 2'")]);
  } catch {
    /* system fonts */
  }
  const S = 1080;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S * 0.4, 60, S / 2, S * 0.5, S * 0.75);
  g.addColorStop(0, '#fff6e6');
  g.addColorStop(0.35, c.color);
  g.addColorStop(1, '#173226');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  ctx.save();
  ctx.translate(S / 2, S * 0.4);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  for (let k = 0; k < 16; k++) {
    ctx.rotate((Math.PI * 2) / 16);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-60, -S);
    ctx.lineTo(60, -S);
    ctx.fill();
  }
  ctx.restore();
  // the checkered tape of the game's panels
  for (let x = 0; x < S; x += 24) {
    ctx.fillStyle = (x / 24) % 2 ? '#fff6e6' : '#e0402f';
    ctx.fillRect(x, 0, 24, 20);
    ctx.fillRect(x, S - 20, 24, 20);
  }
  const cup = await loadSvg(trophySvg(c.color, COURSE_IC[c.courseId] ?? '', 120));
  if (cup) ctx.drawImage(cup, S / 2 - 240, 110, 480, 520);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowOffsetY = 6;
  fitText(ctx, c.trophy.toUpperCase(), (px) => `${px}px Bungee, 'Arial Black', sans-serif`, 76, S - 120);
  ctx.fillText(c.trophy.toUpperCase(), S / 2, 740);
  fitText(ctx, c.course, (px) => `800 ${px}px 'Baloo 2', sans-serif`, 46, S - 140);
  ctx.fillStyle = '#ffe9a8';
  ctx.fillText(c.course, S / 2, 812);
  ctx.font = "800 40px 'Baloo 2', sans-serif";
  ctx.fillStyle = '#fff';
  const d = c.strokes - c.par;
  ctx.fillText(`${t('holeNum', { n: c.level })} · ${c.strokes} (${d === 0 ? 'E' : d > 0 ? '+' + d : '−' + -d}) · ${t('par')} ${c.par}`, S / 2, 880);
  ctx.shadowColor = 'transparent';
  ctx.font = "34px Bungee, 'Arial Black', sans-serif";
  ctx.fillStyle = '#ffc43d';
  ctx.fillText(c.game, S / 2, 975);
  if (c.url) {
    ctx.font = "700 26px 'Baloo 2', sans-serif";
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(c.url.replace(/^https?:\/\//, ''), S / 2, 1025);
  }
  return cv;
}

/** Shares the card as an image (share sheet on phones), or downloads it. */
export async function shareImage(cv: HTMLCanvasElement, name: string, text: string, title: string): Promise<'shared' | 'saved' | 'failed'> {
  const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, 'image/png'));
  if (!blob) return 'failed';
  const file = new File([blob], name, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], text, title });
      return 'shared';
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'shared';
    }
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return 'saved';
  } catch {
    return 'failed';
  }
}

/** A trophy card shown over the current screen (the end screen stays under it). */
export function trophyModal(o: { title: string; canvas: HTMLCanvasElement; onShare: () => void; onClose: () => void }) {
  const n = el(`
  <div class="screen dim pc-modal">
    <div class="pc-wrap">
      <h2 class="pc-title">${esc(o.title)}</h2>
      <div class="pc-img"></div>
      <div class="pc-actions">
        <button class="btn ghost" data-a="close" aria-label="${t('back')}">${IC.back}</button>
        <button class="btn amber${fit(t('trophyShare'), 9)}" data-a="share" data-focus>${IC.share}${t('trophyShare')}</button>
      </div>
    </div>
  </div>`);
  o.canvas.className = 'pc-canvas';
  n.querySelector('.pc-img')!.appendChild(o.canvas);
  n.querySelector('[data-a=share]')!.addEventListener('click', o.onShare);
  n.querySelector('[data-a=close]')!.addEventListener('click', () => {
    n.remove();
    o.onClose();
  });
  document.querySelector('#screens')!.appendChild(n);
  n.querySelector<HTMLElement>('[data-focus]')?.focus({ preventScroll: true });
}

export interface CabinetSlot {
  id: string;
  name: string;
  trophy: string;
  color: string;
  /** cup hole that wins it (0: not in this build) */
  level: number;
  have: boolean;
}
/** The trophy cabinet: one slot per course, in the order of the tour. */
export function cabinetScreen(o: { slots: CabinetSlot[]; onOpen: (id: string) => void; onBack: () => void }) {
  const have = o.slots.filter((c) => c.have).length;
  const n = el(`
  <div class="screen route-screen cabinet-screen">
    <div class="route-head"><div class="eyebrow">${IC.trophy} ${have}/${o.slots.length}</div><h2>${t('cabinet')}</h2></div>
    <div class="route-scroll">
      <p class="muted album-hint">${t('cabinetHint')}</p>
      <div class="cabinet">
        ${o.slots
          .map(
            (c) =>
              `<button class="rs-slot${c.have ? ' have' : ''}" data-id="${c.id}" style="--c:${c.color}">
                <span class="rs-img">${c.have ? trophySvg(c.color, COURSE_IC[c.id] ?? '', 70) : IC.lock}</span>
                <b>${esc(c.have ? c.trophy : c.name)}</b>
                <small>${c.have ? esc(c.name) : c.level ? esc(t('cabinetLocked', { n: c.level })) : ''}</small>
              </button>`,
          )
          .join('')}
      </div>
    </div>
    <div class="route-foot"><button class="btn ghost" data-a="back" data-focus>${IC.back}${t('back')}</button></div>
  </div>`);
  n.querySelectorAll<HTMLElement>('.rs-slot.have').forEach((b) => b.addEventListener('click', () => o.onOpen(b.dataset.id!)));
  n.querySelectorAll<HTMLElement>('.rs-slot:not(.have)').forEach((b) => b.addEventListener('click', () => toast(t('cabinetHint'), 'warn')));
  n.querySelector('[data-a=back]')!.addEventListener('click', o.onBack);
  show(n);
}
