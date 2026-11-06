import dagre from "@dagrejs/dagre";
import type { FlowGraph, FlowNode, NodeShape } from "./graph.ts";

export const SHAPE_SIZES: Record<NodeShape, { width: number; height: number }> = {
  rectangle: { width: 170, height: 48 },
  rounded: { width: 170, height: 48 },
  pill: { width: 170, height: 42 },
  diamond: { width: 170, height: 86 },
  circle: { width: 112, height: 112 },
};

export function sizeOf(node: FlowNode): { width: number; height: number } {
  const base = SHAPE_SIZES[node.shape ?? "rounded"];
  return { width: node.width ?? base.width, height: node.height ?? base.height };
}

export function isPlaced(graph: FlowGraph): boolean {
  return graph.nodes.every((node) => node.x !== undefined && node.y !== undefined);
}

export function layout(graph: FlowGraph): FlowGraph {
  if (isPlaced(graph)) return graph;
  const laid = new dagre.graphlib.Graph();
  laid.setGraph({
    rankdir: graph.direction ?? "TB",
    nodesep: 26,
    ranksep: 46,
    marginx: 12,
    marginy: 12,
  });
  laid.setDefaultEdgeLabel(() => ({}));
  for (const node of graph.nodes) laid.setNode(node.id, sizeOf(node));
  for (const edge of graph.edges) laid.setEdge(edge.source, edge.target);
  dagre.layout(laid);
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const placed = laid.node(node.id) as { x?: number; y?: number } | undefined;
      if (!placed || placed.x === undefined || placed.y === undefined) return node;
      const size = sizeOf(node);
      return { ...node, x: placed.x - size.width / 2, y: placed.y - size.height / 2 };
    }),
  };
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const GAP = 16;

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width + GAP &&
  b.x < a.x + a.width + GAP &&
  a.y < b.y + b.height + GAP &&
  b.y < a.y + a.height + GAP;

const RADIUS = 8;

const inside = (box: Box, view: Box) =>
  box.x >= view.x && box.y >= view.y && box.x + box.width <= view.x + view.width && box.y + box.height <= view.y + view.height;

export function freeSpot(
  center: { x: number; y: number },
  size: { width: number; height: number },
  others: Box[],
  view?: Box,
) {
  const home = { x: center.x - size.width / 2, y: center.y - size.height / 2 };
  const stepX = size.width + GAP;
  const stepY = size.height + GAP;
  const offsets: { x: number; y: number }[] = [];
  for (let i = -RADIUS; i <= RADIUS; i += 1)
    for (let j = -RADIUS; j <= RADIUS; j += 1) offsets.push({ x: i * stepX, y: j * stepY });
  offsets.sort((a, b) => a.x * a.x + a.y * a.y - (b.x * b.x + b.y * b.y));
  const free = (spot: { x: number; y: number }) => !others.some((other) => overlaps({ ...spot, ...size }, other));
  for (const offset of offsets) {
    const spot = { x: home.x + offset.x, y: home.y + offset.y };
    if (free(spot) && (!view || inside({ ...spot, ...size }, view))) return spot;
  }
  for (const offset of offsets) {
    const spot = { x: home.x + offset.x, y: home.y + offset.y };
    if (free(spot)) return spot;
  }
  return home;
}
