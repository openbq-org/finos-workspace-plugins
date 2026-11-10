import { useMemo, useRef } from "react";
import { type HeldMapSources, heldMapSources } from "~/lib/geo/heldMapSources";
import { useSettings } from "~/settings";

export type MapSources = HeldMapSources;

export function useMapSources(): MapSources {
  const { declaredSources, mapSources } = useSettings();
  const kept = useRef<{ text: string; value: MapSources } | null>(null);
  return useMemo(() => {
    const value = heldMapSources(declaredSources, mapSources);
    const text = JSON.stringify(value);
    if (kept.current?.text !== text) kept.current = { text, value };
    return kept.current.value;
  }, [declaredSources, mapSources]);
}
