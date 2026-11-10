import type { Map as MapLibreMap } from "maplibre-gl";
import { type MutableRefObject, useCallback, useEffect, useRef } from "react";
import { MAP_LIMITS } from "~/lib/codemode/limits";
import { boxZoom, CITY_ZOOM, type MapOpening } from "~/lib/geo/mapOpening";
import type { MapBounds } from "~/lib/geo/mapSummary";
import {
  cameraBox,
  cameraIsOf,
  type MapCamera,
  visibleBox,
} from "~/lib/geo/mapViewState";
import { bottomPartsRoom, closerFit, overlaysOver } from "./mapFit";
import { FEW_FIT_ZOOM, viewBounds } from "./mapGeometry";
import type { MapBeyond } from "./mapWords";

const FIT_MAX_ZOOM = 7;
export const COLUMN_PITCH = 45;
export const COLUMN_MAX_PITCH = 60;
export const COLUMN_BEARING = -12;
export const AREA_PITCH = 52;
export const AREA_BEARING = -24;
const LEGEND_LIST_WIDTH = 208;
const LIST_BESIDE_WIDTH = 640;
const TILT_ZOOM_OUT = 0.55;
const STEEP_ZOOM_OUT = 0.02;
const NOTE_LINE = 20;
const BEYOND_BY = 0.5;

export interface MapTarget {
  center?: [number, number];
  zoom?: number;
  bearing?: number;
  pitch?: number;
}

