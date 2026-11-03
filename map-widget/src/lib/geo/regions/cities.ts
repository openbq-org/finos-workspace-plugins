import { readAssetJson } from "~/host";
import { matchCountry, matchState } from "./codes";
import { nameKey, nameWords, written } from "./fold";
import type { RegionIndex } from "./regionTypes";

export const PLACE_SET_IDS = ["cities"] as const;

export const DOMINANT = 10;
export const SMALL = 100_000;
export const MUCH_LARGER = 3;

export interface CitiesData {
  source: string;
  licence: string;
  minPopulation: number;
  otherNamesFrom?: number;
  countries: Record<string, Array<Array<string | number>>>;
  otherNames?: Record<string, Record<string, string>>;
}

export interface City {
  name: string;
  country: string;
  state?: string;
  regions: string[];
  lon: number;
  lat: number;
  population: number;
}

export type CityMatch =
  | { city: City; by?: "other" }
  | { ambiguous: City[]; because?: string }
  | { notLoaded: "admin1" }
  | null;

export interface CityOptions {
  country?: unknown;
  state?: unknown;
  regions?: () => RegionIndex | null;
}

export interface CityIndex {
  size: number;
  source: string;
  licence: string;
  largest: (count: number) => readonly City[];
  match: (value: unknown, options?: CityOptions) => CityMatch;
}

const CANDIDATES = 4;

export const cityLabel = ({ name, state, country }: City): string =>
  `${name}${state ? `, ${state}` : ""}, ${country}`;

interface Where {
  country?: string;
  regions?: readonly string[];
}
const NOT_LOADED = { notLoaded: "admin1" } as const;
type NotLoaded = typeof NOT_LOADED;
const unread = <T extends object>(
  value: T | NotLoaded | null,
): value is NotLoaded | null => value === null || "notLoaded" in value;

const largestFirst = (a: City, b: City) =>
  b.population - a.population || (cityLabel(a) < cityLabel(b) ? -1 : 1);

