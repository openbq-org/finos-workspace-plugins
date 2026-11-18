import { matchCountry, matchState } from "./codes";
import { nameKey, written } from "./fold";
import { keysOf, SINGLE_PART } from "./regionKeys";
import { given, reader } from "./regionReader";
import {
  isRegionSetId,
  type MatchOptions,
  type RegionExplanation,
  type RegionIndex,
  type RegionIndexData,
  type RegionMatch,
} from "./regionTypes";

function distance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    let least = i;
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(
        row[j] + 1,
        next[j - 1] + 1,
        row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      least = Math.min(least, next[j]);
    }
    if (least > limit) return limit + 1;
    row = next;
  }
  return row[b.length];
}

const NEAR_MISSES = 5;

export function buildRegionIndex(data: RegionIndexData): RegionIndex {
  if (!isRegionSetId(data.set)) throw new Error(`"${data.set}" is not a boundary set.`);
  const set = data.set;
  const keys = keysOf(set, data);
  const read = reader(set, keys);
  const outside = new Set(data.outsideContiguous ?? []);
  const match = (value: unknown, options: MatchOptions = {}): RegionMatch => {
    const text = written(value);
    return text === null ? null : read(text, options);
  };

  const explain = (value: unknown, options: MatchOptions = {}): RegionExplanation => {
    const titled = (ids: string[]) =>
      ids.map((id) => ({ id, name: keys.infos.get(id)?.name ?? id }));
    const found = match(value, options);
    if (found)
      return "ambiguous" in found
        ? { reason: "ambiguous", candidates: titled(found.ambiguous) }
        : { reason: "matched", candidates: titled([found.id]) };
    const text = written(value);
    const key = text === null ? "" : nameKey(text);
    if (key.length < 3) return { reason: "unmatched", candidates: [] };
    const scope =
      set === "admin1"
        ? given(options.country, matchCountry)?.short
        : set === "us-counties"
          ? given(options.state, matchState)?.code
          : undefined;
    const limit = key.length < 6 ? 1 : 2;
    const near = new Map<string, number>();
    for (const [other, entries] of keys.names) {
      const inside = other.length >= 3 && (other.includes(key) || key.includes(other));
      const far = inside ? 0.5 : distance(key, other, limit);
      if (far > limit) continue;
      for (const entry of entries)
        if (scope === undefined || entry.scope === scope)
          near.set(
            entry.id,
            Math.min(near.get(entry.id) ?? 9, far + (entry.own ? 0 : 0.25)),
          );
    }
    const closest = [...near]
      .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, NEAR_MISSES)
      .map(([id]) => id);
    return { reason: "unmatched", candidates: titled(closest) };
  };

  return {
    set,
    source: data.source,
    size: keys.infos.size,
    bounds: data.bounds,
    contiguousBounds: data.contiguousBounds ?? null,
    parts: data.parts ?? [{ id: SINGLE_PART, label: data.set, bounds: data.bounds }],
    ids: () => [...keys.infos.keys()],
    get: (id) => keys.infos.get(id) ?? null,
    match,
    explain,
    outsideContiguous: (id) => outside.has(id),
  };
}
