import type { LayerSpecification } from "maplibre-gl";
import { backdropAsked } from "~/lib/geo/mapAsks";
import { MAP_CONTEXT } from "~/lib/geo/mapContext";
import { mapLayers } from "~/lib/geo/mapLayers";
import { BACKDROP_ZOOMS } from "~/lib/geo/mapOffer";
import { contextParts, placeContext, type SceneContext } from "../basemapContext";
import { BASEMAP_SOURCE, type BasemapPart, basemapPart } from "../basemapStyle";
import { rasterBackdrop } from "../sourceLayers";
import type { MapSources } from "../useMapSources";
import type { Draft, Scene, SceneInput } from "./draft";

export const BOUNDARY_MAX_ZOOM = 9;
export const BOUNDARY_VIEW_ZOOM = BACKDROP_ZOOMS.outlines;

export interface Base {
  under: LayerSpecification[];
  borders: LayerSpecification[];
  labels: LayerSpecification[];
  facts: Pick<
    Scene,
    | "backdrop"
    | "basemaps"
    | "basemapParts"
    | "basemapIds"
    | "context"
    | "contextAsked"
    | "credit"
    | "backdropCredit"
    | "maxZoom"
    | "viewZoom"
    | "detailZoom"
  >;
}

export const BACKDROP = "backdrop";

export const imageryOf = (held: MapSources | undefined) =>
  (held?.sources ?? []).filter(
    (source) =>
      source.role === "imagery" &&
      rasterBackdrop(source) !== null &&
      !held?.ambiguous.includes(source.id),
  );

export interface BackdropChoice {
  id: string;
  name: string;
  streets: boolean;
}

const pictureStreets = (source: { maxzoom?: number }) =>
  Math.min(BACKDROP_ZOOMS.most, (source.maxzoom ?? 12) + 2) >= BACKDROP_ZOOMS.streets;

export const backdropChoices = (
  held: MapSources | undefined,
  standard: { streets: boolean } | null,
  asked: string | undefined,
): BackdropChoice[] => {
  const list = [
    ...(standard
      ? [{ id: "standard", name: "Standard", streets: standard.streets }]
      : []),
    { id: "plain", name: "Plain", streets: false },
    ...imageryOf(held).map((source) => ({
      id: source.id,
      name: source.name,
      streets: pictureStreets(source),
    })),
  ];
  return [
    ...list.filter((item) => item.id === asked),
    ...list.filter((item) => item.id !== asked),
  ];
};

export function hasTiles(input: SceneInput): boolean {
  const choice = input.choice ?? backdropAsked(input.spec.basemap);
  if (choice === "plain") return false;
  return (
    input.basemap !== null || imageryOf(input.held).some(({ id }) => id === choice)
  );
}

