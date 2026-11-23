import type { Map as MapLibreMap } from "maplibre-gl";
import { MAP_LIMITS } from "~/lib/codemode/limits";
import { kmBetween, type Position } from "~/lib/geo/geodesy";
import {
  type DrawnKind,
  type DrawnShape,
  newShapeId,
  shapePath,
} from "~/lib/geo/mapShapes";
import type { DrawDraft } from "../shapeLayers";

export type DrawMode = DrawnKind | "select" | "distance" | "area";

const drawn = (mode: DrawMode): DrawnKind =>
  mode === "distance" ? "line" : mode === "area" ? "polygon" : (mode as DrawnKind);
const measuring = (mode: DrawMode) => mode === "distance" || mode === "area";

export interface DrawHost {
  map: MapLibreMap;
  shapes: () => readonly DrawnShape[];
  onShapes: (next: DrawnShape[]) => void;
  onDraft: (draft: DrawDraft | null) => void;
  onSelect: (id: string | null) => void;
  onMode: (mode: DrawMode) => void;
  onLeave: () => void;
  onHold?: (held: boolean) => void;
}

export interface DrawTool {
  setMode: (mode: DrawMode) => void;
  select: (id: string | null) => void;
  finish: () => boolean;
  cancel: () => boolean;
  undo: () => void;
  refresh: () => void;
  keepMeasure: () => boolean;
  stop: () => void;
}

interface PointerEvent {
  point: { x: number; y: number };
  lngLat: { lng: number; lat: number };
  preventDefault?: () => void;
  originalEvent?: { preventDefault?: () => void };
}

interface Pixel {
  x: number;
  y: number;
}

const GRAB = { handle: 10, line: 7, point: 11 };

const wrap = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;
const beside = (lon: number, other: number) =>
  lon + 360 * Math.round((other - lon) / 360);
const micro = (value: number) => Math.round(value * 1e6) / 1e6;
const clampLat = (lat: number) => Math.max(-90, Math.min(90, lat));

const rectangle = (a: Position, c: Position): Position[] => [
  a,
  [c[0], a[1]],
  c,
  [a[0], c[1]],
  a,
];
const RECTANGLE_MOVED_CORNER = 2;
const RELEASES_OUTSIDE = ["mouseup", "touchend", "touchcancel", "blur"] as const;

export function handlesOf(shape: DrawnShape): Position[] {
  if (shape.kind === "circle" && shape.geometry.type === "Point") {
    const centre = shape.geometry.coordinates;
    const rim = shapePath(shape)[Math.round((shapePath(shape).length - 1) / 4)];
    return rim ? [centre, rim] : [centre];
  }
  if (shape.geometry.type === "Point") return [shape.geometry.coordinates];
  if (shape.geometry.type === "LineString") return shape.geometry.coordinates;
  return shape.geometry.coordinates[0].slice(0, -1);
}

export function moveHandle(shape: DrawnShape, at: number, to: Position): DrawnShape {
  if (shape.kind === "circle" && shape.geometry.type === "Point") {
    if (at === 0)
      return {
        ...shape,
        geometry: { type: "Point", coordinates: [wrap(to[0]), to[1]] },
      };
    const km = Math.min(
      MAP_LIMITS.drawnRadiusKm,
      Math.max(0.001, kmBetween(shape.geometry.coordinates, to)),
    );
    return { ...shape, radiusKm: km };
  }
  if (shape.geometry.type === "Point")
    return {
      ...shape,
      geometry: { type: "Point", coordinates: [micro(wrap(to[0])), to[1]] },
    };
  if (shape.geometry.type === "LineString") {
    const coordinates = shape.geometry.coordinates.map((place, nth) =>
      nth === at ? to : place,
    );
    return { ...shape, geometry: { type: "LineString", coordinates } };
  }
  const corners = shape.geometry.coordinates[0].slice(0, -1);
  if (shape.kind === "rectangle" && corners.length === 4) {
    const across = corners[(at + 2) % 4];
    return {
      ...shape,
      geometry: { type: "Polygon", coordinates: [rectangle(across, to)] },
    };
  }
  const moved = corners.map((place, nth) => (nth === at ? to : place));
  return {
    ...shape,
    geometry: { type: "Polygon", coordinates: [[...moved, moved[0]]] },
  };
}

