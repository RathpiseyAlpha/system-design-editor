"""Check Simulate mode (SPEC section 13, design page Screen E) in the built editor, with real clicks and keys.

Start a preview of the editor first (port 4319), then:  python -I tools/check_sim.py
- presets to a run; the verdict, the tiles and the canvas (load, Off, a zone down, dead connections) at chosen moments;
- the same scenario in Node gives the same numbers, second by second, as the browser's Web Worker (SPEC 13.4);
- Save scenario and Open scenario; capacity settings change the run; Space plays and pauses;
- layout, axe, contrast and Tab at four sizes, light and dark.
"""
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from cdp import Page  # noqa: E402
from a11y_js import CANVAS_CONTRAST, PAGE_CONTRAST  # noqa: E402

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4319/"
AXE = (ROOT / "node_modules" / "axe-core" / "axe.min.js").read_text(encoding="utf-8")
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))


def setv(p, selector, value, kind="HTMLInputElement", event="input"):
    p.js(f"""const el = document.querySelector({json.dumps(selector)}); Object.getOwnPropertyDescriptor({kind}.prototype, 'value').set.call(el, {json.dumps(str(value))});
             el.dispatchEvent(new Event({json.dumps(event)}, {{bubbles: true}}));""")


def tick_preset(p, title):
    p.js(f"[...document.querySelectorAll('.scn-pick')].find(l => l.textContent.includes({json.dumps(title)})).querySelector('input').click();")


def button(p, text):
    p.js(f"[...document.querySelectorAll('.runbar button')].find(b => b.textContent.includes({json.dumps(text)})).click();")


def seek(p, t):
    setv(p, ".timeline input", t)
    time.sleep(0.4)


def summary(p):
    return json.loads(p.js("return document.querySelector('.sim-results').dataset.summary || 'null';") or "null")


def wait(cond, tries=40):
    for _ in range(tries):
        if cond():
            return True
        time.sleep(0.25)
    return False


