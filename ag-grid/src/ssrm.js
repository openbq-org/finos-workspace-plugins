import {
  applyTheme,
  attachCardActions,
  cellExpressionsOf,
  columnFieldsOf,
  compactColumnDefs,
  createGrid,
  createStateChannel,
  createTracker,
  filterModelOf,
  gridOptionsFor,
  groupingOf,
  idFieldOf,
  MAX_STATE_TEXT,
  setLicense,
  sortModelOf,
  STATE_PARAM,
  withExpressions,
} from "./grid.js";
import { ANSWER_TIMEOUT_MS, createParamRequests, REFUSAL_GRACE_MS } from "./requests.js";

export const DEFAULT_PAGE_SIZE = 100;
export const PIVOT_SEPARATOR = "|";

export function ssrmRowId(idField) {
  return ({ api, data, level, parentKeys = [] }) => {
    const own = data?.[idField];
    if (own !== undefined && own !== null) return [...parentKeys, String(own)].join("/");
    const groupField = api.getRowGroupColumns()[level]?.getColDef().field;
    return [...parentKeys, String(groupField ? data?.[groupField] : JSON.stringify(data))].join("/");
  };
}

export function optionsFor({ model, definition, columnDefs, gridOptions = {}, datasource, initialState }) {
  const pageSize = definition.pageSize ?? DEFAULT_PAGE_SIZE;
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
    ...(typeof definition.wsRowIdColumn === "string" ? { getRowId: ssrmRowId(idFieldOf(definition)) } : {}),
  });
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
      ...(Array.isArray(data.pivotResultFields) ? { pivotResultFields: data.pivotResultFields } : {}),
    },
  };
}

export function createDatasource({ model, channel, say, signal, timeoutMs = ANSWER_TIMEOUT_MS, graceMs = REFUSAL_GRACE_MS }) {
  const requests = createParamRequests({ model, signal, timeoutMs, graceMs });
  const fail = (params, error) => {
    say(error);
    params.fail();
  };
  return {
    getRows(params) {
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
          rowsAtThisLevel: api.getDisplayedRowCount(),
          filterModel: filterModelOf(api),
          sortModel: sortModelOf(api),
          grouping: groupingOf(api),
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
    const say = (text) => { strip.textContent = text; };

    const channel = createStateChannel(model);
    const saved = model.get("state") || {};
    const tracker = createTracker(model, { grid: saved.grid ?? null });
    let detach = () => {};
    let detachActions = () => {};
    let gridOptions = {};

    const start = () => {
      const data = model.get("data");
      if (api || !data || typeof data !== "object" || !Array.isArray(data.columnDefs)) return;
      gridOptions = data.gridOptions && typeof data.gridOptions === "object" ? data.gridOptions : {};
      const datasource = createDatasource({ model, channel, say, signal });
      api = createGrid(gridEl, optionsFor({ model, definition, columnDefs: compactColumnDefs(withExpressions(data.columnDefs, [], { cellExpressions: cellExpressionsOf(gridOptions, definition) }), []), gridOptions, datasource, initialState: saved.grid }));
      detach = tracker.attach(api);
      detachActions = attachCardActions(api, model);
      tracker.gridRestored();
      if (channel.declared) say("");
    };
    if (!channel.declared) say(`The widget declares no ${STATE_PARAM} body parameter in widgets.json.`);
    else say("Loading the columns…");
    start();
    model.on("change:data", start);

    const onTheme = () => applyTheme(api, model, gridOptions);
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
      api?.destroy();
      api = null;
    });
  },
};
