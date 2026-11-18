import { memo, useCallback, useId, useMemo } from "react";
import { contextOn, type MapContextId } from "~/lib/geo/mapContext";
import type { MapViewState } from "~/lib/geo/mapViewState";
import type { SceneContext } from "./basemapContext";
import { setContextLayer } from "./layerPanelState";
import { FOCUS } from "./mapControlStyles";
import type { SetMapView } from "./useMapView";

const NEEDS_DETAIL = "Needs a detailed basemap";

const fromZoom = (zoom: number) => `From zoom ${zoom}`;

const ROW = "flex h-5 items-center gap-1.5";

export const LayerPanelContext = memo(function LayerPanelContext({
  context,
  asked,
  zoom,
  basemap,
  onViewChange,
}: {
  context: readonly SceneContext[];
  asked: readonly MapContextId[];
  zoom: number;
  basemap: MapViewState["basemap"];
  onViewChange: SetMapView;
}) {
  const reason = useId();
  const on = useMemo(() => contextOn(asked, basemap), [asked, basemap]);
  const [held, missing] = useMemo(() => {
    const held: SceneContext[] = [];
    const missing: SceneContext[] = [];
    for (const layer of context) (layer.from === null ? missing : held).push(layer);
    return [held, missing];
  }, [context]);
  if (!context.length) return null;
  return (
    <fieldset className="m-0 mt-1 min-w-0 border-0 p-0">
      <legend className="p-0 ws-uppercase-small-title">Context</legend>
      {held.map((layer) => (
        <ContextSwitch
          key={layer.id}
          layer={layer}
          on={on.has(layer.id)}
          far={zoom < (layer.from ?? 0)}
          asked={asked}
          onViewChange={onViewChange}
        />
      ))}
      {missing.map((layer) => (
        <label key={layer.id} className={`${ROW} text-general-label-disabled`}>
          <input
            type="checkbox"
            checked={false}
            disabled
            readOnly
            aria-describedby={reason}
            className="m-0 size-3 shrink-0"
          />
          <span className="min-w-0 flex-1 truncate">{layer.label}</span>
        </label>
      ))}
      {missing.length > 0 && (
        <p id={reason} className="m-0 pl-[18px] text-ds-text-caption">
          {NEEDS_DETAIL}
        </p>
      )}
    </fieldset>
  );
});

const ContextSwitch = memo(function ContextSwitch({
  layer,
  on,
  far,
  asked,
  onViewChange,
}: {
  layer: SceneContext;
  on: boolean;
  far: boolean;
  asked: readonly MapContextId[];
  onViewChange: SetMapView;
}) {
  const flip = useCallback(
    () => onViewChange((view) => setContextLayer(view, layer.id, !on, asked)),
    [onViewChange, layer.id, on, asked],
  );
  return (
    <label className={`${ROW} cursor-pointer text-ds-text-body`}>
      <input
        type="checkbox"
        checked={on}
        onChange={flip}
        className={`m-0 size-3 shrink-0 cursor-pointer accent-brand-main ${FOCUS}`}
      />
      <span className="min-w-0 flex-1 truncate">{layer.label}</span>
      {far && (
        <span className="shrink-0 text-ds-text-caption">
          {fromZoom(layer.from ?? 0)}
        </span>
      )}
    </label>
  );
});
