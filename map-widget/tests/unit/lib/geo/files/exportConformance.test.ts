import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { toGeoJson } from "~/lib/geo/files/export";
import { toKml, toKmz } from "~/lib/geo/files/exportKml";
import { isCalendarTime } from "~/lib/geo/files/time";
import type { GeoGeometry } from "~/lib/geo/files/types";
import { mapShapes } from "~/lib/geo/mapShapes";
import { mapSpec } from "~/lib/geo/mapSpec";

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const CLOCKWISE: GeoGeometry = {
  type: "MultiPolygon",
  coordinates: [
    [
      [
        [-124, 32],
        [-124, 42],
        [-114, 42],
        [-114, 32],
        [-124, 32],
      ],
    ],
    [
      [
        [-120, 33],
        [-120, 34],
        [-119, 34],
        [-120, 33],
      ],
    ],
  ],
};
const MAPS = {
  points: mapSpec({
    title: "Offices & <stores>",
    valueLabel: "Staff",
    points: [
      { lat: 41.8781, lon: -87.6298, label: "Chicago", value: 900, tag: "HQ" },
      { lat: 51.5072, lon: -0.1276, label: "London", value: 300, marker: "star" },
      { lat: -33.87, lon: 151.21, label: "Sydney", value: 120, color: "#ff8800" },
    ],
  }),
  timed: mapSpec({
    title: "Storm",
    points: [
      { lat: 23.2, lon: -86.5, label: "Start", time: "2026-09-09T05:00Z", value: 1 },
      { lat: 24.1, lon: -87.0, label: "Later", time: "2026-09-09T08:00:30Z", value: 2 },
      { lat: 25.0, lon: -87.4, label: "A day", time: "2026-09-10" },
      { lat: 26.0, lon: -87.9, label: "A month", time: "2026-10" },
      { lat: 27.0, lon: -88.2, label: "A year", time: "2027" },
      { lat: 28.0, lon: -88.5, label: "A quarter", time: "2027-Q1" },
    ],
  }),
  layers: mapSpec({
    title: "Corn",
    layers: [
      {
        kind: "polygons",
        name: "Fields",
        valueLabel: "Acres",
        shapes: [
          {
            type: "polygon",
            value: 40,
            height: 12,
            props: { zip: "02134", organic: true, share: 1e-9 },
            coordinates: [
              [
                [-93.7, 42.0],
                [-93.7, 42.1],
                [-93.6, 42.1],
                [-93.6, 42.0],
              ],
              [
                [-93.68, 42.02],
                [-93.68, 42.05],
                [-93.65, 42.05],
                [-93.65, 42.02],
              ],
            ],
          },
        ],
      },
      {
        kind: "lines",
        name: "Roads",
        shapes: [
          {
            type: "line",
            coordinates: [
              [-93.7, 42.0],
              [-93.6, 42.1],
            ],
          },
        ],
      },
      {
        kind: "flows",
        name: "Shipments",
        flows: [
          { from: [-93.6, 41.6], to: [-90.1, 29.9], value: 4, label: "IA to LA" },
        ],
      },
      {
        kind: "regions",
        name: "States",
        regions: { set: "us-states", items: [{ code: "CA", value: 5.5 }] },
      },
      {
        kind: "image",
        name: "Scan",
        image: {
          mime: "image/png",
          data: PNG,
          corners: [
            [-93.7, 42.1],
            [-93.6, 42.1],
            [-93.6, 42],
            [-93.7, 42],
          ],
        },
      },
    ],
  }),
};
const OPTIONS = { shapeOf: () => CLOCKWISE, nameOf: () => "California" };

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const isObject = (value: Json | undefined): value is { [key: string]: Json } =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const GEOMETRY_DEPTH: Record<string, number> = {
  Point: 0,
  MultiPoint: 1,
  LineString: 1,
  MultiLineString: 2,
  Polygon: 2,
  MultiPolygon: 3,
};

