// Shop: free coins (rewarded ad), the aim line, balls, and the store's purchases where there is a store.
import { AIM_LEN, aimCost, BALLS, MAX_AIM, type BallDef } from '../economy';
import { num, t, tx, type Key } from '../i18n';
import { PRODUCTS, type Product, type ProductId } from '../monetize/types';
import type { Save } from '../storage';
import { IC } from './icons';
import { adLabel, el, esc, show, toast } from './ui';

const PRODUCT_ICON: Record<ProductId, string> = { remove_ads: IC.noAds, starter_pack: IC.gift, coins_s: IC.coins, coins_m: IC.coins, coins_l: IC.coins };

function productDesc(id: ProductId): string {
  const coins = num(PRODUCTS[id].coins);
  if (id === 'remove_ads') return t('p_remove_ads_d', { n: coins });
  if (id === 'starter_pack') return t('p_starter_pack_d', { n: coins });
  return t('coinsN', { n: coins });
}

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

/** A ball as a small SVG swatch (its colours and pattern). */
export function ballSwatch(b: BallDef, size = 40): string {
  const c1 = hex(b.c1);
  const c2 = hex(b.c2 ?? b.c1);
  let pat = '';
  switch (b.pattern) {
    case 'stripe':
      pat = `<rect x="2" y="15" width="36" height="10" fill="${c2}"/>`;
      break;
    case 'tennis':
      pat = `<path d="M6 10c8 6 8 14 0 20M34 10c-8 6-8 14 0 20" stroke="${c2}" stroke-width="2.5" fill="none"/>`;
      break;
    case 'soccer':
      pat = `<path d="M20 13l6 4-2 7h-8l-2-7z" fill="${c2}"/><path d="M8 12l4 2M32 12l-4 2M10 30l4-3M30 30l-4-3" stroke="${c2}" stroke-width="2.5"/>`;
      break;
    case 'pool':
      pat = `<circle cx="20" cy="18" r="8" fill="${c2}"/><text x="20" y="22" text-anchor="middle" font-size="11" font-weight="900" fill="#141414" font-family="Arial">8</text>`;
      break;
    case 'melon':
      pat = `<path d="M10 6c-3 9-3 19 0 28M20 3v34M30 6c3 9 3 19 0 28" stroke="${c2}" stroke-width="3" fill="none"/>`;
      break;
    case 'disco':
      for (let x = 6; x < 36; x += 6) for (let y = 6; y < 36; y += 6) pat += `<rect x="${x}" y="${y}" width="5" height="5" fill="${(x + y) % 12 ? c2 : '#ffffff'}"/>`;
      break;
    case 'planet':
      pat = `<ellipse cx="20" cy="20" rx="21" ry="5" fill="none" stroke="#fff4d6" stroke-width="2.5" transform="rotate(-18 20 20)"/><path d="M4 16h32M5 24h30" stroke="${c2}" stroke-width="3"/>`;
      break;
    case 'comet':
      pat = `<circle cx="14" cy="14" r="4" fill="${c2}" opacity="0.8"/>`;
      break;
  }
  return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true"><defs><clipPath id="bc-${b.id}"><circle cx="20" cy="20" r="18"/></clipPath><radialGradient id="bg-${b.id}" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/><stop offset="1" stop-color="#000000" stop-opacity="0.18"/></radialGradient></defs><circle cx="20" cy="20" r="18" fill="${c1}"/><g clip-path="url(#bc-${b.id})">${pat}</g><circle cx="20" cy="20" r="18" fill="url(#bg-${b.id})"/><circle cx="20" cy="20" r="18" fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="1.5"/></svg>`;
}

export interface ShopOpts {
  save: Save;
  /** rewarded free coins; null hides the row (no ad ready) */
  free: { left: number; amount: number } | null;
  /** products the store returned; null when this platform has no store (web, CrazyGames) */
  products: Product[] | null;
  onBuy: (id: ProductId) => void;
  onRestore: () => void;
  onAim: () => void;
  onBall: (id: string) => void;
  onFree: () => void;
  onBack: () => void;
}

