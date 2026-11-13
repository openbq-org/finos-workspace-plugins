import assert from "node:assert/strict";
import { test } from "node:test";

import { experimental, liveApi, makeModel, mount, notifications, settle } from "./dom.mjs";
import { axisNumber, CHART_CELL_LIMIT, CHART_TYPES, chartMenuItem, chartOverrides, mergeOverrides, periodLabel, typeForRows } from "../src/ag-table-chart/chartView.js";
import { numberLike, transpose } from "../src/ag-table-chart/columns.js";
import { contextMenuItems } from "../src/grid.js";
import plugin, { normalizeData } from "../src/table.js";

test("every chart type of AG Grid 34, including stacked lines and funnels", () => {
  for (const type of ["stackedLine", "normalizedLine", "funnel", "coneFunnel", "pyramid"]) assert.ok(CHART_TYPES.includes(type), type);
});

test("the chart's look: axis titles, short numbers, zoom, period labels and one colour per bar", () => {
  const o = chartOverrides({ xLabel: "Quarter", yLabel: "Revenue (USD)", dateLabels: "quarter" }, "groupedColumn");
  assert.deepEqual(o.common.axes.category.title, { enabled: true, text: "Quarter" });
  assert.deepEqual(o.common.axes.number.title, { enabled: true, text: "Revenue (USD)" });
  assert.equal(o.common.axes.number.label.formatter({ value: 45e9 }), "45B");
  assert.equal(o.common.axes.category.label.formatter({ value: "2024-08-15" }), "Q3 2024");
  assert.equal(o.common.axes.category.label.formatter({ value: "Apple" }), "Apple");
  assert.deepEqual(o.common.zoom, { enabled: true });
  assert.equal(o.common.background.fill, "transparent");
  assert.equal(chartOverrides({}, "pie").common.axes, undefined, "a pie has no axes");

  const nav = chartOverrides({ chartNavigatorEnabled: false }, "line", { navigator: true, miniChart: true });
  assert.deepEqual(nav.common.navigator, { enabled: true, miniChart: { enabled: true } }, "the card's setting wins");
  assert.equal(chartOverrides({ chartNavigatorEnabled: true }, "line", { navigator: false }).common.navigator, undefined);

  const bars = chartOverrides({}, "groupedColumn", { distinctColors: true });
  const fill = (name) => bars.bar.series.itemStyler({ datum: { name }, xKey: "name" }).fill;
  assert.notEqual(fill("A"), fill("B"));
  assert.equal(fill("A"), fill("A"));
  assert.equal(chartOverrides({}, "line", { distinctColors: true }).bar, undefined);
});

test("short axis numbers, fiscal periods, single-row lines and merged overrides", () => {
  assert.deepEqual([axisNumber(1500), axisNumber(2.5e6), axisNumber(-3.2e9), axisNumber(4e12), axisNumber(12.345)], ["1.5K", "2.5M", "-3.2B", "4T", "12.35"]);
  assert.equal(periodLabel("2024-02-01", "quarter"), "Q1 2024");
  assert.equal(periodLabel(new Date(Date.UTC(2023, 11, 31)), "year"), "FY 2023");
  assert.equal(periodLabel("2024-02-01", "date"), null);
  assert.equal(typeForRows("line", 1), "groupedColumn");
  assert.equal(typeForRows("line", 5), "line");
  assert.equal(typeForRows("pie", 1), "pie");
  assert.deepEqual(mergeOverrides({ common: { a: 1, b: { c: 2 } } }, { common: { b: { d: 3 } } }), { common: { a: 1, b: { c: 2, d: 3 } } });
});

test("money and percent texts in a series column chart as numbers and show as written", () => {
  assert.equal(numberLike("$1,234.50"), 1234.5);
  assert.equal(numberLike("(2.5M)"), -2.5e6);
  assert.equal(numberLike("n/a"), null);
  const { columnDefs } = normalizeData([{ name: "A", sales: "$1.5M" }, { name: "B", sales: "$900K" }], { columnsDefs: [{ field: "name" }, { field: "sales", chartDataType: "series" }] });
  const sales = columnDefs[1];
  assert.equal(sales.valueGetter({ data: { sales: "$1.5M" } }), 1.5e6);
  assert.equal(sales.valueFormatter({ data: { sales: "$1.5M" }, context: {} }), "$1.5M");
  assert.equal(sales.filter, "agNumberColumnFilter");
});

test("a transposed row of numbers charts as a series, and an answer may carry its chartView", () => {
  const { columnDefs } = transpose([{ name: "Q1", a: 1, b: 2 }, { name: "Notes", a: "x", b: "y" }], [{ field: "name" }, { field: "a" }, { field: "b" }]);
  assert.deepEqual(columnDefs.map((c) => c.chartDataType ?? null), ["category", "series", null]);
  assert.deepEqual(normalizeData({ columnDefs: [{ field: "x" }], rowData: [{ x: 1 }], chartView: { enabled: true, chartType: "line" } }).table.chartView, { enabled: true, chartType: "line" });
});

