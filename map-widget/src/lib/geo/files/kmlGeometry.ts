import { GEO_FILE_LIMITS as LIMITS } from "./limits";
import type { GeoPosition } from "./types";
import { childOf, childrenOf, isoTime, numberOf, textOf, type XmlNode } from "./xml";

export interface Budget {
  left: number;
}

export function positions(text: string, budget: Budget): GeoPosition[] {
  const places: GeoPosition[] = [];
  const tuple = /\S+/g;
  for (let found = tuple.exec(text); found; found = tuple.exec(text)) {
    if (budget.left <= 0) break;
    budget.left--;
    const [lon, lat] = found[0].split(",", 3);
    places.push([numberOf(lon ?? ""), numberOf(lat ?? "")]);
  }
  return places;
}

export interface Parts {
  points: GeoPosition[];
  lines: GeoPosition[][];
  areas: GeoPosition[][][];
  first?: string;
  last?: string;
}

export function gather(
  node: XmlNode,
  parts: Parts,
  budget: Budget,
  depth: number,
): void {
  if (budget.left <= 0) return;
  switch (node.name) {
    case "Point": {
      const [place] = positions(textOf(childOf(node, "coordinates")), budget);
      if (place) parts.points.push(place);
      return;
    }
    case "LineString":
    case "LinearRing":
      parts.lines.push(positions(textOf(childOf(node, "coordinates")), budget));
      return;
    case "Polygon": {
      const rings: GeoPosition[][] = [];
      for (const name of ["outerBoundaryIs", "innerBoundaryIs"])
        for (const boundary of childrenOf(node, name))
          for (const ring of childrenOf(boundary, "LinearRing"))
            rings.push(positions(textOf(childOf(ring, "coordinates")), budget));
      if (rings.length > 0) parts.areas.push(rings);
      return;
    }
    case "Track": {
      const line: GeoPosition[] = [];
      for (const item of node.children) {
        if (item.name === "when") {
          const time = isoTime(textOf(item));
          if (time) {
            parts.first ??= time;
            parts.last = time;
          }
        } else if (item.name === "coord") {
          if (budget.left-- <= 0) break;
          const [lon, lat] = textOf(item).split(/\s+/, 3);
          line.push([numberOf(lon ?? ""), numberOf(lat ?? "")]);
        }
      }
      if (line.length === 1) parts.points.push(line[0]);
      else if (line.length > 1) parts.lines.push(line);
      return;
    }
    case "MultiGeometry":
    case "MultiTrack":
      if (depth >= LIMITS.geometryDepth) return;
      for (const item of node.children) gather(item, parts, budget, depth + 1);
      return;
    default:
  }
}

export const GEOMETRIES = new Set([
  "Point",
  "LineString",
  "LinearRing",
  "Polygon",
  "MultiGeometry",
  "Track",
  "MultiTrack",
]);

export function boxCorners(
  north: number,
  south: number,
  east: number,
  west: number,
  rotation: number,
): GeoPosition[] {
  const lon = (east + west) / 2;
  const lat = (north + south) / 2;
  const halfWidth = (east - west) / 2;
  const halfHeight = (north - south) / 2;
  const squeeze = Math.max(Math.cos((lat * Math.PI) / 180), 1e-6);
  const angle = (rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    [-1, 1],
    [1, 1],
    [1, -1],
    [-1, -1],
  ].map(([x, y]) => {
    const dx = x * halfWidth * squeeze;
    const dy = y * halfHeight;
    return [lon + (dx * cos - dy * sin) / squeeze, lat + dx * sin + dy * cos];
  });
}
