"""A stand-in host for learning mode (SPEC section 8), with the server side a real host needs: it keeps the challenge's rules
and the checker key, and scores a handed-in diagram through the checker service. Used by tools/check_learn.py.

  python -I tools/learn-host/server.py <port> <challenge id> <checker url> <checker key>

GET  /                  the host page (page.html)
GET  /challenge         what the browser may see: brief, starting diagram, rules (never the solution)
POST /hand-in {diagram} scored by the checker with the server's own copy of the rules; anything else in the body is ignored
GET  /handed-in         what this server stored and scored (for the check)
"""
import json
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
PORT, CHALLENGE, CHECKER, KEY = int(sys.argv[1]), sys.argv[2], sys.argv[3].rstrip("/"), sys.argv[4]
C = json.loads((ROOT / "challenges" / f"{CHALLENGE}.json").read_text(encoding="utf-8"))
RULES = C["rules"]  # the server's copy: the one that scores
handed_in = []


class Host(BaseHTTPRequestHandler):
    def send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path in ("/", "/page.html") or self.path.startswith("/?"):
            return self.send(200, (HERE / "page.html").read_bytes(), "text/html; charset=utf-8")
        if self.path == "/challenge":
            return self.send(200, {"brief": C["brief"], "start": C["start"], "rules": C["rules"]})
        if self.path == "/handed-in":
            return self.send(200, handed_in)
        return self.send(404, {"error": "not-found"})

    def do_POST(self):
        if self.path != "/hand-in":
            return self.send(404, {"error": "not-found"})
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))) or b"{}")
        # Only the diagram is taken from the browser. A score or rules it sends are never used.
        req = urllib.request.Request(f"{CHECKER}/v1/check", data=json.dumps({"diagram": body.get("diagram"), "ruleset": RULES}).encode(), method="POST",
                                     headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                result = json.loads(r.read())
        except urllib.error.HTTPError as e:
            return self.send(502, {"error": "checker", "status": e.code})
        handed_in.append({"ignored": sorted(k for k in body if k != "diagram"), "score": result["score"], "max": result["max"], "nodes": len((body.get("diagram") or {}).get("nodes", []))})
        return self.send(200, {"score": result["score"], "max": result["max"], "results": result["results"], "engine": result.get("engine")})

    def log_message(self, *args):
        pass


ThreadingHTTPServer(("127.0.0.1", PORT), Host).serve_forever()
