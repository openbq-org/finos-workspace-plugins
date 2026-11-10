import { MAP_LIMITS } from "~/lib/codemode/limits";
import { fail, finite, type Plain, shown, text } from "./mapValues";
import { type MarkBudget, noteCode } from "./markBudget";
import { needed, placeIndex } from "./placeFiles";
import { cityLabel, loadedCities } from "./regions/cities";
import { matchCountry, matchState } from "./regions/codes";
import { loadedZips, zipCode } from "./regions/zips";

export const inRange = (lon: unknown, lat: unknown): boolean =>
  finite(lon) && finite(lat) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;

const NEEDS_PLACE =
  "A point needs a latitude and a longitude as numbers (lat from -90 to 90, lon from -180 to 180), or a city, a US ZIP code, a state or a country. A street address is not a place on a map: the data source turns addresses into coordinates, the browser does not.";

export function placeOf(
  raw: Plain,
  what: string,
  budget: MarkBudget,
): [number, number] | null {
  let { lat, lon } = raw as { lat: unknown; lon: unknown };
  if (lat === undefined && lon === undefined && raw.city !== undefined) {
    const cities = needed("cities", loadedCities, budget.needs);
    if (!cities) {
      budget.cities.unloaded++;
      return null;
    }
    const match = cities.match(raw.city, {
      country: raw.country,
      state: raw.state,
      regions: () => placeIndex("admin1", budget.needs),
    });
    if (match && "notLoaded" in match) {
      budget.cities.unloaded++;
      return null;
    }
    const where = [raw.state, raw.country].flatMap((part) => text(part, 40) ?? []);
    const written = [text(raw.city, 60) ?? typeof raw.city, ...where].join(", ");
    if (match && "city" in match) {
      budget.cities.placed++;
      if (match.by) {
        const { renamed } = budget.cities;
        renamed.count++;
        if (renamed.examples.length < MAP_LIMITS.unmatchedShown)
          renamed.examples.push(`${written} (${cityLabel(match.city)})`);
      }
      return [match.city.lon, match.city.lat];
    }
    const several = match && "ambiguous" in match ? match : null;
    const left = several ? budget.cities.ambiguous : budget.cities.unmatched;
    left.count++;
    if (left.examples.length < MAP_LIMITS.unmatchedShown)
      left.examples.push(
        several
          ? `${written} (${several.because ?? several.ambiguous.map(cityLabel).join(" or ")})`
          : written,
      );
    return null;
  }
  if (lat === undefined && lon === undefined && raw.zip !== undefined) {
    const read = zipCode(raw.zip, raw.zipNamed === true);
    const written = text(raw.zip, 20) ?? typeof raw.zip;
    const leftOut = (left: { count: number; examples: string[] }) => {
      left.count++;
      if (left.examples.length < MAP_LIMITS.unmatchedShown) left.examples.push(written);
      return null;
    };
    if (!read) return leftOut(budget.zips.unmatched);
    if ("short" in read) return leftOut(budget.zips.short);
    const zips = needed("zips", loadedZips, budget.needs);
    if (!zips) {
      budget.zips.unloaded++;
      return null;
    }
    const place = zips.place(read.code);
    if (!place) return leftOut(budget.zips.unmatched);
    budget.zips.placed++;
    return place;
  }
  if (lat === undefined && lon === undefined) {
    const code = raw.state ?? raw.country;
    if (code === undefined) return fail(`${what} has no place. ${NEEDS_PLACE}`);
    const region =
      raw.state !== undefined ? matchState(raw.state) : matchCountry(raw.country);
    if (!region?.centre) {
      budget.unplaced.count++;
      if (budget.unplaced.examples.length < MAP_LIMITS.unmatchedShown)
        budget.unplaced.examples.push(shown(code) ?? typeof code);
      return null;
    }
    noteCode(budget, code, region.name);
    [lon, lat] = region.centre;
  }
  if (!inRange(lon, lat))
    return fail(`${what} has lat ${shown(lat)} and lon ${shown(lon)}. ${NEEDS_PLACE}`);
  return [lon as number, lat as number];
}

export function position(raw: unknown, what: string): [number, number] {
  if (!Array.isArray(raw) || !inRange(raw[0], raw[1]))
    return fail(
      `${what} has the position ${shown(raw)}. A position is [longitude, latitude], as numbers in range.`,
    );
  return [raw[0], raw[1]];
}
