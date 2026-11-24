"""Helpers that drive the test Thunderbird through Marionette (chrome context)."""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mn import Marionette

ADDON_ID = "tb-chat@tedvask.github.io"
INBOX = "mailbox://me@127.0.0.1/Inbox"
SENT = "mailbox://me@127.0.0.1/Sent"

PRELUDE = """
const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
const tabmail = document.getElementById("tabmail");
const pane = tabmail.currentAbout3Pane;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 15000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error("timeout: " + fn); await sleep(50); } };
const msgBrowser = () => pane.messageBrowser.contentWindow.getMessagePaneBrowser();
const chatRoot = () => { const d = msgBrowser().contentDocument; const h = d && d.getElementById("tb-chat-host"); return h ? h.openOrClosedShadowRoot : null; };
"""


class TB:
    def __init__(self, port=2829):
        self.m = Marionette(port=port)
        self.m.chrome()

    def js(self, body, *args, timeout=60000):
        return self.m.js(PRELUDE + body, args, timeout)

    def shot(self, path):
        return self.m.screenshot(path)

    def parse_folders(self):
        return self.js("""
          const out = {};
          for (const a of MailServices.accounts.accounts) for (const f of a.incomingServer.rootFolder.descendants) {
            await new Promise(res => {
              try { f.QueryInterface(Ci.nsIMsgLocalMailFolder).getDatabaseWithReparse({ OnStartRunningUrl() {}, OnStopRunningUrl() { res(); } }, null); res(); }
              catch (e) { if (e.result != Cr.NS_ERROR_NOT_INITIALIZED) res(); }
            });
            out[f.URI] = f.getTotalMessages(false);
          }
          return out;
        """, timeout=300000)

    def install(self, xpi):
        return self.m.install(os.path.abspath(xpi))

    def open_folder(self, uri, threaded=False):
        return self.js("""
          const [uri, threaded] = arguments;
          pane.displayFolder(uri);
          await until(() => pane.gFolder && pane.gFolder.URI == uri && pane.gDBView && pane.dbViewWrapperListener.allMessagesLoaded);
          if (threaded) pane.gViewWrapper.showThreaded = true; else pane.gViewWrapper.showUnthreaded = true;
          pane.gViewWrapper.sort(Ci.nsMsgViewSortType.byDate, Ci.nsMsgViewSortOrder.ascending);
          await sleep(300);
          return pane.gDBView.rowCount;
        """, uri, threaded)

    def select(self, mid, expand=True):
        """Select the message with this Message-ID in the open folder."""
        return self.js("""
          const [mid, expand] = arguments;
          const hdr = pane.gFolder.msgDatabase.getMsgHdrForMessageID(mid);
          if (!hdr) throw new Error("no such message " + mid);
          const idx = pane.gDBView.findIndexOfMsgHdr(hdr, expand);
          pane.threadTree.selectedIndex = idx;
          await sleep(200);
          return { idx, numSelected: pane.gDBView.numSelected, rows: pane.gDBView.rowCount };
        """, mid, expand)

    def chat(self, wait=True, timeout=8000):
        """State of the chat view in the message pane (None when the native view is showing)."""
        return self.js("""
          const [wait, timeout] = arguments;
          const read = () => {
            const b = msgBrowser();
            const doc = b && b.contentDocument;
            if (!doc || !doc.documentElement) return null;
            const root = chatRoot();
            const on = doc.documentElement.classList.contains("tb-chat-on");
            if (!root || !on) return null;
            const win = doc.defaultView;
            const rows = [...root.querySelectorAll(".row")].map(r => {
              const rect = r.getBoundingClientRect();
              const html = r.querySelector(".html");
              const inner = html && html.openOrClosedShadowRoot.querySelector(".m");
              return {
                cls: r.className.replace("row", "").trim(),
                author: r.querySelector(".author").hidden ? "" : r.querySelector(".author").textContent,
                loaded: !r.querySelector(".text.loading"),
                html: !!html,
                paper: !!inner && inner.classList.contains("paper"),
                text: (inner ? inner.innerText : r.querySelector(".text.loading") ? "" : r.querySelector(".text").textContent).replace(/[ \\t\\u00a0]+/g, " ").replace(/\\s*\\n\\s*/g, "\\n").trim(),
                atts: [...r.querySelectorAll(".att")].map(a => a.textContent),
                time: r.querySelector("time").textContent,
                unread: !r.querySelector(".unread").hidden,
                top: Math.round(rect.top), visible: rect.bottom > 0 && rect.top < win.innerHeight,
              };
            });
            if (!rows.length || rows.some(r => r.visible && !r.loaded)) return null;
            return {
              count: root.querySelector(".count").textContent,
              to: root.querySelector(".to").textContent,
              err: root.querySelector(".err").textContent,
              input: root.querySelector("textarea").value,
              from: (() => { const f = root.querySelector(".from"); return f.hidden ? null : f.selectedOptions[0]?.textContent; })(),
              scroll: [Math.round(win.scrollY), doc.documentElement.scrollHeight, win.innerHeight],
              days: [...root.querySelectorAll(".day")].map(d => d.textContent),
              rows,
            };
          };
          if (!wait) return read();
          try { return await until(read, timeout); } catch (e) { return null; }
        """, wait, timeout)

    def native(self):
        """Text of the natively displayed message body (first 200 chars) and whether the chat host exists."""
        return self.js("""
          const b = msgBrowser(); const doc = b && b.contentDocument;
          if (!doc || !doc.body) return null;
          return { remote: b.isRemoteBrowser, url: b.currentURI.spec.slice(0, 80), chatOn: doc.documentElement.classList.contains("tb-chat-on"), host: !!doc.getElementById("tb-chat-host"), text: doc.body.innerText.slice(0, 200) };
        """)

    def console(self, pattern="tb-chat"):
        """Recent console output of the add-on (console.* calls and reported errors)."""
        return self.js("""
          const [pattern] = arguments; const re = new RegExp(pattern);
          const api = Cc["@mozilla.org/consoleAPI-storage;1"].getService(Ci.nsIConsoleAPIStorage).getEvents()
            .map(e => e.level + ": " + [...e.arguments].map(a => { try { return typeof a == "string" ? a : JSON.stringify(a); } catch (x) { return String(a); } }).join(" ") + "  @" + (e.filename || "").split("/").pop() + ":" + e.lineNumber);
          const errs = Services.console.getMessageArray().map(m => String(m.message || m)).filter(s => /moz-extension/.test(s));
          return [...api, ...errs].filter(s => re.test(s)).slice(-25);
        """, pattern)

    def bg(self, code, timeout=60000):
        """Run async JS in the add-on's background page and return its JSON result."""
        r = self.js("""
          const [addonId, code] = arguments;
          const ext = WebExtensionPolicy.getByID(addonId).extension;
          let browser = null;
          for (const view of ext.views) if (view.viewType == "background") browser = view.xulBrowser;
          if (!browser) throw new Error("no background page");
          const mm = browser.messageManager, id = String(Math.random());
          const result = new Promise(res => { const l = m => { if (m.data.id == id) { mm.removeMessageListener("tbchat-res", l); res(m.data); } }; mm.addMessageListener("tbchat-res", l); });
          const src = `(async () => { let out; try { const Cu = Components.utils; const sb = Cu.Sandbox(content, { sandboxPrototype: content, wantXrays: false });
            out = { ok: JSON.stringify(await Cu.evalInSandbox(${JSON.stringify("(async () => {" + code + "})()")}, sb)) }; } catch (e) { out = { err: String(e) }; }
            sendAsyncMessage("tbchat-res", { id: ${JSON.stringify(id)}, ...out }); })();`;
          mm.loadFrameScript("data:text/javascript;charset=utf-8," + encodeURIComponent(src), false);
          return await result;
        """, ADDON_ID, code, timeout=timeout)
        if "err" in r:
            raise RuntimeError(r["err"])
        return json.loads(r["ok"]) if r.get("ok") not in (None, "undefined") else None

def dump(obj):
    print(json.dumps(obj, ensure_ascii=False, indent=1))
