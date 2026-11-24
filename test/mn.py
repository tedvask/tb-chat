"""Minimal Marionette client (no dependencies)."""
import base64
import json
import socket


class Marionette:
    def __init__(self, port=2828, host="127.0.0.1", timeout=120):
        self.sock = socket.create_connection((host, port), timeout=timeout)
        self.buf = b""
        self.mid = 0
        self._recv()  # hello
        self.cmd("WebDriver:NewSession", {"capabilities": {"alwaysMatch": {}}})

    def _recv(self):
        while b":" not in self.buf:
            d = self.sock.recv(65536)
            if not d:
                raise ConnectionError("marionette closed")
            self.buf += d
        n, rest = self.buf.split(b":", 1)
        n = int(n)
        while len(rest) < n:
            d = self.sock.recv(1 << 20)
            if not d:
                raise ConnectionError("marionette closed")
            rest += d
        self.buf = rest[n:]
        return json.loads(rest[:n])

    def cmd(self, name, params=None):
        self.mid += 1
        payload = json.dumps([0, self.mid, name, params or {}])
        self.sock.sendall(f"{len(payload)}:{payload}".encode())
        while True:
            msg = self._recv()
            if isinstance(msg, list) and msg[0] == 1 and msg[1] == self.mid:
                if msg[2]:
                    raise RuntimeError(f"{name}: {msg[2].get('error')}: {msg[2].get('message')}")
                res = msg[3]
                if isinstance(res, dict) and set(res) == {"value"}:
                    return res["value"]
                return res

    def chrome(self):
        self.cmd("Marionette:SetContext", {"value": "chrome"})

    def content(self):
        self.cmd("Marionette:SetContext", {"value": "content"})

    def js(self, script, args=(), timeout=60000):
        """Run async chrome/content JS; script body may use await and must return a JSON value."""
        self.cmd("WebDriver:SetTimeouts", {"script": timeout})
        wrapped = (
            "const __done = arguments[arguments.length - 1];"
            "(async () => {" + script + "})().then(v => __done({ok: v === undefined ? null : v}),"
            " e => __done({err: String(e) + '\\n' + (e && e.stack || '')}));"
        )
        r = self.cmd("WebDriver:ExecuteAsyncScript", {"script": wrapped, "args": list(args), "newSandbox": False, "sandbox": "system"})
        if "err" in r:
            raise RuntimeError(r["err"])
        return r["ok"]

    def screenshot(self, path):
        data = self.cmd("WebDriver:TakeScreenshot", {"full": True})
        with open(path, "wb") as f:
            f.write(base64.b64decode(data))
        return path

    def install(self, path):
        return self.cmd("Addon:Install", {"path": path, "temporary": True})
