import { Collector } from "./collect";
import type { GeoFileResult } from "./types";
import {
  childOf,
  childrenOf,
  isoTime,
  numberOf,
  plainText,
  remoteReferences,
  textOf,
  type XmlNode,
} from "./xml";

const placeOf = (node: XmlNode): [number, number] => [
  numberOf((node.attributes.lon ?? "").trim()),
  numberOf((node.attributes.lat ?? "").trim()),
];

function common(node: XmlNode): [string, unknown][] {
  const entries: [string, unknown][] = [];
  for (const key of ["type", "cmt", "sym"]) {
    const value = textOf(childOf(node, key));
    if (value) entries.push([key, value]);
  }
  return entries;
}

function summary(points: XmlNode[]): [string, unknown][] {
  let first: string | undefined;
  let last: string | undefined;
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const time = isoTime(textOf(childOf(point, "time")));
    if (time) {
      first ??= time;
      last = time;
    }
    const height = numberOf(textOf(childOf(point, "ele")));
    if (Number.isFinite(height)) {
      if (height < low) low = height;
      if (height > high) high = height;
    }
  }
  const entries: [string, unknown][] = [];
  if (first) entries.push(["time", first === last ? first : `${first}/${last}`]);
  if (low <= high) entries.push(["ele_min", low], ["ele_max", high]);
  return entries;
}

export function readGpx(root: XmlNode): GeoFileResult {
  const collector = new Collector();
  collector.count("remote", remoteReferences(root));
  const groups = new Map<string, number | undefined>();
  const groupOf = (name: string) => {
    if (!groups.has(name)) groups.set(name, collector.group(name));
    return groups.get(name);
  };
  const described = (node: XmlNode) => {
    const text = plainText(textOf(childOf(node, "desc")));
    return text || undefined;
  };
  for (const node of root.children) {
    if (collector.full) {
      collector.count("featuresCut");
      break;
    }
    if (node.name === "wpt") {
      const properties = common(node);
      const height = numberOf(textOf(childOf(node, "ele")));
      if (Number.isFinite(height)) properties.push(["ele", height]);
      const time = isoTime(textOf(childOf(node, "time")));
      if (time) properties.push(["time", time]);
      collector.add({
        geometry: { type: "Point", coordinates: placeOf(node) },
        properties,
        name: textOf(childOf(node, "name")),
        description: described(node),
        group: groupOf("Waypoints"),
      });
    } else if (node.name === "rte") {
      const points = childrenOf(node, "rtept");
      const kept = points.slice(0, collector.room + 1);
      collector.add({
        geometry: { type: "LineString", coordinates: kept.map(placeOf) },
        properties: [...common(node), ...summary(kept)],
        name: textOf(childOf(node, "name")),
        description: described(node),
        group: groupOf("Routes"),
      });
    } else if (node.name === "trk") {
      const lines: [number, number][][] = [];
      const all: XmlNode[] = [];
      let left = collector.room + 1;
      for (const segment of childrenOf(node, "trkseg")) {
        const points = childrenOf(segment, "trkpt").slice(0, Math.max(left, 0));
        left -= points.length;
        for (const point of points) all.push(point);
        if (points.length > 0) lines.push(points.map(placeOf));
      }
      collector.add({
        geometry: { type: "MultiLineString", coordinates: lines },
        properties: [...common(node), ...summary(all)],
        name: textOf(childOf(node, "name")),
        description: described(node),
        group: groupOf("Tracks"),
      });
    }
  }
  return collector.finish("gpx");
}
