import { MAP_LIMITS } from "~/lib/codemode/limits";
import { MAP_ID } from "./mapLayers";
import { endpointProblem, urlProblem } from "./mapSourceAddress";
import {
  DEM_ENCODINGS,
  type DemEncoding,
  isTileKind,
  MAP_SOURCE_KINDS,
  type MapSourceDeclaration,
  type MapSourceDeclarations,
  type MapSourceFacts,
  type MapSourceKind,
  type MapSourceRole,
  type RefusedMapSource,
  type SourceStyleLayer,
} from "./mapSourceTypes";
import {
  finite,
  isPlain,
  mapColor,
  type Plain,
  text,
  UNPRINTED_CHARACTER,
} from "./mapValues";

const UNNAMED = new RegExp(UNPRINTED_CHARACTER);

class Refusal extends Error {}
const refuse = (reason: string): never => {
  throw new Refusal(reason);
};

const own = (raw: Plain, key: string): unknown =>
  Object.hasOwn(raw, key) ? raw[key] : undefined;

const given = (value: unknown) => value !== undefined && value !== null;

function within(value: unknown, min: number, max: number, what: string): number {
  if (!finite(value) || value < min || value > max)
    refuse(`"${what}" must be a number from ${min} to ${max}.`);
  return value as number;
}

function dataName(value: unknown, what: string): string {
  const max = MAP_LIMITS.sourceStyleNameChars;
  if (typeof value !== "string" || !value || value.length > max || UNNAMED.test(value))
    refuse(`"${what}" must be text of at most ${max} characters, on one line.`);
  return value as string;
}

const lonLat = (value: unknown): value is [number, number] =>
  Array.isArray(value) &&
  value.length === 2 &&
  finite(value[0]) &&
  finite(value[1]) &&
  Math.abs(value[0]) <= 180 &&
  Math.abs(value[1]) <= 90;

function boundsOf(value: unknown): [number, number, number, number] {
  const [west, south, east, north] = Array.isArray(value) ? value : [];
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !lonLat([west, south]) ||
    !lonLat([east, north]) ||
    west >= east ||
    south >= north
  )
    refuse(
      '"bounds" must be [west, south, east, north] in degrees, with west < east and south < north.',
    );
  return [west, south, east, north];
}

function colorOf(value: unknown): SourceStyleLayer["color"] {
  const plain = mapColor(value);
  if (plain) return plain;
  if (!isPlain(value))
    return refuse(
      'the "color" of a layer must be "#rgb" or "#rrggbb", or { property, scale, domain }.',
    );
  const scale = own(value, "scale");
  const domain = own(value, "domain");
  if (scale !== "sequential" && scale !== "diverging")
    refuse('the "scale" of a color must be "sequential" or "diverging".');
  if (
    !Array.isArray(domain) ||
    domain.length !== 2 ||
    !finite(domain[0]) ||
    !finite(domain[1]) ||
    domain[0] >= domain[1]
  )
    refuse('the "domain" of a color must be [min, max], two numbers with min < max.');
  return {
    property: dataName(own(value, "property"), "property"),
    scale: scale as "sequential" | "diverging",
    domain: [(domain as number[])[0], (domain as number[])[1]],
  };
}

function styleLayer(raw: unknown, tiled: boolean): SourceStyleLayer {
  if (!isPlain(raw)) return refuse("a layer must be an object.");
  const type = own(raw, "type");
  if (type !== "fill" && type !== "line" && type !== "circle")
    refuse('the "type" of a layer must be "fill", "line" or "circle".');
  const [opacity, width, radius, label] = ["opacity", "width", "radius", "label"].map(
    (key) => own(raw, key),
  );
  return {
    ...(tiled ? { sourceLayer: dataName(own(raw, "sourceLayer"), "sourceLayer") } : {}),
    type: type as SourceStyleLayer["type"],
    color: colorOf(own(raw, "color")),
    ...(given(opacity) ? { opacity: within(opacity, 0, 1, "opacity") } : {}),
    ...(given(width) ? { width: within(width, 0, 20, "width") } : {}),
    ...(given(radius) ? { radius: within(radius, 0, 40, "radius") } : {}),
    ...(given(label) ? { label: dataName(label, "label") } : {}),
  };
}

function styleLayers(raw: unknown, tiled: boolean): SourceStyleLayer[] {
  const max = MAP_LIMITS.sourceStyleLayers;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > max)
    return refuse(`"layers" must be a list of 1 to ${max} layers.`);
  return raw.map((item) => styleLayer(item, tiled));
}

function zoomOf(value: unknown, what: string): number {
  if (!Number.isInteger(value))
    refuse(`"${what}" must be a whole number from 0 to 22.`);
  return within(value, 0, 22, what);
}

