import type { LayerSpecification, SourceSpecification } from "maplibre-gl";
import { MAP_LIMITS } from "~/lib/codemode/limits";
import {
  DEM_ENCODINGS,
  type HeldMapSource,
  type SourceStyleLayer,
} from "~/lib/geo/mapSourceTypes";
import { mapColor } from "~/lib/geo/mapValues";
import type { MapTheme } from "./mapTheme";
import type { SceneLayer } from "./sceneLayer";
import type { MapSources } from "./useMapSources";

export const NOT_CONNECTED = "This source is not connected.";
export const AMBIGUOUS = "Two connected backends declare this source.";
export const NOT_LOADED = "Could not be loaded.";

export function heldSource(
  held: MapSources,
  id: string,
): { source: HeldMapSource } | { note: string } {
  if (held.ambiguous.includes(id)) return { note: AMBIGUOUS };
  const source = held.sources.find((item) => item.id === id);
  return source ? { source } : { note: NOT_CONNECTED };
}

const clamp = (value: unknown, min: number, max: number, otherwise: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : otherwise;

const isRaster = (source: HeldMapSource) =>
  source.kind === "raster-tiles" ||
  source.kind === "image" ||
  (source.kind === "pmtiles" && !source.layers?.length);

function styleSource(source: HeldMapSource): SourceSpecification | null {
  const zooms = {
    ...(source.minzoom === undefined ? {} : { minzoom: source.minzoom }),
    ...(source.maxzoom === undefined ? {} : { maxzoom: source.maxzoom }),
    ...(source.bounds ? { bounds: source.bounds } : {}),
  };
  switch (source.kind) {
    case "raster-tiles":
      return {
        type: "raster",
        tiles: [source.url],
        tileSize: source.tileSize ?? 256,
        ...zooms,
      };
    case "vector-tiles":
      return { type: "vector", tiles: [source.url], ...zooms };
    case "pmtiles":
      return source.layers?.length
        ? { type: "vector", url: `pmtiles://${source.url}` }
        : {
            type: "raster",
            url: `pmtiles://${source.url}`,
            tileSize: source.tileSize ?? 256,
          };
    case "raster-dem":
      return source.encoding && DEM_ENCODINGS.includes(source.encoding)
        ? {
            type: "raster-dem",
            tiles: [source.url],
            tileSize: source.tileSize ?? 256,
            encoding: source.encoding,
            ...zooms,
          }
        : null;
    case "geojson":
      return { type: "geojson", data: source.url };
    case "image":
      return source.coordinates
        ? {
            type: "image",
            url: source.url,
            coordinates: source.coordinates,
          }
        : null;
    default:
      return null;
  }
}

function colorOf(color: SourceStyleLayer["color"], theme: MapTheme): unknown {
  const plain = theme.series[0];
  if (typeof color === "string") return mapColor(color) ?? plain;
  if (!color || typeof color !== "object" || typeof color.property !== "string")
    return plain;
  const [min, max] = Array.isArray(color.domain) ? color.domain : [];
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(min < max)) return plain;
  const stops = color.scale === "diverging" ? theme.diverging : theme.sequential;
  return [
    "interpolate",
    ["linear"],
    ["to-number", ["get", color.property], min],
    ...stops.flatMap((stop, at) => [
      min + ((max - min) * at) / (stops.length - 1),
      stop,
    ]),
  ];
}

interface DrawnPart {
  spec: LayerSpecification;
  opacity: Record<string, number>;
}

