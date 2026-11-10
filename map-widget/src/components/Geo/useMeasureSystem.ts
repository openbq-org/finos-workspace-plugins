import type { MeasureSystem } from "~/lib/geo/measure";
import { setMeasureSystem, useMeasureSystemValue } from "~/lib/state/mapUnits";

export function useMeasureSystem(): [MeasureSystem, () => void] {
  const system = useMeasureSystemValue();
  return [system, () => setMeasureSystem(system === "metric" ? "imperial" : "metric")];
}
