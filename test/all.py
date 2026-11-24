"""Regression run against a fresh test profile: python3 test/all.py <workdir>"""
import glob, shutil, sys, time
sys.path.insert(0, "test")
from h import *
W = sys.argv[1]
tb = TB()
ok = True
def check(name, cond, detail=""):
    global ok
    ok &= bool(cond)
    print(("PASS " if cond else "FAIL ") + name + (("  -- " + str(detail)) if detail and not cond else ""))

tb.parse_folders()
tb.install(glob.glob("dist/*.xpi")[0]); time.sleep(1.5)
tb.open_folder(INBOX)

tb.select("n1@shop.example"); time.sleep(1.5)
check("single HTML newsletter stays native", tb.chat(wait=False) is None and "Скидки" in tb.native()["text"])
tb.select("x1@other.example"); time.sleep(1.5)
check("same subject, unrelated References: not merged", tb.chat(wait=False) is None)

tb.select("a4@example.test")
c = tb.chat()
tb.js("""msgBrowser().contentWindow.scrollTo(0, 1e7); await sleep(900);""")  # text is loaded for what is on screen
c = tb.chat()
texts = [r["text"] for r in c["rows"]] if c else []
check("HTML mails shown as HTML, plain ones as text", c and [r["html"] for r in c["rows"]] == [False, False, True, True, False], c and [r["html"] for r in c["rows"]])
check("thread of 5 from Inbox + Sent", c and len(c["rows"]) == 5, c)
check("quotes, attributions and signatures removed", texts == [
    "Пётр, добрый день!\nКогда сможете подтвердить поставку? Нам нужно 12 стоек и два коммутатора.\nПодробности тут: https://example.test/order/4412\nС уважением,\nАнна",
    "Анна, здравствуйте.\nПодтверждаю, отгрузим в четверг.",
    "Отлично, спасибо! Добавила Бориса — он примет груз на складе.",
    "Hi all,\nThe dock is free on Thursday after 14:00. Waybill template attached.\nBoris",
    "Борис, принято: приедем в четверг к 14:30.\nМашина одна, номер пришлю утром."], texts)
check("own messages on the right", [("mine" in r["cls"]) for r in c["rows"]] == [False, True, False, False, True])
check("attachment chip", c["rows"][3]["atts"] == ["📎 waybill-template.pdf 2.9 KB"], c["rows"][3]["atts"])
check("reply-all recipients", c["to"] == "Reply to: Анна Петрова, Boris Smith", c["to"])
check("no 'search older' link when nothing is missing", tb.js("return chatRoot().querySelector('.bar .link').hidden;"))
time.sleep(2.5)
check("shown messages get marked read", not any(r["unread"] for r in tb.chat()["rows"]))

before = tb.js("return pane.gFolder.getTotalMessages(false);")
tb.js("""msgBrowser().focus(); chatRoot().querySelector("textarea").focus();""")
tb.m.cmd("WebDriver:PerformActions", {"actions": [{"type": "key", "id": "kb", "actions": sum(([{"type": "keyDown", "value": ch}, {"type": "keyUp", "value": ch}] for ch in "ajm r1"), [])}]})
time.sleep(0.8)
check("typing does not trigger Thunderbird shortcuts", tb.chat(wait=False)["input"] == "ajm r1" and tb.js("return pane.gFolder.getTotalMessages(false);") == before)
tb.js("""const ta = chatRoot().querySelector("textarea"); ta.value = ""; ta.dispatchEvent(new Event("input"));""")

tb.js("""chatRoot().querySelector(".bar .btn.small").click(); await sleep(300);""")
n = tb.native()
check("'Original message' shows the untouched mail", not n["chatOn"] and n["text"].startswith("Hi all,"))
tb.js("""chatRoot().querySelector(".bar .btn.small").click(); await sleep(300);""")
check("and back to chat", tb.native()["chatOn"])

# live arrival over POP3
tb.js("""
  const li = Cc["@mozilla.org/login-manager/loginInfo;1"].createInstance(Ci.nsILoginInfo);
  li.init("mailbox://127.0.0.1", null, "mailbox://127.0.0.1", "me", "secret", "", "");
  try { await Services.logins.addLoginAsync(li); } catch (e) {}
""")
shutil.copy(W + "/spool-hold/a6.eml", W + "/spool/a6.eml")
t0 = time.time()
tb.js("""const server = MailServices.accounts.getAccount("account1").incomingServer;
  server.getNewMessages(server.rootFolder.getFolderWithFlags(Ci.nsMsgFolderFlags.Inbox), top.msgWindow, null);""")
