import { createChartView } from "./ag-table-chart/chartView.js";
import { agTableChartColumnDefs, changeTrackedColumns, transpose } from "./ag-table-chart/columns.js";
import {
  applyPresetState,
  applyTheme,
  attachCardActions,
  backendOptions,
  cellExpressionsOf,
  compactColumnDefs,
  copilotContextOf,
  createGrid,
  createStateChannel,
  createTracker,
  fieldsOf,
  FILTERS_TOOL_PANEL,
  gridOptionsFor,
  gridStateOf,
  idFieldOf,
  presetStateOf,
  rawCsv,
  restoreGridState,
  rowIdGetter,
  rowIdOf,
  rowsOf,
  setLicense,
  withExpressions,
} from "./grid.js";

export const CHANGE_FLASH_MS = 1500;
export const ACTION_DOWNLOAD_CHART = "download-chart";

/** The chart the download button saves: the chart view while it shows, else the chart opened last, else the hidden chart view. */
export function chartToDownload(chartIds, view) {
  const viewId = view?.chartId && chartIds.includes(view.chartId) ? view.chartId : null;
  if (viewId && view.isOpen) return viewId;
  return chartIds.filter((id) => id !== viewId).at(-1) ?? viewId;
}

export function dataUrlBytes(url) {
  const match = /^data:[^;,]*;base64,(.*)$/.exec(url ?? "");
  if (!match) return null;
  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The chart is drawn on a transparent background; paints the widget's background under it, or keeps the image as it is. */
async function onBackground(url, color) {
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    context.fillStyle = color;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (blob) return new Uint8Array(await blob.arrayBuffer());
  } catch {
    /* the plain image below */
  }
  return dataUrlBytes(url);
}

function backgroundOf(el, mode) {
  const own = getComputedStyle(document.body).getPropertyValue("--ws-background").trim();
  if (own) return own;
  const grid = el.querySelector(".ag-root-wrapper");
  const color = grid ? getComputedStyle(grid).backgroundColor : "";
  if (color && color !== "transparent" && !/rgba\(.*,\s*0\)$/.test(color)) return color;
  return mode === "dark" ? "#141414" : "#ffffff";
}

export function chartFilename(name, date = new Date()) {
  const base = String(name || "chart").trim().replace(/\s+/g, " ").slice(0, 80) || "chart";
  return `${base} ${date.toISOString().slice(0, 10)}.png`;
}
export const PAGINATE_ABOVE = 100;
export const GRID_EVENTS = [
  "cellClicked",
  "cellDoubleClicked",
  "cellValueChanged",
  "selectionChanged",
  "filterChanged",
  "sortChanged",
  "columnRowGroupChanged",
  "columnPivotChanged",
  "columnValueChanged",
  "columnPivotModeChanged",
  "rowGroupOpened",
];

export function cellChanges(oldRows, newRows, tracked, idField = "id") {
  const changes = new Map();
  if (!tracked.length) return changes;
  const oldById = new Map(oldRows.map((r, i) => [rowIdOf(r, i, idField), r]));
  newRows.forEach((row, i) => {
    const id = rowIdOf(row, i, idField);
    const old = oldById.get(id);
    if (!old || !row) return;
    for (const { field, compareField } of tracked) {
      const before = old[compareField];
      const after = row[compareField];
      if (typeof before === "number" && typeof after === "number" && before !== after) {
        changes.set(`${id}|${field}`, after > before ? "up" : "down");
      }
    }
  });
  return changes;
}

export function normalizeData(data, definition) {
  const table = definition && typeof definition === "object" ? definition : {};
  const object = data && typeof data === "object" && !Array.isArray(data) ? data : null;
  const gridOptions = object?.gridOptions && typeof object.gridOptions === "object" ? object.gridOptions : {};

  if (object?.transaction && typeof object.transaction === "object" && !Array.isArray(object.rowData) && !Array.isArray(object.columnDefs)) {
    return { transaction: object.transaction, gridOptions, table };
  }

  const cellExpressions = cellExpressionsOf(gridOptions, table);
  if (object && Array.isArray(object.columnDefs)) {
    const rowData = Array.isArray(object.rowData) ? object.rowData : [];
    const columnDefs = compactColumnDefs(withExpressions(object.columnDefs, rowData, { cellExpressions }), rowData);
    return { rowData, columnDefs, gridOptions, table, transposed: false, columnsKey: JSON.stringify({ columnDefs: object.columnDefs, cellExpressions }) };
  }

  const rows = rowsOf(data);
  const columnDefs = withExpressions(agTableChartColumnDefs(rows, table), rows, { cellExpressions });
  const columnsKey = JSON.stringify({ table, fields: fieldsOf(rows) });
  if (table.transpose === true) {
    return { ...transpose(rows, columnDefs), gridOptions, table, transposed: true, columnsKey: `${columnsKey}|${rows.length}` };
  }
  return { rowData: rows, columnDefs, gridOptions, table, transposed: false, columnsKey };
}