function fakeApi(ranges, numericIds) {
  const column = (id) => ({ getColId: () => id, getColDef: () => (numericIds.includes(id) ? { type: "numericColumn" } : {}) });
  return {
    getCellRanges: () => ranges.map((r) => ({ startRow: { rowIndex: r.from }, endRow: { rowIndex: r.to }, columns: r.columns.map(column) })),
    created: [],
    createRangeChart(params) { this.created.push(params); },
  };
}

test("the context menu's Chart item: common types, enough number columns, and a cell limit", () => {
  const api = fakeApi([{ from: 0, to: 9, columns: ["name", "sales"] }], ["sales"]);
  const item = chartMenuItem(api);
  assert.equal(item.name, "Chart");
  assert.equal(item.disabled, false);
  const scatter = item.subMenu.find((i) => i.name === "Scatter").subMenu.find((i) => i.name === "Scatter");
  assert.equal(scatter.disabled, true, "scatter needs two number columns");
  const grouped = item.subMenu.find((i) => i.name === "Column").subMenu[0];
  grouped.action();
  assert.equal(api.created[0].chartType, "groupedColumn");
  assert.deepEqual(api.created[0].cellRange, { rowStartIndex: 0, rowEndIndex: 9, columns: ["name", "sales"] });
  assert.ok(api.created[0].chartThemeOverrides.common.axes, "the chart gets the plugin's look");

  const huge = chartMenuItem(fakeApi([{ from: 0, to: CHART_CELL_LIMIT, columns: ["a", "b"] }], ["a", "b"]));
  assert.equal(huge.disabled, true);
  assert.match(huge.tooltip, /200,000/);

  const items = contextMenuItems({ api, defaultItems: ["copy", "chartRange", "export"] });
  assert.deepEqual(items.map((i) => i.name ?? i), ["copy", "Chart", "export"]);
});

async function render(values) {
  const model = makeModel(values);
  const { el, abort } = mount();
  const exposed = plugin.initialize({ model });
  await plugin.render({ model, el, signal: abort.signal, experimental });
  await settle();
  return { model, el, abort, exposed };
}

test("the Chart button is off when no column can be charted", async () => {
  const { el, abort } = await render({ data: [{ name: "a", note: "x" }], definition: { enableCharts: true, chartView: { enabled: false } } });
  try {
    const button = el.querySelector(".ag-table-chart-toolbar-button:last-child");
    assert.equal(button.textContent, "Chart");
    assert.equal(button.disabled, true);
    assert.match(button.title, /No series data/);
  } finally {
    abort.abort();
    await settle(100);
  }
});

test("the chart view adds its chart as a dashboard widget, and draws a pivot chart in pivot mode", async () => {
  const data = [{ name: "A", desk: "X", tvl: 5 }, { name: "B", desk: "Y", tvl: 50 }, { name: "C", desk: "X", tvl: 500 }];
  const definition = { chartView: { enabled: true, chartType: "line", xLabel: "Asset" }, columnsDefs: [{ field: "name", chartDataType: "category" }, { field: "desk" }, { field: "tvl", chartDataType: "series" }] };
  const { model, el, abort } = await render({ data, definition });
  try {
    const api = await liveApi(el);
    await settle(200);
    const [chart] = api.getChartModels();
    assert.equal(chart.chartType, "line");
    notifications.length = 0;
    model.emit("msg:custom", { kind: "workspace-event", name: "action", id: "add-chart-widget" });
    await settle(200);
    const added = notifications.find(([name]) => name === "core:dashboard:add-widget");
    assert.ok(added, "the host is asked to add a widget");
    assert.equal(added[1].widget, "table");
    assert.deepEqual(added[1].data.chartView, { enabled: true, chartType: "line" });
    assert.deepEqual(added[1].data.columnDefs.map((c) => [c.field, c.chartDataType]), [["name", "category"], ["tvl", "series"]]);
    assert.deepEqual(added[1].data.rowData, [{ name: "A", tvl: 5 }, { name: "B", tvl: 50 }, { name: "C", tvl: 500 }]);

    model.push("config", { chartDistinctColors: true, chartNavigator: true });
    await settle(300);
    assert.equal(api.getChartModels().length, 1, "the chart is drawn again with the card's settings");
  } finally {
    abort.abort();
    await settle(100);
  }

  const pivot = await render({ data, definition: { chartView: { enabled: false, chartType: "groupedColumn" }, columnsDefs: [{ field: "name" }, { field: "desk", rowGroup: true }, { field: "tvl", aggFunc: "sum" }] } });
  try {
    const api = await liveApi(pivot.el);
    api.setGridOption("pivotMode", true);
    await settle(100);
    pivot.el.querySelector(".ag-table-chart-toolbar-button:last-child").click();
    await settle(300);
    assert.equal(api.getChartModels()[0]?.modelType, "pivot");
  } finally {
    pivot.abort.abort();
    await settle(100);
  }
});
