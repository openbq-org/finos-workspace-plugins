import assert from "node:assert/strict";
import { test } from "node:test";

import { experimental, liveApi, makeModel, mount, notifications, settle } from "./dom.mjs";
import { STATE_PARAM } from "../src/grid.js";
import plugin, { cellChanges, chartFilename, chartToDownload, dataUrlBytes, normalizeData, PAGINATE_ABOVE } from "../src/table.js";

const columnDefs = [
  { field: "id", headerName: "ID" },
  { field: "name", headerName: "Name" },
  { field: "sales", headerName: "Sales", type: "numericColumn" },
];
const rows = [
  { id: 1, name: "Alice", sales: 1234567.5 },
  { id: 2, name: "Bob", sales: 250 },
  { id: 3, name: "Carol", sales: 175 },
];

async function render(values) {
  const model = makeModel(values);
  const { el, abort } = mount();
  const exposed = plugin.initialize({ model });
  await plugin.render({ model, el, signal: abort.signal, experimental });
  await settle();
  return { model, el, abort, exposed };
}

test("normalizeData takes rows, a grid object, a table configuration and a transaction", () => {
  const grid = normalizeData({ columnDefs, rowData: rows, gridOptions: { pagination: true } });
  assert.equal(grid.rowData.length, 3);
  assert.equal(grid.columnDefs[2].type, "numericColumn");
  assert.equal(grid.gridOptions.pagination, true);
  const configured = normalizeData([{ name: "Ethereum", tvl: 45e9 }], { showAll: false, columnsDefs: [{ field: "tvl", formatterFn: "int" }] });
  assert.deepEqual(configured.columnDefs.map((c) => c.field), ["tvl"]);
  assert.equal(configured.columnDefs[0].valueFormatter({ value: 45e9, context: { locale: "en-US" } }), "45,000,000,000");
  const transposed = normalizeData([{ name: "A", x: 1 }, { name: "B", x: 2 }], { transpose: true });
  assert.equal(transposed.transposed, true);
  assert.deepEqual(transposed.columnDefs.map((c) => c.headerName), ["Name", "A", "B"]);
  assert.deepEqual(normalizeData({ transaction: { update: [{ id: 1 }] } }).transaction, { update: [{ id: 1 }] });
  assert.deepEqual(normalizeData(undefined).rowData, []);
});

test("cellChanges finds up and down moves by row id", () => {
  const changes = cellChanges([{ id: "a", p: 10 }, { id: "b", p: 5 }], [{ id: "a", p: 11 }, { id: "b", p: 4 }], [{ field: "p", compareField: "p" }]);
  assert.equal(changes.get("a|p"), "up");
  assert.equal(changes.get("b|p"), "down");
});

test("the table renders with row groups, pivot and the side bar, exports raw values and tells the Copilot", async () => {
  const { model, el, abort, exposed } = await render({ data: { columnDefs, rowData: rows } });
  assert.ok(el.querySelector(".ag-root-wrapper"));
  assert.ok(el.querySelector(".ag-side-bar"));
  assert.ok([...el.querySelectorAll(".ag-column-drop")].some((zone) => zone.closest(".ag-hidden") === null), "the row group drop zone shows");

  const csv = exposed.exportData("csv");
  assert.match(csv, /"1234567\.5"/);
  assert.doesNotMatch(csv, /1,234,567/);
  assert.equal(exposed.exportData("pdf"), null);

  const ctx = exposed.copilotContext();
  assert.equal(ctx.rowCount, 3);
  assert.deepEqual(ctx.columns, ["id", "name", "sales"]);
  assert.equal(ctx.rows.length, 3);
  assert.deepEqual(ctx.grouping, { rowGroups: [], pivots: [], values: [], pivotMode: false });
  assert.equal(model.get("state").rowCount, 3);
  abort.abort();
  assert.equal(model.listenerCount("change:data"), 0);
});

test("data that arrives after the first render keeps row ids, pages above 100 rows and flashes changes", async () => {
  const definition = { wsRowIdColumn: "symbol", columnsDefs: [{ field: "symbol" }, { field: "price", renderFn: "showCellChange" }] };
  const { model, el, abort, exposed } = await render({ data: undefined, definition });
  assert.equal(exposed.copilotContext().rowCount, 0);

  const many = Array.from({ length: PAGINATE_ABOVE + 20 }, (_, i) => ({ symbol: `S${i}`, price: i }));
  model.push("data", many);
  await settle();
  assert.equal(exposed.copilotContext().rowCount, many.length);
  assert.ok(el.querySelector(".ag-paging-panel:not(.ag-hidden)"), "the pager shows");
  assert.ok(el.querySelector('.ag-row[row-id="S0"]'));

  model.push("data", many.map((r) => (r.symbol === "S1" ? { ...r, price: 0 } : r)));
  await settle(50);
  assert.ok(el.querySelector('.ag-row[row-id="S1"] .ag-cell[col-id="price"]').classList.contains("ag-table-chart-cell-down"));
  abort.abort();
});

