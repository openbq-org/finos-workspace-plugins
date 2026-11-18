import { kmBetween } from "./geodesy";
import { type City, type CityIndex, cityLabel } from "./regions/cities";
import { bundledIndex } from "./regions/codes";

export const LOOKING_AT = {
  regionKm: 600,
  named: 4,
  muchLarger: 3,
  cityKm: 12,
  nearWidths: 6,
  phraseChars: 240,
} as const;

type Box = readonly [number, number, number, number];

const fold = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

const inside = ([west, south, east, north]: Box, lon: number, lat: number) => {
  if (lat < south || lat > north) return false;
  if (east - west >= 360) return true;
  const w = fold(west);
  const e = fold(east);
  const x = fold(lon);
  return w <= e ? x >= w && x <= e : x >= w || x <= e;
};

function regionsIn(set: "us-states" | "countries", box: Box): string[] {
  const index = bundledIndex(set);
  const names: string[] = [];
  for (const id of index.ids()) {
    const info = index.get(id);
    if (info?.centroid && inside(box, info.centroid[0], info.centroid[1]))
      names.push(info.name);
  }
  return names;
}

function regionAt(
  set: "us-states" | "countries",
  lon: number,
  lat: number,
): string | null {
  const index = bundledIndex(set);
  let best: { name: string; km: number } | null = null;
  for (const id of index.ids()) {
    const info = index.get(id);
    const held = info?.viewBounds ?? info?.bounds;
    if (!held || !info?.centroid) continue;
    const [west, south, east, north] = held;
    if (lon < west || lon > east || lat < south || lat > north) continue;
    const km = kmBetween([lon, lat], info.centroid);
    if (!best || km < best.km) best = { name: info.name, km };
  }
  return best?.name ?? null;
}

const listed = (names: readonly string[]) => {
  const shown = names.slice(0, LOOKING_AT.named).join(", ");
  return names.length > LOOKING_AT.named
    ? `${shown} and ${names.length - LOOKING_AT.named} more`
    : shown;
};

const isBox = (value: unknown): value is Box =>
  Array.isArray(value) &&
  value.length === 4 &&
  value.every((part) => typeof part === "number" && Number.isFinite(part));

export function lookingAt(bounds: unknown, cities: CityIndex | null): string | null {
  if (!isBox(bounds)) return null;
  const box = bounds;
  const [west, south, east, north] = box;
  if (!(west < east && south < north)) return null;
  const middle: [number, number] = [fold((west + east) / 2), (south + north) / 2];
  const acrossKm = Math.max(
    kmBetween([west, middle[1]], [Math.min(east, west + 180), middle[1]]),
    kmBetween([middle[0], south], [middle[0], north]),
  );
  const cut = (phrase: string) => phrase.slice(0, LOOKING_AT.phraseChars);

  if (acrossKm >= LOOKING_AT.regionKm) {
    const states = regionsIn("us-states", box);
    const countries = regionsIn("countries", box);
    if (states.length && countries.length <= 1)
      return cut(`${listed(states)} (United States)`);
    if (countries.length)
      return cut(
        states.length
          ? `${listed(countries)}; US states: ${listed(states)}`
          : listed(countries),
      );
    const around = regionAt("us-states", ...middle) ?? regionAt("countries", ...middle);
    return cut(
      around
        ? `part of ${around}`
        : "open sea, or an area with no country in the middle of the view",
    );
  }

  const where = regionAt("us-states", ...middle) ?? regionAt("countries", ...middle);
  if (!cities)
    return cut(
      where
        ? `an area of ${where}`
        : "open sea, or an area outside every listed country",
    );
  const within: City[] = [];
  let nearest: { city: City; km: number } | null = null;
  let chief: { city: City; km: number } | null = null;
  const reach = LOOKING_AT.cityKm;
  for (const city of cities.largest(cities.size)) {
    if (inside(box, city.lon, city.lat)) {
      if (within.length < LOOKING_AT.named + 1) within.push(city);
      continue;
    }
    if (chief && within.length) continue;
    const km = kmBetween(middle, [city.lon, city.lat]);
    if (!chief && km <= reach) chief = { city, km };
    if (!within.length && (!nearest || km < nearest.km)) nearest = { city, km };
  }
  const of =
    chief &&
    (!within.length ||
      chief.city.population >= within[0].population * LOOKING_AT.muchLarger)
      ? chief
      : null;
  if (of)
    return cut(
      `${cityLabel(of.city)} (the middle of the view is ${Math.max(1, Math.round(of.km))} km from its centre)${
        within.length ? `; in the view: ${listed(within.map((city) => city.name))}` : ""
      }`,
    );
  if (within.length) {
    const [first, ...others] = within;
    const more = others.map((city) => city.name);
    return cut(`${cityLabel(first)}${more.length ? `; also ${listed(more)}` : ""}`);
  }
  if (nearest && nearest.km <= acrossKm * LOOKING_AT.nearWidths)
    return cut(
      `near ${cityLabel(nearest.city)} (${Math.round(nearest.km)} km from the middle of the view)`,
    );
  return cut(
    where ? `an area of ${where}` : "open sea, or an area outside every listed country",
  );
}
