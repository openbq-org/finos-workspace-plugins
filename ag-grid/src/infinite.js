import { mountFilterBar } from "./filterBar.js";
import { mountTips, TIPS } from "./tips.js";
import { hasRowIds } from "./ssrm.js";
import {
  applyTheme,
  attachCardActions,
  clipboardActions,
  backendOptions,
  columnFieldsOf,
  columnHeadersOf,
  createGrid,
  sampleRows,
  visibleRowsOf,
  createStateChannel,
  createTracker,
  exportsAllowed,
  FILTERS_TOOL_PANEL,
  gridOptionsFor,
  idFieldOf,
  LOADED_EXPORTS,
  loadedExport,
  rowIdGetter,
  rowsOf,
  setLicense,
  sortModelOf,
  withoutFilterPanels,
  STATE_PARAM,
} from "./grid.js";
import { createParamRequests } from "./requests.js";
import { normalizeData } from "./table.js";

export const DEFAULT_BLOCK_SIZE = 100;
export const REQUEST_FIELDS = [STATE_PARAM, "startRow", "endRow", "offset", "limit", "sort", "order", "sortModel", "filterModel"];
const ROW_KEYS = ["rowData", "rows", "items", "results", "records", "value", "data"];
const TOTAL_KEYS = ["rowCount", "lastRow", "total", "totalCount", "total_count", "count", "totalRecords", "@odata.count"];

export function pathOf(object, path) {
  return String(path)
    .split(".")
    .reduce((value, key) => (value && typeof value === "object" && Object.hasOwn(value, key) ? value[key] : undefined), object);
}

export function requestPatch(request, { declared, definition = {}, channel }) {
  const size = request.endRow - request.startRow;
  const mapping = definition.requestParams && typeof definition.requestParams === "object" ? definition.requestParams : {};
  const first = Array.isArray(request.sortModel) ? request.sortModel[0] : undefined;
  const values = {
    startRow: () => request.startRow,
    endRow: () => request.endRow,
    offset: () => request.startRow,
    limit: () => size,
    sort: () => first?.colId ?? "",
    order: () => first?.sort ?? "",
    sortModel: () => JSON.stringify(request.sortModel ?? []),
    filterModel: () => JSON.stringify(request.filterModel ?? {}),
  };
  const patch = {};
  let sent = null;
  for (const field of REQUEST_FIELDS) {
    const name = typeof mapping[field] === "string" && mapping[field] ? mapping[field] : field;
    if (!declared.has(name)) continue;
    if (field === STATE_PARAM) {
      sent = channel.next({ event: { type: "getRows" }, startRow: request.startRow, endRow: request.endRow, sortModel: request.sortModel ?? [], filterModel: request.filterModel ?? {} });
      if (sent.error) return { error: sent.error };
      patch[name] = sent.text;
    } else {
      patch[name] = values[field]();
    }
  }
  return { patch, seq: sent?.seq };
}

/** What the endpoint can be told: a filter, a sort. A grid offers only what reaches the endpoint. */
export function capabilitiesOf(declared, definition = {}) {
  const mapping = definition.requestParams && typeof definition.requestParams === "object" ? definition.requestParams : {};
  const has = (field) => declared.has(typeof mapping[field] === "string" && mapping[field] ? mapping[field] : field);
  const state = has(STATE_PARAM);
  return { filters: state || has("filterModel"), sorting: state || has("sortModel") || has("sort") };
}

export function limitColumns(defs, { filters, sorting }) {
  if (filters && sorting) return defs;
  return defs.map((def) => {
    if (Array.isArray(def.children)) return { ...def, children: limitColumns(def.children, { filters, sorting }) };
    return { ...def, ...(filters ? {} : { filter: false, floatingFilter: false }), ...(sorting ? {} : { sortable: false, sort: null }) };
  });
}

