# Loads the CrazyGames build with a mocked SDK and checks the call sequence + no errors.
import asyncio
from playwright.async_api import async_playwright
URL = 'http://127.0.0.1:8765/crazygames/index.html'
MOCK = """window.__cg=[];window.CrazyGames={SDK:{environment:'crazygames',init:async()=>{__cg.push('init')},data:{getItem:k=>null,setItem:(k,v)=>__cg.push('setItem')},game:{
loadingStart:()=>__cg.push('loadingStart'),loadingStop:()=>__cg.push('loadingStop'),gameplayStart:()=>__cg.push('gameplayStart'),
gameplayStop:()=>__cg.push('gameplayStop'),happytime:()=>__cg.push('happytime')}}};"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        ctx = await b.new_context(viewport={'width':800,'height':450})
        page = await ctx.new_page()
        errs, reqs = [], []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.on('console', lambda m: m.type == 'error' and errs.append(m.text))
        page.on('request', lambda r: reqs.append(r.url))
        await page.route('https://sdk.crazygames.com/**', lambda r: r.fulfill(status=200, content_type='application/javascript', body=MOCK))
        await page.route('https://fonts.googleapis.com/**', lambda r: r.continue_())
        await page.goto(URL); await page.wait_for_timeout(2500)
        await page.click('[data-a=play]') if await page.query_selector('[data-a=play]') else await page.click('[data-a=levels]')
        await page.wait_for_timeout(500)
        if await page.query_selector('.lvl[data-i="0"]'): await page.click('.lvl[data-i="0"]'); await page.wait_for_timeout(300)
        if await page.query_selector('[data-a=go]'): await page.click('[data-a=go]'); await page.wait_for_timeout(500)
        await page.evaluate("window.__golf.bot(90)")
        await page.wait_for_timeout(5000)
        st = await page.evaluate("({cg: window.__cg, mode: window.__golf.mode, links: [...document.querySelectorAll('a[href^=http]')].map(a=>a.href), share: !!document.querySelector('[data-a=share]')})")
        await page.screenshot(path='build/cg-end.png')
        print(st)
        print('errors', errs)
        print('external', sorted({u.split('/')[2] for u in reqs if u.startswith('http')}))
        await b.close()
asyncio.run(main())
