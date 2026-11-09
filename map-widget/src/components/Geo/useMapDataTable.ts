import type { Map as MapLibreMap } from "maplibre-gl";
import { useCallback, useEffect, useState } from "react";

export function useMapDataTable(
  map: MapLibreMap | null,
  controlled?: boolean,
  onChange?: (open: boolean) => void,
) {
  const [kept, setKept] = useState(false);
  const dataOpen = controlled ?? kept;
  const change = useCallback(
    (open: boolean) => {
      setKept(open);
      onChange?.(open);
    },
    [onChange],
  );
  const toggleData = useCallback(() => change(!dataOpen), [change, dataOpen]);
  const closeData = useCallback(() => change(false), [change]);
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
