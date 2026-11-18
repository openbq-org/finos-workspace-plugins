import { MAP_LIMITS } from "~/lib/codemode/limits";
import { circleRing, insideCircle, insideRing, type Position } from "./geodesy";
import { MAP_ID } from "./mapLayers";
import { isPlain, text } from "./mapValues";

export const DRAWN_KINDS = ["point", "line", "polygon", "rectangle", "circle"] as const;
export type DrawnKind = (typeof DRAWN_KINDS)[number];

export const DRAWN_COLORS = 6;

export type DrawnGeometry =
  | { type: "Point"; coordinates: Position }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "Polygon"; coordinates: [Position[]] };

export interface DrawnShape {
  id: string;
  kind: DrawnKind;
  geometry: DrawnGeometry;
  radiusKm?: number;
  name?: string;
  color?: number;
  note?: string;
}

const round = (value: number) => Math.round(value * 1e6) / 1e6;

function position(raw: unknown): Position | undefined {
  if (!Array.isArray(raw) || raw.length < 2) return undefined;
  const [lon, lat] = raw as unknown[];
  if (typeof lon !== "number" || typeof lat !== "number") return undefined;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return undefined;
  if (lon < -540 || lon > 540 || lat < -90 || lat > 90) return undefined;
  return [round(lon), round(lat)];
}

function path(raw: unknown, least: number): Position[] | undefined {
  if (!Array.isArray(raw) || raw.length < least) return undefined;
  if (raw.length > MAP_LIMITS.drawnVertices) return undefined;
  const places: Position[] = [];
  for (const item of raw) {
    const place = position(item);
    if (!place) return undefined;
    places.push(place);
  }
  const turns = Math.round(places[0][0] / 360);
  if (turns === 0) return places;
  const moved = places.map(([lon, lat]): Position => [round(lon - 360 * turns), lat]);
  return moved.every(([lon]) => lon >= -540 && lon <= 540) ? moved : undefined;
}

const closed = (ring: Position[]): Position[] => {
  const [first, last] = [ring[0], ring[ring.length - 1]];
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
};

function geometryOf(kind: DrawnKind, raw: unknown): DrawnGeometry | undefined {
  if (!isPlain(raw)) return undefined;
  if (kind === "point" || kind === "circle") {
    if (raw.type !== "Point") return undefined;
    const place = path([raw.coordinates], 1)?.[0];
    return place && { type: "Point", coordinates: place };
  }
  if (kind === "line") {
    if (raw.type !== "LineString") return undefined;
    const places = path(raw.coordinates, 2);
    return places && { type: "LineString", coordinates: places };
  }
  if (raw.type !== "Polygon" || !Array.isArray(raw.coordinates)) return undefined;
  if (raw.coordinates.length !== 1) return undefined;
  const ring = path(raw.coordinates[0], 3);
  if (!ring) return undefined;
  const whole = closed(ring);
  if (whole.length < 4 || whole.length > MAP_LIMITS.drawnVertices) return undefined;
  if (kind === "rectangle" && whole.length !== 5) return undefined;
  return { type: "Polygon", coordinates: [whole] };
}

function shapeOf(raw: unknown): DrawnShape | undefined {
  if (!isPlain(raw)) return undefined;
  const own = (key: string) => (Object.hasOwn(raw, key) ? raw[key] : undefined);
  const id = own("id");
  if (typeof id !== "string" || !MAP_ID.test(id)) return undefined;
  const kind = own("kind");
  if (typeof kind !== "string" || !DRAWN_KINDS.includes(kind as DrawnKind))
    return undefined;
  const geometry = geometryOf(kind as DrawnKind, own("geometry"));
  if (!geometry) return undefined;
  const radius = own("radiusKm");
  if (
    kind === "circle" &&
    !(
      typeof radius === "number" &&
      Number.isFinite(radius) &&
      radius > 0 &&
      radius <= MAP_LIMITS.drawnRadiusKm
    )
  )
    return undefined;
  const name = text(own("name"), MAP_LIMITS.drawnNameChars);
  const note = text(own("note"), MAP_LIMITS.drawnNoteChars);
  const color = own("color");
  return {
    id,
    kind: kind as DrawnKind,
    geometry,
    ...(kind === "circle"
      ? { radiusKm: Math.round((radius as number) * 1e4) / 1e4 }
      : {}),
    ...(name === undefined ? {} : { name }),
    ...(typeof color === "number" &&
    Number.isInteger(color) &&
    color > 0 &&
    color < DRAWN_COLORS
      ? { color }
      : {}),
    ...(note === undefined ? {} : { note }),
  };
}

