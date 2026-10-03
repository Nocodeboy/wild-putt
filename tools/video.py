# CrazyGames preview videos (1920x1080 and 1080x1620, 30 fps, about 15 s, no sound, no text, no UI) rendered frame by
# frame from the real game, as in Tray Runner and Round 'Em Up!: the page's own loop is stopped (__golf.recStart, the
# PRO bot putts) and every frame is advanced with a fixed dt, so the result is perfectly smooth even though headless
# WebGL renders at ~1 fps. Timers and CSS animations run on the same virtual clock.
#
# Usage: PROFILE=cg169|cg23 python3 tools/video.py [test|render|encode|all]
#        (with `npm run build` done and dist/ served: GAME_BASE, default http://127.0.0.1:8765; CHROMIUM=/path to use
#        a preinstalled Chromium). Output: build/video/wild-putt-crazygames-<w>x<h>.mp4
import asyncio, os, shutil, subprocess, sys
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = os.environ.get('GAME_BASE', 'http://127.0.0.1:8765') + '/web/index.html'  # served: file:// blocks the self-hosted fonts
FPS = 30
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
EXE = os.environ.get('CHROMIUM') or None

SAVE = "localStorage.setItem('wildputt.v2', JSON.stringify({v:2,stars:{},best:Object.fromEntries(Array.from({length:120},(_, i)=>['L'+(i+1),3])),daily:{},streak:{count:0,last:''},settings:{sfx:false,music:false,vibration:false,gfx:'high',autoTier:'high',lang:'en',stats:false},tutorialDone:true,firstOpen:false,seenTips:[]}))"

# Virtual clock for setTimeout + Web Animations (CSS animations/transitions), enabled by __vstart()
INIT = r'''(() => {
  const rs = window.setTimeout.bind(window), rc = window.clearTimeout.bind(window);
  const q = new Map(); let id = 1e7;
  window.__vt = null;
  window.setTimeout = (fn, ms = 0, ...a) => {
    if (window.__vt === null) return rs(fn, ms, ...a);
    const k = id++; q.set(k, { t: window.__vt + (+ms || 0) / 1000, fn, a }); return k;
  };
  window.clearTimeout = (k) => { if (q.has(k)) q.delete(k); else rc(k); };
  const born = new WeakMap();
  window.__vstart = () => { window.__vt = 0; };
  window.__vadvance = (dt) => {
    const t0 = window.__vt; window.__vt += dt;
    for (const [k, v] of [...q].sort((x, y) => x[1].t - y[1].t)) if (v.t <= window.__vt) { q.delete(k); try { if (typeof v.fn === 'function') v.fn(...v.a); } catch (e) {} }
    for (const an of document.getAnimations()) {
      if (!born.has(an)) { born.set(an, t0); an.pause(); }
      try { an.currentTime = (window.__vt - born.get(an)) * 1000; } catch (e) {}
    }
  };
})();'''

# no text and no UI on the portal's previews
STYLE = '<style>#hud,#icons,#floaters,#toast,.tut,.stick,#screens,#touch,.banner,#vignette,.holecard,.guide-ring,.guide-arrow{display:none!important}</style>'

HELPERS = r'''(() => {
  // advance n ticks of 1/30 s and wait for the GPU (otherwise SwiftShader work piles up behind screenshots)
  window.__step = (n) => {
    const a = window.__golf; a.recTick(1 / 30, n); window.__vadvance(n / 30);
    const gl = a.stage.renderer.getContext(); const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return a.sim.state;
  };
})()'''

# Each clip: a hole of the tour (`n`), recorded from just before the bot's first putt; `roll` seconds rendered but not
# captured so the camera settles; `frames` captured at 30 fps. The first clip is the cover's hole (tools/assets.py).
def clips(zoom, cover_zoom):
    return [
        dict(name='canyon', n=67, roll=0.6, frames=84, zoom=cover_zoom),
        dict(name='neon', n=55, roll=0.6, frames=75, zoom=zoom),
        dict(name='castle', n=44, roll=0.6, frames=80, zoom=zoom),
        dict(name='temple', n=35, roll=0.6, frames=75, zoom=zoom),
        dict(name='beach', n=27, roll=0.6, frames=70, zoom=zoom),
        dict(name='moon', n=81, roll=0.6, frames=80, zoom=zoom),
    ]


def profile(name):
    """cg169: 1920x1080 (rendered at 960x540 x1.5 and upscaled); cg23: 1080x1620 (540x810 x1.5)."""
    if name == 'cg23':
        return dict(W=540, H=810, DPR=1.5, mobile=True, size=(1080, 1620), clips=clips(0.95, 0.95))
    return dict(W=960, H=540, DPR=1.5, mobile=False, size=(1920, 1080), clips=clips(1.0, 1.0))


