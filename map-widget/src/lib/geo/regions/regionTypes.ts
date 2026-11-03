export const REGION_SET_IDS = [
  "us-states",
  "us-counties",
  "countries",
  "admin1",
  "us-cbsa",
  "us-cd119",
] as const;
export type RegionSetId = (typeof REGION_SET_IDS)[number];

export const isRegionSetId = (value: unknown): value is RegionSetId =>
  REGION_SET_IDS.includes(value as RegionSetId);

export const BUNDLED_REGION_SETS = ["us-states", "countries"] as const;
export type BundledRegionSet = (typeof BUNDLED_REGION_SETS)[number];

export const isBundledSet = (value: unknown): value is BundledRegionSet =>
  BUNDLED_REGION_SETS.includes(value as BundledRegionSet);

export const REGION_SET_WORDS: Record<
  RegionSetId,
  {
    label: string;
    forms: string;
    apart: string;
  }
> = {
  "us-states": {
    label: "US state",
    forms:
      'a state is its postal code ("CA"), its name ("California") or its FIPS code ("06")',
    apart: 'Write the postal code of the state ("CA").',
  },
  "us-counties": {
    label: "US county",
    forms:
      'a county is its five-digit FIPS code ("06037"), or its name with its state ("Los Angeles County, CA")',
    apart:
      'Write "County" or "city" after the name and the state with it ("Baltimore city, MD"), or use the FIPS code.',
  },
  countries: {
    label: "country",
    forms:
      'a country is its ISO code ("US", "USA" or 840) or its English name ("United States")',
    apart: 'Write the ISO code of the country ("US").',
  },
  admin1: {
    label: "state or province",
    forms:
      'a state or province is its ISO 3166-2 code ("CA-ON", "DE-BY"), or its name with the country of the data ("Ontario" in Canada)',
    apart: 'Give the country of the data, or write the ISO 3166-2 code ("CA-ON").',
  },
  "us-cbsa": {
    label: "US metro area",
    forms:
      'a metro area is its CBSA code ("35620"), its name ("New York-Newark-Jersey City, NY-NJ") or its first city ("New York")',
    apart:
      'Use the full name of the metro area, the city with its state ("Portland, OR") or the CBSA code.',
  },
  "us-cd119": {
    label: "US congressional district",
    forms:
      'a district is its state and number ("CA-12", "California 12", "AK-AL") or its GEOID ("0612")',
    apart: 'Write the state and the number of the district ("CA-12").',
  },
};

export type RegionBox = [number, number, number, number];

export type RegionMatch = { id: string } | { ambiguous: string[] } | null;

export interface MatchOptions {
  country?: unknown;
  state?: unknown;
}

export interface RegionInfo {
  id: string;
  name: string;
  centroid: [number, number] | null;
  bounds: RegionBox | null;
  viewBounds: RegionBox | null;
  part: string;
  level: 1 | 2;
  short: string;
}

export interface RegionPart {
  id: string;
  label: string;
  bounds: RegionBox;
}

export interface RegionIndexData {
  set: string;
  source: string;
  columns: string[];
  bounds: RegionBox;
  contiguousBounds?: RegionBox;
  outsideContiguous?: string[];
  parts?: RegionPart[];
  regions: unknown[][];
}

export interface RegionExplanation {
  reason: "matched" | "ambiguous" | "unmatched";
  candidates: { id: string; name: string }[];
}

export interface RegionIndex {
  set: RegionSetId;
  source: string;
  size: number;
  bounds: RegionBox;
  contiguousBounds: RegionBox | null;
  parts: RegionPart[];
  ids: () => string[];
  get: (id: string) => RegionInfo | null;
  match: (value: unknown, options?: MatchOptions) => RegionMatch;
  explain: (value: unknown, options?: MatchOptions) => RegionExplanation;
  outsideContiguous: (id: string) => boolean;
}
