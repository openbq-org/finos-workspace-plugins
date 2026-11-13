import { AgChartsEnterpriseModule } from "ag-charts-enterprise";
import {
  AllEnterpriseModule,
  createGrid as agCreateGrid,
  LicenseManager,
  ModuleRegistry,
  themeAlpine,
  themeBalham,
  themeMaterial,
  themeQuartz,
} from "ag-grid-enterprise";
import { chartMenuItem } from "./ag-table-chart/chartView.js";
import { compileExpression } from "./ag-table-chart/expression.js";
import { fieldsOf } from "./infer.js";

ModuleRegistry.registerModules([AllEnterpriseModule.with(AgChartsEnterpriseModule)]);

export const STATE_PARAM = "gridState";
export const MAX_STATE_TEXT = 4096;
export const MAX_STATE_SELECTION = 1000;

const CHART_THEMES = ["ag-default", "ag-vivid", "ag-polychroma", "ag-sheets", "ag-material"];

/** `compact`: Alpine, small type, short rows, no column lines, and every other row shaded. */
const themeCompact = themeAlpine.withParams({
  fontSize: 12,
  headerFontSize: 12,
  headerFontWeight: 600,
  rowHeight: 30,
  headerHeight: 32,
  spacing: 6,
  cellHorizontalPadding: 8,
  columnBorder: false,
  headerColumnBorder: false,
  wrapperBorderRadius: 2,
  oddRowBackgroundColor: { ref: "foregroundColor", mix: 0.035, onto: "backgroundColor" },
});

export const BASE_THEMES = { quartz: themeQuartz, alpine: themeAlpine, balham: themeBalham, material: themeMaterial, compact: themeCompact };

const FALLBACK_COLORS = {
  light: { background: "#ffffff", foreground: "#1f2933", border: "#e1e6eb", accent: "#0b62d6" },
  dark: { background: "#0f1b26", foreground: "#d5dfe8", border: "#223445", accent: "#4fa3ff" },
};

export function siteColors(theme) {
  const mode = theme?.mode === "dark" ? "dark" : "light";
  const tokens = theme?.tokens && typeof theme.tokens === "object" ? theme.tokens : {};
  const fallback = FALLBACK_COLORS[mode];
  return {
    mode,
    background: tokens.card || tokens.background || fallback.background,
    foreground: tokens["card-foreground"] || tokens.foreground || fallback.foreground,
    border: tokens.border || fallback.border,
    accent: tokens["brand-main"] || fallback.accent,
    fontFamily: tokens["font-family"] || 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  };
}

export function baseThemeName(...choices) {
  return choices.find((name) => typeof name === "string" && Object.hasOwn(BASE_THEMES, name)) ?? DEFAULT_BASE_THEME;
}

export const DEFAULT_BASE_THEME = "balham";

const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+\s*)?\)|[a-z]{3,20})$/i;
const FONT_RE = /^[\w\s,"'-]{1,200}$/;

function inRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max ? value : undefined;
}

/**
 * The organization's look, from its admin settings: an accent colour, a font, a font size, a row
 * height, shaded rows, column lines and a header colour. Values that do not fit are ignored.
 */
export function orgThemeParams(adminSettings = {}) {
  const s = adminSettings && typeof adminSettings === "object" ? adminSettings : {};
  const params = {};
  if (typeof s.accentColor === "string" && COLOR_RE.test(s.accentColor.trim())) params.accentColor = s.accentColor.trim();
  if (typeof s.headerBackgroundColor === "string" && COLOR_RE.test(s.headerBackgroundColor.trim())) params.headerBackgroundColor = s.headerBackgroundColor.trim();
  if (typeof s.fontFamily === "string" && FONT_RE.test(s.fontFamily.trim())) params.fontFamily = s.fontFamily.trim();
  const fontSize = inRange(s.fontSize, 9, 20);
  if (fontSize) params.fontSize = fontSize;
  const rowHeight = inRange(s.rowHeight, 20, 60);
  if (rowHeight) params.rowHeight = rowHeight;
  if (typeof s.stripedRows === "boolean") params.oddRowBackgroundColor = s.stripedRows ? { ref: "foregroundColor", mix: 0.035, onto: "backgroundColor" } : { ref: "backgroundColor" };
  if (typeof s.columnBorders === "boolean") {
    params.columnBorder = s.columnBorders;
    params.headerColumnBorder = s.columnBorders;
  }
  return params;
}

