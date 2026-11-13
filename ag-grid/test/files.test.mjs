import assert from "node:assert/strict";
import { test } from "node:test";

import "./dom.mjs";
import { workbook } from "./xlsx.mjs";
import { delimiterOf, excelDate, fileOfAnswer, headersOf, kindOf, openWorkbook, parseDelimited, readFile, rowsFromGrid, rowsFromJson, typed } from "../src/files.js";

test("text cells become values", () => {
  assert.deepEqual(["12", "-3.5", "1e3", "007", "TRUE", "", " x "].map(typed), [12, -3.5, 1000, "007", true, null, "x"]);
});

test("CSV and TSV: quotes, doubled quotes, line breaks in quotes, a BOM and the delimiter", () => {
  const csv = '﻿name,note,qty\r\n"Smith, J","said ""hi""\nthen left",3\nLee,,4\n';
  assert.equal(delimiterOf("a\tb\tc\n1\t2\t3"), "\t");
  assert.equal(delimiterOf("a;b;c"), ";");
  assert.deepEqual(parseDelimited(csv), [["name", "note", "qty"], ["Smith, J", 'said "hi"\nthen left', 3], ["Lee", null, 4]]);
});

test("rows from a grid: the header row, unique names, and empty rows and columns dropped", () => {
  assert.deepEqual(headersOf(["a", "", "a", null]), ["a", "Column 2", "a 2", "Column 4"]);
  const { columns, rows } = rowsFromGrid([["Report"], [], ["desk", "qty", "empty"], ["FX", 1, null], [null, null, null], ["Rates", 2, null]]);
  assert.deepEqual(columns, ["desk", "qty"]);
  assert.deepEqual(rows, [{ desk: "FX", qty: 1 }, { desk: "Rates", qty: 2 }]);
});

test("JSON rows from a list, a key, a table shape or one record", () => {
  assert.deepEqual(rowsFromJson([{ a: 1 }]), [{ a: 1 }]);
  assert.deepEqual(rowsFromJson({ result: { items: [{ a: 2 }] } }, "result.items"), [{ a: 2 }]);
  assert.deepEqual(rowsFromJson({ columns: ["a"], data: [[3]] }), [{ a: 3 }]);
  assert.deepEqual(rowsFromJson({ a: 4 }), [{ a: 4 }]);
});

test("file kinds, Excel dates, and files carried in an answer", () => {
  assert.deepEqual(["a.xlsx", "a.xls", "a.json", "a.tsv", "a.csv", "a.pdf"].map((n) => kindOf(n)), ["xlsx", "xls", "json", "tsv", "csv", "unknown"]);
  assert.equal(excelDate(45292), "2024-01-01");
  assert.equal(excelDate(45292.5), "2024-01-01 12:00:00");
  assert.equal(fileOfAnswer({ csv: "a\n1" }).text, "a\n1");
  assert.deepEqual([...fileOfAnswer({ file: { name: "x.xlsx", base64: "AQID" } }).bytes], [1, 2, 3]);
  assert.equal(fileOfAnswer([{ a: 1 }]), null);
});

test("an .xlsx workbook: sheets, shared and inline strings, formula values, dates, errors", async () => {
  const bytes = await workbook();
  const book = await openWorkbook(bytes);
  assert.deepEqual(book.sheets, ["Trades", "Notes"]);
  const trades = await readFile({ name: "book.xlsx", bytes });
  assert.equal(trades.sheet, "Trades");
  assert.deepEqual(trades.columns, ["desk", "qty", "traded", "total"]);
  assert.deepEqual(trades.rows, [{ desk: "FX", qty: 40, traded: "2024-01-01", total: 80 }, { desk: "Rates", qty: 2.5, traded: null, total: null }]);
  const notes = await readFile({ name: "book.xlsx", bytes }, { sheet: "Notes" });
  assert.deepEqual(notes.rows, [{ note: "check", done: true }]);
  await assert.rejects(readFile({ name: "old.xls", bytes }), /saved as .xlsx/);
  await assert.rejects(readFile({ name: "x.xlsx", bytes: new Uint8Array([1, 2, 3]) }), /not an .xlsx/);
});
