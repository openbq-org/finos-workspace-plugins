import assert from "node:assert/strict";
import { test } from "node:test";

import { experimental, liveApi, makeModel, mount, settle } from "./dom.mjs";
import plugin, { csvOf, gridColumns, gridRows, identifier, MAX_STATIC_BYTES, resultOf, schemaOf, SQL_PARAM, staticTableData } from "../src/sql.js";

const schema = { engine: "SQLite 3.50", tables: [{ name: "trades", columns: [{ name: "desk", type: "TEXT" }, { name: "qty", type: "INTEGER" }] }] };
const result = { schema, columns: [{ name: "desk", type: "TEXT" }, { name: "n", type: "" }], rows: [["FX", 3], ["Rates", 2]], truncated: false, elapsedMs: 4 };

test("answers become a result, a schema or an error", () => {
  assert.deepEqual(resultOf(result).rows, [["FX", 3], ["Rates", 2]]);
  assert.deepEqual(resultOf([{ a: 1, b: "x" }]), { columns: [{ name: "a", type: "" }, { name: "b", type: "" }], rows: [[1, "x"]], truncated: false, elapsedMs: null });
  assert.equal(resultOf({ error: "no such table" }).error, "no such table");
  assert.equal(resultOf({ schema }), null);
  assert.deepEqual(schemaOf({ schema }).tables[0].columns.map((c) => c.name), ["desk", "qty"]);
  assert.equal(schemaOf({}), null);
  assert.equal(identifier("trades"), "trades");
  assert.equal(identifier("My Table"), '"My Table"');
  assert.equal(csvOf(resultOf(result)), "desk,n\nFX,3\nRates,2");
  assert.equal(gridColumns(resultOf(result))[1].type, "numericColumn");
  assert.deepEqual(gridRows(resultOf(result))[0], { 0: "FX", 1: 3 });
});

test("Run writes the query to the sql body param, and the answer shows in the grid with the tables beside it", async () => {
  const model = makeModel({ data: { schema }, params: { [SQL_PARAM]: "" } });
  const { el, abort } = mount();
  const exposed = plugin.initialize({ model });
  await plugin.render({ model, el, signal: abort.signal, experimental });
  assert.deepEqual([...el.querySelectorAll(".sx-name")].map((b) => b.textContent), ["trades"]);
  assert.equal(el.querySelector(".sx-engine").textContent, "SQLite 3.50");

  const editor = el.querySelector(".sx-editor");
  editor.value = "SELECT desk, count(*) AS n FROM trades GROUP BY desk";
  el.querySelector(".sx-run").click();
  assert.equal(model.values.params[SQL_PARAM], editor.value);
  assert.equal(el.querySelector(".sx-status").textContent, "Running…");
  assert.equal(el.querySelector(".sx-run").disabled, true);

  model.push("data", undefined);
  model.push("data", result);
  await settle();
  assert.match(el.querySelector(".sx-status").textContent, /^2 rows · 4 ms/);
  const api = await liveApi(el);
  assert.equal(api.getDisplayedRowCount(), 2);
  assert.ok(api.getGridOption("rowGroupPanelShow"));
  assert.deepEqual(await exposed.exportOptions().then((o) => o.map((x) => x.id)), ["csv", "json"]);
  assert.equal((await exposed.copilotContext()).rows, 2);

  model.push("data", { schema, error: "no such column: x" });
  assert.equal(el.querySelector(".sx-message").textContent, "no such column: x");
  abort.abort();
  assert.equal(model.listenerCount("change:data"), 0);
});

test("a widget without the sql param says so", async () => {
  const model = makeModel({ data: { schema }, params: {} });
  const { el, abort } = mount();
  plugin.initialize({ model });
  await plugin.render({ model, el, signal: abort.signal, experimental });
  assert.match(el.querySelector(".sx-message").textContent, /declares no sql/);
  abort.abort();
});

