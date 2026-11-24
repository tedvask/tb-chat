import { baseSubject, chatText, isForward, parseMessageIds, stripSubjectPrefixes } from "./lib/text.js";
import { prepareHtml } from "./lib/html.js";

const DEFAULTS = { autoOpenThread: true, markRead: true };
let opts = { ...DEFAULTS };
browser.storage.local.get(DEFAULTS).then(v => (opts = v));
browser.storage.onChanged.addListener(changes => {
  for (const [key, change] of Object.entries(changes)) {
    if (key in opts) {
      opts[key] = change.newValue ?? DEFAULTS[key];
    }
  }
});

const DAY = 86400000;
// Thunderbird can only find messages by walking whole folders, and that blocks
// its window while it runs. Messages outside a date range are skipped cheaply,
// so the search stays close to the displayed message unless there is a reason.
const SPAN = 60 * DAY;
const WIDE = 400 * DAY;
const EDGE = 10 * DAY;
const RECENT = 3 * DAY;
const BIG_FOLDER = 10000;
const MAX_FOUND = 600; // per folder and search: each returned message costs Thunderbird ~0.6 ms
const MAX_MEMBERS = 400;
const MAX_TEXT = 20000;
const MAX_HTML = 400000;
const MAX_INLINE_IMAGE = 2 * 1024 * 1024;
// Getting the text of a message makes Thunderbird parse all of it, attachments
// included, on its main thread (about 0.1 s per megabyte): above this size only on request.
const BIG_MESSAGE = 1.5 * 1024 * 1024;
const CACHE_VERSION = 4; // bump when the way bodies are prepared changes
const SKIP_FOLDERS = ["trash", "junk", "drafts", "templates", "outbox"];

const metaCache = new Map(); // message id -> { refs, replyTo } | null (unreadable)
const bodyCache = new Map(); // message id -> body for a bubble
const addrCache = new Map(); // header string -> [{ name, email }]
const drafts = new Map(); // conversation key -> unsent quick-reply text
const outgoing = new Map(); // compose tab id -> details captured right before sending
const localSent = new Map(); // subject key -> replies sent in this session, until their copy shows up in a folder
const seeds = new Map(); // tab id -> messages of the thread that was just clicked
const lastShown = new Map(); // tab id -> { at, message }: the single message Thunderbird last loaded there
const fromChoice = new Map(); // conversation key -> identity the user picked in the "From" box
const sessions = new Set(); // one per open message display

// --- Diagnostics: what the add-on did and how long it took (no mail content) ---

const diag = { since: Date.now(), opens: 0, openMs: 0, scans: 0, scanMs: 0, scanMax: 0, bodies: 0, bodyMs: 0, bodyMax: 0, bodiesFromDisk: 0, bigSkipped: 0, events: [] };
let diagPrevious = null;
let diagTimer = null;
browser.storage.local.get("diag").then(stored => (diagPrevious = stored.diag?.current || null));

function note(kind, ms, extra = "") {
  ms = Math.round(ms);
  diag.events.push([Date.now(), kind, ms, extra]);
  if (diag.events.length > 200) {
    diag.events.shift();
  }
  if (kind === "open") {
    diag.opens++;
    diag.openMs += ms;
  } else if (kind.startsWith("scan")) {
    diag.scans++;
    diag.scanMs += ms;
    diag.scanMax = Math.max(diag.scanMax, ms);
  } else if (kind === "body") {
    diag.bodies++;
    diag.bodyMs += ms;
    diag.bodyMax = Math.max(diag.bodyMax, ms);
  }
  diagTimer ??= setTimeout(() => {
    diagTimer = null;
    browser.storage.local.set({ diag: { current: diag, previous: diagPrevious } });
  }, 15000);
}

// --- Prepared bodies kept between sessions (IndexedDB), so a conversation that
// is opened again costs nothing to show ---

let dbPromise = null;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const open = indexedDB.open("tb-chat", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("bodies", { keyPath: "mid" }).createIndex("at", "at");
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  return dbPromise;
}

