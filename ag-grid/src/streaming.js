import { createTracker, setLicense } from "./grid.js";
import { mountTable, normalizeData, tableExports } from "./table.js";

export const FLUSH_MS = 150;

export function applyMessage(byId, message, idField = "id") {
  const touched = new Set();
  const removed = new Set();
  let replaced = false;
  const keep = (row) => {
    if (!row || typeof row !== "object" || row[idField] === undefined || row[idField] === null) return;
    const id = String(row[idField]);
    byId.set(id, byId.has(id) ? { ...byId.get(id), ...row } : row);
    touched.add(id);
    removed.delete(id);
  };
  if (message?.op === "snapshot" && Array.isArray(message.rows)) {
    byId.clear();
    replaced = true;
    message.rows.forEach(keep);
  } else if (message?.op === "upsert" && Array.isArray(message.rows)) {
    message.rows.forEach(keep);
  } else if (message?.op === "remove" && Array.isArray(message.ids)) {
    for (const raw of message.ids) {
      const id = String(raw);
      byId.delete(id);
      touched.delete(id);
      removed.add(id);
    }
  }
  return { touched, removed, replaced };
}

export function statusText(event) {
  if (event.state === "live") return "Live";
  if (event.state === "retrying") return `Disconnected, retrying in ${event.retryIn} s`;
  if (event.state === "closed") return "Closed";
  return "Connecting…";
}

let handle = null;
let tracker = null;

export default {
  initialize({ model }) {
    setLicense(model);
    return tableExports(() => handle, () => tracker);
  },

  async render({ model, el, signal, experimental }) {
    el.replaceChildren();
    const root = document.createElement("div");
    root.className = "ag-stack";
    const status = document.createElement("div");
    status.className = "ag-strip";
    status.setAttribute("aria-live", "polite");
    const gridEl = document.createElement("div");
    gridEl.className = "ag-fill";
    root.append(status, gridEl);
    el.appendChild(root);

    const saved = model.get("state") || {};
    tracker = createTracker(model, { chartView: saved.chartView ?? null, agentPrompt: null, grid: saved.grid ?? null });
    handle = mountTable({ model, el: gridEl, signal, experimental, tracker, saved });

    const byId = new Map();
    const idField = () => handle.idField();
    const seed = () => {
      const rows = normalizeData(model.get("data"), model.get("definition") || {}).rowData ?? [];
      byId.clear();
      for (const row of rows) if (row && row[idField()] !== undefined && row[idField()] !== null) byId.set(String(row[idField()]), row);
    };
    seed();

    let dirty = false;
    const flusher = setInterval(() => {
      if (!dirty || !handle) return;
      dirty = false;
      handle.setRows([...byId.values()]);
    }, FLUSH_MS);

    const say = (text, live = false) => {
      status.textContent = text;
      status.dataset.live = String(live);
    };
    say("Connecting…");

    const onEvent = (event) => {
      if (event?.kind !== "workspace-event") return;
      if (event.name === "stream-status") {
        say(statusText(event), event.state === "live");
      } else if (event.name === "stream" && Array.isArray(event.messages)) {
        for (const message of event.messages) {
          const change = applyMessage(byId, message, idField());
          if (change.replaced || change.touched.size || change.removed.size) dirty = true;
        }
      }
    };
    const onData = () => {
      if (model.get("data") === undefined || model.get("data") === null) return;
      seed();
    };

    model.on("msg:custom", onEvent);
    model.on("change:data", onData);
    signal.addEventListener("abort", () => {
      clearInterval(flusher);
      model.off("msg:custom", onEvent);
      model.off("change:data", onData);
      handle = null;
    });
  },
};
