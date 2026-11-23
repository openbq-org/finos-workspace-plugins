import { MAP_LIMITS } from "~/lib/codemode/limits";
import { mapFrames } from "./mapLayers";
import type { MapSpec } from "./mapSpecTypes";
import { fail, isPlain, text } from "./mapValues";

export function depthOf(value: unknown, level = 1): number {
  if (value === null || typeof value !== "object" || level > MAP_LIMITS.depth)
    return level;
  let deepest = level;
  for (const item of Array.isArray(value) ? value : Object.values(value)) {
    deepest = Math.max(deepest, depthOf(item, level + 1));
    if (deepest > MAP_LIMITS.depth) break;
  }
  return deepest;
}

export function declaredSources(
  ids: readonly string[],
  given: readonly unknown[],
  notes: string[],
): unknown[] {
  const named = new Set(
    given.flatMap((layer) =>
      isPlain(layer) && typeof layer.source === "string" ? [layer.source] : [],
    ),
  );
  const wanted = ids.filter((id) => !named.has(id));
  const room = Math.max(0, MAP_LIMITS.layers - given.length);
  const cut = wanted.slice(room);
  if (cut.length)
    notes.push(
      `The widget declares ${ids.length} map sources and the map has room for ${room} more ${room === 1 ? "layer" : "layers"}: ${cut.length} ${cut.length === 1 ? "is" : "are"} not listed (${cut.slice(0, 5).join(", ")}${cut.length > 5 ? ", ..." : ""}).`,
    );
  return wanted
    .slice(0, room)
    .map((id) => ({ kind: "source", id, source: id, visible: false }));
}

const MARK_LISTS = new Set(["points", "shapes", "items", "flows"]);

export const withoutMarks = (key: string, value: unknown): unknown =>
  MARK_LISTS.has(key) && Array.isArray(value)
    ? []
    : key === "data" && typeof value === "string"
      ? ""
      : value;

export function openingFrame(raw: unknown, spec: MapSpec): string | undefined {
  const frame = text(raw, MAP_LIMITS.frameChars);
  if (frame === undefined) return undefined;
  const steps = mapFrames(spec);
  if (steps.length === 0)
    return fail(
      "`frame` is the step a map that plays opens on, and this map has no steps: give its marks a `time` (the `time` option of the plot helpers), or leave `frame` out.",
    );
  if (!steps.includes(frame))
    return fail(
      `\`frame\` is ${JSON.stringify(frame)}, which is not a step of this map: its ${steps.length} steps go from ${steps[0]} to ${steps[steps.length - 1]}.`,
    );
  return frame;
}