async function diskGet(mid) {
  try {
    const store = (await db()).transaction("bodies").objectStore("bodies");
    return await new Promise(resolve => {
      const request = store.get(mid);
      request.onsuccess = () => resolve(request.result?.v === CACHE_VERSION ? request.result.body : null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

function diskPut(mid, body) {
  const size = (body.html?.length || 0) + (body.css?.length || 0) + (body.text?.length || 0) + Object.values(body.images || {}).reduce((n, v) => n + v.length, 0);
  if (size < 600000) {
    db()
      .then(d => d.transaction("bodies", "readwrite").objectStore("bodies").put({ mid, v: CACHE_VERSION, at: Date.now(), body }))
      .catch(() => {});
  }
}

/** Keep the store from growing without end: past 4000 bodies drop the 1000 oldest. */
async function diskPrune() {
  const store = (await db()).transaction("bodies", "readwrite").objectStore("bodies");
  const count = await new Promise(resolve => {
    const request = store.count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(0);
  });
  if (count > 4000) {
    let left = 1000;
    store.index("at").openCursor().onsuccess = event => {
      const cursor = event.target.result;
      if (cursor && left-- > 0) {
        cursor.delete();
        cursor.continue();
      }
    };
  }
}
diskPrune().catch(() => {});

function remember(cache, key, value, limit) {
  cache.set(key, value);
  if (cache.size > limit) {
    cache.delete(cache.keys().next().value);
  }
  return value;
}

async function parseAddrs(value) {
  const list = Array.isArray(value) ? value : [value];
  const out = [];
  for (const str of list) {
    if (!str) {
      continue;
    }
    let parsed = addrCache.get(str);
    if (!parsed) {
      try {
        parsed = await browser.messengerUtilities.parseMailboxString(str);
      } catch {
        parsed = [];
      }
      parsed = parsed.filter(p => p.email).map(p => ({ name: p.name || "", email: p.email }));
      remember(addrCache, str, parsed, 3000);
    }
    out.push(...parsed);
  }
  return out;
}

let identityCache = null;
/** Every identity (sending address) of every account. */
async function myIdentities() {
  if (identityCache && Date.now() - identityCache.at < 60000) {
    return identityCache.list;
  }
  const list = [];
  for (const account of await browser.accounts.list(false)) {
    for (const identity of account.identities || []) {
      if (identity.email) {
        list.push({ id: identity.id, email: identity.email.toLowerCase(), label: identity.email, accountId: account.id });
      }
    }
  }
  identityCache = { at: Date.now(), list };
  return list;
}

async function myEmails() {
  return new Set((await myIdentities()).map(i => i.email));
}

/**
 * Which identity a reply in this conversation is sent from: one of the
 * account the conversation is in - the address last written from, or last
 * written to, whichever is more recent - never another account's.
 */
async function pickIdentity(msg, members) {
  const all = await myIdentities();
  const own = all.filter(i => i.accountId === msg.folder.accountId);
  const pool = own.length ? own : all;
  const byEmail = email => pool.find(i => i.email === email);
  for (const { msg: m } of [...members].reverse()) {
    const author = (await parseAddrs(m.author))[0]?.email.toLowerCase();
    const to = (await parseAddrs([...(m.recipients || []), ...(m.ccList || [])])).map(a => a.email.toLowerCase());
    const hit = byEmail(author) || to.map(byEmail).find(Boolean);
    if (hit) {
      return hit.id;
    }
  }
  return pool[0]?.id;
}

/** The other side(s) of a message: everyone on it except the user's own addresses. */
async function peopleOf(m, me) {
  const all = (await parseAddrs([m.author, ...(m.recipients || []), ...(m.ccList || []), ...(m.bccList || [])])).map(p =>
    p.email.toLowerCase()
  );
  const others = all.filter(e => !me.has(e));
  return others.length ? others : all; // a note to oneself
}

/**
 * Folders to look in for the rest of a conversation: "near" by default, "far"
 * (the other folders of the account) only when asked to search everywhere.
 */
async function threadFolders(msg) {
  const near = [msg.folder.id];
  const far = [];
  const account = await browser.accounts.get(msg.folder.accountId, true);
  const walk = (folder, inherited) => {
    const use = folder.specialUse?.length ? folder.specialUse : inherited;
    if (folder.id !== msg.folder.id && !folder.isVirtual && !folder.isUnified && !folder.isTag) {
      if (use.some(u => u === "sent" || u === "inbox" || u === "archives")) {
        near.push(folder.id);
      } else if (!use.some(u => SKIP_FOLDERS.includes(u))) {
        far.push(folder.id);
      }
    }
    for (const sub of folder.subFolders || []) {
      // Label folders under the inbox are ordinary folders, not part of it.
      walk(sub, use.includes("inbox") ? [] : use);
    }
  };
  for (const folder of account?.rootFolder?.subFolders || account?.folders || []) {
    walk(folder, []);
  }
  return { near, far };
}

const sizeCache = new Map(); // folder id -> { at, count }
async function folderSize(folderId) {
  const cached = sizeCache.get(folderId);
  if (cached && Date.now() - cached.at < 600000) {
    return cached.count;
  }
  let count = 0;
  try {
    count = (await browser.folders.getFolderInfo(folderId)).totalMessageCount || 0;
  } catch {
    // Unknown size: treat as small.
  }
  sizeCache.set(folderId, { at: Date.now(), count });
  return count;
}

async function queryFolder(info) {
  let page = await browser.messages.query({ ...info, messagesPerPage: 200, autoPaginationTimeout: 0 });
  const out = [...page.messages];
  while (page.id) {
    if (out.length >= MAX_FOUND) {
      await browser.messages.abortList(page.id).catch(() => {});
      break;
    }
    page = await browser.messages.continueList(page.id);
    out.push(...page.messages);
  }
  return out;
}

/** References and Reply-To of a message. Reads the message itself, so only used for the displayed one. */
async function metaOf(msg) {
  if (metaCache.has(msg.id)) {
    return metaCache.get(msg.id);
  }
  let meta = null;
  try {
    const h = await browser.messages.getHeaders(msg.id);
    const refs = [...parseMessageIds((h.references || []).join(" ")), ...parseMessageIds((h["in-reply-to"] || []).join(" "))];
    meta = { refs: [...new Set(refs)], replyTo: h["reply-to"] || [] };
  } catch (e) {
    console.warn("tb-chat: cannot read headers of", msg.id, e);
  }
  return remember(metaCache, msg.id, meta, 2000);
}

/**
 * Add those of `cands` that belong to the session's conversation: same subject
 * and either referenced by the displayed message or exchanged with the same
 * people. (Checking each candidate's own References would mean downloading it.)
 */
async function offer(session, cands) {
  const me = await myEmails();
  for (const c of cands) {
    if (c.folder && !session.members.has(c.id) && session.pool.size < 3000 && baseSubject(c.subject) === session.subject) {
      session.pool.set(c.id, c);
    }
  }
  let added = 0;
  for (let round = 0; round < 3; round++) {
    let grew = false;
    for (const [id, c] of [...session.pool]) {
      const who = await peopleOf(c, me);
      if (session.refIds.has(c.headerMessageId) || who.some(e => session.people.has(e))) {
        session.pool.delete(id);
        session.members.set(id, c);
        who.forEach(e => session.people.add(e));
        added++;
        grew = true;
      }
    }
    if (!grew) {
      break;
    }
  }
  return added;
}

/**
 * Look for the conversation in folders, one folder at a time.
 *   "around" - near folders, two months either side of the displayed message
 *   "wide"   - near folders, from about a year before it
 *   "recent" - the given folders, the last few days (something new came in)
 *   "all"    - every folder of the account, any date (slow, on request)
 */
async function scan(session, mode, folders) {
  if (!session.subject) {
    return 0;
  }
  const msg = session.current;
  const { near, far } = await threadFolders(msg);
  session.near = near;
  const range = {};
  if (mode === "around") {
    range.fromDate = new Date(+msg.date - SPAN);
    if (+msg.date + SPAN < Date.now()) {
      range.toDate = new Date(+msg.date + SPAN);
      session.bounded = true;
    }
  } else if (mode === "wide") {
    range.fromDate = new Date(+msg.date - WIDE);
  } else if (mode === "recent") {
    range.fromDate = new Date(Date.now() - RECENT);
  }
  const started = Date.now();
  let added = 0;
  for (const folderId of mode === "all" ? [...near, ...far] : folders || near) {
    if (session.closed) {
      break;
    }
    if (mode === "wide" && (await folderSize(folderId)) > BIG_FOLDER) {
      continue; // a year of a huge folder is a freeze of its own; "search older" still covers it
    }
    try {
      added += await offer(session, await queryFolder({ subject: session.query, folderId, ...range }));
    } catch (e) {
      console.warn("tb-chat: cannot search", folderId, e);
    }
  }
  note(`scan:${mode}`, Date.now() - started, `+${added}`);
  return added;
}

/** Does the displayed message refer to a message that has not been found? */
function isIncomplete(session) {
  if (!session.refIds.size) {
    return false;
  }
  const have = new Set([...session.members.values()].map(m => m.headerMessageId));
  return [...session.refIds].some(id => !have.has(id));
}

/** Is there a reason to look further back (or forward) than the first search did? */
function worthWidening(session) {
  const dates = [...session.members.values()].map(m => +m.date);
  const at = +session.current.date;
  return (
    (isIncomplete(session) && session.members.size <= 3) || // a lone reply to something older
    Math.min(...dates) < at - SPAN + EDGE ||
    (session.bounded && Math.max(...dates) > at + SPAN - EDGE)
  );
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** What a bubble shows for a message: its HTML (cleaned) or its text, plus attachments. */
async function bodyOf(msg, force = false) {
  if (bodyCache.has(msg.id)) {
    return bodyCache.get(msg.id);
  }
  const stored = await diskGet(msg.headerMessageId);
  if (stored) {
    diag.bodiesFromDisk++;
    return remember(bodyCache, msg.id, stored, 80);
  }
  if (msg.size > BIG_MESSAGE && !force) {
    diag.bigSkipped++;
    return { big: true, size: msg.size, text: "", atts: [] };
  }
  const started = performance.now();
  const forward = isForward(msg.subject);
  const body = { text: "", atts: [] };
  let attachments = [];
  try {
    attachments = await browser.messages.listAttachments(msg.id);
  } catch {
    // No attachment list is not worth failing the bubble for.
  }
  const inline = new Set();
  try {
    const parts = await browser.messages.listInlineTextParts(msg.id);
    const html = parts.find(p => p.contentType === "text/html");
    const plain = parts.find(p => p.contentType === "text/plain");
    if (html && html.content.length <= MAX_HTML) {
      const prepared = prepareHtml(html.content, { forward });
      // Pictures that are part of the mail itself (cid:) travel with it as data: URLs.
      for (const cid of prepared.cids) {
        const att = attachments.find(a => (a.headers?.["content-id"] || []).some(v => v.replace(/^<|>$/g, "") === cid));
        if (att && att.size <= MAX_INLINE_IMAGE && /^image\//i.test(att.contentType)) {
          try {
            prepared.images[cid] = await readAsDataUrl(await browser.messages.getAttachmentFile(msg.id, att.partName));
            inline.add(att.partName);
          } catch {
            // Shown as a missing picture.
          }
        }
      }
      body.html = prepared.html;
      body.css = prepared.css;
      body.images = prepared.images;
      body.styled = prepared.styled;
    } else if (html) {
      body.text = chatText(await browser.messengerUtilities.convertToPlainText(html.content), { forward }).slice(0, MAX_TEXT);
      body.cut = true;
    } else if (plain) {
      const text = chatText(plain.content, { forward });
      body.text = text.slice(0, MAX_TEXT);
      body.cut = text.length > MAX_TEXT;
    }
  } catch (e) {
    console.warn("tb-chat: cannot read body of", msg.id, e);
    body.failed = true;
  }
  body.atts = attachments
    .filter(a => !inline.has(a.partName))
    .map(a => ({ name: a.name, size: a.size, partName: a.partName }));
  note("body", performance.now() - started, `${Math.round(msg.size / 1024)} KB`);
  if (body.failed) {
    return body; // a failed read (offline) is worth retrying next time
  }
  diskPut(msg.headerMessageId, body);
  return remember(bodyCache, msg.id, body, 80);
}

function uniqueAddrs(list, exclude = new Set()) {
  const seen = new Set(exclude);
  return list.filter(a => {
    const key = a.email.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

const formatAddr = a => (a.name ? `${a.name} <${a.email}>` : a.email);

/** Who a reply to the newest message goes to (reply-all). */
async function replyTargets(last, me) {
  const author = await parseAddrs(last.author);
  const to = await parseAddrs(last.recipients || []);
  const cc = await parseAddrs(last.ccList || []);
  if (author.some(a => me.has(a.email.toLowerCase()))) {
    return { to: uniqueAddrs(to), cc: uniqueAddrs(cc, new Set(to.map(a => a.email.toLowerCase()))) };
  }
  // Reply-To needs the message itself; use it only if it has been read already.
  const replyTo = await parseAddrs(metaCache.get(last.id)?.replyTo || []);
  const main = uniqueAddrs(replyTo.length ? replyTo : author);
  const taken = new Set([...me, ...main.map(a => a.email.toLowerCase())]);
  return { to: main, cc: uniqueAddrs([...to, ...cc], taken) };
}

function post(session, message) {
  if (session.closed) {
    return;
  }
  try {
    session.port.postMessage(message);
  } catch {
    session.closed = true;
  }
}

/** Send the current state of the conversation to the message display. */
async function render(session) {
  const gen = ++session.gen;
  const msg = session.current;

  // The same message may sit in several folders (labels, a copy to yourself).
  const rank = m => {
    const i = session.near.indexOf(m.folder?.id);
    return m.id === msg.id ? -1 : i < 0 ? session.near.length : i;
  };
  const byMid = new Map();
  for (const m of session.members.values()) {
    const seen = byMid.get(m.headerMessageId);
    if (!seen) {
      byMid.set(m.headerMessageId, { msg: m, copies: [m] });
    } else {
      seen.copies.push(m);
      if (rank(m) < rank(seen.msg)) {
        seen.msg = m;
      }
    }
  }
  let members = [...byMid.values()].sort((a, b) => a.msg.date - b.msg.date);
  const hidden = Math.max(0, members.length - MAX_MEMBERS);
  members = members.slice(hidden);
  session.thread = members;
  const incomplete = !session.searchedAll && isIncomplete(session);

  // Replies sent from here whose copy has not reached a folder yet (Gmail files
  // them on the server, the Sent folder syncs later).
  const locals = (localSent.get(session.subject) || []).filter(l => Date.now() - l.date < DAY && !byMid.has(l.mid));
  if (locals.length) {
    localSent.set(session.subject, locals);
  } else {
    localSent.delete(session.subject);
  }

  if (members.length + locals.length < 2) {
    if (session.state !== "single") {
      session.state = "single";
      post(session, { t: "single" });
    }
    return;
  }

  const me = await myEmails();
  const reply = await replyTargets(members.at(-1).msg, me);
  const identityId = fromChoice.get(session.key) || (await pickIdentity(msg, members));
  if (session.state === null) {
    // First showing: have the text of what will be on screen ready, so the
    // chat appears filled in rather than as a column of "Loading...".
    const isMine = m => me.has((addrCache.get(m.author)?.[0]?.email || "").toLowerCase());
    const unread = members.findIndex(({ msg: m, copies }) => copies.some(c => c.read === false) && !isMine(m));
    const focus = unread >= 0 ? unread : members.length - 1;
    const first = members.slice(Math.max(0, focus - 1), focus + 4).filter(({ msg: m }) => !bodyCache.has(m.id));
    await Promise.race([Promise.all(first.map(({ msg: m }) => bodyOf(m))), new Promise(resolve => setTimeout(resolve, 400))]);
  }
  const items = await Promise.all(
    members.map(async ({ msg: m, copies }) => {
      const from = (await parseAddrs(m.author))[0] || { name: m.author, email: "" };
      return {
        key: m.headerMessageId,
        from,
        mine: me.has(from.email.toLowerCase()),
        date: +m.date,
        unread: copies.some(c => c.read === false),
        current: m.id === msg.id,
        body: bodyCache.get(m.id) || null,
      };
    })
  );
  for (const l of locals) {
    items.push({
      key: `local:${l.mid}`,
      from: l.from,
      mine: true,
      date: l.date,
      unread: false,
      current: false,
      local: true,
      body: { text: l.text, atts: [] },
    });
  }
  const state = JSON.stringify([items.map(i => [i.key, i.unread]), reply, identityId, incomplete, session.searching, hidden]);
  if (gen !== session.gen || state === session.state) {
    return;
  }
  session.state = state;
  session.reply = reply;
  session.identityId = identityId;
  post(session, {
    t: "thread",
    items,
    replyTo: [...reply.to, ...reply.cc].map(a => a.name || a.email),
    from: identityId || "",
    identities: (await myIdentities()).map(i => ({ id: i.id, label: i.label })),
    draft: drafts.get(session.key) || "",
    incomplete,
    searching: !!session.searching,
    hidden,
  });
}

/** Run one job per session at a time, so searches and updates cannot interleave. */
function enqueue(session, job) {
  session.queue = (session.queue || Promise.resolve())
    .then(() => (session.closed ? null : job()))
    .catch(e => console.error("tb-chat:", e));
  return session.queue;
}

/** Several changes in a row (a hundred messages marked read) become one update. */
function scheduleRender(session) {
  clearTimeout(session.renderTimer);
  session.renderTimer = setTimeout(() => enqueue(session, () => render(session)), 150);
}

/** A folder changed: look at its latest messages, a few seconds apart at most. */
function scheduleRecent(session, folderId) {
  session.changed.add(folderId);
  if (session.timer) {
    return;
  }
  const wait = Math.max(1000, 4000 - (Date.now() - session.lastRecent));
  session.timer = setTimeout(() => {
    session.timer = null;
    session.lastRecent = Date.now();
    const folders = [...session.changed];
    session.changed.clear();
    enqueue(session, async () => {
      await scan(session, "recent", folders);
      await render(session);
    });
  }, wait);
}

/** Load the bodies the display asked for, a few at a time, latest request first. */
async function pumpBodies(session) {
  if (session.loading >= 3) {
    return;
  }
  session.loading++;
  while (session.wanted.length && !session.closed) {
    const key = session.wanted.shift();
    const entry = session.thread?.find(e => e.msg.headerMessageId === key);
    if (entry) {
      post(session, { t: "body", key, body: await bodyOf(entry.msg) });
    }
    session.asked.delete(key);
  }
  session.loading--;
}

async function sendReply(session, text) {
  const last = session.thread.at(-1).msg;
  const tab = await browser.compose.beginReply(last.id, "replyToSender", {
    to: session.reply.to.map(formatAddr),
    cc: session.reply.cc.map(formatAddr),
    ...(session.identityId ? { identityId: session.identityId } : {}),
  });
  // If anything fails from here on, the compose window stays open with the text in it.
  const details = await browser.compose.getComposeDetails(tab.id);
  // A chat reply carries the text only: the quoted message (and its "X wrote:"
  // line) that Thunderbird puts into every reply is taken out, the signature stays.
  if (details.isPlainText) {
    const old = details.plainTextBody || "";
    const at = old.lastIndexOf("\n-- \n");
    const signature = at >= 0 && !/^>/m.test(old.slice(at)) ? old.slice(at) : "";
    await browser.compose.setComposeDetails(tab.id, { plainTextBody: text + (signature ? `\n${signature}` : "") });
  } else {
    const doc = new DOMParser().parseFromString(details.body || "", "text/html");
    doc.querySelectorAll(".moz-cite-prefix, #rwhHeaders, blockquote[type='cite']").forEach(n => n.remove());
    const blank = n => (n.nodeType === 3 ? !n.textContent.trim() : n.nodeType !== 1 || n.tagName === "BR" || (!n.textContent.trim() && !n.querySelector("img")));
    while (doc.body.firstChild && blank(doc.body.firstChild)) {
      doc.body.firstChild.remove();
    }
    const lines = text.split("\n").map(line => {
      const div = doc.createElement("div");
      if (line) {
        div.textContent = line;
      } else {
        div.append(doc.createElement("br"));
      }
      return div;
    });
    doc.body.prepend(...lines);
    await browser.compose.setComposeDetails(tab.id, { body: `<!DOCTYPE html>${doc.documentElement.outerHTML}` });
  }
  await browser.compose.sendMessage(tab.id, { mode: "default" });
}

/**
 * The message a tab displays. With mail.operate_on_msgs_in_collapsed_threads
 * off, a click on a collapsed thread displays its first message while the
 * selection is reported as the whole thread: then go by what was loaded.
 */
async function displayedMessage(tabId) {
  const shown = await browser.messageDisplay.getDisplayedMessages(tabId);
  const list = Array.isArray(shown) ? shown : shown?.messages || [];
  if (list.length <= 1) {
    return list[0] || null;
  }
  for (let i = 0; i < 30; i++) {
    const loaded = lastShown.get(tabId);
    if (loaded && Date.now() - loaded.at < 5000 && list.some(m => m.id === loaded.message.id)) {
      return list.find(m => m.id === loaded.message.id);
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return null;
}

async function start(session) {
  if (session.tabType !== "mail") {
    return; // a message opened in its own tab or window is shown the standard way
  }
  const msg = await displayedMessage(session.tabId);
  if (!msg?.folder) {
    return; // several messages, or a message opened from a file
  }
  const me = await myEmails();
  session.current = msg;
  session.subject = baseSubject(msg.subject);
  session.query = stripSubjectPrefixes(msg.subject);
  session.key = `${msg.folder.accountId}|${session.subject}`;
  session.members = new Map([[msg.id, msg]]);
  session.people = new Set(await peopleOf(msg, me));

  // A collapsed thread was clicked: Thunderbird has already told us what is in it.
  const seed = seeds.get(session.tabId);
  seeds.delete(session.tabId);
  if (seed && Date.now() - seed.at < 10000 && seed.messages.some(m => m.id === msg.id)) {
    for (const m of seed.messages) {
      session.members.set(m.id, m);
      (await peopleOf(m, me)).forEach(e => session.people.add(e));
    }
  }
  sessions.add(session);

  const opened = Date.now();
  await enqueue(session, async () => {
    await scan(session, "around");
    await render(session);
    note("open", Date.now() - opened, `${session.members.size} msg`);
    // The message's own References: cheap now (it has just been displayed), and
    // they name earlier messages even if those came from other people.
    const meta = await metaOf(msg);
    if (meta?.refs.length) {
      meta.refs.forEach(id => session.refIds.add(id));
      await offer(session, []);
    }
    if (worthWidening(session)) {
      await scan(session, "wide");
    }
    await render(session);
  });
}

async function onPortMessage(session, m) {
  if (m.t === "hello") {
    await start(session);
  } else if (!session.thread) {
    // Nothing below makes sense before "hello" has been answered.
  } else if (m.t === "need" && m.force) {
    for (const key of m.keys) {
      const entry = session.thread.find(e => e.msg.headerMessageId === key);
      if (entry) {
        post(session, { t: "body", key, body: await bodyOf(entry.msg, true) });
      }
    }
  } else if (m.t === "need") {
    for (const key of m.keys.reverse()) {
      if (!session.asked.has(key)) {
        session.asked.add(key);
        session.wanted.unshift(key);
      }
    }
    for (let i = 0; i < 3; i++) {
      pumpBodies(session).catch(e => console.error("tb-chat:", e));
    }
  } else if (m.t === "searchAll") {
    session.searching = true;
    await enqueue(session, async () => {
      await render(session);
      await scan(session, "all");
      session.searching = false;
      session.searchedAll = true;
      await render(session);
    });
  } else if (m.t === "from") {
    fromChoice.set(session.key, m.identityId);
    session.identityId = m.identityId;
  } else if (m.t === "draft") {
    if (m.text) {
      drafts.set(session.key, m.text);
    } else {
      drafts.delete(session.key);
    }
  } else if (m.t === "seen") {
    if (opts.markRead) {
      for (const { copies } of session.thread) {
        for (const copy of copies) {
          if (copy.read === false) {
            copy.read = true;
            browser.messages.update(copy.id, { read: true }).catch(() => {});
          }
        }
      }
    }
  } else if (m.t === "send") {
    try {
      await sendReply(session, m.text);
      drafts.delete(session.key);
      post(session, { t: "sent" });
    } catch (e) {
      post(session, { t: "sendError", error: String(e?.message || e) });
    }
  } else if (m.t === "compose") {
    await browser.compose.beginReply(session.thread.at(-1).msg.id, "replyToAll", session.identityId ? { identityId: session.identityId } : {});
  } else if (m.t === "link") {
    if (/^https?:\/\//i.test(m.url)) {
      await browser.windows.openDefaultBrowser(m.url);
    } else if (/^mailto:/i.test(m.url)) {
      await browser.compose.beginNew({ to: decodeURIComponent(m.url.slice(7).split("?")[0]) });
    }
  } else if (m.t === "open" || m.t === "attachment") {
    const entry = session.thread.find(e => e.msg.headerMessageId === m.key);
    if (!entry) {
      return;
    }
    if (m.t === "open") {
      await browser.messageDisplay.open({ messageId: entry.msg.id, location: "tab" });
    } else {
      await browser.messages.openAttachment(entry.msg.id, m.partName, session.tabId);
    }
  }
}

browser.runtime.onConnect.addListener(port => {
  if (port.name !== "tb-chat" || port.sender?.tab?.id == null) {
    return;
  }
  const session = {
    port,
    tabId: port.sender.tab.id,
    tabType: port.sender.tab.type,
    gen: 0,
    state: null,
    near: [],
    pool: new Map(), // same subject, not (yet) known to belong
    refIds: new Set(),
    changed: new Set(),
    lastRecent: 0,
    timer: null,
    wanted: [],
    asked: new Set(),
    loading: 0,
  };
  port.onMessage.addListener(m => onPortMessage(session, m).catch(e => console.error("tb-chat:", e)));
  port.onDisconnect.addListener(() => {
    session.closed = true;
    clearTimeout(session.timer);
    clearTimeout(session.renderTimer);
    sessions.delete(session);
  });
});

// For poking around from the add-on's debugging console.
globalThis.tbChat = { sessions, localSent, metaCache, bodyCache, seeds, diag };

// --- Live updates -----------------------------------------------------------

const asArray = list => (Array.isArray(list) ? list : list?.messages || []);

/** Messages that have just appeared somewhere: offer them to the open conversations. */
function arrived(messages) {
  for (const session of sessions) {
    if (messages.some(m => baseSubject(m.subject) === session.subject)) {
      enqueue(session, async () => {
        await offer(session, messages);
        await render(session);
      });
    }
  }
}

function gone(messages) {
  for (const session of sessions) {
    let changed = false;
    for (const m of messages) {
      session.pool.delete(m.id);
      changed = (m.id !== session.current.id && session.members.delete(m.id)) || changed;
    }
    if (changed) {
      scheduleRender(session);
    }
  }
}

browser.messages.onNewMailReceived.addListener((folder, list) => arrived(asArray(list)), true);
browser.messages.onCopied.addListener((from, to) => arrived(asArray(to)));
browser.messages.onMoved.addListener((from, to) => {
  gone(asArray(from));
  arrived(asArray(to));
});
browser.messages.onDeleted.addListener(list => gone(asArray(list)));
browser.messages.onUpdated.addListener(message => {
  for (const session of sessions) {
    if (session.members.has(message.id)) {
      session.members.set(message.id, message);
      if (message.id === session.current.id) {
        session.current = message;
      }
      scheduleRender(session);
    }
  }
});

// Remember what was just sent, so the conversation shows it at once.
browser.compose.onBeforeSend.addListener((tab, details) => {
  outgoing.set(tab.id, details);
});
browser.tabs.onRemoved.addListener(tabId => {
  setTimeout(() => outgoing.delete(tabId), 5000); // a send that was cancelled or failed
  lastShown.delete(tabId);
  seeds.delete(tabId);
});
browser.compose.onAfterSend.addListener(async (tab, info) => {
  const details = outgoing.get(tab.id);
  outgoing.delete(tab.id);
  if (!details || info.error) {
    return;
  }
  const subject = baseSubject(details.subject);
  if (info.headerMessageId) {
    let text = details.plainTextBody || "";
    if (!details.isPlainText && details.body) {
      text = await browser.messengerUtilities.convertToPlainText(prepareHtml(details.body, {}).html);
    }
    const from = (await parseAddrs(details.from))[0] || { name: "", email: "" };
    const list = localSent.get(subject) || [];
    list.push({
      mid: info.headerMessageId.replace(/^<|>$/g, ""),
      date: Date.now(),
      text: chatText(text, { forward: isForward(details.subject) }),
      from,
    });
    localSent.set(subject, list);
  }
  for (const session of sessions) {
    if (session.subject === subject) {
      enqueue(session, async () => {
        await offer(session, info.messages || []);
        await render(session);
      });
    }
  }
});

// Catch-all for mail that shows up without an event of its own (the copy in
// Sent, mail sent from the phone, mail synced as already read). Huge folders
// are left to the events above: searching them freezes the window too long to
// do it unasked.
browser.folders.onFolderInfoChanged.addListener((folder, info) => {
  if (info.totalMessageCount === undefined || info.totalMessageCount > BIG_FOLDER) {
    return;
  }
  for (const session of sessions) {
    if (session.near.includes(folder.id)) {
      scheduleRecent(session, folder.id);
    }
  }
});

// --- A click on a collapsed thread ------------------------------------------

// Thunderbird shows its own summary page for a collapsed thread and extensions
// cannot draw there. Select the thread's first message instead (the row that
// was clicked, so the list does not jump) and show the whole thread from it.
browser.messageDisplay.onMessageDisplayed.addListener((tab, message) => {
  lastShown.set(tab.id, { at: Date.now(), message });
});

browser.messageDisplay.onMessagesDisplayed.addListener(async (tab, list) => {
  const messages = asArray(list);
  if (!opts.autoOpenThread || tab.type !== "mail" || messages.length < 2 || messages.length > 1000) {
    return;
  }
  // With mail.operate_on_msgs_in_collapsed_threads off, Thunderbird displays the
  // thread's first message by itself: nothing to do, and the thread stays collapsed.
  await new Promise(resolve => setTimeout(resolve, 120));
  const loaded = lastShown.get(tab.id);
  if (loaded && Date.now() - loaded.at < 1500 && messages.some(m => m.id === loaded.message.id)) {
    return;
  }
  const subject = baseSubject(messages[0].subject);
  if (!messages.every(m => baseSubject(m.subject) === subject)) {
    return;
  }
  const first = messages.reduce((a, b) => (b.date < a.date ? b : a));
  seeds.set(tab.id, { at: Date.now(), messages });
  await browser.mailTabs.setSelectedMessages(tab.id, [first.id]);
});
