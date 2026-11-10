import assert from "node:assert/strict";
import { test } from "node:test";

import { makeModel } from "./dom.mjs";
import {
  baseOptions,
  withoutFilterPanels,
  baseThemeName,
  baseThemeOf,
  compactColumnDefs,
  createStateChannel,
  DEFAULT_BASE_THEME,
  DEFAULT_COL_DEF,
  EXPRESSION_ERROR,
  gridOptionsFor,
  hasIds,
  idFieldOf,
  MAX_STATE_TEXT,
  numericStats,
  rowIdGetter,
  rowIdOf,
  rowsOf,
  sampleRows,
  siteColors,
  stateText,
  STATE_PARAM,
  withExpressions,
} from "../src/grid.js";

test("the site's colour tokens colour the grid, with a fallback for each mode", () => {
  const tokens = { card: "#101418", "card-foreground": "#eeeeee", border: "#333333", "brand-main": "#ff6600", "font-family": "Montserrat, sans-serif" };
  assert.deepEqual(siteColors({ mode: "dark", tokens }), {
    mode: "dark",
    background: "#101418",
    foreground: "#eeeeee",
    border: "#333333",
    accent: "#ff6600",
    fontFamily: "Montserrat, sans-serif",
  });
  assert.equal(siteColors({ mode: "dark", tokens: { background: "#000000" } }).background, "#000000");
  assert.equal(siteColors({ mode: "light" }).background, "#ffffff");
  assert.equal(siteColors(undefined).mode, "light");
});

test("the base theme is the card's, then the backend's, then the organization's, then the compact balham", () => {
  assert.equal(DEFAULT_BASE_THEME, "balham");
  assert.equal(baseThemeName(), "balham");
  assert.equal(baseThemeName("nope", undefined, "alpine"), "alpine");
  const model = makeModel({ config: { theme: "material" }, adminSettings: { theme: "alpine" } });
  assert.equal(baseThemeOf(model, { theme: "quartz" }), "material");
  assert.equal(baseThemeOf(makeModel({ adminSettings: { theme: "alpine" } }), { theme: "quartz" }), "quartz");
  assert.equal(baseThemeOf(makeModel({ adminSettings: { theme: "alpine" } })), "alpine");
});

test("the Advanced Filter card setting reaches the client-side and server-side grids, never the infinite one", () => {
  const model = makeModel({ config: { advancedFilter: true } });
  const table = gridOptionsFor({ model, columnDefs: [] });
  assert.equal(table.enableAdvancedFilter, true);
  assert.deepEqual(table.sideBar.toolPanels, ["columns"]);
  const ssrm = gridOptionsFor({ model, serverSide: true, rowModelType: "serverSide", columnDefs: [] });
  assert.equal(ssrm.enableAdvancedFilter, true);
  const infinite = gridOptionsFor({ model, rowModelType: "infinite", gridOptions: { enableAdvancedFilter: true }, columnDefs: [] });
  assert.equal(infinite.enableAdvancedFilter, undefined);
  assert.deepEqual(infinite.sideBar.toolPanels, ["columns", "filters-new"]);
  const off = gridOptionsFor({ model: makeModel({}), columnDefs: [] });
  assert.equal(off.enableAdvancedFilter, undefined);
  assert.deepEqual(off.sideBar.toolPanels, ["columns", "filters-new"]);
});

test("withoutFilterPanels keeps every other panel, in each form a side bar takes", () => {
  assert.equal(withoutFilterPanels(false), false);
  assert.deepEqual(withoutFilterPanels(true).toolPanels, ["columns"]);
  assert.equal(withoutFilterPanels("filters"), false);
  assert.equal(withoutFilterPanels("columns"), "columns");
  assert.deepEqual(withoutFilterPanels(["columns", "filters", "filters-new"]), ["columns"]);
  assert.deepEqual(
    withoutFilterPanels({ toolPanels: [{ id: "columns", toolPanel: "agColumnsToolPanel" }, { id: "f", toolPanel: "agNewFiltersToolPanel" }], defaultToolPanel: "filters-new" }),
    { toolPanels: [{ id: "columns", toolPanel: "agColumnsToolPanel" }], defaultToolPanel: "" },
  );
});

