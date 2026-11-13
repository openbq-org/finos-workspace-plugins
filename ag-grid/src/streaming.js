import { createTracker, keyOf, setLicense } from "./grid.js";
import { mountTable, normalizeData, tableExports } from "./table.js";

export const FLUSH_MS = 150;

export const DEFAULT_MAX_STREAM_ROWS = 5000;

/** The fields an update may change: those of columns with `enableCellChangeWs: true`, when any column says so. */
export function updatableFields(definition) {
  const defs = Array.isArray(definition?.columnsDefs) ? definition.columnsDefs : [];
  const fields = defs.filter((d) => d?.field && d.enableCellChangeWs === true).map((d) => d.field);
  return fields.length ? new Set(fields) : null;
}

/**
 * Applies one stream message to the rows by id. A message is `{ op: "snapshot", rows }`,
 * `{ op: "upsert", rows }` or `{ op: "remove", ids }`, whose rows need an id; or a row, or a list
 * of rows, with no `op`, which updates the rows it identifies and adds the others after the last
 * row, a row without an id included, as a log or a tape is. `options`: `allowed`, the fields an update may change
 * (all when null), and `maxRows`, above which the oldest rows go.
 */
export function applyMessage(byId, message, idField = "id", { allowed = null, maxRows = DEFAULT_MAX_STREAM_ROWS, counter = { next: 0 }, newestFirst = false } = {}) {
  const added = [];
  const touched = new Set();
  const removed = new Set();
  let replaced = false;
  const keep = (row, append = false) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return;
    const own = keyOf(row, idField);
    if (own === null && !append) return;
    const id = own ?? `~s${counter.next++}`;
    if (byId.has(id)) {
      const current = byId.get(id);
      const changes = allowed ? Object.fromEntries(Object.entries(row).filter(([key]) => allowed.has(key))) : row;
      byId.set(id, { ...current, ...changes });
    } else if (newestFirst) {
      added.push([id, row]);
    } else {
      byId.set(id, row);
    }
    touched.add(id);
    removed.delete(id);
  };
  if (message?.op === "snapshot" && Array.isArray(message.rows)) {
    byId.clear();
    replaced = true;
    for (const row of message.rows) keep(row);
  } else if (message?.op === "upsert" && Array.isArray(message.rows)) {
    for (const row of message.rows) keep(row);
  } else if (message?.op === "remove" && Array.isArray(message.ids)) {
    for (const raw of message.ids) {
      const id = String(raw);
      byId.delete(id);
      touched.delete(id);
      removed.add(id);
    }
  } else if (Array.isArray(message)) {
    for (const row of message) keep(row, true);
  } else if (message && typeof message === "object" && message.op === undefined) {
    keep(message, true);
  }
  if (added.length) {
    const before = [...byId];
    byId.clear();
    for (const [id, row] of [...added.reverse(), ...before]) byId.set(id, row);
  }
  while (byId.size > maxRows) {
    const oldest = newestFirst ? [...byId.keys()].at(-1) : byId.keys().next().value;
    byId.delete(oldest);
    touched.delete(oldest);
    removed.add(oldest);
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
    const counter = { next: 0 };
    const streamOptions = () => {
      const definition = model.get("definition") || {};
      const maxRows = Number.isInteger(definition.maxStreamRows) && definition.maxStreamRows > 0 ? definition.maxStreamRows : DEFAULT_MAX_STREAM_ROWS;
      return { allowed: updatableFields(definition), maxRows, counter, newestFirst: definition.streamNewestFirst === true };
    };
    const seed = () => {
      const rows = normalizeData(model.get("data"), model.get("definition") || {}).rowData ?? [];
      byId.clear();
      for (const row of rows) if (row && typeof row === "object") byId.set(keyOf(row, idField()) ?? `~s${counter.next++}`, row);
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
          const change = applyMessage(byId, message, idField(), streamOptions());
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
