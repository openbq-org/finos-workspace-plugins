import { BUNDLED_INDEX_DATA } from "./bundled";
import { buildRegionIndex } from "./regionIndex";
import {
  type BundledRegionSet,
  isBundledSet,
  type RegionIndex,
  type RegionInfo,
  type RegionMatch,
} from "./regionTypes";

export const REGION_SETS = ["us-states", "us-counties", "countries"] as const;
export type RegionSet = (typeof REGION_SETS)[number];

export const isRegionSet = (value: unknown): value is RegionSet =>
  REGION_SETS.includes(value as RegionSet);

export interface Region {
  code: string;
  name: string;
  centre: [number, number] | null;
  short: string;
}

const built = new Map<BundledRegionSet, RegionIndex>();

export function bundledIndex(set: BundledRegionSet): RegionIndex {
  let index = built.get(set);
  if (!index) {
    index = buildRegionIndex(BUNDLED_INDEX_DATA[set]);
    built.set(set, index);
  }
  return index;
}

const regionOfInfo = (info: RegionInfo): Region => ({
  code: info.id,
  name: info.name,
  centre: info.centroid,
  short: info.short,
});

export const matchBundled = (set: BundledRegionSet, value: unknown): RegionMatch =>
  bundledIndex(set).match(value);

function one(set: BundledRegionSet, value: unknown): Region | null {
  const match = matchBundled(set, value);
  const info = match && "id" in match ? bundledIndex(set).get(match.id) : null;
  return info ? regionOfInfo(info) : null;
}

export const matchState = (value: unknown): Region | null => one("us-states", value);

export const matchCountry = (value: unknown): Region | null => one("countries", value);

export function regionOf(set: string | undefined, code: string): Region | null {
  const info = isBundledSet(set) ? bundledIndex(set).get(code) : null;
  return info ? regionOfInfo(info) : null;
}
