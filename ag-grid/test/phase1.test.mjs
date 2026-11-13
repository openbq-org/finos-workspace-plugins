import assert from "node:assert/strict";
import { test } from "node:test";

import "./dom.mjs";
import { abbreviated, clipped, formatValue, MAX_CELL_TEXT } from "../src/ag-table-chart/format.js";
import { looksLikeLinks, tooltipTextOf, truncationCheck } from "../src/ag-table-chart/columns.js";
import { sparklineOptions, sparklinePoints } from "../src/ag-table-chart/sparkline.js";
import { conditionText, filterChips } from "../src/filterBar.js";
import { displaySettingsOf, orgThemeParams, paginationFor } from "../src/grid.js";
import { activeRowRules, cellChanges, isActiveRow } from "../src/table.js";

const model = (config) => ({ get: (key) => (key === "config" ? config : undefined) });

test("compact numbers: a million and up as M, B or T; below that grouped", () => {
  assert.equal(abbreviated(45e9, 2, "en-US"), "45.00B");
  assert.equal(abbreviated(-1.5e6, 1, "en-US"), "-1.5M");
  assert.equal(abbreviated(2.5e12, 2, "en-US"), "2.50T");
  assert.equal(abbreviated(999999, 2, "en-US"), null);
  assert.equal(formatValue(45e9, { formatterFn: "compact", locale: "en-US" }), "45.00B");
  assert.equal(formatValue(12345, { formatterFn: "compact", locale: "en-US" }), "12,345");
  assert.equal(formatValue(45e9, { abbreviate: true, locale: "en-US", prefix: "$" }), "$45.00B");
  assert.equal(formatValue(0.25, { abbreviate: true, formatterFn: "percent", locale: "en-US" }), "0.25%", "a column's own formatterFn wins");
});

test("empty cells show the definition's text, and long texts are clipped", () => {
  assert.equal(formatValue(null, { emptyValue: "-" }), "-");
  assert.equal(formatValue("", {}), "");
  const long = "x".repeat(MAX_CELL_TEXT + 50);
  assert.equal(clipped(long).length, MAX_CELL_TEXT);
  assert.ok(clipped(long).endsWith("…"));
  assert.equal(clipped("short"), "short");
});

test("links and tooltips", () => {
  assert.equal(looksLikeLinks([{ u: "https://a.com/x" }, { u: "https://b.org" }, { u: "" }], "u"), true);
  assert.equal(looksLikeLinks([{ u: "text" }, { u: "https://b.org" }, { u: "more text" }], "u"), false);
  const long = "a long description that goes on and on past forty characters";
  assert.equal(tooltipTextOf({ value: long, context: {} }, {}), long);
  assert.equal(tooltipTextOf({ value: "short", context: {} }, {}), undefined);
  assert.equal(tooltipTextOf({ value: "short", context: { isTruncated: () => true } }, {}), "short", "a cut-off text shows in full");
  assert.equal(tooltipTextOf({ value: long, context: { isTruncated: () => false } }, {}), undefined, "a text that fits needs no tooltip");
  assert.equal(tooltipTextOf({ value: "x".repeat(300), context: { isTruncated: () => false } }, {}).length, 300, "a clipped long text always shows in full");
  assert.equal(tooltipTextOf({ value: 45e9, valueFormatted: "45.00B", context: { locale: "en-US" } }, {}), "45,000,000,000");
  assert.equal(tooltipTextOf({ value: 45, valueFormatted: "45", context: {} }, {}), undefined);
});

