/*
 * OpenBQ's ChartView: the table shown as an AG Grid integrated chart, linked to the rows, which
 * the toolbar switches to and from. `chartView`: { enabled, chartType, cellRangeCols,
 * ignoreCellRange, chartNavigatorEnabled, chartMiniChartEnabled, xLabel, yLabel, dateLabels }.
 * The chart the user arranges is saved to the widget's state and restored, unless
 * `ignoreCellRange`. In pivot mode the view is a pivot chart.
 */

export const CHART_TYPES = [
  "column", "groupedColumn", "stackedColumn", "normalizedColumn",
  "bar", "groupedBar", "stackedBar", "normalizedBar",
  "line", "stackedLine", "normalizedLine", "scatter", "bubble",
  "pie", "donut", "doughnut",
  "area", "stackedArea", "normalizedArea",
  "histogram", "radarLine", "radarArea", "nightingale", "radialColumn", "radialBar",
  "sunburst", "rangeBar", "rangeArea", "boxPlot", "treemap", "heatmap", "waterfall",
  "columnLineCombo", "areaColumnCombo", "customCombo",
  "funnel", "coneFunnel", "pyramid",
];

const CARTESIAN = new Set([
  "column", "groupedColumn", "stackedColumn", "normalizedColumn", "bar", "groupedBar", "stackedBar",
  "normalizedBar", "line", "stackedLine", "normalizedLine", "scatter", "bubble", "area", "stackedArea", "normalizedArea", "histogram",
  "rangeBar", "rangeArea", "boxPlot", "waterfall", "columnLineCombo", "areaColumnCombo", "customCombo",
]);

/** AG Grid has no plain `column`: OpenBQ's `column` is its grouped column. */
export function agChartType(chartType) {
  if (chartType === "column") return "groupedColumn";
  if (chartType === "bar") return "groupedBar";
  return CHART_TYPES.includes(chartType) ? chartType : "groupedColumn";
}

const MAX_SAVED_MODEL = 32 * 1024;

export function chartThemeName(mode) {
  return mode === "light" ? "ag-default" : "ag-default-dark";
}

export function navigatorOverrides(chartView, chartType, settings = {}) {
  if (!CARTESIAN.has(chartType)) return undefined;
  const navigator = typeof settings.navigator === "boolean" ? settings.navigator : chartView?.chartNavigatorEnabled === true;
  const mini = typeof settings.miniChart === "boolean" ? settings.miniChart : chartView?.chartMiniChartEnabled === true;
  if (!navigator && !mini) return undefined;
  return { common: { navigator: { enabled: true, ...(mini ? { miniChart: { enabled: true } } : {}) } } };
}

/** A charted selection of more cells than this is refused: the chart would be slow and unreadable. */
export const CHART_CELL_LIMIT = 200_000;
const LINES = new Set(["line", "stackedLine", "normalizedLine", "area", "stackedArea", "normalizedArea"]);
const BARS = new Set(["groupedColumn", "stackedColumn", "normalizedColumn", "groupedBar", "stackedBar", "normalizedBar"]);

/** Ten colours that read on light and dark backgrounds, for one bar per category. */
export const DISTINCT_COLORS = ["#2563eb", "#16a34a", "#ea580c", "#9333ea", "#0891b2", "#dc2626", "#ca8a04", "#db2777", "#4b5563", "#65a30d"];

/** An axis number in short form: 1.5K, 45M, 2.1B, 3T; small numbers as they are. */
export function axisNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return String(value ?? "");
  const size = Math.abs(value);
  for (const [at, unit] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]]) {
    if (size >= at) return `${Number((value / at).toFixed(1))}${unit}`;
  }
  return String(Number(value.toFixed(2)));
}

/** A date as a fiscal period: `quarter` gives Q3 2024, `year` gives FY 2024; anything else as it is. */
export function periodLabel(value, dateLabels) {
  if (dateLabels !== "quarter" && dateLabels !== "year") return null;
  const date = value instanceof Date ? value : typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? new Date(`${value.slice(0, 10)}T00:00:00Z`) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  return dateLabels === "year" ? `FY ${year}` : `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${year}`;
}

/** An integrated chart wraps a category as { id, value, toString }: its value. */
export function categoryValue(value) {
  return value && typeof value === "object" && !(value instanceof Date) && "value" in value ? value.value : value;
}

function categoryText(value, dateLabels) {
  const plain = categoryValue(value);
  return periodLabel(plain, dateLabels) ?? (plain instanceof Date ? plain.toISOString().slice(0, 10) : String(plain ?? ""));
}

function categoryFormatter(dateLabels) {
  return ({ value }) => categoryText(value, dateLabels);
}