export interface KeptCamera {
  of: unknown;
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

export interface MapShown {
  box: [number, number, number, number];
  zoom: number;
}

export type MapPlacement = MapShown | "data" | null;

function shownBox(map: MapLibreMap): MapShown | null {
  if (map.getPitch() !== 0 || map.getBearing() !== 0) return null;
  const shown = map.getBounds();
  const box = visibleBox([
    shown.getWest(),
    shown.getSouth(),
    shown.getEast(),
    shown.getNorth(),
  ]);
  return box ? { box, zoom: map.getZoom() } : null;
}

const lngLatPair = (point: unknown): [number, number] => {
  if (Array.isArray(point)) return [Number(point[0]), Number(point[1])];
  const { lng, lon, lat } = point as { lng?: number; lon?: number; lat: number };
  return [Number(lng ?? lon), Number(lat)];
};

const TARGET_PADDING = 32;

export function useMapCamera({
  map,
  bounds,
  reach = 0,
  detailZoom,
  heading,
  noted = false,
  legend,
  legendList = false,
  slider = null,
  bottomRoom,
  opening,
  openingLimit,
  backdropZoom,
  onBeyond,
  onOpened,
  onPlaced,
  tilted,
  pitch = COLUMN_PITCH,
  bearing = COLUMN_BEARING,
  pitchable = false,
  camera,
  cameraOf,
  onCamera,
  stored,
  onStore,
  target,
}: {
  map: MapLibreMap | null;
  bounds: MapBounds | null;
  reach?: number;
  detailZoom: number;
  heading: boolean;
  noted?: boolean;
  legend: boolean;
  legendList?: boolean;
  slider?: "wide" | "compact" | null;
  bottomRoom?: number;
  opening?: MapOpening | null;
  openingLimit?: number;
  backdropZoom?: number;
  onBeyond?: (beyond: MapBeyond) => void;
  onOpened?: (shown: MapPlacement) => void;
  onPlaced?: () => void;
  tilted: boolean;
  pitch?: number;
  bearing?: number;
  pitchable?: boolean;
  camera?: MutableRefObject<KeptCamera | null>;
  cameraOf?: unknown;
  onCamera?: (kept: KeptCamera | null) => void;
  stored?: MapCamera;
  onStore?: (camera: MapCamera | null) => void;
  target?: MapTarget | null;
}): {
  reset: () => void;
  fitAll: () => void;
  zoom: (by: number) => void;
  tilt: () => void;
} {
  const moved = useRef(false);
  const placed = useRef(onPlaced);
  placed.current = onPlaced;
  const opened = useRef(onOpened);
  opened.current = onOpened;
  const store = useRef({ stored, onStore });
  store.current = { stored, onStore };
  const held = stored?.held === true;
  const fitZoom = Math.min(FEW_FIT_ZOOM, Math.max(FIT_MAX_ZOOM, detailZoom));
  const place = useCallback(
    (opening: MapOpening | null | undefined) => {
      if (!map) return;
      const { clientWidth, clientHeight } = map.getContainer();
      if (!clientWidth || !clientHeight) return;
      const scale = Math.min(1, clientWidth / 480, clientHeight / 320);
      const pad = (pixels: number) => Math.round(pixels * scale);
      const options = {
        padding: {
          top: pad((heading ? 40 : 24) + (noted ? NOTE_LINE : 0) + (tilted ? 36 : 0)),
          left:
            legendList &&
            clientWidth >= LIST_BESIDE_WIDTH &&
            clientWidth > 1.8 * clientHeight
              ? LEGEND_LIST_WIDTH
              : pad(28),
          right: pad(56),
          bottom:
            bottomRoom !== undefined
              ? bottomRoom + 36
              : slider === "compact"
                ? pad(legend ? 68 : 24) + 36
                : pad(legend || slider ? 68 : 24),
        },
        duration: 0,
        maxZoom: fitZoom,
      };
      const turned = opening?.bearing ?? 0;
      if (opening?.center)
        map.jumpTo({
          center: opening.center,
          zoom: opening.zoom ?? CITY_ZOOM,
          pitch: 0,
          bearing: turned,
        });
      else {
        const [west, south, east, north] = opening?.bounds ?? [0, 0, 0, 0];
        const data = viewBounds(bounds, fitZoom - FIT_MAX_ZOOM);
        const overlays = opening || tilted ? null : overlaysOver(map.getContainer());
        const closer =
          overlays &&
          closerFit({
            width: clientWidth,
            height: clientHeight,
            box: data,
            overlays,
            reach,
            maxZoom: fitZoom,
          });
        map.fitBounds(
          opening?.bounds
            ? [
                [west, south],
                [east, north],
              ]
            : data,
          {
            ...options,
            ...(closer
              ? {
                  padding: closer.padding,
                  maxZoom: closer.maxZoom,
                }
              : overlays
                ? {
                    padding: {
                      ...options.padding,
                      bottom: Math.max(
                        options.padding.bottom,
                        bottomPartsRoom(overlays, clientHeight, reach),
                      ),
                    },
                  }
                : {}),
            ...(opening?.bounds ? { maxZoom: MAP_LIMITS.viewZoom } : {}),
            pitch: 0,
            bearing: turned,
          },
        );
        if (opening?.zoom !== undefined) map.jumpTo({ zoom: opening.zoom });
      }
      const { top, left, right, bottom } = options.padding;
      const asked = !opening
        ? undefined
        : (opening.zoom ??
          (opening.center
            ? CITY_ZOOM
            : opening.bounds
              ? boxZoom(
                  opening.bounds,
                  Math.max(1, clientWidth - left - right),
                  Math.max(1, clientHeight - top - bottom),
                )
              : undefined));
      if (opening && openingLimit !== undefined && map.getZoom() > openingLimit)
        map.jumpTo({ zoom: openingLimit });
      onBeyond?.(
        openingLimit !== undefined &&
          asked !== undefined &&
          asked > openingLimit + BEYOND_BY
          ? "held"
          : backdropZoom !== undefined && map.getZoom() > backdropZoom + BEYOND_BY
            ? "past"
            : false,
      );
      const exact =
        opening?.center !== undefined &&
        opening.zoom !== undefined &&
        opening.pitch !== undefined;
      if (exact && tilted) map.jumpTo({ pitch: opening.pitch, bearing: turned });
      else if (tilted)
        map.jumpTo({
          zoom:
            map.getZoom() -
            Math.log2(Math.cos((pitch * Math.PI) / 180)) -
            TILT_ZOOM_OUT -
            Math.max(0, pitch - COLUMN_PITCH) * STEEP_ZOOM_OUT,
          pitch,
          bearing: opening?.bearing ?? bearing,
        });
      opened.current?.(opening ? shownBox(map) : "data");
      placed.current?.();
    },
    [
      map,
      bounds,
      reach,
      heading,
      noted,
      legend,
      legendList,
      slider,
      bottomRoom,
      fitZoom,
      tilted,
      pitch,
      bearing,
      openingLimit,
      backdropZoom,
      onBeyond,
    ],
  );
  const fitToData = useCallback(() => place(opening), [place, opening]);

  const free = tilted || pitchable;
  useEffect(() => {
    if (!map) return;
    if (free) {
      map.setMaxPitch(COLUMN_MAX_PITCH);
      map.dragRotate.enable();
      map.touchPitch.enable();
      map.touchZoomRotate.enableRotation();
      map.keyboard.enableRotation();
    } else {
      map.dragRotate.disable();
      map.touchPitch.disable();
      map.touchZoomRotate.disableRotation();
      map.keyboard.disableRotation();
      map.jumpTo({ pitch: 0, bearing: 0 });
      map.setMaxPitch(0);
    }
  }, [map, free]);

  useEffect(() => {
    if (!map) return;
    const leftBeyond = (zoom: number): MapBeyond =>
      backdropZoom !== undefined && zoom > backdropZoom + BEYOND_BY
        ? map.getZoom() < zoom
          ? "held"
          : "past"
        : false;
    const kept = camera?.current;
    const asked = store.current.stored;
    const fitting = Boolean(asked?.fit && asked.box);
    if (asked?.fit && asked.box) {
      const fitted = map.cameraForBounds(asked.box, { padding: TARGET_PADDING });
      const center = fitted?.center ? lngLatPair(fitted.center) : asked.center;
      const zoom = Math.min(
        map.getMaxZoom(),
        Math.max(map.getMinZoom(), fitted?.zoom ?? asked.zoom),
      );
      const { bearing = 0, pitch = 0 } = asked;
      moved.current = true;
      map.jumpTo({ center, zoom, bearing, pitch });
      onBeyond?.(leftBeyond(fitted?.zoom ?? zoom));
      if (camera) camera.current = { of: cameraOf, center, zoom, bearing, pitch };
      onCamera?.(camera?.current ?? null);
      placed.current?.();
    } else if (kept && kept.of === cameraOf) {
      moved.current = true;
      map.jumpTo({
        center: kept.center,
        zoom: kept.zoom,
        bearing: kept.bearing,
        pitch: kept.pitch,
      });
      onBeyond?.(leftBeyond(kept.zoom));
    } else if (store.current.stored && cameraIsOf(store.current.stored, bounds)) {
      const { center, zoom, bearing = 0, pitch = 0 } = store.current.stored;
      moved.current = true;
      map.jumpTo({ center, zoom, bearing, pitch });
      onBeyond?.(leftBeyond(zoom));
      if (camera) camera.current = { of: cameraOf, center, zoom, bearing, pitch };
      onCamera?.(camera?.current ?? null);
      placed.current?.();
    } else {
      moved.current = false;
      if (camera) camera.current = null;
      onCamera?.(null);
      fitToData();
    }
    const keep = (held = false) => {
      if (!moved.current) return;
      const { lng, lat } = map.getCenter();
      const now = {
        center: [lng, lat] as [number, number],
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      };
      const lon = ((((lng + 180) % 360) + 360) % 360) - 180;
      const box = cameraBox(bounds);
      const shown = map.getBounds();
      const seen = visibleBox([
        shown.getWest(),
        shown.getSouth(),
        shown.getEast(),
        shown.getNorth(),
      ]);
      store.current.onStore?.({
        ...now,
        center: [lon, lat],
        ...(box ? { of: box } : {}),
        ...(seen ? { box: seen } : {}),
        ...(held ? { held: true } : {}),
      });
      if (!camera) return;
      camera.current = { of: cameraOf, ...now };
      onCamera?.(camera.current);
    };
    const refit = () => {
      if (!moved.current) fitToData();
    };
    const touched = (event: { originalEvent?: unknown }) => {
      if (event.originalEvent) moved.current = true;
    };
    map.on("resize", refit);
    map.on("dragstart", touched);
    map.on("zoomstart", touched);
    map.on("rotatestart", touched);
    map.on("pitchstart", touched);
    const keepMoved = () => {
      keep();
    };
    map.on("moveend", keepMoved);
    if (fitting) keep(true);
    return () => {
      map.off("moveend", keepMoved);
      map.off("resize", refit);
      map.off("dragstart", touched);
      map.off("zoomstart", touched);
      map.off("rotatestart", touched);
      map.off("pitchstart", touched);
    };
  }, [
    map,
    fitToData,
    camera,
    cameraOf,
    onCamera,
    bounds,
    held,
    backdropZoom,
    onBeyond,
  ]);

  const targeted = useRef(target);
  useEffect(() => {
    if (!map || !target || targeted.current === target) {
      targeted.current = target;
      return;
    }
    targeted.current = target;
    const { lng, lat } = map.getCenter();
    if (
      (!target.center ||
        (Math.abs(target.center[0] - lng) < 1e-4 &&
          Math.abs(target.center[1] - lat) < 1e-4)) &&
      (target.zoom === undefined || Math.abs(target.zoom - map.getZoom()) < 0.01) &&
      (target.bearing === undefined || Math.abs(target.bearing - map.getBearing()) < 0.1) &&
      (target.pitch === undefined || Math.abs(target.pitch - map.getPitch()) < 0.1)
    )
      return;
    moved.current = true;
    map.easeTo({
      center: target.center ?? map.getCenter(),
      zoom: target.zoom ?? map.getZoom(),
      ...(free
        ? { bearing: target.bearing ?? map.getBearing(), pitch: target.pitch ?? map.getPitch() }
        : {}),
      duration: 500,
    });
  }, [map, target, free]);

  const reset = useCallback(() => {
    moved.current = false;
    if (camera) camera.current = null;
    onCamera?.(null);
    store.current.onStore?.(null);
    fitToData();
  }, [fitToData, camera, onCamera]);
  const fitAll = useCallback(() => {
    moved.current = true;
    place(null);
  }, [place]);
  const zoom = useCallback(
    (by: number) => {
      moved.current = true;
      map?.easeTo({ zoom: map.getZoom() + by, duration: 200 });
    },
    [map],
  );
  const tilt = useCallback(() => {
    if (!map || !free) return;
    moved.current = true;
    map.setMaxPitch(COLUMN_MAX_PITCH);
    map.easeTo({
      pitch: COLUMN_PITCH,
      bearing: COLUMN_BEARING,
      duration: 400,
    });
  }, [map, free]);
  return { reset, fitAll, zoom, tilt };
}
