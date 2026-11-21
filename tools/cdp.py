# Copied from labsite/tools/cdp.py (same owner): a tiny Chrome DevTools client with no libraries.
"""A tiny Chrome DevTools client with no libraries: start headless Chrome, open a page, run JavaScript in it, take a screenshot.
Used only to look at the demo server when the browser extension is not connected."""
import base64
import json
import os
import shutil
import socket
import struct
import subprocess
import tempfile
import time
import urllib.request

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
def free_port():
    """A port nobody is using, so a new browser can never attach to an older one (and inherit its stored course or sidebar choice)."""
    import socket
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class Page:
    def __init__(self, url, width=1280, height=900):
        self.profile = tempfile.mkdtemp()
        self.port = free_port()
        self.proc = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={self.port}", f"--user-data-dir={self.profile}", "--no-first-run",
                                      f"--window-size={width},{height}", "--disable-gpu", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(60):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json"))
                page = next(t for t in tabs if t["type"] == "page")
                break
            except Exception:
                time.sleep(0.25)
        else:
            raise RuntimeError("Chrome did not start")
        self.sock = self._connect(page["webSocketDebuggerUrl"])
        self.n = 0
        self.call("Page.enable")
        self.call("Emulation.setDeviceMetricsOverride", width=width, height=height, deviceScaleFactor=1, mobile=False)
        self.goto(url)

    def _connect(self, ws_url):
        host, rest = ws_url[5:].split("/", 1)
        h, p = host.split(":")
        s = socket.create_connection((h, int(p)))
        key = base64.b64encode(os.urandom(16)).decode()
        s.sendall((f"GET /{rest} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += s.recv(4096)
        self.buf = buf.split(b"\r\n\r\n", 1)[1]
        return s

    def _send(self, obj):
        data = json.dumps(obj).encode()
        head = bytearray([0x81])
        n = len(data)
        if n < 126:
            head.append(0x80 | n)
        elif n < 65536:
            head += bytes([0x80 | 126]) + struct.pack(">H", n)
        else:
            head += bytes([0x80 | 127]) + struct.pack(">Q", n)
        mask = os.urandom(4)
        self.sock.sendall(bytes(head) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(1 << 20)
            if not chunk:
                raise RuntimeError("connection closed")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _frame(self):
        msg = b""
        while True:
            b1, b2 = self._read(2)
            n = b2 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read(8))[0]
            payload = self._read(n)
            msg += payload
            if b1 & 0x80:
                return msg

    def tab(self, url, wait=2.5):
        """Open a second tab in the same browser (same profile: same cookies and localStorage) and drive it on its own
        connection. Its close() closes that tab only."""
        tid = self.call("Target.createTarget", url=url)["targetId"]
        for _ in range(40):
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json"))
            t = next((x for x in tabs if x.get("id") == tid and x.get("webSocketDebuggerUrl")), None)
            if t:
                break
            time.sleep(0.25)
        else:
            raise RuntimeError("the second tab did not open")
        other = Page.__new__(Page)
        other.port, other.n, other.profile, other.proc = self.port, 0, None, None
        other.sock = other._connect(t["webSocketDebuggerUrl"])
        other.call("Page.enable")
        time.sleep(wait)
        other._owner, other._tid = self, tid
        return other

    def call(self, method, **params):
        self.n += 1
        mid = self.n
        self._send({"id": mid, "method": method, "params": params})
        while True:
            m = json.loads(self._frame())
            if m.get("id") == mid:
                if "error" in m:
                    raise RuntimeError(m["error"])
                return m["result"]

    def goto(self, url, wait=2.0):
        self.call("Page.navigate", url=url)
        time.sleep(wait)

    def js(self, code):
        r = self.call("Runtime.evaluate", expression=f"(async()=>{{{code}}})()", awaitPromise=True, returnByValue=True)
        if "exceptionDetails" in r:
            raise RuntimeError(r["exceptionDetails"].get("exception", {}).get("description", str(r["exceptionDetails"])))
        return r["result"].get("value")

    def shot(self, path):
        data = self.call("Page.captureScreenshot", format="png")["data"]
        with open(path, "wb") as fh:
            fh.write(base64.b64decode(data))

    def open_nav(self):
        """On a narrow screen the lecturer's sections sit behind the menu button: open them if they are hidden."""
        if self.js('const t=document.querySelector("#teach-menu-toggle"),s=document.querySelector("#teach-sidebar");return !!t&&!!s&&t.offsetParent!==null&&s.offsetParent===null;'):
            self.js('document.querySelector("#teach-menu-toggle").click();')
            for _ in range(40):
                if self.js('return document.querySelector("#teach-sidebar").offsetParent!==null;'):
                    break
                time.sleep(.1)

    def close(self):
        if getattr(self, "_owner", None) is not None:
            try:
                self._owner.call("Target.closeTarget", targetId=self._tid)
                self.sock.close()
            except Exception:
                pass
            return
        try:
            self.proc.terminate()
            self.proc.wait(timeout=10)            # wait for it to exit, or the next page can attach to this Chrome and its remembered course
        except Exception:
            pass
        shutil.rmtree(self.profile, ignore_errors=True)  # delete the temporary Chrome profile, or E:\Temp fills up
