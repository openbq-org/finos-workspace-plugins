import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { BEHAVIORS, DIRECTIONS, LIMITS, readDocument, readFields } from "../src/model.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "src/plugin.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const [widget] = manifest.contributes.widgets;
const artifact = widget.artifact.data.properties;
const skill = readFileSync(join(root, "src", manifest.contributes.skills[0].file), "utf8");

test("one widget handles the marquee type, and the plugin is a package of its own", () => {
  assert.equal(manifest.id, "marquee");
  assert.equal(manifest.contributes.widgets.length, 1);
  assert.deepEqual(widget.handles.map((handle) => handle.type), ["marquee"]);
  assert.equal(widget.handles[0].response.accepts, "json");
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.ok(manifest.description.length <= 300);
  assert.ok(widget.description.length <= 300);
  assert.ok(widget.handles[0].response.description.length <= 300);
});

test("the widget asks for what its module uses, and nothing else", () => {
  assert.deepEqual(widget.permissions, ["core:data:read", "core:data:stream", "core:params:write", "core:export:provide", "core:copilot:context", "core:ui:open-link", "core:ui:button"]);
  assert.equal(manifest.csp, undefined);
  assert.equal(manifest.server, undefined);
});

test("the Pause button is a plain button, the widget has no settings, and the permission for a button is asked", () => {
  assert.equal(widget.actions.length, 1);
  const [action] = widget.actions;
  assert.equal(action.id, "pause");
  assert.equal(action.placement, "navbar");
  assert.equal(action.toggles, undefined);
  assert.equal(widget.settings, undefined);
  assert.ok(widget.permissions.includes("core:ui:button"));
  assert.ok(!widget.permissions.includes("core:ui:menu"));
  assert.match(action.icon, /^assets\/[A-Za-z0-9._-]+\.svg$/);
  assert.ok(existsSync(join(root, "src", action.icon)));
});

test("the choices and the bounds of the artifact are the module's", () => {
  assert.deepEqual(artifact.behavior.enum, [...BEHAVIORS]);
  assert.deepEqual(artifact.direction.enum, [...DIRECTIONS]);
  assert.equal(artifact.speed.minimum, LIMITS.speedMin);
  assert.equal(artifact.speed.maximum, LIMITS.speedMax);
  assert.equal(artifact.gap.minimum, LIMITS.gapMin);
  assert.equal(artifact.gap.maximum, LIMITS.gapMax);
});

function lint(node, path, depth, problems) {
  if (depth > 8) problems.push(`${path}: too deep`);
  const types = [node.type].flat();
  if (node.enum) return;
  if (types.includes("object")) {
    if (node.additionalProperties !== false) problems.push(`${path}: not closed`);
    for (const [name, child] of Object.entries(node.properties ?? {})) lint(child, `${path}/${name}`, depth + 1, problems);
  }
  if (types.includes("array")) {
    if (!Number.isInteger(node.maxItems)) problems.push(`${path}: no maxItems`);
    if (!node.items) problems.push(`${path}: no items`);
    else lint(node.items, `${path}/items`, depth + 1, problems);
  }
  if (types.includes("string") && !Number.isInteger(node.maxLength) && !node.pattern) problems.push(`${path}: no maxLength`);
}

test("the artifact takes a marquee in a closed and bounded schema", () => {
  const { data, description } = widget.artifact;
  assert.ok(description.length > 0 && description.length <= 300);
  const problems = [];
  lint(data, "", 0, problems);
  assert.deepEqual(problems, []);
  assert.ok(Buffer.byteLength(JSON.stringify(data)) < 64 * 1024);
});

test("every property of the artifact is one that the module reads", () => {
  const sample = {};
  for (const [name, property] of Object.entries(artifact)) {
    if (name === "items") sample.items = [{ ticker: "T", label: "L", value: "1", change: "+1%", spark: [1, 2, 3], text: "t", html: "", tone: "up", style: "color: red", url: "https://example.com", clickValue: "v" }];
    else if (property.enum) sample[name] = property.enum[0];
    else if (property.type === "boolean") sample[name] = true;
    else if (property.type === "string") sample[name] = name === "style" ? "color: red" : "x";
    else sample[name] = property.minimum;
  }
  const { items, fields } = readDocument(sample);
  assert.deepEqual(items, [{ ticker: "T", label: "L", value: "1", change: "+1%", spark: [1, 2, 3], text: "t", tone: "up", style: { color: "red" }, url: "https://example.com", clickValue: "v" }]);
  const wanted = Object.keys(artifact).filter((name) => name !== "text" && name !== "items");
  assert.deepEqual(Object.keys(fields).sort(), wanted.sort());
  assert.deepEqual(Object.keys(artifact.items.items.properties), ["ticker", "label", "value", "change", "spark", "text", "html", "tone", "style", "url", "clickValue"]);
  assert.deepEqual(artifact.items.items.properties.tone.enum, ["up", "down", "neutral"]);
});

test("the artifact takes every option that the module reads", () => {
  const every = { speed: 1, gap: 1, direction: "up", behavior: "static", pauseOnHover: true, paused: true, clickable: true, disabled: true, separator: "x", clickParam: "x", label: "x", description: "x", style: "color: red" };
  assert.deepEqual(Object.keys(readFields(every)).sort(), Object.keys(artifact).filter((name) => name !== "text" && name !== "items").sort());
});

test("the skill is a markdown file that names every option and every item key", () => {
  const [entry] = manifest.contributes.skills;
  assert.match(entry.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.ok(entry.description.length > 0 && entry.description.length <= 300);
  assert.match(entry.file, /^skills\/[A-Za-z0-9._-]+\.md$/);
  assert.ok(skill.trim().length > 0 && Buffer.byteLength(skill) <= 32 * 1024);
  for (const name of Object.keys(artifact).filter((option) => option !== "text" && option !== "items")) assert.ok(skill.includes(`\`${name}\``), `the skill does not name ${name}`);
  for (const name of Object.keys(artifact.items.items.properties)) assert.ok(skill.includes(`\`${name}\``), `the skill does not name ${name}`);
});

test("the icon, the stylesheet and the icons of the actions are in the source, and the icons are plain", () => {
  assert.ok(existsSync(join(root, "src", manifest.icon)));
  for (const style of manifest.entry.styles) assert.ok(existsSync(join(root, "src", style)));
  const tags = new Set(["circle", "desc", "ellipse", "g", "line", "path", "polygon", "polyline", "rect", "svg", "title"]);
  for (const file of [manifest.icon, ...widget.actions.map((action) => action.icon)]) {
    const text = readFileSync(join(root, "src", file), "utf8");
    assert.ok(Buffer.byteLength(text) <= 16384);
    for (const [, tag] of text.matchAll(/<([A-Za-z][A-Za-z0-9]*)/g)) assert.ok(tags.has(tag), `${file}: ${tag}`);
    assert.doesNotMatch(text, /<!|<\?|style=|href=|id=|class=|url\(/i, file);
  }
});
