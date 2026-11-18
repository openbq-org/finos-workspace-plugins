import { MAP_LIMITS } from "~/lib/codemode/limits";
import { image, type MapImage } from "./mapImage";
import { flows, points, shapes } from "./mapMarks";
import type { MapFlow, MapPoint, MapRegions, MapShape, Marked } from "./mapMarkTypes";
import { regions } from "./mapRegionMarks";
import { fail, finite, heading, isPlain, listOf, shown, text } from "./mapValues";
import type { MarkBudget } from "./markBudget";

export { imagePixels, type MapImage } from "./mapImage";

export const MAP_LAYER_KINDS = [
  "regions",
  "points",
  "lines",
  "polygons",
  "heat",
  "clusters",
  "flows",
  "columns",
  "source",
  "image",
] as const;
export type MapLayerKind = (typeof MAP_LAYER_KINDS)[number];

interface LayerBase {
  id: string;
  name?: string;
  valueLabel?: string;
  sizeLabel?: string;
  group?: string;
  visible?: false;
  opacity?: number;
}

export type MapLayer = LayerBase &
  (
    | { kind: "regions"; regions: MapRegions }
    | { kind: "points" | "heat" | "clusters"; points: MapPoint[] }
    | { kind: "lines" | "polygons"; shapes: MapShape[] }
    | { kind: "flows"; flows: MapFlow[] }
    | { kind: "columns"; points?: MapPoint[]; regions?: MapRegions }
    | { kind: "source"; source: string }
    | { kind: "image"; image: MapImage }
  );

export const MAP_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export const IMPLICIT_LAYER_IDS = ["regions", "polygons", "lines", "points"] as const;

const KIND_FORMS =
  'A layer is { kind, ... } with its marks: "regions" has regions, "points", "heat" and "clusters" have points, "lines" and "polygons" have shapes, "flows" has flows, "columns" has points or regions, "source" names a map source of a connected backend by its id, "image" holds the bytes of an image of a file. The plot helpers return one each, and plot.layers puts them together.';

export function sourceId(raw: unknown, what: string): string {
  if (typeof raw !== "string" || !MAP_ID.test(raw))
    return fail(
      `${what} names the source ${shown(raw)}. A map source is named by the id a connected backend gave it (lower-case letters, digits, "-" and "_", 40 at most), as workspace.mapSources() lists it. A map never carries an address.`,
    );
  return raw;
}

export interface LayerHead {
  raw: Record<string, unknown>;
  kind: MapLayerKind;
  what: string;
  base: LayerBase;
}

export function layerHeads(raw: unknown): LayerHead[] {
  const given = listOf(raw, "layers");
  if (given.length > MAP_LIMITS.layers)
    return fail(
      `the map has ${given.length} layers. A map has at most ${MAP_LIMITS.layers}.`,
    );
  const ids = new Set<string>(IMPLICIT_LAYER_IDS);
  return given.map((item, at) => {
    const what = `layer ${at + 1}`;
    if (!isPlain(item)) return fail(`${what} is not an object. ${KIND_FORMS}`);
    const kind = item.kind;
    if (!MAP_LAYER_KINDS.includes(kind as MapLayerKind))
      return fail(`${what} has the kind ${shown(kind)}. ${KIND_FORMS}`);
    let id = typeof item.id === "string" && MAP_ID.test(item.id) ? item.id : "";
    for (let n = 1; !id || ids.has(id); n++) id = `${kind}-${n}`;
    ids.add(id);
    const name = heading(item.name, MAP_LIMITS.layerNameChars);
    const valueLabel = heading(item.valueLabel, MAP_LIMITS.titleChars);
    const sizeLabel = heading(item.sizeLabel, MAP_LIMITS.titleChars);
    const group = text(item.group, MAP_LIMITS.layerNameChars);
    const base: LayerBase = {
      id,
      ...(name === undefined ? {} : { name }),
      ...(valueLabel === undefined ? {} : { valueLabel }),
      ...(sizeLabel === undefined ? {} : { sizeLabel }),
      ...(group === undefined ? {} : { group }),
      ...(item.visible === false ? { visible: false } : {}),
      ...(finite(item.opacity) && item.opacity < 1
        ? { opacity: Math.max(0, item.opacity) }
        : {}),
    };
    return { raw: item, kind: kind as MapLayerKind, what, base };
  });
}

export function layerOf(
  { raw, kind, what, base }: LayerHead,
  budget: MarkBudget,
): MapLayer {
  switch (kind) {
    case "regions":
      return { ...base, kind, regions: regions(raw.regions, budget) };
    case "points":
    case "heat":
    case "clusters":
      return { ...base, kind, points: points(listOf(raw.points, "points"), budget) };
    case "lines":
    case "polygons": {
      const wanted = kind === "lines" ? "line" : "polygon";
      const read = shapes(listOf(raw.shapes, "shapes"), budget);
      if (read.some((item) => item.type !== wanted))
        return fail(
          `${what} is of the kind "${kind}" and has a shape that is not a ${wanted}. Lines go in a layer of the kind "lines", areas in one of the kind "polygons".`,
        );
      return { ...base, kind, shapes: read };
    }
    case "flows":
      return { ...base, kind, flows: flows(listOf(raw.flows, "flows"), budget) };
    case "columns": {
      const byRegion = raw.regions !== undefined && raw.regions !== null;
      const byPoint = raw.points !== undefined && raw.points !== null;
      if (byRegion === byPoint)
        return fail(
          `${what} is of the kind "columns" and needs either points or regions: a bar for each point, or for each region.`,
        );
      return byRegion
        ? { ...base, kind: "columns", regions: regions(raw.regions, budget) }
        : {
            ...base,
            kind: "columns",
            points: points(listOf(raw.points, "points"), budget),
          };
    }
    case "image":
      return { ...base, kind: "image", image: image(raw.image, what, budget) };
    default:
      return { ...base, kind: "source", source: sourceId(raw.source, what) };
  }
}