export function themeFor(theme, baseName = DEFAULT_BASE_THEME, adminSettings = {}) {
  const colors = siteColors(theme);
  return BASE_THEMES[baseThemeName(baseName)].withParams({
    browserColorScheme: colors.mode,
    backgroundColor: colors.background,
    foregroundColor: colors.foreground,
    borderColor: colors.border,
    accentColor: colors.accent,
    fontFamily: colors.fontFamily,
    ...orgThemeParams(adminSettings),
  });
}

export const DEFAULT_COL_DEF = {
  resizable: true,
  sortable: true,
  filter: true,
  editable: false,
  flex: 1,
  minWidth: 70,
  suppressHeaderFilterButton: true,
  enableRowGroup: true,
  enablePivot: true,
  enableValue: true,
};

export function modeOf(model) {
  return model.get("theme")?.mode === "dark" ? "dark" : "light";
}

export function chartThemesFor(mode) {
  return mode === "light" ? CHART_THEMES : CHART_THEMES.map((name) => `${name}-dark`);
}

export function baseThemeOf(model, gridOptions = {}) {
  return baseThemeName(model.get("config")?.theme, gridOptions.theme, model.get("adminSettings")?.theme);
}

export function paintSite(theme, root = document.body) {
  const colors = siteColors(theme);
  root.dataset.mode = colors.mode;
  root.style.setProperty("--ws-background", colors.background);
  root.style.setProperty("--ws-foreground", colors.foreground);
  root.style.setProperty("--ws-border", colors.border);
  root.style.setProperty("--ws-accent", colors.accent);
  root.style.setProperty("--ws-font-family", colors.fontFamily);
  return colors;
}

export const CHART_OVERRIDES = { common: { background: { fill: "transparent" } } };

export function applyTheme(api, model, gridOptions = {}) {
  const theme = model.get("theme");
  const colors = paintSite(theme);
  api?.setGridOption("theme", themeFor(theme, baseThemeOf(model, gridOptions), model.get("adminSettings")));
  api?.setGridOption("chartThemes", chartThemesFor(colors.mode));
  return colors.mode;
}

export function licenseKeyOf(model) {
  const config = model.get("config") || {};
  const adminSettings = model.get("adminSettings") || {};
  return config.licenseKey || adminSettings.licenseKey || "";
}

export function setLicense(model) {
  const key = licenseKeyOf(model);
  if (key) LicenseManager.setLicenseKey(key);
}

/**
 * The field that identifies a row: `wsRowIdColumns` (several fields, whose values joined with `-`
 * make the id), else `wsRowIdColumn`, else `id`.
 */
export function idFieldOf(definition) {
  const many = Array.isArray(definition?.wsRowIdColumns) ? definition.wsRowIdColumns.filter((f) => typeof f === "string" && f) : [];
  if (many.length > 1) return many;
  if (many.length === 1) return many[0];
  return definition && typeof definition.wsRowIdColumn === "string" && definition.wsRowIdColumn ? definition.wsRowIdColumn : "id";
}

/** The id of a row by its id field or fields, or null when it has none. */
export function keyOf(row, idField = "id") {
  if (!row || typeof row !== "object") return null;
  if (Array.isArray(idField)) {
    const parts = idField.map((field) => row[field]);
    return parts.every((v) => v !== undefined && v !== null) ? parts.map(String).join("-") : null;
  }
  const value = row[idField];
  return value === undefined || value === null ? null : String(value);
}

export function rowIdOf(row, index, idField = "id") {
  return keyOf(row, idField) ?? String(index);
}

export function hasIds(rows, idField = "id") {
  return rows.length > 0 && rows.every((row) => keyOf(row, idField) !== null);
}

export function rowIdGetter(idField) {
  const generated = new WeakMap();
  let next = 0;
  return ({ data }) => {
    const key = keyOf(data, idField);
    if (key !== null) return key;
    if (!generated.has(data)) generated.set(data, `~${next++}`);
    return generated.get(data);
  };
}

export function baseOptions(model, gridOptions = {}, { serverSide = false } = {}) {
  const colors = paintSite(model.get("theme"));
  const mode = colors.mode;
  return {
    theme: themeFor(model.get("theme"), baseThemeOf(model, gridOptions), model.get("adminSettings")),
    chartThemeOverrides: CHART_OVERRIDES,
    paginationAutoPageSize: !serverSide,
    paginationPageSizeSelector: false,
    suppressDragLeaveHidesColumns: true,
    suppressFieldDotNotation: true,
    stopEditingWhenCellsLoseFocus: true,
    tooltipShowDelay: 400,
    tooltipInteraction: true,
    animateRows: true,
    suppressScrollOnNewData: true,
    cellSelection: true,
    allowContextMenuWithControlKey: true,
    enableCharts: true,
    chartThemes: chartThemesFor(mode),
    popupParent: document.body,
    sideBar: { toolPanels: ["columns", FILTERS_TOOL_PANEL], defaultToolPanel: "" },
    enableFilterHandlers: true,
    rowGroupPanelShow: "always",
    pivotPanelShow: "always",
    suppressAggFuncInHeader: true,
    autoGroupColumnDef: { headerName: "Group", minWidth: 160 },
    statusBar: statusBarFor(serverSide),
    getMainMenuItems: columnMenuItems,
    getContextMenuItems: contextMenuItems,
    overlayNoRowsTemplate: '<span class="ag-overlay-no-rows-center">No rows to show</span>',
    ...(serverSide ? {} : { groupDefaultExpanded: 1 }),
  };
}

