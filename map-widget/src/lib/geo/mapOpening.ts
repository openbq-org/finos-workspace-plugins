import { MAP_LIMITS } from "~/lib/codemode/limits";
import type { MapBounds } from "./mapSummary";
import { fail, finite, isPlain, text } from "./mapValues";
import {
  needed,
  type PlaceFile,
  type PlaceNeeds,
  placeFileWords,
  placeIndex,
  type RegionIndexFile,
} from "./placeFiles";
import { type City, type CityIndex, loadedCities } from "./regions/cities";
import { bundledIndex } from "./regions/codes";
import { nameKey } from "./regions/fold";
import { countyKind } from "./regions/regionKeys";
import type { RegionIndex, RegionSetId } from "./regions/regionTypes";
import { isBundledSet } from "./regions/regionTypes";
import { loadedZips, type ZipIndex } from "./regions/zips";

export interface MapOpening {
  center?: [number, number];
  bounds?: MapBounds;
  box?: MapBounds;
  zoom?: number;
  bearing?: number;
  pitch?: number;
  place?: string;
  outline?: PlaceRegion;
}

export const OUTLINE_SETS = [
  "us-states",
  "countries",
  "admin1",
  "us-cbsa",
  "us-counties",
] as const satisfies readonly RegionSetId[];
export type OutlineSet = (typeof OUTLINE_SETS)[number];
export interface PlaceRegion {
  set: OutlineSet;
  id: string;
}
const REGION_ID = /^[A-Za-z0-9-]{1,16}$/;
const placeRegion = (raw: unknown): PlaceRegion | null =>
  isPlain(raw) &&
  OUTLINE_SETS.includes(raw.set as OutlineSet) &&
  typeof raw.id === "string" &&
  REGION_ID.test(raw.id)
    ? { set: raw.set as OutlineSet, id: raw.id }
    : null;

export const CITY_ZOOM = 11;
export const PLACE_CANDIDATES = 3;

const HELP =
  '`view` is where the map opens: { place: "Chicago" } (a city of 25,000 residents or more, a US state, a country, a state or province by its name or its ISO 3166-2 code, a US metro area, a US county with its state, a borough of New York City, a US ZIP code as "ZIP 10001"), { center: [lon, lat], zoom } or { bounds: [west, south, east, north] }, with `zoom` (0 to 19) and `bearing` when wanted, and `outline: true` beside a place that is an area.';
export const PLACE_KINDS =
  "A view names a city, a state or province, a country, a US metro area or county; for a street or a building give { center: [lon, lat], zoom }.";
export const NO_OUTLINE =
  "has no outline here: the app has the shape of a state, a province, a country, a US metro area and a US county, and a city is a point.";

