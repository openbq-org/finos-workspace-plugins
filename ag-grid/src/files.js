/*
 * Reading a file into rows: CSV and TSV text, JSON, and Excel workbooks (.xlsx). An .xlsx file is
 * a zip of XML parts; it is read with the browser's own DecompressionStream and DOMParser, so the
 * package carries no spreadsheet library. Formulas show their last computed values, errors are
 * empty, and dates are ISO dates.
 */
import { rowsOf } from "./grid.js";

export const MAX_FILE_ROWS = 200_000;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/* ---------- values ---------- */

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** A text cell as the value it means: a number, true or false, null when empty, else the text. */
export function typed(text) {
  if (text === null || text === undefined) return null;
  const value = String(text).trim();
  if (value === "") return null;
  if (NUMBER.test(value) && !/^[+-]?0\d/.test(value)) return Number(value);
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === "true";
  return value;
}

/** Column names from a header row: trimmed, `Column N` for an empty one, and unique. */
export function headersOf(row) {
  const seen = new Map();
  return row.map((cell, i) => {
    let name = cell === null || cell === undefined || String(cell).trim() === "" ? `Column ${i + 1}` : String(cell).trim();
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    if (count) name = `${name} ${count + 1}`;
    return name;
  });
}

/**
 * Rows from a grid of cells: the header is the first row with more than one value, rows with no
 * value are dropped, and so are columns with no value at all.
 */
export function rowsFromGrid(grid) {
  const filled = (row) => row.filter((v) => v !== null && v !== undefined && v !== "").length;
  const headerAt = grid.findIndex((row) => filled(row) > 1);
  if (headerAt < 0) return { columns: [], rows: [] };
  const width = Math.max(...grid.slice(headerAt).map((row) => row.length));
  const header = headersOf(Array.from({ length: width }, (_, i) => grid[headerAt][i]));
  const body = grid.slice(headerAt + 1).filter((row) => filled(row) > 0);
  const used = header.map((_, i) => body.some((row) => row[i] !== null && row[i] !== undefined && row[i] !== ""));
  const columns = header.filter((_, i) => used[i]);
  const rows = body.slice(0, MAX_FILE_ROWS).map((row) => Object.fromEntries(header.flatMap((name, i) => (used[i] ? [[name, row[i] ?? null]] : []))));
  return { columns, rows, truncated: body.length > MAX_FILE_ROWS };
}

/* ---------- CSV and TSV ---------- */

/** The delimiter of a text table: the one of tab, comma and semicolon its first line has most of. */
export function delimiterOf(text) {
  const line = text.slice(0, text.search(/\r?\n|$/));
  const count = (ch) => line.split(ch).length - 1;
  return ["\t", ",", ";"].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ",");
}

/** Parses CSV or TSV text (quoted fields, doubled quotes, line breaks in quotes) into a grid of values. */
export function parseDelimited(text, delimiter = delimiterOf(text)) {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const grid = [];
  let row = [];
  let field = "";
  let quoted = false;
  let wasQuoted = false;
  const endField = () => {
    row.push(wasQuoted ? (field === "" ? null : field) : typed(field));
    field = "";
    wasQuoted = false;
  };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") {
      quoted = true;
      wasQuoted = true;
    } else if (ch === delimiter) {
      endField();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      endField();
      grid.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) {
    endField();
    grid.push(row);
  }
  return grid;
}

/* ---------- JSON ---------- */

function pathOf(value, path) {
  return String(path).split(".").reduce((node, key) => (node && typeof node === "object" ? node[key] : undefined), value);
}

/** Rows from JSON: a list of records, the list at `dataKey`, any shape the table widget reads, or one record. */
export function rowsFromJson(value, dataKey) {
  const target = dataKey ? pathOf(value, dataKey) : value;
  const rows = rowsOf(target);
  if (rows.length) return rows;
  return target && typeof target === "object" && !Array.isArray(target) ? [target] : [];
}

