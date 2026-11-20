"""Check the editor's layout at the screen sizes of SPEC section 9, in light and dark, and make one contact sheet to look at.

Start a preview (or the dev server) first, then:  python -I tools/check_layout.py [url] [contact-sheet.png]

At each size and theme: the page never scrolls sideways, the top bar's controls all fit, the diagram fits the canvas after
loading, the "Show as" control is visible (buttons or select), and no text is smaller than 12 px.
"""
import base64
import io
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cdp import Page  # noqa: E402

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4319/"
SHEET = sys.argv[2] if len(sys.argv) > 2 else "layout-sheet.png"
SIZES = [(1280, 720), (1366, 768), (1536, 864), (1920, 1080)]
THEMES = ["light", "dark"]

results, shots = [], []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))


for w, h in SIZES:
    for theme in THEMES:
        p = Page(URL, w, h)
        try:
            p.js(f"localStorage.clear(); localStorage.setItem('archboard:theme','{theme}');")
            p.goto(URL, wait=2.5)
            tag = f"{w}x{h} {theme}"
            m = p.js("""
              const de=document.documentElement, top=document.querySelector('.topbar'), canvas=document.querySelector('.canvas').getBoundingClientRect();
              const blocks=[...document.querySelectorAll('[data-block]')].map(b=>b.getBoundingClientRect());
              const inside=blocks.every(r=>r.left>=canvas.left-1&&r.right<=canvas.right+1&&r.top>=canvas.top-1&&r.bottom<=canvas.bottom+1);
              const vis=el=>!!el&&getComputedStyle(el).display!=='none'&&el.getBoundingClientRect().width>0;
              const small=[...document.querySelectorAll('.app *')].filter(e=>e.childElementCount===0&&e.textContent.trim()&&e.getClientRects().length&&!e.closest('svg.iso')&&parseFloat(getComputedStyle(e).fontSize)<12).map(e=>e.textContent.trim().slice(0,20));
              return {sideways: de.scrollWidth>de.clientWidth, topFits: top.scrollWidth<=top.clientWidth+1, inside,
                      showAs: vis(document.querySelector('.pack-seg'))||vis(document.querySelector('.pack-select')), small};
            """)
            check(f"{tag}: no sideways scroll", not m["sideways"])
            check(f"{tag}: the top bar fits", m["topFits"])
            check(f"{tag}: the diagram fits the canvas", m["inside"])
            check(f"{tag}: Show as is visible", m["showAs"])
            check(f"{tag}: no text under 12 px", not m["small"], ", ".join(m["small"][:4]))
            data = p.call("Page.captureScreenshot", format="png")["data"]
            shots.append((tag, base64.b64decode(data)))
        finally:
            p.close()
            time.sleep(0.3)

try:
    from PIL import Image, ImageDraw
    thumbs = []
    for tag, raw in shots:
        im = Image.open(io.BytesIO(raw)).convert("RGB")
        im.thumbnail((640, 360))
        canvas = Image.new("RGB", (640, 380), "white")
        canvas.paste(im, (0, 20))
        ImageDraw.Draw(canvas).text((6, 4), tag, fill="black")
        thumbs.append(canvas)
    sheet = Image.new("RGB", (640 * 2, 380 * ((len(thumbs) + 1) // 2)), "white")
    for i, t in enumerate(thumbs):
        sheet.paste(t, ((i % 2) * 640, (i // 2) * 380))
    sheet.save(SHEET)
    print("contact sheet:", SHEET)
except ImportError:
    print("Pillow is not installed: no contact sheet")

print(f"\n{sum(results)} of {len(results)} checks passed")
sys.exit(0 if all(results) else 1)