export function backendOptions(gridOptions) {
  const { theme: _theme, enableCellExpressions: _cells, ...rest } = gridOptions && typeof gridOptions === "object" ? gridOptions : {};
  return rest;
}

export const EXPRESSION_ERROR = "#ERROR";
export const MAX_EXPRESSION_DEPTH = 16;
const compiledExpressions = new Map();

function compiledOf(source) {
  if (!compiledExpressions.has(source)) {
    let compiled;
    try {
      compiled = compileExpression(source);
    } catch (error) {
      compiled = error;
    }
    compiledExpressions.set(source, compiled);
  }
  return compiledExpressions.get(source);
}

function leavesOf(defs) {
  return defs.flatMap((def) => (Array.isArray(def.children) ? leavesOf(def.children) : [def]));
}

export function withExpressions(defs, rows = [], { cellExpressions = false } = {}) {
  const formulas = new Map();
  for (const def of leavesOf(defs)) {
    if (typeof def.calculatedExpression === "string") formulas.set(def.colId ?? def.field, def.calculatedExpression);
  }
  if (!formulas.size && !cellExpressions) return defs;

  const run = (source, row, depth) => {
    const compiled = compiledOf(source);
    if (compiled instanceof Error || depth > MAX_EXPRESSION_DEPTH) return EXPRESSION_ERROR;
    try {
      const value = compiled((name) => {
        const found = valueOf(row, name, depth);
        if (found === EXPRESSION_ERROR) throw new RangeError(name);
        return found;
      });
      return typeof value === "number" && !Number.isFinite(value) ? EXPRESSION_ERROR : value;
    } catch {
      return EXPRESSION_ERROR;
    }
  };
  const valueOf = (row, name, depth) => {
    if (formulas.has(name)) return run(formulas.get(name), row, depth + 1);
    const raw = row?.[name];
    return cellExpressions && typeof raw === "string" && raw.startsWith("=") ? run(raw.slice(1), row, depth + 1) : raw;
  };

  const first = rows.find((row) => row && typeof row === "object");
  const map = (list) =>
    list.map((def) => {
      if (Array.isArray(def.children)) return { ...def, children: map(def.children) };
      const { calculatedExpression, ...rest } = def;
      if (typeof calculatedExpression === "string") {
        const getter = (params) => run(calculatedExpression, params.data, 0);
        const numeric = typeof getter({ data: first }) === "number";
        return {
          ...rest,
          colId: def.colId ?? def.field,
          editable: false,
          valueGetter: getter,
          ...(numeric && !rest.type && !rest.headerClass ? { type: "numericColumn" } : {}),
          ...(numeric && (rest.filter === undefined || rest.filter === true || rest.filter === "agTextColumnFilter") ? { filter: "agNumberColumnFilter" } : {}),
          ...(numeric && !rest.valueFormatter ? { valueFormatter: formatNumber } : {}),
        };
      }
      if (cellExpressions && def.field && !def.valueGetter) return { ...rest, valueGetter: (params) => valueOf(params.data, def.field, 0) };
      return rest;
    });
  return map(defs);
}

export function cellExpressionsOf(gridOptions, definition) {
  return gridOptions?.enableCellExpressions === true || definition?.enableCellExpressions === true;
}

export function floatingFiltersOf(model) {
  const on = model?.get("config")?.floatingFilters;
  return typeof on === "boolean" ? on : undefined;
}

export function advancedFilterOf(model) {
  const on = model?.get("config")?.advancedFilter;
  return typeof on === "boolean" ? on : undefined;
}

/** The card's settings for the table body: decimals, large numbers, the status bar and pages. */
export function displaySettingsOf(model) {
  const config = model?.get("config") || {};
  const pageSize = Number(config.pageSize);
  return {
    decimals: Number.isInteger(config.decimals) && config.decimals >= 0 && config.decimals <= 8 ? config.decimals : undefined,
    abbreviate: config.abbreviateNumbers === true,
    statusBar: config.statusBar !== false,
    pagination: ["on", "off"].includes(config.pagination) ? config.pagination : "auto",
    pageSize: Number.isInteger(pageSize) && pageSize > 0 ? pageSize : null,
  };
}

