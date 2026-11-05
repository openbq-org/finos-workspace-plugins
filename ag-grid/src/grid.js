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
import { compileExpression } from "./ag-table-chart/expression.js";
import { fieldsOf } from "./infer.js";

ModuleRegistry.registerModules([AllEnterpriseModule.with(AgChartsEnterpriseModule)]);

export const STATE_PARAM = "gridState";
export const MAX_STATE_TEXT = 4096;
export const MAX_STATE_SELECTION = 1000;

const CHART_THEMES = ["ag-default", "ag-vivid", "ag-polychroma", "ag-sheets", "ag-material"];

export const BASE_THEMES = { quartz: themeQuartz, alpine: themeAlpine, balham: themeBalham, material: themeMaterial };

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

export function themeFor(theme, baseName = DEFAULT_BASE_THEME) {
  const colors = siteColors(theme);
  return BASE_THEMES[baseThemeName(baseName)].withParams({
    browserColorScheme: colors.mode,
    backgroundColor: colors.background,
    foregroundColor: colors.foreground,
    borderColor: colors.border,
    accentColor: colors.accent,
    fontFamily: colors.fontFamily,
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
  api?.setGridOption("theme", themeFor(theme, baseThemeOf(model, gridOptions)));
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

export function idFieldOf(definition) {
  return definition && typeof definition.wsRowIdColumn === "string" && definition.wsRowIdColumn ? definition.wsRowIdColumn : "id";
}

export function rowIdOf(row, index, idField = "id") {
  if (row && typeof row === "object" && row[idField] !== undefined && row[idField] !== null) return String(row[idField]);
  return String(index);
}

export function hasIds(rows, idField = "id") {
  return rows.length > 0 && rows.every((row) => row && row[idField] !== undefined && row[idField] !== null);
}

export function rowIdGetter(idField) {
  const generated = new WeakMap();
  let next = 0;
  return ({ data }) => {
    const value = data?.[idField];
    if (value !== undefined && value !== null) return String(value);
    if (!generated.has(data)) generated.set(data, `~${next++}`);
    return generated.get(data);
  };
}

export function baseOptions(model, gridOptions = {}, { serverSide = false } = {}) {
  const colors = paintSite(model.get("theme"));
  const mode = colors.mode;
  return {
    theme: themeFor(model.get("theme"), baseThemeOf(model, gridOptions)),
    chartThemeOverrides: CHART_OVERRIDES,
    paginationAutoPageSize: !serverSide,
    paginationPageSizeSelector: false,
    suppressDragLeaveHidesColumns: true,
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
    sideBar: { toolPanels: ["columns", "filters"], defaultToolPanel: "" },
    rowGroupPanelShow: "always",
    pivotPanelShow: "always",
    suppressAggFuncInHeader: true,
    autoGroupColumnDef: { headerName: "Group", minWidth: 160 },
    statusBar: {
      statusPanels: [
        ...(serverSide ? [] : [{ statusPanel: "agTotalAndFilteredRowCountComponent", align: "left" }]),
        { statusPanel: "agAggregationComponent", align: "right" },
      ],
    },
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

export function gridOptionsFor({ model, gridOptions = {}, serverSide = false, base = baseOptions(model, gridOptions, { serverSide }), ...own }) {
  const backend = backendOptions(gridOptions);
  const floatingFilter = floatingFiltersOf(model);
  return {
    ...base,
    ...own,
    ...backend,
    defaultColDef: { ...DEFAULT_COL_DEF, ...(backend.defaultColDef || {}), ...(floatingFilter === undefined ? {} : { floatingFilter }) },
  };
}

export const ACTION_AUTOSIZE = "autosize";
export const ACTION_CLEAR_FILTERS = "clear-filters";

export function attachCardActions(api, model) {
  const onConfig = () => {
    const floatingFilter = floatingFiltersOf(model);
    if (floatingFilter === undefined || api.isDestroyed()) return;
    const defaultColDef = api.getGridOption("defaultColDef") || {};
    if (defaultColDef.floatingFilter !== floatingFilter) api.setGridOption("defaultColDef", { ...defaultColDef, floatingFilter });
  };
  const onEvent = (event) => {
    if (event?.kind !== "workspace-event" || event.name !== "action" || api.isDestroyed()) return;
    if (event.id === ACTION_AUTOSIZE) api.autoSizeAllColumns();
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
  return agCreateGrid(el, options);
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
        state.filterModel = api.getFilterModel();
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
    filterModel: api.getFilterModel(),
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
    filterModel: api.getFilterModel(),
    sortModel: sortModelOf(api),
    grouping: groupingOf(api),
    stats: numericStats(rows, columns),
    ...extra,
  };
}

export { fieldsOf };
