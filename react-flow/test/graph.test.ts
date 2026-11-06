import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ACCENTS,
  DIRECTIONS,
  EDGE_KEYS,
  GRAPH_KEYS,
  MAX_EDGES,
  MAX_NODES,
  NODE_KEYS,
  NODE_KINDS,
  NODE_SHAPES,
  parseGraph,
  serializeGraph,
} from "../src/graph.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(readFileSync(join(root, "src/graph.schema.json"), "utf8"));

test("the schema and the types declare the same fields", () => {
  assert.deepEqual(Object.keys(schema.properties).sort(), [...GRAPH_KEYS].sort());
  assert.deepEqual(Object.keys(schema.$defs.node.properties).sort(), [...NODE_KEYS].sort());
  assert.deepEqual(Object.keys(schema.$defs.edge.properties).sort(), [...EDGE_KEYS].sort());
  assert.deepEqual(schema.properties.direction.enum, [...DIRECTIONS]);
  assert.deepEqual(schema.$defs.node.properties.kind.enum, [...NODE_KINDS]);
  assert.deepEqual(schema.$defs.node.properties.shape.enum, [...NODE_SHAPES]);
  assert.deepEqual(schema.$defs.node.properties.accent.enum, [...ACCENTS]);
  assert.deepEqual(schema.$defs.edge.properties.accent.enum, [...ACCENTS]);
  assert.equal(schema.properties.nodes.maxItems, MAX_NODES);
  assert.equal(schema.properties.edges.maxItems, MAX_EDGES);
});

test("a graph is read from an object, from JSON text and from a graph key", () => {
  const graph = { nodes: [{ id: "a", label: "A" }], edges: [] };
  assert.deepEqual(parseGraph(graph)?.nodes, [{ id: "a", label: "A" }]);
  assert.deepEqual(parseGraph(JSON.stringify(graph))?.nodes, [{ id: "a", label: "A" }]);
  assert.deepEqual(parseGraph({ graph })?.nodes, [{ id: "a", label: "A" }]);
});

test("what is not a graph is not read as one", () => {
  for (const value of [null, undefined, "", "   ", "not json", 7, [], {}, { nodes: "a" }])
    assert.equal(parseGraph(value), null, `${JSON.stringify(value)} is not a graph`);
  assert.deepEqual(parseGraph({ nodes: [] }), { nodes: [], edges: [] });
});

test("a node keeps only the fields the schema declares, within their bounds", () => {
  const graph = parseGraph({
    title: "t".repeat(200),
    direction: "sideways",
    nodes: [
      {
        id: "a",
        label: "L".repeat(500),
        note: " note ",
        kind: "input",
        shape: "diamond",
        accent: "positive",
        url: "https://example.com",
        x: 1e9,
        y: -1e9,
        width: 1,
        height: 5000,
        colour: "red",
      },
    ],
  });
  const [node] = graph?.nodes ?? [];
  assert.equal(graph?.title?.length, 80);
  assert.equal(graph?.direction, undefined);
  assert.equal(node?.label.length, 200);
  assert.equal(node?.note, "note");
  assert.equal(node?.x, 100000);
  assert.equal(node?.y, -100000);
  assert.equal(node?.width, 40);
  assert.equal(node?.height, 2000);
  assert.equal("colour" in (node ?? {}), false);
});

test("a node without an id, a repeated id and an unknown value are dropped", () => {
  const graph = parseGraph({
    nodes: [
      { id: "a", label: "A", kind: "elephant", shape: "blob", accent: "pink", url: "javascript:alert(1)" },
      { id: "a", label: "again" },
      { label: "no id" },
      "text",
    ],
  });
  assert.deepEqual(graph?.nodes, [{ id: "a", label: "A" }]);
});

test("an edge gets an id, and an edge that hangs in the air is dropped", () => {
  const graph = parseGraph({
    nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    edges: [
      { source: "a", target: "b", label: "yes" },
      { source: "a", target: "missing" },
      { source: "a" },
      { id: "x", source: "b", target: "a" },
      { id: "x", source: "a", target: "b" },
    ],
  });
  assert.deepEqual(
    graph?.edges.map((edge) => edge.id),
    ["e0-a-b", "x", "x-4"],
  );
  assert.equal(graph?.edges[0]?.label, "yes");
});

test("a label falls back to the id, so a node always has text", () => {
  assert.equal(parseGraph({ nodes: [{ id: "a" }] })?.nodes[0]?.label, "a");
});

test("the counts are capped at the ones the schema declares", () => {
  const nodes = Array.from({ length: MAX_NODES + 10 }, (_, i) => ({ id: `n${i}`, label: `N${i}` }));
  const edges = Array.from({ length: MAX_EDGES + 10 }, (_, i) => ({ source: "n0", target: "n1", id: `e${i}` }));
  const graph = parseGraph({ nodes, edges });
  assert.equal(graph?.nodes.length, MAX_NODES);
  assert.equal(graph?.edges.length, MAX_EDGES);
});

test("serializing is canonical, so a round trip compares equal", () => {
  const first = parseGraph({
    direction: "LR",
    nodes: [{ label: "A", id: "a", y: 2.04, x: 1.26 }],
    edges: [{ target: "a", source: "a", animated: true }],
  });
  assert.ok(first);
  const text = serializeGraph(first);
  const again = parseGraph(text);
  assert.ok(again);
  assert.equal(text, serializeGraph(again));
  assert.equal(text.includes('"x":1.3'), true);
});
