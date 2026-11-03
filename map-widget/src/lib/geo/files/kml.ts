import { Collector } from "./collect";
import { isAddress } from "./collectChecks";
import { describedBy, MAP_MEMBER, memberOf } from "./convention";
import { imageHeader } from "./images";
import {
  type Budget,
  boxCorners,
  GEOMETRIES,
  gather,
  type Parts,
  positions,
} from "./kmlGeometry";
import { type KmlStyle, styleFor, styleFrom } from "./kmlStyle";
import { GEO_FILE_LIMITS as LIMITS } from "./limits";
import type { GeoFileResult, GeoGeometry, GeoPosition } from "./types";
import {
  childOf,
  childrenOf,
  isoTime,
  isRemote,
  numberOf,
  plainText,
  remoteReferences,
  textOf,
  untyped,
  type XmlNode,
} from "./xml";
import { safePath } from "./zip";

export type KmlImages = (path: string) => Uint8Array | "missing" | "too-large";

type FieldType = "number" | "boolean" | "text";

const FIELD_TYPES: Record<string, FieldType> = {
  int: "number",
  uint: "number",
  short: "number",
  ushort: "number",
  float: "number",
  double: "number",
  bool: "boolean",
  string: "text",
};

const CONTAINERS = new Set(["kml", "Document", "Folder"]);

const inRange = ([lon, lat]: GeoPosition) =>
  lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90;

