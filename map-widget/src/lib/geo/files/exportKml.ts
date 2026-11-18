import { strToU8, zipSync } from "fflate";
import { bytesOf } from "../base64";
import type { MapSpec } from "../mapSpecTypes";
import { describedBy, MAP_MEMBER } from "./convention";
import {
  about,
  type ExportFeature,
  type ExportModel,
  type MapExportOptions,
  modelOf,
  propertiesOf,
} from "./exportModel";
import { isCalendarTime } from "./time";
import type { GeoGeometry, GeoPosition } from "./types";
import { untyped } from "./xml";

const NOT_XML = new RegExp(
  [
    "[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\ufffe\\uffff]",
    "[\\ud800-\\udbff](?![\\udc00-\\udfff])",
    "(?<![\\ud800-\\udbff])[\\udc00-\\udfff]",
  ].join("|"),
  "g",
);
const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

export const escaped = (text: string): string =>
  text.replace(NOT_XML, "").replace(/[&<>"']/g, (character) => ENTITIES[character]);

interface Xml {
  xml: string;
}
type Child = Xml | string | number | undefined | false;

function element(
  name: string,
  attributes: Record<string, string>,
  ...children: Child[]
): Xml {
  const given = Object.entries(attributes)
    .map(([key, value]) => ` ${key}="${escaped(value)}"`)
    .join("");
  const inside = children
    .map((child) =>
      child === undefined || child === false
        ? ""
        : typeof child === "object"
          ? child.xml
          : escaped(String(child)),
    )
    .join("");
  return {
    xml: inside ? `<${name}${given}>${inside}</${name}>` : `<${name}${given}/>`,
  };
}
const markup = (...parts: Child[]): Xml => ({
  xml: parts.map((part) => (typeof part === "object" ? part.xml : "")).join(""),
});

function degrees(value: number): string {
  const written = value.toFixed(7).replace(/\.?0+$/, "");
  return written === "-0" ? "0" : written;
}
const coordinates = (positions: readonly GeoPosition[]) =>
  positions.map(([lon, lat]) => `${degrees(lon)},${degrees(lat)}`).join(" ");

function geometryXml(geometry: GeoGeometry): Xml {
  const ring = (positions: GeoPosition[], name: string) =>
    element(
      name,
      {},
      element("LinearRing", {}, element("coordinates", {}, coordinates(positions))),
    );
  const polygon = (rings: GeoPosition[][]) =>
    element(
      "Polygon",
      {},
      ring(rings[0] ?? [], "outerBoundaryIs"),
      ...rings.slice(1).map((hole) => ring(hole, "innerBoundaryIs")),
    );
  const line = (positions: GeoPosition[]) =>
    element("LineString", {}, element("coordinates", {}, coordinates(positions)));
  const point = (position: GeoPosition) =>
    element("Point", {}, element("coordinates", {}, coordinates([position])));
  switch (geometry.type) {
    case "Point":
      return point(geometry.coordinates);
    case "LineString":
      return line(geometry.coordinates);
    case "Polygon":
      return polygon(geometry.coordinates);
    case "MultiPoint":
      return element("MultiGeometry", {}, ...geometry.coordinates.map(point));
    case "MultiLineString":
      return element("MultiGeometry", {}, ...geometry.coordinates.map(line));
    case "MultiPolygon":
      return element("MultiGeometry", {}, ...geometry.coordinates.map(polygon));
  }
}

const RAMP = ["#c6dbef", "#9ecae1", "#6baed6", "#3182bd", "#08519c"] as const;
export const STYLE_LIMIT = 32;

function kmlColor(color: string, alpha: string): string {
  const hex =
    color.length === 4
      ? [...color.slice(1)].map((digit) => digit + digit).join("")
      : color.slice(1);
  return `${alpha}${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}`.toLowerCase();
}

const WHEN_FORM =
  /^\d{4}(?:-\d{2}(?:-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?)?)?)?$/;
const WHEN = {
  test: (time: string) => WHEN_FORM.test(time) && isCalendarTime(time),
};

const whenOf = (time: string): string =>
  time.replace(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?!:)/, "$1:00");

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const shownAsText = (text: string): string =>
  text.replace(/[&<>]/g, (character) => ENTITIES[character]);

const TYPED = { text: "string", flag: "bool", number: "double" } as const;
type Typed = keyof typeof TYPED;
const typeOf = (value: string | number | boolean): Typed | null =>
  typeof value === "boolean"
    ? "flag"
    : typeof value === "string"
      ? untyped(value) === value
        ? null
        : "text"
      : untyped(String(value)) === value
        ? null
        : "number";