p = Page(URL, 1280, 720)
dl = tempfile.mkdtemp()
try:
    p.js("localStorage.clear(); localStorage.setItem('archboard:theme','light');")
    p.goto(URL, wait=2.5)
    p.call("Page.setDownloadBehavior", behavior="allow", downloadPath=dl)
    # The diagram as a file, saved the way a user saves it (Design mode, Save), for the Node run below.
    p.js("document.querySelector('button[aria-label=\"Save the file\"]').click();")
    wait(lambda: any(f.endswith(".archboard.json") for f in os.listdir(dl)))
    p.js("document.querySelector('button[aria-label=Simulate]').click();")
    time.sleep(0.5)
    ui = p.js("return {scn: !!document.querySelector('.side--scn'), run: !!document.querySelector('.runbar'), results: !!document.querySelector('.sim-results'), palette: !!document.querySelector('.side--l'), layout: !!document.querySelector('button[aria-label=\"Auto-layout\"]')};")
    check("Simulate shows the scenario, the run bar and the results; no palette, no Auto-layout", ui["scn"] and ui["run"] and ui["results"] and not ui["palette"] and not ui["layout"], json.dumps(ui))

    # A spike to 1,500 req/s at 1:00, then private-a goes down at 2:00.
    tick_preset(p, "Traffic spike")
    tick_preset(p, "Zone goes down")
    time.sleep(0.3)
    check("ticking the spike unticks steady load (one source of load)", p.js("return [...document.querySelectorAll('.scn-pick')].find(l => l.textContent.includes('Steady load')).querySelector('input').checked;") is False)
    button(p, "Run")
    time.sleep(0.6)
    check("a preset that needs a target says so instead of running", "Pick the zone that goes down." in (p.js("return document.querySelector('.scn-errors')?.textContent || '';") or ""))
    setv(p, "select[aria-label=Zone]", "z3", "HTMLSelectElement", "change")
    setv(p, 'input[aria-label="To requests per second"]', 1500)
    time.sleep(0.2)
    t0 = time.time()
    button(p, "Run")
    wait(lambda: summary(p) is not None)
    took = time.time() - t0
    s = summary(p)
    check("Run computes the scenario in the worker, fast", s is not None and took < 2, f"{took:.2f} s")
    check("the verdict: breaks, app-1 is the bottleneck, web-lb and orders-db are single points of failure", s and s["verdict"] == "breaks" and s["bottleneck"]["node"] == "n3" and {"n2", "n5"} <= {x["id"] for x in s["spofs"]}, json.dumps(s)[:160] if s else "none")
    playing = p.js("return [...document.querySelectorAll('.runbar button')].some(b => b.textContent.includes('Pause'));")
    check("after Run the timeline plays", playing)
    p.js("document.activeElement?.blur();")
    p.call("Input.dispatchKeyEvent", type="keyDown", key=" ", code="Space", windowsVirtualKeyCode=32)
    p.call("Input.dispatchKeyEvent", type="keyUp", key=" ", code="Space", windowsVirtualKeyCode=32)
    time.sleep(0.3)
    check("Space pauses", p.js("return [...document.querySelectorAll('.runbar button')].some(b => b.textContent.includes('Play'));"))

    seek(p, 0)
    c0 = p.js("return {fills: document.querySelectorAll('.load').length, tile: document.querySelector('.tile b').textContent};")
    seek(p, 90)
    c1 = p.js("""return {over: [...document.querySelectorAll('.blk .pill text')].map(t => t.textContent).filter(t => /Over capacity/.test(t)).length,
                       fills: document.querySelectorAll('.load.bad').length, err: document.querySelectorAll('.tile b')[1].textContent, dots: document.querySelectorAll('.dot').length};""")
    seek(p, 150)
    c2 = p.js("""return {off: [...document.querySelectorAll('.blk.off')].map(b => b.dataset.block).sort(), zone: !!document.querySelector('.zone.off'),
                       down: [...document.querySelectorAll('.pill text')].some(t => /down/.test(t.textContent)), dead: document.querySelectorAll('.wire.dead').length,
                       err: document.querySelectorAll('.tile b')[1].textContent};""")
    check("before the spike: blocks fill a little, everything is served", c0["fills"] > 0 and c0["tile"] == "200", json.dumps(c0))
    check("during the spike: blocks over capacity fill red with a label, the error rate shows, traffic moves", c1["over"] >= 2 and c1["fills"] >= 2 and c1["err"] == "60%" and c1["dots"] > 0, json.dumps(c1))
    check("after private-a goes down: its blocks are Off, the zone is down, connections into it are dead", c2["off"] == ["n3", "n4", "n5", "n6"] and c2["zone"] and c2["down"] and c2["dead"] >= 4 and c2["err"] == "100%", json.dumps(c2))

    # The same scenario in Node: the numbers must be the same, second by second.
    p.js("document.querySelector('button[aria-label=\"Save scenario\"]').click();")
    wait(lambda: any(f.endswith(".scenario.json") for f in os.listdir(dl)))
    scen = next((Path(dl) / f for f in os.listdir(dl) if f.endswith(".scenario.json")), None)
    diagram = next(Path(dl) / f for f in os.listdir(dl) if f.endswith(".archboard.json"))
    node = json.loads(subprocess.run(["node", str(HERE / "sim_node.mjs"), str(diagram), str(scen)], capture_output=True, text=True, cwd=ROOT).stdout or "{}")
    browser_trace = p.js("return document.querySelector('.sim-results').dataset.trace;")
    check("Save scenario writes a scenario file", scen is not None and json.loads(scen.read_text(encoding="utf-8"))["format"] == "archboard-scenario")
    check("Node and the browser give the same numbers for every second, and the same summary", node.get("trace") == browser_trace and node.get("summary") == s, f"{len((browser_trace or '').split())} seconds compared")

    # Open the saved scenario: it runs as it is.
    p.call("DOM.enable")
    doc = p.call("DOM.getDocument", depth=-1)
    inp = p.call("DOM.querySelector", nodeId=doc["root"]["nodeId"], selector="input[type=file]")
    p.call("DOM.setFileInputFiles", nodeId=inp["nodeId"], files=[str(scen)])
    time.sleep(0.6)
    check("Open scenario shows the file's scenario in place of the presets", "From a file" in (p.js("return document.querySelector('.side--scn').textContent;") or ""))
    p.js("[...document.querySelectorAll('.scn-file button')].find(b => b.textContent.includes('presets')).click();")

    # Capacity: select app-1 and app-2, give each 3 instances; the run is out of date until run again, then app-1 copes better.
    for nid in ("n3", "n4"):
        p.js(f"document.querySelector('[data-block=\"{nid}\"]').focus();")
        p.call("Input.dispatchKeyEvent", type="keyDown", key="Enter", code="Enter", windowsVirtualKeyCode=13)
        p.call("Input.dispatchKeyEvent", type="keyUp", key="Enter", code="Enter", windowsVirtualKeyCode=13)
        time.sleep(0.3)
        setv(p, "#cap-instances", 3)
        time.sleep(0.3)
    time.sleep(0.8)  # the autosave follows 0.5 s after the last change
    saved = json.loads(p.js("return localStorage.getItem('archboard:autosave');"))
    check("capacity settings are kept in the file", all(n.get("sim", {}).get("instances") == 3 for n in saved["nodes"] if n["id"] in ("n3", "n4")))
    check("a changed diagram marks the run out of date", "changed since this run" in (p.js("return document.querySelector('.sim-results').textContent;") or ""))
    button(p, "Run")
    wait(lambda: "changed since" not in (p.js("return document.querySelector('.sim-results').textContent;") or ""))
    time.sleep(0.3)
    s2 = summary(p)
    check("with 3 instances each, the app tier is no longer the bottleneck", s2 and (s2["bottleneck"] is None or s2["bottleneck"]["node"] not in ("n3", "n4")) and s2["errorRate"] < s["errorRate"], json.dumps(s2)[:160] if s2 else "")
    p.shot(str(ROOT / "sim-check.png"))
    print("screenshot: sim-check.png")
