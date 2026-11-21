"""Check the quality bar of SPEC section 9 on the production build: speed, accessibility, keyboard, motion, offline.

Start a preview of the editor first (port 4319), then:  python -I tools/check_quality.py [editor-url]

- First paint under 1.5 s on a classroom laptop: Chrome with its CPU slowed 4x and a 20 Mbit/s, 20 ms network, cache empty.
- 150 blocks pan and zoom smoothly at 1280 x 720: real mouse drags and wheel turns, CPU slowed 2x; frames are timed in the
  page. Smooth means the median frame is at most 20 ms and 95 % of frames at most 34 ms (30 frames a second).
- WCAG 2.2 AA in both themes and every screen (axe-core 4.10.3), every control reachable with Tab, focus visible on each.
- prefers-reduced-motion: no transitions and no glide in Present.
- No third-party requests, and the editor keeps working offline once loaded (text view, notes and auto-layout included).
"""
import json
import statistics
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from cdp import Page  # noqa: E402

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4319/"
AXE = (ROOT / "node_modules" / "axe-core" / "axe.min.js").read_text(encoding="utf-8")
ROLES = list(json.loads((ROOT / "packages" / "engine" / "src" / "roles.json").read_text(encoding="utf-8"))["roles"])
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))


def big_diagram(n=150):
    """150 blocks in 6 subnets of 25 (two networks in one region), each block connected to the next."""
    zones = [{"id": "z1", "kind": "region", "label": "eu-west", "x": 0, "y": 0, "w": 47, "h": 32}]
    nodes, edges = [], []
    roles = [r for r in ROLES if r != "custom"]
    for net in range(2):
        nid = f"z{2 + net * 4}"
        zones.append({"id": nid, "kind": "network", "label": f"net-{net + 1}", "x": 0.5, "y": 0.5 + net * 15.5, "w": 46, "h": 15, "parent": "z1"})
        for s in range(3):
            sid = f"z{3 + net * 4 + s}"
            sx, sy = 1 + s * 15, 1 + net * 15.5
            zones.append({"id": sid, "kind": "subnet", "label": f"sub-{net + 1}{s + 1}", "access": "private", "x": sx, "y": sy, "w": 14, "h": 14, "parent": nid})
            for j in range(5):
                for i in range(5):
                    k = len(nodes) + 1
                    nodes.append({"id": f"n{k}", "role": roles[k % len(roles)], "label": f"b{k}", "x": sx + 1.5 + i * 2.75, "y": sy + 1.5 + j * 2.75, "zone": sid})
                    if i:
                        edges.append({"id": f"e{len(edges) + 1}", "from": f"n{k - 1}", "to": f"n{k}", "kind": "request"})
            if s:
                edges.append({"id": f"e{len(edges) + 1}", "from": f"n{len(nodes) - 25}", "to": f"n{len(nodes) - 49}", "kind": "async"})
    assert len(nodes) == n
    return {"format": "archboard", "version": 1, "title": "150 blocks", "show": "generic", "zones": zones, "nodes": nodes, "edges": edges}


def frames(p):
    p.js("window.__f=[]; window.__on=true; const t=(ts)=>{ if(!window.__on) return; window.__f.push(ts); requestAnimationFrame(t); }; requestAnimationFrame(t);")


def stop_frames(p):
    f = p.js("window.__on=false; return window.__f;") or []
    gaps = [b - a for a, b in zip(f, f[1:])]
    if not gaps:
        return 999, 999, 0
    gaps.sort()
    return statistics.median(gaps), gaps[int(len(gaps) * 0.95) - 1 if len(gaps) > 1 else 0], len(gaps)


def empty_point(p):
    """A point on the canvas over no block, zone tab or control: where a drag pans."""
    return p.js("""
      const c=document.querySelector('.canvas').getBoundingClientRect();
      for (let y=c.top+20; y<c.bottom-20; y+=17) for (let x=c.left+20; x<c.right-20; x+=23) {
        const e=document.elementFromPoint(x,y);
        if (e && e.closest('svg.iso') && !e.closest('[data-block], .zone, .tab, .wire, button')) return [x,y];
      }
      return null;""")


