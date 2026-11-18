
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { feature, mergeArcs } from "topojson-client";
import {
  boxOf,
  crossings,
  inGeometry,
  labelPoint,
  measure,
  polygonsOf,
  prune,
  quantize,
  ringArea2,
  ringPoints,
} from "./geometry.mjs";
import { COUNTRIES, US_STATES } from "./tables.mjs";

const MAPSHAPER = "mapshaper@0.6.102";

const SOURCES = {
  ne_50m_admin_0_countries: {
    url: "https://naciscdn.org/naturalearth/50m/cultural/ne_50m_admin_0_countries.zip",
    sha256: "5fed433373581fa648920435f937d95f2d3c0200e067409c6478dcdf1b853139",
    fetched: "2026-10-09",
    edition: "Natural Earth 5.1.1, Admin 0 countries, 1:50m",
  },
  ne_10m_admin_1_states_provinces: {
    url: "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces.zip",
    sha256: "efc59726337323058f9446210adc96673179cd344e053666ee3d28cb58ba2b05",
    fetched: "2026-10-09",
    edition: "Natural Earth 5.1.1, Admin 1 states and provinces, 1:10m",
  },
  cb_2024_us_cbsa_5m: {
    url: "https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_cbsa_5m.zip",
    sha256: "94b5bdbb8990eabb66e9c1450731858607e2c02489bcf669f546aa477b9caca8",
    fetched: "2026-10-09",
    edition: "US Census Bureau cartographic boundary file 2024, CBSA, 1:5m",
  },
  cb_2024_us_cd119_5m: {
    url: "https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_cd119_5m.zip",
    sha256: "17370f9f4070f3a0fa82bb7400042bd418be77c208abc44288b52b3ad2344cc6",
    fetched: "2026-10-09",
    edition: "US Census Bureau cartographic boundary file 2024, 119th Congress, 1:5m",
  },
};

const DETAIL = {
  countries: { interval: 2000, step: 0.001 },
  admin1: { interval: 1000, step: 0.001 },
  "us-cbsa": { interval: 400, step: 0.0002 },
  "us-cd119": { interval: 400, step: 0.0002 },
};

const here = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(here, "../..");
const option = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? resolve(process.argv[at + 1]) : fallback;
};
const downloads = option("downloads");
if (!downloads) {
  console.error("usage: prepare-regions.mjs --downloads <dir> [--work <dir>] [--out <dir>]");
  process.exit(2);
}
const work = option("work", join(downloads, "..", "prepare-regions-work"));
const out = option("out", join(frontend, "vendor/geo/regions"));
mkdirSync(work, { recursive: true });
mkdirSync(out, { recursive: true });

const report = [];

function archive(name) {
  const path = join(downloads, name, `${name}.zip`);
  const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (digest !== SOURCES[name].sha256)
    throw new Error(`${name}.zip has the SHA-256 ${digest}, not the recorded one.`);
  const folder = join(work, "unpacked", name);
  mkdirSync(folder, { recursive: true });
  execFileSync("unzip", ["-o", "-q", path, "-d", folder]);
  return join(folder, `${name}.shp`);
}

function simplified(name, fields, { interval, step }) {
  const before = join(work, `${name}.raw.json`);
  const after = join(work, `${name}.simplified.json`);
  execFileSync(
    "npx",
    [
      "--yes",
      MAPSHAPER,
      archive(name),
      "encoding=utf8",
      "-filter-fields",
      fields.join(","),
      "-o",
      before,
      "format=topojson",
      "no-quantization",
      "-simplify",
      `interval=${interval}`,
      "keep-shapes",
      "-snap",
      `precision=${step}`,
      "-clean",
      "-o",
      after,
      "format=topojson",
      "no-quantization",
      `precision=${step}`,
    ],
    { cwd: work, stdio: ["ignore", "ignore", "inherit"] },
  );
  const raw = JSON.parse(readFileSync(before, "utf8"));
  const topology = JSON.parse(readFileSync(after, "utf8"));
  const [object] = Object.keys(topology.objects);
  return {
    topology,
    geometries: topology.objects[object].geometries.filter((geometry) => geometry.arcs),
    raw: raw.arcs.reduce((total, arc) => total + arc.length, 0),
  };
}

