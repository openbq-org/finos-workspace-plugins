import { MAP_LIMITS } from "~/lib/codemode/limits";
import { MAP_MEMBER, memberOf } from "./files/convention";
import { conventionMark, type FileAsks, fileAsks, flatNote } from "./mapFileConvention";
import { partMarks } from "./mapFileMarks";
import { isPlain, type Plain, text } from "./mapValues";
import { tooManyPoints, tooManyShapes } from "./markBudget";

export interface MapInput {
  points: unknown[];
  shapes: unknown[];
  title?: string;
  notes?: string[];
  asks?: FileAsks;
}

const first = (properties: Plain, names: readonly string[]) => {
  for (const name of names)
    if (Object.hasOwn(properties, name) && properties[name] != null)
      return properties[name];
  return undefined;
};

const MARK_KEYS = new Set([
  "label",
  "name",
  "title",
  "tag",
  "value",
  "size",
  "color",
  "marker-color",
  "stroke",
  "fill",
]);

export interface GeoJsonNames {
  value?: string;
  height?: string;
  category?: string;
}

const categoryOf = (properties: Plain, key: string): string | undefined => {
  const value = Object.hasOwn(properties, key) ? properties[key] : undefined;
  return value === undefined ||
    value === null ||
    value === "" ||
    typeof value === "object"
    ? undefined
    : String(value);
};

function markOf(
  properties: unknown,
  names: GeoJsonNames,
  played: boolean,
  categorized: boolean,
): Plain {
  if (!isPlain(properties)) return {};
  const said = conventionMark(properties);
  const props: Plain = {};
  for (const [key, value] of Object.entries(said.rest))
    if (!MARK_KEYS.has(key) && (value === null || typeof value !== "object"))
      props[key] = value;
  const by = names.category ?? (categorized ? "category" : undefined);
  const category = by === undefined ? undefined : categoryOf(properties, by);
  if (names.category === undefined && category !== undefined) delete props.category;
  const time = played
    ? text(first(properties, ["time"]), MAP_LIMITS.frameChars)
    : undefined;
  if (time !== undefined) delete props.time;
  return {
    label: first(properties, ["label", "name", "title"]),
    ...said.mark,
    value: first(properties, [...(names.value ? [names.value] : []), "value"]),
    size: first(properties, ["size"]),
    color: first(properties, ["color", "marker-color", "stroke", "fill"]),
    ...(category === undefined ? {} : { category }),
    ...(time === undefined ? {} : { time }),
    props,
  };
}

function standing(properties: unknown, names: GeoJsonNames): Plain {
  if (!isPlain(properties)) return {};
  const height = first(properties, [...(names.height ? [names.height] : []), "height"]);
  const { floors } = properties;
  return typeof height === "number"
    ? { height }
    : typeof floors === "number"
      ? { floors }
      : {};
}

export function geoJsonInput(raw: unknown, names: GeoJsonNames = {}): MapInput {
  const input: MapInput = { points: [], shapes: [] };
  const found = { points: 0, shapes: 0 };
  const multi = { features: 0, parts: 0 };
  const point = (make: () => MapInput["points"][number]) => {
    if (++found.points <= MAP_LIMITS.points) input.points.push(make());
  };
  const shape = (make: () => MapInput["shapes"][number]) => {
    if (++found.shapes <= MAP_LIMITS.shapes) input.shapes.push(make());
  };
  const geometry = (given: unknown, mark: Plain, depth: number, tall: Plain = {}) => {
    if (!isPlain(given)) return;
    const { type, coordinates } = given;
    const sized = (part: unknown): number =>
      !Array.isArray(part)
        ? 0
        : type === "MultiPolygon"
          ? Array.isArray(part[0])
            ? part[0].length
            : 0
          : part.length;
    const marks =
      Array.isArray(coordinates) && type !== "Point" && String(type).startsWith("Multi")
        ? partMarks(mark, coordinates.slice(0, MAP_LIMITS.shapes + 1).map(sized))
        : [];
    let part = 0;
    const each = (add: (part: unknown, mark: object) => void) => {
      if (Array.isArray(coordinates))
        for (const item of coordinates) add(item, marks[part++] ?? mark);
    };
    const parts = (add: (part: unknown, mark: object) => void) => {
      multi.features++;
      multi.parts += Array.isArray(coordinates) ? coordinates.length : 0;
      each(add);
    };
    const pointAt = (place: unknown, of: object = mark) =>
      point(() => ({
        ...of,
        lon: Array.isArray(place) ? place[0] : undefined,
        lat: Array.isArray(place) ? place[1] : undefined,
      }));
    const line = (path: unknown, of: object = mark) =>
      shape(() => ({ ...of, type: "line", coordinates: path }));
    const area = (rings: unknown, of: object = mark) =>
      shape(() => ({ ...of, ...tall, type: "polygon", coordinates: rings }));
    if (type === "Point") pointAt(coordinates);
    else if (type === "MultiPoint") each(pointAt);
    else if (type === "LineString") line(coordinates);
    else if (type === "MultiLineString") parts(line);
    else if (type === "Polygon") area(coordinates);
    else if (type === "MultiPolygon") parts(area);
    else if (
      type === "GeometryCollection" &&
      depth < 4 &&
      Array.isArray(given.geometries)
    )
      for (const part of given.geometries) geometry(part, mark, depth + 1, tall);
  };
  const asks = fileAsks(isPlain(raw) ? memberOf(raw[MAP_MEMBER]) : undefined);
  const layers = new Set<unknown>();
  const legend: { valueLabel?: string; sizeLabel?: string } = {};
  const feature = (item: unknown) => {
    if (isPlain(item) && item.type === "Feature" && isPlain(item.properties)) {
      const { layer, valueLabel, sizeLabel } = item.properties;
      if (typeof layer === "string" && layers.size <= MAP_LIMITS.layers)
        layers.add(layer);
      if (legend.valueLabel === undefined && typeof valueLabel === "string")
        legend.valueLabel = valueLabel;
      if (legend.sizeLabel === undefined && typeof sizeLabel === "string")
        legend.sizeLabel = sizeLabel;
    }
    if (isPlain(item) && item.type === "Feature")
      geometry(
        item.geometry,
        found.points >= MAP_LIMITS.points && found.shapes >= MAP_LIMITS.shapes
          ? {}
          : markOf(item.properties, names, asks.time === true, asks.category === true),
        0,
        standing(item.properties, names),
      );
  };
  if (!isPlain(raw))
    throw new Error(
      'output.map: "geojson" must be a GeoJSON object: a FeatureCollection, a Feature or a geometry.',
    );
  if (raw.type === "FeatureCollection" && Array.isArray(raw.features)) {
    for (const item of raw.features) feature(item);
  } else if (raw.type === "Feature") feature(raw);
  else geometry(raw, {}, 0);
  if (found.shapes > MAP_LIMITS.shapes)
    return tooManyShapes(found.shapes, "the GeoJSON", multi);
  if (found.points > MAP_LIMITS.points) return tooManyPoints(found.points);
  const title =
    raw.type === "FeatureCollection"
      ? text(raw.name, MAP_LIMITS.titleChars)
      : undefined;
  if (title !== undefined) input.title = title;
  if (layers.size > 1) input.notes = [flatNote(layers.size)];
  input.asks = { ...asks, layers: undefined, ...legend };
  return input;
}
