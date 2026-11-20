"""Check the editor's layout at the screen sizes of SPEC section 9, in light and dark, and make one contact sheet to look at.

Start a preview (or the dev server) first, then:  python -I tools/check_layout.py [url] [contact-sheet.png]

At each size and theme: the page never scrolls sideways, the top bar's controls all fit, the diagram fits the canvas after
loading, the "Show as" control is visible (buttons or select), and no text is smaller than 12 px.
"""
import base64
import json
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
            # The flat view (seen from above): every card inside the canvas, and no card on top of another.
            p.js("document.querySelector('button[aria-label=\"Flat view\"]').click();")
            time.sleep(0.6)
            fl = p.js("""
              const canvas=document.querySelector('.canvas').getBoundingClientRect();
              const cards=[...document.querySelectorAll('.blk.flat')].map(b=>(b.querySelector('rect.left, circle.left')||b).getBoundingClientRect());
              const inside=cards.every(r=>r.left>=canvas.left-1&&r.right<=canvas.right+1&&r.top>=canvas.top-1&&r.bottom<=canvas.bottom+1);
              let overlap=0; for(let i=0;i<cards.length;i++) for(let j=i+1;j<cards.length;j++){const a=cards[i],b=cards[j]; if(a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1) overlap++;}
              return {n: cards.length, inside, overlap};
            """)
            check(f"{tag} flat: cards drawn from above, all inside the canvas", fl["n"] > 0 and fl["inside"], f"{fl['n']} cards")
            check(f"{tag} flat: no card covers another", fl["overlap"] == 0, f"{fl['overlap']} overlaps")
            data = p.call("Page.captureScreenshot", format="png")["data"]
            shots.append((tag + " flat", base64.b64decode(data)))
            p.js("document.querySelector('button[aria-label=\"3D view\"]').click();")
            time.sleep(0.4)
            # Present: only the canvas; the bar sits inside the window; the whole diagram is above the bar.
            p.js("document.querySelector('button[aria-label=Present]').click();")
            time.sleep(1.0)
            pr = p.js("""
              const de=document.documentElement, bar=document.querySelector('.present-bar').getBoundingClientRect();
              const blocks=[...document.querySelectorAll('[data-block]')].map(b=>b.getBoundingClientRect());
              return {sideways: de.scrollWidth>de.clientWidth, bar: bar.left>=0&&bar.right<=innerWidth&&bar.bottom<=innerHeight,
                      clear: blocks.every(r=>r.bottom<=bar.top+1||r.right<=bar.left||r.left>=bar.right), chrome: !!document.querySelector('.topbar')};
            """)
            check(f"{tag} present: only the canvas, the bar fits, no block under the bar", not pr["sideways"] and pr["bar"] and pr["clear"] and not pr["chrome"], json.dumps(pr))
            data = p.call("Page.captureScreenshot", format="png")["data"]
            shots.append((tag + " present", base64.b64decode(data)))
            p.js("[...document.querySelectorAll('.present-bar button')].find(b=>b.textContent.trim()==='Exit').click();")
            time.sleep(0.5)
            # The same in Split view: text beside the canvas.
            p.js("document.querySelector('button[aria-label=Split]').click();")
            for _ in range(40):
                time.sleep(0.25)
                if p.js("return !!document.querySelector('.cm-content');"):
                    break
            s = p.js("""
              const de=document.documentElement, top=document.querySelector('.topbar'), code=document.querySelector('.code-panel'), canvas=document.querySelector('.canvas');
              return {sideways: de.scrollWidth>de.clientWidth, topFits: top.scrollWidth<=top.clientWidth+1,
                      both: !!code && code.getBoundingClientRect().width>250 && !!canvas && canvas.getBoundingClientRect().width>400};
            """)
            check(f"{tag} split: no sideways scroll", not s["sideways"])
            check(f"{tag} split: the top bar fits", s["topFits"])
            check(f"{tag} split: text and canvas both have room", s["both"])
            data = p.call("Page.captureScreenshot", format="png")["data"]
            shots.append((tag + " split", base64.b64decode(data)))
            # Notes beside the canvas, previewed.
            p.js("[...document.querySelectorAll('.side-tabs button')].find(b=>b.textContent.trim()==='Notes').click();")
            time.sleep(0.6)
            p.js("""const t=document.querySelector('.notes-input'); const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
                    set.call(t,'# Why this design\\nTwo **app** servers behind one balancer, so one can fail.\\n\\n- Orders in `orders-db`\\n- Sessions in a cache\\n\\n> Ask: what breaks if the balancer fails?');
                    t.dispatchEvent(new Event('input',{bubbles:true}));""")
            time.sleep(0.3)
            p.js("[...document.querySelectorAll('.notes-panel button')].find(b=>b.textContent.trim()==='Preview').click();")
            time.sleep(0.4)
            nt = p.js("""
              const de=document.documentElement, top=document.querySelector('.topbar'), v=document.querySelector('.notes-view'), head=document.querySelector('.notes-panel .code-head');
              return {sideways: de.scrollWidth>de.clientWidth, topFits: top.scrollWidth<=top.clientWidth+1, head: head.scrollWidth<=head.clientWidth+1,
                      shown: !!v && !!v.querySelector('h3') && v.getBoundingClientRect().width>250};
            """)
            check(f"{tag} notes: no sideways scroll, the top bar and the panel head fit", not nt["sideways"] and nt["topFits"] and nt["head"])
            check(f"{tag} notes: the preview shows the Markdown", nt["shown"])
            data = p.call("Page.captureScreenshot", format="png")["data"]
            shots.append((tag + " notes", base64.b64decode(data)))
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