test("every grid groups, pivots, aggregates and charts; a backend's options win, its theme name and cell expressions do not reach AG Grid", () => {
  const model = makeModel({});
  const options = gridOptionsFor({ model, gridOptions: { theme: "alpine", enableCellExpressions: true, pagination: true, defaultColDef: { editable: true } }, columnDefs: [] });
  assert.equal(options.rowGroupPanelShow, "always");
  assert.equal(options.pivotPanelShow, "always");
  assert.deepEqual(options.sideBar.toolPanels, ["columns", "filters-new"]);
  assert.equal(options.enableCharts, true);
  assert.equal(options.cellSelection, true);
  assert.equal(options.enableCellExpressions, undefined);
  assert.equal(options.pagination, true);
  assert.equal(typeof options.theme, "object");
  assert.deepEqual(options.defaultColDef, { ...DEFAULT_COL_DEF, editable: true });
  assert.ok(options.defaultColDef.enableRowGroup && options.defaultColDef.enablePivot && options.defaultColDef.enableValue);
  const server = baseOptions(model, {}, { serverSide: true });
  assert.deepEqual(server.statusBar.statusPanels.map((p) => p.statusPanel), ["agAggregationComponent"]);
});

test("rows come from records, a dict of columns, pandas split or rowData", () => {
  const records = [{ a: 1, b: "x" }, { a: 2, b: "y" }];
  assert.deepEqual(rowsOf(records), records);
  assert.deepEqual(rowsOf({ a: [1, 2], b: ["x", "y"] }), records);
  assert.deepEqual(rowsOf({ data: { a: [1, 2], b: ["x", "y"] } }), records);
  assert.deepEqual(rowsOf({ columns: ["a", "b"], index: [0, 1], data: [[1, "x"], [2, "y"]] }), records);
  assert.deepEqual(rowsOf({ rowData: records }), records);
  assert.deepEqual(rowsOf(undefined), []);
  assert.deepEqual(rowsOf({ transaction: { add: [] } }), []);
});

test("row ids come from the id field, and rows without one get an id of their own", () => {
  assert.equal(idFieldOf({ wsRowIdColumn: "symbol" }), "symbol");
  assert.equal(idFieldOf({}), "id");
  assert.equal(rowIdOf({ symbol: "AAPL" }, 3, "symbol"), "AAPL");
  assert.equal(rowIdOf({}, 5), "5");
  assert.equal(hasIds([{ id: 0 }, { id: 1 }]), true);
  assert.equal(hasIds([]), false);
  const getRowId = rowIdGetter("id");
  const plain = { x: 1 };
  assert.equal(getRowId({ data: { id: 7 } }), "7");
  assert.equal(getRowId({ data: plain }), getRowId({ data: plain }));
  assert.notEqual(getRowId({ data: plain }), getRowId({ data: { x: 1 } }));
});

test("numeric columns are formatted, and stats skip what is not a number", () => {
  const out = compactColumnDefs([{ field: "units" }, { field: "name" }, { headerName: "G", children: [{ field: "units" }] }], [{ units: 1234567, name: "a" }]);
  assert.equal(out[0].type, "numericColumn");
  assert.equal(out[1].type, undefined);
  assert.equal(out[2].children[0].type, "numericColumn");
  assert.deepEqual(numericStats([{ s: 10 }, { s: null }, { s: NaN }, { s: 30 }], ["s"]).s, { count: 2, min: 10, max: 30, sum: 40, avg: 20 });
});