for i in range(100):
    c = tb.chat(wait=False)
    if c and len(c["rows"]) == 6: break
    time.sleep(0.1)
took = time.time() - t0
pill = tb.js("""const p = chatRoot().querySelector(".jump"); const shown = !p.hidden && p.classList.contains("new"); if (shown) p.click(); await sleep(500); return shown;""")
c = tb.chat()
check("new mail appears in the open chat by itself (%.1fs)" % took,
      c and len(c["rows"]) == 6 and c["rows"][-1]["text"] == "Коллеги, груз получен, всё в порядке. Спасибо!", c and c["rows"][-1])
check("reader was not at the end: 'new message' button instead of a jump", pill and c["rows"][-1]["visible"], pill)
check("selection in the message list untouched", tb.js("return pane.gDBView.hdrForFirstSelectedMessage.messageId;") == "a4@example.test")

# quick reply
tb.js("""const root = chatRoot(); const ta = root.querySelector("textarea");
  ta.value = "Спасибо, закрываем заказ.\\nДо связи!"; ta.dispatchEvent(new Event("input")); root.querySelector(".btn.send").click();""")
t0 = time.time()
for i in range(150):
    c = tb.chat(wait=False)
    if c and len(c["rows"]) == 7: break
    time.sleep(0.1)
check("reply shows up in the chat (%.1fs)" % (time.time() - t0), c and len(c["rows"]) == 7 and "mine" in c["rows"][-1]["cls"] and c["rows"][-1]["text"] == "Спасибо, закрываем заказ.\nДо связи!" and c["input"] == "" and c["err"] == "", c)
out = sorted(glob.glob(W + "/out/*.eml"))
raw = open(out[-1], "rb").read().decode("utf-8", "replace").replace("\r\n ", " ") if out else ""
check("exactly one mail sent, to both participants", len(out) == 1 and "X-Test-Rcpt: <anna@example.test>, <boris@corp.example>" in raw, raw[:200])
check("sent from the account the conversation is in", "From: Peter Test <me@example.test>" in raw and c["from"] == "me@example.test", (c["from"], [l for l in raw.split("\r\n") if l.startswith("From:")]))
check("threading headers set", "In-Reply-To: <a6@example.test>" in raw and "<a5@example.test> <a6@example.test>" in raw)
import base64, re as _re
def decoded(raw):
    """The message with base64 text parts decoded, so the body can be searched."""
    out = raw
    for block in _re.findall(r"Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)", raw):
        try: out += "\n" + base64.b64decode(block).decode("utf-8", "replace")
        except Exception: pass
    return out
body = decoded(raw)
check("quick reply carries the text and the signature, not the quoted message",
      "Спасибо, закрываем заказ." in body and "До связи!" in body and "Peter Test, signature" in body and "груз получен" not in body and "wrote:" not in body and len(raw) < 3000,
      (len(raw), [k for k in ("Спасибо, закрываем заказ.", "Peter Test, signature", "груз получен", "wrote:") if k in body]))
time.sleep(4)
c = tb.chat(wait=False)
check("local copy replaced by the one from Sent, no duplicate", c and len(c["rows"]) == 7 and "local" not in c["rows"][-1]["cls"], c and c["rows"][-1])
check("compose window closed", tb.js("return [...Services.wm.getEnumerator(null)].length;") == 1)

# the incoming mail names the other account's address first, the other account is the default one
tb.select("g3@agents.example")
c = tb.chat()
check("sender: this account's address, although the mail was also sent to the other one", c and len(c["rows"]) == 3 and c["from"] == "me@example.test", c and (len(c["rows"]), c["from"]))
def quick_reply(text):
    n = len(glob.glob(W + "/out/*.eml"))
    tb.js("""const root = chatRoot(); const ta = root.querySelector("textarea"); ta.value = arguments[0]; ta.dispatchEvent(new Event("input")); root.querySelector(".btn.send").click();""", text)
    for i in range(150):
        out = sorted(glob.glob(W + "/out/*.eml"))
        if len(out) > n: break
        time.sleep(0.1)
    time.sleep(1.5)
    return open(out[-1], "rb").read().decode("utf-8", "replace").replace("\r\n ", " ") if len(out) > n else ""
