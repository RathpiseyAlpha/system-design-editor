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
    params = dict(key=k, code=code or k, modifiers=mods, windowsVirtualKeyCode={"ArrowRight": 39, "ArrowLeft": 37, "ArrowUp": 38, "ArrowDown": 40, "Delete": 46, "Enter": 13, "Escape": 27, "End": 35, "Home": 36}.get(k, ord(k.upper()) if len(k) == 1 else 0))
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

    # 12. Rotate view: R turns the view a quarter; the file does not change; a drag in the turned view lands under the pointer.
    before = json.dumps(saved(p), sort_keys=True)
    p.js("document.activeElement && document.activeElement.blur();")
    key(p, "Escape")
    a0 = center(p, '[data-block="n7"] .top')
    key(p, "r", "KeyR", text="r")
    time.sleep(0.5)
    after = json.dumps(saved(p), sort_keys=True)
    a1 = center(p, '[data-block="n7"] .top')
    check("R turns the view without changing the file", before == after and a0 != a1)
    x, y = center(p, '[data-block="n7"] .top')
    n7 = node(saved(p), "n7")
    dx, dy = iso_px(2, 0)  # two cells along the turned view's x axis
    drag_px(x, y, dx, dy)
    n7b = node(saved(p), "n7")
    moved = (round(n7b["x"] - n7["x"], 3), round(n7b["y"] - n7["y"], 3))
    # One quarter turn shows file (x, y) at view (-y, x): two cells along the view's x axis are (0, -2) in the file.
    check("a drag in the turned view moves the block along the turned axis", moved[0] == 0 and abs(moved[1] + 2) <= 0.5, f"moved {moved}")
    for _ in range(3):
        key(p, "r", "KeyR", text="r")
    time.sleep(0.3)

    # 12b. Flat view: the same file seen from above; a drag lands under the pointer; back to 3D changes nothing in the file.
    before = json.dumps(saved(p), sort_keys=True)
    p.js("document.querySelector('button[aria-label=\"Flat view\"]').click();")
    time.sleep(0.6)
    flat_cards = p.js("return document.querySelectorAll('.blk.flat').length;")
    check("Flat view draws every block from above, without changing the file", flat_cards == len(saved(p)["nodes"]) and json.dumps(saved(p), sort_keys=True) == before, f"{flat_cards} cards")
    n7 = node(saved(p), "n7")
    kk = p.js(r"return Number(/scale\(([0-9.]+)/.exec(document.querySelector('svg.iso > g').getAttribute('transform'))[1]);")
    x, y = center(p, '[data-block="n7"] .left')
    drag_px(x, y, 3 * 44 * kk, -1 * 44 * kk)
    n7b = node(saved(p), "n7")
    moved = (round(n7b["x"] - n7["x"], 3), round(n7b["y"] - n7["y"], 3))
    check("a drag in the flat view moves the block by the cells under the pointer", abs(moved[0] - 3) <= 0.5 and abs(moved[1] + 1) <= 0.5, f"moved {moved}")
    key(p, "z", "KeyZ", mods=2)
    p.js("document.querySelector('button[aria-label=\"3D view\"]').click();")
    time.sleep(0.5)
    check("back in 3D, Undo has put the block back", json.dumps(saved(p), sort_keys=True) == before and p.js("return document.querySelectorAll('.blk.flat').length;") == 0)

    # 13. Export a PNG: the download is a real PNG file.
    import os, tempfile
    dl = tempfile.mkdtemp()
    p.call("Page.setDownloadBehavior", behavior="allow", downloadPath=dl)
    p.js("const s=document.querySelector('select[aria-label=\"Export a picture\"]');const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,'png');s.dispatchEvent(new Event('change',{bubbles:true}));")
    pngs = []
    for _ in range(40):
        time.sleep(0.25)
        pngs = [f for f in os.listdir(dl) if f.endswith(".png")]
        if pngs:
            break
    ok = bool(pngs) and open(os.path.join(dl, pngs[0]), "rb").read(8) == b"\x89PNG\r\n\x1a\n"
    check("Export PNG downloads a PNG picture", ok, pngs[0] if pngs else "no file")
    if ok:
        import shutil
        shutil.copy(os.path.join(dl, pngs[0]), SHOT.replace(".png", "-export.png"))

    # 14. New from a template.
    p.js("const s=document.querySelector('select[aria-label=\"New diagram\"]');const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,'microservices');s.dispatchEvent(new Event('change',{bubbles:true}));")
    d = saved(p)
    check("New loads a template", d["title"] == "Microservices" and len(d["nodes"]) == 10)
    key(p, "z", "KeyZ", mods=2)
    d = saved(p)
    check("and Undo brings the previous diagram back", d["title"] == "Online shop")

    # 15. Split view: the text of the diagram beside the canvas, synced both ways.
    p.js("document.querySelector('button[aria-label=\"Split\"]').click();")
    for _ in range(40):
        time.sleep(0.25)
        if p.js("return !!document.querySelector('.cm-content');"):
            break
    code = lambda: p.js("return document.querySelector('.cm-content').innerText;") or ""
    check("Split view shows the diagram as text", "orders-db: relational-db" in code())

    def type_at_end(text):
        p.js("document.querySelector('.cm-content').focus();")
        key(p, "End", "End", mods=2)  # Ctrl+End: the end of the text
        p.call("Input.insertText", text=text)
        time.sleep(0.6)  # text applies 0.4 s after the last key; autosave follows 0.5 s later (saved() waits for that)

    n_before = len(saved(p)["nodes"])
    type_at_end("\nworker: function\n")
    d = saved(p)
    check("typing a new block in the text adds it to the canvas", any(n["label"] == "worker" for n in d["nodes"]) and p.js("return [...document.querySelectorAll('[data-block]')].length;") == n_before + 1)

    type_at_end("bad: relational-bd\n")
    time.sleep(0.6)
    d = saved(p)
    msg = p.js("return document.querySelector('.code-msg')?.innerText || '';") or ""
    check("a typo shows its error, and the canvas keeps the last good diagram", "relational-db" in msg and not any(n["label"] == "bad" for n in d["nodes"]), msg[:80])
    p.js("[...document.querySelectorAll('.code-msg button')].find(b => b.textContent.startsWith('Use')).click();")
    time.sleep(0.6)
    d = saved(p)
    bad = next((n for n in d["nodes"] if n["label"] == "bad"), None)
    check("the fix button corrects the text and the block appears", bad is not None and bad["role"] == "relational-db")

    p.js("document.querySelector('[data-block=\"n6\"]').focus();")
    key(p, "Delete")
    time.sleep(0.8)
    check("deleting a block on the canvas rewrites the text", "sessions:" not in code())
    p.js("document.querySelector('svg.iso').focus();")
    key(p, "z", "KeyZ", mods=2)
    time.sleep(0.8)
    check("undo on the canvas brings it back into the text", "sessions:" in code())

    p.js("document.querySelector('button[aria-label=\"Code\"]').click();")
    time.sleep(0.4)
    check("Code view shows the text alone", p.js("return !!document.querySelector('.cm-content') && !document.querySelector('svg.iso');"))
    p.js("document.querySelector('button[aria-label=\"Canvas\"]').click();")
    time.sleep(0.6)

    # 16. Auto-layout (ELK in a worker): positions change, memberships do not, and Undo puts everything back.
    before = saved(p)
    p.js("document.querySelector('button[aria-label=\"Auto-layout\"]').click();")
    for _ in range(60):
        time.sleep(0.25)
        if "Laid out" in (p.js("return document.querySelector('.notice')?.innerText || '';") or ""):
            break
    after = saved(p)
    pos = lambda d: {n["id"]: (n["x"], n["y"]) for n in d["nodes"]}
    zones = lambda d: {n["id"]: n.get("zone") for n in d["nodes"]}
    check("Auto-layout moves blocks and keeps every zone membership", pos(after) != pos(before) and zones(after) == zones(before))
    p.js("document.activeElement && document.activeElement.blur();")
    key(p, "z", "KeyZ", mods=2)
    check("Undo puts the layout back in one step", pos(saved(p)) == pos(before))

    # 17. Notes: the summary opens them beside the canvas; Markdown is kept in the file; the preview draws headings and
    # https links, never an unsafe link or HTML; typing is one undo step.
    key(p, "Escape")
    time.sleep(0.2)
    p.js("[...document.querySelectorAll('.insp button')].find(b=>/notes/i.test(b.textContent)).click();")
    time.sleep(1.0)
    check("Write notes opens the notes beside the canvas", p.js("return !!document.querySelector('.notes-input') && !!document.querySelector('.canvas');"))
    note = "# Why\nTwo **app** servers.\n- [docs](https://example.org)\n- [bad](javascript:alert(1))\n<img src=x onerror=alert(1)>"
    p.js("document.querySelector('.notes-input').focus();")
    p.call("Input.insertText", text=note)
    d = saved(p)
    check("the notes are kept in the file", d.get("notes") == note)
    p.js("[...document.querySelectorAll('.notes-panel button')].find(b=>b.textContent.trim()==='Preview').click();")
    time.sleep(0.3)
    v = p.js("""const v=document.querySelector('.notes-view');
      return {h: v.querySelector('h3')?.textContent, b: v.querySelector('strong')?.textContent, links: [...v.querySelectorAll('a')].map(a=>a.getAttribute('href')),
              img: !!v.querySelector('img'), text: v.textContent.includes('<img')};""")
    check("the preview draws the Markdown and only the https link", v["h"] == "Why" and v["b"] == "app" and v["links"] == ["https://example.org"] and not v["img"] and v["text"], json.dumps(v))
    p.js("document.activeElement && document.activeElement.blur();")
    key(p, "z", "KeyZ", mods=2)
    check("Undo removes the typed notes in one step", "notes" not in saved(p))
    p.js("[...document.querySelectorAll('.side-tabs button')].find(b=>b.textContent.trim()==='Text').click();")
    for _ in range(20):
        time.sleep(0.25)
        if p.js("return !!document.querySelector('.cm-content');"):
            break
    check("the Text tab brings back the diagram text", p.js("return !!document.querySelector('.cm-content');"))
    p.js("document.querySelector('button[aria-label=\"Canvas\"]').click();")
    time.sleep(0.5)

    # 18. Present: P shows only the canvas; arrows step to each zone; nothing can be dragged; Esc brings the editor back.
    before = json.dumps(saved(p), sort_keys=True)
    p.js("document.activeElement && document.activeElement.blur();")
    key(p, "p", "KeyP", text="p")
    time.sleep(1.0)
    pr = p.js("return {on: !!document.querySelector('.app--present'), chrome: !!document.querySelector('.topbar, .palette, .insp, .statusbar'), where: document.querySelector('.present-where b')?.textContent};")
    check("P presents only the canvas, starting with the whole diagram", pr["on"] and not pr["chrome"] and pr["where"] == saved(p)["title"], json.dumps(pr))
    t0 = p.js("return document.querySelector('svg.iso > g').getAttribute('transform');")
    key(p, "ArrowRight", "ArrowRight")
    time.sleep(0.9)
    where = p.js("return document.querySelector('.present-where b').textContent;")
    t1 = p.js("return document.querySelector('svg.iso > g').getAttribute('transform');")
    zones = {z["label"] for z in saved(p)["zones"]}
    check("the right arrow moves the view to a zone", where in zones and t1 != t0, where)
    x, y = center(p, '[data-block] .top')
    drag_px(x, y, 120, 60)
    check("nothing can be dragged while presenting", json.dumps(saved(p), sort_keys=True) == before)
    key(p, "Escape")
    time.sleep(0.6)
    check("Esc leaves Present and the editor is back, the file unchanged", p.js("return !!document.querySelector('.topbar') && !document.querySelector('.app--present');") and json.dumps(saved(p), sort_keys=True) == before)

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
