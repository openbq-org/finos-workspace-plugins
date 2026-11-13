import assert from "node:assert/strict";
import { test } from "node:test";

import { experimental, liveApi, makeModel, mount, settle } from "./dom.mjs";
import { formulaColumnDefs, MAX_FORMULAS, newFormulaId, resolveFormula, savedFormulas } from "../src/formulas.js";
import plugin from "../src/table.js";

const columns = [{ colId: "revenue", label: "Revenue" }, { colId: "cost", label: "Cost of goods" }, { colId: "q1", label: "Q1" }];

test("a formula names columns by header or field, in any case", () => {
  assert.deepEqual(resolveFormula("[Revenue] - [cost of goods]", columns), { expression: "[revenue] - [cost]", error: null });
  assert.deepEqual(resolveFormula("ROUND([revenue] / [Q1], 2)", columns), { expression: "ROUND([revenue] / [q1], 2)", error: null });
  assert.match(resolveFormula("[Revenue] - [Tax]", columns).error, /Unknown column: Tax/);
  assert.match(resolveFormula("[Revenue] -", columns).error, /cannot be read/);
  assert.match(resolveFormula("", columns).error, /Write a formula/);
  assert.match(resolveFormula("[Margin] * 2", [...columns, { colId: "formula_f1", label: "Margin" }], { self: "formula_f1" }).error, /the formula itself/);
});

test("saved formulas are kept only when well formed, and new ids do not repeat", () => {
  const kept = savedFormulas([{ id: "f1", name: "Margin", formula: "[a] - [b]" }, { id: "BAD ID", name: "x", formula: "1" }, null, { id: "f2", name: 3, formula: "1" }]);
  assert.deepEqual(kept, [{ id: "f1", name: "Margin", formula: "[a] - [b]" }]);
  assert.equal(savedFormulas(Array.from({ length: 50 }, (_, i) => ({ id: `f${i}`, name: `n${i}`, formula: "1" }))).length, MAX_FORMULAS);
  assert.equal(newFormulaId([{ id: "f1" }, { id: "f2" }]), "f3");
  assert.equal(newFormulaId([{ id: "f3" }]), "f2");
});

test("formula columns are calculated, can use each other, and a broken one shows #ERROR", () => {
  const defs = formulaColumnDefs(
    [{ id: "f1", name: "Margin", formula: "[Revenue] - [Cost of goods]" }, { id: "f2", name: "Margin %", formula: "[Margin] / [Revenue]" }, { id: "f3", name: "Broken", formula: "[Gone] * 2" }],
    [{ field: "revenue", headerName: "Revenue" }, { field: "cost", headerName: "Cost of goods" }],
  );
  assert.deepEqual(defs.map((d) => [d.colId, d.headerName, d.calculatedExpression]), [
    ["formula_f1", "Margin", "[revenue] - [cost]"],
    ["formula_f2", "Margin %", "[formula_f1] / [revenue]"],
    ["formula_f3", "Broken", "1 / 0"],
  ]);
  assert.equal(defs[0].enableValue, true);
});

async function render(values) {
  const model = makeModel(values);
  const { el, abort } = mount();
  plugin.initialize({ model });
  await plugin.render({ model, el, signal: abort.signal, experimental });
  await settle();
  return { model, el, abort };
}

const data = [{ name: "A", revenue: 100, cost: 60 }, { name: "B", revenue: 50, cost: 45 }];
const definition = { columnsDefs: [{ field: "name", headerName: "Name" }, { field: "revenue", headerName: "Revenue" }, { field: "cost", headerName: "Cost" }] };

function fill(panel, name, formula) {
  const [nameInput] = panel.querySelectorAll("input.ag-grid-formulas-input");
  const text = panel.querySelector("textarea");
  nameInput.value = name;
  nameInput.dispatchEvent(new Event("input"));
  text.value = formula;
  text.dispatchEvent(new Event("input"));
}

