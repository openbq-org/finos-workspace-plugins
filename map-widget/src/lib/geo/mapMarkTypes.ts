import { isBundledSet, isRegionSetId, type RegionSetId } from "./regions/regionTypes";

export type MapValue = string | number | boolean | null;

export const MAP_MARKERS = ["pin", "check", "star", "flag", "ring"] as const;
export type MapSign = (typeof MAP_MARKERS)[number];
export type MapMarker = MapSign | number;

export const MAP_MARKER_TONES = ["accent", "positive", "negative", "neutral"] as const;
export type MapMarkerTone = (typeof MAP_MARKER_TONES)[number];

export interface Marked {
  label?: string;
  tag?: string;
  value?: number;
  color?: string;
  category?: string;
  props?: Record<string, MapValue>;
  marker?: MapMarker;
  markerColor?: MapMarkerTone | string;
  highlight?: true | "building";
  meaning?: string;
  time?: string;
}

export interface MapPoint extends Marked {
  lat: number;
  lon: number;
  size?: number;
}

export interface MapRegion extends Marked {
  code: string;
}

export type MapShape = Marked &
  (
    | { type: "line"; coordinates: [number, number][] }
    | { type: "polygon"; coordinates: [number, number][][]; height?: number }
  );

export const MEANING_CHARS = 60;
export const AREA_HEIGHT_MAX = 1_000;
export const FLOOR_METRES = 3.2;

export interface MapFlow extends Marked {
  from: [number, number];
  to: [number, number];
}

export const isDeferredSet = (set: unknown): set is RegionSetId =>
  isRegionSetId(set) && !isBundledSet(set);

export interface MapRegions {
  set: RegionSetId;
  within?: { country?: string; state?: string };
  items: MapRegion[];
  unmatched?: string[];
  unmatchedCount?: number;
}
