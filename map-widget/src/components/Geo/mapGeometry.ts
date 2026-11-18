import type { Feature, FeatureCollection } from "geojson";
import { mapLayers } from "~/lib/geo/mapLayers";
import type { MapPoint } from "~/lib/geo/mapMarkTypes";
import type { MapSpec } from "~/lib/geo/mapSpecTypes";
import type { MapBounds } from "~/lib/geo/mapSummary";

const inUnitedStates = (lon: number, lat: number) =>
  lat > 13 && lat < 72 && (lon < -64 || lon > 144);

export function aboutUnitedStates(spec: MapSpec): boolean {
  const sets: string[] = [];
  const places: ([number, number] | undefined)[] = [];
  for (const layer of mapLayers(spec)) {
    switch (layer.kind) {
      case "source":
        break;
      case "image":
        places.push(...layer.image.corners);
        break;
      case "regions":
        if (layer.regions.items.length) sets.push(layer.regions.set);
        break;
      case "lines":
      case "polygons":
        for (const shape of layer.shapes)
          places.push(
            shape.type === "line" ? shape.coordinates[0] : shape.coordinates[0]?.[0],
          );
        break;
      case "flows":
        for (const flow of layer.flows) places.push(flow.from, flow.to);
        break;
      default:
        if (layer.kind === "columns" && layer.regions?.items.length)
          sets.push(layer.regions.set);
        for (const point of layer.points ?? []) places.push([point.lon, point.lat]);
    }
  }
  if (sets.length) return sets.every(meridian);
  return (
    places.length > 0 &&
    places.every((place) => place !== undefined && inUnitedStates(place[0], place[1]))
  );
}

export const SMALL_REGION_PIXELS = 14;
export const SMALL_REGION_DEGREES = 2;
export const SMALL_REGION_DOTS = 100;

export const SHAPE_MAX_ZOOM = 17;
export const SHAPE_FIT_ZOOM = 14;
export const STANDING_MAX_ZOOM = 19;
export const LOCAL_MAX_ZOOM = 14;
export {
  FEW_FIT_ZOOM,
  FEW_MARKS,
  LOCAL_FIT_ZOOM,
  LOCAL_SPAN_DEGREES,
} from "~/lib/geo/mapOpening";

export const collection = (features: Feature[]): FeatureCollection => ({
  type: "FeatureCollection",
  features,
});

export const grow = (
  box: MapBounds | null,
  more: MapBounds | null,
): MapBounds | null =>
  !more
    ? box
    : !box
      ? more
      : [
          Math.min(box[0], more[0]),
          Math.min(box[1], more[1]),
          Math.max(box[2], more[2]),
          Math.max(box[3], more[3]),
        ];

export const middle = (box: MapBounds | null): [number, number] | null =>
  box ? [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2] : null;

export function range(marks: readonly { value?: number }[]): [number, number] | null {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const { value } of marks)
    if (value !== undefined) {
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
  return low <= high ? [low, high] : null;
}

export const POINT_RADIUS_MAX = 22;

export function radii(points: readonly MapPoint[]): number[] {
  const largest = Math.max(0, ...points.map((point) => point.size ?? 0));
  const plain = points.length > 2000 ? 3 : points.length > 200 ? 4 : 6;
  return points.map((point) =>
    largest > 0 && point.size !== undefined
      ? Math.min(
          POINT_RADIUS_MAX,
          Math.max(3, 3 + 17 * Math.sqrt(point.size / largest)),
        )
      : plain,
  );
}

export const meridian = (set: string | undefined) => set?.startsWith("us-") ?? false;

export function viewBounds(
  bounds: MapBounds | null,
  closer = 0,
): [[number, number], [number, number]] {
  if (!bounds)
    return [
      [-170, -55],
      [180, 78],
    ];
  const [west, south, east, north] = bounds;
  const least = 2 ** -Math.max(0, closer);
  const pad = Math.max(0, 1.5 * least - (east - west)) / 2;
  const padLat = Math.max(0, least - (north - south)) / 2;
  return [
    [west - pad, Math.max(-60, south - padLat)],
    [east + pad, Math.min(80, north + padLat)],
  ];
}

type Ring = readonly (readonly [number, number])[];

function insideRings(x: number, y: number, rings: readonly Ring[]): boolean {
  let inside = false;
  for (const ring of rings)
    for (let at = 0, before = ring.length - 1; at < ring.length; before = at++) {
      const [ax, ay] = ring[at];
      const [bx, by] = ring[before];
      if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax)
        inside = !inside;
    }
  return inside;
}

export function insidePoint(rings: readonly Ring[]): [number, number] | null {
  const outline = rings[0];
  if (!outline?.length) return null;
  let area = 0;
  let cx = 0;
  let cy = 0;
  const [ox, oy] = outline[0];
  for (let at = 0, before = outline.length - 1; at < outline.length; before = at++) {
    const [ax, ay] = [outline[before][0] - ox, outline[before][1] - oy];
    const [bx, by] = [outline[at][0] - ox, outline[at][1] - oy];
    const cross = ax * by - bx * ay;
    area += cross;
    cx += (ax + bx) * cross;
    cy += (ay + by) * cross;
  }
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const [, y] of outline) {
    low = Math.min(low, y);
    high = Math.max(high, y);
  }
  if (area === 0 || low === high) return [outline[0][0], outline[0][1]];
  const centre: [number, number] = [ox + cx / (3 * area), oy + cy / (3 * area)];
  if (insideRings(centre[0], centre[1], rings)) return centre;
  const y = Math.min(high, Math.max(low, centre[1]));
  const at = y === low || y === high ? (low + high) / 2 : y;
  const crossings: number[] = [];
  for (const ring of rings)
    for (let next = 0, before = ring.length - 1; next < ring.length; before = next++) {
      const [ax, ay] = ring[next];
      const [bx, by] = ring[before];
      if (ay > at !== by > at) crossings.push(((bx - ax) * (at - ay)) / (by - ay) + ax);
    }
  crossings.sort((a, b) => a - b);
  let best: [number, number] | null = null;
  let widest = 0;
  for (let pair = 0; pair + 1 < crossings.length; pair += 2) {
    const wide = crossings[pair + 1] - crossings[pair];
    if (wide > widest) {
      widest = wide;
      best = [(crossings[pair] + crossings[pair + 1]) / 2, at];
    }
  }
  return best ?? centre;
}

export function liftPixels(
  east: readonly [number, number],
  north: readonly [number, number],
  metres: number,
  pitch: number,
): number {
  if (!(metres > 0) || !(pitch > 0)) return 0;
  const sum = east[0] ** 2 + east[1] ** 2 + north[0] ** 2 + north[1] ** 2;
  const cross = east[0] * north[1] - east[1] * north[0];
  const scale = Math.sqrt(
    (sum + Math.sqrt(Math.max(0, sum * sum - 4 * cross * cross))) / 2,
  );
  return scale * metres * Math.sin((pitch * Math.PI) / 180);
}
