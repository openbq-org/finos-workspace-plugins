
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { inPolygon, polygonsOf, ringPoints } from "./geometry.mjs";

const SOURCES = {
  cities15000: {
    url: "https://download.geonames.org/export/dump/cities15000.zip",
    sha256: "9339ac426943c265eb7fdfd5350ae351a5584b4d4271ed58f071ddc432982aeb",
    fetched: "2026-10-10",
    edition: "GeoNames cities15000, as of 2026-10-10",
    file: "cities15000.txt",
  },
  ne_10m_populated_places_simple: {
    url: "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_populated_places_simple.zip",
    sha256: "2963ee08f7743f13f37d5243acd77a2f7a510e26a36c7e04b920f1b381f2b251",
    fetched: "2026-10-10",
    edition: "Natural Earth 5.1.1, populated places (simple), 1:10m",
    file: "ne_10m_populated_places_simple.dbf",
  },
};

const MIN_POPULATION = 25_000;
const CAPITALS = new Set(["PPLC", "PPLA"]);
const SAME_PLACE_KM = 25;
const MAX_NAMES = 3;
const OTHER_NAMES_FROM = 150_000;
const WRITTEN_NAME = /^\p{Lu}[\p{Script=Latin}\p{M}\s'’.-]+$/u;
const NEAR_REGION_DEGREES = 0.3;

const FORMER_NAMES = [
  ["IN", "Kolkata", "Calcutta"],
  ["IN", "Mumbai", "Bombay"],
  ["IN", "Chennai", "Madras"],
  ["IN", "Gurugram", "Gurgaon"],
  ["VN", "Ho Chi Minh City", "Saigon"],
  ["CN", "Beijing", "Peking"],
  ["CN", "Guangzhou", "Canton"],
  ["MM", "Yangon", "Rangoon"],
];

const here = dirname(fileURLToPath(import.meta.url));
const argument = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? resolve(process.argv[at + 1]) : fallback;
};
const downloads = argument("downloads");
if (!downloads) {
  console.error("usage: prepare-cities.mjs --downloads <dir> [--out <dir>]");
  process.exit(2);
}
const out = argument("out", join(here, "../../vendor/geo/places"));
const work = mkdtempSync(join(tmpdir(), "prepare-cities-"));

function dataFile(name) {
  const path = join(downloads, name, `${name}.zip`);
  const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (digest !== SOURCES[name].sha256)
    throw new Error(`${name}.zip has the SHA-256 ${digest}, not the recorded one.`);
  const folder = join(work, name);
  mkdirSync(folder, { recursive: true });
  execFileSync("unzip", ["-o", "-q", path, SOURCES[name].file, "-d", folder]);
  return readFileSync(join(folder, SOURCES[name].file));
}

const LETTERS = { ß: "ss", æ: "ae", œ: "oe", ø: "o", đ: "d", ð: "d", ł: "l", ı: "i", þ: "th", ə: "a" };
const key = (text) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[ßæœøđðłıþə]/g, (letter) => LETTERS[letter])
    .replace(/[^\p{L}\p{N}]+/gu, "");

function dbfRows(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const rowLength = view.getUint16(10, true);
  const fields = [];
  for (let at = 32; bytes[at] !== 0x0d; at += 32) {
    const name = bytes.subarray(at, at + 11);
    fields.push({ name: new TextDecoder().decode(name.subarray(0, name.indexOf(0))), length: bytes[at + 16] });
  }
  const text = new TextDecoder("utf-8");
  const rows = [];
  for (let row = 0; row < count; row++) {
    let at = headerLength + row * rowLength + 1;
    const values = {};
    for (const { name, length } of fields) {
      values[name] = text.decode(bytes.subarray(at, at + length)).trim();
      at += length;
    }
    rows.push(values);
  }
  return rows;
}

const kmBetween = (a, b) => {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(h));
};

const cities = new TextDecoder("utf-8")
  .decode(dataFile("cities15000"))
  .split("\n")
  .filter(Boolean)
  .map((line) => line.split("\t"))
  .map((f) => ({
    name: f[1],
    ascii: f[2],
    written: f[3].split(",").filter(Boolean),
    alternates: new Map(f[3].split(",").filter(Boolean).map((name) => [key(name), name])),
    lat: Number(f[4]),
    lon: Number(f[5]),
    code: f[7],
    country: f[8],
    admin1: f[10],
    population: Number(f[14]),
    names: [],
  }))
  .filter((city) => city.country && (city.population >= MIN_POPULATION || CAPITALS.has(city.code)));

const byCountry = new Map();
for (const city of cities) byCountry.set(city.country, [...(byCountry.get(city.country) ?? []), city]);

let named = 0;
for (const place of dbfRows(dataFile("ne_10m_populated_places_simple"))) {
  const at = { lat: Number(place.latitude), lon: Number(place.longitude) };
  const near = (byCountry.get(place.iso_a2) ?? [])
    .filter((city) => kmBetween(city, at) <= SAME_PLACE_KM)
    .sort((a, b) => b.population - a.population)[0];
  if (!near) continue;
  for (const name of [place.name, place.nameascii, ...place.namealt.split("|"), place.meganame]) {
    const candidate = name.trim();
    const candidateKey = key(candidate);
    if (!candidateKey || candidateKey === key(near.name)) continue;
    if (!near.alternates.has(candidateKey)) continue;
    if (near.names.some((other) => key(other) === candidateKey) || near.names.length >= MAX_NAMES) continue;
    near.names.push(candidate);
    named++;
  }
}