/** The pagination options for `rows` rows: the card's choice, else the backend's, else pages above `above` rows. */
export function paginationFor(settings, backend = {}, rows = 0, above = 100) {
  const on = settings.pagination === "on" ? true : settings.pagination === "off" ? false : Object.hasOwn(backend, "pagination") ? backend.pagination === true : rows > above;
  if (!on) return { pagination: false };
  if (settings.pageSize) return { pagination: true, paginationAutoPageSize: false, paginationPageSize: settings.pageSize };
  if (Object.hasOwn(backend, "paginationPageSize")) return { pagination: true, paginationAutoPageSize: false, paginationPageSize: backend.paginationPageSize };
  return { pagination: true, paginationAutoPageSize: true };
}

export function statusBarFor(serverSide, on = true) {
  if (!on) return undefined;
  return {
    statusPanels: [
      ...(serverSide ? [] : [{ statusPanel: "agTotalAndFilteredRowCountComponent", align: "left" }]),
      { statusPanel: "agAggregationComponent", align: "right" },
    ],
  };
}

/** The column menu: AG Grid's items, then Hide column and, for a wide column, Narrow column. */
export function columnMenuItems(params) {
  const column = params.column;
  const items = [...(params.defaultItems ?? [])];
  if (!column) return items;
  items.push("separator", {
    name: "Hide column",
    action: () => params.api.setColumnsVisible([column], false),
  });
  if (column.getActualWidth() > 200) {
    items.push({ name: "Narrow column", action: () => params.api.setColumnWidths([{ key: column, newWidth: 150 }]) });
  }
  return items;
}

/** The context menu: AG Grid's items, with its Chart Range replaced by the plugin's Chart item. */
export function contextMenuItems(params) {
  return (params.defaultItems ?? []).map((item) => (item === "chartRange" ? chartMenuItem(params.api) : item));
}

/** Puts the columns back as the column definitions have them: order, widths, visibility, pinning and grouping. */
export function resetColumns(api) {
  api.resetColumnState();
  api.resetColumnGroupState();
}

/**
 * With many columns that share the card's width, each gets too narrow to read: sizes them to their
 * content instead. Columns with a width of their own keep it.
 */
export const AUTOSIZE_ABOVE_COLUMNS = 6;

export function sizeColumnsToContent(api) {
  const columns = (api.getAllDisplayedColumns?.() ?? []).filter((c) => !c.getColDef().width);
  if (columns.length <= AUTOSIZE_ABOVE_COLUMNS) return false;
  api.applyColumnState({ state: columns.map((c) => ({ colId: c.getColId(), flex: null })) });
  api.autoSizeColumns(columns.map((c) => c.getColId()));
  return true;
}

/** The text of the empty grid: whether the filters hide every row, or there are none. */
export function noRowsText(api) {
  const filtered = api.isAnyFilterPresent?.() || (api.getGridOption("enableAdvancedFilter") === true && api.getAdvancedFilterModel?.());
  return filtered ? "No rows match the filters" : "No rows to show";
}

/**
 * Double-clicking a column header selects the column's cells (with Shift, every column from the
 * one picked before); double-clicking a cell selects its row. Client-side grids with cell
 * selection only.
 */
export function attachSelectionShortcuts(api, el) {
  let anchor = null;
  const lastRow = () => api.getDisplayedRowCount() - 1;
  const onHeader = (event) => {
    const cell = event.target?.closest?.(".ag-header-cell[col-id]");
    if (!cell || api.isDestroyed() || lastRow() < 0) return;
    const colId = cell.getAttribute("col-id");
    const columns = api.getAllDisplayedColumns().map((c) => c.getColId());
    if (!columns.includes(colId)) return;
    const from = event.shiftKey && anchor && columns.includes(anchor) ? anchor : colId;
    const [start, end] = [columns.indexOf(from), columns.indexOf(colId)].sort((a, b) => a - b);
    api.clearCellSelection?.();
    api.addCellRange({ rowStartIndex: 0, rowEndIndex: lastRow(), columns: columns.slice(start, end + 1) });
    if (!event.shiftKey) anchor = colId;
  };
  const onCell = (event) => {
    if (api.isDestroyed() || event.rowIndex === null || event.rowIndex === undefined || event.node?.group) return;
    api.clearCellSelection?.();
    api.addCellRange({ rowStartIndex: event.rowIndex, rowEndIndex: event.rowIndex, columns: api.getAllDisplayedColumns() });
  };
  el.addEventListener("dblclick", onHeader);
  api.addEventListener("cellDoubleClicked", onCell);
  return () => {
    el.removeEventListener("dblclick", onHeader);
    if (!api.isDestroyed()) api.removeEventListener("cellDoubleClicked", onCell);
  };
}

