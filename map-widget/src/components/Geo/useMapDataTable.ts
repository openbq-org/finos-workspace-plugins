import type { Map as MapLibreMap } from "maplibre-gl";
import { useCallback, useEffect, useState } from "react";

export function useMapDataTable(map: MapLibreMap | null) {
  const [dataOpen, setDataOpen] = useState(false);
  const toggleData = useCallback(() => setDataOpen((open) => !open), []);
  const closeData = useCallback(() => setDataOpen(false), []);
  useEffect(() => {
    if (!map || !dataOpen) return;
    const canvas = map.getCanvas();
    const before = canvas.tabIndex;
    canvas.tabIndex = -1;
    return () => {
      canvas.tabIndex = before;
    };
  }, [map, dataOpen]);
  return { dataOpen, toggleData, closeData };
}