export function readKml(
  root: XmlNode,
  kind: "kml" | "kmz",
  images: KmlImages | null,
): GeoFileResult {
  const collector = new Collector();
  collector.count("remote", remoteReferences(root));

  const styleNodes = new Map<string, XmlNode>();
  const styleMaps = new Map<string, XmlNode>();
  const schemas = new Map<string, Map<string, FieldType>>();
  const collect = (node: XmlNode) => {
    for (const item of node.children) {
      const id = item.attributes.id;
      if (item.name === "Style" && id) styleNodes.set(id, item);
      else if (item.name === "StyleMap" && id) styleMaps.set(id, item);
      else if (item.name === "Schema") {
        const fields = new Map<string, FieldType>();
        for (const field of childrenOf(item, "SimpleField")) {
          const name = field.attributes.name;
          const type = field.attributes.type ?? "";
          if (name)
            fields.set(
              name,
              Object.hasOwn(FIELD_TYPES, type) ? FIELD_TYPES[type] : "text",
            );
        }
        for (const key of [id, item.attributes.name]) if (key) schemas.set(key, fields);
      } else if (CONTAINERS.has(item.name)) collect(item);
    }
  };
  collect({ name: "#document", attributes: {}, children: [root], text: "" });

  const styles = new Map<string, KmlStyle>();
  const sharedStyle = (url: string): KmlStyle => {
    if (!url.startsWith("#")) return {};
    const id = url.slice(1);
    const known = styles.get(id);
    if (known) return known;
    let style: KmlStyle = {};
    const map = styleMaps.get(id);
    if (map) {
      const pairs = childrenOf(map, "Pair");
      const normal =
        pairs.find((pair) => textOf(childOf(pair, "key")) === "normal") ??
        pairs.find((pair) => textOf(childOf(pair, "key")) !== "highlight");
      const inner = textOf(childOf(normal, "styleUrl"));
      style = inner.startsWith("#")
        ? styleFrom(styleNodes.get(inner.slice(1)))
        : styleFrom(childOf(normal, "Style"));
    } else style = styleFrom(styleNodes.get(id));
    styles.set(id, style);
    return style;
  };

  const placemark = (node: XmlNode, group: number | undefined, folder?: string) => {
    const budget: Budget = { left: collector.room + 1 };
    const parts: Parts = { points: [], lines: [], areas: [] };
    for (const item of node.children)
      if (GEOMETRIES.has(item.name)) gather(item, parts, budget, 0);
    if (budget.left <= 0) return collector.count("verticesCut");
    if (parts.points.length + parts.lines.length + parts.areas.length === 0) return;

    const properties: [string, unknown][] = [];
    const written: [string, string][] = [];
    for (const data of childOf(node, "ExtendedData")?.children ?? []) {
      if (data.name === "Data") {
        const value = textOf(childOf(data, "value"));
        if (data.attributes.name && value) {
          properties.push([data.attributes.name, untyped(value)]);
          written.push([data.attributes.name, value]);
        }
      } else if (data.name === "SchemaData") {
        const url = data.attributes.schemaUrl ?? "";
        const fields = url.startsWith("#") ? schemas.get(url.slice(1)) : undefined;
        for (const entry of childrenOf(data, "SimpleData")) {
          const name = entry.attributes.name;
          if (!name) continue;
          const value = textOf(entry);
          if (value) written.push([name, value]);
          const type = fields?.get(name);
          if (type === "number") {
            const number = numberOf(value);
            properties.push([name, Number.isFinite(number) ? number : null]);
          } else if (type === "boolean")
            properties.push([name, value === "1" || value.toLowerCase() === "true"]);
          else if (value) properties.push([name, type ? value : untyped(value)]);
        }
      }
    }
    const when = textOf(childOf(childOf(node, "TimeStamp"), "when"));
    const stamp = isoTime(when);
    const span = childOf(node, "TimeSpan");
    const begin = isoTime(textOf(childOf(span, "begin"))) ?? parts.first;
    const end = isoTime(textOf(childOf(span, "end"))) ?? parts.last;
    const time =
      stamp ?? (begin || end ? `${begin ?? ".."}/${end ?? ".."}` : undefined);
    if (time) properties.push(["time", time]);

    const shared = sharedStyle(textOf(childOf(node, "styleUrl")));
    const own = styleFrom(childOf(node, "Style"));
    const style: KmlStyle = { ...shared };
    for (const key of Object.keys(own) as (keyof KmlStyle)[])
      if (own[key] !== undefined) (style[key] as unknown) = own[key];

    const name = textOf(childOf(node, "name"));
    const said = plainText(textOf(childOf(node, "description")));
    const repeated = said
      ? describedBy(folder, written, when || undefined)
          .replace(/\s+/g, " ")
          .trim()
      : "";
    const whole = written.every(([key, value]) => !isAddress(key) && !isAddress(value));
    const description = said && !(whole && said === repeated) ? said : undefined;
    const geometries: GeoGeometry[] = [];
    if (parts.points.length === 1)
      geometries.push({ type: "Point", coordinates: parts.points[0] });
    else if (parts.points.length > 1)
      geometries.push({ type: "MultiPoint", coordinates: parts.points });
    if (parts.lines.length > 0)
      geometries.push({ type: "MultiLineString", coordinates: parts.lines });
    if (parts.areas.length > 0)
      geometries.push({ type: "MultiPolygon", coordinates: parts.areas });
    for (const geometry of geometries)
      collector.add({
        geometry,
        properties,
        name,
        description,
        group,
        style: styleFor(style, geometry.type),
      });
  };

  let overlayBytes = 0;
  const overlay = (node: XmlNode, group: number | undefined) => {
    const href = textOf(childOf(childOf(node, "Icon"), "href"));
    if (!href || isRemote(href)) return;
    if (collector.overlays.length >= LIMITS.overlays)
      return collector.count("overlaysCut");
    if (!images) return collector.count("overlaysNotInArchive");

    let corners: GeoPosition[];
    const quad = childOf(node, "LatLonQuad");
    if (quad) {
      const [lowerLeft, lowerRight, upperRight, upperLeft] = positions(
        textOf(childOf(quad, "coordinates")),
        { left: 4 },
      );
      corners = [upperLeft, upperRight, lowerRight, lowerLeft];
    } else {
      const box = childOf(node, "LatLonBox");
      const side = (name: string) => numberOf(textOf(childOf(box, name)));
      const rotation = textOf(childOf(box, "rotation"));
      corners = boxCorners(
        side("north"),
        side("south"),
        side("east"),
        side("west"),
        rotation ? numberOf(rotation) : 0,
      );
      if (!(side("north") > side("south") && side("east") > side("west"))) corners = [];
    }
    if (corners.length !== 4 || !corners.every((corner) => corner && inRange(corner)))
      return collector.note(
        "An image overlay was left out: its box is not four positions on the map.",
      );

    let path = safePath(href);
    let found = path ? images(path) : "missing";
    if (found === "missing" && href.includes("%"))
      try {
        path = safePath(decodeURIComponent(href));
        if (path) found = images(path);
      } catch {}
    if (found === "missing") return collector.count("overlaysMissing");
    if (found === "too-large") return collector.count("overlaysTooLarge");
    const header = imageHeader(found);
    if (!header) return collector.count("overlaysUnreadable");
    if (
      found.length > LIMITS.overlayBytes ||
      overlayBytes + found.length > LIMITS.overlayTotalBytes ||
      header.width > LIMITS.overlaySide ||
      header.height > LIMITS.overlaySide ||
      header.width * header.height > LIMITS.overlayPixels
    )
      return collector.count("overlaysTooLarge");
    overlayBytes += found.length;
    const [topLeft, topRight, bottomRight, bottomLeft] = corners;
    collector.overlays.push({
      name:
        collector.label(textOf(childOf(node, "name")), LIMITS.nameChars) ?? "Overlay",
      corners: [topLeft, topRight, bottomRight, bottomLeft],
      image: { bytes: found, ...header },
      ...(group === undefined ? {} : { group }),
    });
    collector.extend(corners);
  };

  const walk = (node: XmlNode, group: number | undefined, folder?: string) => {
    for (const item of node.children) {
      if (item.name === "Document" || item.name === "Folder") {
        const name = textOf(childOf(item, "name"));
        walk(item, collector.group(name, group) ?? group, name);
      } else if (item.name === "Placemark") {
        if (collector.full) {
          collector.count("featuresCut");
          return;
        }
        placemark(item, group, folder);
      } else if (item.name === "GroundOverlay") overlay(item, group);
      else if (
        item.name === "NetworkLink" ||
        item.name === "ScreenOverlay" ||
        item.name === "PhotoOverlay" ||
        item.name === "Tour" ||
        item.name === "Model"
      )
        collector.count("unsupported");
    }
  };
  walk(
    root.name === "kml"
      ? root
      : { name: "#document", attributes: {}, children: [root], text: "" },
    undefined,
  );
  const document =
    root.name === "Document" ? root : (childOf(root, "Document") ?? undefined);
  const title = collector.label(textOf(childOf(document, "name")), LIMITS.nameChars);
  const member = childrenOf(childOf(document, "ExtendedData"), "Data").find(
    (data) => data.attributes.name === MAP_MEMBER,
  );
  const map = member ? memberOf(textOf(childOf(member, "value"))) : undefined;
  return {
    ...collector.finish(kind),
    ...(title === undefined ? {} : { title }),
    ...(map === undefined ? {} : { map }),
  };
}
