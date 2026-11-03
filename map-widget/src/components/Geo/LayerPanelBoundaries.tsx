import { memo, useCallback } from "react";
import {
  MAP_BOUNDARIES,
  type MapBoundaryId,
  type MapBoundaryLayer,
} from "~/lib/geo/mapBoundaries";
import { setBoundaryLayer } from "./layerPanelState";
import { FOCUS } from "./mapControlStyles";
import type { BoundaryState, BoundaryStates } from "./useMapBoundaries";
import type { SetMapView } from "./useMapView";

const NONE: readonly MapBoundaryId[] = [];
const NO_STATES: BoundaryStates = {};

const WORDS: Record<BoundaryState, string> = {
  loading: "Loading...",
  failed: "Could not be loaded.",
};

export const LayerPanelBoundaries = memo(function LayerPanelBoundaries({
  on = NONE,
  states = NO_STATES,
  zoom,
  onViewChange,
}: {
  on?: readonly MapBoundaryId[];
  states?: BoundaryStates;
  zoom: number;
  onViewChange: SetMapView;
}) {
  return (
    <fieldset className="m-0 mt-1 min-w-0 border-0 border-t border-solid border-surface-divider px-2 pb-0 pt-1">
      <legend className="sr-only">Boundaries</legend>
      <div aria-hidden className="ws-uppercase-small-title">
        Boundaries
      </div>
      {MAP_BOUNDARIES.map((layer) => (
        <BoundarySwitch
          key={layer.id}
          layer={layer}
          on={on.includes(layer.id)}
          state={states[layer.id]}
          far={layer.from > 0 && zoom < layer.from}
          onViewChange={onViewChange}
        />
      ))}
    </fieldset>
  );
});

const BoundarySwitch = memo(function BoundarySwitch({
  layer,
  on,
  state,
  far,
  onViewChange,
}: {
  layer: MapBoundaryLayer & { id: MapBoundaryId };
  on: boolean;
  state: BoundaryState | undefined;
  far: boolean;
  onViewChange: SetMapView;
}) {
  const flip = useCallback(
    () => onViewChange((view) => setBoundaryLayer(view, layer.id, !on)),
    [onViewChange, layer.id, on],
  );
  const said = !on
    ? null
    : state
      ? WORDS[state]
      : far
        ? `From zoom ${layer.from}`
        : null;
  return (
    <label className="flex h-5 cursor-pointer items-center gap-1.5 text-ds-text-body">
      <input
        type="checkbox"
        checked={on}
        onChange={flip}
        className={`m-0 size-3 shrink-0 cursor-pointer accent-brand-main ${FOCUS}`}
      />
      <span title={layer.label} className="min-w-0 flex-1 truncate">
        {layer.label}
      </span>
      {said && (
        <span role="status" className="shrink-0 text-ds-text-caption">
          {said}
        </span>
      )}
    </label>
  );
});
