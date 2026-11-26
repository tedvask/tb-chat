// Turns the HTML part of an e-mail into something safe and compact enough for
// a chat bubble: active content removed, the quoted previous message and the
// signature cut off. Needs a DOM (runs in the background page).
import { ORIGINAL_MESSAGE, WROTE_LINE } from "./text.js";

const DROP =
  "script, noscript, iframe, frame, frameset, object, embed, applet, link, meta, base, title, input, button, select, " +
  "textarea, audio, video, source, track, svg, math, template, slot, dialog, canvas";
const QUOTE = "blockquote, .gmail_quote, .gmail_extra, .gmail_quote_container, .moz-cite-prefix, .yahoo_quoted, .protonmail_quote";
const REPLY_MARKER =
  "#divRplyFwdMsg, #appendonsend, #OLK_SRC_BODY_SECTION, .yahoo_quoted, [id^='yahoo_quoted'], .protonmail_quote, #mail-editor-reference-message-container";
const SIGNATURE = ".gmail_signature, [data-smartmail='gmail_signature'], .moz-signature";
const WRAPPERS = /^(DIV|SPAN|SECTION|ARTICLE|FONT|P|CENTER|TABLE|TBODY|TR|TD|B|I)$/;
// Nothing in a bubble may be fetched from a server: a picture or a style sheet
// loaded from the sender's machine tells the sender that the mail was opened.
// Pictures stay only when they travel with the mail (cid:) or are embedded.
const EMBEDDED_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp);base64,/i;
const EMBEDDED_CSS_URL = /url\("data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+\/=]*"\)/gi;

/**
 * True if CSS text could make the browser fetch something. Used on text the
 * browser's own CSS parser has written out again, where a URL can only appear
 * as url("…"); variables, escapes and the other ways of smuggling one in are
 * refused outright rather than interpreted.
 */
