import { Collector } from "./collect";
import { MAP_MEMBER, memberOf } from "./convention";
import { GEO_FILE_LIMITS as LIMITS } from "./limits";
import type { GeoFileResult, GeoGeometry, GeoStyle } from "./types";
import { failFile } from "./types";
import { plainText } from "./xml";

function checkDepth(text: string): void {
  let depth = 0;
  let inString = false;
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at);
    if (inString) {
      if (code === 92) at++;
      else if (code === 34) inString = false;
    } else if (code === 34) inString = true;
    else if (code === 91 || code === 123) {
      if (++depth > LIMITS.jsonDepth)
        failFile(
          "too-large",
          `The JSON is nested more than ${LIMITS.jsonDepth} levels deep. GeoJSON never is.`,
        );
    } else if (code === 93 || code === 125) depth--;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const NESTING: Record<GeoGeometry["type"], number> = {
  Point: 0,
  MultiPoint: 1,
  LineString: 1,
  MultiLineString: 2,
  Polygon: 2,
  MultiPolygon: 3,
};

function nested(value: unknown, levels: number): boolean {
  if (!Array.isArray(value)) return false;
  if (levels === 0) return true;
  for (const item of value) if (!nested(item, levels - 1)) return false;
  return true;
}

const WGS84_NAMES =
  /^(?:urn:ogc:def:crs:ogc:(?:1\.3)?:crs84|urn:ogc:def:crs:epsg:[0-9.]*:4326|epsg:4326|crs:84|ogc:crs84|wgs ?84)$/i;

function checkCrs(crs: unknown): void {
  if (crs === undefined || crs === null) return;
  const name =
    isRecord(crs) && isRecord(crs.properties) && typeof crs.properties.name === "string"
      ? crs.properties.name.trim()
      : "";
  if (WGS84_NAMES.test(name)) return;
  const shown = /^[A-Za-z0-9:. _-]{1,60}$/.test(name) ? ` (${name})` : "";
  failFile(
    "unsupported-projection",
    `The GeoJSON names a reference system${shown} that is not longitude and latitude on WGS84. Re-export it as WGS84 (EPSG:4326).`,
  );
}

const STYLE_KEYS = new Set([
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "fill",
  "fill-opacity",
  "marker-color",
  "marker-size",
  "marker-symbol",
]);

function styleOf(properties: Record<string, unknown>): GeoStyle | undefined {
  const style: GeoStyle = {};
  const color = properties.color ?? properties.stroke ?? properties["marker-color"];
  if (typeof color === "string") style.color = color;
  if (typeof properties.fill === "string") style.fillColor = properties.fill;
  if (typeof properties["stroke-width"] === "number")
    style.lineWidth = properties["stroke-width"];
  if (typeof properties["fill-opacity"] === "number")
    style.fillOpacity = properties["fill-opacity"];
  return Object.keys(style).length > 0 ? style : undefined;
}

function* entriesOf(
  properties: Record<string, unknown>,
  grouped: boolean,
): Generator<readonly [string, unknown]> {
  for (const key of Object.keys(properties))
    if (!STYLE_KEYS.has(key) && key !== "description" && !(grouped && key === "layer"))
      yield [key, properties[key]];
}

export function readGeoJson(text: string): GeoFileResult {
  checkDepth(text);
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return failFile(
      "malformed",
      "The file is JSON that cannot be read: it is cut short or has a mistake.",
    );
  }
  if (!isRecord(root) || typeof root.type !== "string")
    return failFile(
      "unknown-format",
      'The file is JSON but not GeoJSON: it has no "type". A map file is a FeatureCollection, a Feature or a geometry.',
    );
  if (root.type === "Topology")
    return failFile(
      "unknown-format",
      "The file is TopoJSON, which is not read. Convert it to GeoJSON.",
    );
  checkCrs(root.crs);
  const collector = new Collector();
  let without = 0;
  let unknown = 0;
  const layers = new Map<string, number | undefined>();
  const layerOf = (properties: Record<string, unknown>): number | undefined => {
    const name = properties.layer;
    if (typeof name !== "string" || !name.trim()) return undefined;
    if (!layers.has(name)) layers.set(name, collector.group(name));
    return layers.get(name);
  };

  const geometry = (
    raw: unknown,
    properties: Record<string, unknown>,
    depth: number,
  ): void => {
    if (raw === null || raw === undefined) {
      without++;
      return;
    }
    if (!isRecord(raw) || typeof raw.type !== "string") {
      unknown++;
      return;
    }
    if (raw.type === "GeometryCollection") {
      if (!Array.isArray(raw.geometries) || depth >= LIMITS.geometryDepth) {
        unknown++;
        return;
      }
      for (const part of raw.geometries) {
        if (collector.full) {
          collector.count("featuresCut");
          break;
        }
        geometry(part, properties, depth + 1);
      }
      return;
    }
    if (!Object.hasOwn(NESTING, raw.type)) {
      unknown++;
      return;
    }
    const type = raw.type as GeoGeometry["type"];
    if (!nested(raw.coordinates, NESTING[type])) {
      collector.count("badGeometry");
      return;
    }
    const group = layerOf(properties);
    collector.add({
      geometry: { type, coordinates: raw.coordinates } as GeoGeometry,
      properties: entriesOf(properties, group !== undefined),
      ...(group === undefined ? {} : { group }),
      description:
        typeof properties.description === "string"
          ? plainText(properties.description)
          : undefined,
      style: styleOf(properties),
      nameFromProperties: true,
    });
  };

  const feature = (raw: unknown): void => {
    if (!isRecord(raw)) {
      unknown++;
      return;
    }
    if (raw.type === "Feature")
      geometry(raw.geometry, isRecord(raw.properties) ? raw.properties : {}, 0);
    else geometry(raw, {}, 0);
  };

  if (root.type === "FeatureCollection") {
    if (!Array.isArray(root.features))
      return failFile("malformed", 'The FeatureCollection has no "features" list.');
    for (const item of root.features) {
      if (collector.full) {
        collector.count("featuresCut");
        break;
      }
      feature(item);
    }
  } else feature(root);

  if (without > 0)
    collector.note(
      `${without.toLocaleString("en-US")} ${without === 1 ? "feature has" : "features have"} no geometry and ${without === 1 ? "is" : "are"} not on the map.`,
    );
  if (unknown > 0)
    collector.note(
      `${unknown.toLocaleString("en-US")} ${unknown === 1 ? "item is" : "items are"} not a GeoJSON feature or geometry and ${unknown === 1 ? "was" : "were"} left out.`,
    );
  const title =
    root.type === "FeatureCollection" && typeof root.name === "string"
      ? collector.label(root.name, LIMITS.nameChars)
      : undefined;
  const map = memberOf(root[MAP_MEMBER]);
  return {
    ...collector.finish("geojson"),
    ...(title === undefined ? {} : { title }),
    ...(map === undefined ? {} : { map }),
  };
}
