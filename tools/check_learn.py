"""Check learning mode end to end, the way a course site uses it (SPEC section 8): the editor in an iframe on another origin,
the brief and Check inside it, every change kept by the host, Hand in scored on the host's server through the checker.

Start a preview of the editor (port 4319) and build the checker (apps/checker: node build.mjs), then:
  python -I tools/check_learn.py
It starts the checker and the stand-in host (tools/learn-host) itself, and stops them after.
"""
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from cdp import Page  # noqa: E402
from a11y_js import CANVAS_CONTRAST, PAGE_CONTRAST  # noqa: E402

AXE = (ROOT / 'node_modules' / 'axe-core' / 'axe.min.js').read_text(encoding='utf-8')

EMBED = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4319/embed/"
SECRET = "learn-check-secret-0123456789abcd"
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_http(url):
    for _ in range(60):
        try:
            urllib.request.urlopen(url, timeout=1)
            return
        except Exception:
            time.sleep(0.1)
    raise RuntimeError(f"{url} did not answer")


cport, hport = free_port(), 8766
logs = [tempfile.TemporaryFile(), tempfile.TemporaryFile()]
checker = subprocess.Popen(["node", str(ROOT / "apps/checker/dist/server.js")], stdout=logs[0], stderr=subprocess.STDOUT,
                           env={**os.environ, "PORT": str(cport), "HOST": "127.0.0.1", "ARCHBOARD_KEYS": f"learnhost:{SECRET}"})
host = subprocess.Popen([sys.executable, "-I", str(HERE / "learn-host/server.py"), str(hport), "shop-survives-a-zone", f"http://127.0.0.1:{cport}", SECRET],
                        stdout=logs[1], stderr=subprocess.STDOUT)
