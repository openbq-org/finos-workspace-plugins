import {
  applyTheme,
  attachCardActions,
  backendOptions,
  columnFieldsOf,
  createGrid,
  createStateChannel,
  createTracker,
  gridOptionsFor,
  idFieldOf,
  rowIdGetter,
  rowsOf,
  setLicense,
  sortModelOf,
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

export function optionsFor({ model, definition, columnDefs, gridOptions = {}, datasource, initialState }) {
  const blockSize = definition.blockSize ?? DEFAULT_BLOCK_SIZE;
  return gridOptionsFor({
    model,
    serverSide: true,
    gridOptions: {
      ...gridOptions,
      defaultColDef: { enableRowGroup: false, enablePivot: false, enableValue: false, ...(gridOptions.defaultColDef || {}) },
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
    sideBar: { toolPanels: [{ id: "columns", labelDefault: "Columns", labelKey: "columns", iconKey: "columns", toolPanel: "agColumnsToolPanel", toolPanelParams: { suppressRowGroups: true, suppressValues: true, suppressPivots: true, suppressPivotMode: true } }, "filters"], defaultToolPanel: "" },
    columnDefs,
    ...(initialState && typeof initialState === "object" ? { initialState } : {}),
    ...(typeof definition.wsRowIdColumn === "string" ? { getRowId: rowIdGetter(idFieldOf(definition)) } : {}),
  });
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
      exportOptions: () => [],
      exportData: () => null,
      copilotContext: () => {
        if (!api) return null;
        return {
          columns: columnFieldsOf(api),
          rowsKnown: api.getDisplayedRowCount(),
          filterModel: api.getFilterModel(),
          sortModel: sortModelOf(api),
        };
      },
    };
  },

  async render({ model, el, signal }) {
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
      api = createGrid(gridEl, optionsFor({ model, definition, columnDefs, gridOptions: backendOptions(gridOptions), datasource, initialState: saved.grid }));
      detach = tracker.attach(api);
      detachActions = attachCardActions(api, model);
      tracker.gridRestored();
      say("");
    };
    say("Loading…");
    start();
    model.on("change:data", start);

    const onTheme = () => applyTheme(api, model, gridOptions);
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
      api?.destroy();
      api = null;
    });
  },
};
