import { describe, expect, it } from "vitest";
import { MAP_LIMITS } from "~/lib/codemode/limits";
import { BOUNDARY_CITIES, boundaryParts } from "~/lib/geo/boundaryShapes";
import {
  boundaryCredits,
  boundaryIds,
  MAP_BOUNDARIES,
  MAP_BOUNDARY_IDS,
} from "~/lib/geo/mapBoundaries";
import type { RegionIndex } from "~/lib/geo/regions/regionTypes";
import { REGION_SET_IDS } from "~/lib/geo/regions/regionTypes";

describe("the boundary layers of a map", () => {
  it("are the six boundary sets the app ships, and its cities", () => {
    expect(MAP_BOUNDARY_IDS).toEqual([
      "countries",
      "admin1",
      "us-states",
      "us-counties",
      "us-cbsa",
      "us-cd119",
      "cities",
    ]);
    const sets = MAP_BOUNDARIES.flatMap((layer) => ("set" in layer ? [layer.set] : []));
    expect([...sets].sort()).toEqual([...REGION_SET_IDS].sort());
  });

  it("keep of a stored list only ids of the list, and never throw", () => {
    expect(boundaryIds(["cities", "nope", "us-states", "us-states"])).toEqual([
      "us-states",
      "cities",
    ]);
    for (const raw of [undefined, null, "cities", {}, 3])
      expect(boundaryIds(raw)).toEqual([]);
  });

  it("ask for the credit of the cities while the cities are on, and for none otherwise", () => {
    expect(boundaryCredits(["us-states", "countries"])).toEqual([]);
    expect(boundaryCredits(["us-states", "cities"])).toEqual(["geonames"]);
  });

  it("hold fewer cities than a map has points for", () => {
    expect(BOUNDARY_CITIES).toBeLessThan(MAP_LIMITS.points);
  });
});

const indexOf = (parts: Record<string, { bounds: number[]; size: number }>) => {
  const regions = Object.entries(parts).flatMap(([part, { size }]) =>
    Array.from({ length: size }, (_, at) => ({ id: `${part}-${at}`, part })),
  );
  return {
    size: regions.length,
    parts: Object.entries(parts).map(([id, { bounds }]) => ({ id, label: id, bounds })),
    ids: () => regions.map((region) => region.id),
    get: (id: string) => regions.find((region) => region.id === id) ?? null,
  } as unknown as RegionIndex;
};

describe("the files of a boundary set a view draws", () => {
  it("are every file of a set that fits a map whole", () => {
    const index = indexOf({ all: { bounds: [-180, -90, 180, 90], size: 3_231 } });
    expect(boundaryParts(index, [0, 0, 1, 1])).toEqual(["all"]);
  });

  const WORLD = indexOf({
    europe: { bounds: [-25, 34, 45, 72], size: 1_600 },
    africa: { bounds: [-18, -35, 52, 38], size: 800 },
    asia: { bounds: [25, -11, 180, 78], size: 1_400 },
    americas: { bounds: [-170, -56, -34, 72], size: 568 },
  });

  it("are the files that meet the view, for a set of more regions than a map draws", () => {
    expect(WORLD.size).toBeGreaterThan(MAP_LIMITS.shapes);
    expect(boundaryParts(WORLD, [-10, 40, 20, 55])).toEqual(["europe"]);
    expect(boundaryParts(WORLD, [-120, 20, -70, 50])).toEqual(["americas"]);
  });

  it("stop at the areas a map draws, the file nearest the middle of the view first", () => {
    const taken = boundaryParts(WORLD, null);
    const drawn = taken.reduce(
      (sum, part) => sum + WORLD.ids().filter((id) => id.startsWith(part)).length,
      0,
    );
    expect(drawn).toBeLessThanOrEqual(MAP_LIMITS.shapes);
    expect(taken.length).toBeGreaterThan(0);
    expect(taken.length).toBeLessThan(4);
    expect(boundaryParts(WORLD, null)).toEqual(taken);
  });

  it("are one file at least, also when that one alone is more than a map draws", () => {
    const big = indexOf({
      a: { bounds: [0, 0, 10, 10], size: 4_000 },
      b: { bounds: [20, 0, 30, 10], size: 400 },
    });
    expect(boundaryParts(big, [1, 1, 2, 2])).toEqual(["a"]);
  });
});
