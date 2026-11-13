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

test("{{parameters}}: defined in the card, filled in as SQL literals, saved, and named when undefined", async () => {
  const { notifications } = await import("./dom.mjs");
  const model = makeModel({ data: { schema }, params: { [SQL_PARAM]: "" } });
  const { el, abort } = mount();
  plugin.initialize({ model });
  await plugin.render({ model, el, signal: abort.signal, experimental });
  try {
    const editor = el.querySelector(".sx-editor");
    editor.value = "SELECT * FROM trades WHERE desk = {{desk}} AND qty > {{min_qty}}";
    editor.dispatchEvent(new Event("input"));
    const badge = el.querySelector(".sx-missing");
    assert.equal(badge.hidden, false);
    assert.equal(badge.textContent, "2 undefined");
    el.querySelector(".sx-run").click();
    assert.match(el.querySelector(".sx-message").textContent, /Define the parameters \{\{desk\}\}, \{\{min_qty\}\}/);
    assert.equal(model.values.params[SQL_PARAM], "", "nothing ran");

    badge.click();
    const rows = el.querySelectorAll(".sx-param-row");
    assert.equal(rows.length, 2, "the badge seeds the editor with the missing names");
    const [, , defaultInput] = rows[1].querySelectorAll("input");
    const type = rows[1].querySelector("select");
    type.value = "number";
    type.dispatchEvent(new Event("change"));
    const again = el.querySelectorAll(".sx-param-row")[1].querySelectorAll("input")[2];
    again.value = "100";
    again.dispatchEvent(new Event("input"));
    const deskDefault = el.querySelectorAll(".sx-param-row")[0].querySelectorAll("input")[2];
    deskDefault.value = "O'Neil";
    deskDefault.dispatchEvent(new Event("input"));
    assert.ok(defaultInput);
    [...el.querySelectorAll(".sx-param-editor .sx-run")].find((b) => b.textContent === "Done").click();
    assert.equal(badge.hidden, true);
    assert.equal(el.querySelectorAll(".sx-params .sx-param").length, 2, "a control per parameter");

    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
    assert.equal(model.values.params[SQL_PARAM], "SELECT * FROM trades WHERE desk = 'O''Neil' AND qty > 100");

    model.push("data", result);
    await settle();
    const min = el.querySelector('.sx-params [data-param="min_qty"]');
    min.value = "250";
    min.dispatchEvent(new Event("change"));
    assert.ok(el.querySelector(".sx-run").classList.contains("sx-stale"), "a changed parameter asks for a run");
    assert.equal(el.querySelector(".sx-status").textContent, "Changed: press Run");
    el.querySelector(".sx-run").click();
    assert.match(model.values.params[SQL_PARAM], /qty > 250$/);
    await settle(700);
    const state = model.get("state");
    assert.deepEqual(state.sqlParams.map((p) => [p.name, p.type]), [["desk", "text"], ["min_qty", "number"]]);
    assert.deepEqual(state.sqlValues, { min_qty: "250" });

    notifications.length = 0;
    model.push("data", result);
    await settle();
    el.querySelector(".sx-tool:nth-of-type(3)");
    [...el.querySelectorAll(".sx-tool")].find((b) => b.textContent === "Copy table").click();
    await settle();
    const copied = notifications.find(([name]) => name === "core:clipboard:write");
    assert.equal(copied?.[1].text.split("\n")[0], "desk\tn");
  } finally {
    abort.abort();
  }
});

test("a backend that names the param query gets the query there, and one long text shows as text", async () => {
  const model = makeModel({ data: { schema }, params: { query: "" } });
  const { el, abort } = mount();
  plugin.initialize({ model });
  await plugin.render({ model, el, signal: abort.signal, experimental });
  try {
    const editor = el.querySelector(".sx-editor");
    editor.value = "SELECT summary FROM notes";
    el.querySelector(".sx-run").click();
    assert.equal(model.values.params.query, "SELECT summary FROM notes");
    const long = `# Summary\n\n${"The desk traded more this week. ".repeat(6)}`;
    model.push("data", { columns: [{ name: "summary", type: "TEXT" }], rows: [[long]] });
    await settle();
    assert.ok(el.querySelector(".sx-markdown"), "a single long text is not a grid");
    assert.equal(el.querySelector(".sx-markdown h1, .sx-markdown h2, .sx-markdown strong")?.textContent ?? el.querySelector(".sx-markdown").textContent.slice(0, 7), "Summary");
  } finally {
    abort.abort();
  }
});

test("serverSide: the first answer is the first page, and a sort asks the backend with the query and the grid state", async () => {
  const rows = Array.from({ length: 250 }, (_, i) => ({ id: `T${i}`, qty: i }));
  const model = makeModel({ data: { schema }, params: { [SQL_PARAM]: "", gridState: "" }, definition: { serverSide: true, pageSize: 50 } });
  const set = model.set.bind(model);
  const asked = [];
  model.set = (key, value) => {
    const before = model.values.params;
    set(key, value);
    if (key !== "params") return;
    const state = value.gridState ? JSON.parse(value.gridState) : null;
    if (before.gridState === value.gridState && before[SQL_PARAM] === value[SQL_PARAM]) return;
    asked.push({ sql: value[SQL_PARAM], state });
    setTimeout(() => {
      const sorted = state?.sortModel?.[0]?.sort === "desc" ? [...rows].reverse() : rows;
      const start = state?.startRow ?? 0;
      model.push("data", { schema, seq: state?.seq, rowData: sorted.slice(start, state?.endRow ?? 50), rowCount: rows.length });
    }, 5);
  };
  const { el, abort } = mount();
  plugin.initialize({ model });
  await plugin.render({ model, el, signal: abort.signal, experimental });
  try {
    el.querySelector(".sx-editor").value = "SELECT id, qty FROM trades";
    el.querySelector(".sx-run").click();
    await settle(300);
    assert.equal(asked.length, 1, "the run, and no request for the first page");
    assert.match(el.querySelector(".sx-status").textContent, /^250 rows, paged on the server/);
    const api = await liveApi(el);
    assert.equal(api.getGridOption("rowModelType"), "serverSide");
    assert.equal(api.getGridOption("cacheBlockSize"), 50);
    assert.equal(api.getDisplayedRowAtIndex(0)?.data?.id, "T0");

    api.applyColumnState({ state: [{ colId: "qty", sort: "desc" }] });
    await settle(400);
    const last = asked.at(-1);
    assert.equal(last.sql, "SELECT id, qty FROM trades", "every page request carries the query");
    assert.deepEqual(last.state.sortModel, [{ colId: "qty", sort: "desc" }]);
    assert.equal(api.getDisplayedRowAtIndex(0)?.data?.id, "T249");
  } finally {
    abort.abort();
  }
});
