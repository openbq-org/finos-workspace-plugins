import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mapSpec } from "~/lib/geo/mapSpec";
import {
  deferredSets,
  REGION_FACT_LIMITS,
  regionMatchFacts,
} from "~/lib/geo/regionFacts";
import { buildRegionIndex } from "~/lib/geo/regions/regionIndex";
import type { RegionIndexData, RegionSetId } from "~/lib/geo/regions/regionTypes";

const admin1 = buildRegionIndex(
  JSON.parse(
    readFileSync(join(process.cwd(), "vendor/geo/regions/admin1.index.json"), "utf8"),
  ) as RegionIndexData,
);
const loaded = (set: RegionSetId) => (set === "admin1" ? admin1 : null);
const provinces = (codes: unknown[], more: object = {}) =>
  mapSpec({
    regions: {
      set: "admin1",
      ...more,
      items: codes.map((code, at) => ({ code, value: at })),
    },
  });

describe("regionMatchFacts", () => {
  it("says which codes could be several regions, with the regions, and never picks one", () => {
    const spec = provinces([
      "Georgia",
      "Limburg",
      "Punjab",
      "Ontario",
      "Bavaria",
      "Texas",
    ]);
    expect(deferredSets(spec)).toEqual(["admin1"]);
    const facts = regionMatchFacts(spec, loaded);
    expect(facts?.unmatched).toBe(0);
    expect(facts?.ambiguous).toBe(2);
    expect(facts?.ambiguousCodes.map(({ code }) => code)).toEqual([
      "Limburg",
      "Punjab",
    ]);
    const [limburg] = facts?.ambiguousCodes ?? [];
    expect(limburg.candidates.join(" ")).toMatch(/\(BE-VLI\)/);
    expect(limburg.candidates.join(" ")).toMatch(/\(NL-LI\)/);
  });

  it("is null when the country of the rows makes every name one region", () => {
    expect(
      regionMatchFacts(
        provinces(["Limburg", "Utrecht"], { within: { country: "NL" } }),
        loaded,
      ),
    ).toBeNull();
  });

  it("lists a code that matched nothing with the closest names, once for all its steps", () => {
    const spec = mapSpec({
      regions: {
        set: "admin1",
        within: { country: "Canada" },
        items: [
          { code: "Ontaro", value: 1, time: 2024 },
          { code: "Ontaro", value: 2, time: 2025 },
          { code: "Quebec", value: 3, time: 2025 },
        ],
      },
    });
    expect(regionMatchFacts(spec, loaded)).toEqual({
      unmatched: 1,
      unmatchedCodes: ["Ontaro (closest: Ontario)"],
      ambiguous: 0,
      ambiguousCodes: [],
    });
  });

  it("says nothing of a set whose index is not loaded, or of a set the reducer matches", () => {
    expect(regionMatchFacts(provinces(["Limburg"]), () => null)).toBeNull();
    const states = mapSpec({ regions: { set: "us-states", items: [{ code: "CA" }] } });
    expect(deferredSets(states)).toEqual([]);
    expect(regionMatchFacts(states, loaded)).toBeNull();
  });

  it("bounds what it lists and keeps the counts whole", () => {
    const codes = Array.from(
      { length: 9 },
      (_, at) => `${at} Nowhere ${"x".repeat(200)}`,
    );
    const facts = regionMatchFacts(provinces(codes), loaded);
    expect(facts?.unmatched).toBe(9);
    expect(facts?.unmatchedCodes).toHaveLength(REGION_FACT_LIMITS.codes);
    for (const code of facts?.unmatchedCodes ?? [])
      expect(code.length).toBeLessThanOrEqual(REGION_FACT_LIMITS.chars);
  });
});