test("the active filters read as chips", () => {
  assert.equal(conditionText({ filterType: "number", type: "greaterThan", filter: 10 }), "> 10");
  assert.equal(conditionText({ filterType: "number", type: "inRange", filter: 1, filterTo: 5 }), "between 1 and 5");
  assert.equal(conditionText({ filterType: "text", type: "contains", filter: "abc" }), "contains abc");
  assert.equal(conditionText({ filterType: "text", type: "blank" }), "is blank");
  assert.equal(conditionText({ filterType: "date", type: "equals", dateFrom: "2024-03-01 00:00:00" }), "= 2024-03-01");
  assert.equal(conditionText({ filterType: "set", values: ["a", "b", "c", "d", "e"] }), "in a, b, c +2 more");
  assert.equal(
    conditionText({ filterType: "number", operator: "OR", conditions: [{ type: "lessThan", filter: 1 }, { type: "greaterThan", filter: 9 }] }),
    "< 1 or > 9",
  );
  assert.deepEqual(filterChips({ tvl: { filterType: "number", type: "greaterThanOrEqual", filter: 5 } }, () => "TVL"), [{ colId: "tvl", label: "TVL", text: "≥ 5" }]);
});

test("the card's display settings and the pages they make", () => {
  assert.deepEqual(displaySettingsOf(model({})), { decimals: undefined, abbreviate: false, statusBar: true, pagination: "auto", pageSize: null });
  const s = displaySettingsOf(model({ decimals: 4, abbreviateNumbers: true, statusBar: false, pagination: "on", pageSize: "200" }));
  assert.deepEqual(s, { decimals: 4, abbreviate: true, statusBar: false, pagination: "on", pageSize: 200 });
  assert.equal(displaySettingsOf(model({ decimals: 99, pageSize: "auto" })).decimals, undefined);

  const auto = displaySettingsOf(model({}));
  assert.deepEqual(paginationFor(auto, {}, 50), { pagination: false });
  assert.deepEqual(paginationFor(auto, {}, 500), { pagination: true, paginationAutoPageSize: true });
  assert.deepEqual(paginationFor(auto, { pagination: false }, 500), { pagination: false }, "the backend decides when the card says auto");
  assert.deepEqual(paginationFor(s, { pagination: false }, 5), { pagination: true, paginationAutoPageSize: false, paginationPageSize: 200 }, "the card's choice wins");
  assert.deepEqual(paginationFor({ ...auto, pagination: "off" }, { pagination: true }, 500), { pagination: false });
});

test("the organization's look takes only values that fit", () => {
  assert.deepEqual(orgThemeParams({}), {});
  const params = orgThemeParams({ accentColor: "#2563eb", fontFamily: "Inter, sans-serif", fontSize: 13, rowHeight: 28, stripedRows: true, columnBorders: false, headerBackgroundColor: "rgb(1, 2, 3)" });
  assert.equal(params.accentColor, "#2563eb");
  assert.equal(params.fontFamily, "Inter, sans-serif");
  assert.equal(params.fontSize, 13);
  assert.equal(params.rowHeight, 28);
  assert.equal(params.columnBorder, false);
  assert.equal(params.headerBackgroundColor, "rgb(1, 2, 3)");
  assert.ok(params.oddRowBackgroundColor.mix > 0);
  assert.deepEqual(orgThemeParams({ accentColor: "url(javascript:x)", fontFamily: "a;}body{", fontSize: 200, rowHeight: 2.5 }), {});
});

test("the row the card's parameter points at", () => {
  const rules = activeRowRules([
    { field: "symbol", renderFn: "cellOnClick", renderFnParams: { actionType: "groupBy", groupBy: { paramName: "symbol" } } },
    { field: "name", renderFn: "cellOnClick", renderFnParams: { actionType: "openUrl" } },
    { field: "x", renderFn: "greenRed" },
  ]);
  assert.deepEqual(rules, [{ paramName: "symbol", field: "symbol" }]);
  assert.equal(isActiveRow(rules, { symbol: "MSFT" }, { symbol: "MSFT" }), true);
  assert.equal(isActiveRow(rules, { symbol: "AAPL" }, { symbol: "MSFT" }), false);
  assert.equal(isActiveRow(rules, { symbol: "AAPL" }, { symbol: "" }), false);
});

