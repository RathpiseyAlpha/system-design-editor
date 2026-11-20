"""Check the read-only embed (SPEC section 8.1) the way a host page uses it: from another origin, through postMessage.

Start a preview of the editor first (port 4319), then:  python -I tools/check_embed.py [editor-embed-url]
This serves tools/ on http://localhost:8765 (the host's origin), opens tools/embed-host.html and checks both frames.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from cdp import Page  # noqa: E402

EMBED = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4319/embed/"
EDITOR = EMBED.split("/embed")[0] + "/"
HOST = "http://localhost:8765"
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))


def in_frame(p, frame_id, code):
    """Run code inside an iframe (its own isolated world: the page's DOM, none of its scripts)."""
    ctx = p.call("Page.createIsolatedWorld", frameId=frame_id, worldName="check")["executionContextId"]
    r = p.call("Runtime.evaluate", expression=f"(()=>{{{code}}})()", contextId=ctx, returnByValue=True)
    return r.get("result", {}).get("value")


server = subprocess.Popen([sys.executable, "-m", "http.server", "8765", "--bind", "127.0.0.1", "--directory", str(HERE)],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    time.sleep(1.0)

    # 1. Opened on its own (no host), the embed never reads or writes the editor's autosave.
    p = Page(EDITOR, 1280, 720)
    try:
        p.goto(EDITOR, wait=2.0)
        marker = "embed-check-marker"
        p.js(f"localStorage.setItem('archboard:autosave', '{marker}');")
        p.goto(EMBED + "?mode=view&origin=" + HOST, wait=2.0)
        alone = p.js("return {note: document.querySelector('.embed-note')?.textContent || '', blocks: document.querySelectorAll('[data-block]').length, topbar: !!document.querySelector('.topbar')};")
        check("an embed with no host waits, shows no editor chrome and no saved diagram", "Waiting" in alone["note"] and alone["blocks"] == 0 and not alone["topbar"], json.dumps(alone))
        p.goto(EMBED + "?mode=view", wait=1.5)
        check("an embed without the host's origin says so", "origin" in (p.js("return document.querySelector('.embed-note')?.textContent || '';") or ""))
        check("the editor's autosave is untouched by the embed", p.js("return localStorage.getItem('archboard:autosave');") == marker)
        p.js("localStorage.removeItem('archboard:autosave');")
    finally:
        p.close()

    # 2. In a host page on another origin.
    p = Page(HOST + "/embed-host.html?editor=" + EMBED, 1280, 1100)
    try:
        p.goto(HOST + "/embed-host.html?editor=" + EMBED, wait=5.0)
        log = p.js("return window.log;") or []
        good = [m for m in log if m.get("from") == "good"]
        types = [m.get("type") for m in good]
        check("the embed says ready to its declared origin, with v1", bool(good) and good[0].get("type") == "ready" and good[0].get("v") == 1 and good[0].get("mode") == "view", json.dumps(good[:1]))
        loaded = next((m for m in good if m.get("type") == "loaded"), None)
        check("the host's diagram is loaded and acknowledged", bool(loaded) and loaded.get("nodes") == 3 and loaded.get("edges") == 2, json.dumps(loaded))
        err = next((m for m in good if m.get("type") == "error"), None)
        check("a broken diagram is refused with an error message", bool(err) and err.get("errors"), json.dumps(err))
        check("the other frame sends this page nothing", not [m for m in log if m.get("from") != "good"], json.dumps(log))

        frames = p.call("Page.getFrameTree")["frameTree"].get("childFrames", [])
        ids = {("bad" if "localhost%3A9" in f["frame"]["url"] else "good"): f["frame"]["id"] for f in frames}
        g = in_frame(p, ids["good"], """return {blocks: document.querySelectorAll('[data-block]').length, note: !!document.querySelector('.embed-note'),
            palette: !!document.querySelector('.palette, .insp, .topbar'), layout: !!document.querySelector('button[aria-label="Auto-layout"]'),
            flat: !!document.querySelector('button[aria-label="Flat view"]'), theme: document.documentElement.dataset.theme || ''};""")
        check("the declared frame shows the diagram (kept after the broken one), view tools only", g["blocks"] == 3 and not g["note"] and not g["palette"] and not g["layout"] and g["flat"], json.dumps(g))
        check("setTheme from the host changes the frame's theme", g["theme"] == "dark")
        b = in_frame(p, ids["bad"], "return {blocks: document.querySelectorAll('[data-block]').length, note: document.querySelector('.embed-note')?.textContent || ''};")
        check("a frame declaring another origin ignores this page's diagram", p.js("return !!window.sentBad;") and b["blocks"] == 0 and "Waiting" in b["note"], json.dumps(b))
        p.shot(str(HERE.parent / "embed-check.png"))
        print("screenshot: embed-check.png")
    finally:
        p.close()
finally:
    server.terminate()

print(f"\n{sum(results)} of {len(results)} checks passed")
sys.exit(0 if all(results) else 1)
