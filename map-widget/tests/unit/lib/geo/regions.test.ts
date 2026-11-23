import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLED_INDEX_DATA } from "~/lib/geo/regions/bundled";
import {
  bundledIndex,
  matchBundled,
  matchCountry,
  matchState,
  regionOf,
} from "~/lib/geo/regions/codes";

const vendored = (path: string) =>
  JSON.parse(readFileSync(join(process.cwd(), "vendor/geo", path), "utf8"));

describe("matchState", () => {
  it.each([
    ["CA", "06"],
    ["ca", "06"],
    [" Ca ", "06"],
    ["California", "06"],
    ["CALIFORNIA", "06"],
    ["06", "06"],
    ["6", "06"],
    [6, "06"],
    ["US-CA", "06"],
    ["State of California", "06"],
    ["new york", "36"],
    ["New-York", "36"],
    ["N.Y.", "36"],
    ["DC", "11"],
    ["Washington, D.C.", "11"],
    ["District of Columbia", "11"],
    ["PR", "72"],
    ["Puerto Rico", "72"],
  ])("reads %j as the state %s", (value, code) => {
    expect(matchState(value)?.code).toBe(code);
  });

  it.each([
    ["Californa"],
    ["ZZ"],
    ["99"],
    ["006"],
    [""],
    [null],
    [undefined],
    [{}],
    [6.5],
    [-6],
    ["constructor"],
    ["__proto__"],
    ["toString"],
    ["1 Main Street, Springfield"],
    ["x".repeat(500)],
  ])("reads %j as no state", (value) => {
    expect(matchState(value)).toBeNull();
  });

  it("gives the name, the postal code and a centre in the United States", () => {
    expect(matchState("tx")).toEqual({
      code: "48",
      name: "Texas",
      short: "TX",
      centre: [expect.any(Number), expect.any(Number)],
    });
    const [lon, lat] = matchState("TX")?.centre ?? [0, 0];
    expect(lon).toBeGreaterThan(-107);
    expect(lon).toBeLessThan(-93);
    expect(lat).toBeGreaterThan(25);
    expect(lat).toBeLessThan(37);
  });
});

describe("matchCountry", () => {
  it.each([
    ["US", "840"],
    ["us", "840"],
    ["USA", "840"],
    ["U.S.A.", "840"],
    ["United States", "840"],
    ["United States of America", "840"],
    ["840", "840"],
    [840, "840"],
    ["GB", "826"],
    ["UK", "826"],
    ["United Kingdom", "826"],
    ["Great Britain", "826"],
    ["DE", "276"],
    ["DEU", "276"],
    ["Germany", "276"],
    ["4", "004"],
    [4, "004"],
    ["Côte d'Ivoire", "384"],
    ["Cote d Ivoire", "384"],
    ["Ivory Coast", "384"],
    ["South Korea", "410"],
    ["Korea, Republic of", "410"],
    ["Czech Republic", "203"],
    ["Türkiye", "792"],
    ["Russian Federation", "643"],
    ["Viet Nam", "704"],
    ["Georgia", "268"],
    ["Singapore", "702"],
  ])("reads %j as the country %s", (value, code) => {
    expect(matchCountry(value)?.code).toBe(code);
  });

  it.each([
    ["Atlantis"],
    ["XX"],
    ["XXX"],
    ["999"],
    ["8400"],
    [""],
    [null],
    [{}],
    ["constructor"],
  ])("reads %j as no country", (value) => {
    expect(matchCountry(value)).toBeNull();
  });

  it("has a place for a small country: every country of the index has a point inside it", () => {
    expect(matchCountry("SG")).toMatchObject({ name: "Singapore", code: "702" });
    for (const code of ["SG", "HK", "VA", "MT", "BH", "LI", "XK"])
      expect(matchCountry(code)?.centre, code).toEqual([
        expect.any(Number),
        expect.any(Number),
      ]);
    const without = bundledIndex("countries")
      .ids()
      .filter((id) => regionOf("countries", id)?.centre === null);
    expect(without.map((id) => regionOf("countries", id)?.name)).toEqual(["Gibraltar"]);
  });
});

