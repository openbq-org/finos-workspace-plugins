import { BUNDLED_INDEX_DATA } from "./bundled";
import { codeKey, nameKey } from "./fold";
import type {
  RegionBox,
  RegionIndexData,
  RegionInfo,
  RegionSetId,
} from "./regionTypes";

export interface Entry {
  id: string;
  scope: string;
  own: boolean;
  level: number;
  kind: string;
}

export interface Keys {
  codes: Map<string, string>;
  names: Map<string, Entry[]>;
  suffixes: Map<string, string[]>;
  infos: Map<string, RegionInfo>;
}

export const SINGLE_PART = "all";

const STATES = BUNDLED_INDEX_DATA["us-states"];
export const stateByUsps = new Map(
  STATES.regions.map((row) => [
    String(row[STATES.columns.indexOf("usps")]),
    { fips: String(row[0]), name: String(row[1]) },
  ]),
);

const CITY_STATES = new Set(["24", "29", "32", "51"]);
export const countyKind = (id: string) =>
  CITY_STATES.has(id.slice(0, 2)) && Number(id.slice(2)) >= 510 ? "city" : "county";

const RENAMED_COUNTIES: readonly (readonly [string, string, string])[] = [
  ["02270", "Wade Hampton", "02158"],
  ["46113", "Shannon", "46102"],
  ["12025", "Dade", "12086"],
];

function metroNames(name: string): { cities: string[]; states: string[] } {
  const comma = name.lastIndexOf(", ");
  const places = comma < 0 ? name : name.slice(0, comma);
  const states = comma < 0 ? [] : name.slice(comma + 2).split("-");
  const cities = new Set<string>([places]);
  for (const wide of places.split("--")) {
    cities.add(wide);
    for (const part of wide.split(/[-/]/)) {
      cities.add(part);
      cities.add(part.replace(/^Urban /, ""));
    }
  }
  return { cities: [...cities].filter(Boolean), states };
}

export function keysOf(set: RegionSetId, data: RegionIndexData): Keys {
  const column = (name: string) => data.columns.indexOf(name);
  const at = {
    main: column("main"),
    part: column("part"),
    level: column("level"),
    a2: column("a2"),
    a3: column("a3"),
    usps: column("usps"),
    geoid: column("geoid"),
  };
  const keys: Keys = {
    codes: new Map(),
    names: new Map(),
    suffixes: new Map(),
    infos: new Map(),
  };
  const name = (text: string, entry: Entry) => {
    const key = nameKey(text);
    if (!key) return;
    const list = keys.names.get(key);
    if (!list) keys.names.set(key, [entry]);
    else if (!list.some((other) => other.id === entry.id && other.own === entry.own))
      list.push(entry);
  };
  for (const row of data.regions) {
    const [id, title, alts, lon, lat, west, south, east, north] = row as [
      string,
      string,
      string[],
      ...(number | null)[],
    ];
    const bounds = west === null ? null : ([west, south, east, north] as RegionBox);
    const main = at.main < 0 ? null : (row[at.main] as RegionBox | null);
    const level = at.level < 0 ? 1 : (row[at.level] as 1 | 2);
    const short =
      set === "countries"
        ? String(row[at.a2] ?? "")
        : set === "us-states"
          ? String(row[at.usps])
          : set === "us-cd119"
            ? String(row[at.geoid])
            : id;
    keys.infos.set(id, {
      id,
      name: title,
      centroid: lon === null || lat === null ? null : [lon, lat],
      bounds,
      viewBounds: main ?? bounds,
      part:
        at.part < 0
          ? SINGLE_PART
          : (data.parts?.[row[at.part] as number]?.id ?? SINGLE_PART),
      level,
      short,
    });
    const scope = set === "admin1" || set === "us-counties" ? id.slice(0, 2) : "";
    const kind = set === "us-counties" ? countyKind(id) : "";
    const own: Entry = { id, scope, own: true, level, kind };
    const other: Entry = { ...own, own: false };
    keys.codes.set(codeKey(id), id);
    name(title, own);
    for (const alt of alts) {
      if (set === "admin1" && /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(alt))
        keys.codes.set(codeKey(alt), id);
      else if (set === "admin1" && codeKey(alt) === id.slice(3)) continue;
      else name(alt, other);
    }
    if (set === "countries") {
      for (const code of [row[at.a2], row[at.a3]] as string[])
        if (code) name(code, own);
    } else if (set === "us-states") {
      const usps = String(row[at.usps]);
      for (const text of [usps, `US-${usps}`, `State of ${title}`]) name(text, own);
    } else if (set === "admin1") {
      const suffix = id.slice(3);
      keys.suffixes.set(suffix, [...(keys.suffixes.get(suffix) ?? []), id]);
    } else if (set === "us-cbsa") {
      const { cities, states } = metroNames(title);
      for (const city of cities) {
        name(city, other);
        for (const usps of states) {
          name(`${city} ${usps}`, other);
          const state = stateByUsps.get(usps);
          if (state) name(`${city} ${state.name}`, other);
        }
      }
    } else if (set === "us-cd119") keys.codes.set(String(row[at.geoid]), id);
  }
  if (set === "us-counties")
    for (const [code, title, id] of RENAMED_COUNTIES) {
      if (!keys.infos.has(id)) continue;
      keys.codes.set(code, id);
      name(title, {
        id,
        scope: id.slice(0, 2),
        own: false,
        level: 1,
        kind: countyKind(id),
      });
    }
  if (set === "us-states")
    for (const [text, fips] of [
      ["Washington DC", "11"],
      ["Commonwealth of the Northern Mariana Islands", "69"],
      ["United States Virgin Islands", "78"],
      ["Virgin Islands", "78"],
    ])
      name(text, { id: fips, scope: "", own: false, level: 1, kind: "" });
  return keys;
}
