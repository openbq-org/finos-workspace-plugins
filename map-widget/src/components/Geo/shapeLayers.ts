import type { Feature, FeatureCollection } from "geojson";
import type { LayerSpecification } from "maplibre-gl";
import type { Position } from "~/lib/geo/geodesy";
import { type DrawnKind, type DrawnShape, shapePath } from "~/lib/geo/mapShapes";
import type { MapTheme } from "./mapTheme";

export const SHAPES_SOURCE = "own:shapes";
export const DRAFT_SOURCE = "own:draft";

export const shapeColor = (shape: Pick<DrawnShape, "color">, theme: MapTheme): string =>
  theme.series[shape.color ?? 0] ?? theme.series[0];

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

function featureOf(
  kind: "area" | "line" | "point",
  path: Position[],
): Feature["geometry"] {
  if (kind === "point") return { type: "Point", coordinates: path[0] };
  if (kind === "line") return { type: "LineString", coordinates: path };
  return { type: "Polygon", coordinates: [path] };
}

export function shapesData(
  shapes: readonly DrawnShape[],
  theme: MapTheme,
  selected: string | null,
): FeatureCollection {
  if (!shapes.length) return EMPTY;
  return {
    type: "FeatureCollection",
    features: shapes.map((shape) => ({
      type: "Feature",
      properties: {
        id: shape.id,
        c: shapeColor(shape, theme),
        s: shape.id === selected ? 1 : 0,
      },
      geometry: featureOf(
        shape.kind === "point" ? "point" : shape.kind === "line" ? "line" : "area",
        shapePath(shape),
      ),
    })),
  };
}

export interface DrawDraft {
  path?: Position[];
  closed?: boolean;
  handles?: Position[];
  shape?: { kind: DrawnKind; path: Position[]; radiusKm?: number };
  measured?: true;
}

export function draftData(draft: DrawDraft | null): FeatureCollection {
  if (!draft) return EMPTY;
  const features: Feature[] = [];
  const path = draft.path ?? [];
  if (draft.closed && path.length >= 3)
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [[...path, path[0]]] },
    });
  else if (path.length >= 2)
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: path },
    });
  for (const place of draft.handles ?? [])
    features.push({
      type: "Feature",
      properties: { h: 1 },
      geometry: { type: "Point", coordinates: place },
    });
  return features.length ? { type: "FeatureCollection", features } : EMPTY;
}

const AREA = ["==", ["geometry-type"], "Polygon"] as const;
const POINT = ["==", ["geometry-type"], "Point"] as const;

export function shapeStyle(theme: MapTheme): LayerSpecification[] {
  return [
    {
      id: "own:fill",
      type: "fill",
      source: SHAPES_SOURCE,
      filter: AREA as never,
      paint: { "fill-color": ["get", "c"], "fill-opacity": 0.14 },
    },
    {
      id: "own:line",
      type: "line",
      source: SHAPES_SOURCE,
      filter: ["!", POINT] as never,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": ["get", "c"],
        "line-width": ["case", ["==", ["get", "s"], 1], 3, 2],
        "line-dasharray": [2.5, 1.5],
      },
    },
    {
      id: "own:point",
      type: "circle",
      source: SHAPES_SOURCE,
      filter: POINT as never,
      paint: {
        "circle-radius": ["case", ["==", ["get", "s"], 1], 7, 5.5],
        "circle-color": ["get", "c"],
        "circle-opacity": 0.35,
        "circle-stroke-color": ["get", "c"],
        "circle-stroke-width": 2,
      },
    },
    {
      id: "own:draft-fill",
      type: "fill",
      source: DRAFT_SOURCE,
      filter: AREA as never,
      paint: { "fill-color": theme.hover, "fill-opacity": 0.1 },
    },
    {
      id: "own:draft-line",
      type: "line",
      source: DRAFT_SOURCE,
      filter: ["!", POINT] as never,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": theme.hover,
        "line-width": 1.6,
        "line-dasharray": [1.5, 1.5],
      },
    },
    {
      id: "own:handle",
      type: "circle",
      source: DRAFT_SOURCE,
      filter: POINT as never,
      paint: {
        "circle-radius": 4.5,
        "circle-color": theme.markStroke,
        "circle-stroke-color": theme.hover,
        "circle-stroke-width": 1.6,
      },
    },
  ];
}
