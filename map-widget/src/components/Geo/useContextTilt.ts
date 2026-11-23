import { useCallback, useEffect, useRef } from "react";
import type { MapViewState } from "~/lib/geo/mapViewState";
import { tallBuildingsShown } from "./applyMapView";
import type { Scene } from "./scene/sceneTypes";
import type { SetMapView } from "./useMapView";

export function useContextTilt({
  scene,
  setView,
  tall,
  tilted,
  zoom,
  tilt,
}: {
  scene: Scene | null;
  setView: SetMapView;
  tall: boolean;
  tilted: boolean;
  zoom: number;
  tilt: () => void;
}): SetMapView {
  const asked = useRef(false);
  const from =
    scene?.context.find((layer) => layer.id === "buildings-3d")?.from ?? null;
  useEffect(() => {
    if (!tall || !asked.current) return;
    asked.current = false;
    if (!tilted && from !== null && zoom >= from) tilt();
  }, [tall, tilted, from, zoom, tilt]);
  return useCallback<SetMapView>(
    (change) =>
      setView((now: MapViewState) => {
        const next = change(now);
        asked.current =
          scene !== null &&
          tallBuildingsShown(scene, next) &&
          !tallBuildingsShown(scene, now);
        return next;
      }),
    [scene, setView],
  );
}
