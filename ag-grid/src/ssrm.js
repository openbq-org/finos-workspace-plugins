import { mountFilterBar } from "./filterBar.js";
import {
  applyTheme,
  attachCardActions,
  clipboardActions,
  cellExpressionsOf,
  columnFieldsOf,
  columnHeadersOf,
  compactColumnDefs,
  createGrid,
  sampleRows,
  visibleRowsOf,
  createStateChannel,
  createTracker,
  displaySettingsOf,
  fieldsOf,
  filterModelOf,
  gridOptionsFor,
  groupingOf,
  idFieldOf,
  keyOf,
  modeOf,
  LOADED_EXPORTS,
  loadedExport,
  MAX_STATE_TEXT,
  setLicense,
  sortModelOf,
  STATE_PARAM,
  withExpressions,
} from "./grid.js";
import { createChartView } from "./ag-table-chart/chartView.js";
import { headerFromField } from "./ag-table-chart/format.js";
import { chartSettingsOf } from "./table.js";
import { ANSWER_TIMEOUT_MS, createParamRequests, REFUSAL_GRACE_MS } from "./requests.js";

export const DEFAULT_PAGE_SIZE = 100;
export const PIVOT_SEPARATOR = "|";

export function ssrmRowId(idField) {
  return ({ api, data, level, parentKeys = [] }) => {
    const own = keyOf(data, idField);
    if (own !== null) return [...parentKeys, own].join("/");
    const groupField = api.getRowGroupColumns()[level]?.getColDef().field;
    return [...parentKeys, String(groupField ? data?.[groupField] : JSON.stringify(data))].join("/");
  };
}

/** True when the definition names the fields that identify a row. */
export function hasRowIds(definition) {
  return typeof definition?.wsRowIdColumn === "string" || (Array.isArray(definition?.wsRowIdColumns) && definition.wsRowIdColumns.length > 0);
}

export function optionsFor({ model, definition, columnDefs, gridOptions = {}, datasource, initialState, context }) {
  const pageSize = displaySettingsOf(model).pageSize ?? definition.pageSize ?? DEFAULT_PAGE_SIZE;
  return gridOptionsFor({
    model,
    serverSide: true,
    gridOptions,
    rowModelType: "serverSide",
    serverSideDatasource: datasource,
    maxConcurrentDatasourceRequests: 1,
    serverSidePivotResultFieldSeparator: PIVOT_SEPARATOR,
    pagination: true,
    paginationPageSize: pageSize,
    cacheBlockSize: pageSize,
    maxBlocksInCache: 10,
    columnDefs,
    ...(initialState && typeof initialState === "object" ? { initialState } : {}),
    ...(hasRowIds(definition) ? { getRowId: ssrmRowId(idFieldOf(definition)) } : {}),
    ...(context ? { context } : {}),
  });
}

/**
 * The columns of the first answer: its `columnDefs`, or else the fields of its `rowData`, as a
 * backend that answers rows only (with `rowCount`) has them. Null until one of them is there.
 */
export function startColumnsOf(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (Array.isArray(data.columnDefs)) return data.columnDefs;
  if (!Array.isArray(data.rowData) || !data.rowData.length) return null;
  return fieldsOf(data.rowData).map((field) => ({ field, headerName: headerFromField(field) }));
}

/** True when a getRows request asks for what the first answer already holds: the first rows, with no grouping, filter or sort. */
export function isFirstBlock(request) {
  return (request.startRow ?? 0) === 0 && !request.rowGroupCols?.length && !request.groupKeys?.length && !request.pivotMode && !request.sortModel?.length && !Object.keys(request.filterModel ?? {}).length;
}

export function answerOf(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { error: "The endpoint did not answer with an object." };
  if (typeof data.error === "string") return { error: data.error };
  if (!Array.isArray(data.rowData)) return { error: "The endpoint's answer has no rowData." };
  return {
    seq: data.seq,
    success: {
      rowData: data.rowData,
      ...(typeof data.rowCount === "number" ? { rowCount: data.rowCount } : {}),
      ...(Array.isArray(data.pivotResultFields ?? data.pivotFields) ? { pivotResultFields: data.pivotResultFields ?? data.pivotFields } : {}),
    },
  };
}

