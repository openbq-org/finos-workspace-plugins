import type { MapPoint, MapRegions, MapShape } from "./mapMarkTypes";
import { mapShapes, shapeFacts } from "./mapShapes";
import { mapShows } from "./mapShows";
import { isReducedMap, mapSpec } from "./mapSpec";
import type { MapSpec } from "./mapSpecTypes";
import { mapSummary } from "./mapSummary";
import { mapViewState, viewFacts } from "./mapViewState";
import { loadedCities } from "./regions/cities";
import { regionOf } from "./regions/codes";

export interface MapRow {
  place: string;
  label: string;
  value: number | null;
  tag: string;
}

export function mapRows(spec: MapSpec, limit = Number.POSITIVE_INFINITY): MapRow[] {
  const rows: MapRow[] = [];
  const add = (place: string, mark: { label?: string; value?: number; tag?: string }) =>
    rows.length < limit &&
    rows.push({
      place,
      label: mark.label ?? "",
      value: mark.value ?? null,
      tag: mark.tag ?? "",
    });
  const shaded = (regions: MapRegions) => {
    for (const item of regions.items) {
      const known = regionOf(regions.set, item.code);
      add(known ? `${known.name} (${known.short})` : item.code, item);
    }
  };
  if (spec.regions) shaded(spec.regions);
  const dots = (points: readonly MapPoint[]) => {
    for (const point of points)
      add(`${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}`, point);
  };
  const drawn = (shapes: readonly MapShape[]) => {
    for (const shape of shapes) add(shape.type === "line" ? "Line" : "Area", shape);
  };
  dots(spec.points);
  drawn(spec.shapes);
  for (const layer of spec.layers ?? []) {
    if (rows.length >= limit) break;
    if (layer.kind === "regions") shaded(layer.regions);
    else if (layer.kind === "lines" || layer.kind === "polygons") drawn(layer.shapes);
    else if (layer.kind === "flows") for (const flow of layer.flows) add("Flow", flow);
    else if (layer.kind === "columns") {
      if (layer.regions) shaded(layer.regions);
      dots(layer.points ?? []);
    } else if ("points" in layer) dots(layer.points ?? []);
  }
  return rows;
}

export const MAP_CONTEXT_ROWS = 300;

export function mapText(raw: unknown, drawn?: unknown, view?: unknown): string {
  const spec = isReducedMap(raw) ? raw : mapSpec(raw);
  const shapes = shapeFacts(mapShapes(drawn));
  const summary = mapSummary(spec);
  const total =
    summary.points + summary.regions + summary.shapes + (summary.flows ?? 0);
  const state = mapViewState(view);
  const { camera } = state;
  return JSON.stringify({
    map: summary,
    shows: mapShows(spec, { view: state, camera, cities: loadedCities() }),
    ...(camera ? { view: viewFacts(camera) } : {}),
    ...(shapes ? { drawn_shapes: shapes } : {}),
    rows: mapRows(spec, MAP_CONTEXT_ROWS),
    ...(total > MAP_CONTEXT_ROWS ? { rows_truncated: true } : {}),
  });
}

export const NO_MAP: MapSpec = { points: [], shapes: [] };
export const isNoMap = (spec: MapSpec) =>
  spec.points.length === 0 &&
  spec.shapes.length === 0 &&
  !spec.regions?.items.length &&
  !spec.layers?.length;
