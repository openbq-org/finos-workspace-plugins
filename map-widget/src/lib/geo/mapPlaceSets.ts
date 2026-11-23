import {
  PLACE_FILES,
  type PlaceFile,
  provideFetchNow,
  providePlaceIndexes,
} from "./placeFiles";
import { type CitiesData, loadCities, registerCities } from "./regions/cities";
import type { RegionIndexData } from "./regions/regionTypes";
import {
  loadedRegionIndex,
  loadRegionIndex,
  registerRegionIndex,
} from "./regions/registry";
import { loadZips, registerZips, type ZipsData } from "./regions/zips";

providePlaceIndexes(loadedRegionIndex);

export const PLACE_FILE_TIMEOUT_MS = 4_000;
export const PLACE_FILE_RETRY_MS = 15_000;

const within = <T>(loading: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("A list of places of the map did not load in time.")),
      ms,
    );
    loading.then(resolve, reject).finally(() => clearTimeout(timer));
  });

export const loadPlaceFiles = (
  files: readonly PlaceFile[] = PLACE_FILES,
  timeoutMs = PLACE_FILE_TIMEOUT_MS,
): Promise<void> =>
  Promise.allSettled(
    files.map((file) =>
      within<unknown>(
        file === "cities"
          ? loadCities()
          : file === "zips"
            ? loadZips()
            : loadRegionIndex(file),
        timeoutMs,
      ),
    ),
  ).then(() => undefined);

export type FetchText = (address: string, timeoutMs: number) => string;

const blockingFetch: FetchText = (address, timeoutMs) => {
  const request = new XMLHttpRequest();
  request.open("GET", address, false);
  request.timeout = timeoutMs;
  request.send();
  if (request.status < 200 || request.status >= 300)
    throw new Error(`A list of places of the map did not load (${request.status}).`);
  return request.responseText;
};

export function syncPlaceFiles(
  addresses: Record<PlaceFile, string>,
  fetchText: FetchText = blockingFetch,
  now: () => number = Date.now,
): void {
  const failedAt = new Map<PlaceFile, number>();
  provideFetchNow((file) => {
    const failed = failedAt.get(file);
    if (failed !== undefined && now() - failed < PLACE_FILE_RETRY_MS) return;
    try {
      const data = JSON.parse(fetchText(addresses[file], PLACE_FILE_TIMEOUT_MS));
      if (file === "cities") registerCities(data as CitiesData);
      else if (file === "zips") registerZips(data as ZipsData);
      else registerRegionIndex(data as RegionIndexData);
      failedAt.delete(file);
    } catch {
      failedAt.set(file, now());
    }
  });
}
