import assert from "node:assert/strict";
import { test } from "node:test";

import { experimental, liveApi, makeModel, mount, notifications, settle } from "./dom.mjs";
import { contextMenuItems, selectionMarkdown } from "../src/grid.js";
import plugin from "../src/table.js";

async function render(values) {
  const model = makeModel(values);
  const { el, abort } = mount();
  const exposed = plugin.initialize({ model });
  await plugin.render({ model, el, signal: abort.signal, experimental });
  await settle(200);
  return { model, el, abort, exposed };
}

const data = [{ name: "Alpha", secret: "x", revenue: 100, cost: 60 }, { name: "Beta", secret: "y", revenue: 50, cost: 45 }];
const definition = { columnsDefs: [{ field: "name", headerName: "Name" }, { field: "secret", hide: true }, { field: "revenue", headerName: "Revenue" }, { field: "cost", headerName: "Cost" }] };

test("the AI agent reads the columns the user sees, formulas included, with their headers", async () => {
  const { el, abort, exposed } = await render({ data, definition, state: { formulas: [{ id: "f1", name: "Margin", formula: "[Revenue] - [Cost]" }] } });
  try {
    await liveApi(el);
    const ctx = exposed.copilotContext();
    assert.deepEqual(ctx.columns, ["name", "revenue", "cost", "formula_f1"]);
    assert.equal(ctx.hiddenColumns, 1);
    assert.equal(ctx.columnHeaders.formula_f1, "Margin");
    assert.deepEqual(ctx.rows[0], { name: "Alpha", revenue: 100, cost: 60, formula_f1: 40 });
    assert.ok(!JSON.stringify(ctx.rows).includes("secret"), "a hidden column's values stay out");
    assert.equal(ctx.stats.formula_f1.sum, 45);
    assert.deepEqual(ctx.formulas, [{ id: "f1", name: "Margin", formula: "[Revenue] - [Cost]" }]);
  } finally {
    abort.abort();
    await settle(50);
  }
});

test("the context menu asks the AI agent about the selected cells, and copies all rows, through the clipboard", async () => {
  const { el, abort } = await render({ data, definition });
  try {
    const api = await liveApi(el);
    api.addCellRange({ rowStartIndex: 0, rowEndIndex: 1, columns: ["name", "revenue"] });
    assert.equal(selectionMarkdown(api), "| Name | Revenue |\n| --- | --- |\n| Alpha | 100 |\n| Beta | 50 |");
    const items = contextMenuItems({ api, context: api.getGridOption("context"), defaultItems: ["copy"] });
    const names = items.map((i) => i.name ?? i);
    assert.deepEqual(names, ["copy", "separator", "Ask the AI agent about these cells", "Copy all rows"]);

    notifications.length = 0;
    items[2].action();
    await settle(50);
    const prompt = notifications.find(([name]) => name === "core:clipboard:write")?.[1].text;
    assert.match(prompt, /^Here are cells from a table on my dashboard:\n\n\| Name \| Revenue \|/);
    assert.ok(notifications.some(([name, msg]) => name === "core:ui:notify" && /Paste it into the AI agent/.test(msg.text)));

    notifications.length = 0;
    items[3].action();
    await settle(50);
    const rows = notifications.find(([name]) => name === "core:clipboard:write")?.[1].text;
    assert.equal(rows, "Name\tRevenue\tCost\nAlpha\t100\t60\nBeta\t50\t45");
  } finally {
    abort.abort();
    await settle(50);
  }
});

test("first-run tips cycle, Got it is saved with the card, and the admin setting turns them off", async () => {
  const first = await render({ data, definition });
  let saved;
  try {
    const strip = first.el.querySelector(".ag-grid-tips");
    assert.ok(strip, "the tips show on a new card");
    assert.match(strip.textContent, /^Tip 1 of 4: Select cells and right-click/);
    const [next, gotIt] = strip.querySelectorAll("button");
    next.click();
    assert.match(strip.textContent, /^Tip 2 of 4: Double-click a column header/);
    gotIt.click();
    assert.equal(first.el.querySelector(".ag-grid-tips"), null);
    await settle(50);
    saved = first.model.get("state");
    assert.equal(saved.tipsDone, true);
  } finally {
    first.abort.abort();
    await settle(50);
  }
  const again = await render({ data, definition, state: saved });
  try {
    assert.equal(again.el.querySelector(".ag-grid-tips"), null, "not again on the same card");
  } finally {
    again.abort.abort();
    await settle(50);
  }
  const off = await render({ data, definition, adminSettings: { showTips: false } });
  try {
    assert.equal(off.el.querySelector(".ag-grid-tips"), null);
  } finally {
    off.abort.abort();
    await settle(50);
  }
});

test("the admin setting allowExports: false takes every export away", async () => {
  const { el, abort, exposed } = await render({ data, definition, adminSettings: { allowExports: false } });
  try {
    const api = await liveApi(el);
    assert.deepEqual(exposed.exportOptions(), []);
    assert.equal(exposed.exportData("csv"), null);
    assert.equal(api.getGridOption("suppressCsvExport"), true);
    assert.equal(api.getGridOption("suppressExcelExport"), true);
  } finally {
    abort.abort();
    await settle(50);
  }
});
