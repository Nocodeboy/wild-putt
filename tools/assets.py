# Renders store/share assets from the real game: app icons, OG image, CrazyGames covers (and, through
# tools/android_assets.py, the Play listing). Holes are picked by their number on the tour (L1..L120).
# Usage: python3 tools/assets.py [all|icons|og|covers]   (with `npm run build` done and `npm run serve` running)
import asyncio, os
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = 'http://127.0.0.1:8765/web/index.html'  # served: file:// blocks the self-hosted fonts
OUT = f'{ROOT}/assets/'
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']

SAVE = "localStorage.setItem('wildputt.v2', JSON.stringify({v:2,stars:{},best:Object.fromEntries(Array.from({length:120},(_, i)=>['L'+(i+1),3])),daily:{},streak:{count:0,last:''},settings:{sfx:false,music:false,vibration:false,gfx:'high',autoTier:'high',lang:'en',stats:false},tutorialDone:true,firstOpen:false,seenTips:[],coins:1250}))"

# A golf ball rolling to the cup on a green island, with the red flag
ICON_SVG = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fd0f2"/><stop offset="1" stop-color="#c8ecfa"/></linearGradient>
<linearGradient id="gr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6ccf62"/><stop offset="1" stop-color="#46a845"/></linearGradient></defs>
<rect width="512" height="512" fill="url(#g)"/>
<path d="M60 330 L256 236 L452 330 L256 424 Z" fill="url(#gr)"/>
<path d="M60 330 L256 424 L256 470 L60 376 Z" fill="#8a6a44"/><path d="M452 330 L256 424 L256 470 L452 376 Z" fill="#6f5435"/>
<path d="M60 330 L256 236 L452 330 L440 336 L256 248 L72 336 Z" fill="#d9b98a"/>
<ellipse cx="300" cy="318" rx="34" ry="17" fill="#141414"/>
<rect x="294" y="110" width="12" height="208" rx="6" fill="#f4f4f0"/>
<path d="M306 116 h104 l-30 36 l30 36 h-104 z" fill="#e8483a"/>
<ellipse cx="196" cy="372" rx="30" ry="10" fill="#000" opacity=".25"/>
<circle cx="190" cy="342" r="36" fill="#fff"/>
<circle cx="178" cy="330" r="4" fill="#d0d4d8"/><circle cx="196" cy="326" r="4" fill="#d0d4d8"/><circle cx="184" cy="346" r="4" fill="#d0d4d8"/><circle cx="204" cy="342" r="4" fill="#d0d4d8"/><circle cx="194" cy="360" r="4" fill="#d0d4d8"/>
<path d="M118 352 q-30 2 -52 -6 M124 368 q-28 6 -50 2" stroke="#fff" stroke-width="7" stroke-linecap="round" fill="none" opacity=".8"/>
</svg>'''

HIDE_UI = "document.head.insertAdjacentHTML('beforeend','<style>#hud,#icons,#floaters,#toast,.tut,.stick,#screens,.banner,.holecard,.guide-ring,.guide-arrow{display:none!important}</style>')"

def title_html(size, tag=False, top='5%', shift=0):
    tagline = '<p style="margin:14px 0 0;transform:translateX(%dpx);font-family:Baloo 2,sans-serif;font-weight:800;font-size:%dpx;color:#fff;text-shadow:0 3px 8px rgba(0,0,0,.7)">Mini golf where mini golf shouldn’t be</p>' % (shift, int(size * 0.3)) if tag else ''
    return f'''<div id="poster" style="position:fixed;inset:0;z-index:60;pointer-events:none;display:flex;flex-direction:column;align-items:center;padding-top:{top};background:linear-gradient(180deg,rgba(10,30,20,.55) 0%,rgba(10,30,20,0) 40%)">
