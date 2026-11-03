import type { LayerSpecification, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type BoundaryShapes,
  boundaryKey,
  loadBoundaryShapes,
} from "~/lib/geo/boundaryShapes";
import {
  MAP_BOUNDARIES,
  type MapBoundaryId,
  mapBoundary,
} from "~/lib/geo/mapBoundaries";
import type { MapBounds } from "~/lib/geo/mapSummary";
import { glyphsUrl } from "./basemap";
import type { MapTheme } from "./mapTheme";
import type { Scene } from "./scene/sceneTypes";

export type BoundaryState = "loading" | "failed";
export type BoundaryStates = Partial<Record<MapBoundaryId, BoundaryState>>;

const NONE: readonly MapBoundaryId[] = [];
const NAME_FONT = ["Noto Sans Medium"];

export const boundarySource = (id: MapBoundaryId) => `boundary:${id}`;
export const boundaryLayers = (id: MapBoundaryId) =>
  mapBoundary(id).set
    ? [`boundary:${id}:line`]
    : [`boundary:${id}:dot`, `boundary:${id}:name`];

const LINE_WIDTH: Partial<Record<MapBoundaryId, number>> = {
  countries: 1.2,
  "us-states": 1,
};

export function boundaryStyle(
  id: MapBoundaryId,
  theme: MapTheme,
): LayerSpecification[] {
  const { from } = mapBoundary(id);
  const source = boundarySource(id);
  const [first, second] = boundaryLayers(id);
  if (mapBoundary(id).set)
    return [
      {
        id: first,
        type: "line",
        source,
        minzoom: from,
        layout: { "line-join": "round" },
        paint: {
          "line-color": theme.hover,
          "line-opacity": 0.45,
          "line-width": LINE_WIDTH[id] ?? 0.7,
        },
      },
    ];
  return [
    {
      id: first,
      type: "circle",
      source,
      minzoom: from,
      paint: {
        "circle-radius": 2.5,
        "circle-color": theme.hover,
        "circle-opacity": 0.75,
        "circle-stroke-color": theme.markStroke,
        "circle-stroke-width": 1,
      },
    },
    {
      id: second,
      type: "symbol",
      source,
      minzoom: from,
      layout: {
        "text-field": ["get", "name"],
        "text-font": NAME_FONT,
        "text-size": 11,
        "text-anchor": "bottom",
        "text-offset": [0, -0.35],
        "text-padding": 4,
        "symbol-sort-key": ["get", "rank"],
      },
      paint: {
        "text-color": theme.hover,
        "text-halo-color": theme.land,
        "text-halo-width": 1.2,
      },
    },
  ];
}

function viewOf(map: MapLibreMap): MapBounds | null {
  try {
    const bounds = map.getBounds();
    return [
      Math.floor(bounds.getWest()),
      Math.floor(bounds.getSouth()),
      Math.ceil(bounds.getEast()),
      Math.ceil(bounds.getNorth()),
    ];
  } catch {
    return null;
  }
}

export function useMapBoundaries(
  map: MapLibreMap | null,
  scene: Scene | null,
  on: readonly MapBoundaryId[] | undefined,
  theme: MapTheme,
): { states: BoundaryStates; drawn: string } {
  const wanted = (on ?? NONE).join(",");
  const ids = useMemo(
    () => (wanted ? (wanted.split(",") as MapBoundaryId[]) : NONE),
    [wanted],
  );
  const [loaded, setLoaded] = useState<Partial<Record<MapBoundaryId, BoundaryShapes>>>(
    {},
  );
  const [failed, setFailed] = useState<readonly MapBoundaryId[]>(NONE);
  const [rested, setRested] = useState(0);
  const latest = useRef(loaded);
  latest.current = loaded;

  useEffect(() => {
    if (!map || !ids.length) return;
    const rest = () => setRested((count) => count + 1);
    map.on("moveend", rest);
    return () => {
      map.off("moveend", rest);
    };
  }, [map, ids]);

  useEffect(() => {
    if (!map || !ids.length) return;
    const controller = new AbortController();
    const { signal } = controller;
    const view = viewOf(map);
    for (const id of ids)
      boundaryKey(id, view, signal)
        .then((key) =>
          latest.current[id]?.key === key ? null : loadBoundaryShapes(id, view, signal),
        )
        .then(
          (shapes) => {
            if (signal.aborted) return;
            setFailed((before) =>
              before.includes(id) ? before.filter((other) => other !== id) : before,
            );
            if (shapes) setLoaded((before) => ({ ...before, [id]: shapes }));
          },
          () => {
            if (signal.aborted) return;
            setFailed((before) => (before.includes(id) ? before : [...before, id]));
          },
        );
    return () => controller.abort();
  }, [map, ids, rested]);

  useEffect(() => {
    setLoaded((before) => {
      const kept = Object.entries(before).filter(([id]) =>
        ids.includes(id as MapBoundaryId),
      );
      return kept.length === Object.keys(before).length
        ? before
        : Object.fromEntries(kept);
    });
  }, [ids]);

  const given = useRef(new Map<string, string>());
  useEffect(() => {
    if (!map || !scene) return;
    const apply = () => {
      for (const { id } of MAP_BOUNDARIES) {
        const source = boundarySource(id);
        const shapes = ids.includes(id) ? loaded[id] : undefined;
        try {
          if (!shapes) {
            for (const layer of boundaryLayers(id))
              if (map.getLayer(layer)) map.removeLayer(layer);
            if (map.getSource(source)) map.removeSource(source);
            given.current.delete(id);
            continue;
          }
          const data = shapes.outlines ?? shapes.points;
          if (!data) continue;
          const held = map.getSource(source) as
            | { setData?: (data: unknown) => unknown }
            | undefined;
          if (!held) map.addSource(source, { type: "geojson", data });
          else if (given.current.get(id) !== shapes.key) held.setData?.(data);
          given.current.set(id, shapes.key);
          if (shapes.points && !map.getGlyphs()) map.setGlyphs(glyphsUrl());
          const anchor = shapes.points ? scene.marksBefore : scene.overlayBefore;
          const before =
            anchor !== undefined && map.getLayer(anchor) ? anchor : undefined;
          for (const layer of boundaryStyle(id, theme))
            if (!map.getLayer(layer.id)) map.addLayer(layer, before);
        } catch {}
      }
    };
    const fresh = () => {
      given.current.clear();
      apply();
    };
    apply();
    map.on("style.load", fresh);
    return () => {
      map.off("style.load", fresh);
    };
  }, [map, scene, loaded, ids, theme]);

  return useMemo(() => {
    const states: BoundaryStates = {};
    const drawn: string[] = [];
    for (const id of ids) {
      const shapes = loaded[id];
      if (shapes) drawn.push(shapes.key);
      else states[id] = failed.includes(id) ? "failed" : "loading";
    }
    return { states, drawn: drawn.join(",") };
  }, [ids, loaded, failed]);
}
