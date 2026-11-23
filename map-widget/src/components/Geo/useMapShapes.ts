import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef } from "react";
import type { DrawnShape } from "~/lib/geo/mapShapes";
import type { MapTheme } from "./mapTheme";
import type { Scene } from "./scene/sceneTypes";
import {
  DRAFT_SOURCE,
  type DrawDraft,
  draftData,
  SHAPES_SOURCE,
  shapeStyle,
  shapesData,
} from "./shapeLayers";

type Source = { setData?: (data: unknown) => unknown } | undefined;

export function useMapShapes({
  map,
  scene,
  shapes,
  shown,
  theme,
  selected,
  draft,
}: {
  map: MapLibreMap | null;
  scene: Scene | null;
  shapes: readonly DrawnShape[];
  shown: boolean;
  theme: MapTheme;
  selected: string | null;
  draft: DrawDraft | null;
}): string {
  const data = useMemo(
    () => shapesData(shown ? shapes : [], theme, selected),
    [shapes, shown, theme, selected],
  );
  const working = useMemo(() => draftData(draft), [draft]);
  const latest = useRef({ data, working });
  latest.current = { data, working };

  useEffect(() => {
    if (!map || !scene) return;
    const apply = () => {
      try {
        for (const [id, held] of [
          [SHAPES_SOURCE, latest.current.data],
          [DRAFT_SOURCE, latest.current.working],
        ] as const)
          if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: held });
        for (const layer of shapeStyle(theme))
          if (!map.getLayer(layer.id)) map.addLayer(layer);
      } catch {}
    };
    apply();
    map.on("style.load", apply);
    return () => {
      map.off("style.load", apply);
    };
  }, [map, scene, theme]);

  useEffect(() => {
    if (!map || !scene) return;
    try {
      (map.getSource(SHAPES_SOURCE) as Source)?.setData?.(data);
    } catch {}
  }, [map, scene, data]);
  useEffect(() => {
    if (!map || !scene) return;
    try {
      (map.getSource(DRAFT_SOURCE) as Source)?.setData?.(working);
    } catch {}
  }, [map, scene, working]);

  const version = useRef(0);
  return useMemo(() => {
    version.current += 1;
    return data.features.length ? `shapes:${version.current}` : "";
  }, [data]);
}