/** The rows as an Excel workbook, with raw values as in the CSV. */
export function rawExcel(api) {
  return api.getDataAsExcel({
    processCellCallback: (p) => {
      if (p.value instanceof Date) return p.node?.data?.[p.column.getColDef().field] ?? p.value.toISOString();
      return Array.isArray(p.value) ? p.value.join(" ") : p.value;
    },
  });
}

/** The Filters Tool Panel of AG Grid 34: the user adds a filter per column and sees each filter's summary. */
export const FILTERS_TOOL_PANEL = "filters-new";
const FILTER_PANELS = new Set(["filters", FILTERS_TOOL_PANEL, "agFiltersToolPanel", "agNewFiltersToolPanel"]);

export function isFilterPanel(panel) {
  return typeof panel === "string" ? FILTER_PANELS.has(panel) : FILTER_PANELS.has(panel?.toolPanel) || FILTER_PANELS.has(panel?.id);
}

/** The side bar without its filter panels, which AG Grid does not offer while the Advanced Filter is on. */
export function withoutFilterPanels(sideBar) {
  if (!sideBar) return sideBar;
  if (sideBar === true) return { toolPanels: ["columns"], defaultToolPanel: "" };
  if (typeof sideBar === "string") return isFilterPanel(sideBar) ? false : sideBar;
  if (Array.isArray(sideBar)) return sideBar.filter((panel) => !isFilterPanel(panel));
  if (!Array.isArray(sideBar.toolPanels)) return sideBar;
  return {
    ...sideBar,
    toolPanels: sideBar.toolPanels.filter((panel) => !isFilterPanel(panel)),
    ...(isFilterPanel(sideBar.defaultToolPanel) ? { defaultToolPanel: "" } : {}),
  };
}

function copyOf(sideBar) {
  if (Array.isArray(sideBar)) return [...sideBar];
  if (sideBar && typeof sideBar === "object") return { ...sideBar, ...(Array.isArray(sideBar.toolPanels) ? { toolPanels: [...sideBar.toolPanels] } : {}) };
  return sideBar;
}

/** The Advanced Filter works on the client-side and server-side row models only. */
export function allowsAdvancedFilter(rowModelType) {
  return rowModelType === undefined || rowModelType === "clientSide" || rowModelType === "serverSide";
}

const fullSideBars = new WeakMap();
const fullStatusBars = new WeakMap();

export function gridOptionsFor({ model, gridOptions = {}, serverSide = false, base = baseOptions(model, gridOptions, { serverSide }), ...own }) {
  const backend = backendOptions(gridOptions);
  const floatingFilter = floatingFiltersOf(model);
  const options = {
    ...base,
    ...own,
    ...backend,
    defaultColDef: { ...DEFAULT_COL_DEF, ...(backend.defaultColDef || {}), ...(floatingFilter === undefined ? {} : { floatingFilter }) },
  };
  fullStatusBars.set(options, options.statusBar);
  if (!displaySettingsOf(model).statusBar) options.statusBar = undefined;
  if (!allowsAdvancedFilter(options.rowModelType)) {
    delete options.enableAdvancedFilter;
    return options;
  }
  const advanced = advancedFilterOf(model);
  if (advanced !== undefined) options.enableAdvancedFilter = advanced;
  fullSideBars.set(options, options.sideBar);
  if (options.enableAdvancedFilter === true) options.sideBar = withoutFilterPanels(options.sideBar);
  return options;
}

export function filterModelOf(api) {
  if (api.getGridOption("enableAdvancedFilter") === true && allowsAdvancedFilter(api.getGridOption("rowModelType"))) return api.getAdvancedFilterModel() ?? {};
  return api.getFilterModel();
}

/** Turns the Advanced Filter on or off, hiding the side bar's filter panels while it is on. */
export function setAdvancedFilter(api, on) {
  if (!fullSideBars.has(api) || api.isDestroyed() || api.getGridOption("enableAdvancedFilter") === on) return;
  const full = fullSideBars.get(api);
  if (on) {
    api.setGridOption("sideBar", withoutFilterPanels(full));
    api.setGridOption("enableAdvancedFilter", true);
  } else {
    api.setGridOption("enableAdvancedFilter", false);
    api.setGridOption("sideBar", copyOf(full));
  }
}