function declaration(raw: Plain, id: string): MapSourceDeclaration {
  const kind = own(raw, "kind") as MapSourceKind;
  if (kind === ("cog" as unknown))
    refuse(
      'the kind "cog" is not supported yet. Serve the image as "raster-tiles" or as "pmtiles".',
    );
  if (typeof kind !== "string" || !MAP_SOURCE_KINDS.includes(kind))
    refuse(`"kind" must be one of ${MAP_SOURCE_KINDS.join(", ")}.`);
  const attribution = text(own(raw, "attribution"), MAP_LIMITS.attributionChars);
  if (typeof own(raw, "attribution") !== "string" || !attribution)
    return refuse(
      '"attribution" is required: text that says who the data is from. It is shown on the map.',
    );
  const [endpoint, url] = [own(raw, "endpoint"), own(raw, "url")];
  if (given(endpoint) === given(url))
    refuse('exactly one of "endpoint" and "url" says where the source is.');
  const tiles = isTileKind(kind);
  const problem = given(endpoint)
    ? endpointProblem(endpoint, tiles)
    : urlProblem(url, tiles);
  if (problem)
    refuse(`its ${given(endpoint) ? "endpoint" : "url"} is not taken: ${problem}.`);

  const rawLayers = own(raw, "layers");
  const vector =
    kind === "vector-tiles" ||
    kind === "geojson" ||
    (kind === "pmtiles" && given(rawLayers));
  if (kind === "vector-tiles" && !given(rawLayers))
    refuse('vector tiles need "layers" that say how their features are drawn.');
  const role = own(raw, "role") ?? "overlay";
  if (role !== "overlay" && role !== "imagery")
    refuse('"role" must be "overlay" or "imagery".');
  const relief = kind === "raster-dem";
  if (relief && role !== "overlay")
    refuse(
      'the "role" of elevation is "overlay": it is drawn as shaded relief over the basemap.',
    );
  const encoding = own(raw, "encoding");
  if (relief && !DEM_ENCODINGS.includes(encoding as DemEncoding))
    refuse(
      `"encoding" is required for elevation: one of ${DEM_ENCODINGS.join(", ")}, as the tiles write a height.`,
    );
  if (role === "imagery" && vector)
    refuse(
      'the role "imagery" is for pictures: raster-tiles, pmtiles without layers, and image.',
    );
  const [opacity, minzoom, maxzoom, bounds, tileSize, coordinates] = [
    "opacity",
    "minzoom",
    "maxzoom",
    "bounds",
    "tileSize",
    "coordinates",
  ].map((key) => own(raw, key));
  const zooms = {
    ...(given(minzoom) ? { minzoom: zoomOf(minzoom, "minzoom") } : {}),
    ...(given(maxzoom) ? { maxzoom: zoomOf(maxzoom, "maxzoom") } : {}),
  };
  if ((zooms.minzoom ?? 0) > (zooms.maxzoom ?? 22))
    refuse('"minzoom" must not be over "maxzoom".');
  if (given(tileSize) && tileSize !== 256 && tileSize !== 512)
    refuse('"tileSize" must be 256 or 512.');
  const corners = kind === "image" ? coordinates : undefined;
  if (
    kind === "image" &&
    !(Array.isArray(corners) && corners.length === 4 && corners.every(lonLat))
  )
    refuse(
      'an image needs "coordinates": its four corners as [lon, lat], top left, top right, bottom right, bottom left.',
    );
  return {
    id,
    name: text(own(raw, "name"), MAP_LIMITS.sourceNameChars) ?? id,
    kind,
    attribution,
    role: role as MapSourceRole,
    ...(given(endpoint) ? { endpoint: endpoint as string } : { url: url as string }),
    ...(given(opacity) ? { opacity: within(opacity, 0, 1, "opacity") } : {}),
    ...zooms,
    ...(given(bounds) ? { bounds: boundsOf(bounds) } : {}),

    ...(given(tileSize) && (kind === "raster-tiles" || kind === "pmtiles" || relief)
      ? { tileSize: tileSize as 256 | 512 }
      : {}),
    ...(relief ? { encoding: encoding as DemEncoding } : {}),
    ...(kind === "image"
      ? {
          coordinates: (corners as [number, number][]).map(([lon, lat]) => [
            lon,
            lat,
          ]) as MapSourceFacts["coordinates"],
        }
      : {}),
    ...(vector && given(rawLayers)
      ? { layers: styleLayers(rawLayers, kind !== "geojson") }
      : {}),
  };
}

export function mapSourceDeclarations(raw: unknown): MapSourceDeclarations {
  const sources: MapSourceDeclaration[] = [];
  const refused: RefusedMapSource[] = [];
  if (!given(raw)) return { sources, refused };
  if (!Array.isArray(raw)) {
    refused.push({ reason: '"sources" must be a list.' });
    return { sources, refused };
  }
  const seen = new Set<string>();
  for (let index = 0; index < Math.min(raw.length, MAP_LIMITS.sources); index++) {
    let id: string | undefined;
    try {
      const item: unknown = raw[index];
      if (!isPlain(item)) refuse("a source must be an object.");
      const named = own(item as Plain, "id");
      if (typeof named !== "string" || !MAP_ID.test(named))
        refuse(
          '"id" must be 1 to 40 characters of a-z, 0-9, "_" and "-", starting with a letter or a digit.',
        );
      id = named as string;
      if (seen.has(id)) refuse("another source of this widget has the same id.");
      seen.add(id);
      sources.push(declaration(item as Plain, id));
    } catch (error) {
      refused.push({
        ...(id === undefined ? {} : { id }),
        reason: error instanceof Refusal ? error.message : "it could not be read.",
      });
    }
  }
  if (raw.length > MAP_LIMITS.sources)
    refused.push({
      reason: `a widget declares at most ${MAP_LIMITS.sources} sources: the others are not read.`,
    });
  return { sources, refused };
}

export function declaredSourceIds(mapping: unknown): string[] {
  if (!isPlain(mapping)) return [];
  return mapSourceDeclarations(own(mapping, "sources")).sources.map(({ id }) => id);
}
