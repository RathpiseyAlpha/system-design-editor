"""Drive the built editor in headless Chrome with real mouse and keyboard events and check what changes in the saved file.

Start the preview first (from apps/editor):  node ../../node_modules/vite/bin/vite.js preview --port 4319 --strictPort
Then:  python -I tools/check_editor.py [url] [screenshot.png] [width] [height]

Checks, at 1280 x 720 by default: drag a block (it moves, snaps to half cells, joins the zone it lands in), move a focused
block with an arrow key, undo, open the palette with A, search "postgres" and add with Enter, delete with Del.
Reads the result from the autosave in localStorage, which is the file as the editor would save it.
"""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cdp import Page  # noqa: E402

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4319/"
SHOT = sys.argv[2] if len(sys.argv) > 2 else "editor-check.png"
W = int(sys.argv[3]) if len(sys.argv) > 3 else 1280
H = int(sys.argv[4]) if len(sys.argv) > 4 else 720

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))


def saved(p):
    time.sleep(0.8)  # autosave runs half a second after the last change
    return json.loads(p.js("return localStorage.getItem('archboard:autosave');") or "null")


def node(d, nid):
    return next((n for n in d["nodes"] if n["id"] == nid), None)


def center(p, sel):
    r = p.js(f"const r=document.querySelector({json.dumps(sel)}).getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2];")
    return r[0], r[1]


def key(p, k, code=None, mods=0, text=None):
    params = dict(key=k, code=code or k, modifiers=mods, windowsVirtualKeyCode={"ArrowRight": 39, "ArrowLeft": 37, "ArrowUp": 38, "ArrowDown": 40, "Delete": 46, "Enter": 13, "Escape": 27}.get(k, ord(k.upper()) if len(k) == 1 else 0))
    p.call("Input.dispatchKeyEvent", type="keyDown", **params, **({"text": text} if text else {}))
    p.call("Input.dispatchKeyEvent", type="keyUp", **params)


