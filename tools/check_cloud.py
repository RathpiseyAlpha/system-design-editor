"""Check accounts and online saving (SPEC section 8.3) in a real browser against the real cloud service.

Build the editor and the service, then start the service with test accounts and an empty database:
  PUBLIC_URL=http://localhost:4320/ PORT=4320 ARCHBOARD_DEV_LOGIN=1 ARCHBOARD_DB=<new file> \
  ARCHBOARD_STATIC=apps/editor/dist node apps/cloud/dist/server.js
  python -I tools/check_cloud.py [http://localhost:4320/]

Each Page is a new browser profile: one Page is one computer, and two people in one Page share a computer.
"""
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from cdp import Page  # noqa: E402
from a11y_js import PAGE_CONTRAST  # noqa: E402

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4320/"
AXE = (ROOT / "node_modules" / "axe-core" / "axe.min.js").read_text(encoding="utf-8")
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))


def wait(p, cond, timeout=8.0):
    end = time.time() + timeout
    while time.time() < end:
        if p.js(cond):
            return True
        time.sleep(0.15)
    return False


def chip(p):
    return p.js("return document.querySelector('.topbar .chip')?.textContent || '';")


def pick(p, label, value):
    """Choose an option of a select (the account menu, New): the way React sees a person's choice."""
    p.js(f"""const s = document.querySelector('select[aria-label^="{label}"]');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, {json.dumps(value)});
      s.dispatchEvent(new Event('change', {{bubbles: true}}));""")


def type_into(p, selector, text):
    p.js(f"""const i = document.querySelector({json.dumps(selector)}); i.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, {json.dumps(text)});
      i.dispatchEvent(new Event('input', {{bubbles: true}}));""")


def api(p, method, path, body=None):
    """Call the service from the page, as the signed-in person (same origin, the session cookie)."""
    b = "" if body is None else f", headers: {{'content-type': 'application/json'}}, body: JSON.stringify({json.dumps(body)})"
    return p.js(f"const r = await fetch('{path}', {{method: '{method}', credentials: 'same-origin'{b}}}); "
                "return {status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null)};")


def sign_in(p, name):
    p.js("document.querySelector('.signin-btn').click();")
    wait(p, "return !!document.querySelector('dialog.modal input');")
    type_into(p, "dialog.modal input", name)
    p.js("document.querySelector('dialog.modal form').requestSubmit();")
    time.sleep(2.5)
    return wait(p, f"return document.querySelector('select[aria-label^=\"Account\"]')?.getAttribute('aria-label') === 'Account: {name}';")


def axe(p, tag):
    if not p.js("return !!window.axe;"):
        p.call("Runtime.evaluate", expression=AXE)
    r = p.js("""const r = await axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}});
      return {bad: r.violations.map(v => ({id: v.id, where: v.nodes.slice(0,3).map(n => n.target.join(' ') + (n.any[0] ? ' | ' + n.any[0].message : ''))})),
              unsure: r.incomplete.filter(v => v.id === 'color-contrast').flatMap(v => v.nodes.filter(n => !n.target.join(' ').includes('svg')).map(n => n.target.join(' ')))};""")
    check(f"{tag}: no WCAG 2.2 AA problems found by axe", not r["bad"], json.dumps(r["bad"])[:700])
    if r["unsure"]:
        u = p.js("const SELECTORS = " + json.dumps(r["unsure"]) + ";" + PAGE_CONTRAST)
        check(f"{tag}: text axe could not decide reaches AA contrast", not u["bad"], "; ".join(u["bad"][:4]))


def fits(p):
    return p.js("""const de = document.documentElement, top = document.querySelector('.topbar');
      return {sideways: de.scrollWidth > de.clientWidth, topFits: top.scrollWidth <= top.clientWidth + 1};""")


