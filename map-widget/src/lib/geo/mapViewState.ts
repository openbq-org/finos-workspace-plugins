import { MAP_LIMITS } from "~/lib/codemode/limits";
import { boundaryIds, type MapBoundaryId } from "./mapBoundaries";
import { contextIds, type MapContextId } from "./mapContext";
import { MAP_ID } from "./mapLayers";
import { isPlain, text } from "./mapValues";

export interface MapViewState {
  hidden?: string[];
  shown?: string[];
  grouped?: string[];
  ungrouped?: string[];
  opacity?: Record<string, number>;
  basemap?: {
    names?: boolean;
    roads?: boolean;
    borders?: boolean;
    choice?: string;
    context?: MapContextId[];
    contextOff?: MapContextId[];
  };
  boundaries?: MapBoundaryId[];
  boundariesOff?: MapBoundaryId[];
  camera?: MapCamera;
  drawn?: "off";
  inside?: string[];
  frame?: string;
  legend?: "closed";
  panel?: "open";
}

export interface MapCamera {
  center: [number, number];
  zoom: number;
  bearing?: number;
  pitch?: number;
  of?: [number, number, number, number];
  box?: [number, number, number, number];
  held?: true;
  fit?: true;
}

const within = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

const rounded = (value: number, digits: number) => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

export const cameraBox = (
  bounds: readonly number[] | null | undefined,
): MapCamera["of"] =>
  bounds?.length === 4 && bounds.every((value) => Number.isFinite(value))
    ? (bounds.map((value) => rounded(value, 3)) as MapCamera["of"])
    : undefined;

export const visibleBox = (bounds: unknown): MapCamera["box"] => {
  if (!Array.isArray(bounds) || bounds.length !== 4) return undefined;
  const [west, south, east, north] = bounds as unknown[];
  return within(west, -540, 540) &&
    within(east, -540, 540) &&
    within(south, -90, 90) &&
    within(north, -90, 90) &&
    west < east &&
    south < north
    ? [rounded(west, 4), rounded(south, 4), rounded(east, 4), rounded(north, 4)]
    : undefined;
};

const WORLD_PIXELS = 512;

export function boxOfView(
  camera: Pick<MapCamera, "center" | "zoom" | "bearing" | "pitch">,
  size: { width: number; height: number } | null | undefined,
): MapCamera["box"] {
  if (!size || !(size.width > 0 && size.height > 0)) return undefined;
  if ((camera.bearing ?? 0) !== 0 || (camera.pitch ?? 0) !== 0) return undefined;
  const world = WORLD_PIXELS * 2 ** camera.zoom;
  const [lon, lat] = camera.center;
  const sin = Math.sin((lat * Math.PI) / 180);
  if (!(Math.abs(sin) < 1)) return undefined;
  const x = ((lon + 180) / 360) * world;
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * world;
  const longitude = (at: number) => (at / world) * 360 - 180;
  const latitude = (at: number) =>
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * at) / world))) * 180) / Math.PI;
  const half = Math.min(size.width, world) / 2;
  const top = Math.max(0, y - size.height / 2);
  const bottom = Math.min(world, y + size.height / 2);
  return visibleBox([
    longitude(x - half),
    latitude(bottom),
    longitude(x + half),
    latitude(top),
  ]);
}

export function cameraWithBox(
  camera: MapCamera | undefined,
  size: { width: number; height: number } | null | undefined,
): MapCamera | undefined {
  if (!camera || camera.box) return camera;
  const box = boxOfView(camera, size);
  return box ? { ...camera, box } : camera;
}

export const viewFacts = (camera: MapCamera) => ({
  center: camera.center,
  zoom: camera.zoom,
  bearing: camera.bearing ?? 0,
  pitch: camera.pitch ?? 0,
  ...(camera.box ? { bounds: camera.box } : {}),
});

const SAME_VIEW = { degrees: 1e-4, zoom: 0.01, angle: 0.5, box: 1e-3 } as const;

export function sameView(
  view:
    | {
        center?: readonly number[];
        bounds?: readonly number[];
        zoom?: number;
        bearing?: number;
        pitch?: number;
      }
    | undefined,
  camera: MapCamera,
): boolean {
  if (!view) return false;
  const near = (a: number | undefined, b: number | undefined, by: number) =>
    Math.abs((a ?? 0) - (b ?? 0)) <= by;
  if (view.center && view.zoom !== undefined)
    return (
      near(view.center[0], camera.center[0], SAME_VIEW.degrees) &&
      near(view.center[1], camera.center[1], SAME_VIEW.degrees) &&
      near(view.zoom, camera.zoom, SAME_VIEW.zoom) &&
      near(view.bearing, camera.bearing, SAME_VIEW.angle) &&
      near(view.pitch, camera.pitch, SAME_VIEW.angle)
    );
  const box = camera.box;
  return Boolean(
    box &&
      view.bounds?.length === 4 &&
      !view.center &&
      view.bounds.every((value, at) => near(value, box[at], SAME_VIEW.box)),
  );
}

export const cameraIsOf = (
  camera: MapCamera,
  bounds: readonly number[] | null | undefined,
): boolean =>
  camera.held === true ||
  JSON.stringify(camera.of ?? null) === JSON.stringify(cameraBox(bounds) ?? null);

