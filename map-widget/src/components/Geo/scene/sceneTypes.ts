import type { Feature } from "geojson";
import type {
  FilterSpecification,
  LayerSpecification,
  StyleSpecification,
} from "maplibre-gl";
import type { RefusedHeldSource } from "~/lib/geo/heldMapSources";
import type { MapContextId } from "~/lib/geo/mapContext";
import type { MapImage } from "~/lib/geo/mapLayers";
import type { MapMarker, MapPoint } from "~/lib/geo/mapMarkTypes";
import type { MapOpening } from "~/lib/geo/mapOpening";
import type { MapSpec } from "~/lib/geo/mapSpecTypes";
import type { MapBounds } from "~/lib/geo/mapSummary";
import type { Boundaries } from "~/lib/geo/regions/boundaries";
import type { RegionSetId } from "~/lib/geo/regions/regionTypes";
import type { Basemap } from "../basemap";
import type { SceneContext } from "../basemapContext";
import type { MapScale, MapTheme } from "../mapTheme";
import type { SceneLayer } from "../sceneLayer";
import type { MapSources } from "../useMapSources";
import type { BackdropChoice } from "./base";

export type RegionShapeSource = Pick<Boundaries, "shapeOf"> &
  Partial<Pick<Boundaries, "borders" | "outer" | "land">> & {
    resolve?: (
      code: string,
      within?: { country?: string; state?: string },
    ) => { id: string } | { ambiguous: string[] } | null;
    info?: (
      id: string,
    ) => { name: string; short: string; centre: [number, number] | null } | null;
    fine?: boolean;
  };
export type RegionShapeSets = Partial<Record<string, RegionShapeSource>>;

export interface SceneMark {
  kind: "point" | "region" | "shape" | "flow";
  code?: string;
  layer: string;
  time?: string;
  key?: string;
  at: [number, number] | null;
  lift?: number;
  label?: string;
  tag?: string;
  value?: number;
  props?: MapPoint["props"];
  color: string;
  radius?: number;
  reach?: number;
  size?: number;
  marker?: MapMarker;
  highlight?: true;
  tone?: string;
  meaning?: string;
}

export type Slot = "backdrop" | "fill" | "relief" | "line" | "overlay" | "top";

export interface ScenePicture {
  source: string;
  image: MapImage;
}

export interface ClusteredSource {
  layer: string;
  source: string;
  circles: string;
  single: string;
  features: Feature[];
  timed: boolean;
  optional?: { radius: number; maxZoom: number };
  kept?: string;
  track?: true;
  sized?: true;
}

export interface Scene {
  sources: StyleSpecification["sources"];
  style: LayerSpecification[];
  layers: SceneLayer[];
  overlayBefore?: string;
  marksBefore?: string;
  frames: string[];
  frame?: string;
  categories: { name: string; color: string }[];
  categoryLabel?: string;
  marks: SceneMark[];
  listed: SceneMark[];
  scale: MapScale | null;
  bounds: MapBounds | null;
  unshaped: string[];
  ambiguous: { set: RegionSetId; code: string; candidates: string[] }[];
  refused: readonly RefusedHeldSource[];
  pictures: ScenePicture[];
  outside: number;
  abroad?: number;
  backdropZoom: number;
  streets: boolean;
  openingLimit?: number;
  elsewhere?: string[];
  pointer: string[];
  hover: string[];
  timed: { id: string; filter?: FilterSpecification }[];
  clustered: ClusteredSource[];
  glyphs: boolean;
  standing: string[];
  buildings: { id: string; property: string; full: number }[];
  backdrop: string;
  basemaps: BackdropChoice[];
  basemapParts: { names: boolean; roads: boolean; borders: boolean };
  basemapIds: { names: string[]; roads: string[]; borders: string[] };
  context: SceneContext[];
  contextAsked: MapContextId[];
  credit: string | null;
  backdropCredit: string | null;
  maxZoom: number;
  viewZoom: number;
  detailZoom: number;
  origins: Record<string, string>;
  opening?: MapOpening;
}

export interface SceneInput {
  spec: MapSpec;
  world: Boundaries | null;
  states: Boundaries | null;
  sets?: RegionShapeSets;
  unloaded?: readonly string[];
  theme: MapTheme;
  sea: string;
  basemap: Basemap | null;
  held?: MapSources;
  choice?: string;
}
