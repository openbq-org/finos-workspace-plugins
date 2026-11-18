import { kmBetween } from "./geodesy";
import { lookingAt } from "./lookingAt";
import { backdropAsked, MAP_BASEMAP_PARTS } from "./mapAsks";
import { mapBoundary } from "./mapBoundaries";
import { MAP_CONTEXT, type MapContextId } from "./mapContext";
import { layerName, mapLayers } from "./mapLayers";
import { opensSomewhere } from "./mapOpening";
import type { MapSpec } from "./mapSpecTypes";
import type { MapCamera, MapViewState } from "./mapViewState";
import type { CityIndex } from "./regions/cities";

export const READER_VIEW = {
  named: 6,
  nameChars: 60,
  textChars: 480,
} as const;

const LEVELS = [
  { words: "street level", underKm: 15, fromZoom: 13 },
  { words: "city level", underKm: 150, fromZoom: 9 },
  { words: "state level", underKm: 1_500, fromZoom: 5.5 },
  { words: "country level", underKm: 6_000, fromZoom: 3 },
] as const;

export function nearWords(camera: Pick<MapCamera, "zoom" | "box">): string {
  const box = camera.box;
  if (box) {
    const middle = (box[1] + box[3]) / 2;
    const km = kmBetween([box[0], middle], [Math.min(box[2], box[0] + 180), middle]);
    return LEVELS.find(({ underKm }) => km < underKm)?.words ?? "world level";
  }
  return LEVELS.find(({ fromZoom }) => camera.zoom >= fromZoom)?.words ?? "world level";
}

export interface ReaderView {
  looking_at?: string;
  zoom: string;
  tilted?: string;
  turned?: string;
  in_view?: string;
  opens_on: string;
}

export interface ReaderSwitched {
  layers_turned_off?: string[];
  layers_turned_on?: string[];
  opacity?: string[];
  backdrop?: string[];
  context_on?: string[];
  context_off?: string[];
  boundaries_on?: string[];
  boundaries_off?: string[];
}

const cut = (value: string) =>
  value.length > READER_VIEW.nameChars
    ? `${value.slice(0, READER_VIEW.nameChars - 1)}…`
    : value;
const few = (names: readonly string[]) =>
  names.length ? names.slice(0, READER_VIEW.named) : undefined;
const degrees = (value: number) => `${Math.round(Math.abs(value))}°`;

function opensOn(spec: Pick<MapSpec, "view">): string {
  if (!opensSomewhere(spec.view)) return "all its data";
  const place = spec.view.place?.trim();
  return place
    ? `the view its map asks for: ${cut(place)}`
    : "the view its map asks for";
}

export function readerView(
  spec: Pick<MapSpec, "view">,
  camera: Pick<MapCamera, "zoom" | "pitch" | "bearing" | "box"> | undefined,
  cities: CityIndex | null,
  inView?: string,
): ReaderView | undefined {
  if (!camera) return undefined;
  const place = camera.box ? lookingAt(camera.box, cities) : null;
  return {
    ...(place ? { looking_at: place } : {}),
    zoom: nearWords(camera),
    ...(camera.pitch ? { tilted: degrees(camera.pitch) } : {}),
    ...(camera.bearing
      ? {
          turned: `${degrees(camera.bearing)} ${camera.bearing > 0 ? "east" : "west"} of north`,
        }
      : {}),
    ...(inView ? { in_view: inView } : {}),
    opens_on: opensOn(spec),
  };
}

const contextLabel = (id: MapContextId) =>
  MAP_CONTEXT.find((layer) => layer.id === id)?.label ?? id;
const PART_WORDS = {
  names: "place names",
  roads: "roads",
  borders: "borders",
} as const;

export function readerSwitched(
  spec: Parameters<typeof mapLayers>[0] & Pick<MapSpec, "basemap">,
  reader: MapViewState,
): ReaderSwitched | undefined {
  const layers = mapLayers(spec);
  const named = (
    ids: readonly string[] | undefined,
    keep: (visible: boolean) => boolean,
  ) =>
    layers
      .filter((layer) => ids?.includes(layer.id) && keep(layer.visible !== false))
      .map((layer) => cut(layerName(layer)));
  const opacity = layers.flatMap((layer) => {
    const value = reader.opacity?.[layer.id];
    return value === undefined
      ? []
      : [`${cut(layerName(layer))} ${Math.round(value * 100)}%`];
  });
  const basemap = reader.basemap ?? {};
  const chosen = basemap.choice;
  const source = layers.find((layer) => layer.id === chosen);
  const backdrop = [
    ...(chosen && chosen !== backdropAsked(spec.basemap)
      ? [cut(source ? layerName(source) : chosen)]
      : []),
    ...MAP_BASEMAP_PARTS.flatMap((part) =>
      basemap[part] === undefined
        ? []
        : [`${PART_WORDS[part]} ${basemap[part] ? "on" : "off"}`],
    ),
  ];
  const switched: ReaderSwitched = {
    layers_turned_off: few(named(reader.hidden, (visible) => visible)),
    layers_turned_on: few(named(reader.shown, (visible) => !visible)),
    opacity: few(opacity),
    backdrop: few(backdrop),
    context_on: few((basemap.context ?? []).map(contextLabel)),
    context_off: few((basemap.contextOff ?? []).map(contextLabel)),
    boundaries_on: few((reader.boundaries ?? []).map((id) => mapBoundary(id).label)),
    boundaries_off: few(
      (reader.boundariesOff ?? []).map((id) => mapBoundary(id).label),
    ),
  };
  const kept = Object.fromEntries(
    Object.entries(switched).filter(([, value]) => value !== undefined),
  ) as ReaderSwitched;
  return Object.keys(kept).length ? kept : undefined;
}

const SWITCHED_WORDS: Record<keyof ReaderSwitched, string> = {
  layers_turned_off: "layers turned off",
  layers_turned_on: "layers turned on",
  opacity: "opacity",
  backdrop: "backdrop",
  context_on: "context layers on",
  context_off: "context layers off",
  boundaries_on: "boundary layers on",
  boundaries_off: "boundary layers off",
};

export function readerViewText(
  view: ReaderView | undefined,
  switched: ReaderSwitched | undefined,
): string {
  const parts: string[] = [];
  if (view) {
    const where = [
      view.looking_at,
      view.zoom,
      view.tilted && `tilted ${view.tilted}`,
      view.turned && `turned ${view.turned}`,
      view.in_view && `${view.in_view} in view`,
    ].filter(Boolean);
    parts.push(`Looking at: ${where.join("; ")}. It opens on ${view.opens_on}.`);
  }
  if (switched) {
    const said = (Object.keys(SWITCHED_WORDS) as (keyof ReaderSwitched)[])
      .filter((key) => switched[key]?.length)
      .map((key) => `${SWITCHED_WORDS[key]}: ${switched[key]?.join(", ")}`);
    parts.push(`Switched by the user: ${said.join("; ")}.`);
  }
  const text = parts.join(" ");
  return text.length > READER_VIEW.textChars
    ? `${text.slice(0, READER_VIEW.textChars - 1)}…`
    : text;
}
