import { kmBetween } from "./geodesy";
import type { MapSpec } from "./mapSpecTypes";

export type CountedArea = "map-widget" | "view";

export function countedArea(
  view: { bounds?: readonly number[]; box?: readonly number[] } | undefined,
  widgetBox?: readonly number[],
): CountedArea {
  return !view?.bounds && (view?.box ?? widgetBox) ? "map-widget" : "view";
}

export const MARK_EDGE_PIXELS = 7;
const WORLD_PIXELS = 512;

export interface MarksInView {
  inside: number;
  of: number;
  nearestKm?: number;
}

export function marksInView(
  spec: Pick<MapSpec, "points" | "layers">,
  box: readonly number[] | undefined,
  zoom?: number,
): MarksInView | undefined {
  if (!box || box.length !== 4 || !box.every((value) => Number.isFinite(value)))
    return undefined;
  const middle: [number, number] = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
  const reach =
    zoom !== undefined && Number.isFinite(zoom)
      ? (MARK_EDGE_PIXELS * 360) / (WORLD_PIXELS * 2 ** zoom)
      : 0;
  const tall = reach * Math.cos((middle[1] * Math.PI) / 180);
  const west = box[0] - reach;
  const east = box[2] + reach;
  const south = box[1] - tall;
  const north = box[3] + tall;
  let inside = 0;
  let of = 0;
  let nearest = Number.POSITIVE_INFINITY;
  const read = (points: readonly { lat: number; lon: number }[]) => {
    for (const { lat, lon } of points) {
      if (!(Number.isFinite(lat) && Number.isFinite(lon))) continue;
      of++;
      if (lon >= west && lon <= east && lat >= south && lat <= north) inside++;
      else if (inside === 0) nearest = Math.min(nearest, kmBetween(middle, [lon, lat]));
    }
  };
  read(spec.points ?? []);
  for (const layer of spec.layers ?? []) if ("points" in layer) read(layer.points);
  if (of === 0) return undefined;
  return {
    inside,
    of,
    ...(inside === 0 && Number.isFinite(nearest)
      ? { nearestKm: Math.round(nearest) }
      : {}),
  };
}

export const IN_MAP_WIDGET_AREA = "in the area your Map shows";

export function inViewNote(
  found: MarksInView | undefined,
  area: CountedArea = "view",
): string | null {
  if (!found || found.inside === found.of) return null;
  const points = `${found.of.toLocaleString("en-US")} point${found.of === 1 ? "" : "s"}`;
  const where = area === "map-widget" ? IN_MAP_WIDGET_AREA : "in this view";
  return found.inside === 0
    ? `${found.of === 1 ? "The point is not" : `None of the ${points} are`} ${where}: Show all data fits the map to ${found.of === 1 ? "it" : "them"}.`
    : `${found.inside.toLocaleString("en-US")} of ${points} ${found.inside === 1 ? "is" : "are"} ${where}: Show all data fits the map to all of them.`;
}