<h1 style="font-family:Bungee,Impact,sans-serif;font-weight:400;font-size:{size}px;line-height:.95;text-align:center;margin:0;color:#fff;letter-spacing:-.01em;transform:translateX({shift}px) rotate(-3deg);text-shadow:0 {size*0.06:.0f}px 0 #e0402f,0 {size*0.11:.0f}px 0 #a52a1e,0 {size*0.2:.0f}px {size*0.35:.0f}px rgba(0,0,0,.45)">WILD PUTT</h1>
<div style="width:{size*5.2:.0f}px;height:{max(12,size*0.14):.0f}px;margin-top:{size*0.28:.0f}px;transform:translateX({shift}px) rotate(-3deg);background:conic-gradient(#e0402f 25%,#fff6e6 0 50%,#e0402f 0 75%,#fff6e6 0) 0 0/{max(12,size*0.14):.0f}px {max(12,size*0.14):.0f}px;border-radius:4px"></div>
{tagline}</div>'''

# a putting moment: the hole framed, the ball rolling towards the cup (the bot putts)
SCENE = '''((opts) => {
  window.__poster = true;
  const m = window.__golf;
  m.openLevel(opts.level);
  m.startPlay();
  m.stage.skipIntro();
  m.bot(opts.bot);
  m.recStart();
  m.stage.zoom = m.stage.zoomTarget = opts.zoom;
  m.stage.focus = { x: m.sim.W / 2, z: m.sim.H / 2 + opts.dz };
  for (let i = 0; i < 40; i++) m.recTick(1 / 60, 1);
  return { state: m.sim.state, strokes: m.sim.strokes };
})'''

# holes of the tour used for the pictures
CANYON = 67  # The Gap: the ramps and the canyon below
NEON = 55  # Fast Lane: the booster at night
FAIR = 9  # The Windmill, at night

async def shot(p, name, w, h, level, zoom, wait, bot, title_size=None, tag=False, top='5%', dz=0.0, shift=0):
    b = await p.chromium.launch(args=ARGS)
    ctx = await b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1, has_touch=True, is_mobile=w < h, locale='en-US')
    page = await ctx.new_page()
    await page.goto(URL); await page.wait_for_timeout(800)
    await page.evaluate(SAVE)
    await page.goto(URL); await page.wait_for_timeout(1500)
    await page.evaluate(HIDE_UI)
    r = await page.evaluate(SCENE + '(%s)' % ('{zoom:%s,level:%s,bot:%s,dz:%s}' % (zoom, level, bot, dz)))
    await page.wait_for_timeout(500)
    if title_size:
        await page.evaluate("(h)=>document.body.insertAdjacentHTML('beforeend', h)", title_html(title_size, tag, top, shift))
        await page.wait_for_timeout(900)
    await page.screenshot(path=OUT + name, timeout=180000)
    await b.close()
    print(name, r)

async def icons(p):
    b = await p.chromium.launch(args=ARGS)
    for size, name in [(512, 'icon-512.png'), (192, 'icon-192.png'), (180, 'apple-touch-icon.png'), (32, 'favicon-32.png')]:
        page = await b.new_page(viewport={'width': size, 'height': size})
        await page.set_content(f'<html><body style="margin:0">{ICON_SVG.replace("<svg ", f"<svg width={size} height={size} ")}</body></html>')
        await page.screenshot(path=OUT + name, timeout=180000)
        await page.close()
    await b.close()
    print('icons ok')

async def main():
    import sys
    which = sys.argv[1] if len(sys.argv) > 1 else 'all'
    async with async_playwright() as p:
        if which in ('all', 'icons'):
            await icons(p)
        # the scenes: the canyon jump, Neon City's boosters and the funfair's windmill at night
        if which in ('all', 'og'):
            await shot(p, 'og.png', 1200, 630, CANYON, 1.0, 1, 0.75, 70, tag=True, top='3%', dz=-3.2, shift=270)
        if which in ('all', 'covers'):
            # CrazyGames puts labels over the top-left corner of the covers: the title stays out of it
            await shot(p, 'cg-cover-1920x1080.png', 1920, 1080, CANYON, 1.0, 1, 0.75, 112, top='3%', dz=-3.2, shift=330)
            await shot(p, 'cg-cover-800x1200.png', 800, 1200, NEON, 0.85, 1, 0.6, 58, top='10.5%', dz=-3.0)
            await shot(p, 'cg-cover-800x800.png', 800, 800, FAIR, 0.9, 1, 0.9, 50, top='4%', dz=-2.4, shift=170)

if __name__ == '__main__':
    asyncio.run(main())
