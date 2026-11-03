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

const VIEW_TRAITS = {
  latitude: "viewLatitude",
  longitude: "viewLongitude",
  zoom: "viewZoom",
  bearing: "viewBearing",
  pitch: "viewPitch",
} as const;
type ViewKey = keyof typeof VIEW_TRAITS;
type ViewValues = Partial<Record<ViewKey, number>>;
const REFUSAL_WINDOW_MS = 5000;

const round = (value: number, places: number) => Number(value.toFixed(places));

function viewOfCamera(camera: MapViewState["camera"]): ViewValues | null {
  if (!camera) return null;
  const [longitude, latitude] = camera.center;
  return {
    latitude: round(Math.max(-90, Math.min(90, latitude)), 5),
    longitude: round(Math.max(-180, Math.min(180, longitude)), 5),
    zoom: round(Math.max(0, Math.min(24, camera.zoom)), 2),
    bearing: round(camera.bearing ?? 0, 1),
    pitch: round(Math.max(0, Math.min(85, camera.pitch ?? 0)), 1),
  };
}

function targetOf(view: ViewValues): MapTarget | null {
  const { latitude, longitude, zoom, bearing, pitch } = view;
  const target: MapTarget = {
    ...(finite(latitude) && finite(longitude)
      ? { center: [longitude, latitude] as [number, number] }
      : {}),
    ...(finite(zoom) ? { zoom } : {}),
    ...(finite(bearing) ? { bearing } : {}),
    ...(finite(pitch) ? { pitch } : {}),
  };
  return Object.keys(target).length ? target : null;
}

function useViewSync(model: Model) {
  const latitude = useTrait<unknown>(model, VIEW_TRAITS.latitude);
  const longitude = useTrait<unknown>(model, VIEW_TRAITS.longitude);
  const zoom = useTrait<unknown>(model, VIEW_TRAITS.zoom);
  const bearing = useTrait<unknown>(model, VIEW_TRAITS.bearing);
  const pitch = useTrait<unknown>(model, VIEW_TRAITS.pitch);
  const view = useMemo(
    () =>
      Object.fromEntries(
        Object.entries({ latitude, longitude, zoom, bearing, pitch }).filter(([, value]) =>
          finite(value),
        ),
      ) as ViewValues,
    [latitude, longitude, zoom, bearing, pitch],
  );
  const key = JSON.stringify(view);
  const [target, setTarget] = useState<MapTarget | null>(null);
  const first = useRef(true);
  const own = useRef<{ written: string; before: string; at: number } | null>(null);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const mine = own.current;
    if (mine) {
      if (key === mine.written) return;
      own.current = null;
      if (key === mine.before && Date.now() - mine.at < REFUSAL_WINDOW_MS) return;
    }
    setTarget(targetOf(view));
  }, [key]);
  const latest = useRef(view);
  latest.current = view;
  const writeView = useCallback(
    (camera: MapViewState["camera"]) => {
      const next = viewOfCamera(camera);
      if (!next) return false;
      const written = JSON.stringify(next);
      const before = JSON.stringify(latest.current);
      if (written === before) return false;
      own.current = { written, before, at: Date.now() };
      for (const name of Object.keys(next) as ViewKey[])
        model.set(VIEW_TRAITS[name], next[name]);
      return true;
    },
    [model],
  );
  return { target, writeView };
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
  const { target, writeView } = useViewSync(model);
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
    (next: MapViewState) => {
      const kept = mapViewState(next);
      writeView(kept.camera);
      keep("mapView", kept);
    },
    [keep, writeView],
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
