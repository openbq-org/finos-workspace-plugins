import type { Feature, FeatureCollection, Geometry, MultiLineString } from "geojson";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { type Boundaries, unbroken } from "./boundaries";
import type { RegionSetId } from "./regionTypes";

export interface RegionShapes {
  set: RegionSetId;
  part: string;
  shapes: FeatureCollection<Geometry, { code: string; name: string }>;
  borders: Feature<MultiLineString>;
  shapeOf: (
    id: string,
  ) => Feature<Geometry, { code: string; name: string }> | undefined;
}

type Regions = GeometryCollection<{ name?: string }>;

export function regionShapesOf(
  set: RegionSetId,
  part: string,
  topology: Topology,
): RegionShapes {
  const byId = new Map<string, Feature<Geometry, { code: string; name: string }>>();
  const regions = topology.objects.regions as Regions;
  for (const name of ["regions", "groups"]) {
    const object = topology.objects[name] as Regions | undefined;
    if (!object) continue;
    const collection = feature(topology, object) as FeatureCollection<
      Geometry,
      { name?: string }
    >;
    for (const shape of collection.features) {
      const code = String(shape.id);
      byId.set(code, {
        ...shape,
        geometry: unbroken(shape.geometry),
        properties: { code, name: String(shape.properties?.name ?? code) },
      });
    }
  }
  return {
    set,
    part,
    shapes: { type: "FeatureCollection", features: [...byId.values()] },
    borders: {
      type: "Feature",
      properties: {},
      geometry: unbroken(mesh(topology, regions, (a, b) => a !== b)),
    },
    shapeOf: (id) => byId.get(id),
  };
}

export const regionShapesOfBoundaries = (boundaries: Boundaries): RegionShapes => ({
  set: boundaries.set,
  part: "all",
  shapes: boundaries.shapes,
  borders: boundaries.borders,
  shapeOf: boundaries.shapeOf,
});