const inRange = (lon: unknown, lat: unknown): boolean =>
  finite(lon) && finite(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90;
const VIEW_LON = 360;
const isViewBox = (box: readonly unknown[]): box is MapBounds =>
  box.length === 4 &&
  box.every(finite) &&
  Math.abs(box[0] as number) <= VIEW_LON &&
  Math.abs(box[2] as number) <= VIEW_LON &&
  (box[1] as number) >= -90 &&
  (box[3] as number) <= 90 &&
  (box[0] as number) <= (box[2] as number) &&
  (box[1] as number) <= (box[3] as number) &&
  (box[2] as number) - (box[0] as number) <= VIEW_LON;
const round = (value: number) => Math.round(value * 1e5) / 1e5;
const boxOf = (box: readonly number[]): MapBounds => [
  round(box[0]),
  round(box[1]),
  round(box[2]),
  round(box[3]),
];

export const cityRadiusKm = (population: number): number =>
  Math.round(Math.min(45, Math.max(4, 3 * (Math.max(population, 1) / 10_000) ** 0.35)));

function around(lon: number, lat: number, km: number): MapBounds {
  const dy = km / 111.32;
  const dx = dy / Math.max(0.1, Math.cos((lat * Math.PI) / 180));
  return boxOf([
    Math.max(-180, lon - dx),
    Math.max(-85, lat - dy),
    Math.min(180, lon + dx),
    Math.min(85, lat + dy),
  ]);
}

const WORLD_PIXELS = 512;
const mercatorY = (lat: number) => {
  const sin = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
};

export function boxZoom(
  [west, south, east, north]: readonly number[],
  width: number,
  height: number,
): number {
  const across = (east - west) / 360;
  const down = mercatorY(south) - mercatorY(north);
  const zoom = Math.min(
    across > 0 ? Math.log2(width / (WORLD_PIXELS * across)) : Number.POSITIVE_INFINITY,
    down > 0 ? Math.log2(height / (WORLD_PIXELS * down)) : Number.POSITIVE_INFINITY,
  );
  return Math.max(0, Math.min(MAP_LIMITS.viewZoom, zoom));
}

export const LOCAL_SPAN_DEGREES = 3;
export const LOCAL_FIT_ZOOM = 12;
export const FEW_MARKS = 30;
export const FEW_FIT_ZOOM = 17;

export function viewLimit({
  viewZoom,
  streets,
  detailed,
  total,
  box,
}: {
  viewZoom: number;
  streets: boolean;
  detailed: boolean;
  total: number;
  box: readonly number[] | null;
}): number | null {
  if (streets || detailed) return null;
  const [across, down] = box ? [box[2] - box[0], box[3] - box[1]] : [0, 0];
  const local =
    total >= 2 &&
    (across > 0 || down > 0) &&
    across <= LOCAL_SPAN_DEGREES &&
    down <= LOCAL_SPAN_DEGREES;
  return Math.max(
    viewZoom,
    local ? (total <= FEW_MARKS ? FEW_FIT_ZOOM : LOCAL_FIT_ZOOM) : 0,
  );
}

interface Candidate {
  id?: string;
  set?: OutlineSet;
  bounds: MapBounds;
  label: string;
}

const area = ([west, south, east, north]: MapBounds) => (east - west) * (north - south);
const inside = (inner: MapBounds, outer: MapBounds) => {
  const [x, y] = [(inner[0] + inner[2]) / 2, (inner[1] + inner[3]) / 2];
  return x >= outer[0] && x <= outer[2] && y >= outer[1] && y <= outer[3];
};

const cityCandidate = (city: City): Candidate => ({
  bounds: around(city.lon, city.lat, cityRadiusKm(city.population)),
  label: `the city "${city.name}, ${city.state ?? city.country}"`,
});

const REGION_WORDS: Record<
  Exclude<RegionSetId, "us-cd119">,
  (name: string, id: string, short: string) => string
> = {
  "us-states": (name, _id, short) => `the US state ${name} ("US-${short}")`,
  countries: (name, _id, short) => `the country ${name} ("${short}")`,
  admin1: (name, id) => `${name}, a state or province ("${id}")`,
  "us-cbsa": (name, id) => `the metro area ${name} ("CBSA ${id}")`,
  "us-counties": (name, id) => `${name} ${countyKind(id)} ("FIPS ${id}")`,
};

function regionCandidates(
  set: Exclude<RegionSetId, "us-cd119">,
  index: RegionIndex | null,
  name: string,
): Candidate[] {
  const match = index?.match(name);
  if (!index || !match) return [];
  const ids = "id" in match ? [match.id] : match.ambiguous;
  return ids.flatMap((id) => {
    const info = index.get(id);
    const box = info?.viewBounds ?? info?.bounds;
    if (!info || !box || !isViewBox(box)) return [];
    return [
      {
        id,
        set,
        bounds: boxOf(box),
        label: REGION_WORDS[set](info.name, id, info.short),
      },
    ];
  });
}

export type PlaceAnswer =
  | { bounds: MapBounds; region?: PlaceRegion }
  | { ambiguous: string[] }
  | { notLoaded: PlaceFile[] }
  | null;

export interface PlaceSources {
  cities: () => CityIndex | null;
  index: (set: RegionIndexFile) => RegionIndex | null;
  zips?: () => ZipIndex | null;
}

const loadedSources = (needs?: PlaceNeeds): PlaceSources => ({
  cities: () => needed("cities", loadedCities, needs),
  index: (set) => placeIndex(set, needs),
  zips: () => needed("zips", loadedZips, needs),
});

export const COUNTRY_PARTS: Readonly<Record<string, string>> = { england: "GB-ENG" };

export const PLACE_AREAS: readonly {
  names: readonly string[];
  set: OutlineSet;
  id: string;
}[] = [
  { names: ["Manhattan"], set: "us-counties", id: "36061" },
  { names: ["Brooklyn"], set: "us-counties", id: "36047" },
  { names: ["Queens"], set: "us-counties", id: "36081" },
  { names: ["The Bronx", "Bronx"], set: "us-counties", id: "36005" },
  { names: ["Staten Island"], set: "us-counties", id: "36085" },
];
const BOROUGH_OF = ["", "NY", "New York", "NYC", "New York City"];
const AREA_BY_KEY: ReadonlyMap<string, PlaceRegion> = new Map(
  PLACE_AREAS.flatMap(({ names, set, id }) =>
    names.flatMap((name) =>
      BOROUGH_OF.map((of) => [nameKey(`${name} ${of}`), { set, id }] as const),
    ),
  ),
);

export const PLACE_NAMES: Readonly<Record<string, string>> = {
  nyc: "New York City",
};

export const ZIP_RADIUS_KM = 3;
const FIVE_DIGITS = /^(?:(zip(?:\s*code)?|fips|cbsa)[\s:]*)?(\d{5})(?:-\d{4})?$/i;
type CodeKind = "zip" | "fips" | "cbsa";
const codeKind = (word: string | undefined): CodeKind | undefined => {
  const said = word?.toLowerCase();
  return said === undefined
    ? undefined
    : said === "fips" || said === "cbsa"
      ? said
      : "zip";
};

function codePlace(
  code: string,
  kind: CodeKind | undefined,
  sources: PlaceSources,
): PlaceAnswer {
  const asks = (wanted: CodeKind) => kind === undefined || kind === wanted;
  const zips = asks("zip") ? (sources.zips?.() ?? null) : null;
  const metros = asks("cbsa") ? sources.index("us-cbsa") : null;
  const counties = asks("fips") ? sources.index("us-counties") : null;
  const missing: PlaceFile[] = [
    ...(asks("zip") && !zips ? ["zips" as const] : []),
    ...(asks("cbsa") && !metros ? ["us-cbsa" as const] : []),
    ...(asks("fips") && !counties ? ["us-counties" as const] : []),
  ];
  if (missing.length) return { notLoaded: missing };
  const at = zips?.place(code);
  const known: Candidate[] = [
    ...(at
      ? [
          {
            bounds: around(at[0], at[1], ZIP_RADIUS_KM),
            label: `the ZIP code ${code} ("ZIP ${code}")`,
          },
        ]
      : []),
    ...regionCandidates("us-cbsa", metros, code),
    ...regionCandidates("us-counties", counties, code),
  ];
  if (known.length === 0) return null;
  if (known.length > 1) return { ambiguous: known.map(({ label }) => label) };
  return chosen(known);
}

type Step = readonly (RegionIndexFile | "cities")[];
const FETCHED_STEPS: readonly Step[] = [
  ["admin1", "cities"],
  ["us-cbsa"],
  ["us-counties"],
];
const COUNTY_STEPS: readonly Step[] = [
  ["us-counties"],
  ["admin1", "cities"],
  ["us-cbsa"],
];
const saysCounty = (name: string) => /\b(county|parish)\b/i.test(name);

const ownText = (names: Readonly<Record<string, string>>, key: string) =>
  Object.hasOwn(names, key) ? names[key] : undefined;

export function resolvePlace(
  given: string,
  sources: PlaceSources = loadedSources(),
): PlaceAnswer {
  const name = ownText(PLACE_NAMES, nameKey(given)) ?? given;
  const digits = FIVE_DIGITS.exec(name.trim());
  if (digits) return codePlace(digits[2], codeKind(digits[1]), sources);
  const area = AREA_BY_KEY.get(nameKey(name));
  if (area) {
    if (isBundledSet(area.set))
      return chosen(regionCandidates(area.set, bundledIndex(area.set), area.id));
    const index = sources.index(area.set);
    return index
      ? chosen(regionCandidates(area.set, index, area.id))
      : { notLoaded: [area.set] };
  }
  const part = ownText(COUNTRY_PARTS, nameKey(name));
  if (part !== undefined) {
    const index = sources.index("admin1");
    return index
      ? chosen(regionCandidates("admin1", index, part))
      : { notLoaded: ["admin1"] };
  }
  const states = regionCandidates("us-states", bundledIndex("us-states"), name);
  const first = [
    ...states,
    ...regionCandidates("countries", bundledIndex("countries"), name),
  ];
  if (first.length) return chosen(first);
  for (const files of saysCounty(name) ? COUNTY_STEPS : FETCHED_STEPS) {
    const missing = files.filter(
      (file) => (file === "cities" ? sources.cities() : sources.index(file)) === null,
    );
    if (missing.length) return { notLoaded: missing };
    const known = files.flatMap((file) =>
      file === "cities"
        ? cityCandidates(sources.cities(), name, () => sources.index("admin1"))
        : regionCandidates(file, sources.index(file), name).filter(
            ({ id }) => file !== "admin1" || !id?.startsWith("US-"),
          ),
    );
    if (known.length) return chosen(known);
  }
  return null;
}

function cityCandidates(
  cities: CityIndex | null,
  name: string,
  regions: () => RegionIndex | null,
): Candidate[] {
  const match = cities?.match(name, { regions });
  return !match || "notLoaded" in match
    ? []
    : "city" in match
      ? [cityCandidate(match.city)]
      : match.ambiguous.map(cityCandidate);
}

function chosen(known: Candidate[]): PlaceAnswer {
  const [largest, ...others] = [...known].sort(
    (a, b) => area(b.bounds) - area(a.bounds),
  );
  if (others.every((other) => inside(other.bounds, largest.bounds)))
    return {
      bounds: largest.bounds,
      ...(largest.id !== undefined && largest.set !== undefined
        ? { region: { set: largest.set, id: largest.id } }
        : {}),
    };
  return { ambiguous: known.slice(0, PLACE_CANDIDATES).map(({ label }) => label) };
}

function unresolvedNote(place: string, answer: PlaceAnswer): string {
  const named = JSON.stringify(place.slice(0, 40));
  if (answer && "notLoaded" in answer)
    return `${named} was not looked up: ${placeFileWords(answer.notLoaded)} could not be loaded. The map opens on its data. Try again.`;
  return answer && "ambiguous" in answer
    ? `${named} could be ${answer.ambiguous.join(" or ")}: the map opens on its data. Write the one that is meant.`
    : `No place is called ${named} here: the map opens on its data. ${PLACE_KINDS}`;
}

export interface ReadOpening {
  view?: MapOpening;
  note?: string;
}

export function readOpening(
  raw: unknown,
  making: boolean,
  needs?: PlaceNeeds,
): ReadOpening {
  if (raw === undefined || raw === null) return {};
  if (!isPlain(raw)) return fail(HELP);
  const zoom = raw.zoom;
  if (zoom !== undefined && !(finite(zoom) && zoom >= 0 && zoom <= MAP_LIMITS.viewZoom))
    return fail(
      `the zoom of a view is a number from 0 to ${MAP_LIMITS.viewZoom}. ${HELP}`,
    );
  const bearing = raw.bearing;
  if (bearing !== undefined && !(finite(bearing) && bearing >= -180 && bearing <= 180))
    return fail(
      `the bearing of a view is a number of degrees from -180 to 180. ${HELP}`,
    );
  const pitch = raw.pitch;
  if (
    pitch !== undefined &&
    !(finite(pitch) && pitch >= 0 && pitch <= MAP_LIMITS.pitch)
  )
    return fail(
      `the pitch of a view is a number of degrees from 0 to ${MAP_LIMITS.pitch}. ${HELP}`,
    );
  const numbers = raw.center !== undefined || raw.bounds !== undefined;
  const place =
    raw.place === undefined || (making && numbers) ? undefined : text(raw.place, 80);
  let where: Pick<MapOpening, "center" | "bounds" | "box"> = {};
  let note: string | undefined;
  const asksOutline = raw.outline === true;
  if (raw.outline !== undefined && !asksOutline && !placeRegion(raw.outline))
    return fail(
      `the outline of a view is \`true\`, beside the place it names. ${HELP}`,
    );
  let outline = asksOutline ? null : placeRegion(raw.outline);
  if (raw.center !== undefined) {
    const at = Array.isArray(raw.center)
      ? raw.center
      : isPlain(raw.center)
        ? [raw.center.lon, raw.center.lat]
        : [];
    if (!inRange(at[0], at[1]))
      return fail(`the center of a view is [lon, lat]. ${HELP}`);
    const seen = Array.isArray(raw.box)
      ? raw.box
      : Array.isArray(raw.bounds)
        ? raw.bounds
        : [];
    where = {
      center: [round(at[0] as number), round(at[1] as number)],
      ...(isViewBox(seen) ? { box: boxOf(seen) } : {}),
    };
  } else if (raw.bounds !== undefined) {
    const box = Array.isArray(raw.bounds) ? raw.bounds : [];
    if (!isViewBox(box))
      return fail(
        `the bounds of a view are [west, south, east, north], west of east (a box over the 180th meridian runs past it: [170, -50, 190, -30]). ${HELP}`,
      );
    where = { bounds: boxOf(box) };
  } else if (place !== undefined) {
    if (!making) return { view: { place } };
    const answer = resolvePlace(place, loadedSources(needs));
    if (!answer || !("bounds" in answer))
      return { view: { place }, note: unresolvedNote(place, answer) };
    where = { bounds: answer.bounds };
    if (asksOutline) outline = answer.region ?? null;
  } else if (zoom === undefined && bearing === undefined) return fail(HELP);
  if (making && asksOutline && !outline)
    note = `${place === undefined ? "A view by numbers" : JSON.stringify(place.slice(0, 40))} ${NO_OUTLINE}`;
  return {
    view: {
      ...where,
      ...(zoom === undefined ? {} : { zoom: Math.round((zoom as number) * 100) / 100 }),
      ...(bearing === undefined
        ? {}
        : { bearing: Math.round((bearing as number) * 10) / 10 }),
      ...(pitch === undefined
        ? {}
        : { pitch: Math.round((pitch as number) * 10) / 10 }),
      ...(place === undefined ? {} : { place }),
      ...(outline ? { outline } : {}),
    },
    ...(note === undefined ? {} : { note }),
  };
}

export const mapOpening = (raw: unknown): MapOpening | undefined =>
  readOpening(raw, true).view;

export const opensSomewhere = (view: MapOpening | undefined): view is MapOpening =>
  view !== undefined &&
  (view.center !== undefined ||
    view.bounds !== undefined ||
    view.zoom !== undefined ||
    view.bearing !== undefined);
