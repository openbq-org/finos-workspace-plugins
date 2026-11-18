import { displayNumber } from "~/lib/utils/displayNumber";
import { EARTH_KM, kmBetween, type Position } from "./geodesy";
import type { DrawnKind, DrawnShape } from "./mapShapes";

const RAD = Math.PI / 180;

export const segmentsKm = (path: readonly Position[]): number[] =>
  path.slice(1).map((place, at) => kmBetween(path[at], place));

export const pathKm = (path: readonly Position[]): number =>
  segmentsKm(path).reduce((sum, km) => sum + km, 0);

export const circleKm2 = (radiusKm: number): number =>
  2 * Math.PI * EARTH_KM * EARTH_KM * (1 - Math.cos(radiusKm / EARTH_KM));

export const circleRoundKm = (radiusKm: number): number =>
  2 * Math.PI * EARTH_KM * Math.sin(radiusKm / EARTH_KM);

export function ringKm2(ring: readonly Position[]): number {
  const corners: Position[] = [];
  const open =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : [...ring];
  if (open.length < 3) return 0;
  open.forEach((place, at) => {
    if (Math.abs(place[1]) < 90 - 1e-9) return corners.push(place);
    const before = open[(at + open.length - 1) % open.length];
    const after = open[(at + 1) % open.length];
    corners.push([before[0], place[1]], [after[0], place[1]]);
  });
  let excess = 0;
  let round = 0;
  for (let a = 0, b = corners.length - 1; a < corners.length; b = a++) {
    const [lon1, lat1] = corners[b];
    const [lon2, lat2] = corners[a];
    let turn = ((lon2 - lon1) * RAD) % (2 * Math.PI);
    if (turn > Math.PI) turn -= 2 * Math.PI;
    else if (turn < -Math.PI) turn += 2 * Math.PI;
    const t1 = Math.tan((lat1 * RAD) / 2);
    const t2 = Math.tan((lat2 * RAD) / 2);
    excess += 2 * Math.atan2(Math.tan(turn / 2) * (t1 + t2), 1 + t1 * t2);
    round += turn;
  }
  const steradians =
    Math.abs(round) > Math.PI
      ? Math.abs(2 * Math.PI - Math.abs(excess))
      : Math.abs(excess);
  return Math.min(steradians, 4 * Math.PI - steradians) * EARTH_KM * EARTH_KM;
}

export function ringRoundKm(ring: readonly Position[]): number {
  if (ring.length < 2) return 0;
  const [first, last] = [ring[0], ring[ring.length - 1]];
  const closed = first[0] === last[0] && first[1] === last[1];
  return pathKm(closed ? ring : [...ring, first]);
}

function boxOf(ring: readonly Position[]) {
  const closed =
    ring.length === 5 && ring[0][0] === ring[4][0] && ring[0][1] === ring[4][1];
  const corners = closed ? ring.slice(0, -1) : ring;
  if (corners.length !== 4) return null;
  const [a, b, c, d] = corners;
  const alongParallelFirst =
    a[1] === b[1] && b[0] === c[0] && c[1] === d[1] && d[0] === a[0];
  const alongMeridianFirst =
    a[0] === b[0] && b[1] === c[1] && c[0] === d[0] && d[1] === a[1];
  if (!(alongParallelFirst || alongMeridianFirst)) return null;
  return {
    turn: Math.min(Math.abs(c[0] - a[0]), 360) * RAD,
    south: Math.min(a[1], c[1]) * RAD,
    north: Math.max(a[1], c[1]) * RAD,
  };
}

function rectangleMeasure(ring: readonly Position[]): ShapeMeasure {
  const box = boxOf(ring);
  if (!box)
    return { kind: "rectangle", areaKm2: ringKm2(ring), roundKm: ringRoundKm(ring) };
  const { turn, south, north } = box;
  return {
    kind: "rectangle",
    areaKm2: EARTH_KM * EARTH_KM * turn * (Math.sin(north) - Math.sin(south)),
    roundKm:
      EARTH_KM * (2 * (north - south) + turn * (Math.cos(north) + Math.cos(south))),
  };
}

export interface ShapeMeasure {
  kind: DrawnKind;
  place?: Position;
  lengthKm?: number;
  segmentsKm?: number[];
  areaKm2?: number;
  roundKm?: number;
  radiusKm?: number;
}

export function measureOf(
  kind: DrawnKind,
  path: readonly Position[],
  radiusKm?: number,
): ShapeMeasure {
  if (kind === "point") return { kind, ...(path[0] ? { place: path[0] } : {}) };
  if (kind === "line")
    return { kind, lengthKm: pathKm(path), segmentsKm: segmentsKm(path) };
  if (kind === "circle") {
    const km = radiusKm ?? 0;
    return { kind, radiusKm: km, areaKm2: circleKm2(km), roundKm: circleRoundKm(km) };
  }
  if (kind === "rectangle") return rectangleMeasure(path);
  return { kind, areaKm2: ringKm2(path), roundKm: ringRoundKm(path) };
}

export const shapeMeasure = (shape: DrawnShape): ShapeMeasure =>
  shape.geometry.type === "Point"
    ? measureOf(shape.kind, [shape.geometry.coordinates], shape.radiusKm)
    : shape.geometry.type === "LineString"
      ? measureOf(shape.kind, shape.geometry.coordinates)
      : measureOf(shape.kind, shape.geometry.coordinates[0]);

export type MeasureSystem = "metric" | "imperial";

const KM_PER_MILE = 1.609344;
const FEET_PER_MILE = 5280;
const ACRES_PER_SQ_MILE = 640;
const SQ_FEET_PER_ACRE = 43_560;

function shown(value: number): string {
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return displayNumber(value, { kind: "quantity", decimalDigits: digits });
}

export function lengthText(km: number, system: MeasureSystem): string {
  if (!Number.isFinite(km)) return "";
  if (system === "metric") return km < 1 ? `${shown(km * 1000)} m` : `${shown(km)} km`;
  const miles = km / KM_PER_MILE;
  return miles < 0.1 ? `${shown(miles * FEET_PER_MILE)} ft` : `${shown(miles)} mi`;
}

export function areaText(km2: number, system: MeasureSystem): string {
  if (!Number.isFinite(km2)) return "";
  if (system === "metric") {
    if (km2 < 0.01) return `${shown(km2 * 1e6)} m²`;
    return km2 < 1 ? `${shown(km2 * 100)} ha` : `${shown(km2)} km²`;
  }
  const sqMiles = km2 / (KM_PER_MILE * KM_PER_MILE);
  const acres = sqMiles * ACRES_PER_SQ_MILE;
  if (acres < 0.1) return `${shown(acres * SQ_FEET_PER_ACRE)} sq ft`;
  return sqMiles < 1 ? `${shown(acres)} acres` : `${shown(sqMiles)} sq mi`;
}

export function placeText([lon, lat]: Position): string {
  const fold = ((((lon + 180) % 360) + 360) % 360) - 180;
  return `${displayNumber(lat, { kind: "coordinate" })}, ${displayNumber(fold, { kind: "coordinate" })}`;
}

export function measureText(measure: ShapeMeasure, system: MeasureSystem): string {
  if (measure.place) return placeText(measure.place);
  if (measure.kind === "line") return lengthText(measure.lengthKm ?? 0, system);
  const area = areaText(measure.areaKm2 ?? 0, system);
  return measure.kind === "circle"
    ? `${area}, radius ${lengthText(measure.radiusKm ?? 0, system)}`
    : `${area}, ${lengthText(measure.roundKm ?? 0, system)} round`;
}