raw = quick_reply("Жду.")
check("sender: quick reply leaves from it", "From: Peter Test <me@example.test>" in raw and "X-Test-Rcpt: <bot@agents.example>" in raw, [l for l in raw.split("\r\n") if l.startswith(("From:", "X-Test", "To:", "Cc:"))])
tb.js("""const f = chatRoot().querySelector(".from"); f.value = [...f.options].find(o => o.textContent == "me2@work.example").value; f.dispatchEvent(new Event("change")); await sleep(300);""")
raw = quick_reply("А это с рабочего.")
check("sender: the 'From' box overrides it", "From: Peter Work <me2@work.example>" in raw, [l for l in raw.split("\r\n") if l.startswith("From:")])
check("compose windows closed", tb.js("return [...Services.wm.getEnumerator(null)].length;") == 1)

# "Open in standard view" on a bubble: a tab with the plain message
tb.select("a4@example.test"); tb.chat()
r = tb.js("""
  const before = tabmail.tabInfo.length;
  chatRoot().querySelectorAll(".row")[2].querySelector(".meta .link").click();
  await until(() => tabmail.tabInfo.length > before, 5000); await sleep(1800);
  const tab = tabmail.currentTabInfo; const b = tab.chromeBrowser.contentWindow.getMessagePaneBrowser(); const doc = b.contentDocument;
  const out = { mode: tab.mode.name, chatOn: doc.documentElement.classList.contains("tb-chat-on"), text: doc.body.innerText.trim().slice(0, 30) };
  tabmail.closeTab(tab); await sleep(300);
  return out;""")
check("'Open in standard view' shows the plain message in a tab", r["mode"] == "mailMessageTab" and not r["chatOn"] and r["text"].startswith("Отлично, спасибо"), r)

# a reply written between the quotes
tb.select("i1@agents.example")
c = tb.chat()
r = tb.js("""const inner = [...chatRoot().querySelectorAll(".row")].at(-1).querySelector(".html").openOrClosedShadowRoot;
  const quotes = [...inner.querySelectorAll("blockquote")];
  return { quotes: quotes.length, folded: quotes.map(q => q.classList.contains("folded")), header: !!inner.querySelector(".moz-cite-prefix, #rwhHeaders, .moz-signature"),
           styled: quotes.map(q => q.hasAttribute("style")), border: inner.ownerDocument.defaultView.getComputedStyle(quotes[0]).borderLeftWidth,
           firstHeight: Math.round(quotes[0].getBoundingClientRect().height), text: inner.querySelector(".m").innerText.replace(/\\s+/g, " ").trim() };""")
check("inline reply: comments kept, even one ending with a colon; last quote and header box gone",
      c and len(c["rows"]) == 2 and "А сколько это займёт времени:" in r["text"] and "Здесь согласен." in r["text"] and "остаток исходного" not in r["text"] and not r["header"] and "Subject:" not in r["text"], r)
check("inline reply: quotes look like quotes, the long one folded to its last lines", r["quotes"] == 2 and r["folded"] == [True, False] and r["styled"] == [False, False] and r["border"] == "3px" and r["firstHeight"] < 80, r)
r2 = tb.js("""const inner = [...chatRoot().querySelectorAll(".row")].at(-1).querySelector(".html").openOrClosedShadowRoot;
  inner.querySelector(".qmore").click(); await sleep(200); const q = inner.querySelector("blockquote");
  return [q.classList.contains("folded"), Math.round(q.getBoundingClientRect().height), !!inner.querySelector(".qmore")];""")
check("inline reply: 'show the whole quote' unfolds it", r2[0] is False and r2[1] > 120 and not r2[2], r2)

# collapsed thread
tb.open_folder(INBOX, threaded=True)
r = tb.js("""
  pane.gDBView.doCommand(Ci.nsMsgViewCommandType.collapseAll); await sleep(200);
  const idx = pane.gDBView.findIndexOfMsgHdr(pane.gFolder.msgDatabase.getMsgHdrForMessageID("c1@example.test"), false);
  pane.threadTree.selectedIndex = idx; const n = pane.gDBView.numSelected; await sleep(1500);
  return [n, pane.gDBView.numSelected, pane.gDBView.hdrForFirstSelectedMessage.messageId];""")
