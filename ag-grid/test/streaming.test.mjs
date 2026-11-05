import assert from "node:assert/strict";
import { test } from "node:test";

import { experimental, makeModel, mount, settle } from "./dom.mjs";
import plugin, { applyMessage, FLUSH_MS, statusText } from "../src/streaming.js";

const columnDefs = [{ field: "id" }, { field: "symbol" }, { field: "price" }];
const rows = [
  { id: "a", symbol: "AAA", price: 1 },
  { id: "b", symbol: "BBB", price: 2 },
];

const stream = (model, ...messages) => model.emit("msg:custom", { kind: "workspace-event", name: "stream", messages });
const status = (model, state, retryIn) => model.emit("msg:custom", { kind: "workspace-event", name: "stream-status", state, retryIn });

test("messages change the rows by id, and an upsert merges into the row", () => {
  const byId = new Map();
  let change = applyMessage(byId, { op: "snapshot", rows });
  assert.equal(change.replaced, true);
  assert.deepEqual([...byId.keys()], ["a", "b"]);
  change = applyMessage(byId, { op: "upsert", rows: [{ id: "b", price: 3 }, { id: "c", symbol: "CCC" }, { symbol: "no id" }] });
  assert.deepEqual([...change.touched], ["b", "c"]);
  assert.deepEqual(byId.get("b"), { id: "b", symbol: "BBB", price: 3 });
  change = applyMessage(byId, { op: "remove", ids: ["a", "zzz"] });
  assert.deepEqual([...change.removed], ["a", "zzz"]);
  assert.equal(byId.has("a"), false);
  assert.equal(applyMessage(byId, null).replaced, false);
  applyMessage(byId, { op: "upsert", rows: [{ sym: "X", price: 1 }] }, "sym");
  assert.equal(byId.get("X").price, 1);
});

test("the strip says what the host reports", () => {
  assert.equal(statusText({ state: "connecting" }), "Connecting…");
  assert.equal(statusText({ state: "live" }), "Live");
  assert.equal(statusText({ state: "retrying", retryIn: 4 }), "Disconnected, retrying in 4 s");
  assert.equal(statusText({ state: "closed" }), "Closed");
});

test("the grid follows the host's stream: updates, new rows and removals", async () => {
  const model = makeModel({ data: { columnDefs, rowData: rows } });
  const { el, abort } = mount();
  const exposed = plugin.initialize({ model });
  await plugin.render({ model, el, signal: abort.signal, experimental });
  await settle();

  assert.equal(el.querySelector(".ag-strip").textContent, "Connecting…");
  status(model, "live");
  assert.equal(el.querySelector(".ag-strip").dataset.live, "true");

  stream(model, { op: "upsert", rows: [{ id: "b", price: 5 }, { id: "c", symbol: "CCC", price: 9 }] }, { op: "remove", ids: ["a"] });
  await settle(FLUSH_MS * 2);
  let ctx = exposed.copilotContext();
  assert.equal(ctx.rowCount, 2);
  assert.equal(ctx.stats.price.sum, 14);

  stream(model, { op: "snapshot", rows: [{ id: "z", symbol: "ZZZ", price: 1 }] });
  await settle(FLUSH_MS * 2);
  assert.equal(exposed.copilotContext().rowCount, 1);

  model.emit("msg:custom", { kind: "something-else", name: "stream", messages: [{ op: "snapshot", rows: [] }] });
  await settle(FLUSH_MS * 2);
  ctx = exposed.copilotContext();
  assert.equal(ctx.rowCount, 1);

  abort.abort();
  assert.equal(model.listenerCount("msg:custom"), 0);
});

test("the first rows may arrive after the first render, and changes flash", async () => {
  const definition = { columnsDefs: [{ field: "id" }, { field: "price", renderFn: "showCellChange" }] };
  const model = makeModel({ data: undefined, definition });
  const { el, abort } = mount();
  const exposed = plugin.initialize({ model });
  await plugin.render({ model, el, signal: abort.signal, experimental });
  await settle();
  model.push("data", rows);
  await settle();
  assert.equal(exposed.copilotContext().rowCount, 2);
  stream(model, { op: "upsert", rows: [{ id: "a", price: 0.5 }] });
  await settle(FLUSH_MS * 2);
  assert.ok(el.querySelector('.ag-row[row-id="a"] .ag-cell[col-id="price"]').classList.contains("ag-table-chart-cell-down"));
  abort.abort();
});
