import type { MapCreditId } from "./markBudget";
import type { RegionSetId } from "./regions/regionTypes";

export interface MapBoundaryLayer {
  id: string;
  label: string;
  set?: RegionSetId;
  from: number;
  credit?: MapCreditId;
}

export const MAP_BOUNDARIES = [
  { id: "countries", label: "Countries", set: "countries", from: 0 },
  { id: "admin1", label: "States and provinces", set: "admin1", from: 3 },
  { id: "us-states", label: "US states", set: "us-states", from: 0 },
  { id: "us-counties", label: "US counties", set: "us-counties", from: 4 },
  { id: "us-cbsa", label: "US metro areas", set: "us-cbsa", from: 3 },
  {
    id: "us-cd119",
    label: "US congressional districts",
    set: "us-cd119",
    from: 3,
  },
  { id: "cities", label: "Cities", from: 2, credit: "geonames" },
] as const satisfies readonly MapBoundaryLayer[];

export type MapBoundaryId = (typeof MAP_BOUNDARIES)[number]["id"];

export const MAP_BOUNDARY_IDS: readonly MapBoundaryId[] = MAP_BOUNDARIES.map(
  ({ id }) => id,
);

export const mapBoundary = (id: MapBoundaryId): MapBoundaryLayer =>
  MAP_BOUNDARIES.find((layer) => layer.id === id) as MapBoundaryLayer;

export function boundaryIds(raw: unknown): MapBoundaryId[] {
  if (!Array.isArray(raw)) return [];
  const wanted = new Set<unknown>(raw.slice(0, MAP_BOUNDARY_IDS.length * 2));
  return MAP_BOUNDARY_IDS.filter((id) => wanted.has(id));
}

export function boundaryCredits(on: readonly MapBoundaryId[]): MapCreditId[] {
  const credits = new Set<MapCreditId>();
  for (const id of on) {
    const { credit } = mapBoundary(id);
    if (credit) credits.add(credit);
  }
  return [...credits];
}