def run_axe(p, tag):
    if not p.js("return !!window.axe;"):
        p.call("Runtime.evaluate", expression=AXE)
    r = p.js("""const r = await axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}});
              return r.violations.map(v => ({id: v.id, n: v.nodes.length, where: v.nodes.slice(0,3).map(n => n.target.join(' ') + (n.any[0] ? ' | ' + n.any[0].message : ''))}));""")
    check(f"{tag}: no WCAG 2.2 AA problems found by axe", not r, json.dumps(r)[:900])


def wait_for(p, cond, tries=40, step=0.25):
    for _ in range(tries):
        if p.js(f"return !!({cond});"):
            return True
        time.sleep(step)
    return False


# ------------------------------------------------------------------ 1. first paint on a classroom laptop
p = Page("about:blank", 1280, 720)
try:
    p.call("Network.enable")
    p.call("Network.setCacheDisabled", cacheDisabled=True)
    p.call("Network.emulateNetworkConditions", offline=False, latency=20, downloadThroughput=20e6 / 8, uploadThroughput=5e6 / 8)
    p.call("Emulation.setCPUThrottlingRate", rate=4)
    p.call("Page.addScriptToEvaluateOnNewDocument", source="""
      new MutationObserver((_, o) => { if (document.querySelector('[data-block]')) { window.__drawn = performance.now(); o.disconnect(); } })
        .observe(document, {childList: true, subtree: true});""")
    runs = []
    for _ in range(3):
        p.goto(URL, wait=4.0)
        m = p.js("return {fcp: (performance.getEntriesByType('paint').find(e => e.name === 'first-contentful-paint') || {}).startTime, drawn: window.__drawn};")
        runs.append(m)
    fcp = statistics.median(r["fcp"] or 9e9 for r in runs)
    drawn = statistics.median(r["drawn"] or 9e9 for r in runs)
    check("first paint under 1.5 s (CPU 4x slower, 20 Mbit/s)", fcp < 1500, f"median of 3: first paint {fcp:.0f} ms")
    check("the diagram is drawn under 1.5 s (same conditions)", drawn < 1500, f"median of 3: blocks drawn {drawn:.0f} ms")
    res = p.js("return performance.getEntriesByType('resource').map(e => e.name).concat([location.href]);")
    foreign = [u for u in res if not u.startswith(URL.rstrip("/")) and not u.startswith(("data:", "blob:"))]
    check("no third-party requests", not foreign, ", ".join(foreign[:4]))
    p.call("Emulation.setCPUThrottlingRate", rate=1)
    p.call("Network.emulateNetworkConditions", offline=False, latency=0, downloadThroughput=-1, uploadThroughput=-1)
    p.call("Network.setCacheDisabled", cacheDisabled=False)
finally:
    p.close()

# ------------------------------------------------------------------ 2. 150 blocks pan and zoom smoothly at 1280 x 720
p = Page(URL, 1280, 720)
try:
    p.js(f"localStorage.clear(); localStorage.setItem('archboard:theme','light'); localStorage.setItem('archboard:autosave', {json.dumps(json.dumps(big_diagram()))});")
    p.goto(URL, wait=3.0)
    n = p.js("return document.querySelectorAll('[data-block]').length;")
    check("the 150-block diagram opens", n == 150, f"{n} blocks")
    p.call("Emulation.setCPUThrottlingRate", rate=2)
    pt = empty_point(p)
    for kind in ("pan", "zoom"):
        frames(p)
        t0 = time.time()
        if kind == "pan":
            x, y = pt
            p.call("Input.dispatchMouseEvent", type="mousePressed", x=x, y=y, button="left", clickCount=1)
            for i in range(60):
                p.call("Input.dispatchMouseEvent", type="mouseMoved", x=x + (i % 30) * 6 - (90 if i >= 30 else 0), y=y + (i % 30) * 3, button="left", buttons=1)
                time.sleep(1 / 60)
            p.call("Input.dispatchMouseEvent", type="mouseReleased", x=x, y=y, button="left", clickCount=1)
        else:
            cx, cy = 640, 380
            for i in range(40):
                p.call("Input.dispatchMouseEvent", type="mouseWheel", x=cx, y=cy, deltaX=0, deltaY=-60 if i < 20 else 60)
                time.sleep(1 / 60)
        time.sleep(0.2)
        med, p95, count = stop_frames(p)
        check(f"150 blocks: {kind} is smooth (CPU 2x slower)", med <= 20 and p95 <= 34, f"{count} frames in {time.time() - t0:.1f} s, median {med:.1f} ms, 95% {p95:.1f} ms")
    moved = p.js("return document.querySelector('svg.iso g[transform]')?.getAttribute('transform') || '';")
    check("the drags and wheel turns moved the view", "translate" in moved or "matrix" in moved, moved[:60])
    p.call("Emulation.setCPUThrottlingRate", rate=1)
