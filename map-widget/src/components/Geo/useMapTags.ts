import type { Map as MapLibreMap } from "maplibre-gl";
import { type RefObject, useCallback, useEffect, useMemo, useRef } from "react";
import { MAP_LIMITS } from "~/lib/codemode/limits";
import type { MapNotes } from "~/lib/geo/mapNotes";
import { BASEMAP_SOURCE } from "./basemapStyle";
import {
  dotBox,
  drawMarkers,
  emphasisFirst,
  moveMarkers,
  type PlacedMarker,
  signBox,
  signReach,
} from "./mapSigns";
import {
  type Box,
  type Dot,
  drawTags,
  moveTags,
  namesAsTags,
  placeTags,
  type TagCandidate,
  tagMeasure,
  tagText,
} from "./mapTags";
import { markPlace } from "./markPlace";
import type { Scene, SceneMark } from "./scene/sceneTypes";

const TAG_CANDIDATES = 2_000;
const DOTS_AVOIDED = 400;
const HALO = 6;
export const SETTLE_MS = 120;
export const FADE_ZOOM = 0.35;
const CONTROLS = { width: 34, top: 8, button: 25, gap: 6 };
const BOTTOM_PARTS = "[data-map-legend], [data-map-time], [data-map-credit]";

function bottomBoxes(container: HTMLElement) {
  const box = container.parentElement;
  if (!box) return [];
  const origin = container.getBoundingClientRect();
  return [...box.querySelectorAll(BOTTOM_PARTS)].map((part) => {
    const { left, top, right, bottom } = part.getBoundingClientRect();
    return {
      left: left - origin.left,
      top: top - origin.top,
      right: right - origin.left,
      bottom: bottom - origin.top,
    };
  });
}

function basemapText(map: MapLibreMap): ((box: Box) => boolean) | undefined {
  const layers = (map.getStyle()?.layers ?? [])
    .filter(
      (layer) =>
        layer.type === "symbol" &&
        layer.source === BASEMAP_SOURCE &&
        layer.layout?.visibility !== "none",
    )
    .map((layer) => layer.id);
  if (!layers.length) return undefined;
  return ({ left, top, right, bottom }) =>
    map.queryRenderedFeatures(
      [
        [left, top],
        [right, bottom],
      ],
      { layers },
    ).length > 0;
}