export function mapShapes(raw: unknown): DrawnShape[] {
  if (!Array.isArray(raw)) return [];
  const kept: DrawnShape[] = [];
  const ids = new Set<string>();
  for (const item of raw.slice(0, 4 * MAP_LIMITS.drawnShapes)) {
    if (kept.length >= MAP_LIMITS.drawnShapes) break;
    let shape: DrawnShape | undefined;
    try {
      shape = shapeOf(item);
    } catch {}
    if (!shape || ids.has(shape.id)) continue;
    ids.add(shape.id);
    kept.push(shape);
  }
  return kept;
}

const KIND_WORDS: Record<DrawnKind, string> = {
  point: "Point",
  line: "Line",
  polygon: "Area",
  rectangle: "Rectangle",
  circle: "Circle",
};

export const kindWord = (kind: DrawnKind): string => KIND_WORDS[kind];

export function shapeName(shape: DrawnShape, shapes: readonly DrawnShape[]): string {
  if (shape.name) return shape.name;
  let nth = 0;
  for (const other of shapes) {
    if (other.kind === shape.kind && !other.name) nth++;
    if (other.id === shape.id) break;
  }
  return `${KIND_WORDS[shape.kind]} ${Math.max(1, nth)}`;
}

export function newShapeId(shapes: readonly DrawnShape[]): string {
  const taken = new Set(shapes.map((shape) => shape.id));
  for (let at = shapes.length + 1; ; at++)
    if (!taken.has(`shape-${at}`)) return `shape-${at}`;
}

export function shapeRing(shape: DrawnShape): Position[] | null {
  if (shape.geometry.type === "Polygon") return shape.geometry.coordinates[0];
  if (shape.kind === "circle" && shape.geometry.type === "Point")
    return circleRing(shape.geometry.coordinates, shape.radiusKm ?? 0);
  return null;
}

export const enclosing = (shape: DrawnShape): boolean =>
  shape.kind === "polygon" || shape.kind === "rectangle" || shape.kind === "circle";

export function shapeHolds(shape: DrawnShape, place: Position): boolean {
  if (shape.kind === "circle" && shape.geometry.type === "Point")
    return insideCircle(place, shape.geometry.coordinates, shape.radiusKm ?? 0);
  if (shape.geometry.type === "Polygon")
    return insideRing(place, shape.geometry.coordinates[0]);
  return false;
}

export function shapePath(shape: DrawnShape): Position[] {
  if (shape.kind === "circle") return shapeRing(shape) ?? [];
  if (shape.geometry.type === "Point") return [shape.geometry.coordinates];
  if (shape.geometry.type === "LineString") return shape.geometry.coordinates;
  return shape.geometry.coordinates[0];
}

export function shapeFeature(shape: DrawnShape, shapes: readonly DrawnShape[]) {
  const properties = {
    id: shape.id,
    name: shapeName(shape, shapes),
    kind: shape.kind,
    ...(shape.note ? { note: shape.note } : {}),
  };
  if (shape.kind === "circle" && shape.geometry.type === "Point") {
    const [lon, lat] = shape.geometry.coordinates;
    return {
      type: "Feature" as const,
      properties: { ...properties, radius_km: shape.radiusKm ?? 0 },
      geometry: {
        type: "Polygon" as const,
        coordinates: [circleRing([lon, lat], shape.radiusKm ?? 0)],
        center: { lat, lon },
        km: shape.radiusKm ?? 0,
      },
    };
  }
  return { type: "Feature" as const, properties, geometry: shape.geometry };
}

export function shapeFacts(shapes: readonly DrawnShape[]): string | null {
  if (!shapes.length) return null;
  const named = shapes
    .slice(0, MAP_LIMITS.summaryLabels)
    .map((shape) => `${JSON.stringify(shapeName(shape, shapes))} ${shape.kind}`);
  const more = shapes.length - named.length;
  const said = `${shapes.length} drawn ${shapes.length === 1 ? "shape" : "shapes"}: ${named.join(", ")}${more > 0 ? `, and ${more} more` : ""}`;
  return text(said, MAP_LIMITS.mapNoteChars) ?? null;
}
