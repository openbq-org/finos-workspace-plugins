import { canChart, createChartView } from "./ag-table-chart/chartView.js";
import { agTableChartColumnDefs, changeTrackedColumns, transpose } from "./ag-table-chart/columns.js";
import { mountFilterBar } from "./filterBar.js";
import { FormulasPanel, formulaColumnDefs, formulaColumnsOf, savedFormulas } from "./formulas.js";
import {
  applyPresetState,
  applyTheme,
  attachCardActions,
  attachSelectionShortcuts,
  backendOptions,
  cellExpressionsOf,
  compactColumnDefs,
  copilotContextOf,
  createGrid,
  createStateChannel,
  createTracker,
  displaySettingsOf,
  fieldsOf,
  FILTERS_TOOL_PANEL,
  gridOptionsFor,
  gridStateOf,
  idFieldOf,
  noRowsText,
  paginationFor,
  presetStateOf,
  rawCsv,
  rawExcel,
  restoreGridState,
  rowIdGetter,
  rowIdOf,
  rowsOf,
  setLicense,
  sizeColumnsToContent,
  withExpressions,
} from "./grid.js";

export const CHANGE_FLASH_MS = 1500;
export const ACTION_DOWNLOAD_CHART = "download-chart";
export const ACTION_TRANSPOSE = "transpose";
export const ACTION_REVERSE_COLUMNS = "reverse-columns";
export const ACTION_ADD_CHART = "add-chart-widget";
export const MAX_CHART_WIDGET_ROWS = 1000;

function plainValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  return String(value).slice(0, 500);
}

/**
 * The data of a dashboard widget that shows a chart of the grid: the charted columns of the rows
 * the grid shows (at most MAX_CHART_WIDGET_ROWS), with the chart type, as the table artifact takes it.
 */
export function chartWidgetData(api, chartModel) {
  const range = chartModel?.cellRange ?? {};
  const known = new Set((api.getColumns() ?? []).map((c) => c.getColId()));
  const columns = (range.columns ?? []).map((c) => (typeof c === "string" ? c : c?.getColId?.())).filter((id) => known.has(id)).slice(0, 60);
  if (!columns.length) return null;
  const first = Math.max(0, range.rowStartIndex ?? 0);
  const last = Math.min(api.getDisplayedRowCount() - 1, range.rowEndIndex ?? api.getDisplayedRowCount() - 1);
  const rowData = [];
  for (let i = first; i <= last && rowData.length < MAX_CHART_WIDGET_ROWS; i++) {
    const node = api.getDisplayedRowAtIndex(i);
    if (!node || node.group) continue;
    rowData.push(Object.fromEntries(columns.map((colId) => [colId.slice(0, 100), plainValue(api.getCellValue({ rowNode: node, colKey: colId }))])));
  }
  const columnDefs = columns.map((colId, i) => {
    const column = api.getColumn(colId);
    return { field: colId.slice(0, 100), headerName: String(api.getDisplayNameForColumn(column, "header") || colId).slice(0, 100), chartDataType: i === 0 ? "category" : "series" };
  });
  return { data: { columnDefs, rowData, chartView: { enabled: true, chartType: chartModel.chartType } }, truncated: last - first + 1 > MAX_CHART_WIDGET_ROWS };
}

/**
 * The rules that mark a row as the one the card's parameters point at: each `cellOnClick` column
 * whose click writes a parameter (`groupBy`), with the field whose value it writes.
 */
export function activeRowRules(columnsDefs) {
  return (Array.isArray(columnsDefs) ? columnsDefs : [])
    .filter((def) => def?.field && [def.renderFn].flat().includes("cellOnClick"))
    .filter((def) => def.renderFnParams?.actionType === "groupBy" && def.renderFnParams?.groupBy?.paramName)
    .map((def) => ({ paramName: def.renderFnParams.groupBy.paramName, field: def.renderFnParams.groupBy.valueField ?? def.field }));
}

