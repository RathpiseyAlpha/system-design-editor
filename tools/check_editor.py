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