export const ACTION_AUTOSIZE = "autosize";
export const ACTION_CLEAR_FILTERS = "clear-filters";
export const ACTION_RESET_COLUMNS = "reset-columns";

export function attachCardActions(api, model) {
  const onConfig = () => {
    if (!api.isDestroyed() && fullStatusBars.has(api)) {
      const statusBar = displaySettingsOf(model).statusBar ? fullStatusBars.get(api) : undefined;
      if (api.getGridOption("statusBar") !== statusBar) api.setGridOption("statusBar", statusBar);
    }
    const advanced = advancedFilterOf(model);
    if (advanced !== undefined) setAdvancedFilter(api, advanced);
    const floatingFilter = floatingFiltersOf(model);
    if (floatingFilter === undefined || api.isDestroyed()) return;
    const defaultColDef = api.getGridOption("defaultColDef") || {};
    if (defaultColDef.floatingFilter !== floatingFilter) api.setGridOption("defaultColDef", { ...defaultColDef, floatingFilter });
  };
  const onEvent = (event) => {
    if (event?.kind !== "workspace-event" || event.name !== "action" || api.isDestroyed()) return;
    if (event.id === ACTION_AUTOSIZE) api.autoSizeAllColumns();
    if (event.id === ACTION_RESET_COLUMNS) resetColumns(api);
    if (event.id === ACTION_CLEAR_FILTERS) {
      api.setFilterModel(null);
      api.applyColumnState({ defaultState: { sort: null } });
    }
  };
  model.on("change:config", onConfig);
  model.on("msg:custom", onEvent);
  return () => {
    model.off("change:config", onConfig);
    model.off("msg:custom", onEvent);
  };
}

export function createGrid(el, options) {
  const api = agCreateGrid(el, options);
  if (fullSideBars.has(options)) fullSideBars.set(api, fullSideBars.get(options));
  if (fullStatusBars.has(options)) fullStatusBars.set(api, fullStatusBars.get(options));
  return api;
}

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });

export function formatNumber(params) {
  return typeof params.value === "number" && Number.isFinite(params.value) ? numberFormat.format(params.value) : params.value;
}

export function compactColumnDefs(defs, rows) {
  return defs.map((def) => {
    if (Array.isArray(def.children)) return { ...def, children: compactColumnDefs(def.children, rows) };
    if (!def.field || def.valueFormatter) return def;
    if ([def.type].flat().includes("numericColumn")) return { ...def, valueFormatter: formatNumber };
    if (def.type || def.cellRenderer) return def;
    const first = rows.find((r) => r && r[def.field] !== null && r[def.field] !== undefined);
    return first && typeof first[def.field] === "number" ? { ...def, type: "numericColumn", valueFormatter: formatNumber } : def;
  });
}

export function rowsOf(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data.rowData)) return data.rowData;
  if (Array.isArray(data.columns) && Array.isArray(data.data)) {
    return data.data.map((row) => Object.fromEntries(data.columns.map((c, j) => [c, row[j]])));
  }
  const columns = data.data && typeof data.data === "object" && !Array.isArray(data.data) ? data.data : data;
  const names = Object.keys(columns).filter((name) => Array.isArray(columns[name]));
  const length = names.length ? columns[names[0]].length : 0;
  return Array.from({ length }, (_, i) => Object.fromEntries(names.map((c) => [c, columns[c][i]])));
}

export function numericStats(rows, columns) {
  const stats = {};
  for (const col of columns) {
    let count = 0;
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (const row of rows) {
      const v = row?.[col];
      if (typeof v !== "number" || Number.isNaN(v)) continue;
      count += 1;
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (count > 0) stats[col] = { count, min, max, sum, avg: sum / count };
  }
  return stats;
}

export function leafRowsOf(api, limit = Infinity) {
  const rows = [];
  api.forEachNodeAfterFilterAndSort((node) => {
    if (!node.group && node.data && rows.length < limit) rows.push(node.data);
  });
  return rows;
}

export function columnFieldsOf(api) {
  return (api.getColumns() || []).map((c) => c.getColDef().field).filter(Boolean);
}

export function sortModelOf(api) {
  return api
    .getColumnState()
    .filter((c) => c.sort)
    .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0))
    .map(({ colId, sort }) => ({ colId, sort }));
}

export function groupingOf(api) {
  const state = api.getColumnState();
  return {
    rowGroups: state.filter((c) => c.rowGroup).sort((a, b) => (a.rowGroupIndex ?? 0) - (b.rowGroupIndex ?? 0)).map((c) => c.colId),
    pivots: state.filter((c) => c.pivot).sort((a, b) => (a.pivotIndex ?? 0) - (b.pivotIndex ?? 0)).map((c) => c.colId),
    values: state.filter((c) => c.aggFunc).map((c) => ({ colId: c.colId, aggFunc: c.aggFunc })),
    pivotMode: api.isPivotMode(),
  };
}

