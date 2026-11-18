import type { FilterSpecification, Map as MapLibreMap } from "maplibre-gl";
import { contextOn } from "~/lib/geo/mapContext";
import {
  layerGrouped,
  layerOpacity,
  layerVisible,
  type MapViewState,
} from "~/lib/geo/mapViewState";
import { collection } from "./mapGeometry";
import type { Scene, SceneMark } from "./scene/sceneTypes";

export const sceneFrame = (
  scene: Pick<Scene, "frames" | "frame">,
  view: MapViewState,
): string | undefined =>
  view.frame !== undefined && scene.frames.includes(view.frame)
    ? view.frame
    : (scene.frame ?? scene.frames.at(-1));

const onFrame = (frame: string): FilterSpecification => [
  "any",
  ["!", ["has", "t"]],
  ["==", ["get", "t"], frame],
];

const given = new WeakMap<MapLibreMap, { scene: Scene; steps: Map<string, string> }>();

function givenSteps(map: MapLibreMap, scene: Scene): Map<string, string> {
  const before = given.get(map);
  if (before?.scene === scene) return before.steps;
  const steps = new Map<string, string>();
  given.set(map, { scene, steps });
  return steps;
}

const EVERY_STEP = "\u0000every";

const groupedNow = new WeakMap<
  MapLibreMap,
  { scene: Scene; sources: Map<string, boolean> }
>();

export const groupedLayers = (
  scene: Pick<Scene, "clustered">,
  view: MapViewState,
  crowded: ReadonlySet<string>,
): Set<string> =>
  new Set(
    scene.clustered
      .filter(
        (item) =>
          !item.optional ||
          layerGrouped({ id: item.layer }, view, crowded.has(item.layer)),
      )
      .map((item) => item.layer),
  );

const NOT_CROWDED: ReadonlySet<string> = new Set();

export function applyMapView(
  map: MapLibreMap,
  scene: Scene,
  view: MapViewState,
  frame: string | undefined,
  crowded: ReadonlySet<string> = NOT_CROWDED,
): void {
  for (const { source, layer, optional } of scene.clustered) {
    if (!optional) continue;
    const target = map.getSource(source) as
      | { setClusterOptions?: (options: Record<string, unknown>) => unknown }
      | undefined;
    if (!target?.setClusterOptions) continue;
    const before = groupedNow.get(map);
    const sources =
      before?.scene === scene ? before.sources : new Map<string, boolean>();
    if (before?.scene !== scene) groupedNow.set(map, { scene, sources });
    const on = layerGrouped({ id: layer }, view, crowded.has(layer));
    if ((sources.get(source) ?? false) === on) continue;
    sources.set(source, on);
    target.setClusterOptions({
      cluster: on,
      clusterRadius: optional.radius,
      clusterMaxZoom: optional.maxZoom,
    });
  }
  for (const layer of scene.layers) {
    const visibility = layerVisible(layer, view) ? "visible" : "none";
    const opacity = layerOpacity(layer, view);
    for (const part of layer.parts) {
      if (!map.getLayer(part.id)) continue;
      map.setLayoutProperty(part.id, "visibility", visibility);
      for (const [property, full] of Object.entries(part.opacity))
        map.setPaintProperty(
          part.id,
          property as Parameters<MapLibreMap["setPaintProperty"]>[1],
          Math.round(full * opacity * 1000) / 1000,
        );
    }
  }
  if (frame !== undefined) {
    const step = onFrame(frame);
    for (const { id, filter } of scene.timed)
      if (map.getLayer(id))
        map.setFilter(
          id,
          filter ? (["all", filter, step] as FilterSpecification) : step,
        );
    for (const {
      source,
      single,
      layer,
      features,
      timed,
      optional,
    } of scene.clustered) {
      if (!timed || !map.getLayer(single)) continue;
      const whole = optional && !layerGrouped({ id: layer }, view, crowded.has(layer));
      const wanted = whole ? EVERY_STEP : frame;
      const steps = givenSteps(map, scene);
      if ((steps.get(source) ?? (optional ? EVERY_STEP : undefined)) === wanted)
        continue;
      const target = map.getSource(source) as
        | { setData?: (data: unknown) => void }
        | undefined;
      if (!target?.setData) continue;
      steps.set(source, wanted);
      target.setData(
        collection(
          whole
            ? features
            : features.filter(
                (item) =>
                  item.properties?.t === undefined || item.properties.t === frame,
              ),
        ),
      );
    }
  }
  for (const part of ["names", "roads", "borders"] as const) {
    const visibility = view.basemap?.[part] === false ? "none" : "visible";
    for (const id of scene.basemapIds[part])
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visibility);
  }
  const faint = standingShown(scene, view) ? FAINT_BUILDINGS : 1;
  for (const { id, property, full } of scene.buildings)
    if (map.getLayer(id))
      map.setPaintProperty(
        id,
        property as Parameters<MapLibreMap["setPaintProperty"]>[1],
        Math.round(full * faint * 100) / 100,
      );
  const on = contextOn(scene.contextAsked, view.basemap);
  for (const layer of scene.context) {
    const visibility = on.has(layer.id) ? "visible" : "none";
    for (const id of layer.ids)
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visibility);
  }
}

export const tallBuildingsShown = (
  scene: Pick<Scene, "context" | "contextAsked">,
  view: MapViewState,
): boolean =>
  contextOn(scene.contextAsked, view.basemap).has("buildings-3d") &&
  scene.context.some((layer) => layer.id === "buildings-3d" && layer.from !== null);

export function shownMarks(
  scene: Scene,
  view: MapViewState,
  frame: string | undefined,
): (mark: SceneMark) => boolean {
  return marksOn(
    new Set(
      scene.layers
        .filter((layer) => layerVisible(layer, view))
        .map((layer) => layer.id),
    ),
    frame,
  );
}

export const marksOn =
  (visible: ReadonlySet<string>, frame: string | undefined) =>
  (mark: SceneMark): boolean =>
    visible.has(mark.layer) && (mark.time === undefined || mark.time === frame);

export const columnsShown = (scene: Scene, view: MapViewState): boolean =>
  scene.layers.some(
    (layer) => layer.kind === "columns" && layer.count > 0 && layerVisible(layer, view),
  );

export const CITY_SPAN_DEGREES = 0.5;
export const CITY_VIEW_ZOOM = 10;
export const FAINT_BUILDINGS = 0.3;

export const standingShown = (
  scene: Pick<Scene, "layers" | "standing">,
  view: MapViewState,
): boolean =>
  scene.layers.some(
    (layer) =>
      scene.standing.includes(layer.id) && layer.count > 0 && layerVisible(layer, view),
  );

export function opensOnCity(scene: Pick<Scene, "bounds" | "opening">): boolean {
  const zoom = scene.opening?.zoom;
  if (zoom !== undefined && zoom < CITY_VIEW_ZOOM) return false;
  if (scene.opening?.center) return true;
  const box = scene.opening?.bounds ?? scene.bounds;
  return (
    box !== null &&
    box[2] - box[0] <= CITY_SPAN_DEGREES &&
    box[3] - box[1] <= CITY_SPAN_DEGREES
  );
}

export function failedLayer(scene: Scene, event: unknown): string | null {
  const source =
    event !== null && typeof event === "object" && "sourceId" in event
      ? event.sourceId
      : undefined;
  return typeof source === "string" && Object.hasOwn(scene.origins, source)
    ? scene.origins[source]
    : null;
}