function continuous(value) {
  if (!Array.isArray(value)) return value;
  if (!Array.isArray(value[0]) || typeof value[0][0] !== "number")
    return value.map(continuous);
  let shift = 0;
  let before = null;
  return value.map(([lon, lat]) => {
    if (before !== null && Math.abs(lon - before) > 180) shift += lon < before ? 360 : -360;
    before = lon;
    return [lon + shift, lat];
  });
}

const round = (value, places) => Number(value.toFixed(places));
const wrapped = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

function placed(topology, geometry, places) {
  const shape = feature(topology, geometry).geometry;
  const whole = { ...shape, coordinates: continuous(shape.coordinates) };
  const flat = boxOf(whole);
  const at = labelPoint(whole) ?? (flat && [(flat[0] + flat[2]) / 2, (flat[1] + flat[3]) / 2]);
  const box = boxOf({
    ...shape,
    coordinates: mapPositions(shape.coordinates, ([lon, lat]) => [wrapped(lon), lat]),
  });
  if (!at || !box) throw new Error(`a region without an area: ${geometry.id}`);
  let point = [round(wrapped(at[0]), places), round(at[1], places)];
  if (!inGeometry(point, shape) && !inGeometry([point[0] + 360, point[1]], whole))
    point = [round(wrapped(at[0]), places + 2), round(at[1], places + 2)];
  return [
    ...point,
    round(box[0], places),
    round(box[1], places),
    round(box[2], places),
    round(box[3], places),
  ];
}

function mainBox(topology, geometry, place, places) {
  const shape = feature(topology, geometry).geometry;
  if (shape.type !== "MultiPolygon") return null;
  const point = [place[0], place[1]];
  const part = shape.coordinates.find((rings) => inGeometry(point, { type: "Polygon", coordinates: rings }));
  if (!part) return null;
  const box = boxOf({ type: "Polygon", coordinates: part });
  const wider = (place[4] - place[2]) / Math.max(box[2] - box[0], 1e-6);
  const taller = (place[5] - place[3]) / Math.max(box[3] - box[1], 1e-6);
  return wider > 3 || taller > 3 ? box.map((value) => round(value, places)) : null;
}

function mapPositions(value, change) {
  return typeof value[0] === "number"
    ? change(value)
    : value.map((item) => mapPositions(item, change));
}

function areaOf(topology, geometry) {
  let total = 0;
  for (const rings of polygonsOf(geometry))
    total += Math.abs(ringArea2(ringPoints(topology, rings[0])));
  return total;
}

function withoutEmptyRings(topology, geometry) {
  const kept = [];
  for (const rings of polygonsOf(geometry)) {
    const full = rings.filter((ring) => ringArea2(ringPoints(topology, ring)) !== 0);
    if (full.length && ringArea2(ringPoints(topology, rings[0])) !== 0) kept.push(full);
  }
  if (!kept.length) return null;
  return { ...geometry, type: "MultiPolygon", arcs: kept };
}

const around = (boxes) => [
  Math.min(...boxes.map((box) => box[0])),
  Math.min(...boxes.map((box) => box[1])),
  Math.max(...boxes.map((box) => box[2])),
  Math.max(...boxes.map((box) => box[3])),
];

function writeShapes(file, topology, objects, step, source) {
  let shipped = quantize(prune(topology, objects), step);
  const cleaned = {};
  let dropped = 0;
  for (const [name, collection] of Object.entries(shipped.objects))
    cleaned[name] = collection.geometries.flatMap((geometry) => {
      const kept = withoutEmptyRings(shipped, geometry);
      if (!kept) dropped++;
      return kept ? [kept] : [];
    });
  if (dropped) throw new Error(`${file}: ${dropped} regions have no area on the grid.`);
  const { transform } = shipped;
  shipped = { ...prune(shipped, cleaned), transform };
  const text = JSON.stringify(shipped);
  writeFileSync(join(out, file), text);
  const crossed = crossings(shipped);
  report.push({
    file,
    ...measure(shipped, "regions"),
    groups: shipped.objects.groups?.geometries.length ?? 0,
    sourcePositions: source,
    crossings: crossed,
    raw: Buffer.byteLength(text),
    gzip: gzipSync(text, { level: 9 }).length,
  });
  return shipped;
}