function geoJsonFaults(text: string): string[] {
  const faults: string[] = [];
  const doc = JSON.parse(text) as Json;
  if (!isObject(doc) || doc.type !== "FeatureCollection")
    return ["the text is no FeatureCollection"];
  if ("crs" in doc) faults.push("a crs member");
  if ("bbox" in doc) bbox(doc.bbox, "the collection");
  if (!Array.isArray(doc.features)) return [...faults, "features is no array"];

  function bbox(value: Json | undefined, where: string) {
    if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite))
      faults.push(`${where}: a bbox that is not four numbers`);
    else if ((value[1] as number) > (value[3] as number))
      faults.push(`${where}: a bbox whose south is north of its north`);
  }
  function position(value: Json, where: string): value is number[] {
    if (
      !Array.isArray(value) ||
      value.length < 2 ||
      value.length > 3 ||
      !value.every((part) => typeof part === "number" && Number.isFinite(part))
    ) {
      faults.push(`${where}: a position that is not two or three numbers`);
      return false;
    }
    const [lon, lat] = value as number[];
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90)
      faults.push(
        `${where}: the position ${lon}, ${lat} is not longitude then latitude in range`,
      );
    return true;
  }
  function ring(value: Json, where: string, hole: boolean) {
    if (!Array.isArray(value)) return faults.push(`${where}: a ring that is no array`);
    const positions = value.filter((item) => position(item, where)) as number[][];
    if (positions.length < 4)
      faults.push(`${where}: a ring of ${positions.length} positions`);
    const [first, last] = [positions[0], positions[positions.length - 1]];
    if (first && last && (first[0] !== last[0] || first[1] !== last[1]))
      faults.push(`${where}: a ring that does not end where it starts`);
    let twice = 0;
    for (let at = 0; at + 1 < positions.length; at++)
      twice +=
        positions[at][0] * positions[at + 1][1] -
        positions[at + 1][0] * positions[at][1];
    if (twice !== 0 && twice > 0 === hole)
      faults.push(
        `${where}: ${hole ? "a hole that runs counterclockwise" : "an outline that runs clockwise"}`,
      );
  }
  function coordinates(type: string, value: Json, where: string) {
    const polygon = (rings: Json) =>
      Array.isArray(rings) && rings.length > 0
        ? rings.forEach((item, at) => ring(item, where, at > 0))
        : faults.push(`${where}: a polygon without a ring`);
    if (type === "Point") position(value, where);
    else if (!Array.isArray(value))
      faults.push(`${where}: coordinates that are no array`);
    else if (type === "MultiPoint") value.forEach((item) => position(item, where));
    else if (type === "LineString") {
      if (value.length < 2)
        faults.push(`${where}: a line of ${value.length} positions`);
      value.forEach((item) => position(item, where));
    } else if (type === "MultiLineString")
      value.forEach((line) => coordinates("LineString", line, where));
    else if (type === "Polygon") polygon(value);
    else if (type === "MultiPolygon") value.forEach(polygon);
  }

  doc.features.forEach((feature, at) => {
    const where = `feature ${at}`;
    if (!isObject(feature) || feature.type !== "Feature")
      return faults.push(`${where}: no Feature`);
    if (!("geometry" in feature)) faults.push(`${where}: no geometry member`);
    if (
      !("properties" in feature) ||
      !(feature.properties === null || isObject(feature.properties))
    )
      faults.push(`${where}: properties that are no object and not null`);
    if ("crs" in feature) faults.push(`${where}: a crs member`);
    if ("bbox" in feature) bbox(feature.bbox, where);
    for (const member of ["coordinates", "geometries", "features"])
      if (member in feature)
        faults.push(`${where}: the member ${member} of another type`);
    const { geometry } = feature;
    if (geometry === null) return;
    if (
      !isObject(geometry) ||
      typeof geometry.type !== "string" ||
      !(geometry.type in GEOMETRY_DEPTH)
    )
      return faults.push(`${where}: a geometry of no type of the format`);
    if ("crs" in geometry) faults.push(`${where}: a crs member in its geometry`);
    coordinates(geometry.type, geometry.coordinates, `${where} (${geometry.type})`);
  });
  return faults;
}

const KML = "http://www.opengis.net/kml/2.2";
const GX = "http://www.google.com/kml/ext/2.2";
type Child = readonly [name: string, least: number, most: number];
const MANY = Number.POSITIVE_INFINITY;
const FEATURE: Child[] = [
  ["name", 0, 1],
  ["visibility", 0, 1],
  ["open", 0, 1],
  ["address", 0, 1],
  ["phoneNumber", 0, 1],
  ["Snippet", 0, 1],
  ["description", 0, 1],
  ["LookAt|Camera", 0, 1],
  ["TimeStamp|TimeSpan", 0, 1],
  ["styleUrl", 0, 1],
  ["Style|StyleMap", 0, MANY],
  ["Region", 0, 1],
  ["ExtendedData", 0, 1],
];
const GEOMETRY = "Point|LineString|LinearRing|Polygon|MultiGeometry";
const FEATURES =
  "Document|Folder|Placemark|GroundOverlay|NetworkLink|ScreenOverlay|PhotoOverlay";