const fullNumbers = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/**
 * A series tooltip: the category as its heading (a fiscal period when `dateLabels` says so) and
 * the value in full, with thousands separators, under the series' name.
 */
export function tooltipRenderer(dateLabels) {
  return (params) => {
    const datum = params.datum ?? {};
    const xKey = params.xKey ?? params.calloutLabelKey ?? params.sectorLabelKey;
    const yKey = params.yKey ?? params.angleKey ?? params.sizeKey;
    const value = categoryValue(datum[yKey]);
    const name = params.yName ?? params.angleName ?? params.title ?? String(yKey ?? "");
    return {
      ...(xKey ? { heading: categoryText(datum[xKey], dateLabels) } : {}),
      title: name,
      data: [{ label: name, value: typeof value === "number" && Number.isFinite(value) ? fullNumbers.format(value) : String(value ?? "") }],
    };
  };
}

const TOOLTIP_SERIES = ["bar", "line", "area", "scatter", "bubble", "histogram", "pie", "donut"];

/**
 * The chart's look: a transparent background; the navigator and its mini chart; axis titles from
 * `xLabel` (the category or time axis) and `yLabel` (the number axis); short numbers on number
 * axes; zoom on cartesian charts; fiscal period labels for dates; and, for one series of bars,
 * one colour per category. `settings` are the card's: { navigator, miniChart, distinctColors }.
 */
export function chartOverrides(chartView = {}, chartType, settings = {}) {
  const common = { background: { fill: "transparent" }, ...(navigatorOverrides(chartView, chartType, settings)?.common ?? {}) };
  if (CARTESIAN.has(chartType)) {
    const title = (text) => (typeof text === "string" && text.trim() ? { title: { enabled: true, text: text.trim() } } : {});
    const category = { ...title(chartView.xLabel), label: { formatter: categoryFormatter(chartView.dateLabels) } };
    common.axes = {
      number: { ...title(chartView.yLabel), label: { formatter: ({ value }) => axisNumber(value) } },
      category,
      time: { ...title(chartView.xLabel), ...(chartView.dateLabels ? { label: { formatter: categoryFormatter(chartView.dateLabels) } } : {}) },
    };
    common.zoom = { enabled: true };
  }
  const overrides = { common };
  const renderer = tooltipRenderer(chartView.dateLabels);
  for (const series of TOOLTIP_SERIES) overrides[series] = { series: { tooltip: { renderer } } };
  if (settings.distinctColors === true && BARS.has(chartType)) {
    const order = new Map();
    overrides.bar = {
      series: {
        ...overrides.bar.series,
        itemStyler: ({ datum, xKey }) => {
          const key = String(categoryValue(datum?.[xKey]) ?? "");
          if (!order.has(key)) order.set(key, order.size);
          const color = DISTINCT_COLORS[order.get(key) % DISTINCT_COLORS.length];
          return { fill: color, stroke: color };
        },
      },
    };
  }
  return overrides;
}

function isPlain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** `extra` merged into `base`, recursively for plain objects; `extra` wins. */
export function mergeOverrides(base, extra) {
  if (!isPlain(base)) return extra;
  const out = { ...base };
  for (const [key, value] of Object.entries(extra ?? {})) out[key] = isPlain(value) && isPlain(base[key]) ? mergeOverrides(base[key], value) : value;
  return out;
}

/** A line or area of one point says nothing: a single row is drawn as columns. */
export function typeForRows(chartType, rows) {
  return rows === 1 && LINES.has(chartType) ? "groupedColumn" : chartType;
}

/** True when the grid has a column to chart: at least one series besides the category. */
export function canChart(api, chartView = {}) {
  const columns = chartColumns(columnsOf(api), chartView, chartView.chartType);
  return columns.length >= 2;
}

/** The problem with `cellRangeCols` for a chart type, or null: a list that names no column of the grid. */
export function cellRangeProblem(api, chartView = {}, chartType = chartView.chartType) {
  const configured = chartView?.cellRangeCols?.[chartType] ?? chartView?.cellRangeCols?.[agChartType(chartType)];
  if (!Array.isArray(configured) || !configured.length) return null;
  const ids = columnsOf(api).map((c) => c.id);
  return configured.some((id) => ids.includes(id)) ? null : `cellRangeCols for ${chartType} names no column of this table (${configured.join(", ")}); the chart uses the default columns.`;
}

/** The cells of the selected ranges. */
export function selectedCellCount(api) {
  return (api.getCellRanges?.() ?? []).reduce((total, range) => {
    const rows = Math.abs((range.endRow?.rowIndex ?? 0) - (range.startRow?.rowIndex ?? 0)) + 1;
    return total + rows * range.columns.length;
  }, 0);
}

