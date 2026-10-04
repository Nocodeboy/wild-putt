// Wild Putt (¡Embócala! in Spanish) builds four targets from the same source:
//   dist/web/            public site: share link, OG image, PWA manifest, privacy page, "More games"
//   dist/crazygames/     CrazyGames upload (zip): their SDK, no external links
//   dist/android/        web assets of the Android app (Capacitor copies them into android/: npx cap sync android)
//   dist/artifact.html   page content for the Claude artifact: analytics off (CSP), share link
// Usage: node build.mjs [--dev] [--web]   (GAME_URL env overrides the public URL; --web, or building on Vercel,
// makes only dist/web: Vercel's build image has no zip or ffmpeg)
import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const prod = !process.argv.includes('--dev');
const VERSION = '1.0.0';
const GAME_URL = process.env.GAME_URL ?? 'https://wild-putt.vercel.app';
// CrazyGames shows no ads during Basic Launch and rejects games whose rewarded buttons do nothing, so the
// CrazyGames build ships without ad buttons unless CG_ADS=1 (turn it on once the game reaches Full Launch).
const CG_ADS = process.env.CG_ADS === '1';
const WEB_ONLY = !!process.env.VERCEL || process.argv.includes('--web');
// Supabase project shared by the studio's games (nocodeboy-games); the publishable key is public by design.
const ANALYTICS = { url: 'https://xshxfaospajlgwrnivvq.supabase.co', key: 'sb_publishable_GfwGUNaIh924_4oNIIqoZw_ellp8wGm' };
const music = {};
for (const k of ['menu', 'game']) if (existsSync(`assets/music-${k}.mp3`)) music[k] = `music-${k}.mp3`;

const css = readFileSync('src/style.css', 'utf8');
// Google Fonts only for the Claude artifact; the web and CrazyGames builds self-host the same OFL fonts
// (no third-party request -> nothing is sent to Google, and the game works offline / inside portals).
const fonts =
  '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Bungee&display=swap">';
const FONT_FILES = [
  ['Bungee', 400, 'node_modules/@fontsource/bungee/files/bungee-latin-400-normal.woff2', 'bungee-400.woff2'],
  ['Baloo 2', 600, 'node_modules/@fontsource/baloo-2/files/baloo-2-latin-600-normal.woff2', 'baloo2-600.woff2'],
  ['Baloo 2', 700, 'node_modules/@fontsource/baloo-2/files/baloo-2-latin-700-normal.woff2', 'baloo2-700.woff2'],
  ['Baloo 2', 800, 'node_modules/@fontsource/baloo-2/files/baloo-2-latin-800-normal.woff2', 'baloo2-800.woff2'],
];
const fontsLocal =
  FONT_FILES.map(([, , , f]) => (f.startsWith('bungee') || f.endsWith('800.woff2') ? `<link rel="preload" href="fonts/${f}" as="font" type="font/woff2" crossorigin>` : '')).join('') +
  '<style>' +
  FONT_FILES.map(([fam, w, , f]) => `@font-face{font-family:'${fam}';font-style:normal;font-weight:${w};font-display:swap;src:url(fonts/${f}) format('woff2')}`).join('') +
  '</style>';
// CrazyGames uploads a flat folder: fonts go inside index.html as data URIs (~95 KB) instead of a fonts/ subfolder
const fontsInline =
  '<style>' +
  FONT_FILES.map(([fam, w, src]) => `@font-face{font-family:'${fam}';font-style:normal;font-weight:${w};font-display:swap;src:url(data:font/woff2;base64,${readFileSync(src).toString('base64')}) format('woff2')}`).join('') +
  '</style>';
function copyFonts(out) {
  mkdirSync(`${out}/fonts`, { recursive: true });
  for (const [, , src, f] of FONT_FILES) copyFileSync(src, `${out}/fonts/${f}`);
}
const body = `<div id="app">
<canvas id="c" aria-label="Wild Putt"></canvas>
<div id="touch"></div>
<div id="icons"></div>
<div id="floaters"></div>
<div id="vignette"></div>
<div id="flash"></div>
<div id="fade"></div>
<div id="hud" hidden></div>
<div class="stick" id="pad"><i></i></div>
<div id="toast" aria-live="polite"></div>
<div id="screens"></div>
</div>`;
// English first (studio rule): the page, the share card and the manifest are in English; the game switches to
// Spanish on Spanish devices.
const NAME = 'Wild Putt';
const TITLE = 'Wild Putt · Mini Golf World Tour';
const DESC = 'Mini golf where mini golf shouldn’t be: 120 holes on 12 wild courses, from rooftops and a swaying pirate ship to a castle, a canyon and the Moon. Tides, tunnels, boosters, jump ramps and lava. Daily round. Free in your browser and on your phone.';

