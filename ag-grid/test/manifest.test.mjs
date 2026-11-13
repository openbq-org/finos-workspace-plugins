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
    assert.deepEqual(widget.settings.schema.properties.theme.enum, ["balham", "quartz", "alpine", "material", "compact"]);
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
  const icons = new Set(["chart", "columns", "download", "filter", "refresh", "sliders", "table"]);
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
      ...(id === "infinite" ? [] : [["advanced-filter", "navbar", "advancedFilter"]]),
      ...(id === "table" ? [["download-chart", "navbar", null]] : []),
      ["autosize", "menu", null],
      ["clear-filters", "menu", null],
      ["reset-columns", "menu", null],
      ...(["table", "streaming"].includes(id) ? [["transpose", "menu", null], ["reverse-columns", "menu", null]] : []),
      ...(id === "table" ? [["add-chart-widget", "menu", null]] : []),
    ]);
  }
  assert.ok(widgets.find((w) => w.id === "table").permissions.includes("core:download:save"));
  for (const widget of widgets) assert.ok(widget.actions.filter((a) => a.placement === "navbar").length <= 3, `${widget.id} has at most three card buttons`);
  const sql = widgets.find((w) => w.id === "sql");
  assert.deepEqual(sql.actions.map((a) => a.id), ["freeze"]);
  assert.ok(sql.permissions.includes("core:dashboard:add-widget"));
  assert.ok(widgets.find((w) => w.id === "table").permissions.includes("core:dashboard:add-widget"), "the table adds its chart as a widget");
  assert.ok(widgets.find((w) => w.id === "table").artifact);
});

test("the table configuration takes row groups, pivot and aggregation per column, and a starting layout", () => {
  for (const id of ["table", "streaming"]) {
    const definition = widgets.find((w) => w.id === id).handles[0].definition;
    const column = definition.$defs.column.properties;
    assert.equal(column.rowGroup.type, "boolean");
    assert.equal(column.pivot.type, "boolean");
    assert.deepEqual(column.aggFunc.enum, ["sum", "min", "max", "count", "avg", "first", "last"]);
    assert.equal(definition.properties.columnState.properties.default.$ref, "#/$defs/gridPreset");
    assert.equal(definition.properties.filterModel.$ref, "#/$defs/filterModel");
    assert.equal(definition.$defs.gridPreset.additionalProperties, false);
  }
});

/* Workspace's discovery lints each definition: closed objects (or typed maps), arrays with maxItems,
   strings with maxLength, an enum or a pattern, only known keywords, at most 8 levels deep and 64 KiB.
   The same rules here, so a version that Workspace would block fails before it is built. */
const KEYWORDS = new Set(["title", "description", "default", "examples", "type", "properties", "required", "additionalProperties", "items", "enum", "const", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "pattern", "minItems", "maxItems", "uniqueItems", "oneOf", "anyOf", "$defs", "$ref"]);

function typesOf(node) {
  if (typeof node.type === "string") return new Set([node.type]);
  if (Array.isArray(node.type)) return new Set(node.type);
  if (node.properties || node.additionalProperties) return new Set(["object"]);
  if (node.items) return new Set(["array"]);
  return new Set();
}

function lintFragment(schema) {
  const problems = [];
  if (JSON.stringify(schema).length > 64 * 1024) problems.push("larger than 64 KiB");
  const defs = schema.$defs ?? {};
  const check = (node, where, depth) => {
    if (depth > 8) return problems.push(`${where}: deeper than 8`);
    for (const key of Object.keys(node)) if (!KEYWORDS.has(key)) problems.push(`${where}: keyword ${key}`);
    if (node.$ref) {
      if (!node.$ref.startsWith("#/$defs/") || !Object.hasOwn(defs, node.$ref.slice(8))) problems.push(`${where}: $ref ${node.$ref}`);
      return;
    }
    for (const key of ["oneOf", "anyOf"]) (node[key] ?? []).forEach((option, i) => check(option, `${where}/${key}/${i}`, depth + 1));
    if (node.enum || node.const !== undefined) return;
    const types = typesOf(node);
    if (!types.size && !node.oneOf && !node.anyOf) problems.push(`${where}: no type`);
    if (types.has("object")) {
      if (node.additionalProperties !== false) {
        if (node.additionalProperties && typeof node.additionalProperties === "object") check(node.additionalProperties, `${where}/additionalProperties`, depth + 1);
        else problems.push(`${where}: not closed`);
      }
      for (const [name, child] of Object.entries(node.properties ?? {})) check(child, `${where}/properties/${name}`, depth + 1);
    }
    if (types.has("array")) {
      if (!Number.isInteger(node.maxItems)) problems.push(`${where}: array without maxItems`);
      if (node.items) check(node.items, `${where}/items`, depth + 1);
      else problems.push(`${where}: array without items`);
    }
    if (types.has("string") && !Number.isInteger(node.maxLength) && node.pattern === undefined) problems.push(`${where}: string without maxLength`);
  };
  for (const [name, def] of Object.entries(defs)) check(def, `/$defs/${name}`, 1);
  check(schema, "", 0);
  return problems;
}

test("every definition and artifact schema passes Workspace's fragment rules", () => {
  for (const widget of widgets) {
    for (const handle of widget.handles) if (handle.definition) assert.deepEqual(lintFragment(handle.definition), [], `${widget.id} definition`);
    if (widget.artifact) {
      assert.deepEqual(lintFragment(widget.artifact.data), [], `${widget.id} artifact`);
      assert.ok(widget.artifact.description.length <= 300, `${widget.id} artifact description is at most 300 characters`);
    }
  }
});

test("every icon the manifest names under assets/ is copied into the package", () => {
  const build = readFileSync(join(root, "build.mjs"), "utf8");
  const icons = new Set(widgets.flatMap((w) => (w.actions ?? []).map((a) => a.icon)).filter((icon) => icon.startsWith("assets/")));
  for (const icon of icons) assert.ok(build.includes(`"${icon}"`), `${icon} is not in build.mjs`);
});

test("every widget whose module offers exports has the permission the host needs to show them", async () => {
  for (const [id, module] of Object.entries(WIDGETS)) {
    const widget = widgets.find((w) => w.id === id);
    const exposed = module.initialize({ model: { get: () => undefined, on() {}, off() {} } });
    assert.equal(typeof exposed?.exportOptions === "function", widget.permissions.includes("core:export:provide"), `${id}: exports and core:export:provide go together`);
  }
});
