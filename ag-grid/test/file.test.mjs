import assert from "node:assert/strict";
import { test } from "node:test";

import { experimental, liveApi, makeModel, mount, notifications, settle } from "./dom.mjs";
import { workbook } from "./xlsx.mjs";
import plugin, { fileResult } from "../src/file.js";

async function render(values) {
  const model = makeModel(values);
  const { el, abort } = mount();
  const exposed = plugin.initialize({ model });
  await plugin.render({ model, el, signal: abort.signal, experimental });
  await settle(200);
  return { model, el, abort, exposed };
}

const base64 = (bytes) => btoa(String.fromCharCode(...bytes));

test("a workbook from the endpoint shows as a table, and its sheets can be picked and are remembered", async () => {
  const bytes = await workbook();
  const { model, el, abort, exposed } = await render({ data: { file: { name: "book.xlsx", base64: base64(bytes) } } });
  try {
    const api = await liveApi(el);
    assert.equal(el.querySelector(".ag-file-name").textContent, "book.xlsx");
    assert.deepEqual(api.getColumns().map((c) => c.getColId()), ["desk", "qty", "traded", "total"]);
    assert.equal(api.getDisplayedRowCount(), 2);
    const picker = el.querySelector(".ag-file-sheet");
    assert.equal(picker.hidden, false);
    assert.deepEqual([...picker.options].map((o) => o.value), ["Trades", "Notes"]);
    picker.value = "Notes";
    picker.dispatchEvent(new Event("change"));
    await settle(300);
    assert.deepEqual(api.getColumns().map((c) => c.getColId()), ["note", "done"]);
    assert.equal(model.get("state").sheet, "Notes");
    assert.deepEqual(exposed.exportOptions().map((o) => o.id), ["csv", "xlsx"], "the table's exports");
    assert.ok(api.getGridOption("sideBar").toolPanels.some((p) => p.id === "formulas"), "the table's formulas");
  } finally {
    abort.abort();
    await settle(50);
  }
});

test("CSV text from the endpoint, a file dropped on the card, and a copy added as a table widget", async () => {
  const { model, el, abort } = await render({ data: { csv: "desk,qty\nFX,3\nRates,4\n" } });
  try {
    const api = await liveApi(el);
    assert.equal(api.getDisplayedRowCount(), 2);

    const file = new File(["symbol\tprice\nIBM\t101.5\n"], "prices.tsv", { type: "text/tab-separated-values" });
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    drop.dataTransfer = { files: [file], types: ["Files"] };
    el.querySelector(".ag-stack").dispatchEvent(drop);
    await settle(300);
    assert.deepEqual(api.getColumns().map((c) => c.getColId()), ["symbol", "price"]);
    assert.match(el.querySelector(".ag-file-name").textContent, /prices\.tsv \(from this computer, not saved\)/);

    notifications.length = 0;
    model.emit("msg:custom", { kind: "workspace-event", name: "action", id: "add-file-table" });
    await settle(100);
    const added = notifications.find(([name]) => name === "core:dashboard:add-widget");
    assert.equal(added?.[1].widget, "table");
    assert.deepEqual(added[1].data.rowData, [{ 0: "IBM", 1: 101.5 }]);
    assert.deepEqual(added[1].data.columnDefs.map((c) => c.headerName), ["symbol", "price"]);
  } finally {
    abort.abort();
    await settle(50);
  }
});

test("a file that cannot be read says why, and a card without data asks for one", async () => {
  const empty = await render({});
  try {
    assert.match(empty.el.querySelector(".ag-file-status").textContent, /Open a \.csv, \.tsv, \.json, \.xlsx or \.parquet file/);
  } finally {
    empty.abort.abort();
  }
  const old = await render({ data: { file: { name: "old.xls", base64: "AQID" } } });
  try {
    assert.match(old.el.querySelector(".ag-file-status").textContent, /saved as \.xlsx/);
  } finally {
    old.abort.abort();
    await settle(50);
  }
  assert.deepEqual(fileResult(["a", "b"], [{ a: 1 }]), { columns: [{ name: "a", type: "" }, { name: "b", type: "" }], rows: [[1, null]] });
});
