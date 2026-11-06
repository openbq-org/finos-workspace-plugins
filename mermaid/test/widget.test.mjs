import assert from "node:assert/strict";
import { test } from "node:test";

const { default: widget } = await import("../src/entry.js");

function start(data) {
  const model = { get: (name) => structuredClone({ data, theme: { mode: "dark", tokens: {} } }[name]), on() {}, off() {} };
  return widget.initialize({ model });
}

const SOURCE = "flowchart LR\n  A[Request] --> B[Reply]";

test("before anything is drawn the only export is the source", async () => {
  const exports = start({ diagram: SOURCE });
  assert.deepEqual(await exports.exportOptions(), [{ id: "source", label: "Source (Mermaid)", extension: "mmd", mime: "text/plain" }]);
  assert.equal(await exports.exportData("source"), SOURCE);
  assert.equal(await exports.exportData("svg"), null);
  assert.equal(await exports.exportData("png"), null);
});

test("a fenced diagram is exported without its fence", async () => {
  assert.equal(await start("```mermaid\n" + SOURCE + "\n```").exportData("source"), SOURCE);
});

test("with no diagram there is nothing to export and nothing for the agent", async () => {
  const exports = start({ rows: [] });
  assert.deepEqual(await exports.exportOptions(), []);
  assert.equal(await exports.copilotContext(), null);
});

test("the agent gets the diagram text", async () => {
  assert.deepEqual(await start({ diagram: SOURCE }).copilotContext(), { type: null, source: SOURCE });
});
