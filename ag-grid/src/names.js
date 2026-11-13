/*
 * Names for the widgets the plugin adds to a dashboard, made from what they hold: a chart from its
 * series and category, a file from its name, a query from the table it reads. No AI is involved.
 */

export const MAX_NAME = 80;

const clean = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
const cut = (text) => (text.length > MAX_NAME ? `${text.slice(0, MAX_NAME - 1).trimEnd()}…` : text);

/** "Revenue and Cost by Quarter", from the column definitions the chart widget holds. */
export function chartName(columnDefs) {
  const category = columnDefs.find((c) => c.chartDataType === "category" || c.chartDataType === "time");
  const series = columnDefs.filter((c) => c !== category).map((c) => clean(c.headerName || c.field)).filter(Boolean);
  if (!series.length) return "Chart";
  const values = series.length <= 2 ? series.join(" and ") : `${series.slice(0, 2).join(", ")} and ${series.length - 2} more`;
  return cut(category ? `${values} by ${clean(category.headerName || category.field)}` : values);
}

/** "positions" from "positions.xlsx" (and the sheet, when there are several). */
export function fileName(name, sheet) {
  const base = clean(String(name ?? "").replace(/\.[a-z0-9]{1,8}$/i, "")) || "File";
  return cut(sheet ? `${base} (${clean(sheet)})` : base);
}

/** "trades query" from "SELECT ... FROM trades ..."; "Query result" when no table is named. */
export function queryName(sql) {
  const table = /\bfrom\s+((?:"[^"]+"|[\w$]+)(?:\.(?:"[^"]+"|[\w$]+))?)/i.exec(String(sql ?? ""))?.[1];
  return cut(table ? `${table.replace(/"/g, "")} query` : "Query result");
}
