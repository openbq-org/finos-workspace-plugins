import { AsyncDuckDB, getPlatformFeatures, VoidLogger } from "@duckdb/duckdb-wasm";
import { completerFor, EXTENSIONS } from "./completion.js";

export const WASM_ASSET = "assets/duckdb-eh.wasm";
export const WORKER_ASSET = "assets/duckdb-browser-eh.worker.js";
export const extensionAsset = (name) => `assets/${name}.duckdb_extension.wasm`;

export function bootstrap(workerUrl, extensionUrls) {
  return [
    `const packaged = ${JSON.stringify(extensionUrls)};`,
    "self.runtime = {",
    '  whereToLoad: (name) => packaged[String(name).split("/").pop().split(".")[0]] ?? "",',
    "};",
    `importScripts(${JSON.stringify(workerUrl)});`,
  ].join("\n");
}

let database = null;

/** DuckDB-WASM in a worker, from the package's own files, started once per frame. */
export function startDatabase(readAsset) {
  database ??= openDatabase(readAsset).catch((error) => {
    database = null;
    throw error;
  });
  return database;
}

export async function startCompleter(readAsset) {
  const { connection } = await startDatabase(readAsset);
  return completerFor(connection);
}

const typeName = (field) => String(field.type);
const isDate = (field) => /^Date/.test(typeName(field));
const isTimestamp = (field) => /^Timestamp/.test(typeName(field));

function plainValue(value, field) {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return Number.isSafeInteger(Number(value)) ? Number(value) : String(value);
  if (isDate(field) || isTimestamp(field)) {
    const date = new Date(typeof value === "bigint" ? Number(value) : value);
    if (Number.isNaN(date.getTime())) return null;
    const iso = date.toISOString();
    return isDate(field) || iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
  }
  if (/^Decimal/.test(typeName(field))) {
    const scaled = Number(String(value)) / 10 ** (field.type.scale ?? 0);
    return Number.isFinite(scaled) ? scaled : String(value);
  }
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

let fileCount = 0;

/**
 * The rows of a Parquet file, read by DuckDB: { columns, rows, truncated }, with dates as ISO
 * dates and big integers as numbers when they fit. Works with DuckDB's async and blocking APIs.
 */
export async function parquetRows({ db, connection }, bytes, limit) {
  const name = `opened-${++fileCount}.parquet`;
  await db.registerFileBuffer(name, bytes);
  try {
    const table = await connection.query(`SELECT * FROM read_parquet('${name}') LIMIT ${Math.trunc(limit) + 1}`);
    const fields = table.schema.fields;
    const rows = [];
    for (const row of table.toArray()) {
      if (rows.length > limit) break;
      rows.push(Object.fromEntries(fields.map((field) => [field.name, plainValue(row[field.name], field)])));
    }
    return { columns: fields.map((f) => f.name), rows: rows.slice(0, limit), truncated: rows.length > limit };
  } finally {
    await db.dropFile?.(name);
  }
}

async function openDatabase(readAsset) {
  const features = await getPlatformFeatures();
  if (!features.wasmExceptions) throw new Error("this browser has no WebAssembly exceptions");
  const [wasm, worker, ...extensions] = await Promise.all(
    [WASM_ASSET, WORKER_ASSET, ...EXTENSIONS.map(extensionAsset)].map(readAsset),
  );
  const urls = [];
  const blobUrl = (bytes, type) => {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    urls.push(url);
    return url;
  };
  const wasmUrl = blobUrl(wasm, "application/wasm");
  const extensionUrls = Object.fromEntries(
    EXTENSIONS.map((name, i) => [name, `${blobUrl(extensions[i], "application/wasm")}#/${name}.duckdb_extension.wasm`]),
  );
  const workerUrl = blobUrl(bootstrap(blobUrl(worker, "text/javascript"), extensionUrls), "text/javascript");
  try {
    const db = new AsyncDuckDB(new VoidLogger(), new Worker(workerUrl));
    await db.instantiate(wasmUrl);
    await db.open({});
    return { db, connection: await db.connect() };
  } finally {
    for (const url of urls) URL.revokeObjectURL(url);
  }
}