export function isActiveRow(rules, row, params) {
  if (!row || !params) return false;
  return rules.some(({ paramName, field }) => {
    const current = params[paramName];
    const raw = row[field];
    const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw.value : raw;
    return current !== undefined && current !== null && current !== "" && value !== undefined && value !== null && String(value) === String(current);
  });
}

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
export const FORMULAS_PANEL = "formulas";

/** The card's chart settings; a setting left unset leaves the definition's chartView to decide. */
export function chartSettingsOf(model) {
  const config = model?.get("config") || {};
  const flag = (value) => (typeof value === "boolean" ? value : undefined);
  return { navigator: flag(config.chartNavigator), miniChart: flag(config.chartMiniChart), distinctColors: config.chartDistinctColors === true };
}

/** The table's side bar: the Columns and Filters panels and, unless the definition turns it off, Formulas. */
export function sideBarFor(table, formulasPanel) {
  if (table.enableAdvanced === false) return { sideBar: false };
  const panels = ["columns", FILTERS_TOOL_PANEL, ...(formulasPanel ? [formulasPanel] : [])];
  if (table.enableAdvanced === true) return { sideBar: { toolPanels: panels, defaultToolPanel: "columns" } };
  return formulasPanel ? { sideBar: { toolPanels: panels, defaultToolPanel: "" } } : {};
}
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

/**
 * The cells whose tracked value moved, as "up" or "down" by `${rowId}|${field}`. When `deltas` is
 * given, it receives how much each cell's own number moved, for the cell's arrow.
 */
export function cellChanges(oldRows, newRows, tracked, idField = "id", deltas = null) {
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
        const own = [old[field], row[field]];
        if (deltas && own.every((v) => typeof v === "number") && own[0] !== own[1]) deltas.set(`${id}|${field}`, own[1] - own[0]);
      }
    }
  });
  return changes;
}

/**
 * The grid's rows and columns from an answer and the table configuration. `transposed`, the card's
 * own choice from its menu, replaces the definition's `transpose` when it is a boolean.
 */