test("a static copy keeps the columns and rows the table widget's artifact takes", () => {
  const long = "x".repeat(600);
  const many = { columns: [{ name: "site", type: "TEXT" }, { name: "n", type: "INTEGER" }, { name: "n", type: "INTEGER" }, { name: "a.b", type: "TEXT" }], rows: [...Array(1200)].map((_, i) => ["s", i, i, { at: i }]).concat([["s", 0, 0, long]]) };
  const data = staticTableData(resultOf(many));
  assert.deepEqual(data.columnDefs, [
    { field: "0", headerName: "site" },
    { field: "1", headerName: "n", type: "numericColumn" },
    { field: "2", headerName: "n", type: "numericColumn" },
    { field: "3", headerName: "a.b" },
  ]);
  assert.equal(data.rowData.length, 1000);
  assert.deepEqual(data.rowData[7], { 0: "s", 1: 7, 2: 7, 3: '{"at":7}' });
  assert.equal(staticTableData(resultOf({ ...many, rows: [["s", 0, 0, long]] })).rowData[0][3].length, 500);
  assert.equal(staticTableData(resultOf({ ...many, rows: [["s", Number.NaN, null, undefined]] })).rowData[0][1], null);
});

test("a static copy keeps the first 60 columns and stays under 380,000 bytes", () => {
  const wide = { columns: [...Array(80)].map((_, i) => ({ name: `c${i}`, type: "TEXT" })), rows: [...Array(1000)].map(() => [...Array(80)].map(() => "y".repeat(200))) };
  const data = staticTableData(resultOf(wide));
  assert.equal(data.columnDefs.length, 60);
  assert.deepEqual(Object.keys(data.rowData[0]), data.columnDefs.map((c) => c.field));
  const bytes = new TextEncoder().encode(JSON.stringify(data)).byteLength;
  assert.ok(bytes <= MAX_STATIC_BYTES, `${bytes} bytes`);
  assert.ok(data.rowData.length > 0 && data.rowData.length < 1000);
});

test("Create static widget adds a table of the last result, and says when there is none or the host refuses", async () => {
  const calls = [];
  let refuse = null;
  const host = {
    async invoke(name, message) {
      calls.push([name, message]);
      if (refuse) throw refuse;
      return [{ instanceId: "w1" }, []];
    },
  };
  const model = makeModel({ data: { schema }, params: { [SQL_PARAM]: "" } });
  const { el, abort } = mount();
  plugin.initialize({ model });
  await plugin.render({ model, el, signal: abort.signal, experimental: host });
  try {
    const status = () => el.querySelector(".sx-status").textContent;
    model.emit("msg:custom", { kind: "workspace-event", name: "action", id: "freeze" });
    await settle(20);
    assert.match(status(), /Run a query first/);
    assert.equal(calls.filter(([name]) => name === "core:dashboard:add-widget").length, 0);

    model.values.params = { [SQL_PARAM]: "SELECT desk, count(*) AS n FROM trades GROUP BY desk" };
    model.push("data", result);
    model.emit("msg:custom", { kind: "workspace-event", name: "action", id: "freeze" });
    await settle(20);
    const added = calls.filter(([name]) => name === "core:dashboard:add-widget");
    assert.equal(added.length, 1);
    assert.deepEqual(added[0][1], { widget: "table", data: { columnDefs: [{ field: "0", headerName: "desk" }, { field: "1", headerName: "n", type: "numericColumn" }], rowData: [{ 0: "FX", 1: 3 }, { 0: "Rates", 1: 2 }] } });
    assert.equal(status(), "Static widget created");

    refuse = new Error("the dashboard is read-only");
    model.emit("msg:custom", { kind: "workspace-event", name: "action", id: "freeze" });
    await settle(20);
    assert.equal(status(), "the dashboard is read-only");
    model.emit("msg:custom", { kind: "workspace-event", name: "action", id: "autosize" });
    await settle(20);
    assert.equal(calls.filter(([name]) => name === "core:dashboard:add-widget").length, 2);
  } finally {
    abort.abort();
  }
  assert.equal(model.listenerCount("msg:custom"), 0);
});