const CHART_MENU = [
  ["Column", [["Grouped", "groupedColumn"], ["Stacked", "stackedColumn"], ["100% stacked", "normalizedColumn"]]],
  ["Bar", [["Grouped", "groupedBar"], ["Stacked", "stackedBar"], ["100% stacked", "normalizedBar"]]],
  ["Line", [["Line", "line"], ["Stacked", "stackedLine"]]],
  ["Area", [["Area", "area"], ["Stacked", "stackedArea"]]],
  ["Pie", [["Pie", "pie"], ["Donut", "donut"]]],
  ["Scatter", [["Scatter", "scatter"], ["Bubble", "bubble"]]],
  ["Histogram", "histogram"],
  ["Column and line", "columnLineCombo"],
];
const MIN_SERIES = { scatter: 2, bubble: 3 };

/**
 * The context menu's Chart item: the common chart types for the selected cells, each greyed out
 * when the selection has too few number columns for it, and the whole item when it is larger than
 * CHART_CELL_LIMIT cells.
 */
export function chartMenuItem(api, overridesFor = (chartType) => chartOverrides({}, chartType)) {
  const ranges = api.getCellRanges?.() ?? [];
  const cells = selectedCellCount(api);
  const numeric = new Set(ranges.flatMap((r) => r.columns).filter((c) => {
    const def = c.getColDef();
    return def.type === "numericColumn" || def.filter === "agNumberColumnFilter" || def.chartDataType === "series";
  }).map((c) => c.getColId()));
  const tooLarge = cells > CHART_CELL_LIMIT;
  const chart = (chartType) => () => {
    for (const range of ranges) {
      api.createRangeChart({
        chartType,
        cellRange: { rowStartIndex: range.startRow?.rowIndex, rowEndIndex: range.endRow?.rowIndex, columns: range.columns.map((c) => c.getColId()) },
        chartThemeOverrides: overridesFor(chartType),
      });
      break;
    }
  };
  const item = (name, chartType) => {
    const needs = MIN_SERIES[chartType] ?? 1;
    const disabled = numeric.size < needs;
    return { name, action: chart(chartType), disabled, ...(disabled ? { tooltip: `${name} needs ${needs} number column${needs > 1 ? "s" : ""} in the selection` } : {}) };
  };
  return {
    name: "Chart",
    disabled: !ranges.length || tooLarge,
    ...(tooLarge ? { tooltip: `Select at most ${CHART_CELL_LIMIT.toLocaleString("en-US")} cells to chart them` } : {}),
    subMenu: CHART_MENU.map(([name, types]) => (Array.isArray(types) ? { name, subMenu: types.map(([label, type]) => item(label, type)) } : item(name, types))),
  };
}

/**
 * The columns a chart starts with: `cellRangeCols[chartType]` when it names existing columns,
 * else the first category or time column followed by every series column.
 */
export function chartColumns(columns, chartView, chartType) {
  const ids = columns.map((c) => c.id);
  const configured = chartView?.cellRangeCols?.[chartType] ?? chartView?.cellRangeCols?.[agChartType(chartType)];
  if (Array.isArray(configured)) {
    const known = configured.filter((id) => ids.includes(id));
    if (known.length) return known;
  }
  const usable = columns.filter((c) => !c.hide && c.chartDataType !== "excluded" && c.id !== "__field");
  const category = usable.find((c) => c.chartDataType === "category" || c.chartDataType === "time") ?? usable.find((c) => !c.numeric);
  const series = usable.filter((c) => c !== category && (c.chartDataType === "series" || (!c.chartDataType && c.numeric)));
  return [category, ...series].filter(Boolean).map((c) => c.id);
}

function columnsOf(api) {
  return (api.getColumns?.() ?? []).map((column) => {
    const def = column.getColDef();
    return {
      id: column.getColId(),
      hide: !column.isVisible(),
      chartDataType: def.chartDataType,
      numeric: def.type === "numericColumn" || def.filter === "agNumberColumnFilter",
    };
  });
}

/**
 * Manages the chart for one grid. `onChange({ open, model })` is called when the view or the
 * chart changes, to save it.
 */
