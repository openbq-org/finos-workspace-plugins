/*
 * OpenBQ's table configuration (`data.table` in an OpenBQ widgets.json, `data["aggrid-table"]` here)
 * as AG Grid column definitions. Formatting, styles and clicks read `params.context`, which the
 * grid shares: { locale, decimals, actions, changes }.
 */
import { fieldsOf, inferColumnType } from "../infer.js";
import { columnColorStyle, greenRedStyle } from "./colors.js";
import { clipped, formatValue, headerFromField, titleCase, yearOf } from "./format.js";
import { fillTemplate, renderMarkdown } from "./markdown.js";
import { sparklineOptions, sparklinePoints } from "./sparkline.js";

export const RENDER_FNS = ["greenRed", "titleCase", "hoverCard", "cellOnClick", "columnColor", "showCellChange"];

export function renderFnsOf(def) {
  const fns = Array.isArray(def?.renderFn) ? def.renderFn : def?.renderFn ? [def.renderFn] : [];
  return fns.filter((fn) => RENDER_FNS.includes(fn));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

/** The value a cell shows of an object value: the hover card's `cellField`, else `value`. */
function cellValueOf(raw, cellField) {
  if (!isPlainObject(raw)) return raw;
  if (cellField && Object.hasOwn(raw, cellField)) return raw[cellField];
  if (Object.hasOwn(raw, "value")) return raw.value;
  return JSON.stringify(raw);
}

/** An integer that reads as a Unix time: seconds (2001 to 2286) or milliseconds over the same years. */
export function epochMs(value) {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  const size = Math.abs(value);
  if (size >= 1e9 && size < 1e10) return value * 1000;
  if (size >= 1e12 && size < 1e13) return value;
  return null;
}

/** A field whose name says it holds a date or a time: `date`, `trade_date`, `createdAt`, `timestamp`, `time`. */
export function isDateName(field) {
  const words = String(field ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return words.some((word) => ["date", "datetime", "timestamp", "time"].includes(word)) || words.at(-1) === "at";
}

function toDate(value) {
  if (value instanceof Date || value === null || value === undefined || value === "") return value ?? null;
  if (typeof value === "number") {
    const ms = epochMs(value);
    if (ms !== null) return new Date(ms);
    if (Number.isInteger(value) && value > 999 && value < 10000) return new Date(Date.UTC(value, 0, 1));
  }
  const parsed = new Date(typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  return Number.isNaN(parsed.getTime()) ? value : parsed;
}

const MIDNIGHT_RE = /^(\d{4}-\d{2}-\d{2})[T ]00:00(:00(\.0+)?)?(Z|[+-]00:?00)?$/;

/** A date cell's text: a date-time at midnight as its date, a Unix time as an ISO date (and time when it has one). */
export function dateText(value) {
  if (typeof value === "string") return MIDNIGHT_RE.exec(value)?.[1] ?? value;
  const ms = epochMs(value);
  if (ms === null) return value;
  const iso = new Date(ms).toISOString();
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

function dateComparator(filterDate, cellValue) {
  const cell = toDate(cellValue);
  if (!(cell instanceof Date)) return -1;
  const day = new Date(cell.getFullYear(), cell.getMonth(), cell.getDate()).getTime();
  return day === filterDate.getTime() ? 0 : day < filterDate.getTime() ? -1 : 1;
}

/** The OpenBQ data type of a column: its `cellDataType`, else inferred from the rows. */
function dataTypeOf(def, rows) {
  if (def.cellDataType) return def.cellDataType;
  const values = rows.slice(0, 200).map((r) => (r ? r[def.field] : undefined));
  const inferred = inferColumnType(values);
  if (inferred === "numeric" && isDateName(def.field)) {
    const numbers = values.filter((v) => typeof v === "number");
    if (numbers.length && numbers.every((v) => epochMs(v) !== null)) return "date";
  }
  return { numeric: "number", date: "date", boolean: "boolean", string: "text", object: "object", array: "object" }[inferred] ?? "text";
}

/** A tooltip component (AG Grid ITooltipComp) that shows OpenBQ's hover card. */
export class HoverCardTooltip {
  init(params) {
    const doc = params.eGridCell?.ownerDocument ?? document;
    const config = params.hoverCard ?? {};
    const raw = params.data ? params.data[params.colDef?.field] : undefined;
    const cellObject = isPlainObject(raw) ? raw : {};
    const gui = doc.createElement("div");
    gui.className = "ag-table-chart-hover-card";
    if (config.title) {
      const title = doc.createElement("div");
      title.className = "ag-table-chart-hover-card-title";
      title.textContent = fillTemplate(config.title, cellObject, params.data);
      gui.appendChild(title);
    }
    if (config.markdown) {
      gui.appendChild(renderMarkdown(doc, fillTemplate(config.markdown, cellObject, params.data)));
    } else {
      const fields = Array.isArray(params.hoverCardData) && params.hoverCardData.length
        ? params.hoverCardData
        : Object.keys(cellObject);
      const list = doc.createElement("dl");
      for (const field of fields) {
        const value = Object.hasOwn(cellObject, field) ? cellObject[field] : params.data?.[field];
        if (value === undefined) continue;
        const dt = doc.createElement("dt");
        dt.textContent = headerFromField(field);
        const dd = doc.createElement("dd");
        dd.textContent = isPlainObject(value) || Array.isArray(value) ? JSON.stringify(value) : String(value);
        list.append(dt, dd);
      }
      gui.appendChild(list);
    }
    this.gui = gui;
  }

  getGui() {
    return this.gui;
  }
}

function clickValue(def, params) {
  const fieldValue = def.renderFnParams?.groupBy?.valueField;
  if (fieldValue && params.data && Object.hasOwn(params.data, fieldValue)) return cellValueOf(params.data[fieldValue]);
  return params.value instanceof Date ? params.data?.[def.field] : params.value;
}

function onCellClick(def, params) {
  const p = def.renderFnParams ?? {};
  const actions = params.context?.actions;
  if (!actions) return;
  const row = params.data ?? {};
  switch (p.actionType) {
    case "groupBy":
      if (p.groupBy?.paramName) actions.groupBy(p.groupBy.paramName, clickValue(def, params), p.groupBy.forceUpdate === true);
      break;
    case "sendToAgent":
      actions.sendToAgent(fillTemplate(p.sendToAgent?.markdown ?? `{${def.field}}`, row), p.sendToAgent?.agentId);
      break;
    case "openUrl":
      actions.openUrl(p.url ? fillTemplate(p.url, row) : String(clickValue(def, params) ?? ""));
      break;
    default:
      break;
  }
}

function hasCardOf(def, fns) {
  const p = def.renderFnParams ?? {};
  return fns.includes("hoverCard") || (Array.isArray(p.hoverCardData) && p.hoverCardData.length > 0);
}

/** True when the column's texts are mostly links: a sample's non-empty strings that start with http(s)://. */
export function looksLikeLinks(rows, field) {
  const texts = rows.slice(0, 50).map((r) => r?.[field]).filter((v) => typeof v === "string" && v !== "");
  return texts.length > 0 && texts.filter((v) => /^https?:\/\/\S+$/i.test(v)).length * 2 > texts.length;
}

/** Long texts and abbreviated numbers show in full in their tooltip. */
const TOOLTIP_TEXT_AT = 40;

export function tooltipTextOf(params, colDef) {
  const value = params.value;
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "number") {
    const shown = typeof params.valueFormatted === "string" ? params.valueFormatted : null;
    return shown && /[MBT]$/.test(shown.replace(colDef.suffix ?? "", "")) ? formatValue(value, { locale: params.context?.locale, decimals: params.context?.decimals }) : undefined;
  }
  if (typeof value !== "string") return undefined;
  return params.context?.truncatedTooltips || value.length > TOOLTIP_TEXT_AT ? value : undefined;
}

/** A link cell: the URL, opened through the host (which asks the user first) when it is clicked. */
export class LinkCell {
  init(params) {
    const doc = params.eGridCell?.ownerDocument ?? document;
    this.gui = doc.createElement("span");
    this.update(params);
  }

  update(params) {
    const url = typeof params.value === "string" ? params.value : "";
    this.gui.replaceChildren();
    this.gui.className = "";
    if (!/^https?:\/\/\S+$/i.test(url)) {
      this.gui.textContent = params.valueFormatted ?? url;
      return;
    }
    const link = this.gui.ownerDocument.createElement("span");
    link.className = "ag-table-chart-link";
    link.textContent = params.valueFormatted ?? url;
    link.setAttribute("role", "link");
    link.tabIndex = 0;
    const open = (event) => {
      event.stopPropagation();
      params.context?.actions?.openUrl(url);
    };
    link.addEventListener("click", open);
    link.addEventListener("keydown", (event) => { if (event.key === "Enter") open(event); });
    this.gui.appendChild(link);
  }

  getGui() {
    return this.gui;
  }

  refresh(params) {
    this.update(params);
    return true;
  }
}

/** A cell that shows, for a moment after its value changed, an arrow and how much it moved. */
export class ChangeCell {
  init(params) {
    const doc = params.eGridCell?.ownerDocument ?? document;
    this.gui = doc.createElement("span");
    this.update(params);
  }

  update(params) {
    this.gui.replaceChildren();
    this.gui.append(params.valueFormatted ?? (params.value === null || params.value === undefined ? "" : String(params.value)));
    const delta = params.context?.deltas?.get(`${params.node?.id}|${params.field}`);
    if (typeof delta !== "number" || delta === 0) return;
    const mark = this.gui.ownerDocument.createElement("span");
    mark.className = `ag-table-chart-delta ag-table-chart-delta-${delta > 0 ? "up" : "down"}`;
    mark.textContent = `${delta > 0 ? "▲" : "▼"} ${params.format(delta, params.context)}`;
    this.gui.append(" ", mark);
  }

  getGui() {
    return this.gui;
  }

  refresh(params) {
    this.update(params);
    return true;
  }
}

const SUFFIXES = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

/**
 * A number written as text, as a report shows it: `$1,234.50`, `€12.5M`, `(1,200)`, `12.5%`,
 * `-3.2B`. The percent sign is dropped (12.5% reads 12.5). Null when it is not a number.
 */
export function numberLike(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  let text = value.trim().replace(/[$£€¥₹,\s]/g, "");
  let sign = 1;
  if (/^\(.*\)$/.test(text)) {
    sign = -1;
    text = text.slice(1, -1);
  }
  text = text.replace(/%$/, "");
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([KMBT])?$/i.exec(text);
  if (!match) return null;
  return sign * Number(match[1]) * (match[2] ? SUFFIXES[match[2].toUpperCase()] : 1);
}

function mostlyNumberLike(rows, field) {
  const texts = rows.slice(0, 200).map((r) => r?.[field]).filter((v) => typeof v === "string" && v.trim() !== "");
  return texts.length > 0 && texts.filter((v) => numberLike(v) !== null).length * 2 > texts.length;
}

/** One OpenBQ column definition as an AG Grid ColDef. */
export function toColDef(def, rows, table = {}) {
  const field = def.field;
  const fns = renderFnsOf(def);
  const p = def.renderFnParams ?? {};
  const type = dataTypeOf(def, rows);
  const formatterFn = def.formatterFn ?? table.formatterFn;
  const isDate = type === "date" || type === "dateString" || def.chartDataType === "time";
  const hoverCard = fns.includes("hoverCard");
  const cellField = p.hoverCard?.cellField;
  const emptyValue = typeof table.emptyValue === "string" ? table.emptyValue : undefined;

  const col = {
    field,
    colId: field,
    headerName: def.headerName ?? headerFromField(field),
    // The Advanced Filter takes its operators from cellDataType: "number" gives
    // greater than / less than, "text" gives contains / begins with. Dates, booleans
    // and objects keep false, so AG Grid adds no renderer, parser or check of its own.
    cellDataType: type === "number" ? "number" : type === "text" && !isDate ? "text" : false,
  };
  for (const key of ["headerTooltip", "width", "minWidth", "maxWidth", "hide", "pinned", "chartDataType", "calculatedExpression", "rowGroup", "rowGroupIndex", "pivot", "aggFunc"]) {
    if (def[key] !== undefined) col[key] = def[key];
  }
  if (typeof def.width === "number") col.flex = 0;

  if (def.sparkline) {
    const dataField = def.sparkline.dataField;
    const keys = { xKey: def.sparkline.options?.xKey, yKey: def.sparkline.options?.yKey };
    col.valueGetter = (params) => sparklinePoints(params.data ? params.data[dataField ?? field] : undefined, keys);
    col.cellRenderer = "agSparklineCellRenderer";
    col.cellRendererParams = { sparklineOptions: sparklineOptions(def.sparkline) };
    col.sortable = false;
    col.filter = false;
    col.chartDataType = "excluded";
    return col;
  }

  if (isDate) {
    col.valueGetter = (params) => toDate(params.data ? cellValueOf(params.data[field], cellField) : undefined);
    col.filter = "agDateColumnFilter";
    col.filterParams = { comparator: dateComparator };
  } else if (type === "object" || hoverCard) {
    col.valueGetter = (params) => cellValueOf(params.data ? params.data[field] : undefined, cellField);
  }
  if (type === "number") {
    col.filter = "agNumberColumnFilter";
    col.type = "numericColumn";
  } else if (!isDate) {
    col.filter = "agTextColumnFilter";
  }

  col.valueFormatter = (params) => {
    let value = params.value;
    if (value instanceof Date) {
      if (formatterFn === "dateToYear") return yearOf(value) ?? "";
      const original = params.data ? cellValueOf(params.data[field], cellField) : value;
      value = original instanceof Date ? original.toISOString().slice(0, 10) : dateText(original);
      return formatValue(value, { prefix: def.prefix, suffix: def.suffix });
    }
    if (typeof value === "boolean") value = String(value);
    if (Array.isArray(value)) value = value.join(", ");
    let text = formatValue(value, {
      formatterFn,
      decimalPlaces: def.decimalPlaces,
      prefix: def.prefix,
      suffix: def.suffix,
      locale: params.context?.locale,
      decimals: params.context?.decimals,
      abbreviate: params.context?.abbreviate === true,
      emptyValue: emptyValue ?? params.context?.emptyValue,
    });
    if (fns.includes("titleCase")) text = titleCase(text);
    return typeof value === "string" ? clipped(text) : text;
  };

  if (def.chartDataType === "series" && type === "text" && !isDate && !hoverCard && mostlyNumberLike(rows, field)) {
    col.valueGetter = (params) => numberLike(params.data?.[field]);
    col.valueFormatter = (params) => {
      const raw = params.data?.[field];
      return raw === null || raw === undefined || raw === "" ? (emptyValue ?? params.context?.emptyValue ?? "") : String(raw);
    };
    col.filter = "agNumberColumnFilter";
    col.cellDataType = "number";
    col.type = "numericColumn";
  }

  if (!hasCardOf(def, fns)) {
    col.tooltipValueGetter = (params) => tooltipTextOf(params, col);
  }
  if (type === "text" && !isDate && !fns.includes("cellOnClick") && looksLikeLinks(rows, field)) {
    col.cellRenderer = LinkCell;
  } else if (fns.includes("showCellChange") && def.enableCellChangeWs !== false) {
    col.cellRenderer = ChangeCell;
    col.cellRendererParams = { field, format: (delta, context) => formatValue(Math.abs(delta), { formatterFn: formatterFn === "compact" ? undefined : formatterFn, decimalPlaces: def.decimalPlaces, locale: context?.locale, decimals: context?.decimals }) };
  }

  const align = def.align;
  if (align) {
    col.headerClass = `ag-table-chart-header-${align}`;
    col.type = undefined;
  }
  const colorField = p.colorValueKey;
  const colors = fns.includes("columnColor") || fns.includes("greenRed");
  if (align || colors) {
    col.cellStyle = (params) => {
      const style = { color: null, backgroundColor: null };
      if (align) style.textAlign = align;
      const value = colorField && params.data ? cellValueOf(params.data[colorField]) : params.value;
      let color = null;
      if (fns.includes("columnColor")) color = Array.isArray(p.colorRules) && p.colorRules.length ? columnColorStyle(p.colorRules, value) : greenRedStyle(value);
      if (!color && fns.includes("greenRed")) color = greenRedStyle(value);
      return { ...style, ...(color ?? {}) };
    };
  }

  const classRules = {};
  if (fns.includes("cellOnClick")) {
    col.onCellClicked = (params) => onCellClick(def, params);
    classRules["ag-table-chart-clickable"] = () => true;
  }
  if (fns.includes("showCellChange") && def.enableCellChangeWs !== false) {
    classRules["ag-table-chart-cell-up"] = (params) => params.context?.changes?.get(`${params.node?.id}|${field}`) === "up";
    classRules["ag-table-chart-cell-down"] = (params) => params.context?.changes?.get(`${params.node?.id}|${field}`) === "down";
  }
  const hasCard = hasCardOf(def, fns);
  if (hasCard) classRules["ag-table-chart-has-card"] = () => true;
  if (Object.keys(classRules).length) col.cellClassRules = classRules;

  if (hasCard) {
    col.tooltipValueGetter = () => "hover card";
    col.tooltipComponent = HoverCardTooltip;
    col.tooltipComponentParams = { hoverCard: p.hoverCard ?? {}, hoverCardData: p.hoverCardData };
  }
  return col;
}

/** The columns whose changes flash, and the field whose change decides the colour. */
export function changeTrackedColumns(columnsDefs) {
  return (Array.isArray(columnsDefs) ? columnsDefs : [])
    .filter((def) => renderFnsOf(def).includes("showCellChange") && def.enableCellChangeWs !== false)
    .map((def) => ({ field: def.field, compareField: def.renderFnParams?.colorValueKey ?? def.field }));
}

/**
 * The AG Grid column definitions for rows and an OpenBQ table configuration. With `showAll`
 * (the default), fields the rows have and `columnsDefs` does not are shown too.
 */
export function agTableChartColumnDefs(rows, table = {}) {
  const defs = Array.isArray(table.columnsDefs) ? table.columnsDefs.filter((d) => d && d.field) : [];
  const declared = new Set(defs.map((d) => d.field));
  const extra = table.showAll === false && defs.length ? [] : fieldsOf(rows).filter((f) => !declared.has(f));
  return [...defs, ...extra.map((field) => ({ field }))].map((def) => toColDef(def, rows, table));
}

/** True when most of a row's values over `columns` are numbers: the row charts as a series once transposed. */
function mostlyNumbers(columns, row) {
  if (!columns.length) return false;
  const numbers = columns.filter((source) => {
    const value = source.valueGetter ? source.valueGetter({ data: row }) : row?.[source.field];
    return typeof value === "number" && Number.isFinite(value);
  }).length;
  return numbers * 2 > columns.length;
}

/**
 * Swaps rows and columns: one row per column, one column per row, headed by the row's first
 * column. Each cell keeps the formatting and styles of the column it came from.
 */
export function transpose(rows, colDefs) {
  const visible = colDefs.filter((c) => !c.hide);
  if (!visible.length) return { rowData: [], columnDefs: [] };
  const [head, ...rest] = visible;
  const headerOf = (row, i) => {
    const value = head.valueGetter ? head.valueGetter({ data: row }) : row?.[head.field];
    const text = head.valueFormatter ? head.valueFormatter({ value, data: row, context: {} }) : value;
    return text === "" || text === null || text === undefined ? `Row ${i + 1}` : String(text);
  };
  const columnDefs = [
    { field: "__field", colId: "__field", headerName: head.headerName ?? "", pinned: "left", cellDataType: false, chartDataType: "category" },
    ...rows.map((row, i) => ({
      colId: `__r${i}`,
      headerName: headerOf(row, i),
      cellDataType: false,
      ...(mostlyNumbers(rest, row) ? { chartDataType: "series" } : {}),
      valueGetter: (params) => {
        const source = rest[params.data?.__col];
        return source?.valueGetter ? source.valueGetter({ ...params, data: row }) : row?.[source?.field];
      },
      valueFormatter: (params) => {
        const source = rest[params.data?.__col];
        return source?.valueFormatter ? source.valueFormatter({ ...params, data: row }) : params.value;
      },
      cellStyle: (params) => {
        const source = rest[params.data?.__col];
        return typeof source?.cellStyle === "function" ? source.cellStyle({ ...params, data: row }) : null;
      },
    })),
  ];
  const rowData = rest.map((col, i) => ({ __field: col.headerName ?? col.field, __col: i }));
  return { rowData, columnDefs };
}