PROF = os.environ.get('PROFILE', 'cg169')
P = profile(PROF)
FR = f'{ROOT}/build/video/frames-{PROF}'
OUT = f"{ROOT}/build/video/wild-putt-crazygames-{P['size'][0]}x{P['size'][1]}.mp4"


async def open_level(b, n):
    ctx = await b.new_context(viewport={'width': P['W'], 'height': P['H']}, device_scale_factor=P['DPR'], has_touch=P['mobile'], is_mobile=P['mobile'], locale='en-US')
    await ctx.add_init_script(INIT)
    page = await ctx.new_page()
    page.on('pageerror', lambda e: print('PAGEERROR', e))
    await page.goto(URL); await page.wait_for_timeout(600)
    await page.evaluate(SAVE)
    await page.goto(URL); await page.wait_for_timeout(1400)
    await page.evaluate("(n) => { const m = window.__golf; m.openLevel(n); m.startPlay(); m.stage.skipIntro(); }", n)
    await page.wait_for_timeout(400)
    await page.evaluate("(h)=>document.body.insertAdjacentHTML('beforeend', h)", STYLE)
    await page.evaluate(HELPERS)
    await page.evaluate("document.fonts.ready")
    return ctx, page, n


async def record_clip(b, clip, limit, out):
    ctx, page, n = await open_level(b, clip['n'])
    z = clip['zoom']
    await page.evaluate(f"(()=>{{const a=window.__golf; a.recStart(); a.stage.zoom=a.stage.zoomTarget={z}; window.__vstart();}})()")
    for _ in range(int(clip['roll'] * FPS) // 2):
        await page.evaluate("window.__step(2)")
    idx = 0
    for _ in range(clip['frames']):
        if limit is not None and idx >= limit:
            break
        await page.evaluate("window.__step(1)")
        await page.screenshot(path=f'{out}/{idx:05d}.png')
        idx += 1
    await ctx.close()
    print(f"{clip['name']} (L{n}): {idx} frames ({idx / FPS:.2f}s)", flush=True)


async def render(limit=None, only=None):
    """Each clip renders into its own folder and is marked done, so an interrupted run resumes clip by clip."""
    os.makedirs(FR, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS, executable_path=EXE)
        for ci, clip in enumerate(P['clips']):
            if only and clip['name'] != only:
                continue
            out = f"{FR}/{ci:02d}-{clip['name']}"
            if os.path.exists(f'{out}/.done') and limit is None:
                print('skip (done)', out, flush=True)
                continue
            shutil.rmtree(out, ignore_errors=True)
            os.makedirs(out)
            await record_clip(b, clip, limit, out)
            if limit is None:
                open(f'{out}/.done', 'w').write('ok')
        await b.close()


def gather():
    """Hard-links every clip's frames into one numbered sequence for ffmpeg."""
    seq = f'{FR}/_seq'
    shutil.rmtree(seq, ignore_errors=True)
    os.makedirs(seq)
    n = 0
    for d in sorted(x for x in os.listdir(FR) if x[:2].isdigit()):
        for f in sorted(x for x in os.listdir(f'{FR}/{d}') if x.endswith('.png')):
            os.link(f'{FR}/{d}/{f}', f'{seq}/{n:05d}.png')
            n += 1
    return seq, n


def encode():
    """No audio, under CrazyGames' 10 MB upload limit: two passes at a target bitrate (~8.8 MB)."""
    seq, n = gather()
    dur = n / FPS
    kbps = int(8.8e6 * 8 / dur / 1000)
    w, h = P['size']
    base = ['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', f'{seq}/%05d.png', '-vf', f'scale={w}:{h}:flags=lanczos,format=yuv420p',
            '-an', '-c:v', 'libx264', '-preset', 'slow', '-b:v', f'{kbps}k', '-profile:v', 'high']
    log = f'{ROOT}/build/video/x264-{PROF}'
    subprocess.run(base + ['-pass', '1', '-passlogfile', log, '-f', 'mp4', os.devnull], check=True)
    subprocess.run(base + ['-pass', '2', '-passlogfile', log, '-movflags', '+faststart', OUT], check=True)
    print('video', OUT, f'{dur:.2f}s', f'{os.path.getsize(OUT) / 1e6:.1f} MB')


if __name__ == '__main__':
    what = sys.argv[1] if len(sys.argv) > 1 else 'all'
    if what == 'test':
        # a few frames per clip for framing checks (into a separate folder)
        FR = f'{ROOT}/build/video/test-{PROF}'
        shutil.rmtree(FR, ignore_errors=True)
        asyncio.run(render(limit=int(sys.argv[2]) if len(sys.argv) > 2 else 1, only=sys.argv[3] if len(sys.argv) > 3 else None))
    elif what == 'render':
        asyncio.run(render())
    elif what == 'encode':
        encode()
    else:
        asyncio.run(render())
        encode()
