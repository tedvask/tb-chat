"""Tiny POP3 + SMTP servers for the test profile.

POP3 serves every *.eml in SPOOL (and deletes it on DELE); SMTP stores each
accepted message as OUT/<n>.eml. Nothing ever leaves localhost.
"""
import os
import socketserver
import sys
import threading

SPOOL, OUT = sys.argv[1], sys.argv[2]
POP_PORT, SMTP_PORT = int(sys.argv[3]), int(sys.argv[4])


class Pop(socketserver.StreamRequestHandler):
    def w(self, s):
        self.wfile.write(s.encode() + b"\r\n")

    def handle(self):
        files = sorted(f for f in os.listdir(SPOOL) if f.endswith(".eml"))
        data = [open(os.path.join(SPOOL, f), "rb").read().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n") for f in files]
        dele = set()
        self.w("+OK ready")
        for raw in self.rfile:
            parts = raw.decode(errors="replace").strip().split()
            if not parts:
                continue
            c, a = parts[0].upper(), parts[1:]
            if c == "CAPA":
                self.w("+OK"); self.w("USER"); self.w("UIDL"); self.w(".")
            elif c in ("USER", "PASS", "NOOP", "RSET"):
                self.w("+OK")
            elif c == "STAT":
                self.w(f"+OK {len(data)} {sum(map(len, data))}")
            elif c == "LIST":
                self.w("+OK")
                for i, d in enumerate(data, 1):
                    self.w(f"{i} {len(d)}")
                self.w(".")
            elif c == "UIDL":
                self.w("+OK")
                for i, f in enumerate(files, 1):
                    self.w(f"{i} {f}")
                self.w(".")
            elif c == "RETR":
                d = data[int(a[0]) - 1]
                self.w(f"+OK {len(d)} octets")
                for line in d.split(b"\r\n"):
                    self.wfile.write((b"." + line if line.startswith(b".") else line) + b"\r\n")
                self.w(".")
            elif c == "DELE":
                dele.add(int(a[0]) - 1); self.w("+OK")
            elif c == "QUIT":
                for i in dele:
                    os.remove(os.path.join(SPOOL, files[i]))
                self.w("+OK bye")
                return
            else:
                self.w("-ERR unsupported")


class Smtp(socketserver.StreamRequestHandler):
    def w(self, s):
        self.wfile.write(s.encode() + b"\r\n")

    def handle(self):
        self.w("220 localhost ESMTP test")
        rcpt = []
        for raw in self.rfile:
            line = raw.decode(errors="replace").strip()
            u = line.upper()
            if u.startswith(("EHLO", "HELO")):
                self.w("250-localhost"); self.w("250 8BITMIME")
            elif u.startswith("MAIL FROM"):
                rcpt = []; self.w("250 ok")
            elif u.startswith("RCPT TO"):
                rcpt.append(line[8:].strip()); self.w("250 ok")
            elif u == "DATA":
                self.w("354 go")
                body = b""
                for l in self.rfile:
                    if l in (b".\r\n", b".\n"):
                        break
                    body += l[1:] if l.startswith(b"..") else l
                n = len(os.listdir(OUT)) + 1
                with open(os.path.join(OUT, f"{n:03d}.eml"), "wb") as f:
                    f.write(("X-Test-Rcpt: " + ", ".join(rcpt) + "\r\n").encode() + body)
                self.w("250 queued")
            elif u == "QUIT":
                self.w("221 bye"); return
            else:
                self.w("250 ok")


class S(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


threading.Thread(target=S(("127.0.0.1", POP_PORT), Pop).serve_forever, daemon=True).start()
print("fakeservers up", flush=True)
S(("127.0.0.1", SMTP_PORT), Smtp).serve_forever()
