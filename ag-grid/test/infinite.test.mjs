import assert from "node:assert/strict";
import { test } from "node:test";

import { liveApi, makeModel, mount, settle } from "./dom.mjs";
import { createStateChannel, STATE_PARAM } from "../src/grid.js";
import plugin, { blockOf, optionsFor, requestPatch } from "../src/infinite.js";

const request = { startRow: 100, endRow: 150, sortModel: [{ colId: "price", sort: "desc" }], filterModel: { desk: { filterType: "text", type: "equals", filter: "FX" } } };
const trades = Array.from({ length: 120 }, (_, i) => ({ id: `T${i}`, desk: i % 2 ? "FX" : "Rates", price: i }));

test("a block request fills whichever block params the widget declares, under its own names", () => {
  const channel = createStateChannel(makeModel({}), 0);
  const declared = (...names) => new Set(names);
  assert.deepEqual(requestPatch(request, { declared: declared("offset", "limit", "sort", "order"), channel }).patch, { offset: 100, limit: 50, sort: "price", order: "desc" });
  assert.deepEqual(requestPatch(request, { declared: declared("startRow", "endRow"), channel }).patch, { startRow: 100, endRow: 150 });
  assert.deepEqual(requestPatch(request, { declared: declared("skip", "top"), definition: { requestParams: { offset: "skip", limit: "top" } }, channel }).patch, { skip: 100, top: 50 });
  assert.deepEqual(JSON.parse(requestPatch(request, { declared: declared("filterModel"), channel }).patch.filterModel), request.filterModel);
  const state = requestPatch(request, { declared: declared(STATE_PARAM), channel });
  assert.equal(state.seq, 1);
  assert.deepEqual(JSON.parse(state.patch[STATE_PARAM]), { seq: 1, event: { type: "getRows" }, ...request });
  assert.deepEqual(requestPatch(request, { declared: declared("unrelated", "page", "pageSize"), channel }).patch, {});
});

test("answers in the common shapes become a block and its last row", () => {
  const rows = [{ a: 1 }, { a: 2 }];
  const at = { startRow: 0, endRow: 2 };
  assert.deepEqual(blockOf({ rowData: rows, rowCount: 10 }, at), { rows, lastRow: 10, seq: undefined });
  assert.equal(blockOf({ rowData: rows, lastRow: 7 }, at).lastRow, 7);
  assert.equal(blockOf({ items: rows, total: 9 }, at).lastRow, 9);
  assert.equal(blockOf({ results: rows, count: 4, next: "?after=T000049" }, at).lastRow, 4);
  assert.equal(blockOf({ results: rows, next: null }, at).lastRow, 2);
  assert.equal(blockOf({ value: rows, "@odata.count": 30 }, at).lastRow, 30);
  assert.equal(blockOf({ data: rows, hasMore: false }, { startRow: 40, endRow: 42 }).lastRow, 42);
  assert.equal(blockOf(rows, at).lastRow, -1);
  assert.equal(blockOf([{ a: 1 }], { startRow: 50, endRow: 52 }).lastRow, 51);
  assert.deepEqual(blockOf({ columns: ["a"], index: [0, 1], data: [[1], [2]] }, at).rows, rows);
  assert.deepEqual(blockOf({ a: [1, 2] }, at).rows, rows);
  assert.deepEqual(blockOf({ payload: { list: rows, meta: { n: 5 } } }, at, { rowsKey: "payload.list", totalKey: "payload.meta.n" }), { rows, lastRow: 5, seq: undefined });
  assert.equal(blockOf({ error: "nope" }, at).error, "nope");
  assert.match(blockOf({ nothing: true }, at).error, /no rows/);
  assert.equal(blockOf({ rowData: [{ a: 1 }, { a: 2 }, { a: 3 }] }, at).rows.length, 2);
});

test("the infinite grid keeps grouping and pivot off and asks for one block at a time", () => {
  const options = optionsFor({ model: makeModel({}), definition: { blockSize: 40 }, columnDefs: [], datasource: {} });
  assert.equal(options.rowModelType, "infinite");
  assert.equal(options.cacheBlockSize, 40);
  assert.equal(options.maxConcurrentDatasourceRequests, 1);
  assert.equal(options.rowGroupPanelShow, "never");
  assert.equal(options.defaultColDef.enableRowGroup, false);
  assert.equal(options.defaultColDef.enablePivot, false);
});

function restHost(values) {
  const model = makeModel({ params: { offset: 0, limit: 50, sort: "", order: "" }, ...values });
  const answer = (params) => {
    const sorted = params.sort ? [...trades].sort((a, b) => (params.order === "desc" ? b[params.sort] - a[params.sort] : a[params.sort] - b[params.sort])) : trades;
    return { items: sorted.slice(Number(params.offset), Number(params.offset) + Number(params.limit)), total: trades.length };
  };
  model.values.data = answer(model.values.params);
  model.requests = [];
  const set = model.set.bind(model);
  model.set = (key, value) => {
    set(key, value);
    if (key !== "params") return;
    model.requests.push(value);
    setTimeout(() => {
      model.push("data", undefined);
      setTimeout(() => model.push("data", answer(value)), 5);
    }, 5);
  };
  return model;
}

test("an offset and limit backend fills the grid, its first block from the answer the host already has", async () => {
  const model = restHost({ definition: { blockSize: 50 } });
  const { el, abort } = mount();
  plugin.initialize({ model });
  await plugin.render({ model, el, signal: abort.signal });
  try {
    await settle(300);
    const api = await liveApi(el);
    assert.equal(api.getDisplayedRowAtIndex(0).data.id, "T0");
    assert.equal(model.requests.length, 0);
    api.ensureIndexVisible(110);
    await settle(400);
    assert.ok(model.requests.some((params) => Number(params.offset) === 100));
    assert.equal(api.getDisplayedRowCount(), trades.length);
    api.applyColumnState({ state: [{ colId: "price", sort: "desc" }] });
    await settle(400);
    assert.deepEqual([model.requests.at(-1).sort, model.requests.at(-1).order], ["price", "desc"]);
    assert.equal(api.getDisplayedRowAtIndex(0).data.price, 119);
  } finally {
    abort.abort();
  }
});

test("a widget with no block param says so", async () => {
  const model = makeModel({ data: trades.slice(0, 10), params: {} });
  const { el, abort } = mount();
  plugin.initialize({ model });
  await plugin.render({ model, el, signal: abort.signal });
  await settle(200);
  assert.match(el.querySelector(".ag-strip").textContent, /declares no block param/);
  abort.abort();
});