export function useMapTags({
  map,
  scene,
  notes,
  heading,
  shown,
  grouped,
  legends,
  bottomHeight,
  controls,
  tagLayer,
  markerLayer,
  onHidden,
}: {
  map: MapLibreMap | null;
  scene: Scene | null;
  notes: MapNotes;
  heading: boolean;
  shown: (mark: SceneMark) => boolean;
  grouped: ReadonlySet<string>;
  legends: number;
  bottomHeight?: number;
  controls: number;
  tagLayer: RefObject<HTMLDivElement | null>;
  markerLayer: RefObject<HTMLDivElement | null>;
  onHidden?: (count: number) => void;
}): void {
  const order = useMemo(
    () =>
      scene
        ? emphasisFirst(scene.marks, (at) => {
            const key = scene.marks[at].key;
            return Boolean(key && notes[key]);
          })
        : [],
    [scene, notes],
  );
  const singles = useRef(new Map<string, Set<unknown>>());
  const readSingles = useCallback(() => {
    const read = new Map<string, Set<unknown>>();
    if (map && scene)
      for (const { layer, single, kept } of scene.clustered) {
        if (!grouped.has(layer)) continue;
        const drawn = [single, ...(kept ? [kept] : [])].filter((id) =>
          map.getLayer(id),
        );
        read.set(
          layer,
          new Set(
            drawn.length
              ? map
                  .queryRenderedFeatures({ layers: drawn })
                  .map((feature) => feature.properties?.i)
              : [],
          ),
        );
      }
    singles.current = read;
  }, [map, scene, grouped]);

  const bottom = useRef<ReturnType<typeof bottomBoxes>>([]);
  const readBottom = useCallback(() => {
    bottom.current = map ? bottomBoxes(map.getContainer()) : [];
  }, [map, legends, bottomHeight]);

  const namedPoints = useMemo(
    () => (scene ? namesAsTags(scene.marks) : false),
    [scene],
  );

  const layoutTags = useCallback(() => {
    const layer = tagLayer.current;
    if (!map || !scene || !layer) return;
    const { clientWidth, clientHeight } = map.getContainer();
    const candidates: TagCandidate[] = [];
    const widthOf = tagMeasure(layer);
    const signs: PlacedMarker[] = [];
    const signMarks: SceneMark[] = [];
    const dots: Dot[] = [];
    const small = scene.marks.length <= DOTS_AVOIDED;
    const named = namedPoints;
    const clustered = singles.current;
    const noteOf = (mark: SceneMark) => (mark.key ? notes[mark.key] : undefined);
    const counted = new Set(
      scene.clustered.filter((item) => item.optional).map((item) => item.layer),
    );
    const tracks = new Set(
      scene.clustered.filter((item) => item.track).map((item) => item.layer),
    );
    let tagged = 0;
    let inCircles = 0;
    for (const index of order) {
      if (candidates.length >= TAG_CANDIDATES) break;
      const mark = scene.marks[index];
      const note = noteOf(mark);
      const text = tagText(
        mark.tag ?? (named && mark.kind === "point" ? mark.label : undefined),
        note,
      );
      if (!mark.at || !shown(mark)) continue;
      const plain = !text && mark.marker === undefined;
      const dot = small && mark.kind === "point";
      if (plain && !dot) continue;
      const { x, y } = markPlace(map, mark.at, mark.lift);
      const seen = x >= 0 && y >= 0 && x <= clientWidth && y <= clientHeight;
      if (clustered.get(mark.layer)?.has(index) === false) {
        if (text && seen && counted.has(mark.layer)) inCircles++;
        continue;
      }
      if (text && seen) tagged++;
      const halo = mark.highlight && mark.kind === "point" ? HALO : 0;
      if (dot && seen)
        dots.push({
          ...dotBox(x, y, (mark.radius ?? 0) + halo),
          size: mark.radius ?? 0,
        });
      if (plain) continue;
      const sign: PlacedMarker | null =
        mark.marker === undefined
          ? null
          : {
              marker: mark.marker,
              x,
              y,
              radius: mark.radius,
              anchored: mark.kind === "point",
              color: mark.tone,
            };
      if (sign && seen && signs.length < MAP_LIMITS.markersShown) {
        signs.push(sign);
        signMarks.push(mark);
      }
      if (!text) continue;
      candidates.push({
        mark: index,
        text,
        width: widthOf(text),
        note: Boolean(note),
        marked: mark.marker !== undefined || Boolean(mark.highlight),
        x,
        y,
        offset: Math.max((mark.radius ?? 0) + halo, sign ? signReach(sign) : 0),
        centred: mark.kind !== "point" && mark.marker === undefined,
        size: mark.radius ?? 0,
        ...(tracks.has(mark.layer) ? { track: mark.layer } : {}),
      });
    }
    if (markerLayer.current) drawMarkers(markerLayer.current, signs);
    const where = new Map(candidates.map((tag) => [tag.mark, tag]));
    const placed = placeTags(
      candidates,
      clientWidth,
      clientHeight,
      [
        ...signs.map(signBox),
        {
          left: clientWidth - CONTROLS.width,
          top: 0,
          right: clientWidth,
          bottom: CONTROLS.top + CONTROLS.button * controls + CONTROLS.gap,
        },
        ...(heading
          ? [
              {
                left: 0,
                top: 0,
                right: clientWidth - CONTROLS.width,
                bottom: clientWidth < 480 ? 48 : 28,
              },
            ]
          : []),
        ...bottom.current,
      ],
      dots,
      basemapText(map),
    );
    drawTags(layer, placed);
    layer.style.opacity = "";
    drawn.current = {
      zoom: map.getZoom(),
      tags: placed.map((tag) => {
        const from = where.get(tag.mark) as TagCandidate;
        return {
          mark: scene.marks[tag.mark],
          dx: tag.left - from.x,
          dy: tag.top - from.y,
        };
      }),
      signs: signs.map((sign, at) => ({ mark: signMarks[at], sign })),
    };
    onHidden?.(tagged - placed.length + inCircles);
  }, [
    map,
    scene,
    namedPoints,
    notes,
    order,
    heading,
    shown,
    controls,
    tagLayer,
    markerLayer,
    onHidden,
  ]);

  const drawn = useRef<{
    zoom: number;
    tags: { mark: SceneMark; dx: number; dy: number }[];
    signs: { mark: SceneMark; sign: PlacedMarker }[];
  } | null>(null);
  const follow = useCallback(() => {
    const now = drawn.current;
    const layer = tagLayer.current;
    if (!map || !now || !layer) return;
    moveTags(
      layer,
      now.tags.map(({ mark, dx, dy }) => {
        const { x, y } = markPlace(map, mark.at as [number, number], mark.lift);
        return { left: x + dx, top: y + dy };
      }),
    );
    if (markerLayer.current)
      moveMarkers(
        markerLayer.current,
        now.signs.map(({ mark, sign }) => ({
          ...sign,
          ...markPlace(map, mark.at as [number, number], mark.lift),
        })),
      );
    const faded = Math.abs(map.getZoom() - now.zoom) > FADE_ZOOM ? "0.45" : "";
    if (layer.style.opacity !== faded) layer.style.opacity = faded;
  }, [map, tagLayer, markerLayer]);

  useEffect(() => {
    if (!map) return;
    const settled = () => {
      readSingles();
      layoutTags();
    };
    let resting: ReturnType<typeof setTimeout> | undefined;
    const moved = () => {
      follow();
      clearTimeout(resting);
      resting = setTimeout(layoutTags, SETTLE_MS);
    };
    const resized = () => {
      readBottom();
      layoutTags();
    };
    readBottom();
    settled();
    document.fonts?.addEventListener("loadingdone", layoutTags);
    map.on("move", moved);
    map.on("resize", resized);
    if (grouped.size) map.on("idle", settled);
    return () => {
      document.fonts?.removeEventListener("loadingdone", layoutTags);
      clearTimeout(resting);
      map.off("move", moved);
      map.off("resize", resized);
      map.off("idle", settled);
    };
  }, [map, scene, layoutTags, follow, readSingles, readBottom]);
}
