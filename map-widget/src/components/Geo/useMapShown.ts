import { useMemo, useRef } from "react";
import { boundaryCredits, type MapBoundaryId } from "~/lib/geo/mapBoundaries";
import type { MapSpec } from "~/lib/geo/mapSpecTypes";
import { layerVisible, type MapViewState } from "~/lib/geo/mapViewState";
import { MAP_CREDITS } from "~/lib/geo/markBudget";
import { groupedLayers, marksOn } from "./applyMapView";
import { legendKeys } from "./mapLegendKeys";
import { requiredCredits } from "./mapWords";
import type { Scene } from "./scene/sceneTypes";
import type { SceneLayer } from "./sceneLayer";

const NOT_CROWDED: ReadonlySet<string> = new Set();
const COMPACT_WIDTH = 480;

export function useMapShown({
  scene,
  spec,
  layers,
  view,
  frame,
  crowd,
  width,
}: {
  scene: Scene | null;
  spec: MapSpec;
  layers: SceneLayer[];
  view: MapViewState;
  frame: string | undefined;
  crowd: ReadonlySet<string>;
  width: number | undefined;
}) {
  const shownBefore = useRef<SceneLayer[]>([]);
  const visible = useMemo(() => {
    const next = layers.filter((layer) => layerVisible(layer, view));
    const before = shownBefore.current;
    const same =
      next.length === before.length && next.every((layer, at) => layer === before[at]);
    if (!same) shownBefore.current = next;
    return shownBefore.current;
  }, [layers, view]);
  const credits = useMemo(
    () => [
      ...(scene?.backdropCredit ? [scene.backdropCredit] : []),
      ...visible.flatMap((layer) =>
        layer.attribution && !layer.note ? [layer.attribution] : [],
      ),
    ],
    [scene, visible],
  );

  const boundaries = (view.boundaries ?? []).join(",");
  const required = useMemo(() => {
    const on = boundaries ? (boundaries.split(",") as MapBoundaryId[]) : [];
    const more = boundaryCredits(on).map((id) => MAP_CREDITS[id].shown);
    return [...new Set([...requiredCredits(spec), ...more])];
  }, [spec, boundaries]);

  const grouped = useMemo(
    () => (scene ? groupedLayers(scene, view, crowd) : NOT_CROWDED),
    [scene, view, crowd],
  );
  const visibleIds = useMemo(
    () => new Set(visible.map((layer) => layer.id)),
    [visible],
  );
  const shown = useMemo(() => marksOn(visibleIds, frame), [visibleIds, frame]);
  const keys = useMemo(
    () => (scene ? legendKeys(scene.marks, shown, visible, grouped) : []),
    [scene, shown, visible, grouped],
  );
  const compact = (width ?? 0) < COMPACT_WIDTH;
  const legends = useMemo(
    () =>
      visible.filter((layer) => layer.scale || layer.ramp?.length || visible.length > 1)
        .length +
      (scene?.categories.length ? 2 : 0) +
      (keys.length ? 1 : 0),
    [visible, scene, keys],
  );
  const legendOpen = legends > 0 && view.legend !== "closed";
  return {
    visible,
    credits,
    required,
    grouped,
    shown,
    keys,
    compact,
    legends,
    legendOpen,
  };
}
