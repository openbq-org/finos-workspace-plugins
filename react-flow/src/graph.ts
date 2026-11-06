export const ACCENTS = ["neutral", "brand", "positive", "negative", "warning", "info"] as const;
export const NODE_KINDS = ["default", "input", "output"] as const;
export const NODE_SHAPES = ["rectangle", "rounded", "pill", "diamond", "circle"] as const;
export const DIRECTIONS = ["TB", "LR", "BT", "RL"] as const;

export type Accent = (typeof ACCENTS)[number];
export type NodeKind = (typeof NODE_KINDS)[number];
export type NodeShape = (typeof NODE_SHAPES)[number];
export type Direction = (typeof DIRECTIONS)[number];

export interface FlowNode {
  id: string;
  label: string;
  note?: string;
  kind?: NodeKind;
  shape?: NodeShape;
  accent?: Accent;
  url?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface FlowEdge {
  id?: string;
  source: string;
  target: string;
  label?: string;
  accent?: Accent;
  dashed?: boolean;
  animated?: boolean;
  arrow?: boolean;
}

export interface FlowGraph {
  title?: string;
  direction?: Direction;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

const NODE_FIELDS = {
  id: true,
  label: true,
  note: true,
  kind: true,
  shape: true,
  accent: true,
  url: true,
  x: true,
  y: true,
  width: true,
  height: true,
} satisfies Record<keyof FlowNode, true>;

const EDGE_FIELDS = {
  id: true,
  source: true,
  target: true,
  label: true,
  accent: true,
  dashed: true,
  animated: true,
  arrow: true,
} satisfies Record<keyof FlowEdge, true>;

const GRAPH_FIELDS = {
  title: true,
  direction: true,
  nodes: true,
  edges: true,
} satisfies Record<keyof FlowGraph, true>;

export const NODE_KEYS = Object.keys(NODE_FIELDS);
export const EDGE_KEYS = Object.keys(EDGE_FIELDS);
export const GRAPH_KEYS = Object.keys(GRAPH_FIELDS);

export const MAX_NODES = 300;
export const MAX_EDGES = 600;
export const MAX_LABEL = 200;
export const MAX_NOTE = 300;
export const MAX_EDGE_LABEL = 120;
export const MAX_ID = 64;
export const MAX_URL = 2048;
export const MAX_TITLE = 80;
export const MAX_GRAPH_CHARS = 24000;
export const MIN_COORDINATE = -100000;
export const MAX_COORDINATE = 100000;

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const text = (value: unknown, max: number): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;

const number = (value: unknown, min: number, max: number): number | undefined =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : undefined;

const one = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined =>
  typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;

const flag = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

function defined<T extends object>(value: T): T {
  for (const key of Object.keys(value) as (keyof T)[])
    if (value[key] === undefined) delete value[key];
  return value;
}

const LINK = /^(https|mailto):/i;

function parseNode(value: unknown): FlowNode | null {
  const source = record(value);
  if (!source) return null;
  const id = text(source.id, MAX_ID);
  if (!id) return null;
  const url = text(source.url, MAX_URL);
  return defined<FlowNode>({
    id,
    label: text(source.label, MAX_LABEL) ?? id,
    note: text(source.note, MAX_NOTE),
    kind: one(source.kind, NODE_KINDS),
    shape: one(source.shape, NODE_SHAPES),
    accent: one(source.accent, ACCENTS),
    url: url && LINK.test(url) ? url : undefined,
    x: number(source.x, MIN_COORDINATE, MAX_COORDINATE),
    y: number(source.y, MIN_COORDINATE, MAX_COORDINATE),
    width: number(source.width, 40, 2000),
    height: number(source.height, 24, 2000),
  });
}

function parseEdge(value: unknown, index: number): FlowEdge | null {
  const source = record(value);
  if (!source) return null;
  const from = text(source.source, MAX_ID);
  const to = text(source.target, MAX_ID);
  if (!from || !to) return null;
  return defined<FlowEdge>({
    id: text(source.id, MAX_ID) ?? `e${index}-${from}-${to}`.slice(0, MAX_ID),
    source: from,
    target: to,
    label: text(source.label, MAX_EDGE_LABEL),
    accent: one(source.accent, ACCENTS),
    dashed: flag(source.dashed),
    animated: flag(source.animated),
    arrow: flag(source.arrow),
  });
}

export function parseGraph(input: unknown): FlowGraph | null {
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return null;
    try {
      return parseGraph(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }
  const source = record(input);
  if (!source) return null;
  if (!Array.isArray(source.nodes) && record(source.graph)) return parseGraph(source.graph);
  if (!Array.isArray(source.nodes)) return null;

  const nodes: FlowNode[] = [];
  const seen = new Set<string>();
  for (const entry of source.nodes) {
    if (nodes.length >= MAX_NODES) break;
    const node = parseNode(entry);
    if (!node || seen.has(node.id)) continue;
    seen.add(node.id);
    nodes.push(node);
  }

  const edges: FlowEdge[] = [];
  const ids = new Set<string>();
  const list = Array.isArray(source.edges) ? source.edges : [];
  for (const [index, entry] of list.entries()) {
    if (edges.length >= MAX_EDGES) break;
    const edge = parseEdge(entry, index);
    if (!edge || !seen.has(edge.source) || !seen.has(edge.target)) continue;
    const id = ids.has(edge.id as string) ? `${edge.id}-${index}`.slice(0, MAX_ID) : edge.id;
    ids.add(id as string);
    edges.push({ ...edge, id });
  }

  return defined<FlowGraph>({
    title: text(source.title, MAX_TITLE),
    direction: one(source.direction, DIRECTIONS),
    nodes,
    edges,
  });
}

const round = (value: number | undefined) =>
  value === undefined ? undefined : Math.round(value * 10) / 10;

function canonicalNode(node: FlowNode): FlowNode {
  return defined<FlowNode>({
    id: node.id,
    label: node.label,
    note: node.note,
    kind: node.kind,
    shape: node.shape,
    accent: node.accent,
    url: node.url,
    x: round(node.x),
    y: round(node.y),
    width: round(node.width),
    height: round(node.height),
  });
}

function canonicalEdge(edge: FlowEdge): FlowEdge {
  return defined<FlowEdge>({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    accent: edge.accent,
    dashed: edge.dashed,
    animated: edge.animated,
    arrow: edge.arrow,
  });
}

export function serializeGraph(graph: FlowGraph): string {
  return JSON.stringify(
    defined<FlowGraph>({
      title: graph.title,
      direction: graph.direction,
      nodes: graph.nodes.map(canonicalNode),
      edges: graph.edges.map(canonicalEdge),
    }),
  );
}
