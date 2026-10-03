// Anonymous game analytics -> Supabase (project nocodeboy-games, shared by all the studio's games). Writes only
// through the SECURITY DEFINER functions track / submit_daily; the tables are not readable with the public key.

type Props = Record<string, string | number | boolean | null>;

declare const __ANALYTICS__: { url: string; key: string } | null;
declare const __VERSION__: string;
declare const __TARGET__: string;

const CFG = typeof __ANALYTICS__ !== 'undefined' ? __ANALYTICS__ : null;
const GAME = 'wildputt';
const VERSION = typeof __VERSION__ !== 'undefined' ? __VERSION__ : 'dev';
const TARGET = typeof __TARGET__ !== 'undefined' ? __TARGET__ : 'web';

let enabled = true;
let install = '';
let session = '';
let started = 0;
let levels = 0;
const queue: { e: string; p: Props; t: number }[] = [];

function uuid(): string {
  if (crypto?.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function platform(): string {
  const host = location.hostname;
  if (TARGET === 'crazygames' || /crazygames/.test(host)) return 'crazygames';
  if (TARGET === 'artifact') return 'artifact';
  if (TARGET === 'android' || (window as unknown as { Capacitor?: unknown }).Capacitor) return 'android';
  return 'web';
}

export function setAnalyticsEnabled(on: boolean) {
  enabled = on;
  if (!on) queue.length = 0;
}

export function installId(): string {
  return install;
}

/** Device language and time zone: tell tier-1 players apart (approximate region) without personal data. */
export function localeProps(): Props {
  let tz = '';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    /* old browsers */
  }
  return { loc: navigator.language || '', tz };
}

/** Where the player came from: the utm_* tags of our links (videos, posts) and the site that sent them (domain only).
 *  Sent in first_open (first touch) and in session_start (each visit); empty in the Android app and on direct visits. */
export function sourceProps(): Props {
  const p: Props = {};
  try {
    const q = new URLSearchParams(location.search);
    const tags = [['utm_source', 'src'], ['utm_medium', 'med'], ['utm_campaign', 'cmp'], ['utm_content', 'cnt']] as const;
    for (const [k, n] of tags) {
      const v = q.get(k);
      if (v) p[n] = v.slice(0, 48);
    }
    if (document.referrer) {
      const h = new URL(document.referrer).hostname;
      if (h && h !== location.hostname) p.ref = h.slice(0, 64);
    }
  } catch {
    /* old browsers or a malformed referrer */
  }
  return p;
}

export function initAnalytics() {
  session = Math.random().toString(36).slice(2, 12);
  started = Date.now();
  try {
    install = localStorage.getItem('wildputt.iid') ?? '';
    if (!/^[0-9a-f-]{36}$/.test(install)) {
      install = uuid();
      localStorage.setItem('wildputt.iid', install);
    }
  } catch {
    install = uuid();
  }
  setInterval(() => {
    if (!document.hidden) track('ping', { s: Math.round((Date.now() - started) / 1000) });
    flush();
  }, 60000);
  setInterval(flush, 10000);
  const end = () => {
    track('session_end', { dur: Math.round((Date.now() - started) / 1000), levels });
    flush(true);
  };
  window.addEventListener('pagehide', end);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flush(true);
  });
}

export function track(event: string, props: Props = {}) {
  if (event === 'level_start' || event === 'daily_start') levels++;
  if (!enabled) return;
  queue.push({ e: event, p: props, t: Date.now() });
  if ((window as unknown as { WILDPUTT_DEBUG?: boolean }).WILDPUTT_DEBUG) console.debug('[track]', event, props);
  if (queue.length >= 20) flush();
}

// local files / dev servers never report (keeps tests and screenshots out of the numbers)
// (the Android app is also served from https://localhost, but it is a real player)
const LOCAL = TARGET !== 'android' && (location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(location.hostname));

function flush(beacon = false) {
  if (!CFG || TARGET === 'artifact' || LOCAL || !queue.length) {
    if (queue.length > 300) queue.splice(0, queue.length - 300);
    return;
  }
  const batch = queue.splice(0, 50);
  try {
    fetch(`${CFG.url}/rest/v1/rpc/track`, {
      method: 'POST',
      headers: { apikey: CFG.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_game: GAME, p_install: install, p_session: session, p_version: VERSION, p_platform: platform(), p_events: batch }),
      keepalive: beacon,
    }).catch(() => {
      // offline: put the events back for the next try
      if (queue.length < 250) queue.unshift(...batch);
    });
  } catch {
    /* ignore */
  }
}

/** Records today's daily result (first attempt counts) and returns how it ranks among today's players. */
export async function submitDaily(day: string, num: number, score: number, stars: number, ratio: number, time: number): Promise<{ players: number; below: number } | null> {
  if (!CFG || TARGET === 'artifact' || LOCAL || !enabled) return null;
  try {
    const r = await fetch(`${CFG.url}/rest/v1/rpc/submit_daily`, {
      method: 'POST',
      headers: { apikey: CFG.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_game: GAME, p_install: install, p_day: day, p_num: num, p_score: score, p_stars: stars, p_result: ratio, p_time: time }),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { players: number; below: number };
    return j && typeof j.players === 'number' ? j : null;
  } catch {
    return null;
  }
}
