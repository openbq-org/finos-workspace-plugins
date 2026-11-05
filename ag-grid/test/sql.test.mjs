import assert from "node:assert/strict";
import { test } from "node:test";

import { experimental, liveApi, makeModel, mount, settle } from "./dom.mjs";
import plugin, { csvOf, gridColumns, gridRows, identifier, resultOf, schemaOf, SQL_PARAM } from "../src/sql.js";

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