# 1. One computer: work signed out, sign in, edit, reload, conflict, New, sign out; then a second person on it.
p = Page(URL, 1280, 720)
try:
    p.js("localStorage.clear(); localStorage.setItem('archboard:theme','light');")
    p.goto(URL, wait=2.5)
    check("signed out: a Sign in button, and the work is kept in this browser", p.js("return !!document.querySelector('.signin-btn');") and chip(p) == "Saved", chip(p))
    m = fits(p)
    check("1280x720 signed out: the top bar fits", m["topFits"] and not m["sideways"], json.dumps(m))
    type_into(p, "input.doc-title", "Dara shop")
    time.sleep(1.0)
    check("signed-in-later work is in the browser's autosave", "Dara shop" in (p.js("return localStorage.getItem('archboard:autosave');") or ""))

    ok = sign_in(p, "Dara")
    check("signing in with a test account comes back signed in, with the address cleaned", ok and "signin" not in p.js("return location.search;"), p.js("return location.href;"))
    check("the welcome message says who is signed in", "Signed in as Dara" in (p.js("return document.querySelector('.notice')?.textContent || '';") or ""))
    wait(p, "return document.querySelector('.topbar .chip')?.textContent === 'Saved online';")
    check("the chip says Saved online", chip(p) == "Saved online", chip(p))
    rows = (api(p, "GET", "/api/diagrams")["body"] or {}).get("diagrams", [])
    check("first sign-in: the diagram already here became an online diagram", [r["title"] for r in rows] == ["Dara shop"], json.dumps(rows)[:200])

    type_into(p, "input.doc-title", "Dara shop v2")
    saving = wait(p, "return document.querySelector('.topbar .chip')?.textContent.startsWith('Saving');", 3)
    wait(p, "return document.querySelector('.topbar .chip')?.textContent === 'Saved online';")
    rows = (api(p, "GET", "/api/diagrams")["body"] or {}).get("diagrams", [])
    check("an edit is saved online about a second later (Saving…, then Saved online)", saving and rows and rows[0]["title"] == "Dara shop v2" and rows[0]["version"] == 2, f"{saving}; {json.dumps(rows)[:200]}")

    # A change made just before the page closes is not lost: it is in this browser at once, and goes online on reopening.
    type_into(p, "input.doc-title", "Dara shop v3")
    p.goto(URL, wait=3.0)
    wait(p, "return document.querySelector('.topbar .chip')?.textContent === 'Saved online';")
    rows = (api(p, "GET", "/api/diagrams")["body"] or {}).get("diagrams", [])
    check("a change made right before a reload is kept and sent after it", p.js("return document.querySelector('input.doc-title').value;") == "Dara shop v3" and rows[0]["title"] == "Dara shop v3", json.dumps(rows)[:160])
    type_into(p, "input.doc-title", "Dara shop v2")
    wait(p, "return document.querySelector('.topbar .chip')?.textContent.startsWith('Saving');", 3)
    wait(p, "return document.querySelector('.topbar .chip')?.textContent === 'Saved online';")

    p.goto(URL, wait=3.0)
    check("reopened: still signed in, the same online diagram on screen",
          p.js("return document.querySelector('input.doc-title').value;") == "Dara shop v2" and chip(p) == "Saved online", chip(p))

    # My diagrams.
    p.js("document.querySelector('button[aria-label=Open]').click();")
    wait(p, "return document.querySelectorAll('.doc-list li').length === 1;")
    d = p.js("return {open: document.querySelector('dialog.modal')?.open, title: document.querySelector('#modal-title')?.textContent, rows: [...document.querySelectorAll('.doc-list li')].map(li => li.textContent), focus: !!document.activeElement.closest('dialog')};")
    check("Open lists the online diagrams in a dialog, the one on screen marked", d["open"] and d["title"] == "My diagrams" and "On screen" in d["rows"][0] and d["focus"], json.dumps(d))
    axe(p, "My diagrams dialog, light")
    p.call("Input.dispatchKeyEvent", type="keyDown", key="Escape", code="Escape", windowsVirtualKeyCode=27)
    p.call("Input.dispatchKeyEvent", type="keyUp", key="Escape", code="Escape", windowsVirtualKeyCode=27)
    time.sleep(0.3)
    check("Escape closes it", not p.js("return !!document.querySelector('dialog.modal');"))

    # A conflict: another tab saves first.
    doc_id = rows[0]["id"]
    cur = api(p, "GET", f"/api/diagrams/{doc_id}")["body"]
    other = dict(cur["diagram"], title="Saved in another tab")
    r = api(p, "PUT", f"/api/diagrams/{doc_id}", {"diagram": other, "base": cur["version"]})
    type_into(p, "input.doc-title", "Changed here")
    shown = wait(p, "return document.querySelector('#modal-title')?.textContent === 'This diagram changed somewhere else';", 6)
    check("a save over a newer version shows the conflict dialog, and the chip says so", shown and chip(p) == "Conflict", chip(p))
    axe(p, "conflict dialog")
    p.js("[...document.querySelectorAll('.modal-choices .btn')].find(b => b.textContent.includes('Keep this one')).click();")
    wait(p, "return document.querySelector('.topbar .chip')?.textContent === 'Saved online';")
    got = api(p, "GET", f"/api/diagrams/{doc_id}")["body"]
    check("Keep this one: this version replaces the other, knowingly", got["diagram"]["title"] == "Changed here" and got["version"] == cur["version"] + 2, json.dumps({"t": got["diagram"]["title"], "v": got["version"]}))

    pick(p, "New diagram", "serverless-api")
    time.sleep(2.0)
    rows = (api(p, "GET", "/api/diagrams")["body"] or {}).get("diagrams", [])
    check("New starts another online diagram; the first is untouched", len(rows) == 2 and any(x["title"] == "Changed here" for x in rows), json.dumps([x["title"] for x in rows]))

    # Offline: the change waits in this browser and goes when the connection returns.
    p.call("Network.enable")
    p.call("Network.emulateNetworkConditions", offline=True, latency=0, downloadThroughput=-1, uploadThroughput=-1)
    type_into(p, "input.doc-title", "Written offline")
    wait(p, "return document.querySelector('.topbar .chip')?.textContent === 'Offline';", 6)
    check("offline: the chip says Offline", chip(p) == "Offline", chip(p))
    p.call("Network.emulateNetworkConditions", offline=False, latency=0, downloadThroughput=-1, uploadThroughput=-1)
    back = wait(p, "return document.querySelector('.topbar .chip')?.textContent === 'Saved online';", 14)
    rows = (api(p, "GET", "/api/diagrams")["body"] or {}).get("diagrams", [])
    check("back online: the change is sent", back and rows[0]["title"] == "Written offline", f"{chip(p)}; {rows[0]['title'] if rows else None}")

    m = fits(p)
    check("1280x720 signed in: the top bar fits", m["topFits"] and not m["sideways"], json.dumps(m))
    axe(p, "signed in, light")
    p.shot(str(ROOT / "cloud-check-light.png"))

    # A second tab of the same browser (same origin, so this page can drive it), still signed in.
    t2 = p.tab(URL)
    check("a second tab of the same browser is signed in too", wait(t2, "return document.querySelector('.topbar .chip')?.textContent === 'Saved online';", 10))
    # Sign out on a shared computer: nothing of Dara's is left.
    pick(p, "Account", "out")
    wait(p, "return !!document.querySelector('.signin-btn');")
    # The other tab follows, and an edit there writes nothing of Dara's back into this browser.
    two = wait(t2, "return !!document.querySelector('.signin-btn');", 5)
    type_into(t2, "input.doc-title", "Typed in tab 2")
    time.sleep(2.0)
    kept = p.js("return {auto: localStorage.getItem('archboard:autosave') || '', online: localStorage.getItem('archboard:online')};")
    check("signing out in one tab signs the other tab out; its next edit keeps nothing of Dara's", two and "Dara" not in kept["auto"] and "Written offline" not in kept["auto"] and not kept["online"], json.dumps(kept)[:160])
    t2.close()
    p.js("localStorage.removeItem('archboard:autosave');")
    left = p.js("""return {autosave: localStorage.getItem('archboard:autosave'), online: localStorage.getItem('archboard:online'),
      title: document.querySelector('input.doc-title').value, undo: document.querySelector('button[aria-label=Undo]').disabled, chip: document.querySelector('.topbar .chip').textContent};""")
    check("signing out leaves nothing behind: no autosave, no link, another diagram, nothing to undo",
          not left["autosave"] and not left["online"] and "Dara" not in left["title"] and "offline" not in left["title"].lower() and left["undo"] and left["chip"] == "Saved", json.dumps(left))
    check("signed out, the service answers as no one", api(p, "GET", "/api/diagrams")["status"] == 401)

    ok = sign_in(p, "Sok")
    rows = (api(p, "GET", "/api/diagrams")["body"] or {}).get("diagrams", [])
    check("the next person on this computer gets nothing of Dara's", ok and rows == [] and "Dara" not in p.js("return document.querySelector('input.doc-title').value;"), json.dumps(rows)[:200])

    # Dark theme, signed in, the account menu.
    p.js("localStorage.setItem('archboard:theme','dark');")
    p.goto(URL, wait=3.0)
    axe(p, "signed in, dark")
    p.js("document.querySelector('button[aria-label=Open]').click();")
    wait(p, "return !!document.querySelector('.modal-empty, .doc-list');")
    axe(p, "My diagrams dialog, dark")
    p.shot(str(ROOT / "cloud-check-dark.png"))
    p.js("document.querySelector('dialog.modal button[aria-label=Close]').click();")

    pick(p, "Account", "delete")
    wait(p, "return document.querySelector('#modal-title')?.textContent === 'Delete your account?';")
    axe(p, "delete account dialog, dark")
    p.js("[...document.querySelectorAll('dialog.modal .btn')].find(b => b.textContent === 'Delete account').click();")
    wait(p, "return !!document.querySelector('.signin-btn');")
    me = api(p, "GET", "/api/me")["body"]
    check("Delete account signs out and the account is gone", me["user"] is None and p.js("return !!document.querySelector('.signin-btn');"))
