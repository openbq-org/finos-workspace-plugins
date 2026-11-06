import assert from "node:assert/strict";
import { test } from "node:test";
import type { FlowGraph } from "../src/graph.ts";
import { freeSpot, isPlaced, layout, SHAPE_SIZES, sizeOf } from "../src/layout.ts";

const chain = (): FlowGraph => ({
  direction: "LR",
  nodes: [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C" },
  ],
  edges: [
    { source: "a", target: "b" },
    { source: "b", target: "c" },
  ],
});

test("a node's size comes from its shape, and its own size wins", () => {
  assert.deepEqual(sizeOf({ id: "a", label: "A" }), SHAPE_SIZES.rounded);
  assert.deepEqual(sizeOf({ id: "a", label: "A", shape: "circle" }), SHAPE_SIZES.circle);
  assert.deepEqual(sizeOf({ id: "a", label: "A", width: 300, height: 90 }), {
    width: 300,
    height: 90,
  });
});

test("a graph without positions is laid out in its direction", () => {
  const laid = layout(chain());
  assert.equal(isPlaced(laid), true);
  const [a, b, c] = laid.nodes;
  assert.ok((a?.x ?? 0) < (b?.x ?? 0) && (b?.x ?? 0) < (c?.x ?? 0));
  assert.equal(a?.y, b?.y);
});

test("top to bottom stacks the nodes instead", () => {
  const laid = layout({ ...chain(), direction: "TB" });
  const [a, b] = laid.nodes;
  assert.ok((a?.y ?? 0) < (b?.y ?? 0));
  assert.equal(a?.x, b?.x);
});

test("a graph that is already placed is left alone", () => {
  const placed: FlowGraph = {
    nodes: [
      { id: "a", label: "A", x: 10, y: 20 },
      { id: "b", label: "B", x: 10, y: 200 },
    ],
    edges: [{ source: "a", target: "b" }],
  };
  assert.deepEqual(layout(placed), placed);
});

test("one missing position lays the whole graph out again", () => {
  const laid = layout({
    nodes: [
      { id: "a", label: "A", x: 10, y: 20 },
      { id: "b", label: "B" },
    ],
    edges: [{ source: "a", target: "b" }],
  });
  assert.equal(isPlaced(laid), true);
  assert.notEqual(laid.nodes[0]?.x, 10);
});

test("an empty graph is placed", () => {
  assert.equal(isPlaced({ nodes: [], edges: [] }), true);
});

test("a new node is centred on the view when the spot is free", () => {
  const spot = freeSpot({ x: 500, y: 300 }, { width: 170, height: 48 }, []);
  assert.deepEqual(spot, { x: 415, y: 276 });
});

test("a new node does not land on an existing one, and stays near the view's centre", () => {
  const size = { width: 170, height: 48 };
  const taken = [{ x: 415, y: 276, ...size }];
  const spot = freeSpot({ x: 500, y: 300 }, size, taken);
  const clear = (other: { x: number; y: number }) =>
    spot.x + size.width + 16 <= other.x || other.x + size.width + 16 <= spot.x || spot.y + size.height + 16 <= other.y || other.y + size.height + 16 <= spot.y;
  assert.ok(taken.every(clear));
  assert.ok(Math.hypot(spot.x - 415, spot.y - 276) <= 2 * (size.width + 16));
});

test("it keeps looking until a crowded view leaves a gap", () => {
  const size = { width: 170, height: 48 };
  const crowd = Array.from({ length: 5 }, (_, i) => ({ x: 415, y: 276 + (i - 2) * 64, ...size }));
  const spot = freeSpot({ x: 500, y: 300 }, size, crowd);
  for (const node of crowd)
    assert.ok(
      spot.x + size.width + 16 <= node.x || node.x + size.width + 16 <= spot.x || spot.y + size.height + 16 <= node.y || node.y + size.height + 16 <= spot.y,
    );
});

test("a new node stays inside the visible area when there is room", () => {
  const size = { width: 170, height: 48 };
  const view = { x: 0, y: 0, width: 600, height: 400 };
  const crowd = Array.from({ length: 4 }, (_, i) => ({ x: 215, y: 20 + i * 64, ...size }));
  const spot = freeSpot({ x: 300, y: 200 }, size, crowd, view);
  assert.ok(spot.x >= 0 && spot.y >= 0 && spot.x + size.width <= 600 && spot.y + size.height <= 400);
});

test("it falls back to a free spot outside the view when the view is full", () => {
  const size = { width: 170, height: 48 };
  const view = { x: 0, y: 0, width: 200, height: 60 };
  const spot = freeSpot({ x: 100, y: 30 }, size, [{ x: 15, y: 6, ...size }], view);
  assert.ok(spot.x !== 15 || spot.y !== 6);
});