finally:
    p.close()

# ------------------------------------------------------------------ 3. accessibility: axe on every screen, both themes
p = Page(URL, 1280, 720)
try:
    for theme in ("light", "dark"):
        p.js(f"localStorage.clear(); localStorage.setItem('archboard:theme','{theme}');")
        p.goto(URL, wait=2.5)
        run_axe(p, f"{theme}, editor")
        p.js("document.querySelector('[data-block=\"n5\"]').dispatchEvent(new MouseEvent('click', {bubbles: true}));")
        p.js("document.querySelector('[data-block=\"n5\"]').focus();")
        time.sleep(0.4)
        run_axe(p, f"{theme}, a block selected")
        p.js("document.querySelector('button[aria-label=\"Flat view\"]').click();")
        time.sleep(0.5)
        run_axe(p, f"{theme}, flat view")
        p.js("document.querySelector('button[aria-label=\"3D view\"]').click();")
        p.js("document.querySelector('button[aria-label=\"Split\"]').click();")
        wait_for(p, "document.querySelector('.cm-content')")
        run_axe(p, f"{theme}, split view with the text")
        p.js("[...document.querySelectorAll('.side-tabs button')].find(b => b.textContent.trim() === 'Notes').click();")
        wait_for(p, "document.querySelector('.notes-input')")
        p.js("document.querySelector('.notes-input').focus();")
        p.call("Input.insertText", text="# Why\nTwo **app** servers. [docs](https://example.org)")
        run_axe(p, f"{theme}, notes")
        p.js("[...document.querySelectorAll('.notes-panel button')].find(b => b.textContent.trim() === 'Preview').click();")
        time.sleep(0.3)
        run_axe(p, f"{theme}, notes preview")
        p.js("document.querySelector('button[aria-label=\"Canvas\"]').click();")
        time.sleep(0.4)
        p.js("document.querySelector('button[aria-label=Present]').click();")
        time.sleep(0.8)
        run_axe(p, f"{theme}, present")
        p.js("document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));")
        time.sleep(0.4)
        p.js("document.getElementById('palette-search')?.focus();")
        p.call("Input.insertText", text="data")
        time.sleep(0.3)
        run_axe(p, f"{theme}, palette search")
    p.goto(URL.rstrip("/") + "/embed/?mode=view&origin=http://localhost:8765", wait=2.0)
    run_axe(p, "embed, waiting for a diagram")
finally:
    p.close()

# ------------------------------------------------------------------ 4. keyboard: every control reachable with Tab, focus visible
p = Page(URL, 1280, 720)
try:
    p.js("localStorage.clear(); localStorage.setItem('archboard:theme','light');")
    p.goto(URL, wait=2.5)
    p.js("document.activeElement?.blur(); window.__seen = new Set(); window.__bad = [];")
    for i in range(160):
        p.call("Input.dispatchKeyEvent", type="keyDown", key="Tab", code="Tab", windowsVirtualKeyCode=9)
        p.call("Input.dispatchKeyEvent", type="keyUp", key="Tab", code="Tab", windowsVirtualKeyCode=9)
        done = p.js("""
          const e = document.activeElement; if (!e || e === document.body) return false;
          if (window.__seen.has(e)) return true; window.__seen.add(e);
          const s = getComputedStyle(e), shadow = s.boxShadow !== 'none', outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2;
          // A block draws its focus as a thick marker-coloured outline (.ol) around its shape.
          const ol = e.closest('svg') && e.querySelector('.ol'), ring = !!ol && parseFloat(getComputedStyle(ol).strokeWidth) >= 3;
          if (!(shadow || outline || ring)) window.__bad.push((e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 30));
          return false;""")
        if done:
            break
    kb = p.js("""
      const vis = (el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
      const all = [...document.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')].filter(e => vis(e) && !e.disabled);
      // A member of a roving group (toolbar, radio group, list, tree) is reached through the group's one tab stop.
      const group = (e) => e.closest('[role=toolbar], [role=radiogroup], [role=listbox], [role=tablist], [role=tree], [role=menu], svg.iso');
      const missed = all.filter(e => !window.__seen.has(e) && !(group(e) && [...window.__seen].some(s => group(s) === group(e))) && e.tabIndex !== -1 ? true : false)
                        .filter(e => !window.__seen.has(e) && !(group(e) && [...window.__seen].some(s => group(s) === group(e))));
      return {stops: window.__seen.size, bad: window.__bad, missed: missed.map(e => (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 30))};""")
    check("every control is reachable with Tab", not kb["missed"], f"{kb['stops']} tab stops; missed: {kb['missed'][:6]}")
    check("focus is visible on every tab stop", not kb["bad"], f"no ring on: {kb['bad'][:6]}")
