# Android app icons and launch screen, drawn from the game's icon (tools/assets.py ICON_SVG):
#   android/app/src/main/res/   launcher icons (adaptive: background + foreground layers, legacy and round) and splash
#   assets/play/                the Play Store listing: icon 512, feature graphic 1024x500, phone screenshots 1080x1920
# Usage: python3 tools/android_assets.py [all|icons|splash|store [name]]    (after `npx cap add android`; `store`
#        needs `npm run build` done and dist/ served, PORT env as in tools/assets.py)
#        CHROMIUM=/path/to/chromium for a preinstalled Chromium
import asyncio, os, re, sys
from PIL import Image, ImageDraw
from playwright.async_api import async_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import assets as A  # noqa: E402  (ICON_SVG, ARGS, SAVE, URL, shot)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = f'{ROOT}/android/app/src/main/res'
PLAY = f'{ROOT}/assets/play'
DENS = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
BG_COLOR = '#1f3a2a'

# the icon split in two layers: the adaptive mask shows the middle 72 of 108 dp and may crop it to a circle, so the
# island, the flag and the ball go inside the 66 dp safe zone, and the sky fills the whole background
_inner = re.sub(r'^<svg[^>]*>|</svg>$', '', A.ICON_SVG.strip())
_defs = re.search(r'<defs>.*?</defs>', _inner, re.S).group(0)
_bg = re.search(r'<rect width="512"[^>]*/>', _inner).group(0)
_art = re.sub(r'<defs>.*?</defs>|<rect width="512"[^>]*/>', '', _inner, flags=re.S)
K = 0.66
FG_SVG = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">{_defs}<g transform="translate({256 - 256 * K:.1f} {256 - 300 * K:.1f}) scale({K})">{_art}</g></svg>'
BG_SVG = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">{_defs}{_bg}</svg>'


async def svg_png(b, svg, size, path, transparent=False):
    page = await b.new_page(viewport={'width': size, 'height': size})
    bg = 'transparent' if transparent else BG_COLOR
    await page.set_content(f'<html><body style="margin:0;background:{bg}">{svg.replace("<svg ", f"<svg width={size} height={size} ", 1)}</body></html>')
    await page.screenshot(path=path, omit_background=transparent)
    await page.close()


async def icons(p):
    b = await p.chromium.launch(args=A.ARGS)
    for d, k in DENS.items():
        folder = f'{RES}/mipmap-{d}'
        os.makedirs(folder, exist_ok=True)
        await svg_png(b, FG_SVG, round(108 * k), f'{folder}/ic_launcher_foreground.png', transparent=True)
        await svg_png(b, BG_SVG, round(108 * k), f'{folder}/ic_launcher_background.png')
        n = round(48 * k)
        await svg_png(b, A.ICON_SVG, n, f'{folder}/ic_launcher.png')
        im = Image.open(f'{folder}/ic_launcher.png').convert('RGBA')
        mask = Image.new('L', (n, n), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, n - 1, n - 1), fill=255)
        im.putalpha(mask)
        im.save(f'{folder}/ic_launcher_round.png')
    xml = '''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>'''
    os.makedirs(f'{RES}/mipmap-anydpi-v26', exist_ok=True)
    for f in ('ic_launcher.xml', 'ic_launcher_round.xml'):
        open(f'{RES}/mipmap-anydpi-v26/{f}', 'w').write(xml)
    os.makedirs(PLAY, exist_ok=True)
    await svg_png(b, A.ICON_SVG, 512, f'{PLAY}/icon-512.png')
    await b.close()
    print('icons ok')


def splash():
    """The launch screen: the icon in the middle of the game's dark green (each splash.png keeps its size)."""
    icon = Image.open(f'{ROOT}/assets/icon-512.png').convert('RGBA')
    for root, _, files in os.walk(RES):
        for f in files:
            if f != 'splash.png':
                continue
            path = f'{root}/{f}'
            w, h = Image.open(path).size
            im = Image.new('RGB', (w, h), BG_COLOR)
            s = round(min(w, h) * 0.34)
            ic = icon.resize((s, s), Image.LANCZOS)
            m = Image.new('L', (s, s), 0)
            ImageDraw.Draw(m).rounded_rectangle((0, 0, s - 1, s - 1), radius=s // 5, fill=255)
            im.paste(ic, ((w - s) // 2, (h - s) // 2), m)
            im.save(path)
    print('splash ok')


# phone screenshots for the listing (docs/publicar.md §4): a hole of each of six courses in play, with the HUD
STORE_SHOTS = [
    (55, 'shot1-neon.png'),
    (67, 'shot2-canyon.png'),
    (44, 'shot3-castle.png'),
    (21, 'shot4-volcano.png'),
    (35, 'shot5-temple.png'),
    (81, 'shot6-moon.png'),
]


async def store(p, only=''):
    os.makedirs(PLAY, exist_ok=True)
    A.OUT = PLAY + '/'
    # feature graphic: the canyon jump, the title below the top edge (as the covers)
    if only in 'feature-1024x500.png':
        await A.shot(p, 'feature-1024x500.png', 1024, 500, A.CANYON, 1.0, 1, 0.75, 64, tag=True, top='3%', dz=-3.2, shift=250)
    for n, name in STORE_SHOTS:
        if only not in name:
            continue
        b = await p.chromium.launch(args=A.ARGS)
        ctx = await b.new_context(viewport={'width': 360, 'height': 640}, device_scale_factor=3, has_touch=True, is_mobile=True, locale='en-US')
        page = await ctx.new_page()
        await page.goto(A.URL); await page.wait_for_timeout(800)
        await page.evaluate(A.SAVE)
        await page.goto(A.URL); await page.wait_for_timeout(1500)
        await page.evaluate("(n) => { const m = window.__golf; m.openLevel(n); m.startPlay(); m.stage.skipIntro(); }", n)
        await page.add_style_tag(content='#toast,.tut,.stick,.banner,.holecard,.guide-ring,.guide-arrow{display:none!important}')
        # aim like a player about to putt: the dotted line and the power ring show
        await page.wait_for_timeout(1500)
        await page.evaluate("(() => { const m = window.__golf; const s = m.sim; const a = s.guideAngle(s.ball.x, s.ball.z); m.input.aim = { kind: 'world', angle: a, power: 0.55 }; })()")
        await page.wait_for_timeout(1800)
        await page.screenshot(path=f'{PLAY}/{name}', timeout=180000)
        await b.close()
        print(name, 'hole', n)


async def main():
    which = sys.argv[1] if len(sys.argv) > 1 else 'all'
    async with async_playwright() as p:
        if which in ('all', 'icons'):
            await icons(p)
        if which in ('all', 'splash'):
            splash()
        if which == 'store':
            await store(p, sys.argv[2] if len(sys.argv) > 2 else '')


if __name__ == '__main__':
    asyncio.run(main())
