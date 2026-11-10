import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Topology } from "topojson-specification";
import { beforeAll, describe, expect, it } from "vitest";
import { makeMap, mapSpec } from "~/lib/geo/mapSpec";
import { regionMatchFacts } from "~/lib/geo/regionFacts";
import { boundariesOf } from "~/lib/geo/regions/boundaries";
import {
  loadedRegionIndex,
  matchRegion,
  registerRegionIndex,
} from "~/lib/geo/regions/registry";

const vendored = <T>(path: string) =>
  JSON.parse(readFileSync(join(process.cwd(), "vendor/geo", path), "utf8")) as T;

const shapes = boundariesOf(
  "us-counties",
  vendored<Topology>("us-atlas-3.0.1/counties-10m.json"),
);

beforeAll(() => {
  registerRegionIndex(vendored("regions/us-counties.index.json"));
});

const PAIRS = [
  ["Baltimore", "MD", "24005", "24510"],
  ["St. Louis", "MO", "29189", "29510"],
  ["Fairfax", "VA", "51059", "51600"],
  ["Franklin", "VA", "51067", "51620"],
  ["Richmond", "VA", "51159", "51760"],
  ["Roanoke", "VA", "51161", "51770"],
] as const;

describe("a county and an independent city of one name in one state", () => {
  it.each(PAIRS)(
    "%s, %s: the county, the city, and never one of them for the name alone",
    (name, state, county, city) => {
      expect(matchRegion("us-counties", `${name} County, ${state}`)).toEqual({
        id: county,
      });
      expect(matchRegion("us-counties", `${name} county`, { state })).toEqual({
        id: county,
      });
      expect(matchRegion("us-counties", `${name} city, ${state}`)).toEqual({
        id: city,
      });
      expect(matchRegion("us-counties", `${name} City, ${state}`)).toEqual({
        id: city,
      });
      expect(matchRegion("us-counties", `${name}, ${state}`)).toEqual({
        ambiguous: [county, city],
      });
      expect(shapes.shapeOf(county)?.properties.code).toBe(county);
      expect(shapes.shapeOf(city)?.properties.code).toBe(city);
      expect(shapes.shapeOf(county)?.properties.name).toBe(
        shapes.shapeOf(city)?.properties.name,
      );
    },
  );

  it("the boundary file answers to a code only: a name is matched by the index", () => {
    expect(shapes.shapeOf("51:richmond")).toBeUndefined();
    expect(shapes.shapeOf("Richmond")).toBeUndefined();
    expect(shapes.shapeOf("17031")?.properties.name).toBe("Cook");
  });

  it("reads the key a map stored before held for a name: the state and the name", () => {
    expect(matchRegion("us-counties", "17:cook")).toEqual({ id: "17031" });
    expect(matchRegion("us-counties", "22:orleans")).toEqual({ id: "22071" });
    expect(matchRegion("us-counties", "24:prince george s")).toEqual({ id: "24033" });
    expect(matchRegion("us-counties", "51:richmond")).toEqual({
      ambiguous: ["51159", "51760"],
    });
    expect(matchRegion("us-counties", "99:cook")).toBeNull();
    expect(matchRegion("us-counties", "17:atlantis")).toBeNull();
  });
});

describe("codes of counties that are no longer in use", () => {
  it.each([
    ["02270", "Wade Hampton Census Area, AK", "02158", "Kusilvak"],
    ["46113", "Shannon County, SD", "46102", "Oglala Lakota"],
    ["12025", "Dade County, FL", "12086", "Miami-Dade"],
  ])(
    "reads %s and %s as the county that was only renamed: %s",
    (code, name, now, title) => {
      expect(matchRegion("us-counties", code)).toEqual({ id: now });
      expect(matchRegion("us-counties", Number(code))).toEqual({ id: now });
      expect(matchRegion("us-counties", name)).toEqual({ id: now });
      expect(loadedRegionIndex("us-counties")?.get(now)?.name).toBe(title);
      expect(shapes.shapeOf(now)).toBeDefined();
    },
  );

  it.each([["51515"], ["51560"], ["02232"], ["30113"], ["02063"], ["02066"]])(
    "reads %s as no county: it has no one successor, so the map says it is not drawn",
    (code) => {
      expect(matchRegion("us-counties", code)).toBeNull();
    },
  );

  it("reads the eight counties of Connecticut the shapes have, and none of the nine planning regions of 2022", () => {
    for (const code of [
      "09001",
      "09003",
      "09005",
      "09007",
      "09009",
      "09011",
      "09013",
      "09015",
    ])
      expect(matchRegion("us-counties", code), code).toEqual({ id: code });
    for (const code of [
      "09110",
      "09120",
      "09130",
      "09140",
      "09150",
      "09160",
      "09170",
      "09180",
      "09190",
    ])
      expect(matchRegion("us-counties", code), code).toBeNull();
    expect(matchRegion("us-counties", "Fairfield County, CT")).toEqual({ id: "09001" });
    expect(matchRegion("us-counties", "Capitol Planning Region, CT")).toBeNull();
  });

  it("keeps Dade County of Georgia what it is", () => {
    expect(matchRegion("us-counties", "Dade County, GA")).toEqual({ id: "13083" });
    expect(matchRegion("us-counties", "Dade County")).toEqual({
      ambiguous: ["13083", "29057"],
    });
  });
});

describe("counties in the reducer of a map", () => {
  const counties = (items: object[], more: object = {}) => ({
    regions: { set: "us-counties", items, ...more },
  });

  it("keeps the code of a county as the data wrote it: the index matches it when the map is drawn", () => {
    const made = makeMap(
      counties([
        { code: "Richmond County, VA", value: 1 },
        { code: 6037, value: 2 },
        { code: "06999", value: 3 },
        { code: "Baltimore, MD", value: 4 },
      ]),
    );
    expect(made.regions?.items.map((item) => item.code)).toEqual([
      "Richmond County, VA",
      "6037",
      "06999",
      "Baltimore, MD",
    ]);
    expect(made.regions).not.toHaveProperty("unmatched");
    expect(mapSpec(made)).toEqual(made);
  });

  it("keeps the state all the counties are in", () => {
    expect(
      makeMap(counties([{ code: "Cook" }], { within: { state: "IL" } })).regions,
    ).toEqual({
      set: "us-counties",
      within: { state: "IL" },
      items: [{ code: "Cook" }],
    });
  });

  it("counts and reports what is no county and what could be two, for the reply of a run", () => {
    const made = makeMap(
      counties([
        { code: "Richmond County, VA" },
        { code: "06037" },
        { code: "06999" },
        { code: "99001" },
        { code: "Atlantis County, CA" },
        { code: "Baltimore, MD" },
        { code: "St. Louis, MO" },
      ]),
    );
    expect(regionMatchFacts(made, loadedRegionIndex)).toEqual({
      unmatched: 3,
      unmatchedCodes: ["06999", "99001", "Atlantis County, CA"],
      ambiguous: 2,
      ambiguousCodes: [
        {
          code: "Baltimore, MD",
          candidates: ["Baltimore county, MD (24005)", "Baltimore city, MD (24510)"],
        },
        {
          code: "St. Louis, MO",
          candidates: ["St. Louis county, MO (29189)", "St. Louis city, MO (29510)"],
        },
      ],
    });
  });
});
