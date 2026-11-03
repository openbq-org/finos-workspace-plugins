import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  REGION_SET_IDS,
  REGION_SET_WORDS,
  type RegionIndexData,
} from "~/lib/geo/regions/regionTypes";

type Registry = typeof import("~/lib/geo/regions/registry");
let loadedRegionIndex: Registry["loadedRegionIndex"];
let matchRegion: Registry["matchRegion"];
let partsOf: Registry["partsOf"];
let regionInfo: Registry["regionInfo"];
let registerRegionIndex: Registry["registerRegionIndex"];

const VENDOR = join(process.cwd(), "vendor/geo/regions");
const data = (set: string) =>
  JSON.parse(
    readFileSync(join(VENDOR, `${set}.index.json`), "utf8"),
  ) as RegionIndexData;

describe("the registry of boundary sets", () => {
  beforeEach(async () => {
    vi.resetModules();
    ({ loadedRegionIndex, matchRegion, partsOf, regionInfo, registerRegionIndex } =
      await import("~/lib/geo/regions/registry"));
  });

  it("has words and an index file for every set", () => {
    expect(Object.keys(REGION_SET_WORDS)).toEqual([...REGION_SET_IDS]);
    for (const set of REGION_SET_IDS) {
      expect(REGION_SET_WORDS[set].label).not.toBe("");
      expect(REGION_SET_WORDS[set].forms).toContain('"');
      expect(existsSync(join(VENDOR, `${set}.index.json`)), set).toBe(true);
    }
  });

  it("has the index of the states and of the countries from the start: they are in the bundle", () => {
    expect(loadedRegionIndex("us-states")?.size).toBe(56);
    expect(loadedRegionIndex("countries")?.size).toBe(240);
    expect(matchRegion("us-states", "N.Y.")).toEqual({ id: "36" });
    expect(registerRegionIndex(data("countries"))).toBe(loadedRegionIndex("countries"));
  });

  it("refuses to match before the index of a set is loaded", () => {
    expect(loadedRegionIndex("us-cbsa")).toBeNull();
    expect(() => matchRegion("us-cbsa", "New York")).toThrow(/not loaded/);
    expect(() => regionInfo("us-cbsa", "35620")).toThrow(/loadRegionIndex/);
  });

  it("matches, explains and places a region once the index is there", () => {
    for (const set of REGION_SET_IDS) registerRegionIndex(data(set));
    expect(loadedRegionIndex("us-cbsa")?.size).toBe(935);
    expect(matchRegion("us-cbsa", "New York")).toEqual({ id: "35620" });
    expect(matchRegion("admin1", "Ontario", { country: "Canada" })).toEqual({
      id: "CA-ON",
    });
    expect(matchRegion("admin1", "Limburg")).toEqual({
      ambiguous: ["BE-VLI", "NL-LI"],
    });
    expect(matchRegion("us-counties", "Cook", { state: "IL" })).toEqual({
      id: "17031",
    });
    expect(matchRegion("countries", "Atlantis")).toBeNull();
    expect(loadedRegionIndex("admin1")?.explain("Limburg").reason).toBe("ambiguous");
    expect(regionInfo("us-cd119", "CA-12")?.name).toBe("California district 12");
    const [lon, lat] = regionInfo("admin1", "DE-BY")?.centroid ?? [0, 0];
    expect(lon).toBeGreaterThan(9);
    expect(lon).toBeLessThan(14);
    expect(lat).toBeGreaterThan(47);
    expect(lat).toBeLessThan(51);
    expect(regionInfo("countries", "250")?.bounds?.[0]).toBeLessThan(-60);
    expect(regionInfo("countries", "250")?.viewBounds?.[0]).toBeGreaterThan(-6);
    expect(regionInfo("countries", "292")?.centroid).toBeNull();
    expect(regionInfo("countries", "no such id")).toBeNull();
  });

  it("names the shape files that hold the regions of a map", () => {
    for (const set of REGION_SET_IDS) registerRegionIndex(data(set));
    expect(partsOf("admin1", ["DE-BY", "FR-IDF"])).toEqual(["europe"]);
    expect(partsOf("admin1", ["DE-BY", "US-CA", "JP-13"]).sort()).toEqual([
      "asia",
      "europe",
      "north-america",
    ]);
    expect(partsOf("us-states", ["06", "36"])).toEqual(["all"]);
    expect(partsOf("countries", ["292"])).toEqual([]);
    expect(partsOf("admin1", ["no such id"])).toEqual([]);
  });
});