/* ---------- XLSX ---------- */

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The files of a zip archive, as name → () => Promise<Uint8Array>. */
export function unzip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("The file is not an .xlsx workbook (no zip directory).");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = new Map();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("The workbook's zip directory is damaged.");
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    files.set(name, async () => {
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return inflate(data);
      throw new Error(`The workbook uses a zip compression this reader does not know (${method}).`);
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function xml(text) {
  return new DOMParser().parseFromString(text, "application/xml");
}

const all = (node, name) => [...node.getElementsByTagNameNS("*", name)];
const first = (node, name) => node.getElementsByTagNameNS("*", name)[0] ?? null;
const attr = (node, name) => node.getAttribute(name) ?? [...node.attributes].find((a) => a.localName === name)?.value ?? null;

const BUILT_IN_DATES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function isDateFormat(code) {
  const plain = String(code ?? "").replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
  return /[dmyhs]/i.test(plain) && !/^general$/i.test(plain.trim());
}

/** An Excel date serial as an ISO date, with the time when it has one. */
export function excelDate(serial) {
  const ms = Math.round((serial - 25569) * 86_400_000);
  const iso = new Date(ms).toISOString();
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

function columnIndex(ref) {
  const letters = /^[A-Z]+/i.exec(ref ?? "")?.[0].toUpperCase() ?? "";
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}

/**
 * Opens an .xlsx workbook: { sheets, read(name) }, where `read` gives a sheet's grid of values.
 */
export async function openWorkbook(buffer) {
  const files = unzip(buffer);
  const text = async (name) => {
    const get = files.get(name);
    return get ? new TextDecoder().decode(await get()) : null;
  };
  const workbook = await text("xl/workbook.xml");
  if (!workbook) throw new Error("The file is not an .xlsx workbook (no xl/workbook.xml). An .xls file needs to be saved as .xlsx first.");
  const rels = xml((await text("xl/_rels/workbook.xml.rels")) ?? "<Relationships/>");
  const targets = new Map(all(rels, "Relationship").map((r) => [attr(r, "Id"), attr(r, "Target")]));
  const sheets = all(xml(workbook), "sheet").map((s) => {
    const target = String(targets.get(attr(s, "id")) ?? "");
    return { name: attr(s, "name"), path: target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}` };
  });

  const shared = all(xml((await text("xl/sharedStrings.xml")) ?? "<sst/>"), "si").map((si) => all(si, "t").map((t) => t.textContent).join(""));
  const styles = xml((await text("xl/styles.xml")) ?? "<styleSheet/>");
  const custom = new Map(all(styles, "numFmt").map((f) => [Number(attr(f, "numFmtId")), attr(f, "formatCode")]));
  const xfs = first(styles, "cellXfs");
  const dateStyles = (xfs ? all(xfs, "xf") : []).map((xf) => {
    const id = Number(attr(xf, "numFmtId") ?? 0);
    return BUILT_IN_DATES.has(id) || (custom.has(id) && isDateFormat(custom.get(id)));
  });

  const read = async (name) => {
    const sheet = sheets.find((s) => s.name === name) ?? sheets[0];
    if (!sheet) return [];
    const doc = xml((await text(sheet.path)) ?? "<worksheet/>");
    const grid = [];
    for (const row of all(doc, "row")) {
      const r = Number(attr(row, "r") ?? grid.length + 1) - 1;
      const cells = [];
      all(row, "c").forEach((c, i) => {
        const col = attr(c, "r") ? columnIndex(attr(c, "r")) : i;
        const type = attr(c, "t");
        const raw = first(c, "v")?.textContent ?? null;
        let value = null;
        if (type === "s") value = raw === null ? null : shared[Number(raw)] ?? null;
        else if (type === "inlineStr") value = all(c, "t").map((t) => t.textContent).join("");
        else if (type === "b") value = raw === "1";
        else if (type === "e") value = null;
        else if (type === "str" || type === "d") value = raw;
        else if (raw !== null && raw !== "") {
          const n = Number(raw);
          value = Number.isFinite(n) && dateStyles[Number(attr(c, "s") ?? 0)] ? excelDate(n) : Number.isFinite(n) ? n : raw;
        }
        cells[col] = typeof value === "string" && value.trim() === "" ? null : value;
      });
      grid[r] = Array.from({ length: cells.length }, (_, i) => cells[i] ?? null);
    }
    return Array.from({ length: grid.length }, (_, i) => grid[i] ?? []);
  };

  return { sheets: sheets.map((s) => s.name), read };
}

/* ---------- any file ---------- */

export function kindOf(name, mime = "") {
  const ext = /\.([a-z0-9]+)$/i.exec(String(name ?? ""))?.[1]?.toLowerCase() ?? "";
  if (ext === "xlsx" || /spreadsheetml/.test(mime)) return "xlsx";
  if (ext === "xls") return "xls";
  if (ext === "json" || /json/.test(mime)) return "json";
  if (ext === "tsv" || /tab-separated/.test(mime)) return "tsv";
  if (ext === "csv" || ext === "txt" || /csv|text\/plain/.test(mime)) return "csv";
  return ext ? "unknown" : "csv";
}

export function bytesOfBase64(base64) {
  const binary = atob(String(base64).replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Reads a file into { columns, rows, sheets, sheet, truncated }. `file` is { name, mime, bytes }
 * or { name, mime, text }. For a workbook, `sheet` picks the sheet (the first by default).
 */
export async function readFile(file, { sheet, dataKey } = {}) {
  const kind = kindOf(file.name, file.mime);
  const size = file.bytes?.byteLength ?? file.text?.length ?? 0;
  if (size > MAX_FILE_BYTES) throw new Error(`The file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  if (kind === "xls") throw new Error("An .xls workbook needs to be saved as .xlsx first.");
  if (kind === "unknown") throw new Error("Open a .csv, .tsv, .json or .xlsx file.");
  if (kind === "xlsx") {
    if (!file.bytes) throw new Error("The workbook came as text; send it as base64.");
    const book = await openWorkbook(file.bytes);
    const name = book.sheets.includes(sheet) ? sheet : book.sheets[0];
    return { ...rowsFromGrid(await book.read(name)), sheets: book.sheets, sheet: name };
  }
  const text = file.text ?? new TextDecoder().decode(file.bytes);
  if (kind === "json") {
    let value;
    try {
      value = JSON.parse(text);
    } catch (error) {
      throw new Error(`The JSON could not be read: ${error.message}`);
    }
    const rows = rowsFromJson(value, dataKey);
    return { columns: [...new Set(rows.flatMap((r) => Object.keys(r ?? {})))], rows: rows.slice(0, MAX_FILE_ROWS), truncated: rows.length > MAX_FILE_ROWS, sheets: [], sheet: null };
  }
  return { ...rowsFromGrid(parseDelimited(text, kind === "tsv" ? "\t" : delimiterOf(text))), sheets: [], sheet: null };
}

/** The file an endpoint's JSON answer carries: { file: { name, base64 | text } }, { csv }, or null. */
export function fileOfAnswer(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const f = data.file;
  if (f && typeof f === "object") {
    if (typeof f.base64 === "string") return { name: String(f.name ?? "file"), mime: String(f.mime ?? ""), bytes: bytesOfBase64(f.base64) };
    if (typeof f.text === "string") return { name: String(f.name ?? "file.csv"), mime: String(f.mime ?? ""), text: f.text };
  }
  if (typeof data.csv === "string") return { name: "data.csv", mime: "text/csv", text: data.csv };
  if (typeof data.tsv === "string") return { name: "data.tsv", mime: "text/tab-separated-values", text: data.tsv };
  return null;
}
