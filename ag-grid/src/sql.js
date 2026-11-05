import { createGrid, formatNumber, gridOptionsFor, MAX_STATE_TEXT, applyTheme, paintSite, rowsOf, setLicense } from "./grid.js";

export const SQL_PARAM = "sql";
export const MAX_SQL = MAX_STATE_TEXT;
export const REFUSAL_GRACE_MS = 1_000;
const SAVE_MS = 600;

const NUMERIC_TYPE = /^(numeric|decimal|integer|int\d?|bigint|smallint|tinyint|hugeint|ubigint|uinteger|usmallint|utinyint|real|double|float\d?)\b/i;

export function isNumeric(column, value) {
  return typeof value === "number" || NUMERIC_TYPE.test(column?.type ?? "");
}

export function identifier(name) {
  return /^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name.replaceAll('"', '""')}"`;
}

export function resultOf(data) {
  if (!data || typeof data !== "object") return null;
  if (typeof data.error === "string") return { error: data.error };
  if (Array.isArray(data.columns) && Array.isArray(data.rows)) {
    return {
      columns: data.columns.map((c) => (typeof c === "string" ? { name: c, type: "" } : { name: String(c?.name ?? ""), type: String(c?.type ?? "") })),
      rows: data.rows,
      truncated: data.truncated === true,
      elapsedMs: typeof data.elapsedMs === "number" ? data.elapsedMs : null,
    };
  }
  const records = rowsOf(data);
  if (!records.length) return null;
  const names = [...new Set(records.flatMap((r) => (r && typeof r === "object" ? Object.keys(r) : [])))];
  return {
    columns: names.map((name) => ({ name, type: "" })),
    rows: records.map((r) => names.map((n) => r?.[n] ?? null)),
    truncated: data.truncated === true,
    elapsedMs: typeof data.elapsedMs === "number" ? data.elapsedMs : null,
  };
}

export function schemaOf(data) {
  const schema = data && typeof data === "object" ? data.schema : null;
  if (!schema || typeof schema !== "object" || !Array.isArray(schema.tables)) return null;
  return {
    engine: typeof schema.engine === "string" ? schema.engine : "",
    skipped: Array.isArray(schema.skipped) ? schema.skipped.map(String) : [],
    tables: schema.tables
      .filter((t) => t && typeof t.name === "string")
      .map((t) => ({
        schema: typeof t.schema === "string" ? t.schema : null,
        name: t.name,
        file: typeof t.file === "string" ? t.file : null,
        columns: (Array.isArray(t.columns) ? t.columns : []).filter((c) => c && typeof c.name === "string").map((c) => ({ name: c.name, type: String(c.type ?? "") })),
      })),
  };
}