c = tb.chat()
check("click on a collapsed thread opens it as chat", r == [2, 1, "c1@example.test"] and c and len(c["rows"]) == 3, (r, c))

# the long bot conversation: "[EXT]" in front of "RE:", 120 messages, last ones unread
t0 = time.time()
r = tb.js("""
  const idx = pane.gDBView.findIndexOfMsgHdr(pane.gFolder.msgDatabase.getMsgHdrForMessageID("e0@agents.example"), false);
  const rows = pane.gDBView.rowCount, first = pane.threadTree.getFirstVisibleIndex();
  pane.threadTree.selectedIndex = idx; const n = pane.gDBView.numSelected;
  await until(() => pane.gDBView.numSelected == 1, 5000);
  return [n, pane.gDBView.hdrForFirstSelectedMessage.messageId, idx == pane.threadTree.selectedIndex];""")
c = tb.chat()
took = time.time() - t0
check("long thread: click selects its first message, the list does not jump", r[1] == "e0@agents.example" and r[2] and r[0] > 100, r)
check("long thread: all 120 messages, mine from Sent included (%.1fs)" % took,
      c and len(c["rows"]) == 120 and sum("mine" in x["cls"] for x in c["rows"]) == 13 and c["count"].endswith(" 120"), c and (len(c["rows"]), c["count"]))
check("long thread: opens at the first unread message", c and 0 <= c["rows"][95]["top"] < 140 and not c["rows"][-1]["visible"], c and (c["rows"][95]["top"], c["rows"][-1]["top"], c["scroll"]))
loaded = sum(x["loaded"] for x in c["rows"]) if c else 0
check("long thread: bodies loaded only around the visible part (%d of 120)" % loaded, 3 <= loaded < 60, loaded)
check("long thread: quote and 'wrote:' line trimmed from HTML", c and c["rows"][96]["text"] == "Алерт 96: цена 1096 ₽, подробности здесь.", c and repr(c["rows"][96]["text"]))
tb.js("""msgBrowser().contentWindow.scrollTo(0, 0); await sleep(1200);""")
c2 = tb.chat()
check("long thread: scrolling up loads earlier messages", c2 and c2["rows"][0]["loaded"] and c2["rows"][0]["text"].startswith("Алерт 0"), c2 and c2["rows"][0])
r = tb.js("""
  const rows = [...chatRoot().querySelectorAll(".row")]; rows[115].scrollIntoView({ block: "center" }); await sleep(1200);
  const big = !!rows[115].querySelector(".big"); const before = rows[115].querySelector(".text").textContent.length;
  rows[115].querySelector(".text .link").click(); await sleep(2500);
  return { big, before, after: rows[115].querySelector(".text").textContent.length, chip: rows[115].querySelectorAll(".att").length };""")
check("large message: text only on request, then loads", r["big"] and r["before"] < 200 and r["after"] > 500 and r["chip"] == 1, r)
r = tb.js("""
  const jump = chatRoot().querySelector(".jump"); const shownAtTop = !jump.hidden;
  jump.click(); await sleep(900);
  const rows = [...chatRoot().querySelectorAll(".row")]; const top = Math.round(rows.at(-1).getBoundingClientRect().top);
  return { shownAtTop, lastTop: top, hiddenAfter: jump.hidden, lastLoaded: !rows.at(-1).querySelector(".text.loading") };""")
check("arrow: shown while the latest message is below, jumps to its start", r["shownAtTop"] and 0 <= r["lastTop"] < 140 and r["hiddenAfter"] and r["lastLoaded"], r)
tb.js("""pane.gDBView.doCommand(Ci.nsMsgViewCommandType.collapseAll); await sleep(300);""")

