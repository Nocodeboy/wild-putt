# Coins, shop (aim line and balls), rewarded ads, the mulligan, the interstitial's caps, the daily round's rules,
# trophies and the store (test doubles). Run against a local build: python3 -m http.server 8765 -d dist
#   python3 tools/test_monetize.py            (needs `node build.mjs` first)
# Uses the local test doubles (?fakeads=1&fakeiap=1, only on localhost) and the window.__golf hook.
import asyncio
import sys

from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8765/web/'
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
FAILS = []


def check(ok, what):
    print(('  ok  ' if ok else '  FAIL ') + what)
    if not ok:
        FAILS.append(what)


STATE = """(() => { const g = window.__golf, s = g.save;
  return { mode: g.mode, coins: s.coins, aim: s.aim, ball: s.ball, balls: s.balls, ads: s.ads, trophies: s.trophies, stars: s.stars,
    owned: s.owned, fake: window.__fakeads || null, strokes: g.sim ? g.sim.strokes : -1, kind: g.current ? g.current.kind : null }; })()"""


async def st(page):
    return await page.evaluate(STATE)


async def finish_hole(page):
    # the PRO bot plays the hole out; the end screen comes 1.5 s after the cup
    await page.evaluate('window.__golf.bot(60)')
    await page.wait_for_selector('.screen [data-a=retry]', timeout=15000)
    await page.wait_for_timeout(2600)


