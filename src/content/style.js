// Styles of the chat view. They live inside a shadow root, so the styles of
// the e-mail being displayed cannot leak in and these cannot leak out.
var TBCHAT_CSS = `
/* The host element is reset with an inline "all: initial" (the e-mail's own
   styles can reach it), so everything visual starts at .wrap. */
.wrap {
  color-scheme: light dark;
  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", "Noto Sans", sans-serif;
  color: CanvasText;
  background: Canvas;
  --line: light-dark(#d9dce2, #44474f);
  --soft: light-dark(#eef0f3, #2c2e35);
  --mine: light-dark(#d9eaff, #244b7c);
  --accent: light-dark(#0b62d6, #6fb0ff);
  --dim: light-dark(#5d6470, #a4a9b4);
}
* { box-sizing: border-box; }
.wrap { display: flex; flex-direction: column; min-height: 100vh; padding: 0 max(14px, calc(50% - 440px)); }
.wrap.original { min-height: 0; }
.wrap.original .list, .wrap.original .composer { display: none; }

.bar { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 10px; padding: 6px 0; background: Canvas; color: var(--dim); font-size: 12px; }
.bar .count { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
button { font: inherit; color: inherit; cursor: pointer; }
.link { border: 0; background: none; padding: 2px 4px; color: var(--accent); border-radius: 4px; }
.link:hover { text-decoration: underline; }
.link:disabled { color: var(--dim); cursor: default; text-decoration: none; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

.list { display: flex; flex-direction: column; gap: 3px; margin-top: auto; padding: 6px 0 12px; }
.day { align-self: center; margin: 10px 0 6px; padding: 2px 11px; border-radius: 11px; background: var(--soft); color: var(--dim); font-size: 12px; }
.row { display: flex; }
.row.mine { justify-content: flex-end; }
.row.first { margin-top: 7px; }
.bubble { position: relative; min-width: 96px; max-width: min(78%, 640px); padding: 6px 11px 5px; border-radius: 15px; background: var(--soft); }
.row.mine .bubble { background: var(--mine); }
.row:not(.mine).first .bubble { border-top-left-radius: 5px; }
.row.mine.first .bubble { border-top-right-radius: 5px; }
.row.current .bubble { box-shadow: 0 0 0 1.5px var(--accent); }
.row.local .bubble { opacity: .75; }
.author { font-size: 12.5px; font-weight: 600; color: light-dark(hsl(var(--h) 65% 34%), hsl(var(--h) 70% 74%)); }
.text { white-space: pre-wrap; overflow-wrap: anywhere; }
.text a { color: var(--accent); }
.text.loading { min-height: 3em; color: var(--dim); font-style: italic; }
.bubble.rich { max-width: min(100%, 760px); }
.quote { margin: 3px 0; padding-left: 8px; border-left: 3px solid var(--line); color: var(--dim); }
.quote.folded { display: flex; flex-direction: column; justify-content: flex-end; max-height: 4.35em; overflow: hidden; mask-image: linear-gradient(to bottom, transparent, #000 1.3em); }
.big { color: var(--dim); }
.more { display: block; margin: 0 0 3px; }
.atts { display: flex; flex-wrap: wrap; gap: 5px; margin: 5px 0 2px; }
.att { max-width: 100%; padding: 3px 9px; border: 1px solid var(--line); border-radius: 9px; background: Canvas; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
.att:hover { border-color: var(--accent); }
.att small { color: var(--dim); }
.meta { display: flex; justify-content: flex-end; align-items: center; gap: 6px; margin-top: 1px; color: var(--dim); font-size: 11px; }
.meta .link { visibility: hidden; padding: 0 2px; color: var(--dim); font-size: 11px; }
.bubble:hover .meta .link, .meta .link:focus-visible { visibility: visible; }
.unread { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }

.jump { position: absolute; right: 2px; bottom: calc(100% + 10px); min-width: 38px; height: 38px; padding: 0 12px; border: 1px solid var(--line); border-radius: 19px; background: Canvas; color: CanvasText; font-size: 17px; line-height: 1; box-shadow: 0 1px 6px rgb(0 0 0 / .25); }
.jump:hover { border-color: var(--accent); color: var(--accent); }
.jump.new { border-color: var(--accent); background: var(--accent); color: Canvas; font-size: 12.5px; }
.jump[hidden] { display: none; }

.composer { position: sticky; bottom: 0; z-index: 2; padding: 7px 0 10px; border-top: 1px solid var(--line); background: Canvas; }
.head { display: flex; align-items: center; gap: 8px; margin: 0 4px 5px; color: var(--dim); font-size: 12px; }
.from { flex: none; max-width: 45%; padding: 1px 4px; border: 1px solid var(--line); border-radius: 6px; background: Canvas; color: CanvasText; font: inherit; }
.to { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.line { display: flex; align-items: flex-end; gap: 7px; }
textarea { flex: 1; min-height: 36px; max-height: 40vh; padding: 7px 13px; border: 1px solid var(--line); border-radius: 18px; background: Canvas; color: CanvasText; font: inherit; resize: none; }
textarea:focus { border-color: var(--accent); outline: 0; }
.btn { height: 36px; padding: 0 14px; border: 1px solid var(--line); border-radius: 18px; background: Canvas; }
.btn.send { border-color: var(--accent); background: var(--accent); color: Canvas; font-weight: 600; }
.btn:disabled { opacity: .5; cursor: default; }
.btn.small { height: 24px; padding: 0 10px; border-radius: 12px; color: CanvasText; font-size: 12px; }
.btn.small:hover { border-color: var(--accent); }
.err { margin: 5px 4px 0; color: light-dark(#b3261e, #ff8a80); font-size: 12px; }
.err:empty { display: none; }
`;

// Styles for the inside of a bubble that shows the HTML of a mail. Each such
// bubble has a shadow root of its own, so the mail's CSS stays in its bubble.
var TBCHAT_HTML_CSS = `
.m { overflow-x: auto; overflow-wrap: anywhere; contain: layout; }
.m.paper { color-scheme: light; margin: 3px 0; padding: 8px 10px; border-radius: 9px; background: #fff; color: #1b1b1b; }
@media (prefers-color-scheme: dark) {
  /* Colours picked for a white page are unreadable on a dark bubble. */
  .m:not(.paper) *:not(a):not(blockquote):not(.qmore) { color: inherit !important; background-color: transparent !important; }
}
.m a { color: light-dark(#0b62d6, #6fb0ff); }
.m img { max-width: 100% !important; height: auto; }
.m table { max-width: 100%; }
.m pre { white-space: pre-wrap; }
.m p { margin: 0 0 .55em; }
.m > :first-child { margin-top: 0 !important; }
.m > :last-child { margin-bottom: 0 !important; }
.m blockquote pre { margin: 0; font: inherit; white-space: pre-wrap; }
.m blockquote.folded { display: flex; flex-direction: column; justify-content: flex-end; max-height: 4.4em; overflow: hidden; mask-image: linear-gradient(to bottom, transparent, #000 1.3em); }
.qmore { display: block; margin: 2px 0 0; padding: 0 2px; border: 0; background: none; color: light-dark(#0b62d6, #6fb0ff); font: inherit; font-size: 12px; cursor: pointer; }
.qmore:hover { text-decoration: underline; }
.m blockquote { margin: 4px 0 !important; padding: 0 0 0 8px !important; border: 0 !important; border-left: 3px solid light-dark(#d9dce2, #44474f) !important; color: light-dark(#5d6470, #a4a9b4); }
`;
