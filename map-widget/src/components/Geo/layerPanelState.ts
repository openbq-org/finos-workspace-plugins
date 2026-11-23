import type { MapBoundaryId } from "~/lib/geo/mapBoundaries";
import type { MapContextId } from "~/lib/geo/mapContext";
import {
  layerOpacity,
  layerVisible,
  type MapViewState,
  mapViewState,
} from "~/lib/geo/mapViewState";

export interface PanelLayer {
  id: string;
  visible?: false;
  opacity?: number;
  group?: string;
  note?: string;
}

export type BasemapPart = "names" | "roads" | "borders";

export const OPACITY_STEP = 5;

const without = (list: readonly string[] | undefined, id: string) =>
  (list ?? []).filter((entry) => entry !== id);

const withVisible = (view: MapViewState, layer: PanelLayer, on: boolean) => {
  if (layer.visible === false) {
    const shown = without(view.shown, layer.id);
    return { ...view, shown: on ? [...shown, layer.id] : shown };
  }
  const hidden = without(view.hidden, layer.id);
  return { ...view, hidden: on ? hidden : [...hidden, layer.id] };
};

export function toggleLayer(view: MapViewState, layer: PanelLayer): MapViewState {
  return mapViewState(withVisible(view, layer, !layerVisible(layer, view)));
}

const switchable = (layers: readonly PanelLayer[], group: string) =>
  layers.filter((layer) => layer.group === group && !layer.note);

export const groupVisible = (
  layers: readonly PanelLayer[],
  group: string,
  view: MapViewState,
): boolean => switchable(layers, group).some((layer) => layerVisible(layer, view));

export function toggleGroup(
  view: MapViewState,
  layers: readonly PanelLayer[],
  group: string,
): MapViewState {
  const on = !groupVisible(layers, group, view);
  return mapViewState(
    switchable(layers, group).reduce(
      (next, layer) => withVisible(next, layer, on),
      view,
    ),
  );
}

export function setLayerGrouped(
  view: MapViewState,
  layer: PanelLayer,
  on: boolean,
  crowded: boolean,
): MapViewState {
  const grouped = without(view.grouped, layer.id);
  const ungrouped = without(view.ungrouped, layer.id);
  return mapViewState({
    ...view,
    grouped: on && !crowded ? [...grouped, layer.id] : grouped,
    ungrouped: !on && crowded ? [...ungrouped, layer.id] : ungrouped,
  });
}

const stepped = (value: number) => {
  const percent = Math.min(
    100,
    Math.max(0, Number.isFinite(value) ? value * 100 : 100),
  );
  return (Math.round(percent / OPACITY_STEP) * OPACITY_STEP) / 100;
};

export const opacityPercent = (layer: PanelLayer, view: MapViewState): number =>
  Math.round(stepped(layerOpacity(layer, view)) * 100);

export function setLayerOpacity(
  view: MapViewState,
  layer: PanelLayer,
  value: number,
): MapViewState {
  const wanted = stepped(value);
  const { [layer.id]: _before, ...rest } = view.opacity ?? {};
  const same = wanted === stepped(layer.opacity ?? 1);
  return mapViewState({
    ...view,
    opacity: same ? rest : { ...rest, [layer.id]: Math.min(1, wanted) },
  });
}

export function setBasemapPart(
  view: MapViewState,
  part: BasemapPart,
  on: boolean,
): MapViewState {
  const { [part]: _before, ...rest } = view.basemap ?? {};
  return mapViewState({ ...view, basemap: on ? rest : { ...rest, [part]: false } });
}

export function setBasemapChoice(
  view: MapViewState,
  choice: string,
  basemaps: readonly { id: string }[],
): MapViewState {
  const { choice: _before, ...rest } = view.basemap ?? {};
  return mapViewState({
    ...view,
    basemap: choice === basemaps[0]?.id ? rest : { ...rest, choice },
  });
}

export function setContextLayer(
  view: MapViewState,
  id: MapContextId,
  on: boolean,
  asked: readonly string[],
): MapViewState {
  const { context, contextOff, ...rest } = view.basemap ?? {};
  const mapHasIt = asked.includes(id);
  return mapViewState({
    ...view,
    basemap: {
      ...rest,
      context: on && !mapHasIt ? [...without(context, id), id] : without(context, id),
      contextOff:
        !on && mapHasIt ? [...without(contextOff, id), id] : without(contextOff, id),
    },
  });
}

export function setBoundaryLayer(
  view: MapViewState,
  id: MapBoundaryId,
  on: boolean,
): MapViewState {
  const rest = without(view.boundaries, id);
  return mapViewState({ ...view, boundaries: on ? [...rest, id] : rest });
}

export function setPanelOpen(view: MapViewState, open: boolean): MapViewState {
  const { panel: _before, ...rest } = view;
  return mapViewState(open ? { ...rest, panel: "open" } : rest);
}

export function setLegendClosed(view: MapViewState, closed: boolean): MapViewState {
  const { legend: _before, ...rest } = view;
  return mapViewState(closed ? { ...rest, legend: "closed" } : rest);
}

export function groupLabels(groups: readonly string[]): Map<string, string> {
  const paths = [...new Set(groups)];
  const tail = (path: string) => path.split(" / ").at(-1)?.trim() || path;
  const tails = paths.map(tail);
  return new Map(
    paths.map((path, at) => [
      path,
      tails.indexOf(tails[at]) === tails.lastIndexOf(tails[at]) ? tails[at] : path,
    ]),
  );
}