async function bundle(target, gameUrl, musicMap = music) {
  const res = await build({
    entryPoints: ['src/main.ts'],
    bundle: true,
    minify: prod,
    format: 'iife',
    target: ['es2022', 'safari15'],
    write: false,
    legalComments: 'none',
    define: {
      __MUSIC__: JSON.stringify(musicMap),
      __TARGET__: JSON.stringify(target),
      __CG_ADS__: JSON.stringify(target === 'crazygames' && CG_ADS),
      __VERSION__: JSON.stringify(VERSION),
      __GAME_URL__: JSON.stringify(gameUrl),
      __ANALYTICS__: JSON.stringify(target === 'artifact' ? null : ANALYTICS),
      // the web serves its own privacy page; CrazyGames and the app link to the public one
      __PRIVACY_URL__: JSON.stringify(target === 'artifact' ? '' : target === 'web' ? '/privacidad' : `${GAME_URL}/privacidad`),
    },
  });
  return res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
}

function page({ js, headExtra = '', lang = 'en', fontTags = fontsLocal }) {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#1f3a2a">
<title>${TITLE}</title>
<meta name="description" content="${DESC}">
${headExtra}
${fontTags}
<style>${css}</style>
</head>
<body>
${body}
<script>${js}</script>
</body>
</html>
`;
}

const kb = (n) => (n / 1024).toFixed(0) + ' KB';

// ---------- web ----------
{
  const out = 'dist/web';
  // keep the Vercel link (.vercel) so `npx vercel deploy --prod` works straight from dist/web
  mkdirSync(out, { recursive: true });
  for (const f of readdirSync(out)) if (f !== '.vercel') rmSync(`${out}/${f}`, { recursive: true, force: true });
  const js = await bundle('web', GAME_URL);
  const og = `${GAME_URL}/og.png`;
  const head = `<link rel="canonical" href="${GAME_URL}/">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${NAME}">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${DESC}">
<meta property="og:url" content="${GAME_URL}/">
<meta property="og:image" content="${og}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="en_US">
<meta property="og:locale:alternate" content="es_ES">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@nocodeboy">
<meta name="twitter:creator" content="@nocodeboy">
<meta name="twitter:title" content="${TITLE}">
<meta name="twitter:description" content="${DESC}">
<meta name="twitter:image" content="${og}">`;
  writeFileSync(`${out}/index.html`, page({ js, headExtra: head }));
  copyFonts(out);
  for (const f of Object.values(music)) copyFileSync(`assets/${f}`, `${out}/${f}`);
  for (const f of ['og.png', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'favicon-32.png']) if (existsSync(`assets/${f}`)) copyFileSync(`assets/${f}`, `${out}/${f}`);
  writeFileSync(
    `${out}/manifest.webmanifest`,
    JSON.stringify(
      {
        name: NAME,
        short_name: 'Wild Putt',
        description: DESC,
        start_url: '/',
        display: 'fullscreen',
        orientation: 'any',
        background_color: '#1f3a2a',
        theme_color: '#1f3a2a',
        lang: 'en',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      null,
      2,
    ),
  );
  writeFileSync(`${out}/privacidad.html`, readFileSync('src/privacidad.html', 'utf8'));
  // AdMob reads it from the developer website of the Play listing (https://wild-putt.vercel.app/app-ads.txt)
  if (existsSync('assets/app-ads.txt')) copyFileSync('assets/app-ads.txt', `${out}/app-ads.txt`);
  writeFileSync(
    `${out}/vercel.json`,
    JSON.stringify(
      {
        cleanUrls: true,
        headers: [
          { source: '/(.*)\\.(mp3|png|webp|woff2)', headers: [{ key: 'Cache-Control', value: 'public, max-age=604800' }] },
          { source: '/', headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }] },
        ],
      },
      null,
      2,
    ),
  );
  console.log('web/index.html', kb(readFileSync(`${out}/index.html`).length));
}

// ---------- CrazyGames ----------
if (!WEB_ONLY) {
  const out = 'dist/crazygames';
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const js = await bundle('crazygames', '');
  writeFileSync(`${out}/index.html`, page({ js, headExtra: '<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>', fontTags: fontsInline }));
  for (const f of Object.values(music)) copyFileSync(`assets/${f}`, `${out}/${f}`);
  rmSync('dist/wildputt-crazygames.zip', { force: true });
  execSync(`cd ${out} && zip -qr ../wildputt-crazygames.zip .`);
  console.log('crazygames zip', kb(readFileSync('dist/wildputt-crazygames.zip').length), CG_ADS ? '(with ads)' : '(no ads: Basic Launch)');
}

// ---------- Android (Capacitor) ----------
// Release guard (ported from ¡Apágalo!): the AdMob switch in src/monetize/android.ts and the AdMob app id in the
// manifest must agree, and a release (RELEASE=1) must use the real ones. android/app/build.gradle checks the same
// again for bundleRelease/assembleRelease through ads-check.json.
const TEST_APP_ID = 'ca-app-pub-3940256099942544~3347511713';
function androidAdsCheck() {
  const src = readFileSync('src/monetize/android.ts', 'utf8');
  const sw = src.match(/^\s*USE_TEST_ADS:\s*(true|false)\s*,/m);
  const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
  const app = manifest.match(/com\.google\.android\.gms\.ads\.APPLICATION_ID"\s+android:value="([^"]*)"/);
  if (!sw || !app) return { error: 'cannot read USE_TEST_ADS in src/monetize/android.ts or the AdMob app id in AndroidManifest.xml' };
  const testAds = sw[1] === 'true';
  const testAppId = app[1] === TEST_APP_ID;
  if (!testAds && testAppId) return { error: `USE_TEST_ADS is false but AndroidManifest.xml still has Google's test AdMob app id (${TEST_APP_ID}): paste your own app id (ca-app-pub-…~…)` };
  if (process.env.RELEASE === '1' && testAds) return { error: 'RELEASE=1 with USE_TEST_ADS: true in src/monetize/android.ts: a release must use the real ad units' };
  if (process.env.RELEASE === '1' && testAppId) return { error: `RELEASE=1 but AndroidManifest.xml still has Google's test AdMob app id (${TEST_APP_ID})` };
  return { testAds, testAppId };
}
if (!WEB_ONLY) {
  const out = 'dist/android';
  rmSync(out, { recursive: true, force: true });
  const ads = androidAdsCheck();
  if (ads.error) {
    // no dist/android: `cap sync` cannot copy a wrong build into the app
    console.error(`android: NOT BUILT. ${ads.error}`);
    process.exitCode = 1;
  } else {
    mkdirSync(out, { recursive: true });
    // The app ships the loops as Opus (40 kbps sounds about like the 112 kbps MP3s on a phone), as the studio's other
    // games do, to keep the AAB small. Encoded once into build/music-android (ffmpeg + libopus). Android only: Safari
    // on iPhones does not play Opus in <audio>, so the web and CrazyGames keep the MP3s.
    const musicAndroid = {};
    mkdirSync('build/music-android', { recursive: true });
    for (const [k, f] of Object.entries(music)) {
      const ogg = f.replace(/\.mp3$/, '.ogg');
      const dst = `build/music-android/${ogg}`;
      if (!existsSync(dst) || statSync(dst).mtimeMs < statSync(`assets/${f}`).mtimeMs) {
        execSync(`ffmpeg -v error -y -i assets/${f} -c:a libopus -b:a 40k -vbr on -application audio ${dst}`);
      }
      copyFileSync(dst, `${out}/${ogg}`);
      musicAndroid[k] = ogg;
    }
    const js = await bundle('android', GAME_URL, musicAndroid);
    writeFileSync(`${out}/index.html`, page({ js }));
    copyFonts(out);
    // read by android/app/build.gradle before a release build
    writeFileSync(`${out}/ads-check.json`, JSON.stringify({ version: VERSION, testAds: ads.testAds, release: process.env.RELEASE === '1' }));
    console.log('android/index.html', kb(readFileSync(`${out}/index.html`).length), ads.testAds ? '(TEST ads)' : '(real ads)');
  }
}

// ---------- Claude artifact ----------
if (!WEB_ONLY) {
  const js = await bundle('artifact', GAME_URL);
  const artifact = `<title>${NAME}</title>
<meta name="description" content="${DESC}">
${fonts}
<style>${css}</style>
${body}
<script>${js}</script>
`;
  writeFileSync('dist/artifact.html', artifact);
  console.log('artifact.html', kb(artifact.length), '| music', JSON.stringify(music));
}