export function normalizeData(data, definition, transposed, formulas = []) {
  let table = definition && typeof definition === "object" ? definition : {};
  const answer = data && typeof data === "object" && !Array.isArray(data) ? data : null;
  if (!table.chartView && answer?.chartView && typeof answer.chartView === "object") table = { ...table, chartView: answer.chartView };
  const transposing = typeof transposed === "boolean" ? transposed : table.transpose === true;
  const withFormulas = (defs) => (formulas.length ? [...defs, ...formulaColumnDefs(formulas, defs)] : defs);
  const formulasKey = formulas.length ? `|f${JSON.stringify(formulas)}` : "";
  const object = data && typeof data === "object" && !Array.isArray(data) ? data : null;
  const gridOptions = object?.gridOptions && typeof object.gridOptions === "object" ? object.gridOptions : {};

  if (object?.transaction && typeof object.transaction === "object" && !Array.isArray(object.rowData) && !Array.isArray(object.columnDefs)) {
    return { transaction: object.transaction, gridOptions, table };
  }

  const cellExpressions = cellExpressionsOf(gridOptions, table);
  if (object && Array.isArray(object.columnDefs)) {
    const rowData = Array.isArray(object.rowData) ? object.rowData : [];
    const columnDefs = compactColumnDefs(withExpressions(withFormulas(object.columnDefs), rowData, { cellExpressions }), rowData);
    const columnsKey = JSON.stringify({ columnDefs: object.columnDefs, cellExpressions }) + formulasKey;
    if (transposing) {
      return { ...transpose(rowData, columnDefs.filter((c) => !c.children)), baseColumnDefs: columnDefs, gridOptions, table, transposed: true, columnsKey: `${columnsKey}|t|${rowData.length}` };
    }
    return { rowData, columnDefs, baseColumnDefs: columnDefs, gridOptions, table, transposed: false, columnsKey };
  }

  const rows = rowsOf(data);
  const columnDefs = withExpressions(withFormulas(agTableChartColumnDefs(rows, table)), rows, { cellExpressions });
  const columnsKey = JSON.stringify({ table, fields: fieldsOf(rows) }) + formulasKey;
  if (transposing) {
    return { ...transpose(rows, columnDefs), baseColumnDefs: columnDefs, gridOptions, table, transposed: true, columnsKey: `${columnsKey}|${rows.length}` };
  }
  return { rowData: rows, columnDefs, baseColumnDefs: columnDefs, gridOptions, table, transposed: false, columnsKey };
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
  let transposedChoice = typeof saved.transposed === "boolean" ? saved.transposed : undefined;
  const formulasOn = definition.enableFormulas !== false;
  let formulas = formulasOn ? savedFormulas(saved.formulas) : [];
  const initial = normalizeData(model.get("data"), definition, transposedChoice, formulas);
  const table = initial.table;
  let baseColumnDefs = initial.baseColumnDefs ?? [];
  let settings = displaySettingsOf(model);
  let currentParams = model.get("params") || {};
  const activeRules = activeRowRules(table.columnsDefs);
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
  const hoverCards = (Array.isArray(table.columnsDefs) ? table.columnsDefs : []).some((def) => {
    const fns = Array.isArray(def?.renderFn) ? def.renderFn : [def?.renderFn];
    return fns.includes("hoverCard") || (Array.isArray(def?.renderFnParams?.hoverCardData) && def.renderFnParams.hoverCardData.length > 0);
  });
  const context = {
    locale: theme.locale,
    decimals: settings.decimals ?? theme.decimals,
    abbreviate: settings.abbreviate,
    truncatedTooltips: !hoverCards,
    actions,
    changes: new Map(),
    deltas: new Map(),
  };

  const container = element("ag-grid-container", { height: "100%", width: "100%", display: "flex", flexDirection: "column" });
  const body = element("ag-table-chart-body", { position: "relative", flex: "1 1 auto", minHeight: "0" });
  const gridEl = element("ag-table-chart-grid", { position: "absolute", inset: "0" });
  const chartEl = element("ag-table-chart-chart", { position: "absolute", inset: "0", visibility: "hidden" });
  body.append(gridEl, chartEl);

  const chartsOn = table.enableCharts !== false;
  const wantsChartView = chartsOn && (table.enableCharts === true || Boolean(table.chartView));
  const toolbar = wantsChartView ? element("ag-table-chart-toolbar") : null;
  if (toolbar) container.appendChild(toolbar);
  container.appendChild(body);
  el.appendChild(container);

  function formulasPanel() {
    return {
      id: FORMULAS_PANEL,
      labelDefault: "Formulas",
      labelKey: "formulas",
      iconKey: "aggregation",
      toolPanel: FormulasPanel,
      toolPanelParams: {
        formulas: () => formulas,
        columns: () => formulaColumnsOf(baseColumnDefs),
        save: (list) => {
          formulas = savedFormulas(list);
          tracker.state.formulas = formulas;
          tracker.persist();
          const data = model.get("data");
          if (data !== undefined && data !== null) apply(normalizeData(data, model.get("definition") || {}, transposedChoice, formulas));
        },
      },
    };
  }

  const own = {
    getRowId: rowIdGetter(idField),
    columnDefs: [],
    rowData: [],
    context,
    enableCharts: chartsOn,
    tooltipShowMode: hoverCards ? "standard" : "whenTruncated",
    ...(activeRules.length ? { rowClassRules: { "ag-table-chart-row-active": (params) => isActiveRow(activeRules, params.data, currentParams) } } : {}),
    ...sideBarFor(table, formulasOn ? formulasPanel() : null),
  };
  const api = createGrid(gridEl, gridOptionsFor({ model, gridOptions: currentGridOptions, ...own }));
  const detach = tracker.attach(api);
  const detachActions = attachCardActions(api, model);
  const detachShortcuts = attachSelectionShortcuts(api, gridEl);
  const filterBar = mountFilterBar(api, container, { before: body, enabled: () => (model.get("config") || {}).filterBar !== false });
  const updateOverlay = () => {
    if (!api.isDestroyed()) api.setGridOption("overlayNoRowsTemplate", `<span class="ag-overlay-no-rows-center">${noRowsText(api)}</span>`);
  };
  api.addEventListener("filterChanged", updateOverlay);

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
      updateChartButton();
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
      settings: () => chartSettingsOf(model),
      onProblem: (text) => notify("warning", text),
    });
    setPressed();
  }

  /** The Chart button is off while no column can be charted. */
  function updateChartButton() {
    const button = toolbar?.querySelector(".ag-table-chart-toolbar-button:last-child");
    if (!button || api.isDestroyed()) return;
    const off = !chartView?.isOpen && !canChart(api, table.chartView ?? {});
    button.disabled = off;
    button.title = off ? "No series data to chart: the table has no number column." : "";
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
  const addChartWidget = async () => {
    let models = [];
    try {
      models = api.getChartModels?.() ?? [];
    } catch {
      models = [];
    }
    const chartId = chartToDownload(models.map((m) => m.chartId), chartView);
    const chartModel = models.find((m) => m.chartId === chartId);
    if (!chartModel || chartModel.modelType === "pivot") {
      notify("info", chartModel ? "A pivot chart cannot be added as a widget yet; chart a range of cells instead." : "Open the chart first, or chart a range of cells, then add it as a widget.");
      return;
    }
    const made = chartWidgetData(api, chartModel);
    if (!made) {
      notify("info", "The chart has no columns to add.");
      return;
    }
    await invoke("core:dashboard:add-widget", { widget: "table", data: made.data });
    if (made.truncated) notify("info", `The new widget holds the first ${MAX_CHART_WIDGET_ROWS.toLocaleString("en-US")} rows of the chart.`);
  };

  const setTransposed = (on) => {
    transposedChoice = on;
    tracker.state.transposed = on;
    tracker.persist();
    if (on && chartView?.isOpen) chartView.close();
    const data = model.get("data");
    if (data !== undefined && data !== null) apply(normalizeData(data, model.get("definition") || {}, transposedChoice, formulas));
  };

  const onAction = (event) => {
    if (event?.kind !== "workspace-event" || event.name !== "action" || api.isDestroyed()) return;
    if (event.id === ACTION_DOWNLOAD_CHART) {
      downloadChart().catch((error) => notify("warning", `The chart was not downloaded: ${error?.message ?? error}`));
    } else if (event.id === ACTION_TRANSPOSE) {
      setTransposed(!(transposedChoice ?? table.transpose === true));
    } else if (event.id === ACTION_ADD_CHART) {
      addChartWidget().catch((error) => notify("warning", `The chart was not added: ${error?.message ?? error}`));
    } else if (event.id === ACTION_REVERSE_COLUMNS) {
      const order = api.getAllGridColumns().map((c) => c.getColId());
      api.applyColumnState({ state: order.reverse().map((colId) => ({ colId })), applyOrder: true });
    }
  };
  model.on("msg:custom", onAction);

  const flash = (changes, deltas) => {
    if (!changes.size) return;
    for (const [key, direction] of changes) context.changes.set(key, direction);
    for (const [key, delta] of deltas) context.deltas.set(key, delta);
    const columns = [...new Set(tracked.map((t) => t.field))];
    api.refreshCells({ columns, force: true });
    const timer = setTimeout(() => {
      flashTimers.delete(timer);
      for (const key of changes.keys()) if (context.changes.get(key) === changes.get(key)) context.changes.delete(key);
      for (const key of deltas.keys()) if (context.deltas.get(key) === deltas.get(key)) context.deltas.delete(key);
      if (!api.isDestroyed()) api.refreshCells({ columns, force: true });
    }, CHANGE_FLASH_MS);
    flashTimers.add(timer);
  };

  const applyPagination = () => {
    for (const [key, value] of Object.entries(paginationFor(settings, currentGridOptions, currentRowData.length, PAGINATE_ABOVE))) {
      if (api.getGridOption(key) !== value) api.setGridOption(key, value);
    }
  };

  const setRows = (next, transposed = false) => {
    const deltas = new Map();
    const changes = transposed ? new Map() : cellChanges(currentRowData, next, tracked, idField, deltas);
    api.setGridOption("rowData", next);
    currentRowData = next;
    applyPagination();
    flash(changes, deltas);
    updateOverlay();
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
    if (next.baseColumnDefs) baseColumnDefs = next.baseColumnDefs;
    if (next.columnsKey !== currentColumnsKey) {
      currentColumnsKey = next.columnsKey;
      api.setGridOption("columnDefs", next.columnDefs);
    }
    setRows(next.rowData, next.transposed);
    if (!gridRestored && hasData && (api.getColumns() || []).length) {
      gridRestored = true;
      if (saved.grid) restoreGridState(api, saved.grid);
      else {
        const preset = presetStateOf(next.table);
        if (!preset?.columnSizing) sizeColumnsToContent(api);
        applyPresetState(api, preset);
      }
      tracker.gridRestored();
    }
    chartView?.refresh();
    updateChartButton();
  };

  apply(initial, model.get("data") !== undefined && model.get("data") !== null);

  const onDataChange = () => {
    const data = model.get("data");
    if (data === undefined || data === null) return;
    apply(normalizeData(data, model.get("definition") || {}, transposedChoice, formulas));
  };

  let chartSettings = JSON.stringify(chartSettingsOf(model));
  const onThemeChange = () => {
    const nextTheme = model.get("theme") || {};
    settings = displaySettingsOf(model);
    const nextChartSettings = JSON.stringify(chartSettingsOf(model));
    if (nextChartSettings !== chartSettings) {
      chartSettings = nextChartSettings;
      chartView?.redraw();
    }
    context.locale = nextTheme.locale;
    context.decimals = settings.decimals ?? nextTheme.decimals;
    context.abbreviate = settings.abbreviate;
    const mode = applyTheme(api, model, currentGridOptions);
    applyPagination();
    filterBar.refresh();
    api.refreshCells({ force: true });
    chartView?.setMode(mode);
  };

  const onParamsChange = () => {
    currentParams = model.get("params") || {};
    if (activeRules.length && !api.isDestroyed()) api.redrawRows();
  };

  model.on("change:data", onDataChange);
  model.on("change:definition", onDataChange);
  model.on("change:theme", onThemeChange);
  model.on("change:config", onThemeChange);
  model.on("change:params", onParamsChange);

  signal.addEventListener("abort", () => {
    model.off("msg:custom", onAction);
    model.off("change:data", onDataChange);
    model.off("change:definition", onDataChange);
    model.off("change:theme", onThemeChange);
    model.off("change:config", onThemeChange);
    model.off("change:params", onParamsChange);
    for (const timer of flashTimers) clearTimeout(timer);
    flashTimers.clear();
    for (const name of events) api.removeEventListener(name, sendState);
    api.removeEventListener("filterChanged", updateOverlay);
    detach();
    detachActions();
    detachShortcuts();
    filterBar.destroy();
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
    exportOptions: () => [
      { id: "csv", label: "Rows (CSV)", extension: "csv", mime: "text/csv" },
      { id: "xlsx", label: "Rows (Excel)", extension: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    ],
    exportData: (id) => {
      const handle = getHandle();
      if (!handle) return null;
      if (id === "csv") return rawCsv(handle.api);
      if (id === "xlsx") return rawExcel(handle.api) ?? null;
      return null;
    },
    copilotContext: () => {
      const handle = getHandle();
      if (!handle) return null;
      return copilotContextOf(handle.api, {
        chartView: { open: handle.chartOpen() },
        lastAgentPrompt: getTracker()?.state.agentPrompt ?? null,
        formulas: getTracker()?.state.formulas ?? [],
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
    tracker = createTracker(model, {
      chartView: saved.chartView ?? null,
      agentPrompt: null,
      grid: saved.grid ?? null,
      transposed: typeof saved.transposed === "boolean" ? saved.transposed : null,
      formulas: savedFormulas(saved.formulas),
    });
    handle = mountTable({ model, el, signal, experimental, tracker, saved });
    signal.addEventListener("abort", () => { handle = null; });
  },
};