test("a change records how far each cell's own number moved", () => {
  const deltas = new Map();
  const changes = cellChanges([{ id: "a", p: 10, s: "A" }], [{ id: "a", p: 10.5, s: "A" }], [{ field: "p", compareField: "p" }, { field: "s", compareField: "p" }], "id", deltas);
  assert.equal(changes.get("a|p"), "up");
  assert.equal(changes.get("a|s"), "up");
  assert.equal(deltas.get("a|p"), 0.5);
  assert.equal(deltas.has("a|s"), false, "a text column flashes but has no arrow");
});

test("sparklines take object points, a tooltip, an axis and bar labels", () => {
  const points = sparklinePoints([{ d: "Mon", v: 1 }, { d: "Tue", v: 3 }], { xKey: "d", yKey: "v" });
  assert.deepEqual(points.map((p) => [p.label, p.y, p.max]), [["Mon", 1, false], ["Tue", 3, true]]);
  const options = sparklineOptions({ type: "bar", options: { tooltip: { enabled: false }, axis: { visible: true, stroke: "#999" }, label: { enabled: true, placement: "outside-end", color: "red" } } });
  assert.deepEqual(options.tooltip, { enabled: false });
  assert.deepEqual(options.axis, { visible: true, stroke: "#999" });
  assert.deepEqual(options.label, { enabled: true, placement: "outside-end", color: "red" });
  const line = sparklineOptions({ type: "line", options: { markers: { enabled: true, shape: "diamond" } } });
  assert.equal(line.marker.shape, "diamond");
});

test("the column menu adds Hide column, and Narrow column for a wide one", async () => {
  const { columnMenuItems } = await import("../src/grid.js");
  const calls = [];
  const api = { setColumnsVisible: (...a) => calls.push(["hide", ...a]), setColumnWidths: (a) => calls.push(["width", a]) };
  const wide = { getActualWidth: () => 320 };
  const items = columnMenuItems({ api, column: wide, defaultItems: ["sortAscending"] });
  assert.deepEqual(items.slice(0, 2), ["sortAscending", "separator"]);
  assert.deepEqual(items.slice(2).map((i) => i.name), ["Hide column", "Narrow column"]);
  items[2].action();
  items[3].action();
  assert.deepEqual(calls, [["hide", [wide], false], ["width", [{ key: wide, newWidth: 150 }]]]);
  assert.deepEqual(columnMenuItems({ api, column: { getActualWidth: () => 120 }, defaultItems: [] }).map((i) => i.name ?? i), ["separator", "Hide column"]);
});

test("the truncation check measures the cell on screen", () => {
  const root = document.createElement("div");
  root.innerHTML = '<div class="ag-row" row-id="r1"><div class="ag-cell" col-id="name"><span class="ag-cell-value">A long name</span></div></div>';
  const value = root.querySelector(".ag-cell-value");
  Object.defineProperty(value, "scrollWidth", { value: 300, configurable: true });
  Object.defineProperty(value, "clientWidth", { value: 100, configurable: true });
  const check = truncationCheck(root);
  const column = (id) => ({ getColId: () => id });
  assert.equal(check({ id: "r1" }, column("name")), true);
  assert.equal(check({ id: "r2" }, column("name")), undefined, "a cell off screen is not measured");
  Object.defineProperty(value, "scrollWidth", { value: 100, configurable: true });
  assert.equal(check({ id: "r1" }, column("name")), false);
});

test("names of the widgets the plugin adds", async () => {
  const { chartName, fileName, queryName } = await import("../src/names.js");
  assert.equal(chartName([{ field: "q", headerName: "Quarter", chartDataType: "category" }, { field: "r", headerName: "Revenue" }, { field: "c", headerName: "Cost" }]), "Revenue and Cost by Quarter");
  assert.equal(chartName([{ field: "g", headerName: "Region", chartDataType: "category" }, { field: "a" }, { field: "b" }, { field: "c" }]), "a, b and 1 more by Region");
  assert.equal(fileName("positions.xlsx", "By desk"), "positions (By desk)");
  assert.equal(fileName("trades.csv"), "trades");
  assert.equal(queryName('SELECT * FROM "sales"."orders" o WHERE x'), "sales.orders query");
  assert.equal(queryName("SELECT 1"), "Query result");
});