function writeIndex(file, index) {
  const text = JSON.stringify(index);
  writeFileSync(join(out, file), text);
  report.push({
    file,
    regions: index.regions.length,
    raw: Buffer.byteLength(text),
    gzip: gzipSync(text, { level: 9 }).length,
  });
}

const fold = (text) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

function others(name, names, limit = 8) {
  const seen = new Set([fold(name)]);
  const kept = [];
  for (const raw of names) {
    const text = String(raw ?? "").trim();
    const key = fold(text);
    if (!key || key.length > 60 || seen.has(key) || /[�¢]/.test(text)) continue;
    seen.add(key);
    kept.push(text);
    if (kept.length === limit) break;
  }
  return kept;
}

const statesByFips = new Map(US_STATES.map((row) => [row[0], row]));
const outsideContiguous = (fips) => fips === "02" || fips === "15" || Number(fips) >= 60;

const WITHOUT_ISO = {
  KOS: { id: "XKX", a2: "XK", a3: "XKX", name: "Kosovo" },
  CYN: { id: "CYN", a2: "", a3: "CYN", name: "Northern Cyprus" },
  SOL: { id: "SOL", a2: "", a3: "SOL", name: "Somaliland" },
};
const PART_OF = { IOA: "036", ATC: "036" };
const NO_COUNTRY = new Set(["KAS"]);

function countries() {
  const { topology, geometries, raw } = simplified(
    "ne_50m_admin_0_countries",
    [
      "ADM0_A3",
      "ISO_A2_EH",
      "ISO_A3_EH",
      "ISO_N3_EH",
      "NAME",
      "NAME_LONG",
      "ADMIN",
      "FORMAL_EN",
      "NAME_CIAWF",
      "BRK_NAME",
      "CONTINENT",
    ],
    DETAIL.countries,
  );
  const known = new Map(COUNTRIES.map((row) => [row[0], row]));
  const members = new Map();
  const facts = new Map();
  for (const geometry of geometries) {
    const p = geometry.properties;
    if (NO_COUNTRY.has(p.ADM0_A3)) continue;
    const odd = WITHOUT_ISO[p.ADM0_A3];
    const id =
      PART_OF[p.ADM0_A3] ?? odd?.id ?? String(p.ISO_N3_EH).padStart(3, "0");
    if (!/^([0-9]{3}|[A-Z]{3})$/.test(id)) throw new Error(`no id for ${p.NAME}`);
    members.set(id, [...(members.get(id) ?? []), geometry]);
    if (PART_OF[p.ADM0_A3]) continue;
    const row = known.get(id);
    const name = row?.[3] ?? odd?.name ?? p.NAME_LONG;
    facts.set(id, {
      name,
      a2: odd ? odd.a2 : (row?.[1] ?? p.ISO_A2_EH),
      a3: odd ? odd.a3 : (row?.[2] ?? p.ISO_A3_EH),
      alts: others(name, [
        ...(row?.[4] ?? []),
        p.NAME_LONG,
        p.NAME,
        p.ADMIN,
        p.FORMAL_EN,
        p.NAME_CIAWF,
        p.BRK_NAME,
      ]),
      continent: p.CONTINENT,
    });
  }
  const regions = [...members].map(([id, list]) => ({
    ...(list.length === 1 ? { type: list[0].type, arcs: list[0].arcs } : mergeArcs(topology, list)),
    id,
    properties: { name: facts.get(id).name },
  }));
  const shipped = writeShapes(
    "countries-50m.json",
    topology,
    { regions },
    DETAIL.countries.step,
    raw,
  );
  const rows = shipped.objects.regions.geometries.map((geometry) => {
    const fact = facts.get(geometry.id);
    const place = placed(shipped, geometry, 3);
    return [
      geometry.id,
      fact.name,
      fact.alts,
      ...place,
      fact.a2,
      fact.a3,
      mainBox(shipped, geometry, place, 3),
    ];
  });
  for (const [numeric, a2, a3, name, alts] of COUNTRIES)
    if (!facts.has(numeric))
      rows.push([numeric, name, [...alts], null, null, null, null, null, null, a2, a3, null]);
  rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  writeIndex("countries.index.json", {
    set: "countries",
    source: SOURCES.ne_50m_admin_0_countries.edition,
    columns: ["id", "name", "alts", "lon", "lat", "west", "south", "east", "north", "a2", "a3", "main"],
    bounds: [-180, -90, 180, 90],
    regions: rows,
  });
  const continents = new Map();
  for (const fact of facts.values()) if (fact.a2) continents.set(fact.a2, fact.continent);
  return continents;
}

