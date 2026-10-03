# Loads the CrazyGames build with a mocked SDK and checks the call sequence + no errors.
# Ads are off by default (__CG_ADS__, Basic Launch): no ad request may reach the SDK and no x2 button is shown.
# With --ads (build made with CG_ADS=1 npm run build) it checks the rewarded x2 through the SDK ad module instead.
# Serve dist/ first: PORT env (default 8765). Screenshot: build/cg-end.png
import asyncio
import os
import sys

from playwright.async_api import async_playwright

URL = f"http://127.0.0.1:{os.environ.get('PORT', '8765')}/crazygames/index.html"
ADS = '--ads' in sys.argv
MOCK = """window.__cg=[];window.CrazyGames={SDK:{environment:'crazygames',init:async()=>{__cg.push('init')},data:{getItem:k=>null,setItem:(k,v)=>__cg.push('setItem')},game:{
loadingStart:()=>__cg.push('loadingStart'),loadingStop:()=>__cg.push('loadingStop'),gameplayStart:()=>__cg.push('gameplayStart'),
gameplayStop:()=>__cg.push('gameplayStop'),happytime:()=>__cg.push('happytime')},
ad:{hasAdblock:async()=>false,requestAd:(type,cb)=>{__cg.push('requestAd:'+type);cb.adStarted&&cb.adStarted();setTimeout(()=>cb.adFinished&&cb.adFinished(),300)}}}};"""


async def main():
    ok = True
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        ctx = await b.new_context(viewport={'width': 800, 'height': 450})
        page = await ctx.new_page()
        errs, reqs = [], []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.on('console', lambda m: m.type == 'error' and errs.append(m.text))
        page.on('request', lambda r: reqs.append(r.url))
        await page.route('https://sdk.crazygames.com/**', lambda r: r.fulfill(status=200, content_type='application/javascript', body=MOCK))
        await page.route('https://fonts.googleapis.com/**', lambda r: r.continue_())
        await page.goto(URL)
        await page.wait_for_timeout(2500)
        # first open: "Play" goes straight into level 1
        await page.click('[data-a=play]')
        await page.wait_for_timeout(600)
        if await page.query_selector('[data-a=go]'):
            await page.click('[data-a=go]')
            await page.wait_for_timeout(500)
        await page.evaluate('window.__golf.bot(120)')
        await page.wait_for_selector('.screen [data-a=retry]', timeout=30000)
        await page.wait_for_timeout(2500)
        coins0 = await page.evaluate('window.__golf.save.coins')
        if ADS and await page.query_selector('[data-a=double]'):
            await page.click('[data-a=double]')
            await page.wait_for_timeout(1500)
        st = await page.evaluate("({cg: window.__cg, mode: window.__golf.mode, coins: window.__golf.save.coins, x2: !!document.querySelector('[data-a=double]'), links: [...document.querySelectorAll('a[href^=http]')].map(a=>a.href), share: !!document.querySelector('[data-a=share]')})")
        os.makedirs('build', exist_ok=True)
        await page.screenshot(path='build/cg-end.png')
        print(st)
        seq = [c for c in st['cg'] if not c.startswith('requestAd') and c != 'setItem']
        want = ['init', 'loadingStart', 'loadingStop', 'gameplayStart', 'gameplayStop']
        it = iter(seq)
        in_order = all(any(c == w for c in it) for w in want)
        print('sdk sequence:', 'OK' if in_order else 'FAIL', seq)
        ok &= in_order
        ad_calls = [c for c in st['cg'] if c.startswith('requestAd')]
        if ADS:
            good = ad_calls == ['requestAd:rewarded'] and st['coins'] > coins0
            print('ads ON:', 'OK' if good else 'FAIL', ad_calls, 'coins', coins0, '->', st['coins'])
        else:
            good = not ad_calls and not st['x2']
            print('ads off:', 'OK' if good else 'FAIL', 'ad calls', ad_calls, 'x2 button', st['x2'])
        ok &= good
        ext = sorted({u.split('/')[2] for u in reqs if u.startswith('http') and '127.0.0.1' not in u})
        print('errors', errs)
        print('external', ext, '| links', st['links'])
        ok &= not errs and not st['links']
        # no "More games" on CrazyGames (external links are not allowed there)
        await page.click('.screen [data-a=menu]')
        await page.wait_for_selector('.title-screen')
        more = await page.query_selector('[data-a=more]')
        print('more games hidden:', 'OK' if not more else 'FAIL')
        ok &= not more
        await b.close()
    print('ALL OK' if ok else 'FAILED')
    sys.exit(0 if ok else 1)


asyncio.run(main())