test("grid events write the grid state to the declared body param, and a transaction answer changes rows", async () => {
  const textColumns = columnDefs.map((def) => (def.field === "name" ? { ...def, filter: "agTextColumnFilter" } : def));
  const { model, abort, exposed } = await render({ data: { columnDefs: textColumns, rowData: rows }, params: { [STATE_PARAM]: "" }, definition: { gridEvents: ["filterChanged", "cellClicked"] } });
  const before = model.writes.filter(([key]) => key === "params").length;
  const filterInput = { name: { filterType: "text", type: "contains", filter: "o" } };
  const gridApi = await liveApi();
  gridApi.setFilterModel(filterInput);
  await settle(50);
  const writes = model.writes.filter(([key]) => key === "params");
  assert.equal(writes.length, before + 1);
  const state = JSON.parse(writes.at(-1)[1][STATE_PARAM]);
  assert.equal(state.event.type, "filterChanged");
  assert.deepEqual(state.filterModel, filterInput);
  assert.equal(typeof state.seq, "number");

  model.push("data", { transaction: { update: [{ id: 2, name: "Bob", sales: 999 }], add: [{ id: 4, name: "Dee", sales: 1 }] } });
  await settle();
  gridApi.setFilterModel(null);
  await settle(50);
  assert.equal(exposed.copilotContext().stats.sales.max, 1234567.5);
  assert.equal(exposed.copilotContext().rowCount, 4);
  abort.abort();
});

test("a chart view opened before its data arrives draws the chart once the rows come", async () => {
  const definition = {
    enableCharts: true,
    showAll: false,
    chartView: { enabled: true, chartType: "column" },
    columnsDefs: [{ field: "name", chartDataType: "category" }, { field: "tvl", chartDataType: "series" }],
  };
  const { model, el, abort } = await render({ data: undefined, definition });
  try {
    const chartEl = el.querySelector(".ag-table-chart-chart");
    assert.deepEqual([...el.querySelectorAll(".ag-table-chart-toolbar-button")].map((b) => b.getAttribute("aria-pressed")), ["false", "true"]);
    assert.equal(chartEl.children.length, 0);
    model.push("data", [{ name: "Ethereum", tvl: 45e9 }, { name: "Bitcoin", tvl: 35e9 }]);
    await settle(150);
    assert.ok(chartEl.children.length > 0, "the chart is drawn");
    assert.equal(model.get("state").chartView.open, true);
  } finally {
    abort.abort();
    await settle(100);
  }
});

test("the download button saves the chart that shows, else the chart opened last", () => {
  assert.equal(chartToDownload(["view", "popup"], { chartId: "view", isOpen: true }), "view");
  assert.equal(chartToDownload(["view", "popup"], { chartId: "view", isOpen: false }), "popup");
  assert.equal(chartToDownload(["view"], { chartId: "view", isOpen: false }), "view");
  assert.equal(chartToDownload(["a", "b"], null), "b");
  assert.equal(chartToDownload([], { chartId: "gone", isOpen: true }), null);
  assert.deepEqual([...dataUrlBytes("data:image/png;base64,AAEC")], [0, 1, 2]);
  assert.equal(dataUrlBytes("data:image/png,raw"), null);
  assert.equal(chartFilename("", new Date("2026-11-05T10:00:00Z")), "chart 2026-11-05.png");
});