export function createChartView({ api, gridEl, chartEl, chartView = {}, saved, mode, onChange, settings = () => ({}), onProblem = () => {}, rowRange = null }) {
  let ref = null;
  let open = false;
  let drawnColumns = 0;
  let drawnRows = 0;
  let currentMode = mode;
  let type = agChartType(chartView.chartType);
  /** The grid's first chart theme (the organization's when it has one), else AG Charts' default. */
  const themeName = () => {
    const first = api.getGridOption?.("chartThemes")?.[0];
    return typeof first === "string" ? first : chartThemeName(currentMode);
  };

  const save = () => {
    let model = ref ? null : saved?.model ?? null;
    if (ref) {
      try {
        const models = api.getChartModels?.() ?? [];
        model = models.find((m) => m.chartId === ref.chartId) ?? null;
        if (model && JSON.stringify(model).length > MAX_SAVED_MODEL) model = null;
      } catch {
        model = null;
      }
    }
    onChange?.({ open, model });
  };

  const create = (model, restore = chartView.ignoreCellRange !== true) => {
    if (model && restore && columnsOf(api).length && api.getDisplayedRowCount()) {
      try {
        const chartType = model.chartType ?? type;
        ref = api.restoreChart({ ...model, chartThemeName: themeName(), chartOptions: mergeOverrides(model.chartOptions ?? {}, chartOverrides(chartView, chartType, settings())) }, chartEl);
        drawnColumns = columnsOf(api).length;
        drawnRows = api.getDisplayedRowCount();
        if (ref) return;
      } catch (e) {
        console.warn("ag-grid restoreChart:", e.message);
      }
    }
    drawnRows = api.getDisplayedRowCount();
    const chartType = typeForRows(type, drawnRows);
    const chartThemeOverrides = chartOverrides(chartView, chartType, settings());
    if (api.isPivotMode?.()) {
      drawnColumns = columnsOf(api).length;
      ref = drawnRows ? api.createPivotChart({ chartType, chartContainer: chartEl, chartThemeName: themeName(), chartThemeOverrides }) ?? null : null;
      return;
    }
    const problem = cellRangeProblem(api, chartView, chartView.chartType);
    if (problem) onProblem(problem);
    const columns = chartColumns(columnsOf(api), chartView, chartView.chartType);
    drawnColumns = columns.length;
    if (!columns.length || !drawnRows) {
      ref = null;
      return;
    }
    ref = api.createRangeChart({
      chartType,
      cellRange: { columns, ...(rowRange?.() ?? {}) },
      chartThemeName: themeName(),
      chartContainer: chartEl,
      suppressChartRanges: true,
      chartThemeOverrides,
    }) ?? null;
  };

  const destroyChart = () => {
    if (ref) {
      try { ref.destroyChart(); } catch { /* already gone */ }
      ref = null;
    }
    chartEl.replaceChildren();
  };

  const show = (next) => {
    open = next;
    gridEl.style.visibility = open ? "hidden" : "visible";
    chartEl.style.visibility = open ? "visible" : "hidden";
    chartEl.style.pointerEvents = open ? "auto" : "none";
  };

  const listener = () => save();
  api.addEventListener("chartOptionsChanged", listener);
  api.addEventListener("chartRangeSelectionChanged", listener);

  const view = {
    get isOpen() { return open; },
    get chartId() { return ref?.chartId ?? null; },
    open() {
      if (!ref) {
        try { create(saved?.model); } catch (e) { console.warn("ag-grid createRangeChart:", e.message); }
      }
      show(true);
      save();
      return ref !== null;
    },
    close() {
      show(false);
      save();
    },
    /**
     * Draws the chart afresh over the rows `rowRange` gives now (a server-side grid's current page),
     * keeping the chart type the user picked.
     */
    rebuild() {
      if (!open) return;
      try {
        const current = ref ? (api.getChartModels?.() ?? []).find((m) => m.chartId === ref.chartId) : null;
        if (current?.chartType) type = current.chartType;
      } catch {
        /* keep the type */
      }
      destroyChart();
      try { create(null, false); } catch (e) { console.warn("ag-grid createRangeChart:", e.message); }
      save();
    },
    /** Draws the chart again with the card's new settings, keeping what the user arranged. */
    redraw() {
      view.setMode(currentMode);
    },
    /** Draws the chart again in the site's new mode, keeping what the user arranged. */
    setMode(nextMode) {
      currentMode = nextMode;
      if (!ref) return;
      let model = null;
      try { model = (api.getChartModels?.() ?? []).find((m) => m.chartId === ref.chartId) ?? null; } catch { model = null; }
      destroyChart();
      try { create(model, true); } catch (e) { console.warn("ag-grid chart theme:", e.message); }
    },
    refresh() {
      if (!open || (ref && drawnColumns > 0 && drawnRows > 0)) return;
      destroyChart();
      try { create(saved?.model); } catch (e) { console.warn("ag-grid createRangeChart:", e.message); }
      if (ref) save();
    },
    destroy() {
      api.removeEventListener("chartOptionsChanged", listener);
      api.removeEventListener("chartRangeSelectionChanged", listener);
      destroyChart();
    },
  };

  show(false);
  if (saved?.open ?? chartView.enabled === true) view.open();
  return view;
}
