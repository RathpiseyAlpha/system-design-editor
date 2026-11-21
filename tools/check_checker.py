"""Check the built checker service (apps/checker/dist) over real HTTP, the way a host such as labsite calls it.

Build it first (in apps/checker: node build.mjs), then:  python -I tools/check_checker.py
It starts dist/server.js twice on free ports (once with a 1 ms time limit, to see a check stopped) and stops them after.
"""
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SERVER = ROOT / "apps" / "checker" / "dist" / "server.js"
SECRET = "check-secret-0123456789abcdefgh"
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start(**env):
    port = free_port()
    # The log goes to a file: a pipe nobody reads fills up (4 KB on Windows) and then the server waits on its own log.
    log = tempfile.TemporaryFile(mode="w+", encoding="utf-8")
    proc = subprocess.Popen(["node", str(SERVER)], env={**os.environ, "PORT": str(port), "HOST": "127.0.0.1", "ARCHBOARD_KEYS": f"labsite:{SECRET}", **env},
                            stdout=log, stderr=subprocess.STDOUT, text=True)
    proc.log = log
    for _ in range(60):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/v1/health", timeout=1)
            return proc, port
        except Exception:
            time.sleep(0.1)
    proc.kill()
    raise RuntimeError("the checker did not start: " + read_log(proc))


def read_log(proc):
    proc.log.seek(0)
    return proc.log.read()


def call(port, path, body=None, key=SECRET, ctype="application/json"):
    data = None if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=data, method="POST" if data is not None else "GET")
    if key:
        req.add_header("Authorization", f"Bearer {key}")
    if data is not None:
        req.add_header("Content-Type", ctype)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


# A 3-tier shop, as the editor saves it, and the four example rules of SPEC section 7.
SHOP = {"format": "archboard", "version": 1, "title": "Online shop", "show": "generic",
        "zones": [{"id": "z1", "kind": "network", "label": "shop-net", "x": 3, "y": -0.5, "w": 13.5, "h": 11},
                  {"id": "z2", "kind": "subnet", "access": "public", "label": "public-a", "parent": "z1", "x": 3.8, "y": 0.5, "w": 3.8, "h": 9.2},
                  {"id": "z3", "kind": "subnet", "access": "private", "label": "private-a", "parent": "z1", "x": 8.6, "y": 0.5, "w": 7.2, "h": 9.2}],
        "nodes": [{"id": "n1", "role": "client", "label": "Customers", "x": 0, "y": 6},
                  {"id": "n2", "role": "load-balancer", "label": "web-lb", "zone": "z2", "x": 5.7, "y": 6},
                  {"id": "n3", "role": "vm", "label": "app-1", "zone": "z3", "x": 10.2, "y": 3},
                  {"id": "n5", "role": "relational-db", "label": "orders-db", "zone": "z3", "x": 14, "y": 3}],
        "edges": [{"id": "e1", "from": "n1", "to": "n2", "kind": "request"}, {"id": "e2", "from": "n2", "to": "n3", "kind": "request"},
                  {"id": "e3", "from": "n3", "to": "n5", "kind": "request"}]}
RULES = {"format": "archboard-rules", "version": 1, "rules": [
    {"id": "r1", "points": 2, "text": "Users reach the app through a load balancer", "rule": {"path": ["client", "load-balancer", ["vm", "service"]]}},
    {"id": "r2", "points": 2, "text": "The database is not in a public subnet", "rule": {"placement": {"role": "relational-db", "notIn": {"kind": "subnet", "access": "public"}}}},
    {"id": "r3", "points": 1, "text": "The app runs in at least two failure zones", "rule": {"spread": {"roles": ["vm", "service"], "zoneKind": "zone", "min": 2}}},
    {"id": "r4", "points": 1, "text": "Users never talk to the database directly", "rule": {"noEdge": {"from": "client", "to": "relational-db"}}}]}

if not SERVER.exists():
    sys.exit("Build the checker first: in apps/checker, node build.mjs")

proc, port = start()
try:
    status, body = call(port, "/v1/health")
    check("health answers with the engine version", status == 200 and body.get("ok") and body.get("engine"), json.dumps(body))
    status, body = call(port, "/v1/check", {"diagram": SHOP, "ruleset": RULES})
    passes = [(r["id"], r["pass"]) for r in (body or {}).get("results", [])]
    check("a shop diagram is scored by the rules (r3 needs failure zones)", status == 200 and body["score"] == 5 and body["max"] == 6 and passes == [("r1", True), ("r2", True), ("r3", False), ("r4", True)], json.dumps(passes))
    status, body = call(port, "/v1/check", {"diagram": json.dumps(SHOP), "ruleset": RULES})
    check("the diagram may also be sent as its text", status == 200 and body["score"] == 5)
    status, _ = call(port, "/v1/check", {"diagram": SHOP, "ruleset": RULES}, key="wrong-key-0123456789abcdefghij")
    check("a wrong key is refused", status == 401)
    status, _ = call(port, "/v1/check", {"diagram": SHOP, "ruleset": RULES}, ctype="text/plain")
    check("a body that is not JSON is refused", status == 415)
    status, _ = call(port, "/v1/check", b'{"diagram": "' + b"x" * 600_000 + b'", "ruleset": {}}')
    check("a body over the limit is refused", status == 413)

    # A diagram built to make the path search explode: 8 layers of 7 services, every block linked to the next layer.
    nodes = [{"id": f"n{l}_{i}", "role": "service", "label": f"s{l}{i}", "x": l * 3, "y": i * 3} for l in range(8) for i in range(7)]
    edges = [{"id": f"e{l}_{i}_{j}", "from": f"n{l}_{i}", "to": f"n{l + 1}_{j}", "kind": "request"} for l in range(7) for i in range(7) for j in range(7)]
    hard = {"format": "archboard", "version": 1, "title": "tangle", "show": "generic", "zones": [], "nodes": nodes, "edges": edges}
    hard_rules = {"format": "archboard-rules", "version": 1, "rules": [{"id": "p", "points": 1, "text": "x", "rule": {"path": ["service"] * 7 + ["queue"]}}]}
    t = time.time()
    status, body = call(port, "/v1/check", {"diagram": hard, "ruleset": hard_rules})
    check("a diagram built to make the search explode is answered fast", status == 200 and body["score"] == 0 and time.time() - t < 2, f"{(time.time() - t) * 1000:.0f} ms")

    # A class handing in at once: 40 checks together, each its own worker, at most 4 at a time.
    t = time.time()
    with ThreadPoolExecutor(40) as ex:
        many = list(ex.map(lambda _: call(port, "/v1/check", {"diagram": SHOP, "ruleset": RULES}), range(40)))
    check("40 checks at once all get their score", all(s == 200 and b["score"] == 5 for s, b in many), f"{time.time() - t:.1f} s for 40")
finally:
    proc.terminate()
    proc.wait(timeout=10)
    out = read_log(proc)

lines = [json.loads(l) for l in out.splitlines() if l.startswith("{")]
check("the log has no diagram, ruleset or key in it", lines and not any(w in out for w in ("orders-db", "Users reach", SECRET)), f"{len(lines)} lines")

proc, port = start(ARCHBOARD_TIMEOUT_MS="1")
try:
    status, body = call(port, "/v1/check", {"diagram": SHOP, "ruleset": RULES})
    check("a check over its time limit is stopped (503), never scored", status == 503 and body.get("error") == "unavailable", json.dumps(body))
finally:
    proc.terminate()
    proc.wait(timeout=10)

print(f"\n{sum(results)} of {len(results)} checks passed")
sys.exit(0 if all(results) else 1)