export function shopScreen(o: ShopOpts) {
  const s = o.save;
  const row = (icon: string, name: string, desc: string, side: string, extra = '') =>
    `<div class="shop-row"><span class="ico">${icon}</span><div class="info"><b>${esc(name)}</b><small>${esc(desc)}</small>${extra}</div>${side}</div>`;
  const buyBtn = (attr: string, cost: number | null, label: string) =>
    cost === null
      ? `<span class="maxed">${t('upMax')}</span>`
      : `<button class="btn amber sm buy${s.coins < cost ? ' poor' : ''}" ${attr} aria-label="${esc(t('upBuy', { name: label, n: num(cost) }))}">${IC.coin}${num(cost)}</button>`;
  const free = o.free
    ? row(
        IC.gift,
        t('freeCoins'),
        o.free.left > 0 ? t('freeCoinsD', { n: o.free.amount, left: o.free.left }) : t('freeTomorrow'),
        o.free.left > 0 ? `<button class="btn water sm buy" data-a="free" aria-label="${esc(t('watchAria', { n: o.free.amount }))}">${IC.ad}${adLabel(t('watch'))}</button>` : '',
      )
    : '';
  const pips = Array.from({ length: MAX_AIM }, (_, i) => `<i class="${i < s.aim ? 'on' : ''}"></i>`).join('');
  const aimVal = s.aim >= 3 ? t('aimLine3') : s.aim ? `+${Math.round((AIM_LEN[s.aim] - 1) * 100)}%` : '';
  const aim = row(IC.putter, t('aimLine'), t('aimLineD'), buyBtn('data-a="aim"', aimCost(s.aim), t('aimLine')), `<span class="lvl-line"><span class="pips">${pips}</span>${aimVal ? `<span class="val">${esc(aimVal)}</span>` : ''}</span>`);
  const balls = BALLS.map((b) => {
    const have = s.balls.includes(b.id);
    const inUse = s.ball === b.id;
    const side = inUse
      ? `<span class="maxed">${t('inUse')}</span>`
      : have
        ? `<button class="btn ghost sm buy" data-ball="${b.id}">${t('equip')}</button>`
        : `<button class="btn amber sm buy${s.coins < b.price ? ' poor' : ''}" data-ball="${b.id}" aria-label="${esc(t('upBuy', { name: tx(b.name), n: num(b.price) }))}">${IC.coin}${num(b.price)}</button>`;
    return `<div class="ball-cell${inUse ? ' on' : ''}"><span class="sw">${ballSwatch(b)}</span><b>${esc(tx(b.name))}</b>${side}</div>`;
  }).join('');
  const store = o.products?.length
    ? `<div class="eyebrow">${t('purchases')}</div>
       ${o.products
         .map((p) => {
           const own = !PRODUCTS[p.id].consumable && s.owned[p.id as 'remove_ads' | 'starter_pack'];
           return row(PRODUCT_ICON[p.id], t(`p_${p.id}` as Key), productDesc(p.id), own ? `<span class="maxed">${t('owned')}</span>` : `<button class="btn water sm buy" data-p="${p.id}">${esc(p.price ?? '')}</button>`);
         })
         .join('')}
       <button class="linkbtn" data-a="restore">${t('restore')}</button>`
    : '';
  const n = el(`
  <div class="screen dim shop-screen">
    <div class="panel shop">
      <div class="tape"></div>
      <div class="panel-head shop-head"><h2>${t('shop')}</h2><span class="wallet static">${IC.coin}<b>${num(s.coins)}</b></span></div>
      <div class="panel-body">
        ${free}
        ${aim}
        <div class="eyebrow">${t('balls')}</div>
        <p class="muted note">${t('ballsD')}</p>
        <div class="ball-grid">${balls}</div>
        ${store}
        <div class="actions"><button class="btn ghost" data-a="back" data-focus>${IC.back}${t('back')}</button></div>
      </div>
    </div>
  </div>`);
  const poorCheck = (b: HTMLElement, go: () => void) => () => {
    if (b.classList.contains('poor')) toast(t('notEnough'), 'warn');
    else go();
  };
  const aimB = n.querySelector<HTMLElement>('[data-a=aim]');
  aimB?.addEventListener('click', poorCheck(aimB, o.onAim));
  n.querySelectorAll<HTMLElement>('[data-ball]').forEach((b) => b.addEventListener('click', poorCheck(b, () => o.onBall(b.dataset.ball!))));
  const lock = () => n.querySelectorAll<HTMLButtonElement>('[data-a=free], [data-p], [data-a=restore]').forEach((b) => (b.disabled = true));
  n.querySelector('[data-a=free]')?.addEventListener('click', () => {
    lock();
    o.onFree();
  });
  n.querySelectorAll<HTMLElement>('[data-p]').forEach((b) =>
    b.addEventListener('click', () => {
      lock();
      o.onBuy(b.dataset.p as ProductId);
    }),
  );
  n.querySelector('[data-a=restore]')?.addEventListener('click', () => {
    lock();
    o.onRestore();
  });
  n.querySelector('[data-a=back]')!.addEventListener('click', o.onBack);
  show(n);
}
