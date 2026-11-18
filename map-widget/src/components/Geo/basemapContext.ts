import type { LayerSpecification } from "maplibre-gl";
import {
  type ContextSchema,
  contextAvailable,
  MAP_CONTEXT,
  type MapContextId,
} from "~/lib/geo/mapContext";
import { BASEMAP_SOURCE, basemapPart } from "./basemapStyle";
import { contextPartsOf } from "./styles/contextParts";

export interface ContextStyle {
  id: MapContextId;
  label: string;
  from: number;
  land: LayerSpecification[];
  cover: LayerSpecification[];
  detail: LayerSpecification[];
  names: LayerSpecification[];
}

export interface SceneContext {
  id: MapContextId;
  label: string;
  from: number | null;
  ids: string[];
}

export function contextLayers(
  schema: ContextSchema,
  theme: "light" | "dark",
  has: (layer: string) => boolean,
  dataZoom: number,
): ContextStyle[] {
  const parts = contextPartsOf(schema, theme);
  return MAP_CONTEXT.flatMap((entry) => {
    if (!contextAvailable(entry, schema, dataZoom)) return [];
    const from = entry.from[schema];
    const made: ContextStyle = {
      id: entry.id,
      label: entry.label,
      from,
      land: [],
      cover: [],
      detail: [],
      names: [],
    };
    for (const part of parts[entry.id]) {
      if (!has(part.from)) continue;
      const first = Math.max(from, part.minzoom ?? 0);
      made[part.slot].push({
        id: `context-${entry.id}${part.name ? `-${part.name}` : ""}`,
        type: part.type,
        source: BASEMAP_SOURCE,
        "source-layer": part.from,
        ...(first > 0 ? { minzoom: first } : {}),
        ...(part.maxzoom === undefined ? {} : { maxzoom: part.maxzoom }),
        ...(part.filter ? { filter: part.filter } : {}),
        layout: { ...(part.layout ?? {}), visibility: "none" },
        paint: part.paint,
      } as LayerSpecification);
    }
    return contextParts(made).length ? [made] : [];
  });
}

export const contextParts = (context: ContextStyle): LayerSpecification[] => [
  ...context.land,
  ...context.cover,
  ...context.detail,
  ...context.names,
];

export function placeContext(
  under: readonly LayerSpecification[],
  context: readonly ContextStyle[],
): LayerSpecification[] {
  const end = under.length;
  const at = (found: number) => (found < 0 ? end : found);
  const water = at(under.findIndex((layer) => layer.id === "water"));
  const line = at(
    under.findIndex((layer, index) => index > water && layer.type === "line"),
  );
  const borders = at(under.findIndex((layer) => basemapPart(layer) === "borders"));
  const cover = Math.max(water, Math.min(line, borders));
  const detail = Math.max(cover, borders);
  return [
    ...under.slice(0, water),
    ...context.flatMap((item) => item.land),
    ...under.slice(water, cover),
    ...context.flatMap((item) => item.cover),
    ...under.slice(cover, detail),
    ...context.flatMap((item) => item.detail),
    ...under.slice(detail),
  ];
}

const STOCK_AIRPORT = new Set([
  "landuse_aerodrome",
  "landuse_runway",
  "roads_runway",
  "roads_taxiway",
]);

export function stockContext(layer: LayerSpecification): MapContextId | null {
  if (layer.type === "symbol") return null;
  const from = "source-layer" in layer ? layer["source-layer"] : undefined;
  if (from === "buildings" || from === "building") return "buildings";
  if (from === "aeroway" || STOCK_AIRPORT.has(layer.id)) return "airports";
  if (/^(railway|roads_rail)/.test(layer.id)) return "railways";
  return null;
}
