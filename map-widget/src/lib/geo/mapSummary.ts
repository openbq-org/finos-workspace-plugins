import { MAP_LIMITS } from "~/lib/codemode/limits";
import { type MapBasemapPart, mapAsks } from "./mapAsks";
import type { MapBoundaryId } from "./mapBoundaries";
import {
  layerMarks,
  type MapLayerKind,
  mapCategories,
  mapFrames,
  mapLayers,
  mapOpeningFrame,
} from "./mapLayers";
import type { Marked } from "./mapMarkTypes";
import type { MapSpec, NamedPlaces } from "./mapSpecTypes";
import { regionOf } from "./regions/codes";
import type { RegionSetId } from "./regions/regionTypes";

export type MapBounds = [number, number, number, number];

export interface LayerSummary {
  id: string;
  kind: MapLayerKind;
  name?: string;
  valueLabel?: string;
  count: number;
  valueRange?: [number, number];
  regionSet?: RegionSetId;
  source?: string;
  hidden?: true;
}

export interface MapSummary {
  points: number;
  regions: number;
  regionSet?: RegionSetId;
  shapes: number;
  flows?: number;
  tags: number;
  marked?: number;
  markedLabels?: string[];
  highlighted?: number;
  buildings?: number;
  title?: string;
  valueLabel?: string;
  bounds?: MapBounds;
  valueRange?: [number, number];
  labels?: string[];
  unmatched?: number;
  unmatchedCodes?: string[];
  byName?: NamedPlaces;
  layers?: LayerSummary[];
  frames?: number;
  frameRange?: [string, string];
  frame?: string;
  categories?: string[];
  categoryLabel?: string;
  basemapSource?: string;
  notes?: string[];
  context?: string[];
  basemapPlain?: true;
  basemapOff?: MapBasemapPart[];
  boundaries?: MapBoundaryId[];
}

const rangeOf = (
  marks: readonly { value?: number }[],
): [number, number] | undefined => {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const mark of marks)
    if (mark.value !== undefined) {
      low = Math.min(low, mark.value);
      high = Math.max(high, mark.value);
    }
  return low <= high ? [low, high] : undefined;
};

const placeOf = (
  mark: Marked & { code?: string; lat?: number; lon?: number },
  at: number,
) =>
  mark.code !== undefined
    ? `c:${mark.code}`
    : mark.lat !== undefined && mark.lon !== undefined
      ? `p:${mark.lat},${mark.lon}`
      : mark.label !== undefined
        ? `l:${mark.label}`
        : String(at);

const regionName = (set: string | undefined, mark: Marked & { code?: string }) =>
  mark.code === undefined ? undefined : regionOf(set, mark.code)?.name;

