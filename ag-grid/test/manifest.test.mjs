import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import "./dom.mjs";
import { WIDGETS } from "../src/entry.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "src/plugin.json"), "utf8"));
const widgets = manifest.contributes.widgets;

test("the five widget types, each drawn by its own module", () => {
  assert.deepEqual(widgets.map((w) => [w.id, w.handles.map((h) => h.type)]), [
    ["table", ["aggrid-table"]],
    ["ssrm", ["aggrid-ssrm"]],
    ["infinite", ["aggrid-infinite"]],
    ["streaming", ["aggrid-streaming"]],
    ["sql", ["aggrid-sql"]],
  ]);
  assert.deepEqual(Object.keys(WIDGETS).sort(), widgets.map((w) => w.id).sort());
});

test("every widget reads its meta and data, writes params for the endpoint's body, and has a theme setting", () => {
  for (const widget of widgets) {
    assert.equal(widget.model.traits.meta.bind, "meta");
    assert.equal(widget.model.traits.params.access, "readwrite");
    assert.ok(widget.permissions.includes("core:data:read") && widget.permissions.includes("core:params:write"), widget.id);
    assert.deepEqual(widget.settings.schema.properties.theme.enum, ["balham", "quartz", "alpine", "material"]);
  }
  assert.equal(manifest.adminSettings.defaults.theme, "balham");
  for (const id of ["ssrm", "streaming"]) assert.ok(widgets.find((w) => w.id === id).permissions.includes("core:data:stream"));
});

test("table and streaming take the same table configuration, with grid events", () => {
  const table = widgets.find((w) => w.id === "table");
  const streaming = widgets.find((w) => w.id === "streaming");
  assert.deepEqual(table.handles[0].definition, streaming.handles[0].definition);
  assert.ok(table.handles[0].definition.properties.gridEvents.items.enum.includes("cellClicked"));
});

test("every skill is a markdown file under src/skills, and the artifact has a closed schema", () => {
  for (const skill of manifest.contributes.skills) {
    assert.match(skill.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(existsSync(join(root, "src", skill.file)), skill.file);
  }
  const artifacts = widgets.filter((w) => w.artifact);
  assert.deepEqual(artifacts.map((w) => w.id), ["table"]);
  assert.equal(artifacts[0].artifact.data.additionalProperties, false);
});

test("the grid widgets have the card's floating filters button and its two menu items, and the SQL widget creates a static table", () => {
  const icons = new Set(["filter", "refresh", "table"]);
  for (const widget of widgets) {
    const actions = widget.actions ?? [];
    const placed = (placement) => actions.some((a) => a.placement === placement);
    assert.equal(placed("navbar"), widget.permissions.includes("core:ui:button"), widget.id);
    assert.equal(placed("menu"), widget.permissions.includes("core:ui:menu"), widget.id);
    for (const action of actions) {
      assert.ok(icons.has(action.icon) || existsSync(join(root, "src", action.icon)), action.icon);
      if (action.toggles) assert.equal(widget.settings.schema.properties[action.toggles].type, "boolean");
    }
  }
  for (const id of ["table", "ssrm", "infinite", "streaming"]) {
    assert.deepEqual(widgets.find((w) => w.id === id).actions.map((a) => [a.id, a.placement, a.toggles ?? null]), [
      ["floating-filters", "navbar", "floatingFilters"],
      ["autosize", "menu", null],
      ["clear-filters", "menu", null],
    ]);
  }
  const sql = widgets.find((w) => w.id === "sql");
  assert.deepEqual(sql.actions.map((a) => a.id), ["freeze"]);
  assert.ok(sql.permissions.includes("core:dashboard:add-widget"));
  assert.ok(widgets.find((w) => w.id === "table").artifact);
});