# rich HTML
tb.open_folder(INBOX)
tb.bg("window.__opened = []; browser.windows.openDefaultBrowser = async url => { window.__opened.push(url); };")
tb.select("h1@example.test")
c = tb.chat()
info = tb.js("""
  const root = chatRoot(); const box = root.querySelector(".row .html"); const inner = box.openOrClosedShadowRoot;
  const win = msgBrowser().contentWindow;
  const imgs = [...inner.querySelectorAll("img")].map(i => (i.getAttribute("src") || "").slice(0, 22));
  const link = inner.querySelector("a[href^='https://example.test/report']");
  link.click(); await sleep(400);
  return { table: !!inner.querySelector("table"), bold: !!inner.querySelector("b"), script: !!inner.querySelector("script"), iframe: !!inner.querySelector("iframe"),
           onclick: !!inner.querySelector("[onclick]"), jsLink: [...inner.querySelectorAll("a")].some(a => /javascript/i.test(a.getAttribute("href") || "")),
           imgs, pwned: win.wrappedJSObject.pwned ?? null,
           cellBg: win.getComputedStyle(inner.querySelector("td")).backgroundColor, uiColor: win.getComputedStyle(root.querySelector(".count")).color,
           paneUrl: msgBrowser().currentURI.scheme };""")
check("rich HTML: table, bold and link kept", c and len(c["rows"]) == 2 and c["rows"][0]["html"] and info["table"] and info["bold"], (c and len(c["rows"]), info))
check("rich HTML: script, iframe, onclick and javascript: link removed", not (info["script"] or info["iframe"] or info["onclick"] or info["jsLink"]) and info["pwned"] is None, info)
check("rich HTML: picture from the mail shown, attachment chip not duplicated", info["imgs"][0].startswith("data:image/png;base64") and c["rows"][0]["atts"] == [], (info["imgs"], c and c["rows"][0]["atts"]))
check("rich HTML: the mail's CSS stays inside its bubble", info["cellBg"] == "rgb(255, 238, 204)" and info["uiColor"] != "rgb(255, 0, 0)" and c["rows"][0]["paper"], info)
check("link opens in the browser, the message pane stays", tb.bg("return window.__opened;") == ["https://example.test/report?q=3"] and info["paneUrl"] == "mailbox", (tb.bg("return window.__opened;"), info["paneUrl"]))
r = tb.js("""
  pane.gViewWrapper.showUnthreaded = true; await sleep(300);
  const ix = id => pane.gDBView.findIndexOfMsgHdr(pane.gFolder.msgDatabase.getMsgHdrForMessageID(id), false);
  pane.threadTree.selectedIndices = [ix("n1@shop.example"), ix("x1@other.example")]; await sleep(1200);
  return pane.gDBView.numSelected;""")
check("multi-selection of unrelated messages left alone", r == 2, r)
# With Thunderbird's "act on the whole collapsed thread" preference off, a collapsed thread stays collapsed
tb.open_folder(INBOX, threaded=True)
r = tb.js("""
  Services.prefs.setBoolPref("mail.operate_on_msgs_in_collapsed_threads", false);
  pane.threadTree.selectedIndex = -1; await sleep(200);
  pane.gDBView.doCommand(Ci.nsMsgViewCommandType.collapseAll); await sleep(400);
  const rows = pane.gDBView.rowCount;
  const ix = id => pane.gDBView.findIndexOfMsgHdr(pane.gFolder.msgDatabase.getMsgHdrForMessageID(id), false);
  pane.threadTree.selectedIndex = ix("e0@agents.example"); await sleep(1500);
  const out = { rows, after: pane.gDBView.rowCount, chat1: chatRoot()?.querySelectorAll(".row").length || 0 };
  pane.threadTree.selectedIndex = ix("c1@example.test"); await sleep(1500);
  out.after2 = pane.gDBView.rowCount; out.chat2 = chatRoot()?.querySelectorAll(".row").length || 0;
  Services.prefs.clearUserPref("mail.operate_on_msgs_in_collapsed_threads");
  return out;""")
c = tb.chat()
check("preference off: threads stay collapsed, each click shows its chat", r["after"] == r["rows"] == r["after2"] and r["chat1"] >= 120 and r["chat2"] == 3, r)
d = tb.bg("return { opens: tbChat.diag.opens, scans: tbChat.diag.scans, bodies: tbChat.diag.bodies, big: tbChat.diag.bigSkipped, events: tbChat.diag.events.length };")
check("diagnostics are being recorded", d["opens"] > 5 and d["scans"] > 5 and d["bodies"] > 5 and d["big"] >= 1, d)
print("\nALL PASSED" if ok else "\nSOME FAILED")