const CURRENT_CODE = {
  "MX-DIF": "MX-CMX",
  "IN-OR": "IN-OD",
  "IN-UT": "IN-UK",
  "IN-CT": "IN-CG",
  "IN-TG": "IN-TS",
  "ZA-GT": "ZA-GP",
  "ZA-NL": "ZA-KZN",
  "LR-X1~": "LR-GP",
  "LR-X2~": "LR-RG",
};
const SHAPE_CODE = {
  "SD-DS|Eastern Darfur": "SD-DE",
  "LA-VI|Vientiane [prefecture]": "LA-VT",
  "PE-LIM|Lima Province": "PE-LMA",
  "SB-CH|Western": "SB-WE",
  "MV-12|Malé": "MV-MLE",
  "CO-CUN|Bogota": "CO-DC",
  "KZ-ALA|Almaty": "KZ-ALM",
};
const RENAMED = {
  "MX-CMX": ["Ciudad de México", ["Mexico City", "CDMX"]],
  "KZ-ALA": ["Almaty City", []],
};
const CORRECTED_NAME = {
  "GB-WRL": "Wirral",
  "RS-19": "Rasinski",
};
const ALSO_CODED = {
  "FR-GP": ["FR-971"],
  "FR-MQ": ["FR-972"],
  "FR-GF": ["FR-973"],
  "FR-RE": ["FR-974"],
  "FR-YT": ["FR-976"],
};
const MERGED_NAME = {
  "BA-BIH": "Federation of Bosnia and Herzegovina",
  "BA-SRP": "Republika Srpska",
  "MG-A": "Toamasina",
  "MG-D": "Antsiranana",
  "MG-F": "Fianarantsoa",
  "MG-M": "Mahajanga",
  "MG-T": "Antananarivo",
  "MG-U": "Toliara",
  "PH-MNL": "Metro Manila",
  "IE-D": "Dublin",
  "IE-TA": "Tipperary",
};

const SPAIN = {
  Andalucía: ["ES-AN", "Andalucía", ["Andalusia"]],
  Aragón: ["ES-AR", "Aragón", []],
  Asturias: ["ES-AS", "Asturias", ["Principado de Asturias"]],
  "Canary Is.": ["ES-CN", "Canarias", ["Canary Islands", "Islas Canarias"]],
  Cantabria: ["ES-CB", "Cantabria", []],
  "Castilla-La Mancha": ["ES-CM", "Castilla-La Mancha", ["Castile-La Mancha"]],
  "Castilla y León": ["ES-CL", "Castilla y León", ["Castile and León"]],
  Cataluña: ["ES-CT", "Cataluña", ["Catalonia", "Catalunya"]],
  Extremadura: ["ES-EX", "Extremadura", []],
  Galicia: ["ES-GA", "Galicia", []],
  "Islas Baleares": ["ES-IB", "Illes Balears", ["Balearic Islands", "Islas Baleares"]],
  "La Rioja": ["ES-RI", "La Rioja", []],
  Madrid: ["ES-MD", "Comunidad de Madrid", ["Madrid", "Community of Madrid"]],
  Murcia: ["ES-MC", "Región de Murcia", ["Murcia", "Region of Murcia"]],
  "Foral de Navarra": ["ES-NC", "Navarra", ["Navarre", "Comunidad Foral de Navarra"]],
  "País Vasco": ["ES-PV", "País Vasco", ["Basque Country", "Euskadi"]],
  Valenciana: ["ES-VC", "Comunitat Valenciana", ["Valencian Community", "Comunidad Valenciana"]],
};
const ITALY_ENGLISH = {
  "IT-21": ["Piedmont"],
  "IT-23": ["Aosta Valley", "Vallée d'Aoste"],
  "IT-25": ["Lombardy"],
  "IT-32": ["Trentino-South Tyrol", "Trentino-Südtirol"],
  "IT-52": ["Tuscany"],
  "IT-75": ["Puglia"],
  "IT-82": ["Sicilia"],
  "IT-88": ["Sardinia"],
};
const FRANCE = {
  "FR-ARA": [],
  "FR-BFC": ["Burgundy-Franche-Comté"],
  "FR-BRE": ["Brittany"],
  "FR-CVL": [],
  "FR-COR": ["Corsica"],
  "FR-GES": [],
  "FR-HDF": [],
  "FR-IDF": ["Ile de France", "Paris Region"],
  "FR-NOR": ["Normandy"],
  "FR-NAQ": ["New Aquitaine"],
  "FR-OCC": ["Occitania"],
  "FR-PDL": [],
  "FR-PAC": ["Provence-Alpes-Côte d'Azur", "PACA"],
};
const BRITAIN = {
  England: "GB-ENG",
  Scotland: "GB-SCT",
  Wales: "GB-WLS",
  "Northern Ireland": "GB-NIR",
};
const BELGIUM = {
  V: ["BE-VLG", "Vlaanderen", ["Flanders", "Flemish Region", "Vlaams Gewest"]],
  W: ["BE-WAL", "Wallonie", ["Wallonia", "Walloon Region", "Région wallonne"]],
};

