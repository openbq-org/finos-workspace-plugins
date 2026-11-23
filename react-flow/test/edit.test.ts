import assert from "node:assert/strict";
import { test } from "node:test";
import { patchEdge, patchNode, resizedPosition } from "../src/edit.ts";
import { MAX_EDGE_LABEL, MAX_LABEL, MAX_NOTE, parseGraph, serializeGraph, type FlowEdge } from "../src/graph.ts";

const node = { id: "a", label: "A" };
const edge = { id: "e", source: "a", target: "b" };

test("a shape, a colour and an end are set on a node", () => {
  const next = patchNode(node, { shape: "diamond", accent: "positive", kind: "output" });
  assert.deepEqual(next, { id: "a", label: "A", shape: "diamond", accent: "positive", kind: "output" });
});

test("choosing a default removes the field, so the saved diagram stays small", () => {
  const styled = patchNode(node, { shape: "pill", accent: "negative", kind: "input" });
  const plain = patchNode(styled, { shape: "rounded", accent: "neutral", kind: "default" });
  assert.equal(serializeGraph({ nodes: [plain], edges: [] }), serializeGraph({ nodes: [node], edges: [] }));
});

test("a label is trimmed and bounded, and an empty one is refused", () => {
  assert.equal(patchNode(node, { label: "  Check  " }).label, "Check");
  assert.equal(patchNode(node, { label: "x".repeat(MAX_LABEL + 50) }).label.length, MAX_LABEL);
  assert.equal(patchNode(node, { label: "   " }).label, "A");
});

test("a note is set, bounded and cleared", () => {
  const noted = patchNode(node, { note: "Warehouse" });
  assert.equal(noted.note, "Warehouse");
  assert.equal(patchNode(node, { note: "n".repeat(MAX_NOTE + 9) }).note?.length, MAX_NOTE);
  assert.equal(patchNode(noted, { note: "  " }).note, undefined);
});

test("only an https or mailto link is accepted, and an empty one clears it", () => {
  const linked = patchNode(node, { url: " https://example.com " });
  assert.equal(linked.url, "https://example.com");
  assert.equal(patchNode(node, { url: "mailto:ops@example.com" }).url, "mailto:ops@example.com");
  for (const url of ["javascript:alert(1)", "http://example.com", "data:text/html,x", "example.com"])
    assert.equal(patchNode(linked, { url }).url, "https://example.com", url);
  assert.equal(patchNode(linked, { url: "" }).url, undefined);
});

test("a patch changes only the fields it names", () => {
  const styled = patchNode(node, { shape: "circle", accent: "info" });
  assert.deepEqual(patchNode(styled, { note: "x" }), { ...styled, note: "x" });
});

test("a node edited by hand survives a save and a reload", () => {
  const edited = patchNode(patchNode(node, { shape: "diamond", accent: "warning", kind: "input" }), {
    note: "Needs sign-off",
    url: "https://example.com/policy",
  });
  const text = serializeGraph({ nodes: [{ ...edited, x: 10, y: 20 }], edges: [] });
  assert.deepEqual(parseGraph(text)?.nodes, [{ ...edited, x: 10, y: 20 }]);
});

test("an arrow gets a label, a colour and its style", () => {
  const next = patchEdge(edge, { label: "yes", accent: "positive", dashed: true, animated: true, arrow: false });
  assert.deepEqual(next, { ...edge, label: "yes", accent: "positive", dashed: true, animated: true, arrow: false });
});

test("an arrow's defaults are removed, and its label is trimmed and bounded", () => {
  const styled = patchEdge(edge, { accent: "negative", dashed: true, animated: true, arrow: false });
  const plain = patchEdge(styled, { accent: "neutral", dashed: false, animated: false, arrow: true });
  const saved = (value: FlowEdge) =>
    serializeGraph({ nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [value] });
  assert.equal(saved(plain), saved(edge));
  assert.equal(patchEdge(edge, { label: " no " }).label, "no");
  assert.equal(patchEdge(edge, { label: "l".repeat(MAX_EDGE_LABEL + 5) }).label?.length, MAX_EDGE_LABEL);
  assert.equal(patchEdge({ ...edge, label: "yes" }, { label: "" }).label, undefined);
});

test("a node that changes size stays centred where it was", () => {
  const moved = resizedPosition({ x: 100, y: 100 }, { width: 170, height: 48 }, { width: 170, height: 86 });
  assert.deepEqual(moved, { x: 100, y: 81 });
  const back = resizedPosition(moved, { width: 170, height: 86 }, { width: 170, height: 48 });
  assert.deepEqual(back, { x: 100, y: 100 });
});
