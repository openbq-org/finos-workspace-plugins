import assert from "node:assert/strict";
import { test } from "node:test";

import { liveApi, makeModel, mount, settle } from "./dom.mjs";
import { STATE_PARAM } from "../src/grid.js";
import plugin, { answerOf, createDatasource, optionsFor, PIVOT_SEPARATOR, ssrmRowId } from "../src/ssrm.js";

const columnDefs = [{ field: "id" }, { field: "desk", filter: "agTextColumnFilter" }, { field: "qty", type: "numericColumn" }];
const rows = Array.from({ length: 250 }, (_, i) => ({ id: `T${i}`, desk: ["FX", "Rates"][i % 2], qty: i }));

function backend(state) {
  if (state.event?.type !== "getRows") return { columnDefs };
  const page = rows.slice(state.startRow, state.endRow);
  return { seq: state.seq, rowData: page, rowCount: rows.length };
}

function hostModel(values, { refuse = false, answer = backend } = {}) {
  const model = makeModel({ data: { columnDefs }, params: { [STATE_PARAM]: "" }, ...values });
  const set = model.set.bind(model);
  model.requests = [];
  model.set = (key, value) => {
    if (key !== "params") return set(key, value);
    const before = model.values.params;
    set(key, value);
    if (before?.[STATE_PARAM] === value[STATE_PARAM]) return;
    setTimeout(() => {
      if (refuse) return model.push("params", before);
      const state = JSON.parse(value[STATE_PARAM]);
      model.requests.push(state);
      model.push("data", undefined);
      setTimeout(() => model.push("data", answer(state)), 5);
    }, 5);
  };
  return model;
}

test("an answer becomes the rows of a block, or the reason it failed", () => {
  assert.deepEqual(answerOf({ seq: 2, rowData: [{ a: 1 }], rowCount: 1 }), { seq: 2, success: { rowData: [{ a: 1 }], rowCount: 1 } });
  assert.deepEqual(answerOf({ rowData: [], pivotResultFields: ["x|y"] }).success.pivotResultFields, ["x|y"]);
  assert.equal(answerOf({ error: "no" }).error, "no");
  assert.match(answerOf({ columnDefs }).error, /no rowData/);
  assert.match(answerOf([1]).error, /object/);
});

test("the grid pages on the server, one request at a time, with the panels on", () => {
  const options = optionsFor({ model: makeModel({}), definition: { pageSize: 50, wsRowIdColumn: "id" }, columnDefs, datasource: {} });
  assert.equal(options.rowModelType, "serverSide");
  assert.equal(options.maxConcurrentDatasourceRequests, 1);
  assert.equal(options.cacheBlockSize, 50);
  assert.equal(options.paginationPageSize, 50);
  assert.equal(options.serverSidePivotResultFieldSeparator, PIVOT_SEPARATOR);
  assert.equal(options.pivotPanelShow, "always");
  assert.equal(options.rowGroupPanelShow, "always");
  assert.equal(typeof options.getRowId, "function");
  assert.equal(optionsFor({ model: makeModel({}), definition: {}, columnDefs, datasource: {} }).getRowId, undefined);
});

test("row ids of server-side rows carry their group route", () => {
  const getRowId = ssrmRowId("id");
  const api = { getRowGroupColumns: () => [{ getColDef: () => ({ field: "desk" }) }] };
  assert.equal(getRowId({ api, data: { id: "T1" }, level: 1, parentKeys: ["FX"] }), "FX/T1");
  assert.equal(getRowId({ api, data: { desk: "FX" }, level: 0, parentKeys: [] }), "FX");
});

