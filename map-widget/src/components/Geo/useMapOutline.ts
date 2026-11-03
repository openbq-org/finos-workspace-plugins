import type { Feature, Geometry } from "geojson";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useState } from "react";
import type { PlaceRegion } from "~/lib/geo/mapOpening";
import { loadRegionIndex, loadRegionShapes } from "~/lib/geo/regions/registry";
import type { MapTheme } from "./mapTheme";
import type { Scene } from "./scene/sceneTypes";

export const OUTLINE_SOURCE = "view-outline";
export const OUTLINE_LAYER = "view-outline:line";

interface Drawn {
  key: string;
  shape: Feature<Geometry>;
}

const keyOf = ({ set, id }: PlaceRegion) => `${set}:${id}`;

export function useMapOutline(
  map: MapLibreMap | null,
  scene: Scene | null,
  outline: PlaceRegion | undefined,
  theme: MapTheme,
): string {
  const wanted = outline ? keyOf(outline) : "";
  const [loaded, setLoaded] = useState<Drawn | null>(null);

  useEffect(() => {
    if (!wanted) {
      setLoaded(null);
      return;
    }
    const [set, id] = wanted.split(":") as [PlaceRegion["set"], string];
    const controller = new AbortController();
    const { signal } = controller;
    loadRegionIndex(set, signal)
      .then(() => loadRegionShapes(set, [id], signal))
      .then(
        (files) => {
          if (signal.aborted) return;
          const shape = files.map((file) => file.shapeOf(id)).find(Boolean);
          setLoaded(shape ? { key: wanted, shape } : null);
        },
        () => {
          if (!signal.aborted) setLoaded(null);
        },
      );
    return () => controller.abort();
  }, [wanted]);

  const drawn = loaded?.key === wanted ? loaded : null;
  useEffect(() => {
    if (!map || !scene) return;
    const apply = () => {
      try {
        if (map.getLayer(OUTLINE_LAYER)) map.removeLayer(OUTLINE_LAYER);
        if (map.getSource(OUTLINE_SOURCE)) map.removeSource(OUTLINE_SOURCE);
        if (!drawn) return;
        map.addSource(OUTLINE_SOURCE, { type: "geojson", data: drawn.shape });
        const before =
          scene.overlayBefore !== undefined && map.getLayer(scene.overlayBefore)
            ? scene.overlayBefore
            : undefined;
        map.addLayer(
          {
            id: OUTLINE_LAYER,
            type: "line",
            source: OUTLINE_SOURCE,
            layout: { "line-join": "round" },
            paint: {
              "line-color": theme.hover,
              "line-opacity": 0.85,
              "line-width": 1.8,
            },
          },
          before,
        );
      } catch {}
    };
    apply();
    map.on("style.load", apply);
    return () => {
      map.off("style.load", apply);
    };
  }, [map, scene, drawn, theme]);

  return drawn?.key ?? "";
}
