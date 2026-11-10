import { ByteReader } from "./bytes";
import type { Collector } from "./collect";
import { GEO_FILE_LIMITS as LIMITS } from "./limits";
import type { GeoGeometry, GeoPosition } from "./types";

export type Transform = (x: number, y: number) => GeoPosition;

export const same: Transform = (x, y) => [x, y];

export class LayerLeftOut extends Error {}

export interface Shape {
  row: number;
  geometry: GeoGeometry;
}

function area2(ring: GeoPosition[]): number {
  let sum = 0;
  for (let at = 0, last = ring.length - 1; at < ring.length; last = at++)
    sum += ring[last][0] * ring[at][1] - ring[at][0] * ring[last][1];
  return sum;
}

function inside(point: GeoPosition, ring: GeoPosition[]): boolean {
  const [x, y] = point;
  let odd = false;
  for (let at = 0, last = ring.length - 1; at < ring.length; last = at++) {
    const [ax, ay] = ring[at];
    const [bx, by] = ring[last];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) odd = !odd;
  }
  return odd;
}

interface Outline {
  ring: GeoPosition[];
  size: number;
  box: [number, number, number, number];
  holes: GeoPosition[][];
}

const boxOf = (ring: GeoPosition[]): [number, number, number, number] => {
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  for (const [x, y] of ring) {
    if (x < west) west = x;
    if (x > east) east = x;
    if (y < south) south = y;
    if (y > north) north = y;
  }
  return [west, south, east, north];
};

export function polygonsOf(rings: GeoPosition[][]): GeoPosition[][][] {
  const outlines: Outline[] = [];
  const holes: GeoPosition[][] = [];
  for (const ring of rings) {
    const size = area2(ring);
    if (size <= 0)
      outlines.push({
        ring: [...ring].reverse(),
        size: -size,
        box: boxOf(ring),
        holes: [],
      });
    else holes.push(ring);
  }
  for (const hole of holes) {
    let home: Outline | undefined;
    for (const probe of [hole[0], hole[hole.length >> 1]]) {
      for (const outline of outlines) {
        const [west, south, east, north] = outline.box;
        if (probe[0] < west || probe[0] > east || probe[1] < south || probe[1] > north)
          continue;
        if ((!home || outline.size < home.size) && inside(probe, outline.ring))
          home = outline;
      }
      if (home) break;
    }
    if (home) home.holes.push([...hole].reverse());
    else outlines.push({ ring: hole, size: area2(hole), box: boxOf(hole), holes: [] });
  }
  return outlines.map((outline) => [outline.ring, ...outline.holes]);
}

const POINT_KINDS = new Set([1, 11, 21]);
const LINE_KINDS = new Set([3, 13, 23]);
const AREA_KINDS = new Set([5, 15, 25]);
const MULTIPOINT_KINDS = new Set([8, 18, 28]);

export function readShp(
  bytes: Uint8Array,
  what: string,
  transform: Transform,
  collector: Collector,
  strictRange: boolean,
): Shape[] {
  const reader = new ByteReader(bytes, what);
  reader.need(0, 100);
  if (reader.i32(0, false) !== 9994)
    reader.fail("it does not start as a .shp file does");
  const declared = reader.i32(24, false) * 2;
  if (declared < 100) reader.fail("its header gives a length under its own size");
  reader.need(0, declared);
  const shapes: Shape[] = [];
  let room = collector.room;
  const most = LIMITS.features - collector.features.length;
  const place = (at: number): GeoPosition => {
    const position = transform(reader.f64Checked(at), reader.f64Checked(at + 8));
    if (
      strictRange &&
      !(
        position[0] >= -180 &&
        position[0] <= 180 &&
        position[1] >= -90 &&
        position[1] <= 90
      )
    )
      throw new LayerLeftOut();
    return position;
  };
  let row = 0;
  for (let at = 100; at + 8 <= declared; row++) {
    const length = reader.u32(at + 4, false) * 2;
    const start = at + 8;
    at = start + length;
    if (at > declared) reader.fail("a record runs past the end of the file");
    if (length < 4) continue;
    const kind = reader.i32(start);
    if (kind === 0) continue;
    if (shapes.length >= most) {
      collector.count("featuresCut");
      break;
    }
    if (POINT_KINDS.has(kind)) {
      if (length < 20) reader.fail("a point is shorter than a point");
      if (room < 1) {
        collector.count("verticesCut");
        continue;
      }
      room -= 1;
      shapes.push({ row, geometry: { type: "Point", coordinates: place(start + 4) } });
      continue;
    }
    if (MULTIPOINT_KINDS.has(kind)) {
      if (length < 40) reader.fail("a record is shorter than its header");
      const points = reader.i32(start + 36);
      if (points < 0 || 40 + points * 16 > length)
        reader.fail("a record declares more points than it has bytes for");
      if (points > room) {
        collector.count("verticesCut");
        continue;
      }
      room -= points;
      const coordinates: GeoPosition[] = [];
      for (let index = 0; index < points; index++)
        coordinates.push(place(start + 40 + index * 16));
      shapes.push({ row, geometry: { type: "MultiPoint", coordinates } });
      continue;
    }
    if (LINE_KINDS.has(kind) || AREA_KINDS.has(kind)) {
      if (length < 44) reader.fail("a record is shorter than its header");
      const parts = reader.i32(start + 36);
      const points = reader.i32(start + 40);
      if (parts < 0 || points < 0 || 44 + parts * 4 + points * 16 > length)
        reader.fail("a record declares more parts or points than it has bytes for");
      if (parts > LIMITS.parts) {
        collector.count("partsCut");
        continue;
      }
      if (points > room) {
        collector.count("verticesCut");
        continue;
      }
      room -= points;
      const first = start + 44 + parts * 4;
      const lines: GeoPosition[][] = [];
      let from = parts > 0 ? reader.i32Checked(start + 44) : 0;
      if (from < 0) reader.fail("a part starts before the first point");
      for (let part = 0; part < parts; part++) {
        const to =
          part + 1 < parts ? reader.i32Checked(start + 44 + (part + 1) * 4) : points;
        if (to < from || to > points)
          reader.fail("the parts of a record are out of order");
        const line: GeoPosition[] = [];
        for (let index = from; index < to; index++)
          line.push(place(first + index * 16));
        lines.push(line);
        from = to;
      }
      shapes.push({
        row,
        geometry: LINE_KINDS.has(kind)
          ? { type: "MultiLineString", coordinates: lines }
          : {
              type: "MultiPolygon",
              coordinates: polygonsOf(lines.filter((ring) => ring.length >= 3)),
            },
      });
      continue;
    }
    if (kind === 31) throw new LayerLeftOut("multipatch");
    reader.fail(`a record is of a kind (${kind}) that no shapefile has`);
  }
  return shapes;
}
