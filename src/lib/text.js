// Pure text helpers: subject normalisation and quote/signature stripping.
// No browser APIs here, so the file runs under `node --test` as well.

const PREFIX =
  /^(?:(re|aw|sv|vs|antw|odp|ynt|r|отв|ответ|на|ha)|(fw|fwd|wg|tr|rv|enc|пер|пересл))(?:\[\d+\])?\s*[:：]\s*/i;
const TAG = /^\[([^\[\]\n]{1,40})\]\s*/;
// Markers a mail gateway adds on the way in; the copy in Sent does not have them.
const GATEWAY_TAG = /^(?:ext|external|extern|внешн\S*|\*{0,3}spam\*{0,3}|suspected spam|bulk)$/i;

/**
 * Take a subject apart: "[EXT] RE: [Ticket #7] Status" ->
 * tags ["Ticket #7"], core "Status", tail "[Ticket #7] Status".
 * Reply/forward prefixes are dropped wherever they sit among the leading tags.
 */
function splitSubject(subject) {
  const whole = String(subject || "").trim();
  let rest = whole;
  let tail = whole;
  let forward = false;
  const tags = [];
  for (;;) {
    let m = PREFIX.exec(rest);
    if (m) {
      forward ||= !!m[2];
      rest = rest.slice(m[0].length);
      tail = rest;
      continue;
    }
    m = TAG.exec(rest);
    if (m && rest.length > m[0].length) {
      rest = rest.slice(m[0].length);
      if (GATEWAY_TAG.test(m[1].trim())) {
        tail = rest;
      } else if (!tags.some(tag => tag.toLowerCase() === m[1].trim().toLowerCase())) {
        tags.push(m[1].trim());
      }
      continue;
    }
    break;
  }
  return { tags, core: rest.trim(), tail: tail.trim(), forward };
}

/**
 * The longest piece of the subject that every message of the conversation
 * carries unchanged, original case: what to search folders for.
 */
export function stripSubjectPrefixes(subject) {
  return splitSubject(subject).tail;
}

/** Comparison key for "same conversation" checks. */
export function baseSubject(subject) {
  const { tags, core } = splitSubject(subject);
  return [...tags.map(tag => `[${tag}]`), core].join(" ").replace(/\s+/g, " ").trim().toLowerCase();
}

export function isForward(subject) {
  return splitSubject(subject).forward;
}

/** "<a@b> <c@d>" -> ["a@b", "c@d"] */
export function parseMessageIds(value) {
  const out = [];
  for (const m of String(value || "").matchAll(/<([^<>\s]+)>/g)) {
    out.push(m[1]);
  }
  return out;
}

export const ORIGINAL_MESSAGE =
  /^\s*-{2,}\s*(?:original message|исходное сообщение|ursprüngliche nachricht|message d'origine|mensaje original)\s*-{2,}\s*$/i;
const HEADER_FROM = /^\s*\*?(?:from|от|von|de|da)\*?\s*:\s*\S/i;
const HEADER_OTHER =
  /^\s*\*?(?:sent|date|to|subject|cc|отправлено|дата|кому|тема|копия|gesendet|datum|an|betreff|envoyé|objet|enviado|para|asunto)\*?\s*:/i;
export const WROTE_LINE =
  /\b(?:wrote|writes|schrieb|a écrit|escribió|ha scritto|escreveu|napsal\(a\)|napisał\(a\)|написал|написала|написал\(а\)|пишет|пише)\s*:?\s*$/i;

const isQuoted = line => /^\s*>/.test(line);
const isBlank = line => line.trim() === "";

/**
 * Where the mail client's "reply header" starts, or -1.
 * Covers "-----Original Message-----" and Outlook's From:/Sent:/To:/Subject: block.
 */
function findReplyHeader(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (ORIGINAL_MESSAGE.test(lines[i])) {
      return i;
    }
    if (HEADER_FROM.test(lines[i])) {
      let hits = 0;
      for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
        if (HEADER_OTHER.test(lines[j])) {
          hits++;
        }
      }
      if (hits >= 2) {
        // Outlook often puts a ruler line right above the block.
        return i > 0 && /^\s*[_-]{5,}\s*$/.test(lines[i - 1]) ? i - 1 : i;
      }
    }
  }
  return -1;
}

/**
 * Turn the plain text of an e-mail into what a chat bubble should show:
 * the trailing quote of the previous message, its "X wrote:" line and the
 * signature are dropped. Quotes in the middle of the text (inline replies) stay.
 */
/**
 * Plain text sent as format=flowed (RFC 3676, Thunderbird's default) arrives the
 * way it travelled: paragraphs cut at about 72 characters, a line that goes on
 * ending with a space. Such lines are joined again, quotes level by level.
 * The Content-Type parameter is not available here, so flowed text is told by
 * a long line ending with a space.
 */
export function unflow(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const soft = line => line.endsWith(" ") && !/^>* ?-- $/.test(line);
  if (!lines.some(line => soft(line) && line.length >= 55)) {
    return lines.join("\n");
  }
  const out = [];
  let open = null;
  const close = () => {
    if (open) {
      out.push(open.depth ? `${">".repeat(open.depth)} ${open.text}` : open.text);
      open = null;
    }
  };
  for (const line of lines) {
    const depth = /^>*/.exec(line)[0].length;
    const body = line.slice(depth).replace(/^ /, ""); // the space after the quote marks, or space-stuffing
    if (open && open.depth !== depth) {
      close();
    }
    if (open) {
      open.text += body;
    } else {
      open = { depth, text: body };
    }
    if (!soft(line)) {
      close();
    }
  }
  close();
  return out.join("\n");
}

export function chatText(text, { forward = false } = {}) {
  const original = unflow(text);
  let lines = original.split("\n").map(l => l.replace(/[ \t ]+$/, ""));

  if (!forward) {
    const cut = findReplyHeader(lines);
    if (cut >= 0) {
      lines = lines.slice(0, cut);
    }

    // Trailing block of quoted lines.
    let end = lines.length;
    while (end > 0 && (isBlank(lines[end - 1]) || isQuoted(lines[end - 1]))) {
      end--;
    }
    const hadTrailingQuote = lines.slice(end).some(isQuoted);
    lines = lines.slice(0, end);

    // The attribution above it: "On <date>, <name> wrote:" (may wrap onto 2-3 lines).
    if (lines.length) {
      const last = lines.length - 1;
      const endsLikeAttribution =
        WROTE_LINE.test(lines[last]) || (hadTrailingQuote && /[:：]\s*$/.test(lines[last]) && /\d|@/.test(lines[last]));
      if (endsLikeAttribution) {
        let start = last;
        while (start > 0 && last - start < 2 && !isBlank(lines[start - 1])) {
          start--;
        }
        // Keep the upper lines if they are clearly message text, not a wrapped attribution.
        const joined = lines.slice(start, last + 1).join(" ");
        if (joined.length > 300) {
          start = last;
        }
        lines = lines.slice(0, start);
      }
    }
  }

  // Signature after the standard "-- " delimiter.
  const sig = lines.findIndex((l, i) => i > 0 && /^--\s?$/.test(l));
  if (sig > 0 && lines.slice(0, sig).some(l => !isBlank(l))) {
    lines = lines.slice(0, sig);
  }

  let result = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!result) {
    // Nothing but quotes: better to show everything than an empty bubble.
    result = original.replace(/\n{3,}/g, "\n\n").trim();
  }
  return result;
}
