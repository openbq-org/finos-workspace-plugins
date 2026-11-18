import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mapAsks, viewOver, viewUnder } from "~/lib/geo/mapAsks";
import type { MapSpec } from "~/lib/geo/mapSpecTypes";
import { type MapViewState, mapViewState } from "~/lib/geo/mapViewState";

export const VIEW_STORE_MS = 1_200;

export type MapViewChange = (now: MapViewState) => MapViewState;
export type SetMapView = (change: MapViewChange) => void;

export const keptPart = ({ panel: _open, ...rest }: MapViewState): MapViewState => rest;

export function useMapView(
  stored: unknown,
  onChange?: (state: MapViewState) => void,
  onWaiting?: (state: MapViewState | null) => void,
): [MapViewState, SetMapView] {
  const kept = useMemo(() => keptPart(mapViewState(stored)), [stored]);
  const keptText = useMemo(() => JSON.stringify(kept), [kept]);
  const [local, setLocal] = useState(kept);
  const latest = useRef(kept);
  const waiting = useRef<{
    timer: ReturnType<typeof setTimeout>;
    state: MapViewState;
  } | null>(null);
  const keeper = useRef(onChange);
  keeper.current = onChange;
  const handed = useRef(keptText);
  const storedText = useRef(keptText);
  storedText.current = keptText;
  const waits = useRef(onWaiting);
  waits.current = onWaiting;
  const told = useRef(false);
  const tell = useCallback((state: MapViewState | null) => {
    if (!(state || told.current)) return;
    told.current = Boolean(state);
    waits.current?.(state);
  }, []);

  const flush = useCallback(() => {
    const held = waiting.current;
    if (!held) return;
    clearTimeout(held.timer);
    waiting.current = null;
    const state = keptPart(held.state);
    handed.current = JSON.stringify(state);
    keeper.current?.(state);
    if (handed.current === storedText.current) tell(null);
  }, [tell]);

  useEffect(() => {
    if (!waiting.current) tell(null);
    if (!keeper.current || keptText === handed.current || waiting.current) return;
    handed.current = keptText;
    const next = latest.current.panel ? { ...kept, panel: latest.current.panel } : kept;
    latest.current = next;
    setLocal(next);
  }, [keptText, kept, tell]);

  useEffect(
    () => () => {
      flush();
      tell(null);
    },
    [flush, tell],
  );

  const set = useCallback<SetMapView>(
    (change) => {
      const state = mapViewState(change(latest.current));
      latest.current = state;
      setLocal(state);
      if (!keeper.current) return;
      if (waiting.current) clearTimeout(waiting.current.timer);
      waiting.current =
        JSON.stringify(keptPart(state)) === handed.current
          ? null
          : { state, timer: setTimeout(flush, VIEW_STORE_MS) };
      tell(waiting.current ? keptPart(state) : null);
    },
    [flush, tell],
  );
  return [local, set];
}

export function useAskedView(
  { boundaries, basemap }: Pick<MapSpec, "boundaries" | "basemap">,
  reader: MapViewState,
  setReader: SetMapView,
): [MapViewState, SetMapView] {
  const asks = useMemo(() => mapAsks({ boundaries, basemap }), [boundaries, basemap]);
  const view = useMemo(() => viewOver(asks, reader), [asks, reader]);
  const set = useCallback<SetMapView>(
    (change) => setReader((now) => viewUnder(asks, change(viewOver(asks, now)))),
    [asks, setReader],
  );
  return [view, set];
}
