/*
 * Query parameters of the SQL widget: `{{name}}` placeholders in a query, each defined by the user
 * (a type, a label, a default and, for a list, its options) and given a value in the card. Before
 * the query goes to the backend, each placeholder becomes a SQL literal of its value: a text is
 * quoted with its quotes doubled, a number must be a number, a date must be a date, and a list of
 * several values becomes 'a', 'b'. The definitions and values are saved with the card.
 */

export const PARAM_TYPES = ["text", "number", "date", "boolean", "list"];
export const MAX_SQL_PARAMS = 20;
export const MAX_PARAM_TEXT = 500;
export const MAX_PARAM_OPTIONS = 100;

const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** The names of the `{{name}}` placeholders of a query, each once, in order. */
export function placeholdersOf(sql) {
  return [...new Set([...String(sql ?? "").matchAll(PLACEHOLDER)].map((m) => m[1]))];
}

function text(value, max = MAX_PARAM_TEXT) {
  return typeof value === "string" ? value.slice(0, max) : value === undefined || value === null ? "" : String(value).slice(0, max);
}

/** The parameter definitions saved with a card, kept only when well formed. */
export function savedSqlParams(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const p of list) {
    if (!p || typeof p !== "object" || !NAME.test(p.name ?? "") || seen.has(p.name) || !PARAM_TYPES.includes(p.type)) continue;
    seen.add(p.name);
    out.push({
      name: p.name,
      label: text(p.label, 100) || p.name,
      type: p.type,
      multiple: p.type === "list" && p.multiple === true,
      options: p.type === "list" && Array.isArray(p.options) ? p.options.map((o) => text(o, 200)).filter(Boolean).slice(0, MAX_PARAM_OPTIONS) : [],
      default: p.type === "boolean" ? p.default === true : text(p.default),
    });
    if (out.length >= MAX_SQL_PARAMS) break;
  }
  return out;
}

const quoted = (value) => `'${String(value).replaceAll("'", "''")}'`;

/** One value as a SQL literal, or { error } when it is not a value of its type. */
export function sqlLiteral(def, value) {
  switch (def.type) {
    case "number": {
      const n = typeof value === "number" ? value : Number(String(value ?? "").trim());
      if (String(value ?? "").trim() === "" || !Number.isFinite(n)) return { error: `${def.label} needs a number.` };
      return { literal: String(n) };
    }
    case "date": {
      const v = String(value ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())) return { error: `${def.label} needs a date, as YYYY-MM-DD.` };
      return { literal: quoted(v) };
    }
    case "boolean":
      return { literal: value === true || value === "true" ? "TRUE" : "FALSE" };
    case "list": {
      const values = (Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value]).map((v) => String(v));
      if (!values.length) return { error: `${def.label} needs a value.` };
      if (def.options.length && values.some((v) => !def.options.includes(v))) return { error: `${def.label} takes only its listed options.` };
      return { literal: (def.multiple ? values : values.slice(0, 1)).map(quoted).join(", ") };
    }
    default:
      return { literal: quoted(text(value)) };
  }
}

/**
 * The query with every placeholder replaced by its value's literal. Returns { sql, missing,
 * errors }: `missing` names placeholders with no definition, and `errors` says which values do
 * not fit; the query should not run while either has entries.
 */
export function substitute(sql, defs, values = {}) {
  const byName = new Map(defs.map((d) => [d.name, d]));
  const missing = [];
  const errors = [];
  const out = String(sql ?? "").replace(PLACEHOLDER, (whole, name) => {
    const def = byName.get(name);
    if (!def) {
      if (!missing.includes(name)) missing.push(name);
      return whole;
    }
    const value = Object.hasOwn(values, name) ? values[name] : def.type === "list" && def.multiple ? (def.default ? def.default.split(",").map((v) => v.trim()) : []) : def.default;
    const { literal, error } = sqlLiteral(def, value);
    if (error) {
      if (!errors.includes(error)) errors.push(error);
      return whole;
    }
    return literal;
  });
  return { sql: out, missing, errors };
}

/** The values saved with a card, for the parameters it defines. */
export function savedSqlValues(values, defs) {
  if (!values || typeof values !== "object") return {};
  const out = {};
  for (const def of defs) {
    if (!Object.hasOwn(values, def.name)) continue;
    const v = values[def.name];
    out[def.name] = Array.isArray(v) ? v.map((x) => text(x, 200)).slice(0, MAX_PARAM_OPTIONS) : typeof v === "boolean" ? v : text(v);
  }
  return out;
}