async def fresh(page, query='?fakeads=1&fakeiap=1', seed=None):
    await page.goto(URL + query)
    await page.evaluate('localStorage.clear()')
    if seed:
        await page.evaluate(seed)
    await page.goto(URL + query)
    await page.wait_for_timeout(1800)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True)
        page = await ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))

        print('first session: hole coins, x2 once, no interstitial, shop')
        await fresh(page)
        await page.click('[data-a=play]')
        await page.wait_for_timeout(600)
        await finish_hole(page)
        s = await st(page)
        check(s['coins'] > 0 and 'L1' in s['stars'], f'hole 1 pays coins ({s["coins"]})')
        c0 = s['coins']
        await page.click('[data-a=double]')
        await page.wait_for_timeout(2000)
        s = await st(page)
        check(s['coins'] == c0 * 2 and s['fake']['rewarded'] == ['double_coins'], f'x2 doubles the hole coins ({c0} -> {s["coins"]})')
        check(not await page.query_selector('[data-a=double]'), 'x2 only once per hole')
        for n in range(2, 6):
            await page.click('[data-a=next]')
            await page.wait_for_timeout(700)
            if await page.query_selector('[data-a=go]'):
                await page.click('[data-a=go]')
            await page.wait_for_timeout(400)
            await finish_hole(page)
        s = await st(page)
        check(s['fake']['interstitial'] == [], f'no interstitial in the first session (level ends {s["ads"]["levelEnds"]})')
        # shop: aim line, a ball, free coins up to 3 a day
        await page.evaluate('window.__golf.save.coins = 5000')
        await page.click('.coinbox [data-a=shop]')
        await page.wait_for_timeout(500)
        await page.click('[data-a=aim]')
        await page.wait_for_timeout(200)
        await page.click('[data-ball=comet]')
        await page.wait_for_timeout(200)
        s = await st(page)
        check(s['aim'] == 1 and s['ball'] == 'comet' and s['coins'] == 5000 - 300 - 2500, f'aim line 300 and the comet 2,500 ({s["coins"]})')
        for k in range(4):
            btn = await page.query_selector('[data-a=free]')
            if not btn:
                break
            await btn.click()
            await page.wait_for_timeout(1800)
        s = await st(page)
        check(s['coins'] == 2200 + 3 * 150 and s['fake']['rewarded'].count('free_coins') == 3, f'free coins: 3 × 150 a day ({s["coins"]})')
        check(not await page.query_selector('[data-a=free]'), 'no 4th free-coins ad today')

        print('second session: interstitial on Next with its caps; mulligan; cup trophy')
        await page.goto(URL + '?fakeads=1&fakeiap=1')
        await page.wait_for_timeout(1800)
        await page.evaluate("""(() => { const s = window.__golf.save; for (let n = 1; n <= 9; n++) { s.best['L' + n] = 3; s.stars['L' + n] = 2; } })()""")
        await page.evaluate('window.__golf.openLevel(10)')
        await page.wait_for_timeout(400)
        await page.click('[data-a=go]')
        await page.evaluate('window.__golf.stage.skipIntro()')
        await page.wait_for_timeout(600)
        # a soft putt, then the mulligan (with coins)
        await page.mouse.move(195, 420)
        await page.mouse.down()
        await page.mouse.move(195, 470, steps=5)
        await page.mouse.up()
        await page.wait_for_timeout(6000)
        coins = (await st(page))['coins']
        check(await page.evaluate("!document.getElementById('hud-mull').hidden"), 'mulligan offered after a putt')
        await page.click('#hud-mull')
        await page.wait_for_timeout(400)
        await page.click('.mull-screen [data-a=coins]')
        await page.wait_for_timeout(600)
        s = await st(page)
        check(s['strokes'] == 0 and s['coins'] == coins - 100, f'mulligan with coins: stroke undone, 100 coins ({s["strokes"]}, {coins} -> {s["coins"]})')
        await page.mouse.move(195, 420)
        await page.mouse.down()
        await page.mouse.move(195, 470, steps=5)
        await page.mouse.up()
        await page.wait_for_timeout(6000)
        check(await page.evaluate("document.getElementById('hud-mull').hidden"), 'only one mulligan per hole')
        await finish_hole(page)
        s = await st(page)
        check('garden' in s['trophies'] or s['stars'].get('L10', 0) < 2, f'cup hole at par or better wins the trophy ({s["trophies"]})')
        await page.evaluate("document.querySelector('.pc-modal [data-a=close]')?.click()")
        # (the free-coins ads a moment ago count for the 120 s gap: pretend it has passed)
        await page.evaluate('window.__golf.save.ads.lastFullscreen = 0')
        await page.click('[data-a=next]')
        await page.wait_for_timeout(1800)
        s = await st(page)
        check(s['fake']['interstitial'] == ['between_levels'], f'interstitial on Next after the caps ({s["fake"]["interstitial"]}, ends {s["ads"]["levelEnds"]})')

        print('daily round: plain aim line, no mulligan')
        await page.evaluate('window.__golf.openDaily()')
        await page.wait_for_timeout(500)
        await page.click('[data-a=go]')
        await page.evaluate('window.__golf.stage.skipIntro()')
        await page.wait_for_timeout(600)
        aim_len = await page.evaluate('window.__golf.stage.view.aimLen')
        check(aim_len == 1, f'daily: the aim line is the plain one ({aim_len})')
        await page.mouse.move(195, 420)
        await page.mouse.down()
        await page.mouse.move(195, 470, steps=5)
        await page.mouse.up()
        await page.wait_for_timeout(6000)
        check(await page.evaluate("document.getElementById('hud-mull').hidden"), 'no mulligan in the daily')

        print('store: coins, remove ads, restore')
        await page.evaluate('window.__golf.openLevel(3)')
        await page.goto(URL + '?fakeads=1&fakeiap=1')
        await page.wait_for_timeout(1800)
        coins = (await st(page))['coins']
        await page.click('.title-screen > .wallet')
        await page.wait_for_timeout(500)
        await page.click('[data-p=coins_s]')
        await page.wait_for_timeout(2500)
        s = await st(page)
        check(s['coins'] == coins + 1000, f'bag of coins: +1,000 ({coins} -> {s["coins"]})')
        await page.click('[data-p=remove_ads]')
        await page.wait_for_timeout(2500)
        s = await st(page)
        check(s['owned']['remove_ads'] and s['coins'] == coins + 1500, f'no ads: owned and +500 coins ({s["coins"]})')

        print('web without the test doubles: no ad buttons, no purchases')
        await fresh(page, '', "localStorage.setItem('wildputt.v2', JSON.stringify({v:2, coins: 999, firstOpen:false, best:{L1:2}, stars:{L1:2}}))")
        await page.click('.title-screen > .wallet')
        await page.wait_for_timeout(500)
        check(not await page.query_selector('[data-a=free]') and not await page.query_selector('[data-p]'), 'shop on the web: no free-coins ad, no purchases')
        check(await page.query_selector('[data-a=aim]') is not None, 'shop on the web: the aim line and the balls are there')

        check(not errs, f'no page errors {errs[:3]}')
        await b.close()
    print(f'\n{"ALL OK" if not FAILS else str(len(FAILS)) + " FAILED"}')
    sys.exit(1 if FAILS else 0)


asyncio.run(main())
