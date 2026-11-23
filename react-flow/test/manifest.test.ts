import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { MAX_GRAPH_CHARS } from "../src/graph.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "src/plugin.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const schema = JSON.parse(readFileSync(join(root, "src/graph.schema.json"), "utf8"));
const [widget] = manifest.contributes.widgets;

test("one widget handles the reactflow type, and the plugin is a package of its own", () => {
  assert.equal(manifest.id, "react-flow");
  assert.equal(manifest.contributes.widgets.length, 1);
  assert.deepEqual(
    widget.handles.map((handle: { type: string }) => handle.type),
    ["reactflow"],
  );
  assert.equal(widget.handles[0].response.accepts, "json");
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
});

test("the widget asks for what its module uses, and nothing else", () => {
  assert.deepEqual(widget.permissions, [
    "core:data:read",
    "core:config:write",
    "core:export:provide",
    "core:copilot:context",
    "core:ui:open-link",
    "core:ui:notify",
    "core:ui:button",
    "core:ui:menu",
  ]);
  assert.equal(manifest.csp, undefined);
  assert.equal(manifest.server, undefined);
});

test("the artifact takes the graph schema, which is closed and bounded", () => {
  assert.ok(widget.artifact.description.length > 0 && widget.artifact.description.length <= 300);
  assert.deepEqual(widget.artifact.data, { $include: "graph.schema.json" });
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ["nodes"]);
  for (const node of [schema.$defs.node, schema.$defs.edge])
    assert.equal(node.additionalProperties, false);
  for (const array of [schema.properties.nodes, schema.properties.edges]) {
    assert.equal(typeof array.maxItems, "number");
    assert.ok(array.items.$ref.startsWith("#/$defs/"));
  }
});

test("the user, the module and the agent share one diagram setting", () => {
  const graph = widget.settings.schema.properties.graph;
  assert.equal(graph.type, "string");
  assert.equal(graph.maxLength, MAX_GRAPH_CHARS);
  assert.deepEqual(Object.keys(widget.settings.schema.properties), ["graph"]);
  assert.equal(widget.settings.defaults.graph, "");
  assert.ok(widget.permissions.includes("core:config:write"));
});

test("the card's buttons and menu items are declared, with the permissions they need", () => {
  const navbar = widget.actions.filter((a: { placement: string }) => a.placement === "navbar");
  const menu = widget.actions.filter((a: { placement: string }) => a.placement === "menu");
  assert.deepEqual(
    widget.actions.map((a: { id: string }) => a.id),
    ["add-node", "revert"],
  );
  assert.ok(navbar.length > 0 && navbar.length <= 3);
  assert.ok(menu.length > 0 && menu.length <= 8);
  assert.ok(widget.permissions.includes("core:ui:button"));
  assert.ok(widget.permissions.includes("core:ui:menu"));
  for (const action of widget.actions) {
    assert.match(action.id, /^[a-z][a-z0-9_-]{0,31}$/);
    assert.ok(action.label.length > 0 && action.label.length <= 40);
    assert.equal(action.toggles, undefined);
    if (action.icon.startsWith("assets/")) {
      const path = join(root, "src", action.icon);
      assert.ok(existsSync(path), `${action.icon} is missing`);
      const svg = readFileSync(path, "utf8");
      assert.ok(Buffer.byteLength(svg) <= 16 * 1024);
      assert.equal(/\b(script|style|use|image|foreignObject)\b/.test(svg), false);
      assert.equal(/\b(class|style|id|href|xlink:href)=/.test(svg), false);
    }
  }
});

test("every skill the manifest lists is a markdown file under src/skills, with a slug and a description", () => {
  assert.ok(manifest.contributes.skills.length > 0);
  for (const skill of manifest.contributes.skills) {
    assert.match(skill.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(skill.description.length > 0 && skill.description.length <= 300);
    assert.match(skill.file, /^skills\/[A-Za-z0-9._-]+\.md$/);
    const path = join(root, "src", skill.file);
    assert.ok(existsSync(path), `${skill.file} is missing`);
    const text = readFileSync(path, "utf8");
    assert.ok(text.trim().length > 0 && Buffer.byteLength(text) <= 32 * 1024);
  }
});

test("the icon and the stylesheet the manifest names are in the source", () => {
  assert.ok(existsSync(join(root, "src", manifest.icon)));
  for (const style of manifest.entry.styles) assert.ok(existsSync(join(root, "src", style)));
});
