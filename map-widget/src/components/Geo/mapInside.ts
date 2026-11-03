import type { Position } from "~/lib/geo/geodesy";
import type { MapLayer } from "~/lib/geo/mapLayers";
import {
  isDeferredSet,
  type MapFlow,
  type MapPoint,
  type MapRegions,
  type MapShape,
} from "~/lib/geo/mapMarkTypes";
import { type DrawnShape, enclosing, shapeHolds, shapeRing } from "~/lib/geo/mapShapes";
import type { MapSpec } from "~/lib/geo/mapSpecTypes";
import { regionOf } from "~/lib/geo/regions/codes";
import { loadedRegionIndex, matchRegion, regionInfo } from "~/lib/geo/regions/registry";
import { insidePoint } from "./mapGeometry";

interface Holder {
  shape: DrawnShape;
  box: [number, number, number, number] | null;
}

function holderOf(shape: DrawnShape): Holder {
  const ring = shapeRing(shape) ?? [];
  let [west, south, east, north] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  for (const [x, y] of ring) {
    if (x < west) west = x;
    if (x > east) east = x;
    if (y < south) south = y;
    if (y > north) north = y;
  }
  const everywhere = shape.kind === "circle" && east - west >= 359;
  return { shape, box: everywhere ? null : [west, south, east, north] };
}

function held(holders: readonly Holder[], place: Position | null | undefined): boolean {
  if (!place) return false;
  const [x, y] = place;
  for (const { shape, box } of holders) {
    if (box) {
      if (y < box[1] - 1e-9 || y > box[3] + 1e-9) continue;
      const within = (at: number) => at >= box[0] - 1e-9 && at <= box[2] + 1e-9;
      if (!within(x) && !within(x + 360) && !within(x - 360)) continue;
    }
    if (shapeHolds(shape, place)) return true;
  }
  return false;
}

function regionPlace(regions: MapRegions, code: string): Position | null {
  if (!isDeferredSet(regions.set)) return regionOf(regions.set, code)?.centre ?? null;
  if (!loadedRegionIndex(regions.set)) return null;
  const match = matchRegion(regions.set, code, regions.within);
  return match && "id" in match
    ? (regionInfo(regions.set, match.id)?.centroid ?? null)
    : null;
}

const shapePlace = (shape: MapShape): Position | null =>
  shape.type === "polygon"
    ? insidePoint(shape.coordinates)
    : (shape.coordinates[Math.floor(shape.coordinates.length / 2)] ?? null);

export interface InsideMap {
  spec: MapSpec;
  kept: number;
  total: number;
}

export function insideMap(spec: MapSpec, shapes: readonly DrawnShape[]): InsideMap {
  const holders = shapes.filter(enclosing).map(holderOf);
  if (!holders.length) return { spec, kept: 0, total: 0 };
  let kept = 0;
  let total = 0;
  const count = <T>(marks: readonly T[], inside: (mark: T) => boolean): T[] => {
    const left = marks.filter(inside);
    total += marks.length;
    kept += left.length;
    return left;
  };
  const points = (marks: readonly MapPoint[]) =>
    count(marks, (point) => held(holders, [point.lon, point.lat]));
  const shaped = (marks: readonly MapShape[]) =>
    count(marks, (shape) => held(holders, shapePlace(shape)));
  const shaded = (regions: MapRegions): MapRegions => ({
    ...regions,
    items: count(regions.items, (item) =>
      held(holders, regionPlace(regions, item.code)),
    ),
  });
  const flows = (marks: readonly MapFlow[]) =>
    count(marks, (flow) => held(holders, flow.from) && held(holders, flow.to));
  const layer = (item: MapLayer): MapLayer => {
    switch (item.kind) {
      case "regions":
        return { ...item, regions: shaded(item.regions) };
      case "points":
      case "heat":
      case "clusters":
        return { ...item, points: points(item.points) };
      case "lines":
      case "polygons":
        return { ...item, shapes: shaped(item.shapes) };
      case "flows":
        return { ...item, flows: flows(item.flows) };
      case "columns":
        return {
          ...item,
          ...(item.points ? { points: points(item.points) } : {}),
          ...(item.regions ? { regions: shaded(item.regions) } : {}),
        };
      default:
        return item;
    }
  };
  const filtered: MapSpec = {
    ...spec,
    points: points(spec.points),
    ...(spec.regions ? { regions: shaded(spec.regions) } : {}),
    shapes: shaped(spec.shapes),
    ...(spec.layers ? { layers: spec.layers.map(layer) } : {}),
  };
  return { spec: filtered, kept, total };
}
