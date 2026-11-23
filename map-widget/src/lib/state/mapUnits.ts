import { useSyncExternalStore } from "react";
import type { MeasureSystem } from "~/lib/geo/measure";

let system: MeasureSystem = "metric";
const listeners = new Set<() => void>();

export const setMeasureSystem = (next: MeasureSystem): void => {
  system = next;
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useMeasureSystemValue = (): MeasureSystem =>
  useSyncExternalStore(subscribe, () => system);
