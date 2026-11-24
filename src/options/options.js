const DEFAULTS = { autoOpenThread: true, markRead: true };

for (const node of document.querySelectorAll("[data-i18n]")) {
  node.textContent = browser.i18n.getMessage(node.dataset.i18n);
}
browser.storage.local.get(DEFAULTS).then(values => {
  for (const key of Object.keys(DEFAULTS)) {
    const box = document.getElementById(key);
    box.checked = values[key];
    box.addEventListener("change", () => browser.storage.local.set({ [key]: box.checked }));
  }
});

// What the add-on did and how long it took. Timings only, no mail content.
function describe(d, title) {
  if (!d) {
    return "";
  }
  const time = ms => new Date(ms).toLocaleTimeString([], { hour12: false });
  const avg = (sum, n) => (n ? Math.round(sum / n) : 0);
  return [
    `${title}: since ${new Date(d.since).toLocaleString([], { hour12: false })}`,
    `conversations opened: ${d.opens}, on screen after ${avg(d.openMs, d.opens)} ms on average`,
    `folder searches: ${d.scans}, ${d.scanMs} ms in total, longest ${d.scanMax} ms`,
    `message texts read: ${d.bodies} (${d.bodyMs} ms in total, longest ${d.bodyMax} ms), taken from the saved copy: ${d.bodiesFromDisk}, large ones skipped: ${d.bigSkipped}`,
    ...d.events.slice(-60).map(([at, kind, ms, extra]) => `  ${time(at)}  ${kind.padEnd(12)} ${String(ms).padStart(6)} ms  ${extra}`),
  ].join("\n");
}
browser.storage.local.get("diag").then(({ diag }) => {
  const text = diag ? [describe(diag.current, "this session"), describe(diag.previous, "previous session")].filter(Boolean).join("\n\n") : "-";
  document.getElementById("diag").textContent = text;
  document.getElementById("copy").addEventListener("click", () => navigator.clipboard.writeText(text));
});
