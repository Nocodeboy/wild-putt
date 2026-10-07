# QA screenshots of holes of the tour, from the real game (chase camera and overview).
# Usage: python3 tools/shots.py out-dir L1 L5 … [--over] [--w=540 --h=960]   (with `npm run build` and `npm run serve`)
import asyncio, os, sys
from playwright.async_api import async_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import assets as A

async def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    holes = [int(a[1:]) for a in sys.argv[2:] if a.startswith('L')]
    over = '--over' in sys.argv
    W = int(next((a.split('=')[1] for a in sys.argv if a.startswith('--w=')), 540))
    H = int(next((a.split('=')[1] for a in sys.argv if a.startswith('--h=')), 960))
    async with async_playwright() as p:
        b = await p.chromium.launch(args=A.ARGS)
        ctx = await b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=1, locale='en-US')
        page = await ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto(A.URL); await page.wait_for_timeout(800)
        await page.evaluate(A.SAVE)
        await page.goto(A.URL); await page.wait_for_timeout(1500)
        await page.add_style_tag(content='#toast,.tut,.stick,.banner,.holecard,.guide-ring,.guide-arrow,#hud,#icons{display:none!important}')
        for n in holes:
            await page.evaluate("(n) => { const m = window.__golf; m.openLevel(n); m.startPlay(); m.stage.skipIntro(); }", n)
            if over:
                await page.evaluate("() => { window.__golf.stage.mode = 'overview'; }")
            await page.wait_for_timeout(2200)
            await page.screenshot(path=f'{out}/L{n}{"o" if over else ""}.png')
            print('L%d' % n, flush=True)
        if errs: print('ERRORS', errs[:5])
        await b.close()

asyncio.run(main())
