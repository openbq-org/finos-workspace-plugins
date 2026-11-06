import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "src/plugin.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const [widget] = manifest.contributes.widgets;

test("one widget handles the mermaid type, and the plugin is a package of its own", () => {
  assert.equal(manifest.id, "mermaid");
  assert.equal(manifest.contributes.widgets.length, 1);
  assert.deepEqual(widget.handles.map((h) => h.type), ["mermaid"]);
  assert.equal(widget.handles[0].response.accepts, "json");
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
});

test("the widget asks for what its module uses, and nothing else", () => {
  assert.deepEqual(widget.permissions, ["core:data:read", "core:export:provide", "core:copilot:context", "core:ui:open-link"]);
  assert.equal(manifest.csp, undefined);
});

test("the artifact takes the diagram text in a closed, bounded schema", () => {
  const { data, description } = widget.artifact;
  assert.ok(description.length > 0 && description.length <= 300);
  assert.equal(data.additionalProperties, false);
  assert.deepEqual(data.required, ["diagram"]);
  assert.equal(data.properties.diagram.type, "string");
  assert.ok(data.properties.diagram.maxLength <= 50_000);
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