function reachesOut(cssText) {
  return /url\(|image-set\(|src\(|var\(|--|\\|expression\(|-moz-binding|behavior\s*:|javascript:/i.test(cssText.replace(EMBEDDED_CSS_URL, ""));
}

/** Remove the declarations that could fetch something (a CSSStyleDeclaration). */
function dropFetching(style) {
  for (const property of [...style]) {
    if (property.startsWith("--") || reachesOut(style.getPropertyValue(property))) {
      style.removeProperty(property);
    }
  }
}

/** One rule of the mail's style sheet as safe text, or "" if it has to go. */
function cleanRule(rule) {
  if (rule instanceof CSSStyleRule) {
    dropFetching(rule.style);
    return reachesOut(rule.cssText) ? "" : rule.cssText;
  }
  if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) {
    const head = `${rule instanceof CSSMediaRule ? "@media" : "@supports"} ${rule.conditionText}`;
    const inner = [...rule.cssRules].map(cleanRule).filter(Boolean).join("\n");
    return inner && !reachesOut(head) ? `${head} {\n${inner}\n}` : "";
  }
  if (rule instanceof CSSKeyframesRule) {
    return reachesOut(rule.cssText) ? "" : rule.cssText;
  }
  return ""; // @import, @font-face, @namespace, @property…: nothing a chat bubble needs
}

/** The mail's own style sheets, parsed by the browser and written out without anything that fetches. */
function cleanCss(text) {
  const sheet = new CSSStyleSheet();
  try {
    sheet.replaceSync(text);
  } catch {
    return "";
  }
  return [...sheet.cssRules].map(cleanRule).filter(Boolean).join("\n");
}

const HEADER_BLOCK = /^\s*(?:from|от|von|de)\s*:[\s\S]{0,300}?(?:sent|date|отправлено|дата|gesendet|envoyé)\s*:[\s\S]{0,400}?(?:subject|тема|betreff|objet)\s*:/i;

function sanitize(doc) {
  doc.querySelectorAll(DROP).forEach(n => n.remove());
  doc.querySelectorAll("form").forEach(f => f.replaceWith(...f.childNodes));
  for (const el of doc.querySelectorAll("*")) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.replace(/[\u0000- ]+/g, "");
      if (name.startsWith("on") || ["srcset", "ping", "contenteditable", "autofocus", "tabindex", "formaction", "action", "target"].includes(name)) {
        el.removeAttribute(attr.name);
      } else if (name === "href" || name === "xlink:href") {
        if (!/^(https?:|mailto:|tel:|#)/i.test(value)) {
          el.removeAttribute(attr.name);
        }
      } else if (["src", "background", "poster"].includes(name)) {
        if (!/^cid:/i.test(value) && !EMBEDDED_IMAGE.test(value)) {
          el.removeAttribute(attr.name);
        }
      } else if (["cite", "longdesc", "lowsrc", "dynsrc"].includes(name)) {
        el.removeAttribute(attr.name);
      } else if (name === "style") {
        if (el.style) {
          dropFetching(el.style);
        }
        const rest = el.style?.cssText;
        if (!rest || reachesOut(rest)) {
          el.removeAttribute(attr.name);
        } else {
          el.setAttribute(attr.name, rest);
        }
      }
    }
    if (el.tagName === "A") {
      el.setAttribute("rel", "noopener noreferrer");
    }
  }
}

/** Remove `node` and everything after it in the document. */
function cutFrom(node) {
  const body = node.ownerDocument.body;
  let n = node;
  while (n && n !== body) {
    while (n.nextSibling) {
      n.nextSibling.remove();
    }
    const parent = n.parentNode;
    if (n === node) {
      n.remove();
    }
    n = parent;
  }
}

const hasContent = el => el.textContent.trim() !== "" || !!el.querySelector("img, table");

function isBlank(node) {
  if (node.nodeType === 3) {
    return !node.textContent.trim();
  }
  if (node.nodeType !== 1) {
    return true; // comments etc.
  }
  return node.tagName === "BR" || node.tagName === "HR" || !hasContent(node);
}

const isQuote = node => node.nodeType === 1 && node.matches(QUOTE);

function tailIsQuote(el) {
  let n = el.lastChild;
  while (n && isBlank(n)) {
    n = n.previousSibling;
  }
  return !!n && (isQuote(n) || (n.nodeType === 1 && WRAPPERS.test(n.tagName) && tailIsQuote(n)));
}

/**
 * Strip the quote of the previous message from the end, together with the
 * "X wrote:" line above it. Quotes in the middle (inline replies) stay.
 * Returns true if a quote was removed.
 */
function trimTrailingQuote(root) {
  let removedQuote = false;
  for (;;) {
    const last = root.lastChild;
    if (!last) {
      return removedQuote;
    }
    if (isBlank(last)) {
      last.remove();
    } else if (isQuote(last)) {
      last.remove();
      removedQuote = true;
    } else {
      const text = last.textContent.trim();
      const attribution =
        text.length < 300 &&
        (WROTE_LINE.test(text) || (removedQuote && /[:：]$/.test(text) && /\d|@/.test(text))) &&
        !(last.nodeType === 1 && last.querySelector("table, img"));
      if (attribution) {
        last.remove();
        return true;
      }
      if (last.nodeType === 1 && WRAPPERS.test(last.tagName) && tailIsQuote(last)) {
        removedQuote = trimTrailingQuote(last) || removedQuote;
        if (hasContent(last)) {
          return removedQuote;
        }
        last.remove();
      } else {
        return removedQuote;
      }
    }
  }
}

function cutReplyHeader(doc) {
  const marker = doc.querySelector(REPLY_MARKER);
  if (marker) {
    cutFrom(marker);
  }
  // Outlook: "From: / Sent: / To: / Subject:" block, the old mail follows unmarked.
  for (const el of doc.body.querySelectorAll("p, div, td, span, font")) {
    if (el.closest("blockquote")) {
      continue;
    }
    const text = el.textContent;
    if (ORIGINAL_MESSAGE.test(text) || (text.length < 700 && HEADER_BLOCK.test(text) && !el.querySelector("p, div"))) {
      // Take the box around it along (Outlook wraps the block in a top-bordered div).
      let start = el;
      while (start.parentNode !== doc.body && start.parentNode.textContent.trim() === text.trim()) {
        start = start.parentNode;
      }
      cutFrom(start);
      break;
    }
  }
}

/**
 * @returns {{html: string, css: string, cids: string[], images: object, styled: boolean}}
 *   html   - body markup, safe to insert
 *   css    - the mail's own style sheets, to be scoped by the caller
 *   cids   - Content-IDs of pictures the markup refers to (img src="cid:...")
 *   styled - the mail sets backgrounds of its own, so it needs a light sheet under it
 */
export function prepareHtml(source, { forward = false } = {}) {
  const doc = new DOMParser().parseFromString(source, "text/html");
  let css = "";
  for (const style of doc.querySelectorAll("style")) {
    css += style.textContent + "\n";
    style.remove();
  }
  css = cleanCss(css);
  sanitize(doc);

  const untrimmed = doc.body.cloneNode(true);
  doc.querySelectorAll(SIGNATURE).forEach(n => n.remove());
  if (!forward) {
    // "On ... wrote:" / the From-Sent-To-Subject box of ReplyWithHeader: no use in a chat,
    // wherever it stands (above the first quote when the reply is written in between).
    doc.querySelectorAll(".moz-cite-prefix, #rwhHeaders").forEach(n => n.remove());
    cutReplyHeader(doc);
    trimTrailingQuote(doc.body);
  }
  while (doc.body.firstChild && isBlank(doc.body.firstChild)) {
    doc.body.firstChild.remove();
  }
  // Quotes that stay (the reply is written between them) get the chat's own
  // look: mail clients put "no border, no indent" styles right on the element.
  for (const quote of doc.body.querySelectorAll("blockquote")) {
    quote.removeAttribute("style");
    quote.setAttribute("type", "cite");
    const text = quote.textContent.trim();
    if (!quote.parentElement.closest("blockquote") && (text.length > 200 || text.split("\n").length > 3 || quote.querySelector("blockquote"))) {
      quote.setAttribute("data-fold", "");
    }
  }
  // Nothing but a quote: better to show everything than an empty bubble.
  const body = hasContent(doc.body) ? doc.body : untrimmed;

  const cids = [...new Set([...body.querySelectorAll("img[src^='cid:' i]")].map(img => img.getAttribute("src").slice(4)))];
  const styled =
    /background(-color|-image)?\s*:/i.test(css) ||
    !!body.querySelector("[bgcolor], [background], [style*='background' i]");
  return { html: body.innerHTML, css, cids, images: {}, styled };
}
