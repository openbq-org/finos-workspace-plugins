import type { MapContextId } from "~/lib/geo/mapContext";

export interface ContextColors {
  building: string;
  buildingLine: string;
  buildingSide: string;
  residential: string;
  commercial: string;
  industrial: string;
  farmland: string;
  park: string;
  wood: string;
  grass: string;
  rail: string;
  airport: string;
  runway: string;
  poi: string;
  poiStroke: string;
  poiName: string;
  halo: string;
}

export const CONTEXT_COLORS: Record<"light" | "dark", ContextColors> = {
  light: {
    building: "#e1ded7",
    buildingLine: "#cfcbc2",
    buildingSide: "#d6d2ca",
    residential: "#ebe9e3",
    commercial: "#f0e6df",
    industrial: "#e6e3ed",
    farmland: "#ebefdc",
    park: "#d3e6c8",
    wood: "#c8dfc0",
    grass: "#dcebd2",
    rail: "#a5a2ad",
    airport: "#e3e1eb",
    runway: "#cbc7d7",
    poi: "#7f8aa1",
    poiStroke: "#ffffff",
    poiName: "#6b7483",
    halo: "rgba(255,255,255,0.8)",
  },
  dark: {
    building: "#27354f",
    buildingLine: "#33425f",
    buildingSide: "#2e3d5a",
    residential: "#212f4b",
    commercial: "#2b2d4a",
    industrial: "#272c50",
    farmland: "#1d2f40",
    park: "#1a3b3b",
    wood: "#173838",
    grass: "#1c3a3c",
    rail: "#5a6786",
    airport: "#252f4e",
    runway: "#3b476a",
    poi: "#6f7b98",
    poiStroke: "#0b1528",
    poiName: "#8d98b0",
    halo: "#0b1528",
  },
};

export type Expression = unknown[];
export const kindIn = (property: string, kinds: readonly string[]): Expression => [
  "in",
  ["get", property],
  ["literal", kinds],
];
export const AREA: Expression = ["==", ["geometry-type"], "Polygon"];
export const LINE: Expression = ["==", ["geometry-type"], "LineString"];

export const byKind = (
  property: string,
  colors: readonly [readonly string[], string][],
  otherwise: string,
): Expression => [
  "match",
  ["get", property],
  ...colors.flatMap(([kinds, color]) => [[...kinds], color]),
  otherwise,
];

export const tint = (from: number, full = 0.9): Expression => [
  "interpolate",
  ["linear"],
  ["zoom"],
  from,
  full * 0.6,
  from + 2,
  full,
];

export interface ContextPart {
  slot: "land" | "cover" | "detail" | "names";
  from: string;
  name?: string;
  type: "fill" | "line" | "circle" | "symbol" | "fill-extrusion";
  filter?: Expression;
  minzoom?: number;
  maxzoom?: number;
  layout?: Record<string, unknown>;
  paint: Record<string, unknown>;
}

export const railWidth: Expression = [
  "interpolate",
  ["exponential", 1.4],
  ["zoom"],
  8,
  0.5,
  13,
  1,
  17,
  2.2,
];
export const runwayWidth: Expression = [
  "interpolate",
  ["exponential", 1.5],
  ["zoom"],
  10,
  1,
  13,
  6,
  17,
  48,
];
export const taxiwayWidth: Expression = [
  "interpolate",
  ["exponential", 1.5],
  ["zoom"],
  12,
  0.6,
  17,
  10,
];
export const flat = { "line-cap": "butt", "line-join": "round" };

export const dot = (c: ContextColors) => ({
  "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 1.8, 17, 3],
  "circle-color": c.poi,
  "circle-stroke-color": c.poiStroke,
  "circle-stroke-width": 0.8,
  "circle-opacity": 0.9,
});

export const nameOf = (c: ContextColors, field: Expression) => ({
  layout: {
    "text-field": field,
    "text-font": ["Noto Sans Regular"],
    "text-size": 10,
    "text-anchor": "top",
    "text-offset": [0, 0.5],
    "text-max-width": 8,
    "text-padding": 6,
    "text-optional": true,
  },
  paint: {
    "text-color": c.poiName,
    "text-halo-color": c.halo,
    "text-halo-width": 1,
  },
});

export const extrusion = (c: ContextColors, height: string, base: string) => ({
  "fill-extrusion-color": c.buildingSide,
  "fill-extrusion-height": ["to-number", ["get", height], 5],
  "fill-extrusion-base": ["to-number", ["get", base], 0],
  "fill-extrusion-opacity": 0.9,
  "fill-extrusion-vertical-gradient": true,
});

export type ContextParts = Record<MapContextId, ContextPart[]>;
