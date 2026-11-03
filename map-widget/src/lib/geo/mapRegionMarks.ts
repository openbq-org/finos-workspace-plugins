import { MAP_LIMITS } from "~/lib/codemode/limits";
import { marked } from "./mapMarks";
import type { MapRegion, MapRegions } from "./mapMarkTypes";
import { count, fail, finite, isPlain, shown, text } from "./mapValues";
import { type MarkBudget, noteCode, weigh } from "./markBudget";
import { bundledIndex } from "./regions/codes";
import {
  isBundledSet,
  isRegionSetId,
  REGION_SET_IDS,
  REGION_SET_WORDS,
} from "./regions/regionTypes";

export function regions(raw: unknown, budget: MarkBudget): MapRegions {
  if (!isPlain(raw) || !Array.isArray(raw.items))
    return fail(
      `"regions" must be { set, items: [{ code, value }, ...] }, where set is one of ${REGION_SET_IDS.join(", ")}. plot.regions returns one.`,
    );
  const set = raw.set;
  if (!isRegionSetId(set))
    return fail(
      `the regions have the set ${shown(set)}. The app ships these boundary sets: ${REGION_SET_IDS.join(", ")}.`,
    );
  budget.regions -= raw.items.length;
  budget.timedRegions ||= raw.items.some(
    (item) => isPlain(item) && item.time !== undefined && item.time !== null,
  );
  if (budget.regions < 0) {
    const most = count(MAP_LIMITS.regions);
    const has = count(MAP_LIMITS.regions - budget.regions);
    return fail(
      budget.timedRegions
        ? `the map has ${has} regions over its steps of time, and a region counts once on each step. A map has at most ${most} over all its steps: draw fewer steps or fewer regions (regions x steps is at most ${most}).`
        : `the map has ${has} regions. A map has at most ${most}: aggregate the rows to one row for each region first (table.groupBy).`,
    );
  }
  const items: MapRegion[] = [];
  const seen = new Set<string>();
  const missed: string[] = [];
  let missedCount = 0;
  const index = isBundledSet(set) ? bundledIndex(set) : null;
  const deferred = index === null;
  raw.items.forEach((item, at) => {
    if (!isPlain(item)) return fail(`region ${at + 1} is not an object.`);
    const match = index?.match(item.code);
    const code = index
      ? match && "id" in match
        ? match.id
        : null
      : (text(item.code, MAP_LIMITS.regionCodeChars) ?? null);
    if (index && code !== null)
      noteCode(budget, item.code, index.get(code)?.name ?? code);
    if (code === null) {
      missedCount++;
      const written = text(item.code, 60) ?? typeof item.code;
      const example =
        index && match && "ambiguous" in match
          ? text(
              `${written} (${match.ambiguous.map((id) => index.get(id)?.name ?? id).join(" or ")}?)`,
              60,
            )
          : written;
      if (missed.length < MAP_LIMITS.unmatchedShown) missed.push(example ?? written);
      return;
    }
    const time = text(item.time, MAP_LIMITS.frameChars);
    const same = deferred ? code.replace(/^0+(?=\d+$)/, "") : code;
    const key = time === undefined ? same : `${same}\n${time}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(weigh(budget, "regions", { code, ...marked(item, budget) }));
  });
  if (raw.items.length > 0 && items.length === 0)
    return fail(
      deferred
        ? `none of the ${count(raw.items.length)} regions has a code.`
        : `none of the ${count(raw.items.length)} regions is a ${REGION_SET_WORDS[set].label} the app knows, for example ${missed.map((code) => JSON.stringify(code)).join(", ")}. In this set ${REGION_SET_WORDS[set].forms}. An address or a city is not a region: shade by a code, or draw points with a latitude and a longitude.`,
    );
  const given = isPlain(raw.within) ? raw.within : {};
  const country = deferred
    ? text(given.country, MAP_LIMITS.regionCodeChars)
    : undefined;
  const state = deferred ? text(given.state, MAP_LIMITS.regionCodeChars) : undefined;
  const within = {
    ...(country === undefined ? {} : { country }),
    ...(state === undefined ? {} : { state }),
  };
  const before = Array.isArray(raw.unmatched)
    ? raw.unmatched.flatMap((code) => text(code, 60) ?? [])
    : [];
  const unmatched = [...before, ...missed].slice(0, MAP_LIMITS.unmatchedShown);
  const unmatchedCount = Math.min(
    MAP_LIMITS.regions,
    (finite(raw.unmatchedCount) && raw.unmatchedCount >= 1
      ? Math.floor(raw.unmatchedCount)
      : before.length) + missedCount,
  );
  return {
    set,
    ...(Object.keys(within).length ? { within } : {}),
    items,
    ...(unmatchedCount > 0 ? { unmatched, unmatchedCount } : {}),
  };
}
