import type { RegionIndex } from "./regions/regionTypes";

export const PLACE_FILES = [
  "cities",
  "admin1",
  "us-cbsa",
  "us-counties",
  "zips",
] as const;
export type PlaceFile = (typeof PLACE_FILES)[number];
export type RegionIndexFile = Exclude<PlaceFile, "cities" | "zips">;

export const PLACE_FILE_WORDS: Record<PlaceFile, string> = {
  cities: "the list of cities",
  admin1: "the list of states and provinces",
  "us-cbsa": "the list of US metro areas",
  "us-counties": "the list of US counties",
  zips: "the table of US ZIP codes",
};

export type PlaceNeeds = Set<PlaceFile>;

let fetchNow: ((file: PlaceFile) => void) | null = null;

export function provideFetchNow(fetch: (file: PlaceFile) => void): void {
  fetchNow = fetch;
}

export function needed<T>(
  file: PlaceFile,
  read: () => T | null,
  needs?: PlaceNeeds,
): T | null {
  const loaded = read();
  if (loaded) return loaded;
  fetchNow?.(file);
  const fetched = read();
  if (!fetched) needs?.add(file);
  return fetched;
}

let regionIndex: (set: RegionIndexFile) => RegionIndex | null = () => null;

export function providePlaceIndexes(index: typeof regionIndex): void {
  regionIndex = index;
}

export const placeIndex = (
  set: RegionIndexFile,
  needs?: PlaceNeeds,
): RegionIndex | null => needed(set, () => regionIndex(set), needs);

export const placeFileWords = (files: readonly PlaceFile[]): string =>
  files.map((file) => PLACE_FILE_WORDS[file]).join(" and ");