describe("a name two countries could be read as", () => {
  it("reads Korea alone as the Republic of Korea, as the OECD and the IMF write it, and the North by its own names", () => {
    expect(matchCountry("Korea")?.code).toBe("410");
    expect(matchBundled("countries", "Korea")).toEqual({ id: "410" });
    for (const south of [
      "South Korea",
      "Korea, Republic of",
      "Republic of Korea",
      "KR",
      "KOR",
      410,
    ])
      expect(matchCountry(south)?.code, String(south)).toBe("410");
    for (const north of ["North Korea", "Korea, North", "DPRK", "KP", "PRK", 408])
      expect(matchCountry(north)?.code, String(north)).toBe("408");
    expect(matchCountry("Korea, Dem. People's Rep.")?.code).not.toBe("410");
  });

  it("reads Congo and Guinea alone as the countries of that name, and the others by theirs", () => {
    expect(matchCountry("Congo")?.name).toBe("Republic of the Congo");
    expect(matchCountry("DR Congo")?.code).toBe("180");
    expect(matchCountry("Guinea")?.code).toBe("324");
    expect(matchCountry("Guinea-Bissau")?.code).toBe("624");
    expect(matchCountry("Equatorial Guinea")?.code).toBe("226");
  });
});

describe("the index of a set of the bundle", () => {
  it("is exact after folding and guesses nothing", () => {
    expect(matchBundled("us-states", "Georgia")).toEqual({ id: "13" });
    expect(matchBundled("countries", "Georgia")).toEqual({ id: "268" });
    expect(matchBundled("us-states", "Germany")).toBeNull();
    expect(matchBundled("countries", "  Côte-d'Ivoire ")).toEqual({ id: "384" });
  });

  it("gives an id that matches itself", () => {
    for (const [set, value] of [
      ["us-states", "Texas"],
      ["countries", "France"],
      ["countries", "Kosovo"],
    ] as const) {
      const match = matchBundled(set, value);
      const id = match && "id" in match ? match.id : null;
      expect(id).not.toBeNull();
      expect(matchBundled(set, id)).toEqual({ id });
    }
  });

  it("is the content of the index file of the set, the one every other set has", () => {
    for (const set of ["us-states", "countries"] as const) {
      expect(BUNDLED_INDEX_DATA[set]).toEqual(vendored(`regions/${set}.index.json`));
      expect(bundledIndex(set).size).toBe(BUNDLED_INDEX_DATA[set].regions.length);
      expect(bundledIndex(set)).toBe(bundledIndex(set));
    }
  });

  it("names a region of the bundle by its id, and no region of another set", () => {
    expect(regionOf("us-states", "48")?.name).toBe("Texas");
    expect(regionOf("countries", "250")).toMatchObject({ name: "France", short: "FR" });
    expect(regionOf("us-counties", "06037")).toBeNull();
    expect(regionOf("admin1", "CA-ON")).toBeNull();
    expect(regionOf(undefined, "48")).toBeNull();
    expect(regionOf("us-states", "constructor")).toBeNull();
  });
});

describe("the indexes of the bundle and the boundary files", () => {
  it("has one region for each state shape, under its id and its name", () => {
    const shapes = vendored("us-atlas-3.0.1/states-10m.json").objects.states.geometries;
    expect(bundledIndex("us-states").ids().sort()).toEqual(
      shapes.map((shape: { id: string }) => shape.id).sort(),
    );
    for (const shape of shapes)
      expect(matchState(shape.properties.name)?.code, shape.properties.name).toBe(
        shape.id,
      );
  });

  it("has a region for each country shape of the plain backdrop, and matches the name of the shape", () => {
    const shapes = vendored("world-atlas-2.0.2/countries-110m.json").objects.countries
      .geometries as { id?: string; properties: { name: string } }[];
    for (const shape of shapes.filter((item) => item.id)) {
      expect(
        regionOf("countries", shape.id as string),
        shape.properties.name,
      ).not.toBeNull();
      expect(matchCountry(shape.properties.name)?.code, shape.properties.name).toBe(
        shape.id,
      );
      expect(regionOf("countries", shape.id as string)?.centre).not.toBeNull();
    }
  });

  it("has every centre in range, and a short code for every state", () => {
    for (const set of ["us-states", "countries"] as const)
      for (const id of bundledIndex(set).ids()) {
        const centre = regionOf(set, id)?.centre;
        if (!centre) continue;
        expect(Math.abs(centre[0]), id).toBeLessThanOrEqual(180);
        expect(Math.abs(centre[1]), id).toBeLessThanOrEqual(90);
      }
    const states = bundledIndex("us-states")
      .ids()
      .map((id) => regionOf("us-states", id)?.short);
    expect(new Set(states).size).toBe(states.length);
    expect(states.every((usps) => /^[A-Z]{2}$/.test(usps ?? ""))).toBe(true);
  });
});