export function csvOf(result) {
  const quote = (value) => {
    if (value === null || value === undefined) return "";
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [result.columns.map((c) => c.name), ...result.rows].map((row) => row.map(quote).join(",")).join("\n");
}

export function formatCell(params) {
  const { value } = params;
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return formatNumber(params);
}

export function gridColumns(result) {
  const first = result.rows[0] ?? [];
  return result.columns.map((column, i) => ({
    field: String(i),
    headerName: column.name,
    headerTooltip: column.type,
    valueFormatter: formatCell,
    ...(isNumeric(column, first[i]) ? { type: "numericColumn" } : {}),
  }));
}

export function gridRows(result) {
  return result.rows.map((row) => Object.fromEntries(row.map((value, i) => [String(i), value])));
}

export function contextOf(run) {
  if (!run) return null;
  const base = { sql: run.sql.slice(0, 4000), engine: run.engine };
  if (run.error) return { ...base, error: run.error };
  return { ...base, columns: run.result.columns, rows: run.result.rows.length, truncated: run.result.truncated };
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let lastRun = null;

export default {
  initialize({ model }) {
    setLicense(model);
    return {
      async exportOptions() {
        if (!lastRun?.result) return [];
        return [
          { id: "csv", label: "Result (CSV)", extension: "csv", mime: "text/csv" },
          { id: "json", label: "Result and query (JSON)", extension: "json", mime: "application/json" },
        ];
      },
      async exportData(id) {
        if (!lastRun?.result) return null;
        if (id === "csv") return csvOf(lastRun.result);
        if (id === "json") return JSON.stringify({ engine: lastRun.engine, sql: lastRun.sql, ...lastRun.result }, null, 2);
        return null;
      },
      async copilotContext() {
        return contextOf(lastRun);
      },
    };
  },

  async render({ model, el, signal, experimental }) {
    const root = element("div", "sx");
    const bar = element("div", "sx-bar");
    const engine = element("span", "sx-engine");
    const assist = element("span", "sx-assist");
    const status = element("span", "sx-status");
    status.setAttribute("aria-live", "polite");
    const run = element("button", "sx-run", "Run");
    run.type = "button";
    run.title = "Run (Ctrl+Enter or ⌘+Enter)";
    bar.append(engine, assist, status, run);

    const body = element("div", "sx-body");
    const tables = element("nav", "sx-tables");
    tables.setAttribute("aria-label", "Tables");
    const main = element("div", "sx-main");
    const editor = element("textarea", "sx-editor");
    editor.spellcheck = false;
    editor.maxLength = MAX_SQL;
    editor.setAttribute("aria-label", "SQL");
    editor.setAttribute("aria-autocomplete", "list");
    const popup = element("ul", "sx-complete");
    popup.id = "sx-complete";
    popup.setAttribute("role", "listbox");
    popup.hidden = true;
    editor.setAttribute("aria-controls", popup.id);
    const output = element("div", "sx-output");
    main.append(editor, output, popup);
    body.append(tables, main);
    root.append(bar, body);
    el.replaceChildren(root);

    const declared = () => Object.hasOwn(model.get("params") || {}, SQL_PARAM);
    const paramSql = () => String(model.get("params")?.[SQL_PARAM] ?? "");
    const saved = model.get("state");
    editor.value = typeof saved?.sql === "string" ? saved.sql.slice(0, MAX_SQL) : paramSql();

    let api = null;
    let gridHost = null;
    let pending = null;
    let known = [];

    const showMessage = (text, kind) => {
      api?.destroy();
      api = null;
      output.replaceChildren(element("pre", `sx-message sx-${kind}`, text));
    };

    const showGrid = (result) => {
      const rowData = gridRows(result);
      const columnDefs = gridColumns(result);
      if (api) {
        api.setGridOption("columnDefs", columnDefs);
        api.setGridOption("rowData", rowData);
        return;
      }
      gridHost = element("div", "sx-grid");
      output.replaceChildren(gridHost);
      api = createGrid(gridHost, gridOptionsFor({ model, columnDefs, rowData, pagination: rowData.length > 100 }));
    };

    const showTables = (schema) => {
      engine.textContent = schema.engine;
      const list = element("ul", "sx-tree");
      for (const table of schema.tables) {
        const qualified = table.schema && table.schema !== "public" && table.schema !== "main" ? `${identifier(table.schema)}.${identifier(table.name)}` : identifier(table.name);
        const item = element("li");
        const details = element("details");
        const summary = element("summary");
        const name = element("button", "sx-name", table.schema && table.schema !== "public" && table.schema !== "main" ? `${table.schema}.${table.name}` : table.name);
        name.type = "button";
        name.title = table.file ? `${table.file}: insert ${qualified}` : `Insert ${qualified}`;
        name.addEventListener("click", (event) => {
          event.preventDefault();
          insert(qualified);
        });
        summary.append(name);
        const columns = element("ul");
        for (const column of table.columns) {
          const columnItem = element("li");
          const columnButton = element("button", "sx-column", column.name);
          columnButton.type = "button";
          columnButton.title = `${column.type}: insert ${identifier(column.name)}`;
          columnButton.addEventListener("click", () => insert(identifier(column.name)));
          columnItem.append(columnButton, element("span", "sx-type", column.type));
          columns.append(columnItem);
        }
        details.append(summary, columns);
        item.append(details);
        list.append(item);
      }
      const notes = schema.skipped.map((text) => element("p", "sx-note", `Not read: ${text}`));
      if (!schema.tables.length) notes.unshift(element("p", "sx-note", "No tables."));
      tables.replaceChildren(list, ...notes);
    };

    const onData = () => {
      const data = model.get("data");
      if (data === undefined || data === null) {
        if (pending) status.textContent = "Running…";
        return;
      }
      const schema = schemaOf(data);
      if (schema) {
        known = schema.tables;
        showTables(schema);
        mirror();
      }
      const sql = paramSql();
      const result = resultOf(data);
      pending = null;
      run.disabled = false;
      if (!result) {
        status.textContent = "";
        if (!sql.trim()) output.replaceChildren();
        return;
      }
      if (result.error) {
        lastRun = { sql, engine: engine.textContent, error: result.error };
        status.textContent = "Failed";
        showMessage(result.error, "error");
        return;
      }
      lastRun = { sql, engine: engine.textContent, result };
      const count = result.rows.length.toLocaleString("en");
      status.textContent = `${count} ${result.rows.length === 1 ? "row" : "rows"}${result.truncated ? " (the first; there are more)" : ""}${result.elapsedMs === null ? "" : ` · ${result.elapsedMs} ms`}`;
      showGrid(result);
    };

    const execute = () => {
      const sql = editor.value;
      if (!sql.trim()) return;
      if (!declared()) {
        showMessage(`The widget declares no ${SQL_PARAM} body parameter in widgets.json.`, "refused");
        return;
      }
      if (sql === paramSql()) {
        onData();
        return;
      }
      pending = sql;
      run.disabled = true;
      status.textContent = "Running…";
      model.set("params", { ...(model.get("params") || {}), [SQL_PARAM]: sql });
      model.save_changes();
    };

    const onParams = () => {
      if (pending === null || paramSql() === pending) return;
      const waiting = pending;
      setTimeout(() => {
        if (pending !== waiting || paramSql() === waiting) return;
        pending = null;
        run.disabled = false;
        status.textContent = "Not run";
        showMessage(`The host refused the query: at most ${MAX_SQL.toLocaleString("en")} characters.`, "refused");
      }, REFUSAL_GRACE_MS);
    };

    let saveTimer;
    const save = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        model.set("state", { sql: editor.value });
        model.save_changes();
      }, SAVE_MS);
    };

    const insert = (text) => {
      const start = editor.selectionStart ?? editor.value.length;
      const end = editor.selectionEnd ?? start;
      editor.setRangeText(text, start, end, "end");
      editor.focus();
      editor.dispatchEvent(new Event("input"));
    };

    let completer = null;
    let starting = null;
    let items = [];
    let active = 0;
    let asking = 0;
    let suggestTimer;

    const mirror = () => {
      if (completer && known.length) completer.mirror(known);
    };

    const readAsset = async (path) => {
      const [, [bytes]] = await experimental.invoke("core:asset:read", { path }, { timeout: 60_000, signal });
      return bytes;
    };

    const startCompletion = () => {
      starting ??= (async () => {
        assist.textContent = "Completion starting…";
        try {
          const { startCompleter } = await import("./sql/duckdb.js");
          completer = await startCompleter(readAsset);
          mirror();
          assist.textContent = "";
        } catch (error) {
          assist.textContent = "No completion";
          assist.title = error instanceof Error ? error.message : String(error);
        }
      })();
      return starting;
    };

    const closePopup = () => {
      asking += 1;
      items = [];
      popup.hidden = true;
      popup.replaceChildren();
      editor.removeAttribute("aria-activedescendant");
    };

    const highlight = (index) => {
      active = index;
      [...popup.children].forEach((child, i) => child.setAttribute("aria-selected", String(i === index)));
      popup.children[index]?.scrollIntoView({ block: "nearest" });
      editor.setAttribute("aria-activedescendant", `sx-option-${index}`);
    };

    const accept = (index) => {
      const suggestion = items[index];
      closePopup();
      if (!suggestion) return;
      editor.setRangeText(suggestion.text, suggestion.start, editor.selectionStart, "end");
      editor.dispatchEvent(new Event("input"));
    };

    const caretPoint = () => {
      const style = getComputedStyle(editor);
      const copy = document.createElement("div");
      for (const property of ["boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "tabSize"])
        copy.style[property] = style[property];
      Object.assign(copy.style, { position: "absolute", visibility: "hidden", whiteSpace: "pre-wrap", overflowWrap: "break-word", top: "0", left: "0" });
      copy.textContent = editor.value.slice(0, editor.selectionStart);
      const marker = document.createElement("span");
      marker.textContent = "​";
      copy.append(marker);
      document.body.append(copy);
      const point = { left: marker.offsetLeft - editor.scrollLeft, top: marker.offsetTop - editor.scrollTop, height: Number.parseFloat(style.lineHeight) || 18 };
      copy.remove();
      return point;
    };

    const suggest = async (asked) => {
      if (!completer) return closePopup();
      const cursor = editor.selectionStart;
      const before = editor.value.slice(0, cursor);
      if (cursor !== editor.selectionEnd || (!asked && !/[A-Za-z0-9_."]$/.test(before))) return closePopup();
      const ticket = ++asking;
      let found;
      try {
        found = await completer.suggest(before);
      } catch {
        return closePopup();
      }
      if (ticket !== asking || editor.selectionStart !== cursor || document.activeElement !== editor) return;
      if (!found.length) return closePopup();
      items = found;
      popup.replaceChildren(
        ...found.map((suggestion, i) => {
          const option = element("li", `sx-option sx-${suggestion.kind}`);
          option.id = `sx-option-${i}`;
          option.setAttribute("role", "option");
          option.append(element("span", "sx-suggestion", suggestion.text.trimEnd()), element("span", "sx-kind", suggestion.kind));
          option.addEventListener("mousedown", (event) => event.preventDefault());
          option.addEventListener("click", () => accept(i));
          return option;
        }),
      );
      popup.hidden = false;
      const point = caretPoint();
      const left = editor.offsetLeft + point.left;
      popup.style.left = `${Math.max(0, Math.min(left, main.clientWidth - popup.offsetWidth - 4))}px`;
      popup.style.top = `${editor.offsetTop + point.top + point.height}px`;
      highlight(0);
    };

    editor.addEventListener("focus", () => startCompletion(), { once: true });
    editor.addEventListener("input", (event) => {
      save();
      if (event.inputType === "insertText" || (event.inputType === "deleteContentBackward" && !popup.hidden)) {
        clearTimeout(suggestTimer);
        suggestTimer = setTimeout(() => suggest(false), 30);
      } else if (event.isTrusted) closePopup();
    });
    editor.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        closePopup();
        execute();
        return;
      }
      if (event.key === " " && event.ctrlKey) {
        event.preventDefault();
        startCompletion().then(() => suggest(true));
        return;
      }
      if (popup.hidden) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        highlight((active + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length);
      } else if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        accept(active);
      } else if (event.key === "Escape") {
        event.preventDefault();
        closePopup();
      } else if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
        closePopup();
      }
    });
    for (const name of ["blur", "click", "scroll"]) editor.addEventListener(name, closePopup);
    run.addEventListener("click", execute);

    const onTheme = () => {
      paintSite(model.get("theme"), root);
      applyTheme(api, model);
    };

    model.on("change:data", onData);
    model.on("change:params", onParams);
    model.on("change:theme", onTheme);
    model.on("change:config", onTheme);
    signal.addEventListener("abort", () => {
      clearTimeout(saveTimer);
      clearTimeout(suggestTimer);
      model.off("change:data", onData);
      model.off("change:params", onParams);
      model.off("change:theme", onTheme);
      model.off("change:config", onTheme);
      api?.destroy();
      api = null;
    });

    onTheme();
    if (!declared()) showMessage(`The widget declares no ${SQL_PARAM} body parameter in widgets.json.`, "refused");
    else onData();
  },
};