test("each request goes to the endpoint as the gridState body param, and its answer fills the block", async () => {
  const model = hostModel({ definition: { pageSize: 100 } });
  const { el, abort } = mount();
  plugin.initialize({ model });
  await plugin.render({ model, el, signal: abort.signal });
  await settle(300);

  assert.ok(model.requests.length >= 1);
  const first = model.requests[0];
  assert.equal(first.event.type, "getRows");
  assert.equal(first.startRow, 0);
  assert.equal(first.endRow, 100);
  assert.deepEqual(first.groupKeys, []);
  assert.ok(first.seq > 1);
  const api = await liveApi(el);
  assert.equal(api.getDisplayedRowAtIndex(0).data.id, "T0");
  assert.equal(el.querySelector(".ag-strip").textContent, "");

  api.setFilterModel({ desk: { filterType: "text", type: "equals", filter: "FX" } });
  await settle(300);
  assert.deepEqual(model.requests.at(-1).filterModel, { desk: { filterType: "text", type: "equals", filter: "FX" } });
  assert.ok(model.requests.at(-1).seq > first.seq);
  abort.abort();
  assert.equal(model.listenerCount("change:params"), 0);
});

test("after a reload, the stored state of the last session does not stall the first block", async () => {
  const stored = JSON.stringify({ seq: 1, event: { type: "getRows" }, startRow: 0, endRow: 100, rowGroupCols: [], valueCols: [], pivotCols: [], pivotMode: false, groupKeys: [], filterModel: {}, sortModel: [] });
  const model = hostModel({ params: { [STATE_PARAM]: stored }, data: { ...backend(JSON.parse(stored)), columnDefs } });
  const { el, abort } = mount();
  plugin.initialize({ model });
  await plugin.render({ model, el, signal: abort.signal });
  await settle(300);
  assert.ok(model.requests.length >= 1);
  assert.equal((await liveApi(el)).getDisplayedRowAtIndex(0)?.data?.id, "T0");
  abort.abort();
});

test("a refused write, a missing param and a late answer fail the request in words", async () => {
  const failures = [];
  const strip = [];
  const params = (request) => ({ request, success: () => failures.push("success"), fail: () => failures.push("fail") });

  const refused = hostModel({}, { refuse: true });
  const signal = new AbortController().signal;
  const { createStateChannel } = await import("../src/grid.js");
  createDatasource({ model: refused, channel: createStateChannel(refused), say: (t) => strip.push(t), signal, graceMs: 10 }).getRows(params({ startRow: 0, endRow: 10 }));
  await settle(60);
  assert.deepEqual(failures, ["fail"]);
  assert.match(strip.at(-1), /refused/);

  const undeclared = makeModel({ params: {} });
  createDatasource({ model: undeclared, channel: createStateChannel(undeclared), say: (t) => strip.push(t), signal }).getRows(params({}));
  assert.match(strip.at(-1), /declares no gridState/);

  const silent = makeModel({ params: { [STATE_PARAM]: "" } });
  createDatasource({ model: silent, channel: createStateChannel(silent), say: (t) => strip.push(t), signal, timeoutMs: 20 }).getRows(params({}));
  await settle(50);
  assert.match(strip.at(-1), /No answer in time/);
  assert.deepEqual(failures, ["fail", "fail", "fail"]);
});

test("an answer for another request is not taken for this one", async () => {
  const model = makeModel({ params: { [STATE_PARAM]: "" } });
  const { createStateChannel } = await import("../src/grid.js");
  const got = [];
  const source = createDatasource({ model, channel: createStateChannel(model, 0), say: () => {}, signal: new AbortController().signal });
  source.getRows({ request: { startRow: 0, endRow: 1 }, success: (s) => got.push(s), fail: () => got.push("fail") });
  model.push("data", { seq: 99, rowData: [{ id: "old" }] });
  await settle(0);
  assert.deepEqual(got, []);
  model.push("data", { seq: 1, rowData: [{ id: "new" }], rowCount: 1 });
  await settle(0);
  assert.deepEqual(got, [{ rowData: [{ id: "new" }], rowCount: 1 }]);
});

