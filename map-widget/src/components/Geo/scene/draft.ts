import { NO_HELD } from "~/lib/geo/heldMapSources";
import type { Feature } from "geojson";
import type { FilterSpecification, LayerSpecification } from "maplibre-gl";
import type { ShownLayer } from "~/lib/geo/mapLayers";
import type { Marked } from "~/lib/geo/mapMarkTypes";
import type { MapBounds } from "~/lib/geo/mapSummary";
import { collection, grow } from "../mapGeometry";
import { type MapScale, type MapTheme, toneColor } from "../mapTheme";
import type { SceneLayer } from "../sceneLayer";
import type { MapSources } from "../useMapSources";
import type {
  ClusteredSource,
  RegionShapeSets,
  Scene,
  SceneInput,
  SceneMark,
  ScenePicture,
  Slot,
} from "./sceneTypes";

export type {
  ClusteredSource,
  RegionShapeSets,
  RegionShapeSource,
  Scene,
  SceneInput,
  SceneMark,
  ScenePicture,
  Slot,
} from "./sceneTypes";

export interface Tint {
  scale: MapScale | null;
  color: string;
  of: (mark: Marked) => string;
}

export interface Draft {
  theme: MapTheme;
  translucent: boolean;
  unwrap: boolean;
  sets: RegionShapeSets;
  unloaded: ReadonlySet<string>;
  held: MapSources;
  sources: Scene["sources"];
  slots: Record<Slot, LayerSpecification[]>;
  marks: SceneMark[];
  listed: SceneMark[];
  unshaped: Set<string>;
  ambiguous: Scene["ambiguous"];
  pictures: ScenePicture[];
  pointer: string[];
  hover: string[];
  timed: Scene["timed"];
  clustered: ClusteredSource[];
  origins: Record<string, string>;
  glyphs: boolean;
  standing: string[];
  joints: ReadonlySet<string>;
  reach: (box: MapBounds | null) => void;
  view: () => {
    all: MapBounds | null;
    near: MapBounds | null;
    inside: number;
    abroad: number;
    total: number;
  };
}

export function newDraft(
  input: SceneInput,
  unwrap: boolean,
  translucent: boolean,
  joints: ReadonlySet<string> = new Set(),
): Draft {
  let all: MapBounds | null = null;
  let near: MapBounds | null = null;
  let inside = 0;
  let total = 0;
  let abroad = 0;
  return {
    theme: input.theme,
    translucent,
    unwrap,
    sets: input.sets ?? {},
    unloaded: new Set(input.unloaded),
    held: input.held ?? NO_HELD,
    sources: {},
    slots: { backdrop: [], fill: [], relief: [], line: [], overlay: [], top: [] },
    marks: [],
    listed: [],
    unshaped: new Set(),
    ambiguous: [],
    pictures: [],
    pointer: [],
    hover: [],
    timed: [],
    clustered: [],
    origins: {},
    glyphs: false,
    standing: [],
    joints,
    reach: (box) => {
      if (!box) return;
      total++;
      all = grow(all, box);
      const [lon, lat] = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
      if (lon > -128 && lon < -64 && lat > 20 && lat < 52) {
        inside++;
        near = grow(near, box);
      } else if (!farState(lon, lat)) abroad++;
    },
    view: () => ({ all, near, inside, total, abroad }),
  };
}

function farState(lon: number, lat: number): boolean {
  return (
    (lat >= 50 && lat <= 72 && (lon <= -128 || lon >= 170)) ||
    (lat >= 15 && lat <= 30 && lon <= -154) ||
    (lat >= 17 && lat <= 19 && lon >= -68 && lon <= -64) ||
    (lat >= 13 && lat <= 21 && lon >= 144 && lon <= 146) ||
    (lat >= -15 && lat <= -11 && lon <= -168)
  );
}

export const placeBox = (draft: Draft, lon: number, lat: number): MapBounds => {
  const x = draft.unwrap && lon > 0 ? lon - 360 : lon;
  return [x, lat, x, lat];
};

export const emphasisOf = (
  draft: Draft,
  mark: Marked,
): Pick<SceneMark, "marker" | "highlight" | "tone" | "meaning"> =>
  mark.marker === undefined && !mark.highlight
    ? {}
    : {
        ...(mark.marker === undefined ? {} : { marker: mark.marker }),
        ...(mark.highlight ? { highlight: true as const } : {}),
        tone: toneColor(draft.theme, mark.markerColor),
        ...(mark.meaning === undefined ? {} : { meaning: mark.meaning }),
      };

export const glowOf = (draft: Draft, mark: Marked) =>
  mark.highlight ? { h: 1, hc: toneColor(draft.theme, mark.markerColor) } : {};

export const GLOWING: FilterSpecification = ["==", ["get", "h"], 1];

export const stepOf = (mark: Marked) =>
  mark.time === undefined ? {} : { t: mark.time };

export const timeOf = (mark: Marked) =>
  mark.time === undefined ? {} : { time: mark.time };

export interface PartOptions {
  pointer?: boolean;
  hover?: boolean;
}

export interface LayerDraft {
  base: string;
  parts: SceneLayer["parts"];
  data: (id: string, features: Feature[], more?: Record<string, unknown>) => void;
  add: (
    slot: Slot,
    spec: LayerSpecification,
    opacity?: Record<string, number>,
    options?: PartOptions,
  ) => void;
}

export function layerDraft(
  draft: Draft,
  layer: ShownLayer,
  timed: boolean,
): LayerDraft {
  const parts: SceneLayer["parts"] = [];
  return {
    base: layer.implicit ? layer.id : `l:${layer.id}`,
    parts,
    data: (id, features, more = {}) => {
      draft.sources[id] = {
        type: "geojson",
        data: collection(features),
        tolerance: 0.2,
        ...more,
      };
    },
    add: (slot, spec, opacity = {}, options = {}) => {
      draft.slots[slot].push(spec);
      parts.push({ id: spec.id, opacity });
      if (options.pointer) draft.pointer.push(spec.id);
      if (options.hover) draft.hover.push(spec.id);
      else if (timed)
        draft.timed.push({
          id: spec.id,
          ...("filter" in spec && spec.filter ? { filter: spec.filter } : {}),
        });
    },
  };
}

export type Built = Pick<SceneLayer, "count" | "swatch"> &
  Partial<
    Pick<
      SceneLayer,
      "name" | "ramp" | "note" | "attribution" | "color" | "groupable" | "sized"
    >
  >;

export type Builder<K extends ShownLayer["kind"]> = (
  draft: Draft,
  layer: ShownLayer & { kind: K },
  to: LayerDraft,
  tint: Tint,
) => Built;