const GEOMETRY_HEAD: Child[] = [
  ["extrude", 0, 1],
  ["tessellate", 0, 1],
  ["altitudeMode", 0, 1],
];
const SCHEMA: Record<string, Child[] | "text"> = {
  kml: [
    ["NetworkLinkControl", 0, 1],
    [FEATURES, 0, 1],
  ],
  Document: [...FEATURE, ["Schema", 0, MANY], [FEATURES, 0, MANY]],
  Folder: [...FEATURE, [FEATURES, 0, MANY]],
  Placemark: [...FEATURE, [GEOMETRY, 0, 1]],
  GroundOverlay: [
    ...FEATURE,
    ["color", 0, 1],
    ["drawOrder", 0, 1],
    ["Icon", 0, 1],
    ["altitude", 0, 1],
    ["altitudeMode", 0, 1],
    ["LatLonBox", 0, 1],
    ["gx:LatLonQuad", 0, 1],
  ],
  "gx:LatLonQuad": [["coordinates", 1, 1]],
  Icon: [["href", 0, 1]],
  Style: [
    ["IconStyle", 0, 1],
    ["LabelStyle", 0, 1],
    ["LineStyle", 0, 1],
    ["PolyStyle", 0, 1],
    ["BalloonStyle", 0, 1],
    ["ListStyle", 0, 1],
  ],
  IconStyle: [
    ["color", 0, 1],
    ["colorMode", 0, 1],
    ["scale", 0, 1],
    ["heading", 0, 1],
    ["Icon", 0, 1],
    ["hotSpot", 0, 1],
  ],
  LineStyle: [
    ["color", 0, 1],
    ["colorMode", 0, 1],
    ["width", 0, 1],
  ],
  PolyStyle: [
    ["color", 0, 1],
    ["colorMode", 0, 1],
    ["fill", 0, 1],
    ["outline", 0, 1],
  ],
  TimeStamp: [["when", 0, 1]],
  ExtendedData: [
    ["Data", 0, MANY],
    ["SchemaData", 0, MANY],
  ],
  Data: [
    ["displayName", 0, 1],
    ["value", 1, 1],
  ],
  SchemaData: [["SimpleData", 0, MANY]],
  SimpleData: "text",
  Schema: [["SimpleField", 0, MANY]],
  SimpleField: [["displayName", 0, 1]],
  Point: [
    ...GEOMETRY_HEAD.filter(([name]) => name !== "tessellate"),
    ["coordinates", 1, 1],
  ],
  LineString: [...GEOMETRY_HEAD, ["coordinates", 1, 1]],
  LinearRing: [...GEOMETRY_HEAD, ["coordinates", 1, 1]],
  Polygon: [...GEOMETRY_HEAD, ["outerBoundaryIs", 0, 1], ["innerBoundaryIs", 0, MANY]],
  outerBoundaryIs: [["LinearRing", 1, 1]],
  innerBoundaryIs: [["LinearRing", 1, 1]],
  MultiGeometry: [[GEOMETRY, 0, MANY]],
  name: "text",
  description: "text",
  styleUrl: "text",
  value: "text",
  href: "text",
  color: "text",
  width: "text",
  when: "text",
  coordinates: "text",
};
const TUPLE = /^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?(?:,-?\d+(?:\.\d+)?)?$/;
const DATE_TIME =
  /^\d{4}(?:-\d{2}(?:-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?)?)?$/;