export function blockOf(data, request, definition = {}) {
  if (data && typeof data === "object" && !Array.isArray(data) && typeof data.error === "string") return { error: data.error };
  const object = data && typeof data === "object" && !Array.isArray(data) ? data : null;
  let rows;
  if (definition.rowsKey) rows = pathOf(data, definition.rowsKey);
  else if (Array.isArray(data)) rows = data;
  else if (object && Array.isArray(object.columns) && Array.isArray(object.data)) rows = rowsOf(object);
  else if (object) rows = ROW_KEYS.map((key) => object[key]).find(Array.isArray) ?? (rowsOf(object).length ? rowsOf(object) : undefined);
  if (!Array.isArray(rows)) return { error: "The endpoint's answer has no rows." };
  rows = rows.filter((row) => row && typeof row === "object");

  const size = request.endRow - request.startRow;
  const total = definition.totalKey ? pathOf(data, definition.totalKey) : object ? TOTAL_KEYS.map((key) => object[key]).find((value) => typeof value === "number") : undefined;
  const ended = object && (object.hasMore === false || object.has_more === false || (Object.hasOwn(object, "next") && object.next === null));
  let lastRow = -1;
  if (typeof total === "number" && total >= 0) lastRow = total;
  else if (ended || rows.length < size) lastRow = request.startRow + rows.length;
  return { rows: rows.slice(0, size), lastRow, seq: object?.seq };
}

export function optionsFor({ model, definition, columnDefs, gridOptions = {}, datasource, initialState, context }) {
  const blockSize = definition.blockSize ?? DEFAULT_BLOCK_SIZE;
  const can = capabilitiesOf(new Set(Object.keys(model.get("params") || {})), definition);
  const sideBar = { toolPanels: [{ id: "columns", labelDefault: "Columns", labelKey: "columns", iconKey: "columns", toolPanel: "agColumnsToolPanel", toolPanelParams: { suppressRowGroups: true, suppressValues: true, suppressPivots: true, suppressPivotMode: true } }, FILTERS_TOOL_PANEL], defaultToolPanel: "" };
  const options = gridOptionsFor({
    model,
    serverSide: true,
    gridOptions: {
      ...gridOptions,
      defaultColDef: {
        enableRowGroup: false,
        enablePivot: false,
        enableValue: false,
        ...(gridOptions.defaultColDef || {}),
        ...(can.filters ? {} : { filter: false, floatingFilter: false }),
        ...(can.sorting ? {} : { sortable: false }),
      },
    },
    rowModelType: "infinite",
    datasource,
    cacheBlockSize: blockSize,
    maxBlocksInCache: definition.maxBlocksInCache ?? 20,
    maxConcurrentDatasourceRequests: 1,
    infiniteInitialRowCount: blockSize,
    rowGroupPanelShow: "never",
    pivotPanelShow: "never",
    statusBar: { statusPanels: [] },
    sideBar,
    columnDefs: limitColumns(columnDefs, can),
    ...(initialState && typeof initialState === "object" ? { initialState: can.filters ? initialState : { ...initialState, filter: undefined } } : {}),
    ...(hasRowIds(definition) ? { getRowId: rowIdGetter(idFieldOf(definition)) } : {}),
    ...(context ? { context } : {}),
  });
  if (!can.filters) options.sideBar = withoutFilterPanels(options.sideBar);
  if (!can.filters && options.defaultColDef) options.defaultColDef = { ...options.defaultColDef, filter: false, floatingFilter: false };
  return options;
}

