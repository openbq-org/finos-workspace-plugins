import type { Feature, FeatureCollection, Geometry, Point } from "geojson";
import { MAP_LIMITS } from "~/lib/codemode/limits";
import { type MapBoundaryId, mapBoundary } from "./mapBoundaries";
import type { MapBounds } from "./mapSummary";
import { loadCities } from "./regions/cities";
import type { RegionIndex } from "./regions/regionTypes";
import { loadRegionIndex, loadRegionParts } from "./regions/registry";

export const BOUNDARY_CITIES = 4_000;

export interface BoundaryShapes {
  id: MapBoundaryId;
  key: string;
  outlines?: FeatureCollection<Geometry, { name: string }>;
  points?: FeatureCollection<Point, { name: string; rank: number }>;
}

const meets = (a: readonly number[], b: readonly number[]) =>
  a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

const middle = (box: readonly number[]): [number, number] => [
  (box[0] + box[2]) / 2,
  (box[1] + box[3]) / 2,
];

export function boundaryParts(index: RegionIndex, view: MapBounds | null): string[] {
  if (index.size <= MAP_LIMITS.shapes || index.parts.length <= 1)
    return index.parts.map((part) => part.id);
  const box = view ?? [-180, -90, 180, 90];
  const [lon, lat] = middle(box);
  const sizes = new Map<string, number>();
  for (const id of index.ids()) {
    const part = index.get(id)?.part;
    if (part !== undefined) sizes.set(part, (sizes.get(part) ?? 0) + 1);
  }
  const near = index.parts
    .filter((part) => meets(part.bounds, box))
    .map((part) => {
      const [x, y] = middle(part.bounds);
      return { id: part.id, far: Math.hypot(x - lon, y - lat) };
    })
    .sort((a, b) => a.far - b.far || a.id.localeCompare(b.id));
  const taken: string[] = [];
  let regions = 0;
  for (const part of near) {
    const size = sizes.get(part.id) ?? 0;
    if (taken.length && regions + size > MAP_LIMITS.shapes) break;
    taken.push(part.id);
    regions += size;
  }
  return taken.sort();
}

export async function boundaryKey(
  id: MapBoundaryId,
  view: MapBounds | null,
  signal?: AbortSignal,
): Promise<string> {
  const { set } = mapBoundary(id);
  if (!set) return id;
  const index = await loadRegionIndex(set, signal);
  return `${id}:${boundaryParts(index, view).join("+")}`;
}

export async function loadBoundaryShapes(
  id: MapBoundaryId,
  view: MapBounds | null,
  signal?: AbortSignal,
): Promise<BoundaryShapes> {
  const { set } = mapBoundary(id);
  if (!set) {
    const cities = (await loadCities()).largest(BOUNDARY_CITIES);
    return {
      id,
      key: id,
      points: {
        type: "FeatureCollection",
        features: cities.map((city, rank) => ({
          type: "Feature",
          properties: { name: city.name, rank },
          geometry: { type: "Point", coordinates: [city.lon, city.lat] },
        })),
      },
    };
  }
  const index = await loadRegionIndex(set, signal);
  const parts = boundaryParts(index, view);
  const files = await loadRegionParts(set, parts, signal);
  const features: Feature<Geometry, { name: string }>[] = [];
  for (const file of files)
    for (const shape of file.shapes.features)
      features.push({
        type: "Feature",
        properties: { name: shape.properties.name },
        geometry: shape.geometry,
      });
  return {
    id,
    key: `${id}:${parts.join("+")}`,
    outlines: { type: "FeatureCollection", features },
  };
}