function styleLayer(
  declared: SourceStyleLayer,
  source: HeldMapSource,
  id: string,
  from: string,
  theme: MapTheme,
): DrawnPart | null {
  if (!declared || typeof declared !== "object") return null;
  const tiled = source.kind !== "geojson";
  if (tiled && (typeof declared.sourceLayer !== "string" || !declared.sourceLayer))
    return null;
  const within = tiled ? { "source-layer": declared.sourceLayer as string } : {};
  const color = colorOf(declared.color, theme);
  const opacity = clamp(declared.opacity, 0, 1, 1) * clamp(source.opacity, 0, 1, 1);
  const base = { id, source: from, ...within };
  switch (declared.type) {
    case "fill":
      return {
        spec: {
          ...base,
          type: "fill",
          paint: { "fill-color": color, "fill-opacity": opacity },
        } as LayerSpecification,
        opacity: { "fill-opacity": opacity },
      };
    case "line":
      return {
        spec: {
          ...base,
          type: "line",
          paint: {
            "line-color": color,
            "line-width": clamp(declared.width, 0, 20, 1),
            "line-opacity": opacity,
          },
        } as LayerSpecification,
        opacity: { "line-opacity": opacity },
      };
    case "circle":
      return {
        spec: {
          ...base,
          type: "circle",
          paint: {
            "circle-color": color,
            "circle-radius": clamp(declared.radius, 0, 40, 4),
            "circle-opacity": opacity,
          },
        } as LayerSpecification,
        opacity: { "circle-opacity": opacity },
      };
    default:
      return null;
  }
}

const GEOJSON_LAYERS: ReadonlyArray<{
  layer: Omit<SourceStyleLayer, "color">;
  of?: string[];
}> = [
  { layer: { type: "fill", opacity: 0.3 }, of: ["Polygon", "MultiPolygon"] },
  { layer: { type: "line", width: 1.5 } },
  { layer: { type: "circle", radius: 4 }, of: ["Point", "MultiPoint"] },
];
const GEOMETRY = (kinds: string[]) => ["in", ["geometry-type"], ["literal", kinds]];

const RELIEF_STRENGTH = 0.7;

export interface SourceStyle {
  source: SourceSpecification | null;
  layers: DrawnPart[];
  swatch: SceneLayer["swatch"];
}

export function sourceStyle(
  source: HeldMapSource,
  id: string,
  theme: MapTheme,
): SourceStyle {
  const drawn = styleSource(source);
  if (!drawn) return { source: null, layers: [], swatch: "raster" };
  if (source.kind === "raster-dem") {
    const strength = RELIEF_STRENGTH * clamp(source.opacity, 0, 1, 1);
    const colors = theme.relief;
    return {
      source: drawn,
      layers: [
        {
          spec: {
            id,
            type: "hillshade",
            source: id,
            paint: {
              "hillshade-exaggeration": strength,
              "hillshade-shadow-color": colors.shadow,
              "hillshade-highlight-color": colors.highlight,
              "hillshade-accent-color": colors.accent,
            },
          },
          opacity: { "hillshade-exaggeration": strength },
        },
      ],
      swatch: "raster",
    };
  }
  if (isRaster(source)) {
    const opacity = clamp(source.opacity, 0, 1, 1);
    return {
      source: drawn,
      layers: [
        {
          spec: {
            id,
            type: "raster",
            source: id,
            paint: { "raster-opacity": opacity, "raster-fade-duration": 0 },
          },
          opacity: { "raster-opacity": opacity },
        },
      ],
      swatch: "raster",
    };
  }
  const declared = Array.isArray(source.layers) ? source.layers : [];
  const plain = source.kind === "geojson" && declared.length === 0;
  const layers = (
    plain ? GEOJSON_LAYERS.map(({ layer }) => layer as SourceStyleLayer) : declared
  )
    .slice(0, MAP_LIMITS.sourceStyleLayers)
    .flatMap((layer, at) => {
      const part = styleLayer(layer, source, `${id}-${at}`, id, theme);
      if (!part) return [];
      const of = plain ? GEOJSON_LAYERS[at].of : undefined;
      return of
        ? [
            {
              ...part,
              spec: { ...part.spec, filter: GEOMETRY(of) } as LayerSpecification,
            },
          ]
        : [part];
    });
  const first = layers[0]?.spec.type;
  return {
    source: drawn,
    layers,
    swatch: first === "line" ? "line" : first === "circle" ? "circle" : "fill",
  };
}

export const rasterBackdrop = (source: HeldMapSource): SourceSpecification | null =>
  isRaster(source) ? styleSource(source) : null;