export function createDatasource({ model, definition, channel, say, signal, timeoutMs, graceMs }) {
  const requests = createParamRequests({ model, signal, timeoutMs, graceMs });
  const fail = (params, error) => {
    say(error);
    params.failCallback();
  };
  return {
    getRows(params) {
      const request = { startRow: params.startRow, endRow: params.endRow, sortModel: params.sortModel, filterModel: params.filterModel };
      const declared = new Set(Object.keys(model.get("params") || {}));
      const built = requestPatch(request, { declared, definition, channel });
      if (built.error) return fail(params, built.error);
      if (!Object.keys(built.patch).length) return fail(params, "The widget declares no block param in widgets.json: gridState, startRow and endRow, or offset and limit.");
      requests
        .request({
          patch: built.patch,
          accept: (data) => {
            const seq = data && typeof data === "object" && !Array.isArray(data) ? data.seq : undefined;
            return built.seq === undefined || seq === undefined || seq === built.seq;
          },
          refused: "The host refused the block params.",
        })
        .then((outcome) => {
          const block = outcome.error ? outcome : blockOf(outcome.data, request, definition);
          if (block.error) return fail(params, block.error);
          say("");
          params.successCallback(block.rows, block.lastRow);
        });
    },
  };
}

let api = null;

export default {
  initialize({ model }) {
    setLicense(model);
    return {
      exportOptions: () => (api && exportsAllowed(model) ? LOADED_EXPORTS : []),
      exportData: (id) => (api && exportsAllowed(model) ? loadedExport(api, id) : null),
      copilotContext: () => {
        if (!api) return null;
        const loaded = visibleRowsOf(api, 500, (fn) => api.forEachNode(fn));
        return {
          columns: columnFieldsOf(api),
          columnHeaders: columnHeadersOf(api),
          rows: sampleRows(loaded),
          rowsLoaded: loaded.length,
          rowsKnown: api.getDisplayedRowCount(),
          filterModel: api.getFilterModel(),
          sortModel: sortModelOf(api),
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
    const gridEl = document.createElement("div");
    gridEl.className = "ag-fill";
    root.append(strip, gridEl);
    el.appendChild(root);
    const say = (text) => {
      strip.textContent = text;
    };

    const channel = createStateChannel(model);
    const saved = model.get("state") || {};
    const tracker = createTracker(model, { grid: saved.grid ?? null });
    let detach = () => {};
    let detachActions = () => {};
    let filterBar = null;
    let tipStrip = null;
    let gridOptions = {};

    const start = () => {
      const data = model.get("data");
      if (api || data === undefined || data === null) return;
      const blockSize = definition.blockSize ?? DEFAULT_BLOCK_SIZE;
      const first = blockOf(data, { startRow: 0, endRow: blockSize }, definition);
      const object = data && typeof data === "object" && !Array.isArray(data) ? data : {};
      if (first.error && !Array.isArray(object.columnDefs)) return say(first.error);
      gridOptions = object.gridOptions && typeof object.gridOptions === "object" ? object.gridOptions : {};
      const columnDefs = normalizeData(Array.isArray(object.columnDefs) ? { columnDefs: object.columnDefs, rowData: first.rows ?? [], gridOptions } : first.rows, definition).columnDefs;
      const datasource = createDatasource({ model, definition, channel, say, signal });
      const context = { actions: clipboardActions({ experimental, tracker }) };
      api = createGrid(gridEl, optionsFor({ model, definition, columnDefs, gridOptions: backendOptions(gridOptions), datasource, initialState: saved.grid, context }));
      detach = tracker.attach(api);
      detachActions = attachCardActions(api, model);
      filterBar = mountFilterBar(api, root, { before: gridEl, enabled: () => (model.get("config") || {}).filterBar !== false });
      tracker.gridRestored();
      if (saved.tipsDone === true) tracker.state.tipsDone = true;
      tipStrip = mountTips(root, {
        tips: TIPS.infinite,
        model,
        done: saved.tipsDone === true,
        before: root.children[1] ?? null,
        onDone: () => {
          tracker.state.tipsDone = true;
          tracker.persist();
        },
      });
      say("");
    };
    say("Loading…");
    start();
    model.on("change:data", start);

    const onTheme = () => {
      applyTheme(api, model, gridOptions);
      filterBar?.refresh();
    };
    const onEvent = (event) => {
      if (event?.kind === "workspace-event" && event.name === "refresh" && api) api.purgeInfiniteCache();
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
      tipStrip?.destroy();
      api?.destroy();
      api = null;
    });
  },
};
