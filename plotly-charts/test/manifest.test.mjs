import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "src/plugin.json"), "utf8"));

test("every skill the manifest lists is a markdown file under src/skills, with a slug and a description", () => {
  const skills = manifest.contributes.skills;
  assert.ok(skills.length > 0);
  for (const skill of skills) {
    assert.match(skill.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(skill.description.length > 0 && skill.description.length <= 300);
    assert.match(skill.file, /^skills\/[A-Za-z0-9._-]+\.md$/);
    const path = join(root, "src", skill.file);
    assert.ok(existsSync(path), `${skill.file} is missing`);
    const text = readFileSync(path, "utf8");
    assert.ok(text.trim().length > 0 && Buffer.byteLength(text) <= 32 * 1024);
  }
});

test("a widget with an artifact reads its data and describes it with a closed schema", () => {
  const widgets = manifest.contributes.widgets.filter((widget) => widget.artifact);
  assert.ok(widgets.length > 0);
  for (const widget of widgets) {
    assert.ok(widget.permissions.includes("core:data:read"));
    assert.equal(widget.artifact.data.type, "object");
    assert.equal(widget.artifact.data.additionalProperties, false);
    assert.ok(widget.artifact.description.length <= 300);
  }
});

const widget = manifest.contributes.widgets.find((w) => w.id === "chart");

test("the card's buttons and menu items have their permissions, icons and settings", () => {
  const icons = new Set(["table", "sliders", "zoom-out", "copy"]);
  const actions = widget.actions;
  assert.deepEqual(actions.map((a) => [a.id, a.placement, a.toggles ?? null]), [
    ["data-table", "navbar", "dataTable"],
    ["modebar", "navbar", "modebar"],
    ["static", "navbar", null],
    ["reset-view", "menu", null],
    ["show-all", "menu", null],
    ["copy-figure", "menu", null],
  ]);
  assert.equal(actions.filter((a) => a.placement === "navbar").length <= 3, true);
  assert.equal(actions.filter((a) => a.placement === "menu").length <= 8, true);
  for (const permission of ["core:ui:button", "core:ui:menu", "core:dashboard:add-widget", "core:state:write", "core:config:write", "core:clipboard:write", "core:ui:notify"])
    assert.ok(widget.permissions.includes(permission), permission);
  for (const action of actions) {
    assert.ok(icons.has(action.icon) || existsSync(join(root, "src", action.icon)), action.icon);
    if (action.toggles) assert.equal(widget.settings.schema.properties[action.toggles].type, "boolean");
  }
  assert.ok(widget.artifact);
});

test("the module's traits read the card's settings and write its state", () => {
  const { traits } = widget.model;
  assert.deepEqual(traits.state, { bind: "state", access: "readwrite" });
  assert.deepEqual(traits.config, { bind: "config", access: "readwrite" });
  for (const name of ["data", "definition", "theme"]) assert.equal(traits[name].access, "read");
});

test("an author can declare the modebar in the widget's data, as a boolean and nothing else", () => {
  const [handle] = widget.handles;
  assert.deepEqual(handle.definition, { type: "object", additionalProperties: false, properties: { modebar: { type: "boolean" } } });
  assert.equal(widget.settings.schema.properties.modebar.type, "boolean");
});

test("the artifact takes any Plotly figure, in a schema the host's lint accepts: bounded, closed at the root, and under the nesting caps", () => {
  const { data } = widget.artifact;
  assert.equal(data.additionalProperties, false);
  assert.deepEqual(data.required, ["data"]);
  assert.deepEqual(Object.keys(data.properties).sort(), ["data", "frames", "layout"]);
  assert.ok(JSON.stringify(data).length < 64 * 1024);
  const bounded = (node, depth) => {
    assert.ok(depth <= 8, `nested ${depth} levels`);
    if (node.$ref) return assert.equal(node.$ref, "#/$defs/value");
    const types = [].concat(node.type ?? []);
    if (types.includes("array")) assert.ok(Number.isInteger(node.maxItems) && node.items, "an array needs maxItems and items");
    if (types.includes("string")) assert.ok(Number.isInteger(node.maxLength), "a string needs maxLength");
    if (node.items) bounded(node.items, depth + 1);
    if (node.additionalProperties) bounded(node.additionalProperties, depth + 1);
    for (const child of Object.values(node.properties ?? {})) bounded(child, depth + 1);
  };
  bounded({ ...data, $defs: undefined }, 0);
  bounded(data.$defs.value, 1);
  assert.equal(widget.artifact.description.length <= 300, true);
});
