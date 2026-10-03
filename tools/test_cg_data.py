# CrazyGames build + mocked SDK Data module: the portal copy of the save must win on load,
# a first-time portal player must get their local save copied in, and new progress must be written back.
import asyncio
import json

from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8765/crazygames/index.html'
KEY = 'wildputt.v2'


def mock(cloud):
    return """window.__cg=[];window.__cloud=%s;window.CrazyGames={SDK:{environment:'crazygames',
init:async()=>{__cg.push('init')},
data:{getItem:k=>(k in __cloud?__cloud[k]:null),setItem:(k,v)=>{__cloud[k]=v;__cg.push('setItem')},removeItem:k=>{delete __cloud[k]},clear:()=>{__cloud={}}},
game:{loadingStart:()=>__cg.push('loadingStart'),loadingStop:()=>__cg.push('loadingStop'),gameplayStart:()=>__cg.push('gameplayStart'),
gameplayStop:()=>__cg.push('gameplayStop'),happytime:()=>__cg.push('happytime')}}};""" % json.dumps(cloud)


async def run(p, name, cloud, local):
    b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    ctx = await b.new_context(viewport={'width': 800, 'height': 450})
    if local is not None:
        await ctx.add_init_script(f"try{{localStorage.setItem({json.dumps(KEY)}, {json.dumps(json.dumps(local))})}}catch(e){{}}")
    page = await ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.on('console', lambda m: m.type == 'error' and errs.append(m.text))
    await page.route('https://sdk.crazygames.com/**', lambda r: r.fulfill(status=200, content_type='application/javascript', body=mock(cloud)))
    await page.goto(URL)
    await page.wait_for_timeout(2500)
    title = await page.evaluate("(document.querySelector('.title-screen')||{}).innerText||''")
    st = await page.evaluate("({cg: window.__cg, cloud: window.__cloud[%s] ? JSON.parse(window.__cloud[%s]) : null})" % (json.dumps(KEY), json.dumps(KEY)))
    await b.close()
    stars = sum((st['cloud'] or {}).get('stars', {}).values())
    print(f'[{name}] calls={st["cg"]} cloud_stars={stars} lang={(st["cloud"] or {}).get("settings", {}).get("lang")} errors={errs}')
    print('   title:', ' | '.join(title.split('\n')[:6]))
    return st, title


async def main():
    async with async_playwright() as p:
        # 1) Returning player on another device: portal copy has 7 stars and English, local is empty
        cloud_save = {'v': 2, 'stars': {'L1': 3, 'L2': 3, 'L3': 1}, 'best': {'L1': 1, 'L2': 2, 'L3': 4}, 'daily': {}, 'streak': {'count': 0, 'last': ''}, 'coins': 420,
                      'settings': {'sfx': True, 'music': True, 'vibration': True, 'gfx': 'auto', 'autoTier': None, 'lang': 'en', 'stats': True},
                      'tutorialDone': True, 'firstOpen': False, 'seenTips': []}
        await run(p, 'cloud wins', {KEY: json.dumps(cloud_save)}, None)
        # 2) First time on the portal build but played before in this browser: local save is copied in
        local_save = dict(cloud_save, stars={'L1': 2}, best={'L1': 2}, settings=dict(cloud_save['settings'], lang='es'))
        await run(p, 'migrate local', {}, local_save)
        # 3) Brand-new player: fresh save is written to the portal store
        await run(p, 'new player', {}, None)


asyncio.run(main())