function element(className, style = {}) {
  const node = document.createElement("div");
  node.className = className;
  Object.assign(node.style, style);
  return node;
}

export function mountTable({ model, el, signal, experimental, tracker, saved = {} }) {
  el.replaceChildren();

  const definition = model.get("definition") || {};
  const initial = normalizeData(model.get("data"), definition);
  const table = initial.table;
  let idField = idFieldOf(table);
  let currentRowData = [];
  let currentColumnsKey = null;
  let currentGridOptions = initial.gridOptions;
  let tracked = [];
  const flashTimers = new Set();
  const channel = createStateChannel(model);
  let gridRestored = false;

  const invoke = async (command, message) => {
    if (!experimental?.invoke) throw new Error("host commands are unavailable");
    return experimental.invoke(command, message);
  };
  const notify = (level, text) => invoke("core:ui:notify", { level, text }).catch(() => {});

  const actions = {
    groupBy(paramName, value, forceUpdate) {
      const params = model.get("params") || {};
      if (!Object.hasOwn(params, paramName)) {
        notify("warning", `${paramName} is not a parameter of this widget.`);
        return;
      }
      model.set("params", { ...params, [paramName]: value });
      model.save_changes();
      tracker.record("cellOnClick", { actionType: "groupBy", paramName, value, forceUpdate });
    },
    openUrl(url) {
      if (!/^(https|mailto):/i.test(url)) {
        notify("warning", "Only https: and mailto: links can be opened.");
        return;
      }
      invoke("core:ui:open-link", { url }).catch((e) => console.warn("ag-grid openUrl:", e.message));
      tracker.record("cellOnClick", { actionType: "openUrl", url });
    },
    sendToAgent(markdown, agentId) {
      tracker.state.agentPrompt = { markdown, agentId: agentId ?? null, timestamp: Date.now() };
      tracker.record("cellOnClick", { actionType: "sendToAgent", agentId: agentId ?? null });
      invoke("core:clipboard:write", { text: markdown })
        .then(() => notify("info", "Prompt copied. Paste it into the AI agent."))
        .catch(() => notify("info", "The prompt is in the widget's context for the AI agent."));
    },
  };

  const theme = model.get("theme") || {};
  const context = { locale: theme.locale, decimals: theme.decimals, actions, changes: new Map() };

  const container = element("ag-grid-container", { height: "100%", width: "100%", display: "flex", flexDirection: "column" });
  const body = element("ag-table-chart-body", { position: "relative", flex: "1 1 auto", minHeight: "0" });
  const gridEl = element("ag-table-chart-grid", { position: "absolute", inset: "0" });
  const chartEl = element("ag-table-chart-chart", { position: "absolute", inset: "0", visibility: "hidden" });
  body.append(gridEl, chartEl);

  const chartsOn = table.enableCharts !== false;
  const wantsChartView = chartsOn && table.transpose !== true && (table.enableCharts === true || Boolean(table.chartView));
  const toolbar = wantsChartView ? element("ag-table-chart-toolbar") : null;
  if (toolbar) container.appendChild(toolbar);
  container.appendChild(body);
  el.appendChild(container);

  const own = {
    getRowId: rowIdGetter(idField),
    columnDefs: [],
    rowData: [],
    context,
    enableCharts: chartsOn,
    ...(table.enableAdvanced === false ? { sideBar: false } : table.enableAdvanced === true ? { sideBar: { toolPanels: ["columns", FILTERS_TOOL_PANEL], defaultToolPanel: "columns" } } : {}),
  };
  const api = createGrid(gridEl, gridOptionsFor({ model, gridOptions: currentGridOptions, ...own }));
  const detach = tracker.attach(api);
  const detachActions = attachCardActions(api, model);

  const events = (Array.isArray(table.gridEvents) ? table.gridEvents : []).filter((name) => GRID_EVENTS.includes(name));
  const detailOf = {
    cellClicked: (e) => ({ rowId: e.node?.id, colId: e.column?.getColId(), value: e.value instanceof Date ? e.value.toISOString() : e.value }),
    cellDoubleClicked: (e) => ({ rowId: e.node?.id, colId: e.column?.getColId(), value: e.value instanceof Date ? e.value.toISOString() : e.value }),
    cellValueChanged: (e) => ({ rowId: e.node?.id, colId: e.column?.getColId(), oldValue: e.oldValue, newValue: e.newValue }),
    rowGroupOpened: (e) => ({ rowId: e.node?.id, key: e.node?.key, expanded: e.expanded }),
  };
  const sendState = (event) => {
    if (api.isDestroyed() || !channel.declared) return;
    const sent = channel.send(gridStateOf(api, { type: event.type, ...(detailOf[event.type]?.(event) ?? {}) }));
    if (sent.error) notify("warning", sent.error);
  };
  for (const name of events) api.addEventListener(name, sendState);

  let chartView = null;
  if (toolbar) {
    const buttons = {};
    const setPressed = () => {
      buttons.table.setAttribute("aria-pressed", String(!chartView.isOpen));
      buttons.chart.setAttribute("aria-pressed", String(chartView.isOpen));
    };
    for (const [key, label] of [["table", "Table"], ["chart", "Chart"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ag-table-chart-toolbar-button";
      button.textContent = label;
      button.addEventListener("click", () => {
        if (key === "chart") chartView.open();
        else chartView.close();
        setPressed();
      });
      buttons[key] = button;
      toolbar.appendChild(button);
    }
    chartView = createChartView({
      api,
      gridEl,
      chartEl,
      chartView: table.chartView ?? {},
      saved: saved.chartView,
      mode: theme.mode === "dark" ? "dark" : "light",
      onChange: (value) => {
        tracker.state.chartView = value;
        tracker.persist();
      },
    });
    setPressed();
  }

  const downloadChart = async () => {
    let chartIds = [];
    try {
      chartIds = (api.getChartModels?.() ?? []).map((m) => m.chartId);
    } catch {
      chartIds = [];
    }
    const chartId = chartToDownload(chartIds, chartView);
    if (!chartId) {
      notify("info", chartView ? "Open the chart first, then download it." : "Chart a range of cells first: select cells, right-click or Control-click them, choose Chart Range, then download it.");
      return;
    }
    const url = api.getChartImageDataURL({ chartId, fileFormat: "image/png" });
    const bytes = url ? await onBackground(url, backgroundOf(el, (model.get("theme") || {}).mode)) : null;
    if (!bytes?.byteLength) {
      notify("warning", "The chart could not be drawn as an image.");
      return;
    }
    await experimental.invoke("core:download:save", { filename: chartFilename("chart"), mime: "image/png" }, { buffers: [bytes] });
  };
  const onAction = (event) => {
    if (event?.kind !== "workspace-event" || event.name !== "action" || event.id !== ACTION_DOWNLOAD_CHART || api.isDestroyed()) return;
    downloadChart().catch((error) => notify("warning", `The chart was not downloaded: ${error?.message ?? error}`));
  };
  model.on("msg:custom", onAction);

  const flash = (changes) => {
    if (!changes.size) return;
    for (const [key, direction] of changes) context.changes.set(key, direction);
    const columns = [...new Set(tracked.map((t) => t.field))];
    api.refreshCells({ columns, force: true });
    const timer = setTimeout(() => {
      flashTimers.delete(timer);
      for (const key of changes.keys()) if (context.changes.get(key) === changes.get(key)) context.changes.delete(key);
      if (!api.isDestroyed()) api.refreshCells({ columns, force: true });
    }, CHANGE_FLASH_MS);
    flashTimers.add(timer);
  };

  const setRows = (next, transposed = false) => {
    const changes = transposed ? new Map() : cellChanges(currentRowData, next, tracked, idField);
    api.setGridOption("rowData", next);
    if (!Object.hasOwn(currentGridOptions, "pagination")) api.setGridOption("pagination", next.length > PAGINATE_ABOVE);
    currentRowData = next;
    flash(changes);
  };

  const applyTransaction = (transaction) => {
    const result = api.applyTransaction(transaction);
    if (!result) return;
    const rows = [];
    api.forEachNode((node) => { if (!node.group && node.data) rows.push(node.data); });
    currentRowData = rows;
  };

  const apply = (next, hasData = true) => {
    if (JSON.stringify(next.gridOptions) !== JSON.stringify(currentGridOptions)) {
      currentGridOptions = next.gridOptions;
      for (const [key, value] of Object.entries(backendOptions(next.gridOptions))) {
        try { api.setGridOption(key, value); } catch (e) { console.warn(`ag-grid gridOptions.${key}:`, e.message); }
      }
      applyTheme(api, model, currentGridOptions);
    }
    if (next.transaction) {
      applyTransaction(next.transaction);
      return;
    }
    idField = idFieldOf(next.table);
    tracked = next.transposed ? [] : changeTrackedColumns(next.table.columnsDefs);
    if (next.columnsKey !== currentColumnsKey) {
      currentColumnsKey = next.columnsKey;
      api.setGridOption("columnDefs", next.columnDefs);
    }
    setRows(next.rowData, next.transposed);
    if (!gridRestored && hasData && (api.getColumns() || []).length) {
      gridRestored = true;
      if (saved.grid) restoreGridState(api, saved.grid);
      else applyPresetState(api, presetStateOf(next.table));
      tracker.gridRestored();
    }
    chartView?.refresh();
  };

  apply(initial, model.get("data") !== undefined && model.get("data") !== null);

  const onDataChange = () => {
    const data = model.get("data");
    if (data === undefined || data === null) return;
    apply(normalizeData(data, model.get("definition") || {}));
  };

  const onThemeChange = () => {
    const nextTheme = model.get("theme") || {};
    context.locale = nextTheme.locale;
    context.decimals = nextTheme.decimals;
    const mode = applyTheme(api, model, currentGridOptions);
    api.refreshCells({ force: true });
    chartView?.setMode(mode);
  };

  model.on("change:data", onDataChange);
  model.on("change:definition", onDataChange);
  model.on("change:theme", onThemeChange);
  model.on("change:config", onThemeChange);

  signal.addEventListener("abort", () => {
    model.off("msg:custom", onAction);
    model.off("change:data", onDataChange);
    model.off("change:definition", onDataChange);
    model.off("change:theme", onThemeChange);
    model.off("change:config", onThemeChange);
    for (const timer of flashTimers) clearTimeout(timer);
    flashTimers.clear();
    for (const name of events) api.removeEventListener(name, sendState);
    detach();
    detachActions();
    chartView?.destroy();
    api.destroy();
  });

  return {
    api,
    rows: () => currentRowData,
    setRows,
    idField: () => idField,
    chartOpen: () => chartView?.isOpen ?? false,
  };
}

export function tableExports(getHandle, getTracker) {
  return {
    exportOptions: () => [{ id: "csv", label: "Rows (CSV)", extension: "csv", mime: "text/csv" }],
    exportData: (id) => {
      const handle = getHandle();
      return id === "csv" && handle ? rawCsv(handle.api) : null;
    },
    copilotContext: () => {
      const handle = getHandle();
      if (!handle) return null;
      return copilotContextOf(handle.api, {
        chartView: { open: handle.chartOpen() },
        lastAgentPrompt: getTracker()?.state.agentPrompt ?? null,
      });
    },
  };
}

let handle = null;
let tracker = null;

export default {
  initialize({ model }) {
    setLicense(model);
    return tableExports(() => handle, () => tracker);
  },

  async render({ model, el, signal, experimental }) {
    const saved = model.get("state") || {};
    tracker = createTracker(model, { chartView: saved.chartView ?? null, agentPrompt: null, grid: saved.grid ?? null });
    handle = mountTable({ model, el, signal, experimental, tracker, saved });
    signal.addEventListener("abort", () => { handle = null; });
  },
};