function groupOf(code, p) {
  const country = code.slice(0, 2);
  if (country === "ES") return SPAIN[p.region] ?? null;
  if (country === "IT" && /^IT-[0-9]{2}$/.test(p.region_cod ?? ""))
    return [p.region_cod, p.region, ITALY_ENGLISH[p.region_cod] ?? []];
  if (country === "FR" && FRANCE[p.region_cod])
    return [p.region_cod === "FR-COR" ? "FR-20R" : p.region_cod, p.region, FRANCE[p.region_cod]];
  if (country === "GB" && BRITAIN[p.geonunit]) return [BRITAIN[p.geonunit], p.geonunit, []];
  if (country === "BE" && BELGIUM[code[3]] && code.length === 6) return BELGIUM[code[3]];
  return null;
}

const PARTS = [
  ["africa", "Africa"],
  ["asia", "Asia"],
  ["europe", "Europe"],
  ["north-america", "North America"],
  ["south-america", "South America"],
  ["oceania", "Oceania"],
];
const PART_OF_ISLANDS = { MU: 0, SC: 0, SH: 0, MV: 1, IO: 1, TF: 0, GS: 4, HM: 5 };

function admin1(continents) {
  const { topology, geometries, raw } = simplified(
    "ne_10m_admin_1_states_provinces",
    [
      "iso_3166_2",
      "name",
      "name_alt",
      "name_local",
      "name_en",
      "woe_name",
      "gn_name",
      "abbrev",
      "region",
      "region_cod",
      "geonunit",
      "admin",
    ],
    DETAIL.admin1,
  );
  const members = new Map();
  const left = new Map();
  for (const geometry of geometries) {
    const p = geometry.properties;
    for (const key of ["region", "region_cod", "geonunit", "name"])
      p[key] = String(p[key] ?? "").trim();
    let code =
      SHAPE_CODE[`${p.iso_3166_2}|${p.name}`] ??
      CURRENT_CODE[p.iso_3166_2] ??
      p.iso_3166_2;
    if (/^BA-X/.test(code)) code = "BA-SRP";
    const country = code.slice(0, 2);
    if (
      !/^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(code) ||
      /-X[0-9]/.test(code) ||
      !continents.has(country) ||
      !String(p.name ?? "").trim()
    ) {
      left.set(p.admin, (left.get(p.admin) ?? 0) + 1);
      continue;
    }
    members.set(code, [...(members.get(code) ?? []), geometry]);
  }

  const partOf = (code) => {
    const country = code.slice(0, 2);
    if (country in PART_OF_ISLANDS) return PART_OF_ISLANDS[country];
    const at = PARTS.findIndex(([, label]) => label === continents.get(country));
    if (at < 0) throw new Error(`no part for ${code} (${continents.get(country)})`);
    return at;
  };

  const facts = new Map();
  const regions = [];
  const grouped = new Map();
  for (const [code, list] of members) {
    const largest = list.reduce((a, b) =>
      areaOf(topology, a) >= areaOf(topology, b) ? a : b,
    );
    const p = largest.properties;
    const name =
      MERGED_NAME[code] ?? CORRECTED_NAME[code] ?? RENAMED[code]?.[0] ?? p.name;
    const unnamed =
      Boolean(MERGED_NAME[code]) || `${p.iso_3166_2}|${p.name}` in SHAPE_CODE;
    const former = Object.entries(CURRENT_CODE)
      .filter(([old, current]) => current === code && !old.endsWith("~"))
      .map(([old]) => old);
    const group = groupOf(code, p);
    facts.set(code, {
      name,
      alts: others(name, [
        ...(RENAMED[code] ? [...RENAMED[code][1], p.name] : []),
        ...(unnamed ? [] : [p.name_en, ...String(p.name_alt ?? "").split("|")]),
        ...(unnamed ? [] : [p.woe_name, p.gn_name, p.abbrev]),
        ...(unnamed ? [] : String(p.name_local ?? "").split("|")),
        ...(ALSO_CODED[code] ?? []),
        ...former,
      ]),
      level: group ? 2 : 1,
    });
    regions.push({
      ...(list.length === 1 ? { type: largest.type, arcs: largest.arcs } : mergeArcs(topology, list)),
      id: code,
      properties: { name },
    });
    if (group) {
      const [groupCode, groupName, groupAlts] = group;
      if (members.has(groupCode)) throw new Error(`${groupCode} is a region and a group`);
      const entry = grouped.get(groupCode) ?? { name: groupName, alts: groupAlts, list: [] };
      entry.list.push(...list);
      grouped.set(groupCode, entry);
    }
  }
  const groups = [...grouped].map(([code, { name, alts, list }]) => {
    facts.set(code, { name, alts: others(name, alts), level: 1 });
    return { ...mergeArcs(topology, list), id: code, properties: { name } };
  });

  const rows = [];
  const parts = PARTS.map(([id, label], at) => {
    const mine = (geometry) => partOf(geometry.id) === at;
    const shipped = writeShapes(
      `admin1-${id}.json`,
      topology,
      { regions: regions.filter(mine), groups: groups.filter(mine) },
      DETAIL.admin1.step,
      at === 0 ? raw : undefined,
    );
    const boxes = [];
    for (const name of ["regions", "groups"])
      for (const geometry of shipped.objects[name].geometries) {
        const fact = facts.get(geometry.id);
        const place = placed(shipped, geometry, 3);
        boxes.push(place.slice(2));
        rows.push([
          geometry.id,
          fact.name,
          fact.alts,
          ...place,
          at,
          fact.level,
          mainBox(shipped, geometry, place, 3),
        ]);
      }
    return { id, label, bounds: around(boxes) };
  });
  rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  writeIndex("admin1.index.json", {
    set: "admin1",
    source: SOURCES.ne_10m_admin_1_states_provinces.edition,
    columns: [
      "id",
      "name",
      "alts",
      "lon",
      "lat",
      "west",
      "south",
      "east",
      "north",
      "part",
      "level",
      "main",
    ],
    bounds: [-180, -90, 180, 90],
    parts,
    regions: rows,
  });
  console.log(
    `admin1: left out ${[...left.values()].reduce((a, b) => a + b, 0)} shapes without an ISO 3166-2 code:`,
    [...left].map(([name, count]) => `${name} ${count}`).join(", "),
  );
}