export function startDrawTool(host: DrawHost): DrawTool {
  const { map } = host;
  let mode: DrawMode = "select";
  let selected: string | null = null;
  let placed: Position[] = [];
  let pointer: Position | null = null;
  let held: { at: number } | null = null;
  let measured: Position[] | null = null;
  let stopped = false;

  const selectedShape = () => host.shapes().find((shape) => shape.id === selected);

  const pixel = (place: Position, near?: Pixel): Pixel => {
    const drawn = map.project(place as [number, number]);
    const at = { x: drawn.x, y: drawn.y };
    if (!near) return at;
    const turn = map.project([place[0] + 360, place[1]]);
    const [dx, dy] = [turn.x - at.x, turn.y - at.y];
    let best = at;
    for (const copies of [-1, 1]) {
      const other = { x: at.x + copies * dx, y: at.y + copies * dy };
      if (
        Math.hypot(other.x - near.x, other.y - near.y) <
        Math.hypot(best.x - near.x, best.y - near.y)
      )
        best = other;
    }
    return best;
  };
  const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);
  const toStretch = (
    p: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
  ) => {
    const [dx, dy] = [b.x - a.x, b.y - a.y];
    const length = dx * dx + dy * dy;
    const along =
      length === 0
        ? 0
        : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
    return Math.hypot(p.x - (a.x + along * dx), p.y - (a.y + along * dy));
  };
  const shapeAt = (at: { x: number; y: number }): DrawnShape | undefined => {
    const shapes = host.shapes();
    for (let nth = shapes.length - 1; nth >= 0; nth--) {
      const shape = shapes[nth];
      const path = shapePath(shape).map((place) => pixel(place, at));
      if (shape.kind === "point") {
        if (path[0] && distance(path[0], at) <= GRAB.point) return shape;
        continue;
      }
      for (let a = 1; a < path.length; a++)
        if (toStretch(at, path[a - 1], path[a]) <= GRAB.line) return shape;
      if (shape.kind === "line") continue;
      let inside = false;
      for (let a = 0, b = path.length - 1; a < path.length; b = a++)
        if (
          path[a].y > at.y !== path[b].y > at.y &&
          at.x <
            ((path[b].x - path[a].x) * (at.y - path[a].y)) / (path[b].y - path[a].y) +
              path[a].x
        )
          inside = !inside;
      if (inside) return shape;
    }
    return undefined;
  };
  const handleAt = (at: { x: number; y: number }): number | null => {
    const shape = selectedShape();
    if (!shape) return null;
    const handles = handlesOf(shape);
    let best: number | null = null;
    let nearest = GRAB.handle;
    handles.forEach((place, nth) => {
      const far = distance(pixel(place, at), at);
      if (far <= nearest) {
        nearest = far;
        best = nth;
      }
    });
    return best;
  };

  const placeOf = (event: PointerEvent, before?: Position): Position => {
    const lat = micro(clampLat(event.lngLat.lat));
    return before
      ? [micro(beside(event.lngLat.lng, before[0])), lat]
      : [micro(wrap(event.lngLat.lng)), lat];
  };

  const draw = () => {
    if (stopped) return;
    if (mode === "select") {
      const shape = selectedShape();
      return host.onDraft(shape ? { handles: handlesOf(shape) } : null);
    }
    if (measured)
      return host.onDraft({
        path: measured,
        closed: mode === "area",
        handles: measured,
        shape: {
          kind: drawn(mode),
          path: mode === "area" ? [...measured, measured[0]] : measured,
        },
        measured: true,
      });
    if (!placed.length) return host.onDraft(null);
    const next = pointer ? [...placed, pointer] : placed;
    if (mode === "rectangle") {
      const ring = next.length > 1 ? rectangle(next[0], next[1]) : null;
      return host.onDraft(
        ring
          ? {
              path: ring.slice(0, -1),
              closed: true,
              handles: placed,
              shape: { kind: "rectangle", path: ring },
            }
          : { handles: placed },
      );
    }
    if (mode === "circle") {
      const km =
        next.length > 1
          ? Math.min(MAP_LIMITS.drawnRadiusKm, kmBetween(next[0], next[1]))
          : 0;
      const ring =
        km > 0
          ? shapePath({
              id: "draft",
              kind: "circle",
              geometry: { type: "Point", coordinates: next[0] },
              radiusKm: km,
            }).slice(0, -1)
          : [];
      return host.onDraft({
        path: ring,
        closed: true,
        handles: placed,
        ...(km > 0 ? { shape: { kind: "circle", path: [next[0]], radiusKm: km } } : {}),
      });
    }
    const kind = drawn(mode);
    host.onDraft({
      path: next,
      closed: kind === "polygon",
      handles: placed,
      shape: { kind, path: kind === "polygon" ? [...next, next[0]] : next },
    });
  };

  const keep = (shape: Omit<DrawnShape, "id">) => {
    const shapes = host.shapes();
    placed = [];
    pointer = null;
    if (shapes.length >= MAP_LIMITS.drawnShapes) return draw();
    const made: DrawnShape = { id: newShapeId(shapes), ...shape };
    host.onShapes([...shapes, made]);
    mode = "select";
    selected = made.id;
    host.onMode("select");
    host.onSelect(made.id);
    host.onDraft({ handles: handlesOf(made) });
  };

  const finish = (): boolean => {
    if (measuring(mode)) {
      if (placed.length < (mode === "area" ? 3 : 2)) return false;
      measured = placed;
      placed = [];
      pointer = null;
      draw();
      return true;
    }
    if (mode === "line" && placed.length >= 2) {
      keep({ kind: "line", geometry: { type: "LineString", coordinates: placed } });
      return true;
    }
    if (mode === "polygon" && placed.length >= 3) {
      keep({
        kind: "polygon",
        geometry: { type: "Polygon", coordinates: [[...placed, placed[0]]] },
      });
      return true;
    }
    return false;
  };
  const cancel = (): boolean => {
    if (!placed.length && !measured) return false;
    measured = null;
    placed = [];
    pointer = null;
    draw();
    return true;
  };
  const undo = () => {
    if (!placed.length) return;
    placed = placed.slice(0, -1);
    draw();
  };

  const click = (event: PointerEvent) => {
    if (mode === "select") {
      const shape = shapeAt(event.point);
      selected = shape?.id ?? null;
      host.onSelect(selected);
      return draw();
    }
    measured = null;
    const place = placeOf(event, placed[placed.length - 1]);
    if (mode === "point")
      return keep({ kind: "point", geometry: { type: "Point", coordinates: place } });
    const last = placed[placed.length - 1];
    if (last && distance(pixel(last, event.point), event.point) <= 3) return;
    if (
      drawn(mode) === "polygon" &&
      placed.length >= 3 &&
      distance(pixel(placed[0], event.point), event.point) <= GRAB.handle
    ) {
      finish();
      return;
    }
    if (mode === "rectangle" && placed.length === 1) {
      if (place[0] === placed[0][0] || place[1] === placed[0][1]) return;
      return keep({
        kind: "rectangle",
        geometry: { type: "Polygon", coordinates: [rectangle(placed[0], place)] },
      });
    }
    if (mode === "circle" && placed.length === 1) {
      const km = Math.min(MAP_LIMITS.drawnRadiusKm, kmBetween(placed[0], place));
      if (!(km > 0)) return;
      return keep({
        kind: "circle",
        geometry: { type: "Point", coordinates: placed[0] },
        radiusKm: km,
      });
    }
    if (placed.length >= MAP_LIMITS.drawnVertices - 1) return;
    placed = [...placed, place];
    draw();
  };
  const doubleClick = (event: PointerEvent) => {
    event.preventDefault?.();
    finish();
  };
  const move = (event: PointerEvent) => {
    if (mode === "select") {
      const shape = selectedShape();
      if (!held || !shape) {
        map.getCanvas().style.cursor =
          handleAt(event.point) !== null
            ? "grab"
            : shapeAt(event.point)
              ? "pointer"
              : "";
        return;
      }
      const handles = handlesOf(shape);
      const to = placeOf(event, handles[held.at]);
      const moved = moveHandle(shape, held.at, to);
      if (shape.kind === "rectangle" && handles.length === 4)
        held = { at: RECTANGLE_MOVED_CORNER };
      host.onShapes(
        host.shapes().map((other) => (other.id === moved.id ? moved : other)),
      );
      return host.onDraft({ handles: handlesOf(moved) });
    }
    if (!placed.length) return;
    pointer = placeOf(event, placed[placed.length - 1]);
    draw();
  };
  const press = (event: PointerEvent) => {
    if (mode !== "select") return;
    const at = handleAt(event.point);
    if (at === null) return;
    event.preventDefault?.();
    held = { at };
    host.onHold?.(true);
    map.dragPan.disable();
    map.getCanvas().style.cursor = "grabbing";
  };
  const release = () => {
    if (!held) return;
    held = null;
    host.onHold?.(false);
    map.dragPan.enable();
    map.getCanvas().style.cursor = "";
  };
  const key = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest?.("input, textarea, select, [contenteditable=true]")) return;
    if (event.key === "Enter") {
      if (finish()) event.preventDefault();
    } else if (event.key === "Escape") {
      if (cancel()) event.preventDefault();
      else if (mode === "select" && selected) {
        selected = null;
        host.onSelect(null);
        draw();
        event.preventDefault();
      } else host.onLeave();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      if (placed.length) {
        undo();
        event.preventDefault();
      }
    } else if (event.key === "Delete" || event.key === "Backspace") {
      if (mode !== "select" || !selected) return;
      const gone = selected;
      selected = null;
      host.onShapes(host.shapes().filter((shape) => shape.id !== gone));
      host.onSelect(null);
      host.onDraft(null);
      event.preventDefault();
    }
  };

  const zoomed = map.doubleClickZoom.isEnabled();
  const turned = map.dragRotate.isEnabled();
  map.doubleClickZoom.disable();
  if (turned) {
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
  }
  const box = map.getContainer();
  let removed = false;
  const gone = () => {
    removed = true;
  };
  map.on("remove", gone);
  map.on("click", click as never);
  map.on("dblclick", doubleClick as never);
  map.on("mousemove", move as never);
  map.on("mousedown", press as never);
  map.on("mouseup", release);
  map.on("touchstart", press as never);
  map.on("touchmove", move as never);
  map.on("touchend", release);
  box.addEventListener("keydown", key);
  for (const name of RELEASES_OUTSIDE) window.addEventListener(name, release);

  return {
    setMode: (next) => {
      mode = next;
      measured = null;
      placed = [];
      pointer = null;
      if (held) host.onHold?.(false);
      held = null;
      if (next !== "select") {
        selected = null;
        host.onSelect(null);
      }
      map.getCanvas().style.cursor = next === "select" ? "" : "crosshair";
      draw();
    },
    select: (id) => {
      selected = id;
      draw();
    },
    finish,
    cancel,
    undo,
    refresh: draw,
    keepMeasure: () => {
      if (!measured) return false;
      const path = measured;
      const area = mode === "area";
      measured = null;
      keep(
        area
          ? {
              kind: "polygon",
              geometry: { type: "Polygon", coordinates: [[...path, path[0]]] },
            }
          : { kind: "line", geometry: { type: "LineString", coordinates: path } },
      );
      return true;
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      map.off("click", click as never);
      map.off("dblclick", doubleClick as never);
      map.off("mousemove", move as never);
      map.off("mousedown", press as never);
      map.off("mouseup", release);
      map.off("touchstart", press as never);
      map.off("touchmove", move as never);
      map.off("touchend", release);
      box.removeEventListener("keydown", key);
      for (const name of RELEASES_OUTSIDE) window.removeEventListener(name, release);
      map.off("remove", gone);
      host.onDraft(null);
      if (held) host.onHold?.(false);
      if (removed) return;
      try {
        if (held) map.dragPan.enable();
        if (zoomed) map.doubleClickZoom.enable();
        if (turned) {
          map.dragRotate.enable();
          map.touchZoomRotate.enableRotation();
        }
        map.getCanvas().style.cursor = "";
      } catch {}
    },
  };
}