export function buildCityIndex(data: CitiesData): CityIndex {
  const own = new Map<string, City[]>();
  const other = new Map<string, City[]>();
  const add = (names: Map<string, City[]>, key: string, city: City) => {
    if (!key) return;
    const known = names.get(key);
    if (!known) names.set(key, [city]);
    else if (!known.includes(city)) known.push(city);
  };
  let size = 0;
  const every: City[] = [];
  let ordered = false;
  for (const [country, rows] of Object.entries(data.countries)) {
    const more = data.otherNames?.[country];
    rows.forEach((row, at) => {
      const codes = String(row[4] ?? "");
      const city: City = {
        name: String(row[0]),
        country,
        ...(country === "US" && codes ? { state: codes } : {}),
        regions: codes ? codes.split("/").map((code) => `${country}-${code}`) : [],
        lon: Number(row[1]) / 1000,
        lat: Number(row[2]) / 1000,
        population: Number(row[3]) * 1000,
      };
      size++;
      every.push(city);
      for (const name of [city.name, ...row.slice(5)])
        add(own, nameKey(String(name)), city);
      for (const name of more?.[at]?.split("|") ?? []) add(other, nameKey(name), city);
    });
  }

  const within = (cities: readonly City[] | undefined, where: Where): City[] =>
    (cities ?? []).filter(
      (city) =>
        (where.country === undefined || city.country === where.country) &&
        (where.regions === undefined ||
          where.regions.some((id) => city.regions.includes(id))),
    );

  const inState = (region: string, country: string | undefined): Where | null => {
    const state = matchState(region)?.short;
    return state !== undefined && (country ?? "US") === "US"
      ? { country: "US", regions: [`US-${state}`] }
      : null;
  };

  const inProvince = (
    region: string,
    country: string | undefined,
    regions: CityOptions["regions"],
  ): Where | NotLoaded | null => {
    if (country === "US") return null;
    const state = matchState(region) !== null;
    const index = regions?.() ?? null;
    if (!index) return country === undefined || state ? NOT_LOADED : { country };
    const found = index.match(region, country === undefined ? {} : { country });
    const ids = (!found ? [] : "id" in found ? [found.id] : found.ambiguous).filter(
      (id) => country === undefined || id.startsWith(`${country}-`),
    );
    if (ids.length)
      return { ...(country === undefined ? {} : { country }), regions: ids };
    return country === undefined || state ? null : { country };
  };

  const narrow = (
    region: string | null,
    country: string | undefined,
    regions: CityOptions["regions"],
  ): Where | NotLoaded | null =>
    region === null
      ? country === undefined
        ? {}
        : { country }
      : (inState(region, country) ?? inProvince(region, country, regions));

  const named = (key: string, where: Where): { cities: City[]; by?: "other" } => {
    const first = within(own.get(key), where);
    if (first.length) return { cities: first };
    const second = within(other.get(key), where);
    return second.length ? { cities: second, by: "other" } : { cities: [] };
  };

  const partOf = (words: readonly string[], city: City): boolean => {
    const whole = nameWords(city.name);
    return (
      whole.length > words.length &&
      whole.some((_, at) => words.every((word, by) => whole[at + by] === word))
    );
  };

  const direct = (value: unknown, options: CityOptions = {}): CityMatch => {
    const text = written(value);
    if (text === null) return null;
    let country: string | undefined;
    if (written(options.country) !== null) {
      country = matchCountry(options.country)?.short;
      if (country === undefined) return null;
    }
    const base = narrow(written(options.state), country, options.regions);
    if (unread(base)) return base;
    let name = text;
    let where: Where = base;
    let found = named(nameKey(text), where);
    const parts = text
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (found.cities.length === 0 && parts.length > 1) {
      name = parts[0];
      const key = nameKey(name);
      if (named(key, base).cities.length === 0) return null;
      const readings = afterName(parts.slice(1), base, key, options.regions);
      if (unread(readings)) return readings;
      const all = readings.map((reading) => named(key, reading));
      found = {
        cities: [...new Set(all.flatMap(({ cities }) => cities))],
        ...(all.every(({ by }) => by) ? { by: "other" as const } : {}),
      };
      where = readings[0] ?? base;
    }
    if (found.cities.length === 0) return null;
    const sorted = [...found.cities].sort(largestFirst);
    const [first, second] = sorted;
    if (second && first.population < DOMINANT * second.population)
      return { ambiguous: sorted.slice(0, CANDIDATES) };
    const loose = where.country === undefined && where.regions === undefined;
    if (loose && !found.by && first.population < SMALL) {
      const land = matchCountry(name);
      if (land && land.short !== first.country)
        return {
          ambiguous: [first],
          because: `${land.name} is a country, and the one city of that name is ${cityLabel(first)}: give its country to mean it`,
        };
      const words = nameWords(name);
      const larger = (other.get(nameKey(name)) ?? [])
        .filter(
          (city) =>
            city.population >= MUCH_LARGER * first.population && partOf(words, city),
        )
        .sort(largestFirst);
      if (larger.length) return { ambiguous: [...larger, first].slice(0, CANDIDATES) };
    }
    return { city: first, ...(found.by ? { by: found.by } : {}) };
  };

  const both = (base: Where, next: Where): Where | null => {
    if (base.country && next.country && base.country !== next.country) return null;
    const regions =
      base.regions && next.regions
        ? base.regions.filter((id) => next.regions?.includes(id))
        : (next.regions ?? base.regions);
    if (regions && regions.length === 0) return null;
    const country = next.country ?? base.country;
    return { ...(country ? { country } : {}), ...(regions ? { regions } : {}) };
  };

  function afterName(
    parts: string[],
    base: Where,
    key: string,
    regions: CityOptions["regions"],
  ): Where[] | NotLoaded | null {
    const [last, before] = [parts[parts.length - 1], parts[parts.length - 2]];
    const holds = (where: Where | null): where is Where =>
      where !== null && named(key, where).cities.length > 0;
    if (before !== undefined) {
      const [country, region] = matchCountry(last)
        ? [matchCountry(last)?.short, before]
        : [matchCountry(before)?.short, last];
      if (country === undefined) return null;
      if (base.country && base.country !== country) return null;
      const next = narrow(region, country, regions);
      if (unread(next)) return next;
      const where = both(base, next);
      return holds(where) ? [where] : null;
    }
    const country = matchCountry(last)?.short;
    const readings = [
      inState(last, base.country),
      country === undefined ? null : { country },
    ]
      .map((next) => (next ? both(base, next) : null))
      .filter(holds);
    if (readings.length) return readings;
    const next = inProvince(last, base.country, regions);
    if (unread(next)) return next;
    const where = both(base, next);
    return holds(where) ? [where] : null;
  }

  const match = (value: unknown, options: CityOptions = {}): CityMatch => {
    const found = direct(value, options);
    const text = written(value);
    if (found !== null || text === null) return found;
    const comma = text.indexOf(",");
    const head = comma < 0 ? text : text.slice(0, comma);
    const rest = comma < 0 ? "" : text.slice(comma);
    for (const place of facilityPlaces(head)) {
      const again = direct(`${place}${rest}`, options);
      if (again === null) continue;
      return "city" in again ? { city: again.city, by: "other" } : again;
    }
    return null;
  };

  const largest = (count: number): readonly City[] => {
    if (!ordered) {
      every.sort(largestFirst);
      ordered = true;
    }
    return every.slice(0, Math.max(0, count));
  };
  return { size, source: data.source, licence: data.licence, largest, match };
}

const FACILITY_WORDS: ReadonlySet<string> = new Set([
  "port",
  "ports",
  "harbour",
  "harbor",
  "terminal",
  "terminals",
  "airport",
  "station",
  "pier",
  "wharf",
  "dock",
  "docks",
  "anchorage",
  "hafen",
  "havn",
  "hamn",
  "puerto",
  "porto",
  "liman",
  "limani",
  "gang",
]);
const CONNECTORS: ReadonlySet<string> = new Set([
  "of",
  "de",
  "del",
  "della",
  "di",
  "do",
  "da",
  "du",
  "des",
]);

export function facilityPlaces(name: string): string[] {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const folded = words.map((word) => nameWords(word, false).join(""));
  const places: string[] = [];
  const last = folded.findLastIndex((word, at) => at > 0 && FACILITY_WORDS.has(word));
  for (let end = last; end > 0; end--) places.push(words.slice(0, end).join(" "));
  if (FACILITY_WORDS.has(folded[0] ?? "")) {
    const from = CONNECTORS.has(folded[1] ?? "") ? 2 : 1;
    if (from < words.length) places.push(words.slice(from).join(" "));
  }
  return places;
}

let index: CityIndex | null = null;
let loading: Promise<CityIndex> | null = null;

export function registerCities(data: CitiesData): CityIndex {
  index = buildCityIndex(data);
  return index;
}

export const loadedCities = (): CityIndex | null => index;

export function loadCities(): Promise<CityIndex> {
  if (index) return Promise.resolve(index);
  loading ??= (async () => {
    return registerCities(await readAssetJson<CitiesData>("geo/places/cities.json"));
  })();
  const shared = loading;
  shared.catch(() => {
    if (loading === shared) loading = null;
  });
  return shared;
}
