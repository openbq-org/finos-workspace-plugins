import type { Feature, FeatureCollection, Geometry, MultiLineString } from "geojson";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { readAssetJson } from "~/host";
import type { MapBounds } from "../mapSummary";
import type { RegionSet } from "./codes";

export interface Boundaries {
  set: RegionSet;
  shapes: FeatureCollection<Geometry, { code: string; name: string }>;
  borders: Feature<MultiLineString>;
  outer?: Feature<MultiLineString>;
  land?: FeatureCollection;
  shapeOf: (
    code: string,
  ) => Feature<Geometry, { code: string; name: string }> | undefined;
}

type Regions = GeometryCollection<{ name?: string }>;

const lines = (geometry: MultiLineString): Feature<MultiLineString> => ({
  type: "Feature",
  properties: {},
  geometry: unbroken(geometry),
});

function continuous(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  if (!Array.isArray(value[0]) || typeof value[0][0] !== "number")
    return value.map(continuous);
  let shift = 0;
  let before: number | null = null;
  return (value as number[][]).map(([lon, lat]) => {
    if (before !== null && Math.abs(lon - before) > 180)
      shift += lon < before ? 360 : -360;
    before = lon;
    return [lon + shift, lat];
  });
}

export const unbroken = <G extends Geometry>(geometry: G): G =>
  "coordinates" in geometry
    ? ({ ...geometry, coordinates: continuous(geometry.coordinates) } as G)
    : geometry;

export function boundariesOf(set: RegionSet, topology: Topology): Boundaries {
  const object =
    set === "us-states" ? "states" : set === "us-counties" ? "counties" : set;
  const regions = topology.objects[object] as Regions;
  const collection = feature(topology, regions) as FeatureCollection<
    Geometry,
    { name?: string }
  >;
  const byCode = new Map<string, Feature<Geometry, { code: string; name: string }>>();
  for (const shape of collection.features) {
    if (shape.id === undefined || shape.id === null) continue;
    const code = String(shape.id);
    const name = String(shape.properties?.name ?? code);
    byCode.set(code, {
      ...shape,
      geometry: unbroken(shape.geometry),
      properties: { code, name },
    });
  }
  const states = topology.objects.states as Regions | undefined;
  return {
    set,
    shapes: { type: "FeatureCollection", features: [...byCode.values()] },
    borders: lines(mesh(topology, regions, (a, b) => a !== b)),
    ...(set === "us-counties" && states
      ? {
          outer: lines(mesh(topology, states, (a, b) => a !== b)),
          land: {
            type: "FeatureCollection",
            features: (feature(topology, states) as FeatureCollection).features.map(
              (shape) => ({ ...shape, geometry: unbroken(shape.geometry) }),
            ),
          },
        }
      : {}),
    shapeOf: (code) => byCode.get(code),
  };
}

const loaded = new Map<RegionSet, Promise<Boundaries>>();

const FILES: Record<RegionSet, string> = {
  "us-states": "us-atlas-3.0.1/states-10m.json",
  "us-counties": "us-atlas-3.0.1/counties-10m.json",
  countries: "world-atlas-2.0.2/countries-110m.json",
};

export function loadBoundaries(
  set: RegionSet,
  signal?: AbortSignal,
): Promise<Boundaries> {
  const kept = loaded.get(set);
  if (kept) return kept;
  const loading = readAssetJson<Topology>(`geo/${FILES[set]}`).then((topology) =>
    boundariesOf(set, topology),
  );
  loaded.set(set, loading);
  loading.catch(() => loaded.delete(set));
  return signal
    ? new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        loading.then(resolve, reject);
      })
    : loading;
}

export function boundsOf(shape: Feature<Geometry>, unwrap: boolean): MapBounds | null {
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  const visit = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number" && typeof value[1] === "number") {
      const lon = unwrap && value[0] > 0 ? value[0] - 360 : value[0];
      west = Math.min(west, lon);
      east = Math.max(east, lon);
      south = Math.min(south, value[1]);
      north = Math.max(north, value[1]);
    } else for (const item of value) visit(item);
  };
  if ("coordinates" in shape.geometry) visit(shape.geometry.coordinates);
  return west <= east ? [west, south, east, north] : null;
}