HOST = f"http://localhost:{hport}"
try:
    wait_http(f"http://127.0.0.1:{cport}/v1/health")
    wait_http(f"{HOST}/challenge")
    p = Page(f"{HOST}/?editor={EMBED}", 1366, 768)

    def frame_id():
        frames = p.call("Page.getFrameTree")["frameTree"].get("childFrames", [])
        return frames[0]["frame"]["id"] if frames else None

    def fr(code):
        ctx = p.call("Page.createIsolatedWorld", frameId=frame_id(), worldName="check")["executionContextId"]
        r = p.call("Runtime.evaluate", expression=f"(()=>{{{code}}})()", contextId=ctx, returnByValue=True)
        return r.get("result", {}).get("value")

    def host_js(code):
        return p.js(code)

    def wait(cond, tries=40):
        for _ in range(tries):
            if cond():
                return True
            time.sleep(0.25)
        return False

    def types():
        return [m.get("type") for m in host_js("return window.log;") or []]

    try:
        p.goto(f"{HOST}/?editor={EMBED}", wait=4.0)
        wait(lambda: "loaded" in types())
        check("the editor says ready in learn mode and loads the host's challenge", (host_js("return window.log[0];") or {}).get("mode") == "learn" and "loaded" in types(), json.dumps(types()))
        ui = fr("""return {panel: !!document.querySelector('.learn-panel'), title: document.querySelector('.learn-panel h2')?.textContent,
                    brief: document.querySelector('.learn-brief strong')?.textContent, rules: document.querySelectorAll('.learn-panel .rules li').length,
                    palette: !!document.querySelector('.palette, .side--l'), inspector: !!document.querySelector('.side--r, .insp'),
                    newBtn: !!document.querySelector('select[aria-label="New diagram"]'), open: !!document.querySelector('button[aria-label="Open a file"]')};""")
        check("the brief, its checks and the editing tools are shown; New and Open are not", ui["panel"] and ui["title"] == "Keep the shop open when one failure zone fails" and ui["brief"] == "failure zone" and ui["rules"] == 5 and ui["palette"] and not ui["newBtn"] and not ui["open"], json.dumps(ui))

        fr("[...document.querySelectorAll('.learn-panel button')].find(b => b.textContent.trim() === 'Check').click();")
        time.sleep(0.5)
        score = fr("return document.querySelector('.learn-panel .score b')?.textContent;")
        hints = next((m for m in reversed(host_js("return window.log;")) if m.get("type") == "hints"), None)
        check("Check gives a result per rule in the panel, and the host gets it marked indicative", score == "4 / 8" and hints and hints["score"] == 4 and hints["indicative"] is True, f"{score}; {json.dumps(hints)[:120]}")

        # An edit inside the iframe (the keyboard, as a student would): delete the database. The host is told, once settled.
        fr("document.querySelector('[data-block=\"n5\"]').focus();")
        p.call("Input.dispatchKeyEvent", type="keyDown", key="Delete", code="Delete", windowsVirtualKeyCode=46)
        p.call("Input.dispatchKeyEvent", type="keyUp", key="Delete", code="Delete", windowsVirtualKeyCode=46)
        wait(lambda: "change" in types())
        change = next((m for m in reversed(host_js("return window.log;")) if m.get("type") == "change"), None)
        check("an edit reaches the host as one change, marked not saved", change and change["dirty"] is True and len(change["diagram"]["nodes"]) == 4, json.dumps(change)[:100] if change else "none")
        stale = fr("return !!document.querySelector('.learn-stale');")
        check("the last check stays, marked as older than the diagram", stale and fr("return document.querySelector('.learn-panel .score b')?.textContent;") == "4 / 8")
        fr("[...document.querySelectorAll('.learn-panel button')].find(b => b.textContent.trim() === 'Check').click();")
        time.sleep(0.4)
        local = fr("return document.querySelector('.learn-panel .score b')?.textContent;")

        # Hand in: the host asks for the diagram, its server scores it with its own rules through the checker.
        host_js("document.getElementById('hand-in').click();")
        wait(lambda: host_js("return !!window.serverResult;"))
        server = host_js("return window.serverResult;") or {}
        stored = json.loads(urllib.request.urlopen(f"{HOST}/handed-in").read())
        check("Hand in is scored on the server, and the score equals the editor's own check", local == f"{server.get('score')} / {server.get('max')}" and server.get("engine"), f"editor {local}, server {server.get('score')} / {server.get('max')}")
        check("the server ignores a score and rules sent by the page", stored and stored[-1]["ignored"] == ["rules", "score"] and stored[-1]["score"] == server.get("score"), json.dumps(stored))
        time.sleep(1.2)
        after_save = types()
        check("after the save the host is not sent the same diagram again", "save" in after_save and "change" not in after_save[after_save.index("save"):], json.dumps(after_save))

        # The host reopens the editor with what it kept: the student's work is back.
        host_js("window.log = []; window.loadNext();")
        wait(lambda: "loaded" in types())
        time.sleep(0.5)
        check("the host restores the student's last change with load", fr("return document.querySelectorAll('[data-block]').length;") == 4)

        # After the deadline the host locks the work: brief and checks stay, nothing can be edited.
        host_js("window.log = []; window.loadNext({readOnly: true});")
        wait(lambda: "loaded" in types())
        time.sleep(0.5)
        locked = fr("return {panel: !!document.querySelector('.learn-panel'), palette: !!document.querySelector('.side--l'), topbar: !!document.querySelector('.topbar'), blocks: document.querySelectorAll('[data-block]').length};")
        fr("document.querySelector('[data-block]').focus();")
        p.call("Input.dispatchKeyEvent", type="keyDown", key="Delete", code="Delete", windowsVirtualKeyCode=46)
        time.sleep(1.2)
        check("readOnly keeps the brief and the diagram, and nothing can be changed", locked["panel"] and not locked["palette"] and not locked["topbar"] and fr("return document.querySelectorAll('[data-block]').length;") == locked["blocks"] and "change" not in types(), json.dumps(locked))

        # A brief is Markdown drawn as a tree: HTML and a javascript: link do nothing.
        host_js("""window.log = []; window.sendLoad({brief: {title: 'Test <b>x</b>', text: '<img src=x onerror="window.top.pwned=1">\\n\\n[click](javascript:window.top.pwned=2) and [docs](https://example.org)'}});""")
        wait(lambda: "loaded" in types())
        time.sleep(0.3)
        xss = fr("return {img: !!document.querySelector('.learn-panel img'), links: [...document.querySelectorAll('.learn-brief a')].map(a => a.getAttribute('href')), title: document.querySelector('.learn-panel h2').textContent};")
        check("a brief with HTML and a javascript: link renders as plain text and one https link", not xss["img"] and xss["links"] == ["https://example.org"] and xss["title"] == "Test <b>x</b>" and not host_js("return window.pwned || null;"), json.dumps(xss))

        # Wrong rules are refused with an error; hello gets ready again (a host that listened late).
        host_js("window.log = []; window.sendLoad({rules: {format: 'archboard-rules', version: 1, rules: [{id: 'a', points: 1, text: 't', rule: {label: 'x'}}]}}); window.send({type: 'hello'});")
        time.sleep(0.8)
        err = next((m for m in host_js("return window.log;") if m.get("type") == "error"), None)
        check("rules that do not read are refused with an error", err and any(e.startswith("rules:") for e in err["errors"]), json.dumps(err)[:150] if err else "none")
        check("hello is answered with ready", "ready" in types())
        p.shot(str(ROOT / "learn-check.png"))
        print("screenshot: learn-check.png")
    finally:
        p.close()

    # Learning mode at the four sizes of SPEC section 9, light and dark: layout, axe, contrast, Tab and focus rings.
    for w, h in ((1280, 720), (1366, 768), (1536, 864), (1920, 1080)):
        for theme in ("light", "dark"):
            tag = f"{w}x{h} {theme}"
            p = Page(f"{HOST}/?editor={EMBED}", w, h)
            try:
                p.goto(f"{HOST}/?editor={EMBED}", wait=4.0)
                p.js(f"window.send({{type: 'setTheme', theme: '{theme}'}});")
                time.sleep(0.5)
                fid = p.call("Page.getFrameTree")["frameTree"]["childFrames"][0]["frame"]["id"]
                ctx = p.call("Page.createIsolatedWorld", frameId=fid, worldName="a11y")["executionContextId"]

                def ev(code, awaited=False):
                    r = p.call("Runtime.evaluate", expression=f"(async()=>{{{code}}})()", contextId=ctx, returnByValue=True, awaitPromise=True)
                    if "exceptionDetails" in r:
                        raise RuntimeError(str(r["exceptionDetails"])[:300])
                    return r.get("result", {}).get("value")
                ev("[...document.querySelectorAll('.learn-panel button')].find(b => b.textContent.trim() === 'Check').click();")
                time.sleep(0.4)
                m = ev("""const de = document.documentElement, panel = document.querySelector('.learn-panel').getBoundingClientRect();
                  const canvas = document.querySelector('.canvas').getBoundingClientRect(), insp = document.querySelector('.side--r')?.getBoundingClientRect();
                  const small = [...document.querySelectorAll('.learn-panel *')].filter(e => e.childElementCount === 0 && e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 12).length;
                  return {sideways: de.scrollWidth > de.clientWidth, panel: Math.round(panel.width), canvas: Math.round(canvas.width), insp: insp ? Math.round(insp.width) : 0, small,
                          topFits: document.querySelector('.topbar').scrollWidth <= document.querySelector('.topbar').clientWidth + 1};""")
                check(f"{tag}: the brief, a usable canvas and the inspector fit, no sideways scroll", not m["sideways"] and m["topFits"] and m["panel"] >= 290 and m["canvas"] >= 380 and m["insp"] >= 280 and not m["small"], json.dumps(m))
                ev(AXE)
                r = ev("""const r = await axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}});
                  return {bad: r.violations.map(v => ({id: v.id, where: v.nodes.slice(0,3).map(n => n.target.join(' ') + (n.any[0] ? ' | ' + n.any[0].message : ''))})),
                          unsure: r.incomplete.filter(v => v.id === 'color-contrast').flatMap(v => v.nodes.filter(n => !n.target.join(' ').includes('svg')).map(n => n.target.join(' ')))};""")
                check(f"{tag}: no WCAG 2.2 AA problems found by axe", not r["bad"], json.dumps(r["bad"])[:700])
                if r["unsure"]:
                    u = ev("const SELECTORS = " + json.dumps(r["unsure"]) + ";" + PAGE_CONTRAST)
                    check(f"{tag}: text axe could not decide reaches AA contrast", not u["bad"], "; ".join(u["bad"][:4]))
                c = ev(CANVAS_CONTRAST)
                check(f"{tag}: every text on the canvas reaches AA contrast", c["n"] > 5 and not c["bad"], f"{c['n']} texts; " + "; ".join(c["bad"][:3]))
                # Tab from the top of the frame: the Check button is reached, and every stop in the panel shows its ring.
                ev("document.activeElement?.blur(); window.__seen = []; window.__bad = [];")
                ev("document.querySelector('.topbar button').focus();")
                for _ in range(40):
                    p.call("Input.dispatchKeyEvent", type="keyDown", key="Tab", code="Tab", windowsVirtualKeyCode=9)
                    p.call("Input.dispatchKeyEvent", type="keyUp", key="Tab", code="Tab", windowsVirtualKeyCode=9)
                    ev("""const e = document.activeElement; if (!e || !e.closest('.learn-panel')) return;
                      window.__seen.push(e.textContent.trim().slice(0, 20));
                      const s = getComputedStyle(e); if (!(s.boxShadow !== 'none' || (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2))) window.__bad.push(e.textContent.trim().slice(0, 20));""")
                tab = ev("return {seen: window.__seen, bad: window.__bad};")
                check(f"{tag}: Tab reaches Check, with a visible ring", "Check" in tab["seen"] and not tab["bad"], json.dumps(tab))
                if w == 1280 and theme == "light":
                    p.shot(str(ROOT / "learn-check-1280.png"))
            finally:
                p.close()
finally:
    for proc in (checker, host):
        proc.terminate()
        proc.wait(timeout=10)

print(f"\n{sum(results)} of {len(results)} checks passed")
sys.exit(0 if all(results) else 1)