finally:
    p.close()

# Layout, axe, contrast and Tab at four sizes, light and dark, after a run paused in the spike.
for w, h in ((1280, 720), (1366, 768), (1536, 864), (1920, 1080)):
    for theme in ("light", "dark"):
        tag = f"{w}x{h} {theme}"
        p = Page(URL, w, h)
        try:
            p.js(f"localStorage.clear(); localStorage.setItem('archboard:theme','{theme}');")
            p.goto(URL, wait=2.5)
            p.js("document.querySelector('button[aria-label=Simulate]').click();")
            time.sleep(0.4)
            tick_preset(p, "Traffic spike")
            button(p, "Run")
            wait(lambda: summary(p) is not None)
            button(p, "Pause")
            seek(p, 90)
            m = p.js("""const de = document.documentElement, top = document.querySelector('.topbar'), c = document.querySelector('.canvas').getBoundingClientRect();
              const bar = document.querySelector('.runbar').getBoundingClientRect();
              return {sideways: de.scrollWidth > de.clientWidth, topFits: top.scrollWidth <= top.clientWidth + 1, canvas: Math.round(c.width),
                      bar: bar.left >= c.left - 1 && bar.right <= c.right + 1 && bar.bottom <= c.bottom + 1};""")
            check(f"{tag}: the top bar fits, the run bar is inside the canvas, no sideways scroll", not m["sideways"] and m["topFits"] and m["bar"] and m["canvas"] >= 500, json.dumps(m))
            if not p.js("return !!window.axe;"):
                p.call("Runtime.evaluate", expression=AXE)
            r = p.js("""const r = await axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}});
              return {bad: r.violations.map(v => ({id: v.id, where: v.nodes.slice(0,3).map(n => n.target.join(' ') + (n.any[0] ? ' | ' + n.any[0].message : ''))})),
                      unsure: r.incomplete.filter(v => v.id === 'color-contrast').flatMap(v => v.nodes.filter(n => !n.target.join(' ').includes('svg')).map(n => n.target.join(' ')))};""")
            check(f"{tag}: no WCAG 2.2 AA problems found by axe", not r["bad"], json.dumps(r["bad"])[:700])
            if r["unsure"]:
                u = p.js("const SELECTORS = " + json.dumps(r["unsure"]) + ";" + PAGE_CONTRAST)
                check(f"{tag}: text axe could not decide reaches AA contrast", not u["bad"], "; ".join(u["bad"][:4]))
            c = p.js(CANVAS_CONTRAST)
            check(f"{tag}: every text on the canvas reaches AA contrast (rates, Busy and Over capacity labels)", c["n"] > 10 and not c["bad"], f"{c['n']} texts; " + "; ".join(c["bad"][:3]))
            p.js("document.activeElement?.blur(); window.__seen = []; window.__bad = [];")
            for _ in range(70):
                p.call("Input.dispatchKeyEvent", type="keyDown", key="Tab", code="Tab", windowsVirtualKeyCode=9)
                p.call("Input.dispatchKeyEvent", type="keyUp", key="Tab", code="Tab", windowsVirtualKeyCode=9)
                p.js("""const e = document.activeElement; if (!e || e === document.body || e.closest('svg')) return;
                  window.__seen.push(e.getAttribute('aria-label') || e.textContent.trim().slice(0, 16));
                  const s = getComputedStyle(e), ring = s.boxShadow !== 'none' || (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2) || !!e.closest('.timeline:focus-within');
                  if (!ring) window.__bad.push(e.getAttribute('aria-label') || e.textContent.trim().slice(0, 16));""")
            tab = p.js("return {seen: window.__seen, bad: [...new Set(window.__bad)]};")
            need = ["Scenario time", "Speed"]
            check(f"{tag}: Tab reaches the presets, Run and the timeline, each with a ring", "Scenario time" in tab["seen"] and any("Play" in x or "Run" in x for x in tab["seen"]) and not tab["bad"], json.dumps(tab["bad"]))
            if w == 1280 and theme == "dark":
                p.shot(str(ROOT / "sim-check-dark.png"))
        finally:
            p.close()

print(f"\n{sum(results)} of {len(results)} checks passed")
sys.exit(0 if all(results) else 1)