function kmlFaults(text: string): string[] {
  const faults: string[] = [];
  if (!text.startsWith('<?xml version="1.0" encoding="UTF-8"?>'))
    faults.push("no XML declaration that names UTF-8");
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    faults.push("a DOCTYPE or an entity declaration");
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length)
    return ["the text is not well-formed XML"];
  const root = doc.documentElement;
  if (root.localName !== "kml" || root.namespaceURI !== KML)
    return ["the root is not kml in the namespace of KML 2.2"];
  const nameOf = (element: Element) =>
    element.namespaceURI === KML
      ? element.localName
      : element.namespaceURI === GX
        ? `gx:${element.localName}`
        : `{${element.namespaceURI}}${element.localName}`;
  const ids = new Set<string>();
  const styleUrls: string[] = [];
  let gx = 0;

  function check(element: Element, path: string) {
    const name = nameOf(element);
    const here = `${path}/${name}`;
    if (element.namespaceURI === GX) gx++;
    const allowed = SCHEMA[name];
    if (allowed === undefined)
      return faults.push(`${here}: an element the checker has no rule for`);
    const children = [...element.children];
    const words = [...element.childNodes]
      .filter((node) => node.nodeType === 3)
      .map((node) => node.textContent ?? "")
      .join("");
    if (allowed === "text") {
      if (children.length) faults.push(`${here}: an element inside a text`);
      const value = (element.textContent ?? "").trim();
      if (name === "coordinates") {
        const tuples = value.split(/\s+/).filter(Boolean);
        if (!tuples.length) faults.push(`${here}: no tuple`);
        for (const tuple of tuples) {
          if (!TUPLE.test(tuple)) faults.push(`${here}: the tuple "${tuple}"`);
          const [lon, lat] = tuple.split(",").map(Number);
          if (lon < -180 || lon > 180 || lat < -90 || lat > 90)
            faults.push(`${here}: ${tuple} is not longitude then latitude in range`);
        }
        const parent = element.parentElement ? nameOf(element.parentElement) : "";
        if (parent === "Point" && tuples.length !== 1)
          faults.push(`${here}: a point of ${tuples.length} tuples`);
        if (parent === "LineString" && tuples.length < 2)
          faults.push(`${here}: a line of ${tuples.length} tuples`);
        if (parent === "gx:LatLonQuad" && tuples.length !== 4)
          faults.push(`${here}: a quad of ${tuples.length} tuples`);
        if (parent === "LinearRing") {
          if (tuples.length < 4)
            faults.push(`${here}: a ring of ${tuples.length} tuples`);
          if (tuples[0] !== tuples[tuples.length - 1])
            faults.push(`${here}: a ring that does not end where it starts`);
          const boundary = element.parentElement?.parentElement;
          const outline = boundary ? nameOf(boundary) === "outerBoundaryIs" : false;
          const at = tuples.map((tuple) => tuple.split(",").map(Number));
          let twice = 0;
          for (let n = 0; n + 1 < at.length; n++)
            twice += at[n][0] * at[n + 1][1] - at[n + 1][0] * at[n][1];
          if (outline && twice < 0)
            faults.push(`${here}: an outer boundary that runs clockwise`);
        }
      }
      if (name === "color" && !/^[0-9a-f]{8}$/.test(value))
        faults.push(`${here}: the colour "${value}"`);
      if (name === "when" && !(DATE_TIME.test(value) && isCalendarTime(value)))
        faults.push(`${here}: the time "${value}"`);
      if (name === "width" && !Number.isFinite(Number(value)))
        faults.push(`${here}: the width "${value}"`);
      if (name === "styleUrl") styleUrls.push(value);
      return;
    }
    if (words.trim() !== "") faults.push(`${here}: text between its elements`);
    if (name === "Style") {
      const id = element.getAttribute("id");
      if (!id || !/^[A-Za-z_][\w.-]*$/.test(id)) faults.push(`${here}: the id "${id}"`);
      else if (ids.has(id)) faults.push(`${here}: the id "${id}" twice`);
      else ids.add(id);
    }
    if (name === "Data" && !element.getAttribute("name"))
      faults.push(`${here}: a Data without a name`);
    let rule = 0;
    const counts = allowed.map(() => 0);
    for (const child of children) {
      const childName = nameOf(child);
      let found = -1;
      for (let at = rule; at < allowed.length; at++)
        if (allowed[at][0].split("|").includes(childName)) {
          found = at;
          break;
        }
      if (found < 0) {
        const known = allowed.some(([names]) => names.split("|").includes(childName));
        faults.push(
          `${here}: ${childName} ${known ? "is out of the order of the schema" : "is no child of it"}`,
        );
      } else {
        rule = found;
        counts[found]++;
      }
      check(child, here);
    }
    allowed.forEach(([names, least, most], at) => {
      if (counts[at] < least) faults.push(`${here}: no ${names}`);
      if (counts[at] > most) faults.push(`${here}: ${counts[at]} of ${names}`);
    });
  }
  check(root, "");
  for (const url of styleUrls)
    if (!url.startsWith("#") || !ids.has(url.slice(1)))
      faults.push(`a styleUrl "${url}" that names no style of the document`);
  const declared = root.getAttribute("xmlns:gx") !== null;
  if (declared !== gx > 0)
    faults.push(
      declared
        ? "the gx namespace declared and not used"
        : "a gx element without its namespace",
    );
  return faults;
}