export function rawCsv(api) {
  return api.getDataAsCsv({
    processCellCallback: (p) => {
      if (p.value instanceof Date) return p.node?.data?.[p.column.getColDef().field] ?? p.value.toISOString();
      return Array.isArray(p.value) ? p.value.join(" ") : p.value;
    },
  });
}

export const MAX_GRID_STATE_TEXT = 32 * 1024;
export const GRID_STATE_SAVE_MS = 300;
const TRANSIENT_GRID_STATE = ["focusedCell", "cellSelection", "rangeSelection", "scroll", "rowSelection"];

export function gridStateSnapshot(api) {
  const snapshot = { ...api.getState() };
  for (const key of TRANSIENT_GRID_STATE) delete snapshot[key];
  if (JSON.stringify(snapshot).length <= MAX_GRID_STATE_TEXT) return snapshot;
  delete snapshot.rowGroupExpansion;
  delete snapshot.ssrmRowGroupExpansion;
  delete snapshot.columnSizing;
  return JSON.stringify(snapshot).length <= MAX_GRID_STATE_TEXT ? snapshot : null;
}

const GRID_STATE_KEYS = [
  "aggregation", "columnGroup", "columnOrder", "columnPinning", "columnSizing", "columnVisibility", "filter", "focusedCell",
  "pagination", "rowPinning", "pivot", "cellSelection", "rangeSelection", "rowGroup", "rowGroupExpansion",
  "ssrmRowGroupExpansion", "rowSelection", "scroll", "sideBar", "sort",
];

/**
 * The layout a new card opens with, from the definition: `columnState` (a grid state, directly or
 * under `default`) and `filterModel`. Null when the definition sets neither.
 */
export function presetStateOf(definition) {
  const table = definition && typeof definition === "object" ? definition : {};
  const columnState = table.columnState && typeof table.columnState === "object" ? table.columnState : {};
  const own = Object.fromEntries(Object.entries(columnState).filter(([key, value]) => key !== "default" && value && typeof value === "object"));
  const preset = { ...(columnState.default && typeof columnState.default === "object" ? columnState.default : {}), ...own };
  if (table.filterModel && typeof table.filterModel === "object" && Object.keys(table.filterModel).length) preset.filter = { filterModel: table.filterModel };
  return Object.keys(preset).length ? preset : null;
}

/**
 * Applies a preset without resetting what it leaves out: the column definitions' own grouping,
 * pivot and widths stay unless the preset names them.
 */
export function applyPresetState(api, preset) {
  if (!preset) return;
  const ignored = GRID_STATE_KEYS.filter((key) => !Object.hasOwn(preset, key));
  try {
    api.setState({ ...preset, partialColumnState: true }, [...new Set([...ignored, ...TRANSIENT_GRID_STATE])]);
  } catch (e) {
    console.warn("ag-grid preset layout:", e.message);
  }
}

export function restoreGridState(api, saved) {
  if (!saved || typeof saved !== "object") return;
  try {
    api.setState(saved, TRANSIENT_GRID_STATE);
  } catch (e) {
    console.warn("ag-grid state restore:", e.message);
  }
}

