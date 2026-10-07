# QA: plays hand-written test holes (tools/testholes/*.json) in the real game and takes screenshots.
# Usage: python3 tools/testshots.py out-dir file.json [--over] [--bot=secs]
import asyncio, json, os, sys
from playwright.async_api import async_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import assets as A

async def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    defs = json.load(open(sys.argv[2]))
    over = '--over' in sys.argv
    bot = float(next((a.split('=')[1] for a in sys.argv if a.startswith('--bot=')), 0))
    async with async_playwright() as p:
        b = await p.chromium.launch(args=A.ARGS)
        ctx = await b.new_context(viewport={'width': 540, 'height': 960}, device_scale_factor=1, locale='en-US')
        page = await ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        await page.goto(A.URL); await page.wait_for_timeout(800)
        await page.evaluate(A.SAVE)
        await page.goto(A.URL); await page.wait_for_timeout(1500)
        await page.add_style_tag(content='#toast,.tut,.stick,.banner,.holecard,.guide-ring,.guide-arrow,#hud,#icons{display:none!important}')
        for d in defs:
            await page.evaluate("() => { const m = window.__golf; m.openLevel(3); m.startPlay(); m.stage.skipIntro(); }")
            await page.evaluate("(d) => { const m = window.__golf; m.testDef(d); m.stage.skipIntro(); }", d)
            if over:
                await page.evaluate("() => { window.__golf.stage.mode = 'overview'; }")
            await page.wait_for_timeout(2000)
            await page.screenshot(path=f'{out}/{d["id"]}{"o" if over else ""}.png')
            if bot:
                await page.evaluate("(s) => window.__golf.bot(s)", bot)
                await page.wait_for_timeout(600)
                await page.screenshot(path=f'{out}/{d["id"]}b.png')
            print(d['id'], flush=True)
        if errs: print('ERRORS', errs[:8])
        await b.close()

asyncio.run(main())