test("the Formulas panel adds, edits and deletes a column, saved with the card", async () => {
  const first = await render({ data, definition });
  let saved;
  try {
    const api = await liveApi(first.el);
    api.openToolPanel("formulas");
    await settle();
    const panel = first.el.querySelector(".ag-grid-formulas");
    assert.ok(panel, "the panel shows");

    fill(panel, "Margin", "[Revenue] - [Tax]");
    assert.match(panel.querySelector(".ag-grid-formulas-message").textContent, /Unknown column: Tax/);
    assert.equal(panel.querySelector(".ag-grid-formulas-save").disabled, true);

    fill(panel, "Margin", "[Revenue] - [Cost]");
    assert.equal(panel.querySelector(".ag-grid-formulas-save").disabled, false);
    panel.querySelector("form").requestSubmit();
    await settle(200);
    const values = () => {
      const out = [];
      api.forEachNode((node) => out.push(api.getCellValue({ rowNode: node, colKey: "formula_f1" })));
      return out;
    };
    assert.deepEqual(values(), [40, 5]);
    assert.equal(api.getColumn("formula_f1").getColDef().headerName, "Margin");
    saved = first.model.get("state");
    assert.deepEqual(saved.formulas, [{ id: "f1", name: "Margin", formula: "[Revenue] - [Cost]" }]);

    const again = first.el.querySelector(".ag-grid-formulas");
    [...again.querySelectorAll(".ag-grid-formulas-button")].find((b) => b.textContent === "Edit").click();
    await settle();
    const editing = first.el.querySelector(".ag-grid-formulas");
    fill(editing, "Margin", "ROUND([Revenue] / [Cost], 2)");
    editing.querySelector("form").requestSubmit();
    await settle(200);
    assert.deepEqual(values(), [1.67, 1.11]);
  } finally {
    first.abort.abort();
    await settle(100);
  }

  const reopened = await render({ data, definition, state: saved });
  try {
    const api = await liveApi(reopened.el);
    assert.ok(api.getColumn("formula_f1"), "the formula column comes back with the card");
    api.openToolPanel("formulas");
    await settle();
    [...reopened.el.querySelectorAll(".ag-grid-formulas-button")].find((b) => b.textContent === "Delete").click();
    await settle(200);
    assert.equal(api.getColumn("formula_f1"), null);
    assert.deepEqual(reopened.model.get("state").formulas, []);
  } finally {
    reopened.abort.abort();
    await settle(100);
  }
});

test("enableFormulas: false leaves the Formulas panel out and keeps the others", async () => {
  const { el, abort } = await render({ data, definition: { ...definition, enableFormulas: false } });
  try {
    const api = await liveApi(el);
    assert.deepEqual(api.getGridOption("sideBar").toolPanels.map((p) => p.id ?? p), ["columns", "filters-new", "column-setup"]);
  } finally {
    abort.abort();
    await settle(100);
  }
});

test("column setup: kept only where it fits, and laid over the widget's columnsDefs", async () => {
  const { savedSetup, withColumnSetup } = await import("../src/columnSetup.js");
  assert.deepEqual(savedSetup({ a: { headerName: "A", formatterFn: "nope", decimalPlaces: 99, greenRed: true }, b: {} }), { a: { headerName: "A", greenRed: true } });
  const merged = withColumnSetup(
    { showAll: true, columnsDefs: [{ field: "x", headerName: "X", renderFn: ["titleCase", "greenRed"] }] },
    { x: { headerName: "Ex", greenRed: false }, y: { formatterFn: "compact", chartDataType: "series" } },
  );
  assert.deepEqual(merged.columnsDefs, [{ field: "x", headerName: "Ex", renderFn: "titleCase" }, { field: "y", formatterFn: "compact", chartDataType: "series" }]);
});

test("the Column setup panel renames and formats a column, and the card keeps it", async () => {
  const rows = [{ name: "A", revenue: 45e9 }, { name: "B", revenue: 12e6 }];
  const first = await render({ data: rows, definition: { columnsDefs: [{ field: "name" }, { field: "revenue", headerName: "Revenue" }] } });
  let saved;
  try {
    const api = await liveApi(first.el);
    api.openToolPanel("column-setup");
    await settle();
    const panel = first.el.querySelector(".ag-grid-setup");
    const box = [...panel.querySelectorAll(".ag-grid-setup-column")].find((b) => b.textContent.includes("revenue"));
    const header = box.querySelector('input[aria-label="Revenue: Header"]');
    header.value = "Sales";
    header.dispatchEvent(new Event("input"));
    const format = box.querySelector('select[aria-label="Revenue: format"]');
    format.value = "compact";
    format.dispatchEvent(new Event("change"));
    panel.querySelector(".ag-grid-setup-save").click();
    await settle(200);
    assert.equal(api.getColumn("revenue").getColDef().headerName, "Sales");
    assert.equal(api.getCellValue({ rowNode: api.getDisplayedRowAtIndex(0), colKey: "revenue", useFormatter: true }), "45.00B");
    saved = first.model.get("state");
    assert.deepEqual(saved.columnSetup, { revenue: { headerName: "Sales", formatterFn: "compact" } });
  } finally {
    first.abort.abort();
    await settle(100);
  }
  const again = await render({ data: rows, definition: { columnsDefs: [{ field: "name" }, { field: "revenue", headerName: "Revenue" }] }, state: saved });
  try {
    const api = await liveApi(again.el);
    assert.equal(api.getColumn("revenue").getColDef().headerName, "Sales", "the card keeps its setup");
    api.openToolPanel("column-setup");
    await settle();
    again.el.querySelector(".ag-grid-setup-reset").click();
    await settle(200);
    assert.equal(api.getColumn("revenue").getColDef().headerName, "Revenue");
  } finally {
    again.abort.abort();
    await settle(100);
  }
});