function zipEntries(bytes: Uint8Array): { local: string[]; central: string[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (from: number, length: number) =>
    new TextDecoder().decode(bytes.subarray(from, from + length));
  const local: string[] = [];
  let at = 0;
  while (at + 30 <= bytes.length && view.getUint32(at, true) === 0x04034b50) {
    const packed = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const extraLength = view.getUint16(at + 28, true);
    local.push(text(at + 30, nameLength));
    at += 30 + nameLength + extraLength + packed;
  }
  const central: string[] = [];
  while (at + 46 <= bytes.length && view.getUint32(at, true) === 0x02014b50) {
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    central.push(text(at + 46, nameLength));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return { local, central };
}

const DRAWN = [
  {
    id: "zone",
    kind: "polygon",
    name: "Delivery <zone> & more",
    note: "Mondays ]]> only",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [0, 2],
          [2, 2],
          [2, 0],
          [0, 0],
        ],
      ],
    },
  },
  {
    id: "reach",
    kind: "circle",
    geometry: { type: "Point", coordinates: [179.5, -17] },
    radiusKm: 300,
  },
  {
    id: "depot",
    kind: "point",
    name: "Depot",
    geometry: { type: "Point", coordinates: [2.35, 48.85] },
  },
  {
    id: "route",
    kind: "line",
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 0],
        [1, 1],
        [2, 0],
      ],
    },
  },
];
const WITH_SHAPES = { ...OPTIONS, shapes: mapShapes(DRAWN) };

describe("a file with the shapes a reader drew", () => {
  it.each(Object.entries(MAPS))(
    "of the map %s holds to RFC 7946 and to the schema of KML 2.2",
    (_name, spec) => {
      expect(geoJsonFaults(toGeoJson(spec, WITH_SHAPES))).toEqual([]);
      expect(kmlFaults(toKml(spec, WITH_SHAPES))).toEqual([]);
    },
  );
});

describe("an exported GeoJSON file", () => {
  it.each(Object.entries(MAPS))("of the map %s holds to RFC 7946", (_name, spec) => {
    expect(geoJsonFaults(toGeoJson(spec, OPTIONS))).toEqual([]);
  });

  it("writes an area by the right-hand rule, whichever way the map and the boundary files run", () => {
    const { features } = JSON.parse(toGeoJson(MAPS.layers, OPTIONS));
    const [field] = features.filter(
      (feature: any) => feature.properties.layer === "Fields",
    );
    expect(field.geometry.coordinates).toEqual([
      [
        [-93.7, 42.0],
        [-93.6, 42.0],
        [-93.6, 42.1],
        [-93.7, 42.1],
        [-93.7, 42.0],
      ],
      [
        [-93.68, 42.02],
        [-93.68, 42.05],
        [-93.65, 42.05],
        [-93.65, 42.02],
        [-93.68, 42.02],
      ],
    ]);
    const [state] = features.filter(
      (feature: any) => feature.properties.layer === "States",
    );
    expect(state.geometry.type).toBe("MultiPolygon");
    expect(state.geometry.coordinates[0][0][1]).toEqual([-114, 32]);
  });

  it("is refused by the checker for each rule it holds", () => {
    const broken = (change: (doc: any) => void) => {
      const doc = JSON.parse(toGeoJson(MAPS.layers, OPTIONS));
      change(doc);
      return geoJsonFaults(JSON.stringify(doc));
    };
    const field = (doc: any) =>
      doc.features.find((f: any) => f.properties.layer === "Fields");
    expect(broken((doc) => (doc.crs = { type: "name" }))).toEqual(["a crs member"]);
    expect(broken((doc) => (doc.bbox = [0, 0, 1]))).toEqual([
      "the collection: a bbox that is not four numbers",
    ]);
    expect(broken((doc) => field(doc).geometry.coordinates[0].pop())[0]).toMatch(
      /a ring that does not end where it starts/,
    );
    expect(broken((doc) => field(doc).geometry.coordinates[0].reverse())[0]).toMatch(
      /an outline that runs clockwise/,
    );
    expect(broken((doc) => field(doc).geometry.coordinates[1].reverse())[0]).toMatch(
      /a hole that runs counterclockwise/,
    );
    expect(
      broken((doc) => (doc.features[0].geometry.coordinates[0][0] = [42, -93.7]))[0],
    ).toMatch(/is not longitude then latitude in range/);
    expect(broken((doc) => delete doc.features[0].properties)[0]).toMatch(
      /properties that are no object/,
    );
  });
});