const statesOfArea = (name) => (name.split(", ")[1] ?? "").split("-");

function usIndex(set, source, columns, rows, outside) {
  const boxes = rows.filter((row) => !outside.has(row[0])).map((row) => row.slice(5, 9));
  writeIndex(`${set}.index.json`, {
    set,
    source,
    columns: ["id", "name", "alts", "lon", "lat", "west", "south", "east", "north", ...columns],
    bounds: around(rows.map((row) => row.slice(5, 9))),
    contiguousBounds: around(boxes),
    outsideContiguous: [...outside].sort(),
    regions: rows.sort((a, b) => (a[0] < b[0] ? -1 : 1)),
  });
}

function cbsa() {
  const { topology, geometries, raw } = simplified(
    "cb_2024_us_cbsa_5m",
    ["CBSAFP", "NAME", "LSAD"],
    DETAIL["us-cbsa"],
  );
  const kinds = new Map();
  const regions = geometries.map((geometry) => {
    kinds.set(geometry.properties.CBSAFP, geometry.properties.LSAD === "M1" ? "metro" : "micro");
    return {
      type: geometry.type,
      arcs: geometry.arcs,
      id: geometry.properties.CBSAFP,
      properties: { name: geometry.properties.NAME },
    };
  });
  const shipped = writeShapes("us-cbsa.json", topology, { regions }, DETAIL["us-cbsa"].step, raw);
  const usps = new Map(US_STATES.map((row) => [row[1], row[0]]));
  const outside = new Set();
  const rows = shipped.objects.regions.geometries.map((geometry) => {
    const name = geometry.properties.name;
    if (statesOfArea(name).every((state) => outsideContiguous(usps.get(state) ?? "99")))
      outside.add(geometry.id);
    return [geometry.id, name, [], ...placed(shipped, geometry, 4), kinds.get(geometry.id)];
  });
  usIndex("us-cbsa", SOURCES.cb_2024_us_cbsa_5m.edition, ["kind"], rows, outside);
}

