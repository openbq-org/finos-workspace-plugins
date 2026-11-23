import countries from "../../../../vendor/geo/regions/countries.index.json";
import states from "../../../../vendor/geo/regions/us-states.index.json";
import type { BundledRegionSet, RegionIndexData } from "./regionTypes";

export const BUNDLED_INDEX_DATA: Record<BundledRegionSet, RegionIndexData> = {
  "us-states": states as unknown as RegionIndexData,
  countries: countries as unknown as RegionIndexData,
};
