import { MAP_LIMITS } from "~/lib/codemode/limits";
import type { MapPoint, MapRegion } from "~/lib/geo/mapMarkTypes";
import type { CameraNow } from "./cardActions";
import type { Shown } from "./widget";

export const STATIC_WIDGET = "map";
export const STATIC_POINTS = 200;
export const STATIC_REGIONS = 250;
const STATIC_SETS: readonly string[] = ["us-states", "countries"];
const LABEL_CHARS = 80;
const TAG_CHARS = 40;
const TITLE_CHARS = 120;

export interface StaticMap {
  data: Record<string, unknown>;
  points: number;
  regions: number;
  notice: string;
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const round = (value: number, places: number) => Number(value.toFixed(places));

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const clip = (value: unknown, max: number): string | undefined =>
  typeof value === "string" && value.length > 0 ? value.slice(0, max) : undefined;

const marks = (label: unknown, tag: unknown, value: unknown) => {
  const shownLabel = clip(label, LABEL_CHARS);
  const shownTag = clip(tag, TAG_CHARS);
  return {
    ...(shownLabel === undefined ? {} : { label: shownLabel }),
    ...(shownTag === undefined ? {} : { tag: shownTag }),
    ...(finite(value) ? { value } : {}),
  };
};

const pointOf = (point: MapPoint) => ({
  lat: round(point.lat, 6),
  lon: round(point.lon, 6),
  ...marks(point.label, point.tag, point.value),
});

const regionOf = (region: MapRegion) => ({
  code: region.code.slice(0, MAP_LIMITS.regionCodeChars),
  ...marks(region.label, region.tag, region.value),
});

function viewOf(camera: CameraNow | null) {
  if (!camera) return undefined;
  const { latitude, longitude, zoom, bearing, pitch } = camera;
  if (![latitude, longitude, zoom, bearing, pitch].every(finite)) return undefined;
  return {
    center: {
      lat: round(clamp(latitude, -90, 90), 5),
      lon: round(((((longitude + 180) % 360) + 360) % 360) - 180, 5),
    },
    zoom: round(clamp(zoom, 0, MAP_LIMITS.viewZoom), 2),
    bearing: round(clamp(bearing, -180, 180), 1),
    pitch: round(clamp(pitch, 0, MAP_LIMITS.pitch), 1),
  };
}

const places = (count: number) => `${count.toLocaleString("en-US")} places`;

export function staticMap({ spec, name, notes, shapes }: Shown, camera: CameraNow | null): StaticMap | null {
  const allPoints = spec.points.filter((point) => finite(point.lat) && finite(point.lon));
  const regions = spec.regions && STATIC_SETS.includes(spec.regions.set) ? spec.regions : undefined;
  const allRegions = regions?.items ?? [];
  if (!allPoints.length && !allRegions.length) return null;
  const points = allPoints.slice(0, STATIC_POINTS).map(pointOf);
  const items = allRegions.slice(0, STATIC_REGIONS).map(regionOf);
  const title = clip(spec.title ?? name, TITLE_CHARS);
  const valueLabel = clip(spec.valueLabel, TITLE_CHARS);
  const view = viewOf(camera);
  const data = {
    ...(title === undefined ? {} : { title }),
    ...(valueLabel === undefined ? {} : { valueLabel }),
    ...(points.length ? { points } : {}),
    ...(regions && items.length ? { regions: { set: regions.set, items } } : {}),
    ...(view ? { view } : {}),
  };
  const left: string[] = [];
  if (points.length < allPoints.length)
    left.push(`the first ${places(points.length)} of ${places(allPoints.length)} are kept`);
  if (items.length < allRegions.length)
    left.push(`the first ${items.length.toLocaleString("en-US")} of ${allRegions.length.toLocaleString("en-US")} regions are kept`);
  if (spec.shapes.length || (spec.regions && !regions))
    left.push("lines, areas and other region sets are not copied");
  if (Object.keys(notes).length || shapes.length) left.push("your tags and drawn shapes are not copied");
  return {
    data,
    points: points.length,
    regions: items.length,
    notice: left.length ? `Static map created: ${left.join("; ")}.` : "Static map created.",
  };
}