function districts() {
  const { topology, geometries, raw } = simplified(
    "cb_2024_us_cd119_5m",
    ["STATEFP", "CD119FP", "GEOID"],
    DETAIL["us-cd119"],
  );
  const geoids = new Map();
  const regions = [];
  for (const geometry of geometries) {
    const { STATEFP, CD119FP, GEOID } = geometry.properties;
    if (!/^[0-9]{2}$/.test(CD119FP)) continue;
    const state = statesByFips.get(STATEFP);
    if (!state) throw new Error(`no state ${STATEFP}`);
    const whole = CD119FP === "00" || CD119FP === "98";
    const id = `${state[1]}-${whole ? "AL" : CD119FP}`;
    geoids.set(id, GEOID);
    regions.push({
      type: geometry.type,
      arcs: geometry.arcs,
      id,
      properties: {
        name: whole ? `${state[2]} at large` : `${state[2]} district ${Number(CD119FP)}`,
      },
    });
  }
  const shipped = writeShapes("us-cd119.json", topology, { regions }, DETAIL["us-cd119"].step, raw);
  const outside = new Set();
  const usps = new Map(US_STATES.map((row) => [row[1], row[0]]));
  const rows = shipped.objects.regions.geometries.map((geometry) => {
    if (outsideContiguous(usps.get(geometry.id.slice(0, 2)))) outside.add(geometry.id);
    return [
      geometry.id,
      geometry.properties.name,
      [],
      ...placed(shipped, geometry, 4),
      geoids.get(geometry.id),
    ];
  });
  usIndex("us-cd119", SOURCES.cb_2024_us_cd119_5m.edition, ["geoid"], rows, outside);
}

function usAtlas() {
  const read = (file) =>
    JSON.parse(readFileSync(join(frontend, "vendor/geo/us-atlas-3.0.1", file), "utf8"));
  const states = read("states-10m.json");
  const outsideStates = new Set();
  const stateRows = states.objects.states.geometries.map((geometry) => {
    const [fips, usps, name] = statesByFips.get(geometry.id);
    if (outsideContiguous(fips)) outsideStates.add(fips);
    return [fips, name, [], ...placed(states, geometry, 3), usps];
  });
  usIndex("us-states", "us-atlas 3.0.1, states-10m.json", ["usps"], stateRows, outsideStates);

  const counties = read("counties-10m.json");
  const outsideCounties = new Set();
  const countyRows = counties.objects.counties.geometries.map((geometry) => {
    if (outsideContiguous(geometry.id.slice(0, 2))) outsideCounties.add(geometry.id);
    return [geometry.id, geometry.properties.name, [], ...placed(counties, geometry, 3)];
  });
  usIndex("us-counties", "us-atlas 3.0.1, counties-10m.json", [], countyRows, outsideCounties);
}

const only = process.argv.includes("--only")
  ? process.argv[process.argv.indexOf("--only") + 1].split(",")
  : null;
const wanted = (name) => !only || only.includes(name);

const continents = countries();
if (wanted("admin1")) admin1(continents);
if (wanted("us-cbsa")) cbsa();
if (wanted("us-cd119")) districts();
if (wanted("us-atlas")) usAtlas();

console.table(report);
const total = (key) => report.reduce((sum, row) => sum + row[key], 0);
console.log(`total: ${total("raw")} bytes, ${total("gzip")} gzip`);
writeFileSync(join(work, "report.json"), JSON.stringify(report, null, 2));
if (report.some((row) => row.crossings))
  throw new Error("two lines of a file cross: lower the simplification of that set.");
