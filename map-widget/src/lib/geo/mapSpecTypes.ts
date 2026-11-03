import type { GeoJsonNames } from "./geoJson";
import type { MapBasemap } from "./mapAsks";
import type { MapBoundaryId } from "./mapBoundaries";
import type { MapContextId } from "./mapContext";
import type { ParsedFiles } from "./mapFileReader";
import type { MapLayer } from "./mapLayers";
import type { MapPoint, MapRegions, MapShape } from "./mapMarkTypes";
import type { MapOpening } from "./mapOpening";
import type { MapCreditId } from "./markBudget";
import type { PlaceNeeds } from "./placeFiles";

export interface MapSpec {
  title?: string;
  valueLabel?: string;
  sizeLabel?: string;
  points: MapPoint[];
  regions?: MapRegions;
  shapes: MapShape[];
  layers?: MapLayer[];
  basemap?: MapBasemap;
  boundaries?: MapBoundaryId[];
  context?: MapContextId[];
  frame?: string;
  pitch?: number;
  view?: MapOpening;
  categoryLabel?: string;
  notes?: string[];
  credits?: MapCreditId[];
  byName?: NamedPlaces;
}

export interface NamedPlaces {
  placed: number;
  missing: number;
}

export interface MakeOptions {
  sources?: readonly string[];
  geojson?: GeoJsonNames;
  needs?: PlaceNeeds;
  parsed?: ParsedFiles;
}