export function createDatasource({ model, channel, say, signal, timeoutMs = ANSWER_TIMEOUT_MS, graceMs = REFUSAL_GRACE_MS, first = null }) {
  const requests = createParamRequests({ model, signal, timeoutMs, graceMs });
  const fail = (params, error) => {
    say(error);
    params.fail();
  };
  let held = first;
  return {
    getRows(params) {
      const ready = held;
      held = null;
      if (ready && isFirstBlock(params.request)) {
        const answer = answerOf(ready);
        if (!answer.error) {
          params.success(answer.success);
          return;
        }
      }
      if (!channel.declared) return fail(params, `The widget declares no ${STATE_PARAM} body parameter in widgets.json.`);
      const next = channel.next({ event: { type: "getRows" }, ...params.request });
      if (next.error) return fail(params, next.error);
      requests
        .request({
          patch: { [STATE_PARAM]: next.text },
          accept: (data) => {
            const seq = answerOf(data).seq;
            return seq === undefined || seq === next.seq;
          },
          refused: `The host refused the grid state: it may be longer than ${MAX_STATE_TEXT.toLocaleString("en")} characters.`,
        })
        .then((outcome) => {
          const answer = outcome.error ? outcome : answerOf(outcome.data);
          if (answer.error) return fail(params, answer.error);
          say("");
          params.success(answer.success);
        });
    },
  };
}

/**
 * The Table / Chart toolbar of a server-side grid: the chart is the current page's rows, drawn
 * again when the page or its rows change, with the chart type the user picked.
 */
