import { renderMarkdown } from "./ag-table-chart/markdown.js";
import { compactColumnDefs, createGrid, createStateChannel, formatNumber, gridOptionsFor, MAX_STATE_TEXT, applyTheme, paintSite, rowsOf, setLicense, STATE_PARAM } from "./grid.js";
import { PARAM_TYPES, placeholdersOf, savedSqlParams, savedSqlValues, substitute } from "./sqlParams.js";
import { createDatasource, optionsFor as serverOptionsFor, startColumnsOf } from "./ssrm.js";

export const SQL_PARAM = "sql";
/** The body param that carries the query: `sql`, or `query` for a backend that names it so. */
export const QUERY_PARAMS = [SQL_PARAM, "query"];

export function queryParamOf(params) {
  return QUERY_PARAMS.find((name) => Object.hasOwn(params || {}, name)) ?? SQL_PARAM;
}

/** The result as tab-separated text, for the clipboard: a header row, then the rows. */
export function tsvOf(result) {
  const cell = (v) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)).replace(/[\t\r\n]+/g, " ");
  return [result.columns.map((c) => cell(c.name)).join("\t"), ...result.rows.map((row) => row.map(cell).join("\t"))].join("\n");
}

/** A result of one text cell longer than this shows as formatted text instead of a grid. */
export const LONG_TEXT = 100;

export function longTextOf(result) {
  const value = result?.rows?.length === 1 && result.columns.length === 1 ? result.rows[0][0] : null;
  return typeof value === "string" && value.length > LONG_TEXT ? value : null;
}
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

export const ACTION_FREEZE = "freeze";
export const STATIC_WIDGET = "table";
const MAX_STATIC_ROWS = 1000;
const MAX_STATIC_COLUMNS = 60;
const MAX_STATIC_TEXT = 500;
const MAX_STATIC_HEADER = 100;
export const MAX_STATIC_BYTES = 380_000;

const byteSize = (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

function staticValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return text.slice(0, MAX_STATIC_TEXT);
}

