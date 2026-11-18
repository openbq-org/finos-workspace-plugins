import type { GeoFeature, GeoGeometry } from "./files";
import { conventionMark } from "./mapFileConvention";
import type { FileSteps } from "./mapFileSteps";
import { finite } from "./mapValues";

export function markOf(
  feature: GeoFeature,
  valueKey: string | undefined,
  categoryKey: string | undefined,
  played: FileSteps | undefined,
  heightKey?: string,
) {
  const { properties, style } = feature;
  const own = (key: string | undefined) =>
    key !== undefined && Object.hasOwn(properties, key) ? properties[key] : undefined;
  const said = conventionMark(properties);
  const value = own(valueKey ?? "value");
  const named = own(categoryKey);
  const category =
    named === undefined || named === null || named === "" ? undefined : String(named);
  const height = own(heightKey ?? "height");
  const floors = heightKey === undefined ? own("floors") : undefined;
  const time =
    played && Object.hasOwn(properties, played.key)
      ? played.steps.get(properties[played.key])
      : undefined;
  const rest = { ...said.rest };
  if (valueKey === undefined && finite(value)) delete rest.value;
  if (categoryKey === "category" && category !== undefined) delete rest.category;
  if (time !== undefined && played?.key === "time") delete rest.time;
  if (rest.name === feature.name) delete rest.name;
  const ofStyle = style?.color ?? style?.fillColor;
  return {
    label: feature.name,
    ...said.mark,
    ...(finite(value) ? { value } : {}),
    color:
      said.mark.color ??
      (category !== undefined || (valueKey === undefined && finite(value))
        ? undefined
        : ofStyle),
    ...(category === undefined ? {} : { category }),
    props: {
      ...(feature.description ? { description: feature.description } : {}),
      ...rest,
    },
    ...(time === undefined ? {} : { time }),
    ...(finite(height) ? { height } : finite(floors) ? { floors } : {}),
  };
}

export const legendOf = (feature: GeoFeature) => {
  const { valueLabel, sizeLabel } = conventionMark(feature.properties);
  return { valueLabel, sizeLabel };
};

const APART = ["tag", "marker", "markerColor", "highlight", "meaning"] as const;

export function partMarks(mark: object, sizes: readonly number[]): object[] {
  if (sizes.length < 2) return sizes.map(() => mark);
  const plain: Record<string, unknown> = { ...mark };
  for (const key of APART) delete plain[key];
  const largest = sizes.indexOf(Math.max(...sizes));
  return sizes.map((_size, at) => (at === largest ? mark : plain));
}

export type Kind = "points" | "lines" | "polygons";

export function marksOf(
  geometry: GeoGeometry,
  mark: object,
  into: Record<Kind, unknown[]>,
) {
  switch (geometry.type) {
    case "Point":
      into.points.push({
        lon: geometry.coordinates[0],
        lat: geometry.coordinates[1],
        ...mark,
      });
      break;
    case "MultiPoint": {
      const marks = partMarks(
        mark,
        geometry.coordinates.map(() => 1),
      );
      geometry.coordinates.forEach(([lon, lat], at) => {
        into.points.push({ lon, lat, ...marks[at] });
      });
      break;
    }
    case "LineString":
      into.lines.push({ type: "line", coordinates: geometry.coordinates, ...mark });
      break;
    case "MultiLineString": {
      const marks = partMarks(
        mark,
        geometry.coordinates.map((line) => line.length),
      );
      geometry.coordinates.forEach((coordinates, at) => {
        into.lines.push({ type: "line", coordinates, ...marks[at] });
      });
      break;
    }
    case "Polygon":
      into.polygons.push({
        type: "polygon",
        coordinates: geometry.coordinates,
        ...mark,
      });
      break;
    case "MultiPolygon": {
      const marks = partMarks(
        mark,
        geometry.coordinates.map((rings) => ringArea(rings[0] ?? [])),
      );
      geometry.coordinates.forEach((coordinates, at) => {
        into.polygons.push({ type: "polygon", coordinates, ...marks[at] });
      });
      break;
    }
  }
}

function ringArea(ring: readonly (readonly number[])[]): number {
  let sum = 0;
  for (let at = 0; at + 1 < ring.length; at++)
    sum += ring[at][0] * ring[at + 1][1] - ring[at + 1][0] * ring[at][1];
  return Math.abs(sum) / 2;
}
