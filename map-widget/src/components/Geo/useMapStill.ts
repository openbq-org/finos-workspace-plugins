import type { Map as MapLibreMap } from "maplibre-gl";
import {
  type MutableRefObject,
  type RefObject,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { MapSpec } from "~/lib/geo/mapSpecTypes";
import type { MapViewState } from "~/lib/geo/mapViewState";
import {
  cameraAt,
  type MapStill,
  mapPicture,
  STILL_WAIT_MS,
  stillShows,
} from "./mapStill";
import type { Scene } from "./scene/sceneTypes";
import type { KeptCamera } from "./useMapCamera";
import type { KeptCrowd } from "./useMapCrowd";
import { keptPart } from "./useMapView";

export interface MapCanvasSlot {
  live: boolean;

  passing: boolean;

  still: MapStill | null;

  onStill: (still: MapStill | null) => void;

  onStillCurrent: (current: boolean) => void;

  onReleased: () => void;

  onPlaying: (playing: boolean) => void;

  camera: MutableRefObject<KeptCamera | null>;

  crowd?: MutableRefObject<KeptCrowd | null>;
}

export function useMapStill({
  slot,
  map,
  scene,
  width,
  height,
  dark,
  spec,
  notes,
  view,
  drawn = "",
  camera,
  tagLayer,
  markerLayer,
}: {
  slot: MapCanvasSlot | undefined;
  map: MapLibreMap | null;

  scene: Scene | null;

  width: number | undefined;
  height: number | undefined;
  dark: boolean;
  spec: MapSpec;

  notes: unknown;
  view: MapViewState;

  drawn?: string;

  camera: KeptCamera | null;

  tagLayer: RefObject<HTMLDivElement>;
  markerLayer: RefObject<HTMLDivElement>;
}): boolean {
  const live = slot?.live ?? true;
  const still = slot?.still ?? null;

  const viewText = useMemo(() => {
    const { legend: _folded, camera: _stored, ...shown } = keptPart(view);
    return `${JSON.stringify(shown)}|${drawn}`;
  }, [view, drawn]);

  const [placedAt, setAt] = useState<string | null>(null);
  useEffect(() => {
    if (!map) return;
    const moved = () => setAt(cameraAt(map));
    moved();
    map.on("moveend", moved);
    return () => {
      map.off("moveend", moved);
    };
  }, [map]);
  const at = map ? placedAt : (still?.at ?? null);
  const shows = useMemo(
    () =>
      width && height
        ? { width, height, dark, spec, notes, view: viewText, camera, at }
        : null,
    [width, height, dark, spec, notes, viewText, camera, at],
  );
  const current = shows !== null && stillShows(still, shows);
  const onStill = slot?.onStill;
  const onStillCurrent = slot?.onStillCurrent;
  const onReleased = slot?.onReleased;
  const passing = slot?.passing ?? false;
  useEffect(() => {
    if (!live && shows) onStillCurrent?.(current);
  }, [live, shows, current, onStillCurrent]);
  useEffect(() => {
    if (!passing) return;
    if (current) return onReleased?.();

    const timer = setTimeout(() => onStill?.(null), 2 * STILL_WAIT_MS);
    return () => clearTimeout(timer);
  }, [passing, current, onStill, onReleased]);
  useEffect(() => {
    if (!passing || current || !map || !scene || !shows) return;
    const controller = new AbortController();
    const copies = (layer: HTMLElement | null) =>
      [...(layer?.children ?? [])].map((node) => node.cloneNode(true));

    let frame: { at: string; tags: Node[]; signs: Node[] } | null = null;
    mapPicture(map, controller.signal, undefined, () => {
      frame = {
        at: cameraAt(map),
        tags: copies(tagLayer.current),
        signs: copies(markerLayer.current),
      };
    }).then((picture) => {
      if (controller.signal.aborted) return;
      if (!picture || !frame) return onStill?.(null);
      const taken: { at: string; tags: Node[]; signs: Node[] } = frame;

      if (taken.at !== cameraAt(map)) return setAt(cameraAt(map));
      onStill?.({
        ...shows,
        at: taken.at,
        url: URL.createObjectURL(picture),
        bytes: picture.size,
        shown: {
          width: map.getCanvas().clientWidth,
          height: map.getCanvas().clientHeight,
        },
        tags: taken.tags,
        signs: taken.signs,
      });
    });
    return () => controller.abort();
  }, [passing, current, map, scene, shows, onStill, tagLayer, markerLayer]);

  useEffect(() => {
    if (live || !still) return;
    const copies = (nodes: readonly Node[]) =>
      nodes.map((node) => node.cloneNode(true));
    tagLayer.current?.replaceChildren(...copies(still.tags));
    markerLayer.current?.replaceChildren(...copies(still.signs));
  }, [live, still, tagLayer, markerLayer]);

  const [settled, setSettled] = useState<MapLibreMap | null>(null);
  useEffect(() => {
    if (!map) return;
    const idle = () => setSettled(map);
    map.on("idle", idle);
    return () => {
      map.off("idle", idle);
    };
  }, [map]);

  return still !== null && (!live || map === null || settled !== map);
}