describe("an exported KML file", () => {
  it.each(Object.entries(MAPS))(
    "of the map %s holds to the schema of KML 2.2",
    (_name, spec) => {
      expect(kmlFaults(toKml(spec, OPTIONS))).toEqual([]);
    },
  );

  it("writes the time of a placemark before its style, and a time with its seconds", () => {
    const kml = toKml(MAPS.timed);
    expect(kml).toMatch(
      /<\/description><TimeStamp><when>2026-09-09T05:00:00Z<\/when><\/TimeStamp>(<styleUrl>|<ExtendedData>)/,
    );
    expect(kml).toContain("<when>2026-09-09T08:00:30Z</when>");
    expect(kml).toContain("<when>2026-10</when>");
    expect(kml).not.toContain("<when>2027-Q1</when>");
    expect(kml).toContain('<Data name="time"><value>2027-Q1</value></Data>');
  });

  it("declares the gx namespace only in a file that uses it", () => {
    expect(toKml(MAPS.layers, OPTIONS)).not.toContain("xmlns:gx");
    const inside = new TextDecoder().decode(toKmzDocument(toKmz(MAPS.layers, OPTIONS)));
    expect(inside).toContain('xmlns:gx="http://www.google.com/kml/ext/2.2"');
    expect(inside).toContain("<gx:LatLonQuad>");
    expect(kmlFaults(inside)).toEqual([]);
  });

  it("is refused by the checker for each rule it holds", () => {
    const kml = toKml(MAPS.timed);
    const broken = (from: string | RegExp, to: string) =>
      kmlFaults(kml.replace(from, to));
    expect(
      broken(/(<TimeStamp>.*?<\/TimeStamp>)(<styleUrl>.*?<\/styleUrl>)/, "$2$1")[0],
    ).toMatch(/TimeStamp is out of the order of the schema/);
    expect(
      broken("<when>2026-09-09T05:00:00Z</when>", "<when>2026-09-09T05:00Z</when>")[0],
    ).toMatch(/the time "2026-09-09T05:00Z"/);
    expect(
      broken(
        /<coordinates>-86.5,23.2<\/coordinates>/,
        "<coordinates>-86.5, 23.2</coordinates>",
      )[0],
    ).toMatch(/the tuple/);
    expect(
      broken(
        /<coordinates>-86.5,23.2<\/coordinates>/,
        "<coordinates>23.2,-186.5</coordinates>",
      )[0],
    ).toMatch(/not longitude then latitude in range/);
    expect(broken("<Document>", "<Document><Banner/>")[0]).toMatch(
      /Banner is no child of it|no rule for/,
    );
    expect(
      broken(
        'xmlns="http://www.opengis.net/kml/2.2"',
        'xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"',
      ),
    ).toEqual(["the gx namespace declared and not used"]);
    const ring = toKml(MAPS.layers, OPTIONS).replace(
      /(<outerBoundaryIs><LinearRing><coordinates>)(\S+) /,
      "$1",
    );
    expect(kmlFaults(ring).join(" ")).toMatch(
      /a ring that does not end where it starts/,
    );
  });
});

function toKmzDocument(archive: Uint8Array): Uint8Array {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const packed = view.getUint32(18, true);
  const start = 30 + view.getUint16(26, true) + view.getUint16(28, true);
  return new Uint8Array(inflateRawSync(archive.subarray(start, start + packed)));
}

describe("an exported KMZ file", () => {
  it.each(Object.entries(MAPS))(
    "of the map %s is a zip whose first entry is doc.kml at its root",
    (_name, spec) => {
      const archive = toKmz(spec, OPTIONS);
      expect([...archive.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
      const { local, central } = zipEntries(archive);
      expect(local[0]).toBe("doc.kml");
      expect(central).toEqual(local);
      for (const name of local.slice(1))
        expect(name).toMatch(/^files\/overlay-\d+\.(png|jpg|webp)$/);
      expect(kmlFaults(new TextDecoder().decode(toKmzDocument(archive)))).toEqual([]);
    },
  );

  it("names in its document the images it holds, and no other", () => {
    const archive = toKmz(MAPS.layers, OPTIONS);
    const { local } = zipEntries(archive);
    const hrefs = [
      ...new TextDecoder()
        .decode(toKmzDocument(archive))
        .matchAll(/<href>([^<]+)<\/href>/g),
    ].map((match) => match[1]);
    expect(hrefs).toEqual(local.slice(1));
    expect(hrefs).toEqual(["files/overlay-1.png"]);
  });
});