function kmlDocument(spec: MapSpec, options: MapExportOptions, withImages: boolean) {
  const model = modelOf(spec, options, withImages ? "kmz" : "kml");
  const styles = new Map<string, string>();
  const styleOf = (color: string): string | undefined => {
    const known = styles.get(color);
    if (known) return known;
    if (styles.size >= STYLE_LIMIT) return undefined;
    const id = `s${styles.size}`;
    styles.set(color, id);
    return id;
  };
  const colourOf = ({ mark, layer }: ExportFeature): string | undefined => {
    if (mark.color && HEX.test(mark.color)) return mark.color.toLowerCase();
    const range = model.layers[layer].range;
    if (mark.value === undefined || !range) return undefined;
    const [least, most] = range;
    const share = most > least ? (mark.value - least) / (most - least) : 1;
    return RAMP[Math.min(RAMP.length - 1, Math.floor(share * RAMP.length))];
  };
  const schemas: Record<Typed, Set<string>> = {
    text: new Set(),
    flag: new Set(),
    number: new Set(),
  };
  const placemark = (feature: ExportFeature): Xml => {
    const properties = propertiesOf(feature, model);
    const colour = colourOf(feature);
    const style = colour === undefined ? undefined : styleOf(colour);
    const { time, label } = feature.mark;
    const when = time !== undefined && WHEN.test(time) ? whenOf(time) : undefined;
    const held = Object.entries(properties).flatMap(
      ([key, value]): [string, string | number | boolean][] =>
        key === "name" ||
        key === "layer" ||
        value === null ||
        (key === "time" && when !== undefined)
          ? []
          : [[key, value]],
    );
    const plain = held.filter(([, value]) => typeOf(value) === null);
    const typed = (Object.keys(TYPED) as Typed[]).map(
      (type) => [type, held.filter(([, value]) => typeOf(value) === type)] as const,
    );
    for (const [type, values] of typed)
      for (const [key] of values) schemas[type].add(key);
    const data = [...plain, ...typed.flatMap(([, values]) => values)].map(
      ([key, value]): [string, string] => [key, String(value)],
    );
    return element(
      "Placemark",
      {},
      label !== undefined && element("name", {}, label),
      element(
        "description",
        {},
        shownAsText(describedBy(model.layers[feature.layer].name, data, when)),
      ),
      when !== undefined && element("TimeStamp", {}, element("when", {}, when)),
      style !== undefined && element("styleUrl", {}, `#${style}`),
      held.length > 0 &&
        element(
          "ExtendedData",
          {},
          ...plain.map(([key, value]) =>
            element("Data", { name: key }, element("value", {}, String(value))),
          ),
          ...typed.map(
            ([type, values]) =>
              values.length > 0 &&
              element(
                "SchemaData",
                { schemaUrl: `#${type}` },
                ...values.map(([key, value]) =>
                  element("SimpleData", { name: key }, String(value)),
                ),
              ),
          ),
        ),
      geometryXml(feature.geometry),
    );
  };
  const files: Record<string, Uint8Array> = {};
  const overlay = (
    image: ExportModel["images"][number],
    at: number,
  ): Xml | undefined => {
    const bytes = bytesOf(image.data);
    if (!bytes) return undefined;
    const path = `files/overlay-${at + 1}.${image.mime === "image/jpeg" ? "jpg" : image.mime === "image/webp" ? "webp" : "png"}`;
    files[path] = bytes;
    const [topLeft, topRight, bottomRight, bottomLeft] = image.corners;
    return element(
      "GroundOverlay",
      {},
      element("name", {}, image.name),
      element("Icon", {}, element("href", {}, path)),
      element(
        "gx:LatLonQuad",
        {},
        element(
          "coordinates",
          {},
          coordinates([bottomLeft, bottomRight, topRight, topLeft]),
        ),
      ),
    );
  };
  const folders = model.layers.map((layer, at) =>
    element(
      "Folder",
      {},
      element("name", {}, layer.name),
      ...model.features.filter((feature) => feature.layer === at).map(placemark),
      ...(withImages
        ? model.images.flatMap((image, index) =>
            image.layer === at ? [overlay(image, index)] : [],
          )
        : []),
    ),
  );
  const root = element(
    "kml",
    {
      xmlns: "http://www.opengis.net/kml/2.2",
      ...(Object.keys(files).length
        ? { "xmlns:gx": "http://www.google.com/kml/ext/2.2" }
        : {}),
    },
    element(
      "Document",
      {},
      element("name", {}, model.title),
      about(model) !== "" && element("description", {}, shownAsText(about(model))),
      ...[...styles].map(([color, id]) =>
        element(
          "Style",
          { id },
          element("IconStyle", {}, element("color", {}, kmlColor(color, "ff"))),
          element(
            "LineStyle",
            {},
            element("color", {}, kmlColor(color, "ff")),
            element("width", {}, 2),
          ),
          element("PolyStyle", {}, element("color", {}, kmlColor(color, "99"))),
        ),
      ),
      element(
        "ExtendedData",
        {},
        element(
          "Data",
          { name: MAP_MEMBER },
          element("value", {}, JSON.stringify(model.member)),
        ),
      ),
      ...(Object.keys(TYPED) as Typed[]).map(
        (type) =>
          schemas[type].size > 0 &&
          element(
            "Schema",
            { name: type, id: type },
            ...[...schemas[type]].map((name) =>
              element("SimpleField", { type: TYPED[type], name }),
            ),
          ),
      ),
      markup(...folders),
    ),
  );
  return { text: `<?xml version="1.0" encoding="UTF-8"?>\n${root.xml}\n`, files };
}

export const toKml = (spec: MapSpec, options: MapExportOptions = {}): string =>
  kmlDocument(spec, options, false).text;

export function toKmz(spec: MapSpec, options: MapExportOptions = {}): Uint8Array {
  const { text, files } = kmlDocument(spec, options, true);
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {
    "doc.kml": [new Uint8Array(strToU8(text)), { level: 6 }],
  };
  for (const [path, bytes] of Object.entries(files))
    entries[path] = [bytes, { level: 0 }];
  return zipSync(entries);
}