export function mountPageChart({ api, toolbar, gridEl, chartEl, chartView, saved, model, tracker }) {
  const rowRange = () => {
    const count = api.getDisplayedRowCount();
    if (!count) return null;
    const size = api.paginationGetPageSize?.() || count;
    const start = (api.paginationGetCurrentPage?.() ?? 0) * size;
    return { rowStartIndex: Math.min(start, count - 1), rowEndIndex: Math.min(start + size, count) - 1 };
  };
  const view = createChartView({
    api,
    gridEl,
    chartEl,
    chartView,
    saved,
    mode: modeOf(model),
    rowRange,
    settings: () => chartSettingsOf(model),
    onChange: (value) => {
      tracker.state.chartView = value;
      tracker.persist();
    },
  });
  const buttons = {};
  const press = () => {
    buttons.table.setAttribute("aria-pressed", String(!view.isOpen));
    buttons.chart.setAttribute("aria-pressed", String(view.isOpen));
  };
  for (const [key, label] of [["table", "Table"], ["chart", "Chart (this page)"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ag-table-chart-toolbar-button";
    button.textContent = label;
    button.addEventListener("click", () => {
      if (key === "chart") {
        view.open();
        view.rebuild();
      } else view.close();
      press();
    });
    buttons[key] = button;
    toolbar.appendChild(button);
  }
  press();
  let timer;
  const follow = () => {
    clearTimeout(timer);
    timer = setTimeout(() => !api.isDestroyed() && view.rebuild(), 150);
  };
  api.addEventListener("paginationChanged", follow);
  api.addEventListener("modelUpdated", follow);
  return {
    get isOpen() { return view.isOpen; },
    setMode: (mode) => view.setMode(mode),
    destroy() {
      clearTimeout(timer);
      if (!api.isDestroyed()) {
        api.removeEventListener("paginationChanged", follow);
        api.removeEventListener("modelUpdated", follow);
      }
      view.destroy();
    },
  };
}

let api = null;

export default {
  initialize({ model }) {
    setLicense(model);
    return {
      exportOptions: () => (api ? LOADED_EXPORTS : []),
      exportData: (id) => (api ? loadedExport(api, id) : null),
      copilotContext: () => {
        if (!api) return null;
        const loaded = visibleRowsOf(api, 500, (fn) => api.forEachNode(fn));
        return {
          columns: columnFieldsOf(api),
          columnHeaders: columnHeadersOf(api),
          rows: sampleRows(loaded),
          rowsLoaded: loaded.length,
          rowsAtThisLevel: api.getDisplayedRowCount(),
          filterModel: filterModelOf(api),
          sortModel: sortModelOf(api),
          grouping: groupingOf(api),
        };
      },
    };
  },

  async render({ model, el, signal, experimental }) {
    el.replaceChildren();
    const definition = model.get("definition") || {};
    const root = document.createElement("div");
    root.className = "ag-stack";
    const strip = document.createElement("div");
    strip.className = "ag-strip";
    strip.setAttribute("aria-live", "polite");
    const wantsChart = definition.enableCharts !== false && (definition.enableCharts === true || Boolean(definition.chartView));
    const body = document.createElement("div");
    body.className = "ag-fill";
    const gridEl = document.createElement("div");
    Object.assign(gridEl.style, { position: "absolute", inset: "0" });
    const chartEl = document.createElement("div");
    chartEl.className = "ag-table-chart-chart";
    Object.assign(chartEl.style, { position: "absolute", inset: "0", visibility: "hidden" });
    body.append(gridEl, chartEl);
    const toolbar = wantsChart ? document.createElement("div") : null;
    if (toolbar) toolbar.className = "ag-table-chart-toolbar";
    root.append(strip, ...(toolbar ? [toolbar] : []), body);
    el.appendChild(root);
    const say = (text) => { strip.textContent = text; };
    let chartView = null;

    const channel = createStateChannel(model);
    const saved = model.get("state") || {};
    const tracker = createTracker(model, { grid: saved.grid ?? null, chartView: saved.chartView ?? null, agentPrompt: null });
    let detach = () => {};
    let detachActions = () => {};
    let filterBar = null;
    let gridOptions = {};

    const start = () => {
      const data = model.get("data");
      const startColumns = api ? null : startColumnsOf(data);
      if (!startColumns) return;
      gridOptions = data.gridOptions && typeof data.gridOptions === "object" ? data.gridOptions : {};
      const rowsOnly = !Array.isArray(data.columnDefs);
      const sample = rowsOnly ? data.rowData : [];
      const datasource = createDatasource({ model, channel, say, signal, first: rowsOnly && !saved.grid ? data : null });
      const context = { actions: clipboardActions({ experimental, tracker }) };
      api = createGrid(gridEl, optionsFor({ model, definition, columnDefs: compactColumnDefs(withExpressions(startColumns, sample, { cellExpressions: cellExpressionsOf(gridOptions, definition) }), sample), gridOptions, datasource, initialState: saved.grid, context }));
      const resize = () => api && !api.isDestroyed() && api.autoSizeAllColumns();
      for (const name of ["columnRowGroupChanged", "columnValueChanged", "columnPivotChanged", "columnPivotModeChanged"]) api.addEventListener(name, () => setTimeout(resize, 0));
      detach = tracker.attach(api);
      detachActions = attachCardActions(api, model);
      filterBar = mountFilterBar(api, root, { before: toolbar ?? body, enabled: () => (model.get("config") || {}).filterBar !== false });
      if (toolbar) chartView = mountPageChart({ api, toolbar, gridEl, chartEl, chartView: definition.chartView ?? {}, saved: saved.chartView, model, tracker });
      tracker.gridRestored();
      if (channel.declared) say("");
    };
    if (!channel.declared) say(`The widget declares no ${STATE_PARAM} body parameter in widgets.json.`);
    else say("Loading the columns…");
    start();
    model.on("change:data", start);

    const onTheme = () => {
      const mode = applyTheme(api, model, gridOptions);
      filterBar?.refresh();
      if (mode) chartView?.setMode(mode);
    };
    const onEvent = (event) => {
      if (event?.kind !== "workspace-event" || !api) return;
      if (event.name === "refresh") api.refreshServerSide({ purge: true });
      if (event.name !== "stream" || !Array.isArray(event.messages)) return;
      for (const message of event.messages) {
        if (message?.op === "transaction") {
          const { route, add, update, remove, addIndex } = message;
          api.applyServerSideTransactionAsync({
            ...(Array.isArray(route) ? { route: route.map(String) } : {}),
            ...(Array.isArray(add) ? { add } : {}),
            ...(Array.isArray(update) ? { update } : {}),
            ...(Array.isArray(remove) ? { remove } : {}),
            ...(typeof addIndex === "number" ? { addIndex } : {}),
          });
        } else if (message?.op === "refresh") {
          api.refreshServerSide({ ...(Array.isArray(message.route) ? { route: message.route.map(String) } : {}), purge: message.purge === true });
        }
      }
    };
    model.on("change:theme", onTheme);
    model.on("change:config", onTheme);
    model.on("msg:custom", onEvent);

    signal.addEventListener("abort", () => {
      model.off("change:data", start);
      model.off("change:theme", onTheme);
      model.off("change:config", onTheme);
      model.off("msg:custom", onEvent);
      detach();
      detachActions();
      filterBar?.destroy();
      chartView?.destroy();
      api?.destroy();
      api = null;
    });
  },
};
