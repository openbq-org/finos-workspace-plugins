/*
 * The file widget (`aggrid-file`): a CSV, TSV, JSON or Excel (.xlsx) file as an AgGrid table, with
 * everything the table widget has. The file comes from the widget's endpoint, as JSON that carries
 * it ({ file: { name, base64 | text } }, { csv }, or rows), or from the user's computer: the Open
 * file button, or a file dropped on the card. A file opened from the computer is not saved with the
 * dashboard; Add as a table widget keeps a copy of its first rows.
 */
import { fileOfAnswer, readFile } from "./files.js";
import { createTracker, rowsOf, setLicense } from "./grid.js";
import { staticTableData } from "./sql.js";
import { mountTable, tableExports } from "./table.js";

export const ACTION_OPEN_FILE = "open-file";
export const ACTION_ADD_TABLE = "add-file-table";
export const ACCEPT = ".csv,.tsv,.txt,.json,.xlsx,text/csv,text/tab-separated-values,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * A model for the table widget whose `data` is the file's rows: every other trait, command and
 * event is the widget's own.
 */
export function rowsModel(model) {
  const listeners = new Set();
  let rows;
  return {
    get: (key) => (key === "data" ? rows : model.get(key)),
    set: (key, value) => model.set(key, value),
    save_changes: () => model.save_changes(),
    send: (...args) => model.send?.(...args),
    on(name, callback) {
      if (name === "change:data") listeners.add(callback);
      else model.on(name, callback);
    },
    off(name, callback) {
      if (name === "change:data") listeners.delete(callback);
      else model.off(name, callback);
    },
    setRows(next) {
      rows = next;
      for (const callback of [...listeners]) callback();
    },
  };
}

/** The rows of a file as the result the static table copy takes. */
export function fileResult(columns, rows) {
  return { columns: columns.map((name) => ({ name, type: "" })), rows: rows.map((row) => columns.map((name) => row[name] ?? null)) };
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
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
    const root = element("div", "ag-stack");
    const strip = element("div", "ag-strip ag-file-strip");
    const name = element("span", "ag-file-name");
    const sheetPicker = element("select", "ag-file-sheet");
    sheetPicker.setAttribute("aria-label", "Sheet");
    sheetPicker.hidden = true;
    const status = element("span", "ag-file-status");
    status.setAttribute("aria-live", "polite");
    const open = element("button", "ag-file-open", "Open file");
    open.type = "button";
    const picker = element("input");
    picker.type = "file";
    picker.accept = ACCEPT;
    picker.hidden = true;
    strip.append(name, sheetPicker, status, open, picker);
    const gridEl = element("div", "ag-fill");
    root.append(strip, gridEl);
    el.appendChild(root);

    const saved = model.get("state") || {};
    tracker = createTracker(model, {
      chartView: saved.chartView ?? null,
      agentPrompt: null,
      grid: saved.grid ?? null,
      transposed: typeof saved.transposed === "boolean" ? saved.transposed : null,
      formulas: saved.formulas ?? [],
      sheet: typeof saved.sheet === "string" ? saved.sheet : null,
    });
    const rows = rowsModel(model);
    handle = mountTable({ model: rows, el: gridEl, signal, experimental, tracker, saved });

    let current = null;
    let source = null;
    const say = (text) => {
      status.textContent = text;
    };

    const show = async (file, origin) => {
      source = { file, origin };
      say("Reading…");
      try {
        const definition = model.get("definition") || {};
        const read = await readFile(file, { sheet: tracker.state.sheet ?? definition.sheet, dataKey: definition.dataKey });
        current = { ...read, name: file.name };
        name.textContent = origin === "computer" ? `${file.name} (from this computer, not saved)` : file.name;
        sheetPicker.replaceChildren(...read.sheets.map((sheet) => {
          const option = element("option", undefined, sheet);
          option.value = sheet;
          option.selected = sheet === read.sheet;
          return option;
        }));
        sheetPicker.hidden = read.sheets.length < 2;
        rows.setRows(read.rows);
        say(`${read.rows.length.toLocaleString("en")} ${read.rows.length === 1 ? "row" : "rows"}${read.truncated ? " (the first; the file has more)" : ""}`);
      } catch (error) {
        current = null;
        rows.setRows([]);
        say(error instanceof Error ? error.message : String(error));
      }
    };

    const fromAnswer = () => {
      const data = model.get("data");
      if (data === undefined || data === null) return;
      const file = fileOfAnswer(data);
      if (file) return show(file, "endpoint");
      const records = rowsOf(data);
      source = null;
      current = { columns: [...new Set(records.flatMap((r) => Object.keys(r ?? {})))], rows: records, sheets: [], name: "" };
      name.textContent = "";
      sheetPicker.hidden = true;
      rows.setRows(records);
      say(records.length ? `${records.length.toLocaleString("en")} rows` : "Open a .csv, .tsv, .json or .xlsx file, or drop one here.");
    };

    const openLocal = async (file) => {
      if (!file) return;
      const bytes = new Uint8Array(await file.arrayBuffer());
      tracker.state.sheet = null;
      await show({ name: file.name, mime: file.type, bytes }, "computer");
    };

    picker.addEventListener("change", () => {
      openLocal(picker.files?.[0]);
      picker.value = "";
    });
    open.addEventListener("click", () => picker.click());
    sheetPicker.addEventListener("change", () => {
      tracker.state.sheet = sheetPicker.value;
      tracker.persist();
      if (source) show(source.file, source.origin);
    });
    const onDragOver = (event) => {
      if ([...(event.dataTransfer?.types ?? [])].includes("Files")) {
        event.preventDefault();
        root.classList.add("ag-file-dropping");
      }
    };
    const onDragLeave = () => root.classList.remove("ag-file-dropping");
    const onDrop = (event) => {
      root.classList.remove("ag-file-dropping");
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      event.preventDefault();
      openLocal(file);
    };
    root.addEventListener("dragover", onDragOver);
    root.addEventListener("dragleave", onDragLeave);
    root.addEventListener("drop", onDrop);

    const addTable = async () => {
      if (!current?.rows?.length) {
        say("Open a file first, then add it as a table widget.");
        return;
      }
      const data = staticTableData(fileResult(current.columns, current.rows));
      try {
        await experimental.invoke("core:dashboard:add-widget", { widget: "table", data }, { signal });
        say(data.rowData.length < current.rows.length ? `Table widget added with the first ${data.rowData.length.toLocaleString("en")} of ${current.rows.length.toLocaleString("en")} rows` : "Table widget added");
      } catch (error) {
        say(error instanceof Error ? error.message : String(error));
      }
    };
    const onAction = (event) => {
      if (event?.kind !== "workspace-event" || event.name !== "action") return;
      if (event.id === ACTION_OPEN_FILE) picker.click();
      if (event.id === ACTION_ADD_TABLE) addTable();
    };

    model.on("change:data", fromAnswer);
    model.on("msg:custom", onAction);
    signal.addEventListener("abort", () => {
      model.off("change:data", fromAnswer);
      model.off("msg:custom", onAction);
      root.removeEventListener("dragover", onDragOver);
      root.removeEventListener("dragleave", onDragLeave);
      root.removeEventListener("drop", onDrop);
      handle = null;
    });

    if (model.get("data") === undefined || model.get("data") === null) say("Open a .csv, .tsv, .json or .xlsx file, or drop one here.");
    else await fromAnswer();
  },
};
