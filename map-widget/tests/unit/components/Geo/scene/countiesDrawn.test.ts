import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { mapNote } from "~/components/Geo/mapWords";
import { registrySource } from "~/components/Geo/useMapData";
import { makeMap } from "~/lib/geo/mapSpec";
import { registerRegionIndex } from "~/lib/geo/regions/registry";
import { regionShapesOfBoundaries } from "~/lib/geo/regions/shapes";
import { counties, scene, sets } from "./support";

beforeAll(() => {
  registerRegionIndex(
    JSON.parse(
      readFileSync(
        join(process.cwd(), "vendor/geo/regions/us-counties.index.json"),
        "utf8",
      ),
    ),
  );
});

const drawn = (items: object[], within?: object) => {
  const { shapeOf, info, resolve } = registrySource(
    "us-counties",
    [regionShapesOfBoundaries(counties)],
    true,
  );
  const spec = makeMap({
    regions: { set: "us-counties", items, ...(within ? { within } : {}) },
  });
  const built = scene(spec, {
    sets: { ...sets, "us-counties": { ...counties, shapeOf, info, resolve } },
  });
  return { spec, built, keys: built.marks.map((mark) => mark.key) };
};

describe("a county map", () => {
  it("draws the county a name with its state means, and the city when the name says city", () => {
    const { keys, built } = drawn([
      { code: "Richmond County, VA", value: 1 },
      { code: "Richmond city, VA", value: 2 },
      { code: "Baltimore County, MD", value: 3 },
      { code: "Baltimore city, MD", value: 4 },
      { code: "St. Louis County, MO", value: 5 },
      { code: "St. Louis city, MO", value: 6 },
      { code: "Fairfax County, VA", value: 7 },
      { code: "Franklin city, VA", value: 8 },
      { code: "Roanoke County, VA", value: 9 },
      { code: 6037, value: 10 },
      { code: "17:cook", value: 11 },
    ]);
    expect(keys).toEqual([
      "r:51159",
      "r:51760",
      "r:24005",
      "r:24510",
      "r:29189",
      "r:29510",
      "r:51059",
      "r:51620",
      "r:51161",
      "r:06037",
      "r:17031",
    ]);
    expect(built.unshaped).toEqual([]);
    expect(built.ambiguous).toEqual([]);
  });

  it("draws a county once however often the data writes it: by its code, its number or its name", () => {
    const { keys, built, spec } = drawn([
      { code: "06037", value: 1 },
      { code: 6037, value: 2 },
      { code: "Los Angeles County, CA", value: 3 },
      { code: "Cook County, IL", value: 4 },
    ]);
    expect(keys).toEqual(["r:06037", "r:17031"]);
    expect(built.marks.map((mark) => mark.value)).toEqual([1, 4]);
    expect(built.layers[0].count).toBe(2);
    expect(spec.regions?.items.map((item) => item.code)).toEqual([
      "06037",
      "Los Angeles County, CA",
      "Cook County, IL",
    ]);
  });

  it("draws a county on each of its steps, and once on a step", () => {
    const { built, spec } = drawn([
      { code: "06037", value: 1, time: "2023" },
      { code: 6037, value: 2, time: "2024" },
      { code: "Los Angeles County, CA", value: 3, time: "2024" },
      { code: "6037", value: 4, time: "2023" },
    ]);
    expect(spec.regions?.items.map((item) => [item.code, item.time])).toEqual([
      ["06037", "2023"],
      ["6037", "2024"],
      ["Los Angeles County, CA", "2024"],
    ]);
    expect(built.marks.map((mark) => [mark.key, mark.time, mark.value])).toEqual([
      ["r:06037", "2023", 1],
      ["r:06037", "2024", 2],
    ]);
  });

  it("draws neither of two regions a name could be, and says which they are", () => {
    const { keys, built, spec } = drawn([
      { code: "Baltimore, MD", value: 1 },
      { code: "St. Louis, MO", value: 2 },
      { code: "Cook County, IL", value: 3 },
    ]);
    expect(keys).toEqual(["r:17031"]);
    expect(built.ambiguous).toEqual([
      {
        set: "us-counties",
        code: "Baltimore, MD",
        candidates: ["Baltimore county, MD (24005)", "Baltimore city, MD (24510)"],
      },
      {
        set: "us-counties",
        code: "St. Louis, MO",
        candidates: ["St. Louis county, MO (29189)", "St. Louis city, MO (29510)"],
      },
    ]);
    const note = mapNote(spec, built) ?? "";
    expect(note).toMatch(
      /Baltimore, MD: Baltimore county, MD \(24005\) or Baltimore city, MD \(24510\)/,
    );
    expect(note).toMatch(/Write "County" or "city" after the name/);
    expect(note).not.toMatch(/country/);
  });

  it("counts a code and a name that are no county, and says which", () => {
    const { keys, built, spec } = drawn([
      { code: "06037", value: 1 },
      { code: "06999", value: 2 },
      { code: "99001", value: 3 },
      { code: "Atlantis County, CA", value: 4 },
    ]);
    expect(keys).toEqual(["r:06037"]);
    expect(built.unshaped).toEqual(["06999", "99001", "Atlantis County, CA"]);
    expect(mapNote(spec, built)).toMatch(
      /3 regions are not on the map: 06999, 99001, Atlantis County, CA/,
    );
  });

  it("reads a name alone in the state all the rows are in", () => {
    expect(drawn([{ code: "Cook" }], { state: "IL" }).keys).toEqual(["r:17031"]);
    expect(drawn([{ code: "Cook" }]).built.ambiguous).toHaveLength(1);
  });
});
