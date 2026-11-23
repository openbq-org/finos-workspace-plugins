import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, "../tests/fixtures/geo/files", name));

export const PWNED = "window.__pwned=1";

const row = (label, extra = {}) => ({ label, lat: 40.7128, lon: -74.006, value: 1, ...extra });

const MARKUP = [
  `<img src=x onerror="${PWNED}">`,
  `<script>${PWNED}</script>`,
  `"><svg onload=${PWNED}>`,
  `javascript:${PWNED}`,
  `{{constructor.constructor("${PWNED}")()}}`,
  `<iframe srcdoc="<script>parent.${PWNED}</script>"></iframe>`,
  `<a href="javascript:${PWNED}">x</a>`,
  `</title><style>*{display:none}</style>`,
];

export const CASES = [
  {
    name: "markup in labels, tags, categories and columns is text",
    body: MARKUP.map((text, index) => row(text, { lat: 30 + index, lon: -100 + index, tag: text, category: text, note: text })),
    drawn: true,
    table: MARKUP,
  },
  {
    name: "keys that name the prototype pollute nothing",
    body: [
      JSON.parse(`{"__proto__": {"polluted": "yes"}, "constructor": {"prototype": {"polluted": "yes"}}, "label": "proto", "lat": 40, "lon": -74, "value": 1}`),
      row("plain"),
    ],
    drawn: true,
    pollutes: true,
  },
  {
    name: "coordinates that are not numbers are left out",
    body: [
      row("ok-1"),
      row("bad-text", { lat: "abc" }),
      row("bad-null", { lat: null }),
      row("bad-infinity", { lon: "Infinity" }),
      row("bad-array", { lat: [1, 2] }),
      row("bad-object", { lon: {} }),
      row("ok-2", { lat: " 40.7 ", lon: "-74.0" }),
    ],
    drawn: true,
    only: /^ok-/,
  },
  { name: "a latitude over 90 refuses the map and names the point", body: [row("fine"), row("high", { lat: 91 })], refused: /point 2 has lat 91/ },
  { name: "a longitude over 180 refuses the map and names the point", body: [row("fine"), row("far", { lon: 181 })], refused: /point 2 has lat 40\.7128 and lon 181/ },
  { name: "a coordinate of 1e308 refuses the map", body: [row("huge", { lat: 1e308 })], refused: /point 1 has lat/ },
  { name: "20,001 places are over the limit", body: [...Array(20001)].map((_, index) => ({ label: `p${index}`, lat: 40, lon: -74, value: index })), refused: /20,000/ },
  {
    name: "a map of more than 2 MB is over the limit",
    body: [...Array(12000)].map((_, index) => ({ label: `${"L".repeat(120)}${index}`.slice(-120), tag: "t".repeat(40), lat: 30 + (index % 100) / 10, lon: -100 + Math.floor(index / 100) / 10, value: index })),
    refused: /2 MB/,
  },
  { name: "a label of a hundred thousand characters is cut", body: [row("y".repeat(100000))], drawn: true, longest: 120 },
  { name: "an empty answer says nobody matches", body: [], status: /No locations match/ },
  { name: "an object that is no map says so", body: {}, refused: /no map to draw/ },
  { name: "null says so", body: null, refused: /no map to draw|not a map/i },
  { name: "text says so", body: "a string", refused: /no map to draw|not a map/i },
  { name: "a number says so", body: 42, refused: /no map to draw|not a map/i },
  { name: "rows without a place say so", body: [{ a: 1 }, { b: 2 }], refused: /./ },
  { name: "a GeoJSON geometry nested sixty deep is refused or drawn, and the frame lives", body: nested(60), settles: true },
  { name: "a KML with an entity bomb is refused", body: { kml: fixture("hostile-doctype.kml").toString("utf8") }, refused: /./ },
  { name: "a KML nested too deep is refused", body: { kml: fixture("hostile-deep.kml").toString("utf8") }, settles: true },
  { name: "a KMZ that expands without end is refused", body: { kmz: fixture("hostile-bomb.kmz").toString("base64") }, refused: /./ },
  { name: "a zip inside a zip is refused", body: { shapefile: fixture("hostile-nested.zip").toString("base64") }, refused: /./ },
  { name: "a shapefile that is cut short is refused", body: { shapefile: fixture("hostile-truncated-shp.zip").toString("base64") }, refused: /./ },
  { name: "a shapefile whose table lies about its size is refused", body: { shapefile: fixture("hostile-lying-dbf.zip").toString("base64") }, refused: /./ },
  { name: "markup in a KML description stays text", body: { kml: fixture("raw-markup.kml").toString("utf8") }, drawn: true },
];

function nested(depth) {
  let geometry = { type: "Point", coordinates: [-74, 40.7] };
  for (let level = 0; level < depth; level++) geometry = { type: "GeometryCollection", geometries: [geometry] };
  return { type: "FeatureCollection", features: [{ type: "Feature", properties: { name: "deep" }, geometry }] };
}
