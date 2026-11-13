/*
 * First-run tips: a strip that shows a widget's tips one at a time, with Next and Got it. Got it
 * is saved with the card; the organization's admin setting `showTips: false` turns tips off.
 */

export const TIPS = {
  table: [
    "Select cells and right-click to chart them, copy them, or ask the AI agent about them.",
    "Double-click a column header to select the whole column; the status bar sums it.",
    "The Formulas panel in the side bar adds columns calculated from the others.",
    "The card menu transposes, resets or reverses the columns, and adds a chart as its own widget.",
  ],
  streaming: [
    "Rows change as the feed sends them; changed cells flash and show how far they moved.",
    "Select cells and right-click to chart them, copy them, or ask the AI agent about them.",
  ],
  ssrm: [
    "Rows load from the server a page at a time; sorting, filters and grouping are done there.",
    "Chart (this page) draws the rows of the current page.",
  ],
  infinite: ["Rows load in blocks as you scroll.", "Select cells and right-click to chart them or ask the AI agent about them."],
  file: [
    "Drop a CSV, TSV, JSON, Excel or Parquet file on the card, or use Open file.",
    "A file opened from your computer is not saved: Add as a table widget keeps a copy on the dashboard.",
  ],
  sql: [
    "Shift+Enter runs the query.",
    "Write {{name}} for a value you want to change, and define it with Parameters.",
    "Copy table copies the result with its headers; Create static widget keeps it on the dashboard.",
  ],
};

export function tipsEnabled(model) {
  return (model?.get("adminSettings") || {}).showTips !== false;
}

/**
 * Mounts the strip before `before` in `container`, unless tips are off or done. `onDone` saves
 * that the user has seen them. Returns { destroy }.
 */
export function mountTips(container, { tips, model, done = false, onDone = () => {}, before = container.firstChild }) {
  if (done || !tipsEnabled(model) || !tips?.length) return { destroy() {} };
  const doc = container.ownerDocument ?? document;
  const strip = doc.createElement("div");
  strip.className = "ag-grid-tips";
  strip.setAttribute("role", "note");
  const text = doc.createElement("span");
  text.className = "ag-grid-tips-text";
  const next = doc.createElement("button");
  next.type = "button";
  next.className = "ag-grid-tips-button";
  const close = doc.createElement("button");
  close.type = "button";
  close.className = "ag-grid-tips-button";
  close.textContent = "Got it";
  let at = 0;
  const show = () => {
    text.textContent = `Tip ${at + 1} of ${tips.length}: ${tips[at]}`;
    next.textContent = at + 1 < tips.length ? "Next tip" : "First tip";
    next.hidden = tips.length < 2;
  };
  next.addEventListener("click", () => {
    at = (at + 1) % tips.length;
    show();
  });
  close.addEventListener("click", () => {
    strip.remove();
    onDone();
  });
  strip.append(text, next, close);
  container.insertBefore(strip, before ?? null);
  show();
  return { destroy: () => strip.remove() };
}
