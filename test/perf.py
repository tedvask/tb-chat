"""CPU and memory of a scripted session. usage: perf.py <workdir> <with|without>"""
import glob, os, sys, time
sys.path.insert(0, "test")
from h import *
W, mode = sys.argv[1], sys.argv[2]
tb = TB()
tb.parse_folders()
if mode == "with":
    tb.install(glob.glob("dist/*.xpi")[0])
time.sleep(2)
PID = int(open(W + "/tb.pid").read())
HZ = os.sysconf("SC_CLK_TCK")
def kids():
    out = {}
    for d in os.listdir("/proc"):
        if d.isdigit():
            try:
                st = open(f"/proc/{d}/stat").read().rsplit(")", 1)[1].split()
                if int(st[1]) == PID: out[open(f"/proc/{d}/comm").read().strip()] = int(d)
            except OSError: pass
    return out
def cpu(pid, tid=None):
    st = open(f"/proc/{pid}/task/{tid}/stat" if tid else f"/proc/{pid}/stat").read().rsplit(")", 1)[1].split()
    return (int(st[11]) + int(st[12])) / HZ
def mem(pid):
    d = dict(l.split(":") for l in open(f"/proc/{pid}/smaps_rollup").read().splitlines()[1:])
    return (int(d["Private_Clean"].split()[0]) + int(d["Private_Dirty"].split()[0])) // 1024
ext = kids().get("WebExtensions")
def snap(): return (time.time(), cpu(PID, PID), cpu(PID), cpu(ext) if ext else 0.0)
def phase(name, fn):
    a = snap(); fn(); b = snap()
    print("%-44s wall %5.1fs | main thread %5.2fs | parent all threads %5.2fs | add-on process %5.2fs" % (name, b[0]-a[0], b[1]-a[1], b[2]-a[2], b[3]-a[3]))
tb.open_folder(INBOX, threaded=True)
tb.js("""Services.prefs.setBoolPref("mail.operate_on_msgs_in_collapsed_threads", false);
  for (const h of pane.gFolder.messages) h.markRead(true);
  pane.gDBView.doCommand(Ci.nsMsgViewCommandType.collapseAll); await sleep(800);""")
SEL = """const ix = id => pane.gDBView.findIndexOfMsgHdr(pane.gFolder.msgDatabase.getMsgHdrForMessageID(id), false);"""
def opens():
    tb.js(SEL + """for (let k = 0; k < 10; k++) { pane.threadTree.selectedIndex = ix("e0@agents.example"); await sleep(1500); pane.threadTree.selectedIndex = ix("a1@example.test"); await sleep(1000); }""", timeout=120000)
def scroll():
    tb.js(SEL + """pane.threadTree.selectedIndex = ix("e0@agents.example"); await sleep(1500);
      const win = msgBrowser().contentWindow; win.scrollTo(0, 0); await sleep(300);
      for (let k = 0; k < 60; k++) { win.scrollBy(0, win.innerHeight * 0.9); await sleep(120); }""", timeout=120000)
def idle():
    time.sleep(30)
phase("open the 120-message thread 10x (+10 small)", opens)
phase("scroll through it (60 screens)", scroll)
phase("30 s idle, conversation on screen", idle)
print("memory, private MB: parent %d | add-on process %s" % (mem(PID), mem(ext) if ext else "-"))
if mode == "with":
    print("add-on's own JS/DOM memory by Thunderbird's memory reporters:", tb.js("""
      const host = WebExtensionPolicy.getByID(arguments[0]).mozExtensionHostname;
      const mgr = Cc["@mozilla.org/memory-reporter-manager;1"].getService(Ci.nsIMemoryReporterManager);
      let total = 0; const by = {};
      await new Promise(res => mgr.getReports((proc, path, kind, units, amount) => {
        if (units == 0 && path.startsWith("explicit/") && path.includes(host)) { total += amount; const k = proc.includes("extension") || proc.includes("WebExtensions") ? "add-on process" : "main process"; by[k] = (by[k] || 0) + amount; } }, null, res, null, false));
      for (const k in by) by[k] = (by[k] / 1048576).toFixed(1) + " MB";
      return by;""", ADDON_ID, timeout=120000))
    print("rows with text loaded:", tb.js("""return [chatRoot().querySelectorAll(".row").length, [...chatRoot().querySelectorAll(".row")].filter(r => !r.querySelector(".text.loading")).length];"""))