for (const [country, name, ...former] of FORMER_NAMES) {
  const city = (byCountry.get(country) ?? []).find((candidate) => candidate.name === name);
  if (!city) throw new Error(`FORMER_NAMES names ${name} (${country}), which is not among the cities.`);
  for (const candidate of former) {
    if (!city.alternates.has(key(candidate)))
      throw new Error(`GeoNames does not list "${candidate}" as a name of ${name} (${country}).`);
    if (city.names.some((other) => key(other) === key(candidate))) continue;
    city.names.push(candidate);
    named++;
  }
}

const regionsFolder = join(here, "../../vendor/geo/regions");
const levels = new Map(
  JSON.parse(readFileSync(join(regionsFolder, "admin1.index.json"), "utf8")).regions.map((row) => [row[0], row[10]]),
);
const regionsOf = new Map();
for (const file of readdirSync(regionsFolder).filter((name) => /^admin1-.+\.json$/.test(name)).sort()) {
  const topology = JSON.parse(readFileSync(join(regionsFolder, file), "utf8"));
  for (const geometry of [...topology.objects.regions.geometries, ...(topology.objects.groups?.geometries ?? [])]) {
    const polygons = polygonsOf(geometry).map((rings) => rings.map((ring) => ringPoints(topology, ring)));
    let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const rings of polygons)
      for (const [x, y] of rings[0]) {
        west = Math.min(west, x);
        south = Math.min(south, y);
        east = Math.max(east, x);
        north = Math.max(north, y);
      }
    const country = geometry.id.slice(0, 2);
    const region = { id: geometry.id, level: levels.get(geometry.id) ?? 1, polygons, box: [west, south, east, north] };
    regionsOf.set(country, [...(regionsOf.get(country) ?? []), region]);
  }
}

function regionsAt(country, lon, lat) {
  const found = new Map();
  const near = new Map();
  for (const region of regionsOf.get(country) ?? []) {
    const [west, south, east, north] = region.box;
    const by = NEAR_REGION_DEGREES;
    if (lon < west - by || lon > east + by || lat < south - by || lat > north + by) continue;
    if (region.polygons.some((rings) => inPolygon([lon, lat], rings))) {
      if (!found.has(region.level)) found.set(region.level, region.id);
      continue;
    }
    let least = Infinity;
    for (const rings of region.polygons)
      for (const [x, y] of rings[0]) least = Math.min(least, Math.hypot(x - lon, y - lat));
    const before = near.get(region.level);
    if (least <= by && (!before || least < before.least)) near.set(region.level, { id: region.id, least });
  }
  return [2, 1].flatMap((level) => found.get(level) ?? near.get(level)?.id ?? []).map((id) => id.slice(3));
}

let placed = 0;
for (const city of cities) {
  city.regions = city.country === "US" ? city.admin1 : regionsAt(city.country, city.lon, city.lat).join("/");
  if (city.regions) placed++;
}

let others = 0;
for (const city of cities) {
  city.others = [];
  if (city.population < OTHER_NAMES_FROM) continue;
  const taken = new Set([key(city.name), key(city.ascii), ...city.names.map(key)]);
  for (const name of city.written) {
    const nameKey = key(name);
    if (taken.has(nameKey) || nameKey.length < 4 || !WRITTEN_NAME.test(name)) continue;
    taken.add(nameKey);
    city.others.push(name);
    others++;
  }
}

const countries = {};
const otherNames = {};
for (const country of [...byCountry.keys()].sort()) {
  const sorted = byCountry
    .get(country)
    .sort((a, b) => b.population - a.population || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || a.lat - b.lat);
  countries[country] = sorted.map((city) => [
    city.name,
    Math.round(city.lon * 1000),
    Math.round(city.lat * 1000),
    Math.max(1, Math.round(city.population / 1000)),
    city.regions,
    ...city.names,
  ]);
  const more = Object.fromEntries(
    sorted.flatMap((city, at) => (city.others.length ? [[at, city.others.join("|")]] : [])),
  );
  if (Object.keys(more).length) otherNames[country] = more;
}

const text = JSON.stringify({
  source: `${SOURCES.cities15000.edition} (names in English from ${SOURCES.ne_10m_populated_places_simple.edition})`,
  licence: "CC BY 4.0, GeoNames (https://www.geonames.org)",
  minPopulation: MIN_POPULATION,
  otherNamesFrom: OTHER_NAMES_FROM,
  countries,
  otherNames,
});
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "cities.json"), text);
const bytes = Buffer.from(text);
console.log(
  `cities.json: ${cities.length} cities of ${byCountry.size} countries, ${placed} in a first-level region, ` +
    `${named} names in English, ${others} other names, ` +
    `${bytes.length} bytes, ${gzipSync(bytes, { level: 9 }).length} compressed, ` +
    `sha256 ${createHash("sha256").update(bytes).digest("hex")}`,
);
