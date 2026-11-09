import {
  isLink,
  MAX_EDGE_LABEL,
  MAX_LABEL,
  MAX_NOTE,
  MAX_URL,
  type FlowEdge,
  type FlowNode,
} from "./graph.ts";

export interface Size {
  width: number;
  height: number;
}

const trimmed = (value: string, max: number) => value.trim().slice(0, max);

export function patchNode(node: FlowNode, patch: Partial<FlowNode>): FlowNode {
  const next: FlowNode = { ...node };
  if ("label" in patch) {
    const label = trimmed(patch.label ?? "", MAX_LABEL);
    if (label) next.label = label;
  }
  if ("note" in patch) next.note = trimmed(patch.note ?? "", MAX_NOTE) || undefined;
  if ("url" in patch) {
    const url = trimmed(patch.url ?? "", MAX_URL);
    if (!url) next.url = undefined;
    else if (isLink(url)) next.url = url;
  }
  if ("shape" in patch) next.shape = patch.shape === "rounded" ? undefined : patch.shape;
  if ("accent" in patch) next.accent = patch.accent === "neutral" ? undefined : patch.accent;
  if ("kind" in patch) next.kind = patch.kind === "default" ? undefined : patch.kind;
  return next;
}

export function patchEdge(edge: FlowEdge, patch: Partial<FlowEdge>): FlowEdge {
  const next: FlowEdge = { ...edge };
  if ("label" in patch) next.label = trimmed(patch.label ?? "", MAX_EDGE_LABEL) || undefined;
  if ("accent" in patch) next.accent = patch.accent === "neutral" ? undefined : patch.accent;
  if ("dashed" in patch) next.dashed = patch.dashed ? true : undefined;
  if ("animated" in patch) next.animated = patch.animated ? true : undefined;
  if ("arrow" in patch) next.arrow = patch.arrow === false ? false : undefined;
  return next;
}

export function resizedPosition(position: { x: number; y: number }, from: Size, to: Size) {
  return {
    x: position.x + (from.width - to.width) / 2,
    y: position.y + (from.height - to.height) / 2,
  };
}
