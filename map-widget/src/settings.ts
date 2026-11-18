import { useSyncExternalStore } from "react";

export interface MapSettings {
  mapTilesUrl: string;
  mapTilesProvider: "none" | "openfreemap";
  mapSources: string;
  declaredSources: unknown;
}

const DEFAULTS: MapSettings = { mapTilesUrl: "", mapTilesProvider: "openfreemap",
  mapSources: "",
  declaredSources: undefined,
};

let current: MapSettings = DEFAULTS;
const listeners = new Set<() => void>();

export function setSettings(
  next:
    | {
        mapTilesUrl?: unknown;
        mapTilesProvider?: unknown;
        mapSources?: unknown;
        declaredSources?: unknown;
      }
    | null
    | undefined,
): void {
  current = {
    mapTilesUrl: typeof next?.mapTilesUrl === "string" ? next.mapTilesUrl : DEFAULTS.mapTilesUrl,
    mapTilesProvider:
      next?.mapTilesProvider === "none" || next?.mapTilesProvider === "openfreemap"
        ? next.mapTilesProvider
        : DEFAULTS.mapTilesProvider,
    mapSources: typeof next?.mapSources === "string" ? next.mapSources : DEFAULTS.mapSources,
    declaredSources: next?.declaredSources,
  };
  for (const listener of listeners) listener();
}

export const getSettings = (): MapSettings => current;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useSettings = (): MapSettings => useSyncExternalStore(subscribe, getSettings);
