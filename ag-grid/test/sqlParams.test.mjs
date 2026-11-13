import assert from "node:assert/strict";
import { test } from "node:test";

import { placeholdersOf, savedSqlParams, savedSqlValues, sqlLiteral, substitute } from "../src/sqlParams.js";

const defs = savedSqlParams([
  { name: "desk", type: "text", label: "Desk", default: "FX" },
  { name: "min_qty", type: "number", label: "Minimum quantity", default: "100" },
  { name: "from", type: "date", label: "From", default: "2024-01-01" },
  { name: "live", type: "boolean", default: true },
  { name: "regions", type: "list", label: "Regions", multiple: true, options: ["EU", "US", "APAC"], default: "EU, US" },
]);

test("placeholders are found once each, in order", () => {
  assert.deepEqual(placeholdersOf("select * from t where a = {{ desk }} and b > {{min_qty}} or a = {{desk}}"), ["desk", "min_qty"]);
  assert.deepEqual(placeholdersOf("select 1"), []);
});

test("only well formed definitions are kept", () => {
  assert.deepEqual(defs.map((d) => [d.name, d.type]), [["desk", "text"], ["min_qty", "number"], ["from", "date"], ["live", "boolean"], ["regions", "list"]]);
  assert.equal(savedSqlParams([{ name: "1bad", type: "text" }, { name: "ok", type: "nope" }, { name: "dup", type: "text" }, { name: "dup", type: "number" }]).length, 1);
});

test("each value becomes a SQL literal, and a text cannot break out of its quotes", () => {
  assert.deepEqual(sqlLiteral(defs[0], "O'Brien'; drop table t; --"), { literal: "'O''Brien''; drop table t; --'" });
  assert.deepEqual(sqlLiteral(defs[1], "12.5"), { literal: "12.5" });
  assert.match(sqlLiteral(defs[1], "1 or 1=1").error, /needs a number/);
  assert.match(sqlLiteral(defs[2], "2024-13-45").error, /needs a date/);
  assert.match(sqlLiteral(defs[2], "2024-01-01' or '1'='1").error, /needs a date/);
  assert.deepEqual(sqlLiteral(defs[3], true), { literal: "TRUE" });
  assert.deepEqual(sqlLiteral(defs[4], ["EU", "APAC"]), { literal: "'EU', 'APAC'" });
  assert.match(sqlLiteral(defs[4], ["Mars"]).error, /listed options/);
});

test("a query is filled from the card's values, then the defaults", () => {
  const sql = "select * from trades where desk = {{desk}} and qty >= {{min_qty}} and day >= {{from}} and live = {{live}} and region in ({{regions}})";
  assert.deepEqual(substitute(sql, defs), {
    sql: "select * from trades where desk = 'FX' and qty >= 100 and day >= '2024-01-01' and live = TRUE and region in ('EU', 'US')",
    missing: [],
    errors: [],
  });
  assert.equal(substitute(sql, defs, { desk: "Rates", regions: ["APAC"] }).sql.includes("desk = 'Rates'") && substitute(sql, defs, { regions: ["APAC"] }).sql.endsWith("('APAC')"), true);
  const broken = substitute("select {{nope}}, {{min_qty}}", defs, { min_qty: "x" });
  assert.deepEqual(broken.missing, ["nope"]);
  assert.match(broken.errors[0], /Minimum quantity needs a number/);
});

test("saved values are kept for defined parameters only", () => {
  assert.deepEqual(savedSqlValues({ desk: "Rates", other: 1, regions: ["EU"] }, defs), { desk: "Rates", regions: ["EU"] });
});
