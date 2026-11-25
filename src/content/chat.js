// Runs inside the displayed message. Asks the background page for the whole
// conversation and, if there is one, shows it as chat bubbles in place of the
// message body. The original body stays in the page and is one click away.
(() => {
  if (window.top !== window || window.tbChatLoaded) {
    return;
  }
  window.tbChatLoaded = true;

  const t = (key, ...subs) => browser.i18n.getMessage(key, subs) || key;
  const lang = browser.i18n.getUILanguage();
  const timeFmt = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const dayFmt = new Intl.DateTimeFormat(lang, { day: "numeric", month: "long" });
  const dayYearFmt = new Intl.DateTimeFormat(lang, { day: "numeric", month: "long", year: "numeric" });
  const relFmt = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const fullFmt = new Intl.DateTimeFormat(lang, { dateStyle: "full", timeStyle: "short", hourCycle: "h23" });

  const port = browser.runtime.connect({ name: "tb-chat" });
  let ui = null;
  let items = [];
  const rows = new Map(); // key -> row parts
  let original = false;
  // The message the view holds on to while text and pictures load and change
  // heights: { key, block, top, y }. null once the reader has scrolled away.
  let stick = null;
  let sending = false;
  let draftTimer = null;
  let needTimer = null;
  const needed = new Set();

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text != null) {
      node.textContent = text;
    }
    return node;
  }

  // Bodies are loaded for the messages on screen (and a bit around) only: for
  // mail that is not kept offline every body is a download from the server.
  const watcher = new IntersectionObserver(
    entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          needed.add(entry.target.dataset.key);
        }
      }
      clearTimeout(needTimer);
      needTimer = setTimeout(requestBodies, 60);
    },
    { rootMargin: "500px 0px" }
  );

  function requestBodies() {
    const middle = window.innerHeight / 2;
    const keys = [...needed]
      .filter(key => rows.has(key) && !rows.get(key).hasBody)
      .map(key => {
        const rect = rows.get(key).row.getBoundingClientRect();
        return { key, distance: Math.abs((rect.top + rect.bottom) / 2 - middle) };
      })
      .sort((a, b) => a.distance - b.distance)
      .map(entry => entry.key);
    needed.clear();
    if (keys.length) {
      port.postMessage({ t: "need", keys });
    }
  }

  function build() {
    const pageStyle = el("style");
    pageStyle.textContent =
      "html.tb-chat-on body > :not(#tb-chat-host) { display: none !important; }" +
      "html.tb-chat-on body { margin: 0 !important; padding: 0 !important; }";
    document.head.append(pageStyle);

    const host = el("div");
    host.id = "tb-chat-host";
    // The e-mail's own stylesheet can target any element of the page, this one included.
    host.style.cssText = "all: initial !important; display: block !important;";
    const root = host.attachShadow({ mode: "closed" });
    const style = el("style");
    style.textContent = TBCHAT_CSS;

    const wrap = el("div", "wrap");
    const bar = el("div", "bar");
    const count = el("span", "count");
    const older = el("button", "link");
    older.type = "button";
    older.hidden = true;
    older.addEventListener("click", () => port.postMessage({ t: "searchAll" }));
    const toggle = el("button", "btn small");
    toggle.type = "button";
    toggle.addEventListener("click", () => setOriginal(!original));
    bar.append(count, older, toggle);

    const list = el("div", "list");
    list.setAttribute("role", "log");
    list.addEventListener("click", onLinkClick);

    const jump = el("button", "jump", "↓");
    jump.type = "button";
    jump.hidden = true;
    jump.title = t("toLatest");
    jump.setAttribute("aria-label", t("toLatest"));
    jump.addEventListener("click", toLatest);

    const composer = el("div", "composer");
    const head = el("div", "head");
    const from = el("select", "from");
    from.title = t("fromTitle");
    from.setAttribute("aria-label", t("fromTitle"));
    from.addEventListener("change", () => port.postMessage({ t: "from", identityId: from.value }));
    const to = el("div", "to");
    head.append(from, to);
    const line = el("div", "line");
    const input = el("textarea");
    input.rows = 1;
    input.placeholder = t("placeholder");
    input.setAttribute("aria-label", t("placeholder"));
    const full = el("button", "btn", t("editor"));
    full.type = "button";
    full.title = t("editorTitle");
    const send = el("button", "btn send", t("send"));
    send.type = "button";
    send.title = t("sendTitle");
    const err = el("div", "err");
    line.append(input, full, send);
    composer.append(jump, head, line, err);

    // "Quote" comes up next to a selection made in the messages and puts it into the reply.
    const quote = el("button", "qpill", t("quote"));
    quote.type = "button";
    quote.hidden = true;
    quote.title = t("quoteTitle");
    quote.addEventListener("mousedown", e => e.preventDefault()); // the click must not drop the selection
    quote.addEventListener("click", quoteSelection);
    list.addEventListener("mouseup", e => setTimeout(() => offerQuote(e.clientX, e.clientY), 0));
    document.addEventListener("selectionchange", () => {
      if (!selectedText()) {
        hideQuote();
      }
    });

    // Keep Thunderbird's single-key shortcuts (a = archive, j = junk, ...) away from typing.
    for (const type of ["keydown", "keypress", "keyup"]) {
      input.addEventListener(type, e => e.stopPropagation());
    }
    input.addEventListener("keydown", e => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submit();
      }
    });
    input.addEventListener("input", () => {
      autosize();
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => port.postMessage({ t: "draft", text: input.value }), 400);
    });
    send.addEventListener("click", submit);
    full.addEventListener("click", () => port.postMessage({ t: "compose" }));

    wrap.append(bar, list, composer, quote);
    root.append(style, wrap);
    document.body.prepend(host);

    window.addEventListener("scroll", onScroll, { passive: true });
    new ResizeObserver(() => {
      applyStick();
      updateJump();
    }).observe(list);
    document.addEventListener("visibilitychange", reportSeen);

    ui = { wrap, bar, count, older, toggle, list, jump, from, to, input, send, full, err, quote };
  }

  const selectedText = () => String(window.getSelection() || "").replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  function offerQuote(x, y) {
    if (original || !selectedText()) {
      hideQuote();
      return;
    }
    const pill = ui.quote;
    pill.hidden = false;
    const { width, height } = pill.getBoundingClientRect();
    const floor = ui.input.getBoundingClientRect().top - 12; // not over the reply box
    pill.style.left = Math.max(8, Math.min(x + 6, window.innerWidth - width - 8)) + "px";
    pill.style.top = (y + 14 + height > floor ? Math.max(8, y - height - 14) : y + 14) + "px";
  }

  function hideQuote() {
    if (ui && !ui.quote.hidden) {
      ui.quote.hidden = true;
    }
  }

  /** The selected text goes into the reply as "> " lines; sending turns those into a real quote. */
  function quoteSelection() {
    const text = selectedText();
    hideQuote();
    if (!text) {
      return;
    }
    const quoted = text.split("\n").map(line => (line.trim() ? `> ${line}` : ">")).join("\n");
    const input = ui.input;
    const before = input.value && !input.value.endsWith("\n") ? input.value + "\n" : input.value;
    input.value = `${before}${quoted}\n`;
    window.getSelection().removeAllRanges();
    input.dispatchEvent(new Event("input"));
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    input.scrollTop = input.scrollHeight;
  }

  /** Links open in the browser (or a compose window), never inside the message pane. */
  function onLinkClick(event) {
    const link = event.composedPath().find(node => node.tagName === "A" && node.hasAttribute?.("href"));
    if (!link) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const href = link.getAttribute("href");
    if (/^(https?:|mailto:)/i.test(href)) {
      port.postMessage({ t: "link", url: href });
    }
  }

  function autosize() {
    ui.input.style.height = "auto";
    ui.input.style.height = Math.min(ui.input.scrollHeight + 2, window.innerHeight * 0.4) + "px";
  }

  function setOriginal(value) {
    original = value;
    document.documentElement.classList.toggle("tb-chat-on", !original);
    ui.wrap.classList.toggle("original", original);
    ui.toggle.textContent = original ? t("showChat") : t("showOriginal");
    if (original) {
      window.scrollTo(0, 0);
    } else {
      applyStick();
    }
  }

  function leaveChat() {
    if (ui) {
      document.documentElement.classList.remove("tb-chat-on");
      ui.wrap.hidden = true;
    }
  }

  const nearBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 80;

  /**
   * Is the view still where we put it? False (and the hold is dropped) once
   * the reader has scrolled. Our own scrolling leaves the page where we put it;
   * the browser keeping things steady while text loads above moves the page but
   * not the held message.
   */
  function stillHeld() {
    if (!stick) {
      return false;
    }
    if (stick.y === undefined || Math.abs(window.scrollY - stick.y) <= 40) {
      return true;
    }
    const target = rows.get(stick.key);
    if (target && Math.abs(target.row.getBoundingClientRect().top - stick.top) <= 40) {
      stick.y = window.scrollY;
      return true;
    }
    stick = null;
    return false;
  }

  /** Put the view back on the message it is held on. */
  function applyStick() {
    if (original || !ui || !items.length || !stillHeld()) {
      return;
    }
    const target = rows.get(stick.key) || rows.get(items.at(-1).key);
    target.row.scrollIntoView({ block: stick.block });
    if (stick.block === "start") {
      window.scrollBy(0, -(ui.bar.offsetHeight + 8));
    }
    stick.top = target.row.getBoundingClientRect().top;
    stick.y = window.scrollY;
  }

  function onScroll() {
    hideQuote();
    if (!original) {
      updateJump();
      stillHeld();
    }
  }

  /** The arrow is there whenever the latest message is still below the screen. */
  function updateJump() {
    const last = items.length && rows.get(items.at(-1).key);
    const below = !!last && last.row.getBoundingClientRect().top > window.innerHeight - ui.jump.parentNode.offsetHeight - 20;
    ui.jump.hidden = !below;
    if (!below) {
      ui.jump.classList.remove("new");
      ui.jump.textContent = "↓";
    }
  }

  /** To the start of the latest message (which is the end of the chat unless that message is long). */
  function toLatest() {
    stick = { key: items.at(-1).key, block: "start" };
    applyStick();
    updateJump();
  }

  /**
   * Where a conversation opens: at the first unread message, at the message
   * that was picked if it is an older one, otherwise at the latest message.
   */
  function pickStick() {
    const unread = items.find(i => i.unread && !i.mine);
    if (unread) {
      return { key: unread.key, block: "start" };
    }
    const index = items.findIndex(i => i.current);
    // The first message is what a click on a collapsed thread displays: not a deliberate pick.
    return index > 0 && index < items.length - 2 ? { key: items[index].key, block: "center" } : { key: items.at(-1).key, block: "start" };
  }

  function dayLabel(date) {
    const startOf = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const now = new Date();
    const days = Math.round((startOf(date) - startOf(now)) / 86400000);
    if (days === 0 || days === -1) {
      const label = relFmt.format(days, "day");
      return label.charAt(0).toUpperCase() + label.slice(1);
    }
    return (date.getFullYear() === now.getFullYear() ? dayFmt : dayYearFmt).format(date);
  }

  function hue(text) {
    let h = 0;
    for (const ch of text) {
      h = (h * 31 + ch.codePointAt(0)) % 360;
    }
    return h;
  }

  function appendLinked(parent, text) {
    let last = 0;
    for (const m of text.matchAll(/\bhttps?:\/\/[^\s<>"']+/g)) {
      const url = m[0].replace(/[.,;:!?)\]]+$/, "");
      parent.append(text.slice(last, m.index));
      const a = el("a", null, url);
      a.href = url;
      parent.append(a);
      last = m.index + url.length;
    }
    parent.append(text.slice(last));
  }

  function fillText(textEl, body) {
    const lines = (body.text || t("emptyBody")).split("\n");
    for (let i = 0; i < lines.length; ) {
      const start = i;
      const quoted = /^\s*>/.test(lines[i]);
      while (i < lines.length && /^\s*>/.test(lines[i]) === quoted) {
        i++;
      }
      const chunk = lines.slice(start, i);
      if (!quoted) {
        appendLinked(textEl, chunk.join("\n") + (i < lines.length ? "\n" : ""));
        continue;
      }
      const quote = el("div", "quote");
      const inner = el("div");
      appendLinked(inner, chunk.map(l => l.replace(/^\s*>\s?/, "")).join("\n"));
      quote.append(inner);
      if (chunk.length > 3 || inner.textContent.length > 280) {
        // Folded to its last lines: those are what the text below answers.
        quote.classList.add("folded");
        const more = el("button", "link more", t("showQuote"));
        more.type = "button";
        more.addEventListener("click", () => {
          quote.classList.remove("folded");
          more.remove();
        });
        textEl.append(more);
      }
      textEl.append(quote);
    }
    if (body.cut) {
      textEl.append("\n…");
    }
  }

  /** The mail's own HTML, already cleaned by the background page, in a shadow root of its own. */
  function fillHtml(textEl, body) {
    const box = el("div", "html");
    const root = box.attachShadow({ mode: "closed" });
    const own = el("style");
    own.textContent = body.css || "";
    const base = el("style");
    base.textContent = TBCHAT_HTML_CSS;
    const content = el("div", "m" + (body.styled ? " paper" : ""));
    const doc = new DOMParser().parseFromString(body.html, "text/html");
    for (const img of doc.querySelectorAll("img")) {
      const src = img.getAttribute("src") || "";
      if (/^cid:/i.test(src)) {
        const data = body.images?.[src.slice(4)];
        if (data) {
          img.setAttribute("src", data);
        } else {
          img.remove();
        }
      }
    }
    content.append(...doc.body.childNodes);
    for (const quote of content.querySelectorAll("blockquote[data-fold]")) {
      quote.classList.add("folded");
      const more = el("button", "qmore", t("showQuote"));
      more.type = "button";
      more.addEventListener("click", event => {
        event.stopPropagation();
        quote.classList.remove("folded");
        more.remove();
      });
      quote.before(more);
    }
    content.addEventListener("click", onLinkClick);
    root.append(own, base, content);
    textEl.append(box);
  }

  function fillBody(entry, body) {
    entry.hasBody = true;
    entry.big = !!body.big;
    watcher.unobserve(entry.row);
    entry.textEl.replaceChildren();
    entry.textEl.classList.remove("loading");
    entry.bubble.classList.toggle("rich", !!body.html);
    if (body.failed) {
      entry.textEl.classList.add("loading");
      entry.textEl.textContent = t("bodyFailed");
    } else if (body.big) {
      // Reading a mail with tens of megabytes of attachments freezes Thunderbird for seconds: only on request.
      const note = el("span", "big", t("bigMessage", formatSize(body.size)) + " ");
      const load = el("button", "link", t("bigLoad"));
      load.type = "button";
      load.addEventListener("click", () => {
        entry.textEl.textContent = t("loading");
        entry.textEl.classList.add("loading");
        port.postMessage({ t: "need", keys: [entry.item.key], force: true });
      });
      entry.textEl.append(note, load);
    } else if (body.html) {
      fillHtml(entry.textEl, body);
    } else {
      fillText(entry.textEl, body);
    }
    entry.attsEl.replaceChildren();
    for (const att of body.atts || []) {
      const chip = el("button", "att");
      chip.type = "button";
      chip.append("📎 " + att.name + " ");
      chip.append(el("small", null, formatSize(att.size)));
      chip.title = att.name;
      chip.addEventListener("click", () => port.postMessage({ t: "attachment", key: entry.item.key, partName: att.partName }));
      entry.attsEl.append(chip);
    }
    entry.attsEl.hidden = !entry.attsEl.childElementCount;
  }

  function formatSize(bytes) {
    if (!(bytes > 0)) {
      return "";
    }
    const units = ["B", "KB", "MB", "GB"];
    let n = bytes;
    let u = 0;
    while (n >= 1024 && u < units.length - 1) {
      n /= 1024;
      u++;
    }
    return `${n >= 10 || u === 0 ? Math.round(n) : n.toFixed(1)} ${units[u]}`;
  }

  function makeRow(item) {
    const row = el("div", "row");
    row.dataset.key = item.key;
    const bubble = el("div", "bubble");
    const author = el("div", "author");
    const textEl = el("div", "text loading", t("loading"));
    const attsEl = el("div", "atts");
    attsEl.hidden = true;
    const meta = el("div", "meta");
    const open = el("button", "link", t("openMessage"));
    open.type = "button";
    open.addEventListener("click", () => port.postMessage({ t: "open", key: item.key }));
    const dot = el("span", "unread");
    dot.title = t("unread");
    const time = el("time");
    meta.append(open, dot, time);
    bubble.append(author, textEl, attsEl, meta);
    row.append(bubble);
    return { row, bubble, author, textEl, attsEl, open, dot, time, item, hasBody: false };
  }

  function render(message) {
    if (!ui) {
      build();
    }
    const first = !items.length;
    const following = !first && (nearBottom() || stick?.key === items.at(-1).key);
    const known = new Set(items.map(i => i.key));
    items = message.items;
    ui.wrap.hidden = false;

    // One address can stand for several senders (a shared mailbox, several agents
    // behind one account): there the display name is what tells them apart.
    const namesAt = new Map();
    for (const { mine, from } of items) {
      if (!mine) {
        namesAt.set(from.email, (namesAt.get(from.email) || new Set()).add(from.name || ""));
      }
    }
    const sender = from => (namesAt.get(from.email)?.size > 1 ? `${from.name || ""}\n` : "") + (from.email || from.name);
    const nodes = [];
    let prev = null;
    for (const item of items) {
      let entry = rows.get(item.key);
      if (!entry) {
        entry = makeRow(item);
        rows.set(item.key, entry);
        watcher.observe(entry.row);
      }
      entry.item = item;
      const date = new Date(item.date);
      const newDay = !prev || new Date(prev.date).toDateString() !== date.toDateString();
      const sameSender = !!prev && (item.mine ? prev.mine : !prev.mine && sender(prev.from) === sender(item.from));
      const grouped = !newDay && sameSender && item.date - prev.date < 10 * 60000;
      if (newDay) {
        nodes.push(el("div", "day", dayLabel(date)));
      }
      entry.row.className = "row" + (item.mine ? " mine" : "") + (grouped ? "" : " first") + (item.current ? " current" : "") + (item.local ? " local" : "");
      entry.author.hidden = item.mine || grouped;
      entry.author.textContent = item.from.name || item.from.email;
      entry.author.title = item.from.email;
      entry.author.style.setProperty("--h", hue(sender(item.from)));
      entry.time.textContent = item.local ? t("sentJustNow") : timeFmt.format(date);
      entry.time.title = fullFmt.format(date);
      entry.dot.hidden = !item.unread || item.mine;
      entry.open.hidden = !!item.local;
      if (item.body && !entry.hasBody) {
        fillBody(entry, item.body);
      }
      nodes.push(entry.row);
      prev = item;
    }
    for (const [key, entry] of [...rows]) {
      if (!items.some(i => i.key === key)) {
        watcher.unobserve(entry.row);
        rows.delete(key);
      }
    }
    ui.list.replaceChildren(...nodes);
    ui.count.textContent = message.hidden ? t("countHidden", String(items.length), String(message.hidden)) : t("count", String(items.length));
    ui.older.hidden = !message.incomplete;
    ui.older.disabled = message.searching;
    ui.older.textContent = message.searching ? t("searching") : t("searchOlder");
    ui.older.title = t("searchOlderTitle");
    ui.to.textContent = message.replyTo.length ? t("replyTo", message.replyTo.join(", ")) : "";
    ui.to.title = ui.to.textContent;

    ui.from.replaceChildren(
      ...message.identities.map(identity => {
        const option = el("option", null, identity.label);
        option.value = identity.id;
        return option;
      })
    );
    ui.from.value = message.from;
    ui.from.hidden = message.identities.length < 2;

    if (first) {
      if (message.draft) {
        ui.input.value = message.draft;
        autosize();
      }
      stick = pickStick();
      setOriginal(false);
    } else if (items.some(i => !known.has(i.key))) {
      const newest = items.at(-1);
      if (!known.has(newest.key) && (following || newest.mine)) {
        toLatest();
      } else if (!known.has(newest.key)) {
        ui.jump.hidden = false;
        ui.jump.classList.add("new");
        ui.jump.textContent = t("newBelow");
      } else {
        applyStick(); // earlier messages were found: stay where we were
      }
    }
    updateJump();
    reportSeen();
  }

  function reportSeen() {
    if (ui && !ui.wrap.hidden && !original && document.visibilityState === "visible" && items.some(i => i.unread)) {
      port.postMessage({ t: "seen" });
    }
  }

  function submit() {
    const text = ui.input.value.trim();
    if (!text || sending) {
      return;
    }
    sending = true;
    ui.err.textContent = "";
    ui.input.disabled = ui.send.disabled = true;
    ui.send.textContent = t("sending");
    port.postMessage({ t: "send", text });
  }

  function sendDone(error) {
    sending = false;
    ui.input.disabled = ui.send.disabled = false;
    ui.send.textContent = t("send");
    if (error) {
      ui.err.textContent = t("sendFailed", error);
    } else {
      ui.input.value = "";
      autosize();
    }
    ui.input.focus();
  }

  port.onMessage.addListener(message => {
    if (message.t === "thread") {
      render(message);
    } else if (message.t === "single") {
      leaveChat();
    } else if (message.t === "body") {
      const entry = rows.get(message.key);
      if (entry && (!entry.hasBody || entry.big)) {
        fillBody(entry, message.body);
        applyStick();
      }
    } else if (message.t === "sent") {
      sendDone(null);
    } else if (message.t === "sendError") {
      sendDone(message.error);
    }
  });
  port.postMessage({ t: "hello" });
})();
