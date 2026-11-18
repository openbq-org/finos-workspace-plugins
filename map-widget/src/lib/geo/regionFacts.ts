import { mapLayers } from "./mapLayers";
import { isDeferredSet } from "./mapMarkTypes";
import type { MapSpec } from "./mapSpecTypes";
import { regionOf } from "./regions/codes";
import { countyKind } from "./regions/regionKeys";
import type { RegionIndex, RegionSetId } from "./regions/regionTypes";

export interface RegionMatchFacts {
  unmatched: number;
  unmatchedCodes: string[];
  ambiguous: number;
  ambiguousCodes: { code: string; candidates: string[] }[];
}

export const REGION_FACT_LIMITS = { codes: 5, candidates: 4, chars: 120 } as const;

type Matcher = Pick<RegionIndex, "match" | "explain" | "get">;

export function deferredSets(spec: MapSpec): RegionSetId[] {
  const sets = new Set<RegionSetId>();
  for (const layer of mapLayers(spec)) {
    const regions =
      layer.kind === "regions" || layer.kind === "columns" ? layer.regions : undefined;
    if (regions && isDeferredSet(regions.set)) sets.add(regions.set);
  }
  return [...sets];
}

const clip = (text: string) => text.slice(0, REGION_FACT_LIMITS.chars);

export function regionCandidate(set: string, name: string, id: string): string {
  if (set !== "us-counties") return `${name} (${id})`;
  const state = regionOf("us-states", id.slice(0, 2))?.short;
  return `${name} ${countyKind(id)}${state ? `, ${state}` : ""} (${id})`;
}

const candidate = (set: RegionSetId, index: Matcher, id: string): string =>
  regionCandidate(set, index.get(id)?.name ?? id, id);

export function regionMatchFacts(
  spec: MapSpec,
  indexOf: (set: RegionSetId) => Matcher | null,
): RegionMatchFacts | null {
  const facts: RegionMatchFacts = {
    unmatched: 0,
    unmatchedCodes: [],
    ambiguous: 0,
    ambiguousCodes: [],
  };
  for (const layer of mapLayers(spec)) {
    const regions =
      layer.kind === "regions" || layer.kind === "columns" ? layer.regions : undefined;
    if (!regions || !isDeferredSet(regions.set)) continue;
    const index = indexOf(regions.set);
    if (!index) continue;
    const seen = new Set<string>();
    for (const { code } of regions.items) {
      if (seen.has(code)) continue;
      seen.add(code);
      const match = index.match(code, regions.within);
      if (match && "id" in match) continue;
      if (match && "ambiguous" in match) {
        facts.ambiguous++;
        if (facts.ambiguousCodes.length < REGION_FACT_LIMITS.codes)
          facts.ambiguousCodes.push({
            code: clip(code),
            candidates: match.ambiguous
              .slice(0, REGION_FACT_LIMITS.candidates)
              .map((id) => clip(candidate(regions.set, index, id))),
          });
        continue;
      }
      facts.unmatched++;
      if (facts.unmatchedCodes.length < REGION_FACT_LIMITS.codes) {
        const near = index
          .explain(code, regions.within)
          .candidates.slice(0, 2)
          .map(({ name }) => name);
        facts.unmatchedCodes.push(
          clip(near.length ? `${code} (closest: ${near.join(", ")})` : code),
        );
      }
    }
  }
  return facts.unmatched || facts.ambiguous ? facts : null;
}