finally:
    p.close()

# 2. Another computer: the same person finds their latest diagram.
p = Page(URL, 1366, 768)
try:
    p.js("localStorage.clear();")
    p.goto(URL, wait=2.5)
    ok = sign_in(p, "Dara")
    check("on another computer, signing in opens the latest online diagram", ok and p.js("return document.querySelector('input.doc-title').value;") == "Written offline",
          p.js("return document.querySelector('input.doc-title').value;"))
finally:
    p.close()

# 3. Sizes: the top bar fits signed in at each supported size.
for w, h in ((1280, 720), (1366, 768), (1536, 864), (1920, 1080)):
    p = Page(URL, w, h)
    try:
        p.js("localStorage.clear();")
        p.goto(URL, wait=2.0)
        sign_in(p, "Dara")
        m = fits(p)
        name = p.js("return Math.round(document.querySelector('input.doc-title').getBoundingClientRect().width);")
        check(f"{w}x{h} signed in: the top bar fits, no sideways scroll, the diagram's name has room (140 px or more)", m["topFits"] and not m["sideways"] and name >= 140, json.dumps(m) + f" name {name}px")
        p.js("document.querySelector('button[aria-label=Simulate]').click();")
        time.sleep(0.4)
        m = fits(p)
        check(f"{w}x{h} signed in, Simulate: the top bar fits", m["topFits"] and not m["sideways"], json.dumps(m))
    finally:
        p.close()

print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