test("a stale gridState the host pushes back before it applies the new one is not a refusal", async () => {
  const model = makeModel({ params: { [STATE_PARAM]: "earlier" } });
  const { createStateChannel } = await import("../src/grid.js");
  const got = [];
  const source = createDatasource({ model, channel: createStateChannel(model, 0), say: () => {}, signal: new AbortController().signal, graceMs: 30 });
  source.getRows({ request: { startRow: 0, endRow: 1 }, success: (s) => got.push(s), fail: () => got.push("fail") });
  const mine = model.values.params[STATE_PARAM];
  model.push("params", { [STATE_PARAM]: "earlier" });
  model.push("params", { [STATE_PARAM]: mine });
  await settle(60);
  assert.deepEqual(got, []);
  model.push("data", { seq: 1, rowData: [{ id: "a" }], rowCount: 1 });
  await settle(0);
  assert.deepEqual(got, [{ rowData: [{ id: "a" }], rowCount: 1 }]);
});

test("a widget without the gridState param says so", async () => {
  const model = makeModel({ data: { columnDefs }, params: {} });
  const { el, abort } = mount();
  plugin.initialize({ model });
  await plugin.render({ model, el, signal: abort.signal });
  await settle();
  assert.match(el.querySelector(".ag-strip").textContent, /declares no gridState/);
  abort.abort();
});

test("a backend that answers rows only: columns from its rows, its first answer as the first block, pivotFields", async () => {
  const { startColumnsOf, isFirstBlock } = await import("../src/ssrm.js");
  assert.deepEqual(startColumnsOf({ rowData: [{ trade_id: 1, qty: 2 }], rowCount: 9 }), [{ field: "trade_id", headerName: "Trade Id" }, { field: "qty", headerName: "Qty" }]);
  assert.equal(startColumnsOf({ rowData: [] }), null);
  assert.equal(isFirstBlock({ startRow: 0, endRow: 100, rowGroupCols: [], groupKeys: [], sortModel: [], filterModel: {} }), true);
  assert.equal(isFirstBlock({ startRow: 0, sortModel: [{ colId: "a", sort: "asc" }] }), false);
  assert.deepEqual(answerOf({ rowData: [], pivotFields: ["a|b"] }).success.pivotResultFields, ["a|b"]);

  const rowsOnly = (state) => ({ seq: state.seq, rowData: rows.slice(state.startRow, state.endRow), rowCount: rows.length });
  const model = hostModel({ data: { rowData: rows.slice(0, 100), rowCount: rows.length }, config: { pageSize: "50" } }, { answer: rowsOnly });
  const { el, abort } = mount();
  plugin.initialize({ model });
  await plugin.render({ model, el, signal: abort.signal });
  try {
    await settle(300);
    const api = await liveApi(el);
    assert.deepEqual(api.getColumns().map((c) => c.getColId()), ["id", "desk", "qty"]);
    assert.equal(api.getGridOption("cacheBlockSize"), 50, "the card's page size");
    assert.equal(model.requests.length, 0, "the first block came from the answer the host already had");
    assert.equal(api.getDisplayedRowAtIndex(0)?.data?.id, "T0");
  } finally {
    abort.abort();
    await settle(50);
  }
});

test("the AI agent gets the rows the server-side grid has loaded", async () => {
  const rowsOnly = (state) => ({ seq: state.seq, rowData: rows.slice(state.startRow, state.endRow), rowCount: rows.length });
  const model = hostModel({ data: { rowData: rows.slice(0, 100), rowCount: rows.length } }, { answer: rowsOnly });
  const { el, abort } = mount();
  const exposed = plugin.initialize({ model });
  await plugin.render({ model, el, signal: abort.signal });
  try {
    await settle(300);
    const ctx = exposed.copilotContext();
    assert.ok(ctx.rowsLoaded >= 100, `${ctx.rowsLoaded} rows loaded`);
    assert.deepEqual(ctx.rows[0], { id: "T0", desk: "FX", qty: 0 });
    assert.equal(ctx.columnHeaders.desk, "Desk");
  } finally {
    abort.abort();
    await settle(50);
  }
});