test("the grid state fits the body param, dropping the selection first", () => {
  const short = JSON.parse(stateText(3, { event: { type: "x" }, selectedRowIds: ["a"] }));
  assert.deepEqual(short, { seq: 3, event: { type: "x" }, selectedRowIds: ["a"] });
  const many = Array.from({ length: 2000 }, (_, i) => `row-${i}`);
  const trimmed = JSON.parse(stateText(4, { event: { type: "selectionChanged" }, selectedRowIds: many }));
  assert.deepEqual(trimmed.selectedRowIds, []);
  assert.equal(trimmed.selectedRowCount, 2000);
});

test("the state channel writes only a declared param, and refuses what is too long", () => {
  const undeclared = createStateChannel(makeModel({}));
  assert.equal(undeclared.declared, false);
  const model = makeModel({ params: { [STATE_PARAM]: "", other: "x" } });
  const channel = createStateChannel(model, 0);
  assert.equal(channel.declared, true);
  const sent = channel.send({ event: { type: "filterChanged" } });
  assert.equal(sent.seq, 1);
  assert.equal(model.values.params.other, "x");
  assert.deepEqual(JSON.parse(model.values.params[STATE_PARAM]), { seq: 1, event: { type: "filterChanged" } });
  assert.equal(channel.current(), sent.text);
  const long = channel.send({ event: { type: "x" }, filterModel: { a: "y".repeat(MAX_STATE_TEXT) } });
  assert.match(long.error, /longer than 4,096/);
  assert.equal(channel.current(), sent.text);
});

test("a new frame's first state never repeats the state a widget stored in an earlier session", () => {
  const model = makeModel({ params: { [STATE_PARAM]: "" } });
  const earlier = createStateChannel(model, 0).send({ event: { type: "getRows" }, startRow: 0, endRow: 100 });
  const now = createStateChannel(model).send({ event: { type: "getRows" }, startRow: 0, endRow: 100 });
  assert.notEqual(now.text, earlier.text);
  assert.ok(now.seq > earlier.seq);
});

test("the Copilot's row sample stays under its size", () => {
  const rows = Array.from({ length: 10_000 }, (_, i) => ({ i, text: "x".repeat(100) }));
  const sample = sampleRows(rows);
  assert.ok(sample.length > 0 && sample.length < rows.length);
  assert.ok(JSON.stringify(sample).length <= 128 * 1024);
});

test("calculated columns and cell formulas are evaluated over the row by the plugin", () => {
  const rows = [{ id: "a", quantity: 10, price: 2.5, note: "=[quantity] * 2", label: "=not an expression (" }];
  const defs = withExpressions(
    [
      { field: "id" },
      { field: "quantity" },
      { field: "price" },
      { field: "notional", calculatedExpression: "[quantity] * [price]" },
      { colId: "fees", calculatedExpression: "Math.round([notional] * 0.01 * 100) / 100" },
      { field: "note" },
      { field: "label" },
      { field: "loop", calculatedExpression: "[loop] + 1" },
      { headerName: "Group", children: [{ field: "ratio", calculatedExpression: "[price] / 0" }] },
    ],
    rows,
    { cellExpressions: true },
  );
  const byId = Object.fromEntries(defs.flatMap((d) => d.children ?? [d]).map((d) => [d.colId ?? d.field, d]));
  const value = (id) => byId[id].valueGetter({ data: rows[0] });
  assert.equal(value("notional"), 25);
  assert.equal(value("fees"), 0.25);
  assert.equal(value("note"), 20);
  assert.equal(value("label"), EXPRESSION_ERROR);
  assert.equal(value("loop"), EXPRESSION_ERROR);
  assert.equal(value("ratio"), EXPRESSION_ERROR);
  assert.equal(byId.notional.type, "numericColumn");
  assert.equal(byId.notional.filter, "agNumberColumnFilter");
  assert.equal(byId.notional.editable, false);
  assert.equal(byId.notional.calculatedExpression, undefined);
  assert.equal(value("quantity"), 10);
  assert.equal(withExpressions([{ field: "note" }], rows)[0].valueGetter, undefined);
});
