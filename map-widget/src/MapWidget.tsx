import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapView from "~/components/Geo/MapView";
import type { MapTarget } from "~/components/Geo/useMapCamera";
import { useMapSources } from "~/components/Geo/useMapSources";
import { useCitiesWhenMoved } from "~/components/Geo/useCitiesWhenMoved";
import type { WidgetMap } from "~/lib/geo/mapData";
import { NO_MAP_DATA } from "~/lib/geo/mapData";
import { type MapNotes, mapNotes } from "~/lib/geo/mapNotes";
import { type DrawnShape, mapShapes } from "~/lib/geo/mapShapes";
import { type MapViewState, mapViewState } from "~/lib/geo/mapViewState";
import { makeWidgetMap } from "~/lib/geo/widgetMapMake";
import { setSettings } from "~/settings";
import { setTheme } from "~/theme";
import { type Model, setShown } from "./widget";

interface Stored {
  mapNotes?: MapNotes;
  mapShapes?: DrawnShape[];
  mapView?: MapViewState;
}

function useTrait<T>(model: Model, name: string): T {
  const [value, setValue] = useState<T>(() => model.get(name));
  useEffect(() => {
    const update = () => setValue(model.get(name));
    model.on(`change:${name}`, update);
    update();
    return () => model.off(`change:${name}`, update);
  }, [model, name]);
  return value;
}

function useStored(model: Model) {
  const stored = useTrait<Stored | null>(model, "state");
  const latest = useRef<Stored>({});
  latest.current = stored ?? {};
  const keep = useCallback(
    (key: keyof Stored, value: unknown) => {
      const { [key]: _before, ...rest } = latest.current;
      const empty = Array.isArray(value)
        ? !value.length
        : !Object.keys(value as object).length;
      latest.current = empty ? rest : { ...rest, [key]: value };
      model.set("state", latest.current);
      model.save_changes();
    },
    [model],
  );
  return { stored: stored ?? {}, keep };
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function useTarget(model: Model): MapTarget | null {
  const latitude = useTrait<unknown>(model, "viewLatitude");
  const longitude = useTrait<unknown>(model, "viewLongitude");
  const zoom = useTrait<unknown>(model, "viewZoom");
  const bearing = useTrait<unknown>(model, "viewBearing");
  const pitch = useTrait<unknown>(model, "viewPitch");
  return useMemo(() => {
    const target: MapTarget = {
      ...(finite(latitude) && finite(longitude) ? { center: [longitude, latitude] as [number, number] } : {}),
      ...(finite(zoom) ? { zoom } : {}),
      ...(finite(bearing) ? { bearing } : {}),
      ...(finite(pitch) ? { pitch } : {}),
    };
    return Object.keys(target).length ? target : null;
  }, [latitude, longitude, zoom, bearing, pitch]);
}

const payloadOf = (data: unknown): unknown =>
  data && typeof data === "object" && !Array.isArray(data) && "results" in data
    ? (data as { results: unknown }).results
    : data;

interface Made {
  spec?: WidgetMap["spec"];
  error?: string;
  pending: boolean;
}

function useMade(payload: unknown, mapping: unknown, sourceIds: string[]): Made {
  const [made, setMade] = useState<Made>({ pending: true });
  const mappingKey = useMemo(() => JSON.stringify(mapping ?? null), [mapping]);
  const idsKey = sourceIds.join(",");
  useEffect(() => {
    if (payload === undefined || payload === null) {
      setMade({ pending: false });
      return;
    }
    let current = true;
    setMade((before) => ({ ...before, pending: true }));
    makeWidgetMap({ payload, mapping, sourceIds }).then(
      (result) =>
        current &&
        setMade({ spec: result?.spec, error: result?.error, pending: false }),
      (cause) =>
        current &&
        setMade({
          error: cause instanceof Error ? cause.message : String(cause),
          pending: false,
        }),
    );
    return () => {
      current = false;
    };
  }, [payload, mappingKey, idsKey]);
  return made;
}

export default function MapWidget({ model }: { model: Model }) {
  const data = useTrait<unknown>(model, "data");
  const mapping = useTrait<unknown>(model, "definition");
  const theme = useTrait<
    { mode?: string; tokens?: Record<string, string> } | undefined
  >(model, "theme");
  const meta = useTrait<{ name?: string; title?: string } | undefined>(model, "meta");
  const { stored, keep } = useStored(model);
  const target = useTarget(model);
  const tilesUrl = useTrait<unknown>(model, "mapTilesUrl");
  const tilesProvider = useTrait<unknown>(model, "mapTilesProvider");
  const adminSources = useTrait<unknown>(model, "mapSources");
  const declaredSources = (mapping as { sources?: unknown } | null | undefined)?.sources;
  useEffect(
    () =>
      setSettings({
        mapTilesUrl: tilesUrl,
        mapTilesProvider: tilesProvider,
        mapSources: adminSources,
        declaredSources,
      }),
    [tilesUrl, tilesProvider, adminSources, declaredSources],
  );
  useEffect(() => setTheme(theme), [theme]);
  useEffect(() => {
    document.documentElement.dataset.mode = theme?.mode === "light" ? "light" : "dark";
    for (const [token, value] of Object.entries(theme?.tokens ?? {}))
      document.documentElement.style.setProperty(`--plugin-${token}`, value);
  }, [theme]);
  const payload = useMemo(() => payloadOf(data), [data]);
  const emptyRows = Array.isArray(payload) && payload.length === 0;
  const held = useMapSources();
  const sourceIds = useMemo(() => held.sources.map(({ id }) => id), [held]);
  const { spec, error, pending } = useMade(emptyRows ? null : payload, mapping, sourceIds);
  const name = meta?.name ?? meta?.title ?? "Map";
  const notes = useMemo(() => mapNotes(stored.mapNotes), [stored.mapNotes]);
  const shapes = useMemo(() => mapShapes(stored.mapShapes), [stored.mapShapes]);
  const moved = useMemo(
    () => mapViewState(stored.mapView).camera !== undefined,
    [stored.mapView],
  );
  useCitiesWhenMoved(moved);
  useEffect(() => {
    setShown(spec ? { spec, name, notes, shapes, view: stored.mapView } : null);
    return () => setShown(null);
  }, [spec, name, notes, shapes, stored.mapView]);
  const onNotesChange = useCallback((next: MapNotes) => keep("mapNotes", next), [keep]);
  const onShapesChange = useCallback(
    (next: DrawnShape[]) => keep("mapShapes", mapShapes(next)),
    [keep],
  );
  const onViewChange = useCallback(
    (next: MapViewState) => keep("mapView", mapViewState(next)),
    [keep],
  );
  if (emptyRows)
    return (
      <p role="status" className="m-0 px-3 py-2 text-xs text-ds-text-body">
        No locations match this widget's current selection.
      </p>
    );
  if (spec)
    return (
      <div className="flex h-full min-h-0 flex-col">
        <MapView
          spec={spec}
          name={name}
          notes={notes}
          onNotesChange={onNotesChange}
          shapes={shapes}
          onShapesChange={onShapesChange}
          view={stored.mapView}
          onViewChange={onViewChange}
          target={target}
        />
      </div>
    );
  if (pending)
    return (
      <p role="status" className="m-0 px-3 py-2 text-xs text-ds-text-caption">
        Loading the map...
      </p>
    );
  return (
    <p role="alert" className="m-0 px-3 py-2 text-xs text-ds-text-body">
      {error ?? NO_MAP_DATA}
    </p>
  );
}