export function createTracker(model, extra = {}) {
  let gridLive = !extra.grid;
  let gridTimer;
  const state = {
    selection: [],
    lastEvent: null,
    rowCount: 0,
    columnCount: 0,
    filterModel: null,
    sortModel: null,
    grouping: null,
    grid: null,
    ...extra,
  };

  const persist = () => {
    try {
      model.set("state", { ...state });
      model.save_changes();
    } catch (e) {
      console.warn("ag-grid state write:", e.message);
    }
  };

  const record = (kind, detail) => {
    state.lastEvent = { kind, detail, timestamp: Date.now() };
    persist();
  };

  const attach = (api) => {
    const fieldOf = (event) => event.colDef?.field;
    const grouping = () => {
      state.grouping = groupingOf(api);
      record("groupingChanged", state.grouping);
    };
    const handlers = {
      selectionChanged: () => {
        const nodes = api.getSelectedNodes();
        state.selection = nodes.slice(0, MAX_STATE_SELECTION).map((n) => n.id);
        state.rowCount = api.getDisplayedRowCount();
        record("selectionChanged", { count: nodes.length });
      },
      cellValueChanged: (event) => {
        record("cellValueChanged", { rowId: event.node?.id, colDef: fieldOf(event), oldValue: event.oldValue, newValue: event.newValue });
      },
      rowDataUpdated: () => {
        state.rowCount = api.getDisplayedRowCount();
        state.columnCount = (api.getColumns() || []).length;
        record("rowDataUpdated", { rowCount: state.rowCount });
      },
      filterChanged: () => {
        state.filterModel = filterModelOf(api);
        record("filterChanged", { filterModel: state.filterModel });
      },
      sortChanged: () => {
        state.sortModel = sortModelOf(api);
        record("sortChanged", { sortModel: state.sortModel });
      },
      columnRowGroupChanged: grouping,
      columnPivotChanged: grouping,
      columnValueChanged: grouping,
      columnPivotModeChanged: grouping,
      stateUpdated: () => {
        if (!gridLive) return;
        clearTimeout(gridTimer);
        gridTimer = setTimeout(() => {
          if (api.isDestroyed()) return;
          state.grid = gridStateSnapshot(api);
          persist();
        }, GRID_STATE_SAVE_MS);
      },
      cellClicked: (event) => {
        const value = event.value;
        record("cellClicked", {
          rowId: event.node?.id,
          colDef: fieldOf(event),
          value: value instanceof Date ? value.toISOString() : value !== null && typeof value === "object" ? null : value,
        });
      },
    };
    for (const [name, handler] of Object.entries(handlers)) handlers[name] = (event) => (api.isDestroyed() ? undefined : handler(event));
    for (const [name, handler] of Object.entries(handlers)) api.addEventListener(name, handler);
    state.rowCount = api.getDisplayedRowCount();
    state.columnCount = (api.getColumns() || []).length;
    persist();
    return () => {
      clearTimeout(gridTimer);
      for (const [name, handler] of Object.entries(handlers)) api.removeEventListener(name, handler);
    };
  };

  const gridRestored = () => {
    gridLive = true;
  };

  return { state, persist, record, attach, gridRestored };
}

export function gridStateOf(api, event) {
  const grouping = groupingOf(api);
  const columnsOf = (ids) => ids.map((id) => {
    const def = api.getColumn(id)?.getColDef();
    return { id, displayName: def?.headerName ?? id, field: def?.field ?? id };
  });
  return {
    event,
    filterModel: filterModelOf(api),
    sortModel: sortModelOf(api),
    rowGroupCols: columnsOf(grouping.rowGroups),
    pivotCols: columnsOf(grouping.pivots),
    valueCols: grouping.values.map(({ colId, aggFunc }) => ({ ...columnsOf([colId])[0], aggFunc })),
    pivotMode: grouping.pivotMode,
    selectedRowIds: api.getSelectedNodes().map((n) => n.id),
  };
}

export function stateText(seq, state) {
  const text = JSON.stringify({ seq, ...state });
  if (text.length <= MAX_STATE_TEXT || !state.selectedRowIds?.length) return text;
  return JSON.stringify({ seq, ...state, selectedRowIds: [], selectedRowCount: state.selectedRowIds.length });
}

export function createStateChannel(model, start = Date.now()) {
  let seq = start;
  const next = (state) => {
    seq += 1;
    const text = stateText(seq, state);
    if (text.length > MAX_STATE_TEXT) return { seq, text, error: `The grid state is longer than ${MAX_STATE_TEXT.toLocaleString("en")} characters.` };
    return { seq, text };
  };
  return {
    get declared() {
      return Object.hasOwn(model.get("params") || {}, STATE_PARAM);
    },
    next,
    send(state) {
      const sent = next(state);
      if (sent.error) return sent;
      model.set("params", { ...(model.get("params") || {}), [STATE_PARAM]: sent.text });
      model.save_changes();
      return sent;
    },
    current() {
      return model.get("params")?.[STATE_PARAM] ?? null;
    },
  };
}

export const MAX_CONTEXT_ROWS_TEXT = 128 * 1024;

export function sampleRows(rows, maxText = MAX_CONTEXT_ROWS_TEXT) {
  const sample = [];
  let size = 2;
  for (const row of rows) {
    const text = JSON.stringify(row) ?? "null";
    if (size + text.length + 1 > maxText) break;
    size += text.length + 1;
    sample.push(row);
  }
  return sample;
}

export function copilotContextOf(api, extra = {}) {
  const rows = leafRowsOf(api, 5000);
  const columns = columnFieldsOf(api);
  return {
    rows: sampleRows(rows),
    rowCount: rows.length,
    columnCount: columns.length,
    columns,
    selectionCount: api.getSelectedNodes().length,
    filterModel: filterModelOf(api),
    sortModel: sortModelOf(api),
    grouping: groupingOf(api),
    stats: numericStats(rows, columns),
    ...extra,
  };
}

export { fieldsOf };
