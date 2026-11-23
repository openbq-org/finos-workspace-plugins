import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MapViewState } from "~/lib/geo/mapViewState";
import { applyMapView, failedLayer } from "./applyMapView";
import { glyphsUrl } from "./basemap";
import { pictureSources } from "./scene/image";
import type { Scene } from "./scene/sceneTypes";
import type { SceneLayer } from "./sceneLayer";
import { NOT_LOADED } from "./sourceLayers";

export const SOURCE_FAILURES = 3;

const field = (event: unknown, name: string): unknown =>
  event !== null && typeof event === "object"
    ? (event as Record<string, unknown>)[name]
    : undefined;
const hasTile = (event: unknown) => Boolean(field(event, "tile"));
function hasLoaded(scene: Scene, event: unknown): boolean {
  if (hasTile(event)) return true;
  if (field(event, "sourceDataType") !== "content") return false;
  const type = scene.sources[String(field(event, "sourceId"))]?.type;
  return type === "geojson" || type === "image";
}

export function useMapStyle(
  map: MapLibreMap | null,
  scene: Scene | null,
  view: MapViewState,
  frame: string | undefined,
  crowded?: ReadonlySet<string>,
): SceneLayer[] {
  const applied = useRef({ scene, view, frame, crowded });
  applied.current = { scene, view, frame, crowded };
  const pictures = useRef<string[]>([]);
  useEffect(() => {
    if (!map || !scene) return;
    const drawn = pictureSources(scene.pictures);
    map.setStyle(
      {
        version: 8,
        ...(scene.glyphs || scene.basemapIds.names.length
          ? { glyphs: glyphsUrl() }
          : {}),
        sources: { ...scene.sources, ...drawn.sources },
        layers: scene.style,
      },
      { diff: false },
    );
    for (const url of pictures.current) URL.revokeObjectURL(url);
    pictures.current = drawn.urls;
    const apply = () => {
      const now = applied.current;
      if (now.scene === scene)
        applyMapView(map, scene, now.view, now.frame, now.crowded);
    };
    map.on("style.load", apply);
    map.setMaxZoom(scene.maxZoom);
    return () => {
      map.off("style.load", apply);
    };
  }, [map, scene]);
  useEffect(
    () => () => {
      for (const url of pictures.current) URL.revokeObjectURL(url);
      pictures.current = [];
    },
    [map],
  );
  useEffect(() => {
    if (map && scene) applyMapView(map, scene, view, frame, crowded);
  }, [map, scene, view, frame, crowded]);

  const [unloaded, setUnloaded] = useState<{ scene: unknown; ids: string[] }>({
    scene: null,
    ids: [],
  });
  useEffect(() => {
    if (!map || !scene) return;
    const counts = new Map<string, number>();
    const failed = (event: unknown) => {
      const id = failedLayer(scene, event);
      if (id === null) {
        return;
      }
      const count = (counts.get(id) ?? 0) + 1;
      counts.set(id, count);
      if (hasTile(event) && count < SOURCE_FAILURES) return;
      setUnloaded((before) => {
        const ids = before.scene === scene ? before.ids : [];
        return ids.includes(id) ? before : { scene, ids: [...ids, id] };
      });
    };
    const loaded = (event: unknown) => {
      const id = failedLayer(scene, event);
      if (id === null || !counts.has(id) || !hasLoaded(scene, event)) return;
      counts.delete(id);
      setUnloaded((before) =>
        before.scene === scene && before.ids.includes(id)
          ? { scene, ids: before.ids.filter((other) => other !== id) }
          : before,
      );
    };
    map.on("error", failed);
    map.on("sourcedata", loaded);
    return () => {
      map.off("error", failed);
      map.off("sourcedata", loaded);
    };
  }, [map, scene]);
  return useMemo(() => {
    const failed = unloaded.scene === scene ? unloaded.ids : [];
    return (scene?.layers ?? []).map((layer) =>
      failed.includes(layer.id) ? { ...layer, note: NOT_LOADED } : layer,
    );
  }, [scene, unloaded]);
}
