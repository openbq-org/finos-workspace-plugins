import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MapSpec } from "~/lib/geo/mapSpecTypes";
import { markPlace } from "./markPlace";
import type { Scene } from "./scene/sceneTypes";

interface CanvasPoint {
  x: number;
  y: number;
}

export interface HoverGroup {
  layer: string;
  count: number;
  total?: number;
  at: [number, number];
}

const CARD = { width: 224, height: 132, gap: 14, edge: 4 };

export function cardPlace(
  { x, y }: CanvasPoint,
  width: number,
  height: number,
): { left: number; top: number } {
  const left =
    x + CARD.gap + CARD.width > width ? x - CARD.gap - CARD.width : x + CARD.gap;
  const top =
    y + CARD.gap + CARD.height > height ? y - CARD.gap - CARD.height : y + CARD.gap;
  return { left: Math.max(CARD.edge, left), top: Math.max(CARD.edge, top) };
}

export function useMapPointer(
  map: MapLibreMap | null,
  scene: Scene | null,
  spec: MapSpec,
  wheelZooms = false,
): {
  hover: number | null;
  pinned: number | null;
  group: HoverGroup | null;
  unpin: () => void;
  cardRef: (element: HTMLElement | null) => void;
} {
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const [group, setGroup] = useState<HoverGroup | null>(null);
  const groupNow = useRef<number | null>(null);
  const setHoverGroup = useCallback((id: number | null, next: HoverGroup | null) => {
    if (groupNow.current === id) return;
    groupNow.current = id;
    setGroup(next);
  }, []);
  const card = useRef<HTMLElement | null>(null);
  const hoverAt = useRef<CanvasPoint>({ x: 0, y: 0 });
  const hoverNow = useRef<number | null>(null);
  const setHovered = useCallback((index: number | null) => {
    if (hoverNow.current === index) return;
    hoverNow.current = index;
    setHover(index);
  }, []);
  const pin = useRef<{ index: number; at: CanvasPoint } | null>(null);
  const unpin = useCallback(() => {
    pin.current = null;
    setPinned(null);
  }, []);

  const place = useCallback(() => {
    const element = card.current;
    if (!element || !map) return;
    const { clientWidth, clientHeight } = map.getContainer();
    const { left, top } = cardPlace(
      pin.current?.at ?? hoverAt.current,
      clientWidth,
      clientHeight,
    );
    element.style.transform = `translate(${left}px, ${top}px)`;
  }, [map]);
  const cardRef = useCallback(
    (element: HTMLElement | null) => {
      card.current = element;
      place();
    },
    [place],
  );

  useEffect(() => {
    if (!map || !scene) return;
    const circles = scene.clustered.map((cluster) => cluster.circles);
    const read = [...new Set([...scene.pointer, ...circles])];
    const under = (event: MapMouseEvent) => {
      const layers = read.filter((id) => map.getLayer(id));
      const { x, y } = event.point;
      const found = layers.length
        ? map.queryRenderedFeatures(
            [
              [x - 3, y - 3],
              [x + 3, y + 3],
            ],
            { layers },
          )
        : [];
      const top = found.find((item) => scene.pointer.includes(item.layer.id));
      const index = top?.properties?.i;
      return {
        index: typeof index === "number" && scene.marks[index] ? index : null,
        cluster: found.find((item) => circles.includes(item.layer.id)),
      };
    };
    const over = (event: MapMouseEvent) => {
      const { index, cluster } = under(event);
      map.getCanvas().style.cursor = index !== null || cluster ? "pointer" : "";
      if (index !== null || cluster) {
        hoverAt.current = { x: event.point.x, y: event.point.y };
        place();
      }
      setHovered(index);
      const source =
        index === null && cluster
          ? scene.clustered.find((item) => item.circles === cluster.layer.id)
          : undefined;
      const id = cluster?.properties?.cluster_id;
      const count = Number(cluster?.properties?.point_count);
      if (!source?.optional || typeof id !== "number" || !(count > 0))
        return setHoverGroup(null, null);
      const total = Number(cluster?.properties?.total);
      setHoverGroup(id, {
        layer: source.layer,
        count,
        ...(source.sized && Number.isFinite(total) ? { total } : {}),
        at: [event.lngLat.lng, event.lngLat.lat],
      });
    };
    const out = () => {
      setHovered(null);
      setHoverGroup(null, null);
    };
    const openCluster = (
      found: ReturnType<typeof under>["cluster"],
      event: MapMouseEvent,
    ): boolean => {
      const id = found?.properties?.cluster_id;
      const source = scene.clustered.find((item) => item.circles === found?.layer.id);
      if (!found || typeof id !== "number" || !source) return false;
      const centre =
        found.geometry.type === "Point"
          ? (found.geometry.coordinates as [number, number])
          : event.lngLat;
      const clusters = map.getSource(source.source) as
        | { getClusterExpansionZoom?: (id: number) => Promise<number> }
        | undefined;
      clusters
        ?.getClusterExpansionZoom?.(id)
        .then((zoom) =>
          map.easeTo({ center: centre, zoom: Math.min(zoom, map.getMaxZoom()) }),
        )
        .catch(() => undefined);
      return true;
    };
    const click = (event: MapMouseEvent) => {
      map.cooperativeGestures.disable();
      const { index, cluster } = under(event);
      if (index === null) {
        openCluster(cluster, event);
        return unpin();
      }
      pin.current = { index, at: { x: event.point.x, y: event.point.y } };
      place();
      setPinned(index);
    };
    const follow = () => {
      const held = pin.current;
      const mark = held ? scene.marks[held.index] : null;
      const at = mark?.at;
      if (!held || !at) return;
      const { x, y } = markPlace(map, at, mark.lift);
      held.at = { x, y };
      place();
    };
    const leave = () => {
      if (!wheelZooms) map.cooperativeGestures.enable();
    };
    const box = map.getContainer();
    map.on("mousemove", over);
    map.on("mouseout", out);
    map.on("click", click);
    map.on("move", follow);
    box.addEventListener("mouseleave", leave);
    return () => {
      map.off("mousemove", over);
      map.off("mouseout", out);
      map.off("click", click);
      map.off("move", follow);
      box.removeEventListener("mouseleave", leave);
    };
  }, [map, scene, wheelZooms, place, unpin, setHovered, setHoverGroup]);

  useEffect(() => {
    setHovered(null);
    setHoverGroup(null, null);
    unpin();
  }, [spec, scene, unpin, setHovered, setHoverGroup]);

  return { hover, pinned, group, unpin, cardRef };
}
