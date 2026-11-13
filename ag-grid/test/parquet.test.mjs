import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";

import "./dom.mjs";
import { kindOf, readFile } from "../src/files.js";
import { parquetRows } from "../src/sql/duckdb.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const duckdb = createRequire(import.meta.url)("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs");
const dist = join(root, "node_modules/@duckdb/duckdb-wasm/dist");
let database;
let parquet;

before(async () => {
  const db = await duckdb.createDuckDB(
    { mvp: { mainModule: join(dist, "duckdb-mvp.wasm") }, eh: { mainModule: join(dist, "duckdb-eh.wasm") } },
    new duckdb.VoidLogger(),
    duckdb.NODE_RUNTIME,
  );
  await db.instantiate();
  db.open({});
  database = { db, connection: db.connect() };
  const out = join(mkdtempSync(join(tmpdir(), "ag-grid-parquet-")), "trades.parquet");
  database.connection.query(
    `COPY (SELECT 'T' || i AS id, CASE WHEN i % 2 = 0 THEN 'FX' ELSE 'Rates' END AS desk, i * 1.5 AS price, (i * 1.5)::DOUBLE AS rate, i::BIGINT * 1000 AS qty, DATE '2024-03-01' + i::INTEGER AS traded, TIMESTAMP '2024-03-01 09:30:00' AS at FROM range(5) t(i)) TO '${out}' (FORMAT parquet)`,
  );
  parquet = new Uint8Array(readFileSync(out));
});

test("a Parquet file reads as rows: numbers, big integers, dates and timestamps", async () => {
  assert.equal(kindOf("a.parquet"), "parquet");
  const read = await parquetRows(database, parquet, 3);
  assert.deepEqual(read.columns, ["id", "desk", "price", "rate", "qty", "traded", "at"]);
  assert.equal(read.truncated, true);
  assert.deepEqual(read.rows[1], { id: "T1", desk: "Rates", price: 1.5, rate: 1.5, qty: 1000, traded: "2024-03-02", at: "2024-03-01 09:30:00" });
});

test("the file widget's reader takes Parquet through DuckDB, and says so when DuckDB is not there", async () => {
  const read = await readFile({ name: "trades.parquet", bytes: parquet }, { readParquet: (bytes, limit) => parquetRows(database, bytes, limit) });
  assert.equal(read.rows.length, 5);
  await assert.rejects(readFile({ name: "trades.parquet", bytes: parquet }), /Parquet/);
});