export function mapSummary(spec: MapSpec): MapSummary {
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  const grow = (lon: number, lat: number) => {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  };
  const counts = { points: 0, regions: 0, shapes: 0, flows: 0 };
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  let tags = 0;
  let marked = 0;
  let highlighted = 0;
  let buildings = 0;
  let unmatched = 0;
  const unmatchedCodes: string[] = [];
  let regionSet: RegionSetId | undefined;
  const markedLabels: string[] = [];
  const labels: string[] = [];
  const all = mapLayers(spec);
  const ordered = [
    ...["points", "regions", "polygons", "lines"].flatMap((id) =>
      all.filter((item) => item.implicit && item.id === id),
    ),
    ...all.filter((item) => !item.implicit),
  ];
  for (const item of ordered) {
    const marks = layerMarks(item);
    const shaded =
      item.kind === "regions" || item.kind === "columns" ? item.regions : undefined;
    if (shaded) {
      counts.regions += shaded.items.length;
      regionSet ??= shaded.set;
      unmatched += shaded.unmatchedCount ?? 0;
      for (const code of shaded.unmatched ?? [])
        if (unmatchedCodes.length < MAP_LIMITS.unmatchedShown)
          unmatchedCodes.push(code);
    } else if (item.kind === "lines" || item.kind === "polygons") {
      counts.shapes += item.shapes.length;
      for (const one of item.shapes)
        for (const [lon, lat] of one.type === "line"
          ? one.coordinates
          : (one.coordinates[0] ?? []))
          grow(lon, lat);
    } else if (item.kind === "flows") {
      counts.flows += item.flows.length;
      for (const flow of item.flows) {
        grow(flow.from[0], flow.from[1]);
        grow(flow.to[0], flow.to[1]);
      }
    } else if (item.kind !== "source" && item.kind !== "image") {
      const dots = "points" in item ? (item.points ?? []) : [];
      counts.points += dots.length;
      for (const { lon, lat } of dots) grow(lon, lat);
    }
    const counted = {
      tag: new Set<string>(),
      marker: new Set<string>(),
      lit: new Set<string>(),
    };
    const first = (seen: Set<string>, mark: Marked, at: number) => {
      const place = mark.time === undefined ? String(at) : placeOf(mark, at);
      if (seen.has(place)) return false;
      seen.add(place);
      return true;
    };
    for (const [at, mark] of marks.entries()) {
      if (mark.value !== undefined) {
        low = Math.min(low, mark.value);
        high = Math.max(high, mark.value);
      }
      if (mark.tag !== undefined && first(counted.tag, mark, at)) tags++;
      if (mark.marker !== undefined && first(counted.marker, mark, at)) {
        marked++;
        const name =
          mark.label ??
          regionName(shaded?.set, mark) ??
          mark.tag ??
          (mark as { code?: string }).code;
        if (name !== undefined && markedLabels.length < MAP_LIMITS.summaryLabels)
          markedLabels.push(name);
      }
      if (mark.highlight && first(counted.lit, mark, at)) {
        highlighted++;
        if (mark.highlight === "building") buildings++;
      }
      if (mark.label !== undefined && labels.length < MAP_LIMITS.summaryLabels)
        labels.push(mark.label);
    }
  }
  const round = (n: number) => Math.round(n * 1e4) / 1e4;
  const basemapOff = mapAsks(spec).off;
  const frames = mapFrames(spec);
  const categories = mapCategories(spec);
  const listed: LayerSummary[] | undefined = spec.layers?.length
    ? all.map((item) => {
        const range = rangeOf(layerMarks(item));
        const shaded =
          item.kind === "regions" || item.kind === "columns" ? item.regions : undefined;
        return {
          id: item.id,
          kind: item.kind,
          ...(item.name ? { name: item.name } : {}),
          ...(item.valueLabel ? { valueLabel: item.valueLabel } : {}),
          count: layerMarks(item).length,
          ...(range ? { valueRange: range } : {}),
          ...(shaded ? { regionSet: shaded.set } : {}),
          ...(item.kind === "source" ? { source: item.source } : {}),
          ...(item.visible === false ? { hidden: true as const } : {}),
        };
      })
    : undefined;
  return {
    points: counts.points,
    regions: counts.regions,
    ...(regionSet ? { regionSet } : {}),
    shapes: counts.shapes,
    ...(counts.flows ? { flows: counts.flows } : {}),
    tags,
    ...(marked ? { marked } : {}),
    ...(markedLabels.length ? { markedLabels } : {}),
    ...(highlighted ? { highlighted } : {}),
    ...(buildings ? { buildings } : {}),
    ...(spec.title ? { title: spec.title } : {}),
    ...(spec.valueLabel ? { valueLabel: spec.valueLabel } : {}),
    ...(west <= east
      ? { bounds: [round(west), round(south), round(east), round(north)] as MapBounds }
      : {}),
    ...(low <= high ? { valueRange: [low, high] as [number, number] } : {}),
    ...(labels.length ? { labels } : {}),
    ...(unmatched ? { unmatched } : {}),
    ...(unmatchedCodes.length ? { unmatchedCodes } : {}),
    ...(spec.byName ? { byName: { ...spec.byName } } : {}),
    ...(listed ? { layers: listed } : {}),
    ...(frames.length
      ? {
          frames: frames.length,
          frameRange: [frames[0], frames[frames.length - 1]] as [string, string],
        }
      : {}),
    ...(frames.length ? { frame: mapOpeningFrame(spec, frames) } : {}),
    ...(categories.length ? { categories } : {}),
    ...(categories.length && spec.categoryLabel
      ? { categoryLabel: spec.categoryLabel }
      : {}),
    ...(spec.basemap?.source ? { basemapSource: spec.basemap.source } : {}),
    ...(spec.basemap?.choice ? { basemapPlain: true } : {}),
    ...(basemapOff.length ? { basemapOff: [...basemapOff] } : {}),
    ...(spec.boundaries?.length ? { boundaries: spec.boundaries } : {}),
    ...(spec.notes?.length ? { notes: spec.notes } : {}),
    ...(spec.context?.length ? { context: spec.context } : {}),
  };
}