finally:
    p.close()

# ------------------------------------------------------------------ 5. reduced motion
p = Page("about:blank", 1280, 720)
try:
    p.call("Emulation.setEmulatedMedia", features=[{"name": "prefers-reduced-motion", "value": "reduce"}])
    p.goto(URL, wait=0.5)
    p.js("localStorage.clear(); localStorage.setItem('archboard:theme','light');")
    p.goto(URL, wait=2.5)
    moving = p.js("""return [...document.querySelectorAll('*')].filter(e => { const s = getComputedStyle(e);
        const t = s.transitionDuration.split(',').some(d => parseFloat(d) > 0.01), a = s.animationName !== 'none' && s.animationDuration.split(',').some(d => parseFloat(d) > 0.01);
        return t || a; }).map(e => e.className?.baseVal ?? e.className).slice(0, 6);""")
    check("reduced motion: no transitions or animations", not moving, json.dumps(moving))
    p.js("document.querySelector('button[aria-label=Present]').click();")
    time.sleep(0.6)
    p.js("document.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));")
    a = p.js("return document.querySelector('svg.iso g[transform]')?.getAttribute('transform');")
    time.sleep(0.6)
    b = p.js("return document.querySelector('svg.iso g[transform]')?.getAttribute('transform');")
    check("reduced motion: Present jumps to the next step with no glide", a == b and a, f"{a} -> {b}")
finally:
    p.close()

# ------------------------------------------------------------------ 6. offline once loaded
p = Page(URL, 1280, 720)
try:
    p.js("localStorage.clear(); localStorage.setItem('archboard:theme','light');")
    p.goto(URL, wait=3.0)
    time.sleep(2.0)  # the editor fetches its other parts when idle
    p.call("Network.enable")
    p.call("Network.emulateNetworkConditions", offline=True, latency=0, downloadThroughput=-1, uploadThroughput=-1)
    p.js("document.querySelector('button[aria-label=\"Split\"]').click();")
    check("offline: the text view opens", wait_for(p, "document.querySelector('.cm-content')", 20))
    p.js("[...document.querySelectorAll('.side-tabs button')].find(b => b.textContent.trim() === 'Notes')?.click();")
    check("offline: the notes open", wait_for(p, "document.querySelector('.notes-input')", 20))
    p.js("document.querySelector('button[aria-label=\"Canvas\"]').click();")
    time.sleep(0.4)
    before = p.js("return localStorage.getItem('archboard:autosave');")
    p.js("document.querySelector('button[aria-label=\"Auto-layout\"]').click();")
    time.sleep(3.0)
    after = p.js("return localStorage.getItem('archboard:autosave');")
    err = p.js("return document.querySelector('[role=alert], .toast')?.textContent || '';")
    check("offline: auto-layout runs", before != after, err[:80])
    p.js("document.querySelector('[data-block]').focus();")
    p.goto(URL, wait=3.0)
    check("offline: the page opens again from its saved copy", wait_for(p, "document.querySelectorAll('[data-block]').length > 0 && document.querySelector('.topbar')", 20))
finally:
    p.close()

print(f"\n{sum(results)} of {len(results)} checks passed")
sys.exit(0 if all(results) else 1)