test("the download button saves the chart view as a PNG, and asks for a chart when there is none", async () => {
  const definition = {
    enableCharts: true,
    showAll: false,
    chartView: { enabled: true, chartType: "column" },
    columnsDefs: [{ field: "name", chartDataType: "category" }, { field: "tvl", chartDataType: "series" }],
  };
  const { model, el, abort } = await render({ data: [{ name: "Ethereum", tvl: 45e9 }, { name: "Bitcoin", tvl: 35e9 }], definition });
  const saved = [];
  const invoke = experimental.invoke;
  experimental.invoke = async (name, message, options) => {
    if (name === "core:download:save") saved.push([message, options]);
    return invoke(name, message);
  };
  try {
    await settle(150);
    const api = await liveApi(el);
    assert.equal(api.getGridOption("allowContextMenuWithControlKey"), true, "Control-click opens the menu on a Mac");
    const [chartId] = api.getChartModels().map((m) => m.chartId);
    assert.ok(chartId, "the chart view is drawn");
    api.getChartImageDataURL = (params) => (params.chartId === chartId && params.fileFormat === "image/png" ? "data:image/png;base64,iVBORw0K" : undefined);
    model.emit("msg:custom", { kind: "workspace-event", name: "action", id: "download-chart" });
    await settle();
    assert.equal(saved.length, 1);
    assert.equal(saved[0][0].mime, "image/png");
    assert.match(saved[0][0].filename, /^chart \d{4}-\d{2}-\d{2}\.png$/);
    assert.deepEqual([...saved[0][1].buffers[0].slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);

    api.getChartModels = () => [];
    notifications.length = 0;
    model.emit("msg:custom", { kind: "workspace-event", name: "action", id: "download-chart" });
    await settle();
    assert.equal(saved.length, 1);
    assert.deepEqual(notifications.at(-1), ["core:ui:notify", { level: "info", text: "Open the chart first, then download it." }]);
  } finally {
    experimental.invoke = invoke;
    abort.abort();
    await settle(100);
  }
  assert.equal(model.listenerCount("msg:custom"), 0);
});

test("a backend's calculated column and cell formulas show in the grid, and sort and export as values", async () => {
  const data = {
    columnDefs: [{ field: "id" }, { field: "quantity" }, { field: "price" }, { field: "notional", calculatedExpression: "[quantity] * [price]" }, { field: "check" }],
    rowData: [{ id: "a", quantity: 10, price: 2, check: "=[quantity] > 5" }, { id: "b", quantity: 1, price: 50, check: "=[quantity] > 5" }],
    gridOptions: { enableCellExpressions: true },
  };
  const { el, abort, exposed } = await render({ data });
  try {
    const api = await liveApi(el);
    assert.equal(api.getGridOption("enableCellExpressions"), false);
    assert.equal(api.getCellValue({ rowNode: api.getRowNode("a"), colKey: "notional" }), 20);
    assert.equal(api.getCellValue({ rowNode: api.getRowNode("b"), colKey: "check" }), false);
    api.applyColumnState({ state: [{ colId: "notional", sort: "desc" }] });
    assert.equal(api.getDisplayedRowAtIndex(0).id, "b");
    assert.match(exposed.exportData("csv"), /"b","1","50","50","false"/);
  } finally {
    abort.abort();
  }
});

test("the grid's filter, sort, row groups and the chart survive a reload, even when the data comes late", async () => {
  const definition = {
    enableCharts: true,
    chartView: { enabled: true, chartType: "column" },
    columnsDefs: [{ field: "name", chartDataType: "category" }, { field: "desk" }, { field: "tvl", chartDataType: "series" }],
  };
  const data = [{ name: "Ethereum", desk: "A", tvl: 45e9 }, { name: "Bitcoin", desk: "B", tvl: 35e9 }, { name: "Solana", desk: "A", tvl: 8e9 }];
  const first = await render({ data, definition });
  let saved;
  try {
    const api = await liveApi(first.el);
    api.setFilterModel({ tvl: { filterType: "number", type: "greaterThan", filter: 1e9 } });
    api.applyColumnState({ state: [{ colId: "tvl", sort: "desc" }, { colId: "desk", rowGroup: true }] });
    await settle(500);
    saved = first.model.get("state");
    assert.ok(saved.grid?.filter?.filterModel?.tvl, "the filter is saved");
    assert.deepEqual(saved.grid.rowGroup?.groupColIds, ["desk"]);
    assert.ok(saved.chartView?.open === true && saved.chartView.model, "the chart is saved");
  } finally {
    first.abort.abort();
    await settle(100);
  }

  const again = await render({ data: undefined, definition, state: saved });
  try {
    await settle(400);
    assert.ok(again.model.get("state").chartView.model, "the saved chart is kept while the rows are missing");
    again.model.push("data", data);
    await settle(400);
    const api = await liveApi(again.el);
    assert.deepEqual(Object.keys(api.getFilterModel()), ["tvl"]);
    assert.deepEqual(api.getColumnState().filter((c) => c.rowGroup).map((c) => c.colId), ["desk"]);
    assert.equal(api.getColumnState().find((c) => c.colId === "tvl").sort, "desc");
    assert.ok(again.el.querySelector(".ag-table-chart-chart").children.length > 0, "the chart is drawn again");
    assert.ok(again.model.get("state").chartView.model, "the chart model is still saved");
  } finally {
    again.abort.abort();
    await settle(100);
  }
});

test("the theme follows the site's mode and colours, and the card's base theme", async () => {
  const { model, abort } = await render({ data: rows, theme: { mode: "light", tokens: { card: "#fafafa" } } });
  assert.equal(document.body.dataset.mode, "light");
  assert.equal(document.body.style.getPropertyValue("--ws-background"), "#fafafa");
  model.push("theme", { mode: "dark", tokens: { card: "#0a0a0a" } });
  assert.equal(document.body.dataset.mode, "dark");
  assert.equal(document.body.style.getPropertyValue("--ws-background"), "#0a0a0a");
  model.push("config", { theme: "alpine" });
  abort.abort();
});

test("the card's actions show floating filters, clear the filters and sort, and autosize the columns", async () => {
  const { model, el, abort } = await render({ data: { columnDefs, rowData: rows } });
  try {
    const api = await liveApi(el);
    assert.equal(el.querySelector(".ag-floating-filter"), null);

    model.push("config", { floatingFilters: true });
    await settle();
    assert.ok(el.querySelector(".ag-floating-filter"));

    api.setFilterModel({ name: { filterType: "set", values: ["Bob", "Carol"] } });
    api.applyColumnState({ state: [{ colId: "sales", sort: "desc" }] });
    await settle();
    assert.equal(api.getDisplayedRowCount(), 2);
    model.emit("msg:custom", { kind: "workspace-event", name: "action", id: "clear-filters" });
    await settle();
    assert.deepEqual(api.getFilterModel(), {});
    assert.ok(api.getColumnState().every((column) => !column.sort));
    assert.equal(api.getDisplayedRowCount(), 3);

    model.emit("msg:custom", { kind: "workspace-event", name: "action", id: "autosize" });
    await settle();

    model.push("config", { floatingFilters: false });
    await settle();
    assert.equal(el.querySelector(".ag-floating-filter"), null);
  } finally {
    abort.abort();
  }
  assert.equal(model.listenerCount("msg:custom"), 0);
  assert.equal(model.listenerCount("change:config"), 0);
});

test("the Filters tool panel is AG Grid 34's, and the Advanced Filter replaces it and the column filters while it is on", async () => {
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  const { model, el, abort } = await render({ data: { columnDefs, rowData: rows } });
  try {
    const api = await liveApi(el);
    assert.deepEqual(api.getGridOption("sideBar").toolPanels, ["columns", "filters-new"]);
    assert.equal(api.getGridOption("enableFilterHandlers"), true);
    assert.notEqual(api.getGridOption("enableAdvancedFilter"), true);
    api.openToolPanel("filters-new");
    await settle();
    assert.equal(api.getOpenedToolPanel(), "filters-new");

    model.push("config", { advancedFilter: true });
    await settle();
    assert.equal(api.getGridOption("enableAdvancedFilter"), true);
    assert.deepEqual(api.getGridOption("sideBar").toolPanels, ["columns"]);
    assert.ok(el.querySelector(".ag-advanced-filter"), "the expression bar shows above the grid");
    const advanced = { filterType: "join", type: "OR", conditions: [
      { filterType: "text", colId: "name", type: "equals", filter: "Bob" },
      { filterType: "number", colId: "sales", type: "greaterThan", filter: 1000 },
    ] };
    api.setAdvancedFilterModel(advanced);
    await settle();
    assert.deepEqual(api.getRenderedNodes().map((n) => n.id).sort(), ["1", "2"]);
    assert.deepEqual(model.get("state").filterModel, advanced);
    await settle(400);
    assert.deepEqual(model.get("state").grid?.filter?.advancedFilterModel, advanced, "the filter is saved with the card");

    model.push("config", { advancedFilter: false });
    await settle();
    assert.equal(api.getGridOption("enableAdvancedFilter"), false);
    assert.deepEqual(api.getGridOption("sideBar").toolPanels, ["columns", "filters-new"]);
    assert.equal(api.getDisplayedRowCount(), 3);
    assert.equal(el.querySelector(".ag-advanced-filter"), null);
  } finally {
    console.warn = warn;
    abort.abort();
  }
  assert.deepEqual(warnings.filter((w) => /AG Grid/.test(w)), []);
});

test("a card saved with the Advanced Filter on opens with it, its filter applied", async () => {
  const advanced = { filterType: "text", colId: "name", type: "startsWith", filter: "c" };
  const { el, abort } = await render({ data: { columnDefs, rowData: rows }, config: { advancedFilter: true }, state: { grid: { filter: { advancedFilterModel: advanced } } } });
  try {
    const api = await liveApi(el);
    assert.equal(api.getGridOption("enableAdvancedFilter"), true);
    assert.deepEqual(api.getGridOption("sideBar").toolPanels, ["columns"]);
    assert.deepEqual(api.getAdvancedFilterModel(), advanced);
    assert.equal(api.getDisplayedRowCount(), 1);
  } finally {
    abort.abort();
  }
});

test("a card that never toggled floating filters keeps the backend's choice", async () => {
  const { el, abort } = await render({ data: { columnDefs, rowData: rows, gridOptions: { defaultColDef: { floatingFilter: true } } } });
  try {
    assert.ok(el.querySelector(".ag-floating-filter"));
  } finally {
    abort.abort();
  }
});