export function baseLayers(input: SceneInput, draft: Draft): Base {
  const { world, states, theme, basemap } = input;
  const choice = input.choice ?? backdropAsked(input.spec.basemap);
  const choices = imageryOf(input.held);
  const picture = choices.find((source) => source.id === choice);
  const tiles = choice === "plain" ? null : basemap;
  const sea: LayerSpecification = {
    id: "sea",
    type: "background",
    paint: { "background-color": input.sea },
  };
  const ids: Scene["basemapIds"] = { names: [], roads: [], borders: [] };
  const under: LayerSpecification[] = [];
  const borders: LayerSpecification[] = [];
  const labels: LayerSpecification[] = [];
  const sort = (layers: readonly LayerSpecification[], only?: BasemapPart) => {
    const kept: LayerSpecification[] = [];
    for (const layer of layers) {
      const part = basemapPart(layer);
      if (only && part !== only) continue;
      if (part) ids[part].push(layer.id);
      kept.push(layer);
    }
    return kept;
  };

  if (picture) {
    const drawn = rasterBackdrop(picture);
    if (drawn) {
      draft.sources[BACKDROP] = drawn;
      draft.origins[BACKDROP] = BACKDROP;
      under.push(sea, {
        id: BACKDROP,
        type: "raster",
        source: BACKDROP,
        paint: { "raster-fade-duration": 0 },
      });
    }
  }
  let context: SceneContext[] = [];
  if (tiles) {
    draft.sources[BASEMAP_SOURCE] = tiles.source;
    if (picture) borders.push(...sort(tiles.under, "borders"));
    else {
      under.push(...placeContext(sort(tiles.under), tiles.context));
      labels.push(...tiles.context.flatMap((item) => item.names));
      context = MAP_CONTEXT.map(({ id, label }) => {
        const held = tiles.context.find((item) => item.id === id);
        return {
          id,
          label,
          from: held?.from ?? null,
          ids: held ? contextParts(held).map((layer) => layer.id) : [],
        };
      });
    }
    labels.push(...sort(tiles.labels));
  } else {
    const line = (id: string, color: string, width: number): LayerSpecification => ({
      id,
      type: "line",
      source: id,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": color, "line-width": width },
    });
    const data = (id: string, value: GeoJSON.GeoJSON) => {
      draft.sources[id] = { type: "geojson", data: value, tolerance: 0.2 };
    };
    const nested = Object.values(draft.sets).find((set) => set?.land && set.outer);
    const usLand = states?.shapes ?? nested?.land;
    if (!picture) {
      under.push(sea);
      if (world) {
        data("world", world.shapes);
        under.push({
          id: "world-land",
          type: "fill",
          source: "world",
          ...(usLand ? { filter: ["!=", ["get", "code"], "840"] } : {}),
          paint: { "fill-color": theme.land, "fill-antialias": false },
        });
      }
      if (usLand) {
        data("states", usLand);
        under.push({
          id: "states-land",
          type: "fill",
          source: "states",
          paint: { "fill-color": theme.land, "fill-antialias": false },
        });
      }
    }
    const fine = Object.values(draft.sets).some((set) => set?.fine);
    if (world && !fine) {
      data("world-borders", world.borders);
      borders.push(line("world-borders", theme.border, 0.6));
    }
    const inner = nested?.outer ?? states?.borders;
    if (inner) {
      data("state-borders", inner);
      borders.push(line("state-borders", theme.border, nested?.outer ? 0.8 : 0.7));
    }
    ids.borders.push(...borders.map((layer) => layer.id));
  }

  const backdrop = picture ? picture.id : tiles ? "standard" : "plain";
  const pictureZoom = picture
    ? Math.min(BACKDROP_ZOOMS.most, (picture.maxzoom ?? 12) + 2)
    : 0;
  const shaded = mapLayers(input.spec).some(
    (layer) =>
      (layer.kind === "regions" || layer.kind === "columns") &&
      layer.regions !== undefined,
  );
  return {
    under,
    borders,
    labels,
    facts: {
      backdrop,
      basemaps: backdropChoices(
        input.held,
        basemap ? { streets: basemap.maxZoom >= BACKDROP_ZOOMS.streets } : null,
        backdropAsked(input.spec.basemap),
      ),
      basemapParts: {
        names: ids.names.length > 0,
        roads: ids.roads.length > 0,
        borders: ids.borders.length > 0,
      },
      basemapIds: ids,
      context,
      contextAsked: input.spec.context ?? [],
      credit: tiles?.credit ?? null,
      backdropCredit: picture?.attribution ?? null,
      maxZoom: Math.max(
        tiles?.maxZoom ?? (shaded ? BOUNDARY_MAX_ZOOM : BOUNDARY_VIEW_ZOOM),
        pictureZoom,
      ),
      viewZoom: Math.max(tiles?.maxZoom ?? BOUNDARY_VIEW_ZOOM, pictureZoom),
      detailZoom: Math.max(tiles?.detailZoom ?? 0, picture?.maxzoom ?? 0),
    },
  };
}
