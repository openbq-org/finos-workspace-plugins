import { getSettings } from "~/settings";
import { hostedBasemapUrl } from "./basemapUrl";
import { type ContextSchema, MAP_CONTEXT, type MapContextId } from "./mapContext";

export const BACKDROP_ZOOMS = {
  bundled: 6,

  past: 3,

  outlines: 7,

  streets: 13,

  most: 17,
} as const;

export type BasemapSeen =
  | { tiles: false }
  | {
      tiles: true;
      kind: "bundled" | "hosted" | "openfreemap";

      maxZoom: number;

      detailZoom: number;
    };
let seen: BasemapSeen | undefined;

export function sawBasemap(basemap: BasemapSeen): void {
  seen = basemap;
}

export interface MapOffer {
  standard: "streets" | "file" | "world" | "outlines";

  buildingsFrom: number | null;

  viewZoom: number | null;

  schema: ContextSchema;
  reach: number;
}

const fromOf = (id: MapContextId, schema: ContextSchema): number =>
  MAP_CONTEXT.find((layer) => layer.id === id)?.from[schema] ??
  Number.POSITIVE_INFINITY;

export function contextFrom(offer: MapOffer, id: MapContextId): number | null {
  const from = fromOf(id, offer.schema);
  return from <= offer.reach ? from : null;
}

const offerOf = (
  standard: MapOffer["standard"],
  schema: ContextSchema,
  reach: number,
  maxZoom: number,
): MapOffer => {
  const partial = {
    standard,
    schema,
    reach,
    viewZoom: maxZoom >= BACKDROP_ZOOMS.streets ? null : maxZoom,
  };
  return {
    ...partial,
    buildingsFrom: contextFrom({ ...partial, buildingsFrom: null }, "buildings"),
  };
};

export function mapOffer(): MapOffer {
  if (seen && !seen.tiles)
    return offerOf("outlines", "protomaps", -1, BACKDROP_ZOOMS.outlines);
  if (seen?.tiles)
    return offerOf(
      seen.kind === "openfreemap"
        ? "streets"
        : seen.kind === "hosted"
          ? "file"
          : "world",
      seen.kind === "openfreemap" ? "openmaptiles" : "protomaps",
      seen.kind === "openfreemap" ? Number.POSITIVE_INFINITY : seen.detailZoom,
      seen.maxZoom,
    );
  const { mapTilesProvider, mapTilesUrl } = getSettings();
  if (mapTilesProvider === "openfreemap")
    return offerOf(
      "streets",
      "openmaptiles",
      Number.POSITIVE_INFINITY,
      BACKDROP_ZOOMS.most,
    );
  if (hostedBasemapUrl(mapTilesUrl))
    return offerOf("file", "protomaps", Number.POSITIVE_INFINITY, BACKDROP_ZOOMS.most);
  return offerOf(
    "world",
    "protomaps",
    BACKDROP_ZOOMS.bundled,
    BACKDROP_ZOOMS.bundled + BACKDROP_ZOOMS.past,
  );
}