export function staticTableData(result) {
  const columnDefs = gridColumns(result)
    .slice(0, MAX_STATIC_COLUMNS)
    .map(({ field, headerName, type }) => ({ field, headerName: String(headerName).slice(0, MAX_STATIC_HEADER), ...(type ? { type } : {}) }));
  const fields = columnDefs.map((column) => column.field);
  let budget = MAX_STATIC_BYTES - byteSize({ columnDefs, rowData: [] });
  const rowData = [];
  for (const row of gridRows(result).slice(0, MAX_STATIC_ROWS)) {
    const copy = Object.fromEntries(fields.map((field) => [field, staticValue(row[field])]));
    budget -= byteSize(copy) + 1;
    if (budget < 0) break;
    rowData.push(copy);
  }
  return { columnDefs, rowData };
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
    run.title = "Run (Shift+Enter, Ctrl+Enter or ⌘+Enter)";
    const missingBadge = element("button", "sx-missing");
    missingBadge.type = "button";
    missingBadge.hidden = true;
    const paramsButton = element("button", "sx-tool", "Parameters");
    paramsButton.type = "button";
    paramsButton.title = "Define the {{name}} parameters of the query";
    const copyQuery = element("button", "sx-tool", "Copy query");
    copyQuery.type = "button";
    const copyTable = element("button", "sx-tool", "Copy table");
    copyTable.type = "button";
    copyTable.title = "Copy the result as tab-separated text";
    const toggleEditor = element("button", "sx-tool");
    toggleEditor.type = "button";
    bar.append(engine, assist, status, missingBadge, paramsButton, copyQuery, copyTable, toggleEditor, run);
    const paramStrip = element("div", "sx-params");
    paramStrip.setAttribute("role", "group");
    paramStrip.setAttribute("aria-label", "Query parameters");
    const paramEditor = element("div", "sx-param-editor");
    paramEditor.hidden = true;

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
    const preview = element("div", "sx-preview");
    preview.hidden = true;
    preview.setAttribute("aria-live", "polite");
    main.append(editor, preview, output, popup);
    body.append(tables, main);
    root.append(bar, paramStrip, paramEditor, body);
    el.replaceChildren(root);

    const queryParam = () => queryParamOf(model.get("params"));
    const declared = () => QUERY_PARAMS.some((name) => Object.hasOwn(model.get("params") || {}, name));
    const paramSql = () => String(model.get("params")?.[queryParam()] ?? "");
    const saved = model.get("state");
    editor.value = typeof saved?.sql === "string" ? saved.sql.slice(0, MAX_SQL) : paramSql();
    let sqlDefs = savedSqlParams(saved?.sqlParams);
    let sqlValues = savedSqlValues(saved?.sqlValues, sqlDefs);
    let editorHidden = saved?.editorHidden === true;
    let editorHeight = Number.isInteger(saved?.editorHeight) && saved.editorHeight >= 40 && saved.editorHeight <= 2000 ? saved.editorHeight : null;
    if (editorHeight) editor.style.height = `${editorHeight}px`;
    let lastSent = null;
    const sourceKey = () => JSON.stringify([editor.value, sqlValues]);

    let api = null;
    let gridHost = null;
    let pending = null;
    let known = [];
    const definition = model.get("definition") || {};
    const serverSide = definition.serverSide === true;
    const channel = serverSide ? createStateChannel(model) : null;
    let paging = false;

    const showMessage = (text, kind) => {
      api?.destroy();
      api = null;
      paging = false;
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

    /**
     * The server-side grid of a query: the first answer is its first page, and every later page,
     * sort or filter is a request with the query and the grid state, as the server-side widget sends.
     */
    const showServerGrid = (data) => {
      api?.destroy();
      gridHost = element("div", "sx-grid");
      output.replaceChildren(gridHost);
      const columns = startColumnsOf(data) ?? [];
      const datasource = createDatasource({ model, channel, signal, first: data, say: (text) => { if (text) status.textContent = text; } });
      api = createGrid(gridHost, serverOptionsFor({ model, definition, columnDefs: compactColumnDefs(columns, data.rowData ?? []), datasource }));
      paging = true;
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
      if (paging && pending === null) return;
      const sql = paramSql();
      const result = resultOf(data);
      run.disabled = false;
      pending = null;
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
      const text = longTextOf(result);
      if (text) {
        api?.destroy();
        api = null;
        const block = renderMarkdown(document, text);
        block.classList.add("sx-markdown");
        output.replaceChildren(block);
        status.textContent = `1 text${result.elapsedMs === null ? "" : ` · ${result.elapsedMs} ms`}`;
        return;
      }
      if (serverSide && Array.isArray(data.rowData)) {
        const total = typeof data.rowCount === "number" ? data.rowCount : result.rows.length;
        status.textContent = `${total.toLocaleString("en")} ${total === 1 ? "row" : "rows"}, paged on the server`;
        showServerGrid(data);
        return;
      }
      const count = result.rows.length.toLocaleString("en");
      status.textContent = `${count} ${result.rows.length === 1 ? "row" : "rows"}${result.truncated ? " (the first; there are more)" : ""}${result.elapsedMs === null ? "" : ` · ${result.elapsedMs} ms`}`;
      showGrid(result);
    };

    const execute = () => {
      if (!editor.value.trim()) return;
      const filled = substitute(editor.value, sqlDefs, sqlValues);
      if (filled.missing.length) {
        showMessage(`Define the parameter${filled.missing.length > 1 ? "s" : ""} ${filled.missing.map((n) => `{{${n}}}`).join(", ")} first: press ${missingBadge.textContent}.`, "refused");
        return;
      }
      if (filled.errors.length) {
        showMessage(filled.errors.join("\n"), "refused");
        return;
      }
      const sql = filled.sql;
      lastSent = sourceKey();
      run.classList.remove("sx-stale");
      if (!declared()) {
        showMessage(`The widget declares no ${SQL_PARAM} (or query) body parameter in widgets.json.`, "refused");
        return;
      }
      if (sql === paramSql()) {
        if (paging) api.refreshServerSide({ purge: true });
        else onData();
        return;
      }
      if (serverSide && !channel.declared) {
        showMessage(`A server-side SQL widget declares the ${STATE_PARAM} body parameter too.`, "refused");
        return;
      }
      paging = false;
      pending = sql;
      run.disabled = true;
      status.textContent = "Running…";
      model.set("params", { ...(model.get("params") || {}), [queryParam()]: sql, ...(serverSide ? { [STATE_PARAM]: "" } : {}) });
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
        model.set("state", { sql: editor.value, sqlParams: sqlDefs, sqlValues, editorHidden, ...(editorHeight ? { editorHeight } : {}) });
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

    const notify = (level, text) => experimental?.invoke?.("core:ui:notify", { level, text }).catch(() => {});

    /** Whether the query or a parameter changed since the last run. */
    const markStale = () => {
      const stale = lastSent !== null && lastSent !== sourceKey();
      run.classList.toggle("sx-stale", stale);
      if (stale && !pending) status.textContent = "Changed: press Run";
    };

    /** The query as it will run, with each {{name}} filled in, or what stops it from running. */
    const updatePreview = () => {
      if (!placeholdersOf(editor.value).length || editorHidden) {
        preview.hidden = true;
        return;
      }
      const filled = substitute(editor.value, sqlDefs, sqlValues);
      preview.hidden = false;
      preview.dataset.state = filled.missing.length || filled.errors.length ? "error" : "ok";
      preview.textContent = filled.missing.length
        ? `Not ready: define ${filled.missing.map((n) => `{{${n}}}`).join(", ")}`
        : filled.errors.length
          ? `Not ready: ${filled.errors.join(" ")}`
          : `Runs as: ${filled.sql.replace(/\s+/g, " ").trim()}`;
      preview.title = preview.textContent;
    };

    const updateBadge = () => {
      const defined = new Set(sqlDefs.map((d) => d.name));
      const missing = placeholdersOf(editor.value).filter((name) => !defined.has(name));
      missingBadge.hidden = !missing.length;
      missingBadge.textContent = `${missing.length} undefined`;
      missingBadge.title = missing.length ? `Define ${missing.map((n) => `{{${n}}}`).join(", ")}` : "";
      updatePreview();
      return missing;
    };

    const drawParams = () => {
      paramStrip.replaceChildren();
      paramStrip.hidden = !sqlDefs.length;
      for (const def of sqlDefs) {
        const label = element("label", "sx-param");
        label.append(element("span", "sx-param-label", def.label));
        let input;
        const current = Object.hasOwn(sqlValues, def.name) ? sqlValues[def.name] : def.type === "list" && def.multiple ? (def.default ? def.default.split(",").map((v) => v.trim()) : []) : def.default;
        if (def.type === "boolean") {
          input = element("input");
          input.type = "checkbox";
          input.checked = current === true || current === "true";
        } else if (def.type === "list") {
          input = element("select");
          input.multiple = def.multiple;
          for (const option of def.options) {
            const node = element("option", undefined, option);
            node.value = option;
            node.selected = Array.isArray(current) ? current.includes(option) : current === option;
            input.append(node);
          }
        } else {
          input = element("input");
          input.type = def.type === "number" ? "number" : def.type === "date" ? "date" : "text";
          input.maxLength = 500;
          input.value = Array.isArray(current) ? current.join(", ") : String(current ?? "");
        }
        input.className = "sx-param-input";
        input.dataset.param = def.name;
        input.addEventListener("change", () => {
          sqlValues = {
            ...sqlValues,
            [def.name]: def.type === "boolean" ? input.checked : def.type === "list" && def.multiple ? [...input.selectedOptions].map((o) => o.value) : input.value,
          };
          save();
          markStale();
          updatePreview();
        });
        label.append(input);
        paramStrip.append(label);
      }
    };

    /** The panel that defines the parameters: name, label, type, default and, for a list, its options. */
    const drawParamEditor = (seed = []) => {
      const rows = [...sqlDefs.map((d) => ({ ...d, options: d.options.join(", ") })), ...seed.map((name) => ({ name, label: name, type: "text", default: "", options: "", multiple: false }))];
      paramEditor.replaceChildren();
      const table = element("div", "sx-param-rows");
      const draw = () => {
        table.replaceChildren();
        rows.forEach((row, i) => {
          const line = element("div", "sx-param-row");
          const field = (key, placeholder, width) => {
            const input = element("input", "sx-param-input");
            input.value = row[key] ?? "";
            input.placeholder = placeholder;
            input.maxLength = key === "options" ? 2000 : 100;
            input.style.width = width;
            input.setAttribute("aria-label", placeholder);
            input.addEventListener("input", () => { row[key] = input.value; });
            return input;
          };
          const type = element("select", "sx-param-input");
          type.setAttribute("aria-label", "Type");
          for (const name of PARAM_TYPES) {
            const option = element("option", undefined, name);
            option.value = name;
            option.selected = row.type === name;
            type.append(option);
          }
          type.addEventListener("change", () => {
            row.type = type.value;
            draw();
          });
          line.append(field("name", "name", "9em"), field("label", "Label", "9em"), type, field("default", "Default", "8em"));
          if (row.type === "list") {
            line.append(field("options", "Options, comma-separated", "14em"));
            const multiple = element("label", "sx-param-check");
            const box = element("input");
            box.type = "checkbox";
            box.checked = row.multiple === true;
            box.addEventListener("change", () => { row.multiple = box.checked; });
            multiple.append(box, " several");
            line.append(multiple);
          }
          const remove = element("button", "sx-tool", "Remove");
          remove.type = "button";
          remove.addEventListener("click", () => {
            rows.splice(i, 1);
            draw();
          });
          line.append(remove);
          table.append(line);
        });
      };
      draw();
      const add = element("button", "sx-tool", "Add parameter");
      add.type = "button";
      add.addEventListener("click", () => {
        rows.push({ name: `param${rows.length + 1}`, label: "", type: "text", default: "", options: "", multiple: false });
        draw();
      });
      const done = element("button", "sx-run", "Done");
      done.type = "button";
      const message = element("span", "sx-note");
      done.addEventListener("click", () => {
        const next = savedSqlParams(rows.map((r) => ({ ...r, options: String(r.options ?? "").split(",").map((o) => o.trim()) })));
        if (next.length < rows.length) {
          message.textContent = "A name is letters, digits and _, starts with a letter, and is used once.";
          return;
        }
        sqlDefs = next;
        sqlValues = savedSqlValues(sqlValues, sqlDefs);
        paramEditor.hidden = true;
        drawParams();
        updateBadge();
        save();
        markStale();
      });
      const actions = element("div", "sx-param-actions");
      actions.append(add, done, message);
      paramEditor.append(element("p", "sx-note", "A query names a parameter as {{name}}; its value goes in as a quoted text, a number, a date, TRUE or FALSE, or a list."), table, actions);
      paramEditor.hidden = false;
    };

    const setEditorHidden = (hidden) => {
      editorHidden = hidden;
      editor.hidden = hidden;
      toggleEditor.textContent = hidden ? "Show editor" : "Hide editor";
      updatePreview();
    };

    const copy = async (text, done) => {
      try {
        await experimental.invoke("core:clipboard:write", { text });
        status.textContent = done;
      } catch {
        notify("warning", "The clipboard refused the copy.");
      }
    };

    paramsButton.addEventListener("click", () => (paramEditor.hidden ? drawParamEditor() : (paramEditor.hidden = true)));
    missingBadge.addEventListener("click", () => drawParamEditor(updateBadge()));
    copyQuery.addEventListener("click", () => copy(editor.value, "Query copied"));
    copyTable.addEventListener("click", () => (lastRun?.result ? copy(tsvOf(lastRun.result), "Table copied") : (status.textContent = "Run a query first.")));
    toggleEditor.addEventListener("click", () => {
      setEditorHidden(!editorHidden);
      save();
    });
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(() => {
        const height = Math.round(editor.offsetHeight);
        if (!editor.hidden && height >= 40 && height !== editorHeight && editor.style.height) {
          editorHeight = height;
          save();
        }
      }).observe(editor);
    }
    setEditorHidden(editorHidden);
    drawParams();
    updateBadge();

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
      updateBadge();
      markStale();
      if (event.inputType === "insertText" || (event.inputType === "deleteContentBackward" && !popup.hidden)) {
        clearTimeout(suggestTimer);
        suggestTimer = setTimeout(() => suggest(false), 30);
      } else if (event.isTrusted) closePopup();
    });
    editor.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey || (event.shiftKey && popup.hidden))) {
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

    const freeze = async () => {
      if (!lastRun?.result) {
        status.textContent = "Run a query first, then create a static widget of its result.";
        return;
      }
      const data = staticTableData(lastRun.result);
      try {
        await experimental.invoke("core:dashboard:add-widget", { widget: STATIC_WIDGET, data }, { signal });
        const total = lastRun.result.rows.length;
        status.textContent = data.rowData.length < total ? `Static widget created with the first ${data.rowData.length.toLocaleString("en")} of ${total.toLocaleString("en")} rows` : "Static widget created";
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : String(error);
      }
    };
    const onEvent = (event) => {
      if (event?.kind === "workspace-event" && event.name === "action" && event.id === ACTION_FREEZE) freeze();
    };

    const onTheme = () => {
      paintSite(model.get("theme"), root);
      applyTheme(api, model);
    };

    model.on("change:data", onData);
    model.on("change:params", onParams);
    model.on("change:theme", onTheme);
    model.on("change:config", onTheme);
    model.on("msg:custom", onEvent);
    signal.addEventListener("abort", () => {
      clearTimeout(saveTimer);
      clearTimeout(suggestTimer);
      model.off("change:data", onData);
      model.off("change:params", onParams);
      model.off("change:theme", onTheme);
      model.off("change:config", onTheme);
      model.off("msg:custom", onEvent);
      api?.destroy();
      api = null;
    });

    onTheme();
    if (!declared()) showMessage(`The widget declares no ${SQL_PARAM} (or query) body parameter in widgets.json.`, "refused");
    else onData();
  },
};
