import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useState } from "react";

export function useMapZoom(map: MapLibreMap | null): number {
  const [zoom, setZoom] = useState(0);
  useEffect(() => {
    if (!map) return;
    const read = () => setZoom(Math.floor(map.getZoom()));
    read();
    map.on("zoom", read);
    return () => {
      map.off("zoom", read);
    };
  }, [map]);
  return zoom;
}

const AT_END = 0.01;

export function useZoomEnd(
  map: MapLibreMap | null,
  maxZoom: number | undefined,
): boolean {
  const [ended, setEnded] = useState(false);
  useEffect(() => {
    if (!map || maxZoom === undefined) return;
    const read = () => setEnded(map.getZoom() >= maxZoom - AT_END);
    read();
    map.on("zoom", read);
    return () => {
      map.off("zoom", read);
    };
  }, [map, maxZoom]);
  return ended;
}
