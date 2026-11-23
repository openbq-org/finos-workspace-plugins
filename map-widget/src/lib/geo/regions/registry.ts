import { readAssetJson } from "~/host";
import { loadBoundaries } from "./boundaries";
import { bundledIndex } from "./codes";
import { buildRegionIndex } from "./regionIndex";
import {
  type BundledRegionSet,
  isBundledSet,
  type MatchOptions,
  type RegionIndex,
  type RegionIndexData,
  type RegionInfo,
  type RegionMatch,
  type RegionSetId,
} from "./regionTypes";
import { type RegionShapes, regionShapesOf, regionShapesOfBoundaries } from "./shapes";

type Address = string;

const INDEX_FILES: Record<Exclude<RegionSetId, BundledRegionSet>, Address> = {
  "us-counties": "regions/us-counties.index.json",
  admin1: "regions/admin1.index.json",
  "us-cbsa": "regions/us-cbsa.index.json",
  "us-cd119": "regions/us-cd119.index.json",
};

const SHAPE_FILES: Record<string, Address> = {
  "countries:all": "regions/countries-50m.json",
  "us-cbsa:all": "regions/us-cbsa.json",
  "us-cd119:all": "regions/us-cd119.json",
  "admin1:africa": "regions/admin1-africa.json",
  "admin1:asia": "regions/admin1-asia.json",
  "admin1:europe": "regions/admin1-europe.json",
  "admin1:north-america": "regions/admin1-north-america.json",
  "admin1:south-america": "regions/admin1-south-america.json",
  "admin1:oceania": "regions/admin1-oceania.json",
};

const fetched = <T>(address: Address): Promise<T> => readAssetJson<T>(`geo/${address}`);

function once<T>(
  kept: Map<string, Promise<T>>,
  key: string,
  load: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  let loading = kept.get(key);
  if (!loading) {
    loading = load();
    kept.set(key, loading);
    loading.catch(() => kept.delete(key));
  }
  const shared = loading;
  return signal
    ? new Promise((resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        shared.then(resolve, reject);
      })
    : shared;
}

const indexes = new Map<RegionSetId, RegionIndex>();
const loadingIndexes = new Map<string, Promise<RegionIndex>>();
const loadingShapes = new Map<string, Promise<RegionShapes>>();

export function registerRegionIndex(data: RegionIndexData): RegionIndex {
  const index = buildRegionIndex(data);
  if (isBundledSet(index.set)) return bundledIndex(index.set);
  indexes.set(index.set, index);
  return index;
}

export function loadRegionIndex(
  set: RegionSetId,
  signal?: AbortSignal,
): Promise<RegionIndex> {
  if (isBundledSet(set)) return Promise.resolve(bundledIndex(set));
  return once(
    loadingIndexes,
    set,
    async () =>
      indexes.get(set) ??
      registerRegionIndex(await fetched<RegionIndexData>(INDEX_FILES[set])),
    signal,
  );
}

export const loadedRegionIndex = (set: RegionSetId): RegionIndex | null =>
  isBundledSet(set) ? bundledIndex(set) : (indexes.get(set) ?? null);

function indexOf(set: RegionSetId): RegionIndex {
  const index = loadedRegionIndex(set);
  if (!index)
    throw new Error(
      `The boundary set "${set}" is not loaded: await loadRegionIndex("${set}") before matching.`,
    );
  return index;
}

export const matchRegion = (
  set: RegionSetId,
  value: unknown,
  options?: MatchOptions,
): RegionMatch => indexOf(set).match(value, options);

export const regionInfo = (set: RegionSetId, id: string): RegionInfo | null =>
  indexOf(set).get(id);

export function partsOf(set: RegionSetId, ids: Iterable<string>): string[] {
  const index = indexOf(set);
  const parts = new Set<string>();
  for (const id of ids) {
    const info = index.get(id);
    if (info?.centroid) parts.add(info.part);
  }
  return [...parts];
}

function loadShapes(set: RegionSetId, part = "all", signal?: AbortSignal) {
  return once(
    loadingShapes,
    `${set}:${part}`,
    async () => {
      if (set === "us-states" || set === "us-counties")
        return regionShapesOfBoundaries(await loadBoundaries(set));
      const address = SHAPE_FILES[`${set}:${part}`];
      if (!address) throw new Error(`The boundary set "${set}" has no file "${part}".`);
      return regionShapesOf(set, part, await fetched(address));
    },
    signal,
  );
}

export const loadRegionParts = (
  set: RegionSetId,
  parts: readonly string[],
  signal?: AbortSignal,
): Promise<RegionShapes[]> =>
  Promise.all(parts.map((part) => loadShapes(set, part, signal)));

export const loadRegionShapes = (
  set: RegionSetId,
  ids: Iterable<string>,
  signal?: AbortSignal,
): Promise<RegionShapes[]> =>
  Promise.all(partsOf(set, ids).map((part) => loadShapes(set, part, signal)));