p = Page(URL, W, H)
try:
    p.js("localStorage.clear(); localStorage.setItem('archboard:theme','light');")
    p.goto(URL, wait=2.5)
    check("editor loads with the 3-tier template", p.js("return document.querySelectorAll('[data-block]').length;") == 7)

    # 1. Drag app-1 (n3) from cell (10.2, 3) to cell (5.5, 3): out of the private subnet into the public one.
    k = p.js(r"return Number(/scale\(([0-9.]+)/.exec(document.querySelector('svg.iso > g').getAttribute('transform'))[1]);")
    iso = lambda gx, gy: ((gx - gy) * 34.64 * k, (gx + gy) * 20 * k)
    (ax, ay), (bx, by) = iso(10.2, 3), iso(5.5, 3)
    x, y = center(p, '[data-block="n3"] .top')
    p.call("Input.dispatchMouseEvent", type="mousePressed", x=x, y=y, button="left", clickCount=1)
    for i in range(1, 11):
        p.call("Input.dispatchMouseEvent", type="mouseMoved", x=x + (bx - ax) * i / 10, y=y + (by - ay) * i / 10, button="left", buttons=1)
    p.call("Input.dispatchMouseEvent", type="mouseReleased", x=x + bx - ax, y=y + by - ay, button="left", clickCount=1)
    d = saved(p)
    n3 = node(d, "n3") if d else None
    check("drag moves the block to the cell under the pointer", n3 and abs(n3["x"] - 5.5) <= 0.5 and abs(n3["y"] - 3) <= 0.5, f"now {n3 and (n3['x'], n3['y'])}")
    check("drag snaps to half cells", n3 and (n3["x"] * 2) % 1 == 0 and (n3["y"] * 2) % 1 == 0)
    check("the block joins the zone it lands in", n3 and n3.get("zone") == "z2", f"zone {n3 and n3.get('zone')}")
    check("the dragged block is selected", p.js("return document.querySelector('[data-block=\"n3\"]').getAttribute('aria-pressed');") == "true")

    # 2. Arrow key on a focused block, then undo.
    p.js("document.querySelector('[data-block=\"n5\"]').focus();")
    key(p, "ArrowRight")
    d = saved(p)
    check("an arrow key moves the focused block one cell", node(d, "n5")["x"] == 15, f"x={node(d, 'n5')['x']}")
    key(p, "z", "KeyZ", mods=2)
    d = saved(p)
    check("Ctrl+Z undoes it", node(d, "n5")["x"] == 14)

    # 3. Add from the palette with the keyboard: A opens it (a rail at this size), type, Enter.
    p.js("document.activeElement && document.activeElement.blur();")
    key(p, "a", "KeyA", text="a")
    time.sleep(0.2)
    check("A opens the palette search", p.js("return document.activeElement && document.activeElement.id;") == "palette-search")
    p.call("Input.insertText", text="postgres")
    key(p, "Enter")
    d = saved(p)
    added = [n for n in d["nodes"] if n["role"] == "relational-db" and n["id"] != "n5"]
    check("search finds Relational database by a product name and Enter adds it", len(added) == 1, f"{len(d['nodes'])} blocks")

    # 4. The new block is selected: Delete removes it.
    p.js("document.activeElement && document.activeElement.blur();")
    key(p, "Delete")
    d = saved(p)
    check("Delete removes the selected block", len(d["nodes"]) == 7)

    # 5. Draw a connection from a port: select sessions (n6), drag its port onto media (n7).
    def press(x, y):
        p.call("Input.dispatchMouseEvent", type="mousePressed", x=x, y=y, button="left", clickCount=1)
    def release(x, y):
        p.call("Input.dispatchMouseEvent", type="mouseReleased", x=x, y=y, button="left", clickCount=1)
    def click_at(x, y):
        press(x, y); release(x, y); time.sleep(0.15)
    def drag_px(x, y, dx, dy, steps=10):
        press(x, y)
        for i in range(1, steps + 1):
            p.call("Input.dispatchMouseEvent", type="mouseMoved", x=x + dx * i / steps, y=y + dy * i / steps, button="left", buttons=1)
        release(x + dx, y + dy); time.sleep(0.2)
    def iso_px(gx, gy):
        kk = p.js(r"return Number(/scale\(([0-9.]+)/.exec(document.querySelector('svg.iso > g').getAttribute('transform'))[1]);")
        return ((gx - gy) * 34.64 * kk, (gx + gy) * 20 * kk)
    click_at(*center(p, '[data-block="n6"] .top'))
    px, py = center(p, '[data-port="n6"]')
    tx, ty = center(p, '[data-block="n7"] .top')
    drag_px(px, py, tx - px, ty - py, steps=12)
    d = saved(p)
    new_edge = next((e for e in d["edges"] if e["from"] == "n6" and e["to"] == "n7"), None)
    check("dragging from a port onto a block connects them", new_edge is not None)

    # 6. The new connection is selected: change its kind in the inspector.
    p.js("[...document.querySelectorAll('.side--r .seg button')].find(b => b.textContent === 'Async').click();")
    d = saved(p)
    check("the inspector changes a connection's kind", next(e for e in d["edges"] if e["id"] == new_edge["id"])["kind"] == "async")

    # 7. Select a connection by clicking its line, then delete it with the Delete key.
    # Blocks are drawn over connections: click a point of the line that is not behind a block.
    pt = p.js(
        "const g=document.querySelector('[data-edge=\"" + new_edge["id"] + "\"]'),l=g.querySelector('.wire'),L=l.getTotalLength(),m=l.getScreenCTM();"
        "for(let i=1;i<40;i++){const q=l.getPointAtLength(L*i/40),x=q.x*m.a+q.y*m.c+m.e,y=q.x*m.b+q.y*m.d+m.f;"
        "if(g.contains(document.elementFromPoint(x,y)))return [x,y];}return null;"
    )
    p.js("document.activeElement && document.activeElement.blur();")
    key(p, "Escape")
    click_at(pt[0], pt[1])
    check("clicking a connection selects it", p.js("return !!document.querySelector('.edge.selected');"))
    key(p, "Delete")
    d = saved(p)
    check("Delete removes the selected connection", not any(e["id"] == new_edge["id"] for e in d["edges"]))

    # 8. Connect with the keyboard: Customers (n1) -> "Connect to..." -> focus sessions (n6) -> Enter.
    click_at(*center(p, '[data-block="n1"] .top'))
    p.js("[...document.querySelectorAll('.side--r button')].find(b => b.textContent.startsWith('Connect to')).click();")
    check("Connect to shows what to do next", "Pick the block" in (p.js("return document.querySelector('.hintbar')?.textContent || '';") or ""))
    p.js("document.querySelector('[data-block=\"n6\"]').focus();")
    key(p, "Enter")
    d = saved(p)
    check("Enter on the other block connects them", any(e["from"] == "n1" and e["to"] == "n6" for e in d["edges"]))

    # 9. Add a public subnet from the palette (A opens it on a narrow screen).
    p.js("document.activeElement && document.activeElement.blur();")
    key(p, "Escape")
    key(p, "a", "KeyA", text="a")
    time.sleep(0.2)
    p.js("document.querySelector('button[aria-label=\"Add a public subnet\"]').click();")
    d = saved(p)
    subnet = next((z for z in d["zones"] if z.get("access") == "public" and z["id"] not in ("z2",)), None)
    check("the palette adds a public subnet", subnet is not None)

    # 10. Move the network (z1) two cells along x by its name tab: everything inside moves with it.
    before_db = node(saved(p), "n5")["x"]
    x, y = center(p, '[data-zone-tab="z1"]')
    dx, dy = iso_px(2, 0)
    drag_px(x, y, dx, dy)
    d = saved(p)
    z1 = next(z for z in d["zones"] if z["id"] == "z1")
    check("dragging a zone's tab moves the zone", z1["x"] == 5, f"x={z1['x']}")
    check("and the blocks inside move with it", node(d, "n5")["x"] == before_db + 2)

    # 11. Resize private-a (z3) by its corner handle: two cells narrower.
    x, y = center(p, '[data-zone-tab="z3"]')
    click_at(x, y)
    hx, hy = center(p, '[data-handle="z3"]')
    w0 = next(z for z in saved(p)["zones"] if z["id"] == "z3")["w"]
    dx, dy = iso_px(-2, 0)
    drag_px(hx, hy, dx, dy)
    d = saved(p)
    z3 = next(z for z in d["zones"] if z["id"] == "z3")
    check("the corner handle resizes a zone, its far corner on the grid", abs(z3["w"] - (w0 - 2)) <= 0.5 and ((z3["x"] + z3["w"]) * 2) % 1 == 0, f"w {w0} -> {z3['w']}")

    # Leave a block selected for the screenshot.
    x, y = center(p, '[data-block="n5"] .top')
    p.call("Input.dispatchMouseEvent", type="mousePressed", x=x, y=y, button="left", clickCount=1)
    p.call("Input.dispatchMouseEvent", type="mouseReleased", x=x, y=y, button="left", clickCount=1)
    time.sleep(0.4)
    p.shot(SHOT)
    print("screenshot:", SHOT)
finally:
    p.close()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)} of {len(results)} checks passed")
sys.exit(1 if failed else 0)