export function fittedLayer(
  { kind, base }: LayerHead,
  marks: { points: MapPoint[]; shapes: MapShape[] },
): MapLayer | null {
  if (kind === "points")
    return marks.points.length ? { ...base, kind, points: marks.points } : null;
  if (kind === "lines" || kind === "polygons")
    return marks.shapes.length ? { ...base, kind, shapes: marks.shapes } : null;
  return null;
}

export function layers(raw: unknown, budget: MarkBudget): MapLayer[] {
  return layerHeads(raw).map((head) => layerOf(head, budget));
}

export function layerMarks(item: MapLayer): readonly Marked[] {
  switch (item.kind) {
    case "regions":
      return item.regions.items;
    case "lines":
    case "polygons":
      return item.shapes;
    case "flows":
      return item.flows;
    case "columns":
      return item.points ?? item.regions?.items ?? [];
    case "source":
    case "image":
      return [];
    default:
      return item.points;
  }
}

export type ShownLayer = MapLayer & {
  implicit?: true;
};

const KIND_NAMES: Record<MapLayerKind, string> = {
  regions: "Regions",
  points: "Points",
  lines: "Lines",
  polygons: "Areas",
  heat: "Density",
  clusters: "Clusters",
  flows: "Flows",
  columns: "Columns",
  source: "Source",
  image: "Image",
};

export const layerName = (item: MapLayer): string =>
  item.name ?? item.valueLabel ?? KIND_NAMES[item.kind];

export const panelLayerName = (
  item: MapLayer,
  count: number,
  title: string | undefined,
): string =>
  item.name ?? item.valueLabel ?? (count === 1 && title ? title : layerName(item));

interface Layered {
  valueLabel?: string;
  sizeLabel?: string;
  points: MapPoint[];
  regions?: MapRegions;
  shapes: MapShape[];
  layers?: MapLayer[];
}

export function mapLayers(spec: Layered): ShownLayer[] {
  const implicit = { implicit: true as const };
  const label = spec.valueLabel === undefined ? {} : { valueLabel: spec.valueLabel };
  const areas = spec.shapes.filter((item) => item.type === "polygon");
  const lines = spec.shapes.filter((item) => item.type === "line");
  const scaled = spec.regions?.items.some((item) => item.value !== undefined)
    ? "regions"
    : spec.points.some((item) => item.value !== undefined)
      ? "points"
      : "shapes";
  const first: ShownLayer[] = [];
  if (spec.regions?.items.length)
    first.push({
      id: "regions",
      kind: "regions",
      regions: spec.regions,
      ...(scaled === "regions" ? label : {}),
      ...implicit,
    });
  if (areas.length)
    first.push({
      id: "polygons",
      kind: "polygons",
      shapes: areas,
      ...(scaled === "shapes" ? label : {}),
      ...implicit,
    });
  if (lines.length)
    first.push({
      id: "lines",
      kind: "lines",
      shapes: lines,
      ...(scaled === "shapes" && !areas.length ? label : {}),
      ...implicit,
    });
  if (spec.points.length)
    first.push({
      id: "points",
      kind: "points",
      points: spec.points,
      ...(scaled === "points" ? label : {}),
      ...(spec.sizeLabel === undefined ? {} : { sizeLabel: spec.sizeLabel }),
      ...implicit,
    });
  return [...first, ...(spec.layers ?? [])];
}

export function mapFrames(spec: Layered): string[] {
  const seen = new Set<string>();
  for (const item of mapLayers(spec))
    for (const mark of layerMarks(item))
      if (mark.time !== undefined) seen.add(mark.time);
  const frames = [...seen];
  const numeric = frames.every((frame) => frame.trim() !== "" && finite(Number(frame)));
  return frames.sort((a, b) =>
    numeric ? Number(a) - Number(b) : a < b ? -1 : a > b ? 1 : 0,
  );
}

export const OPENING_SHARE = 0.5;

export function mapOpeningFrame(
  spec: Layered & { frame?: string },
  frames: readonly string[] = mapFrames(spec),
): string | undefined {
  if (!frames.length) return undefined;
  if (spec.frame !== undefined && frames.includes(spec.frame)) return spec.frame;
  const counts = new Map<string, number>();
  for (const item of mapLayers(spec))
    for (const mark of layerMarks(item))
      if (mark.time !== undefined)
        counts.set(mark.time, (counts.get(mark.time) ?? 0) + 1);
  const fullest = Math.max(...counts.values());
  for (let at = frames.length - 1; at >= 0; at--)
    if ((counts.get(frames[at]) ?? 0) >= fullest * OPENING_SHARE) return frames[at];
  return frames.at(-1);
}

export function mapCategories(spec: Layered): string[] {
  const seen = new Set<string>();
  for (const item of mapLayers(spec))
    for (const mark of layerMarks(item))
      if (mark.category !== undefined) seen.add(mark.category);
  return [...seen].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
