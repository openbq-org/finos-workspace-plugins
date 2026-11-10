import type { Map as MapLibreMap } from "maplibre-gl";
import { type RefObject, useEffect, useRef, useState } from "react";
import { BOUNDARY_MAX_ZOOM } from "./scene/base";

export const NO_WEBGL =
  "This browser cannot draw the map: WebGL is turned off or not available. The data of the map is in the table.";
export const CONTEXT_RESTORE_MS = 2_000;

export function useLibraryMap({
  lib,
  holder,
  live,
  expanded,
  onFail,
  onContextLost,
}: {
  lib: typeof import("maplibre-gl") | undefined;
  holder: RefObject<HTMLDivElement>;
  live: boolean;
  expanded: boolean;
  onFail: (reason: string) => void;
  onContextLost?: () => void;
}): MapLibreMap | null {
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const lostNow = useRef(onContextLost);
  lostNow.current = onContextLost;
  useEffect(() => {
    if (!live || !lib || !holder.current) return;
    let created: MapLibreMap;
    try {
      created = new lib.Map({
        container: holder.current,
        style: { version: 8, sources: {}, layers: [] },
        attributionControl: false,
        cooperativeGestures: !expanded,
        dragRotate: false,
        touchPitch: false,
        rollEnabled: false,
        maxPitch: 0,
        maxZoom: BOUNDARY_MAX_ZOOM,
        fadeDuration: 0,
      });
    } catch {
      onFail(NO_WEBGL);
      return;
    }
    created.touchZoomRotate.disableRotation();
    created.keyboard.disableRotation();
    const canvas = created.getCanvas();
    let waiting: ReturnType<typeof setTimeout> | undefined;
    const lost = () => {
      clearTimeout(waiting);
      waiting = setTimeout(() => lostNow.current?.(), CONTEXT_RESTORE_MS);
    };
    const restored = () => clearTimeout(waiting);
    canvas.addEventListener("webglcontextlost", lost);
    canvas.addEventListener("webglcontextrestored", restored);
    setMap(created);
    return () => {
      clearTimeout(waiting);
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
      setMap(null);
      created.remove();
    };
  }, [live, lib, onFail, expanded]);
  return map;
}