function cameraOf(raw: unknown): MapCamera | undefined {
  if (!isPlain(raw) || !Array.isArray(raw.center) || raw.center.length !== 2)
    return undefined;
  const [lon, lat] = raw.center as unknown[];
  if (!within(lon, -180, 180) || !within(lat, -90, 90)) return undefined;
  if (!within(raw.zoom, 0, MAP_LIMITS.viewZoom)) return undefined;
  const box =
    Array.isArray(raw.of) &&
    raw.of.length === 4 &&
    raw.of.every((value, at) => within(value, at % 2 ? -90 : -540, at % 2 ? 90 : 540))
      ? cameraBox(raw.of as number[])
      : undefined;
  const seen = visibleBox(raw.box);
  return {
    center: [rounded(lon, 5), rounded(lat, 5)],
    zoom: rounded(raw.zoom, 2),
    ...(within(raw.bearing, -180, 180) && raw.bearing !== 0
      ? { bearing: rounded(raw.bearing, 1) }
      : {}),
    ...(within(raw.pitch, 0, MAP_LIMITS.pitch) && raw.pitch !== 0
      ? { pitch: rounded(raw.pitch, 1) }
      : {}),
    ...(box ? { of: box } : {}),
    ...(seen ? { box: seen } : {}),
    ...(raw.held === true ? { held: true as const } : {}),
    ...(raw.fit === true && seen ? { fit: true as const } : {}),
  };
}

export function heldView<View>(view: View): View {
  if (!isPlain(view) || !isPlain(view.camera) || view.camera.held === true) return view;
  return { ...view, camera: { ...view.camera, held: true } };
}

const ids = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  const kept = new Set<string>();
  for (const id of raw.slice(0, MAP_LIMITS.viewIds))
    if (typeof id === "string" && MAP_ID.test(id)) kept.add(id);
  return [...kept];
};

const STEP_READ_CHARS = 4 * MAP_LIMITS.frameChars;

export function mapViewState(raw: unknown): MapViewState {
  if (!isPlain(raw)) return {};
  const hidden = ids(raw.hidden);
  const shown = ids(raw.shown).filter((id) => !hidden.includes(id));
  const ungrouped = ids(raw.ungrouped);
  const grouped = ids(raw.grouped).filter((id) => !ungrouped.includes(id));
  const opacity: [string, number][] = [];
  if (isPlain(raw.opacity))
    for (const [id, value] of Object.entries(raw.opacity).slice(0, MAP_LIMITS.viewIds))
      if (
        MAP_ID.test(id) &&
        typeof value === "number" &&
        Number.isFinite(value) &&
        value <= 1
      )
        opacity.push([id, Math.round(Math.max(0, value) * 100) / 100]);
  const given = isPlain(raw.basemap) ? raw.basemap : {};
  const contextOff = contextIds(given.contextOff);
  const context = contextIds(given.context).filter((id) => !contextOff.includes(id));
  const basemap = {
    ...(typeof given.names === "boolean" ? { names: given.names } : {}),
    ...(typeof given.roads === "boolean" ? { roads: given.roads } : {}),
    ...(typeof given.borders === "boolean" ? { borders: given.borders } : {}),
    ...(typeof given.choice === "string" && MAP_ID.test(given.choice)
      ? { choice: given.choice }
      : {}),
    ...(context.length ? { context } : {}),
    ...(contextOff.length ? { contextOff } : {}),
  };
  const step =
    typeof raw.frame === "string" && raw.frame.length <= STEP_READ_CHARS
      ? text(raw.frame, STEP_READ_CHARS)
      : undefined;
  const frame =
    step !== undefined && step.length <= MAP_LIMITS.frameChars ? step : undefined;
  const boundariesOff = boundaryIds(raw.boundariesOff);
  const boundaries = boundaryIds(raw.boundaries).filter(
    (id) => !boundariesOff.includes(id),
  );
  const camera = cameraOf(raw.camera);
  const inside = ids(raw.inside);
  return {
    ...(hidden.length ? { hidden } : {}),
    ...(shown.length ? { shown } : {}),
    ...(grouped.length ? { grouped } : {}),
    ...(ungrouped.length ? { ungrouped } : {}),
    ...(opacity.length ? { opacity: Object.fromEntries(opacity) } : {}),
    ...(Object.keys(basemap).length ? { basemap } : {}),
    ...(boundaries.length ? { boundaries } : {}),
    ...(boundariesOff.length ? { boundariesOff } : {}),
    ...(camera ? { camera } : {}),
    ...(raw.drawn === "off" ? { drawn: "off" as const } : {}),
    ...(inside.length ? { inside } : {}),
    ...(frame === undefined ? {} : { frame }),
    ...(raw.legend === "closed" ? { legend: "closed" as const } : {}),
    ...(raw.panel === "open" ? { panel: "open" as const } : {}),
  };
}

export const layerVisible = (
  layer: { id: string; visible?: false },
  view: MapViewState,
): boolean =>
  layer.visible === false
    ? Boolean(view.shown?.includes(layer.id))
    : !view.hidden?.includes(layer.id);

export const layerGrouped = (
  layer: { id: string },
  view: MapViewState,
  crowded: boolean,
): boolean =>
  view.ungrouped?.includes(layer.id)
    ? false
    : view.grouped?.includes(layer.id)
      ? true
      : crowded;

export const layerOpacity = (
  layer: { id: string; opacity?: number },
  view: MapViewState,
): number =>
  (view.opacity && Object.hasOwn(view.opacity, layer.id)
    ? view.opacity[layer.id]
    : undefined) ??
  layer.opacity ??
  1;
