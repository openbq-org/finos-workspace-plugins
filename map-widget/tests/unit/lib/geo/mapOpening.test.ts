import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MAP_LIMITS } from "~/lib/codemode/limits";
import {
  boxZoom,
  COUNTRY_PARTS,
  cityRadiusKm,
  mapOpening,
  NO_OUTLINE,
  PLACE_AREAS,
  PLACE_KINDS,
  PLACE_NAMES,
  type PlaceSources,
  resolvePlace,
  viewLimit,
  ZIP_RADIUS_KM,
} from "~/lib/geo/mapOpening";
import "~/lib/geo/mapPlaceSets";
import { makeMap, mapSpec } from "~/lib/geo/mapSpec";
import type { PlaceFile } from "~/lib/geo/placeFiles";
import { loadedCities, registerCities } from "~/lib/geo/regions/cities";
import { loadedRegionIndex, registerRegionIndex } from "~/lib/geo/regions/registry";
import { loadedZips, registerZips } from "~/lib/geo/regions/zips";

const POINT = { lat: 41.88, lon: -87.63 };
const vendor = (path: string) =>
  JSON.parse(readFileSync(join(process.cwd(), "vendor/geo", path), "utf8"));
const cities = () => registerCities(vendor("places/cities.json"));

beforeAll(() => {
  cities();
  for (const set of ["admin1", "us-cbsa", "us-counties"])
    registerRegionIndex(vendor(`regions/${set}.index.json`));
});

async function pageWith({ cities, sets }: { cities: boolean; sets: string[] }) {
  vi.resetModules();
  await import("~/lib/geo/mapPlaceSets");
  const [spec, page, registry] = await Promise.all([
    import("~/lib/geo/mapSpec"),
    import("~/lib/geo/regions/cities"),
    import("~/lib/geo/regions/registry"),
  ]);
  if (cities) page.registerCities(vendor("places/cities.json"));
  for (const set of sets)
    registry.registerRegionIndex(vendor(`regions/${set}.index.json`));
  return spec;
}

const boxOf = (name: string) => {
  const answer = resolvePlace(name);
  return answer && "bounds" in answer ? answer.bounds : null;
};
const couldBe = (name: string) => {
  const answer = resolvePlace(name);
  return answer && "ambiguous" in answer ? answer.ambiguous : null;
};
const middle = (name: string) => {
  const box = boxOf(name);
  return box ? [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2] : null;
};
const width = (name: string) => {
  const box = boxOf(name);
  return box ? box[2] - box[0] : null;
};

describe("where a map opens when it says so", () => {
  it("is the box of a state or of a country", () => {
    const texas = mapOpening({ place: "Texas" })?.bounds;
    expect(texas?.[0]).toBeLessThan(-104);
    expect(texas?.[2]).toBeGreaterThan(-95);
    expect(mapOpening({ place: "TX" })?.bounds).toEqual(texas);
    expect(mapOpening({ place: "France" })?.bounds?.[3]).toBeGreaterThan(48);
    expect(mapOpening({ place: "Texas" })?.place).toBe("Texas");
  });

  it("is a box around the middle of a city, wider the more residents it has", () => {
    const [lon, lat] = middle("Chicago") as number[];
    expect(lon).toBeCloseTo(-87.65, 1);
    expect(lat).toBeCloseTo(41.85, 1);
    expect(width("Chicago")).toBeCloseTo(0.51, 1);
    expect(width("London") as number).toBeGreaterThan(width("Chicago") as number);
    expect(
      [25_000, 700_000, 2_664_000, 8_962_000, 40_000_000].map(cityRadiusKm),
    ).toEqual([4, 13, 21, 32, 45]);
    expect(mapOpening({ place: "Chicago" })?.zoom).toBeUndefined();
  });

  it("is a state or province of any country, by its name or its ISO 3166-2 code", () => {
    const bavaria = boxOf("Bavaria");
    expect(bavaria?.[0]).toBeGreaterThan(8);
    expect(bavaria?.[3]).toBeLessThan(51);
    expect(boxOf("DE-BY")).toEqual(bavaria);
    expect(boxOf("CA-ON")?.[1]).toBeGreaterThan(41);
    expect(boxOf("Catalonia")).not.toBeNull();
  });

  it("is a US metro area or a county, when no larger place has the name", () => {
    const metro = boxOf("Chicago-Naperville-Elgin, IL-IN") as number[];
    expect(metro[2] - metro[0]).toBeGreaterThan(width("Chicago") as number);
    const cook = boxOf("Cook County, IL") as number[];
    expect(cook[0]).toBeCloseTo(-88.26, 1);
    expect(boxOf("Harris County, TX")).not.toBeNull();
  });

  it("takes the first kind of place that knows the name: a country is that country", () => {
    expect(boxOf("Mexico")?.[0]).toBeLessThan(-110);
    expect(width("New York") as number).toBeGreaterThan(5);
    expect(width("Washington") as number).toBeGreaterThan(5);
    expect(width("New York, NY") as number).toBeLessThan(2);
    expect(width("Washington, DC") as number).toBeLessThan(1);
  });

  it("takes the larger of two places of one name where one is inside the other", () => {
    expect(width("London") as number).toBeGreaterThan(0.5);
    expect(width("Quebec") as number).toBeGreaterThan(10);
    expect(couldBe("London")).toBeNull();
  });

  it("never guesses between two places apart: it says what the name could be, as the next call writes each", () => {
    expect(couldBe("Georgia")).toEqual([
      'the US state Georgia ("US-GA")',
      'the country Georgia ("GE")',
    ]);
    expect(boxOf("US-GA")?.[0]).toBeLessThan(-80);
    expect(boxOf("GE")?.[0]).toBeGreaterThan(39);
    expect(couldBe("Ontario")).toEqual([
      'Ontario, a state or province ("CA-ON")',
      'the city "Ontario, CA"',
    ]);
    expect(width("Ontario, CA") as number).toBeLessThan(1);
    expect(couldBe("Springfield")).toEqual([
      'the city "Springfield, MO"',
      'the city "Springfield, MA"',
      'the city "Springfield, IL"',
    ]);
    expect(couldBe("Punjab")).toHaveLength(2);
    expect(couldBe("Cook County")?.[0]).toMatch(/^Cook county \("FIPS \d{5}"\)$/);
  });

  it("knows no street, neighbourhood or building", () => {
    for (const name of [
      "Wall Street",
      "Wicker Park",
      "278 Wacker Exchange",
      "Bay Area",
    ])
      expect(resolvePlace(name)).toBeNull();
  });

  it("reads a name that every object has a member for as a name no list knows", () => {
    for (const name of [
      "constructor",
      "Constructor",
      "toString",
      "__proto__",
      "valueOf",
    ])
      expect(resolvePlace(name), name).toBeNull();
  });

  it("opens the map on its data when the place is not resolved, and the map says why", () => {
    const street = makeMap({
      points: [POINT],
      view: { place: "Wall Street", zoom: 16 },
    });
    expect(street.view).toEqual({ place: "Wall Street" });
    expect(street.notes).toEqual([
      `No place is called "Wall Street" here: the map opens on its data. ${PLACE_KINDS}`,
    ]);
    const georgia = makeMap({ points: [POINT], view: { place: "Georgia" } });
    expect(georgia.view).toEqual({ place: "Georgia" });
    expect(georgia.notes?.[0]).toBe(
      '"Georgia" could be the US state Georgia ("US-GA") or the country Georgia ("GE"): the map opens on its data. Write the one that is meant.',
    );
    const long = makeMap({
      points: [POINT],
      view: { place: "The corner of West Wacker Drive and North LaSalle Street" },
    });
    expect(long.notes?.[0]).toMatch(/give \{ center: \[lon, lat\], zoom \}\.$/);
    expect(
      makeMap({ points: [POINT], view: { place: "Springfield" } }).notes?.[0],
    ).toMatch(/Write the one that is meant\.$/);
    expect(mapSpec(street)).toEqual(street);
    expect(mapSpec(georgia)).toEqual(georgia);
    for (const note of [...(street.notes ?? []), ...(georgia.notes ?? [])])
      expect(note.length).toBeLessThanOrEqual(MAP_LIMITS.mapNoteChars);
  });

  describe("while a list of places is not loaded", () => {
    const citiesOnly: PlaceSources = { cities: loadedCities, index: () => null };

    it("never takes the town for the province: the name is not looked up", () => {
      for (const name of ["Ontario", "Yukon", "Santa Cruz"]) {
        expect(resolvePlace(name), name).toHaveProperty("ambiguous");
        expect(resolvePlace(name, citiesOnly), name).toEqual({ notLoaded: ["admin1"] });
      }
      expect(resolvePlace("Chicago", citiesOnly)).toEqual({ notLoaded: ["admin1"] });
      expect(
        resolvePlace("Bavaria", { cities: () => null, index: loadedRegionIndex }),
      ).toEqual({ notLoaded: ["cities"] });
      expect(
        resolvePlace("Bavaria", { cities: () => null, index: () => null }),
      ).toEqual({
        notLoaded: ["admin1", "cities"],
      });
    });

    it("still knows a US state and a country, which need no list", () => {
      const none: PlaceSources = { cities: () => null, index: () => null };
      expect(resolvePlace("Texas", none)).toHaveProperty("bounds");
      expect(resolvePlace("France", none)).toHaveProperty("bounds");
      expect(resolvePlace("Georgia", none)).toHaveProperty("ambiguous");
    });

    it("asks no later step while an earlier one is not loaded", () => {
      const withoutMetros: PlaceSources = {
        cities: loadedCities,
        index: (set) => (set === "us-cbsa" ? null : loadedRegionIndex(set)),
      };
      expect(resolvePlace("Miami-Dade, FL", withoutMetros)).toEqual({
        notLoaded: ["us-cbsa"],
      });
      expect(resolvePlace("Cook County, IL", withoutMetros)).toMatchObject({
        region: { set: "us-counties", id: "17031" },
      });
    });

    it("opens the map on its data, says which list did not load, and lists what it needed", async () => {
      const { makeMap } = await pageWith({
        cities: false,
        sets: ["admin1", "us-cbsa", "us-counties"],
      });
      const needs = new Set<PlaceFile>();
      const made = makeMap(
        { points: [POINT], view: { place: "Chicago", zoom: 12 } },
        { needs },
      );
      expect(made.view).toEqual({ place: "Chicago" });
      expect(made.notes).toEqual([
        '"Chicago" was not looked up: the list of cities could not be loaded. The map opens on its data. Try again.',
      ]);
      expect([...needs]).toEqual(["cities"]);
      const texas = new Set<PlaceFile>();
      expect(
        makeMap({ points: [POINT], view: { place: "Texas" } }, { needs: texas }).view
          ?.bounds,
      ).toHaveLength(4);
      expect(texas.size).toBe(0);
    });
  });

  it("takes a centre, a box, a zoom and a bearing within their bounds", () => {
    expect(
      mapOpening({ center: [-87.63, 41.88], zoom: 15.264, bearing: 30.44 }),
    ).toEqual({
      center: [-87.63, 41.88],
      zoom: 15.26,
      bearing: 30.4,
    });
    expect(mapOpening({ center: { lat: 41.88, lon: -87.63 } })?.center).toEqual([
      -87.63, 41.88,
    ]);
    expect(mapOpening({ bounds: [-88, 41, -87, 42] })).toEqual({
      bounds: [-88, 41, -87, 42],
    });
    expect(mapOpening({ zoom: 5 })).toEqual({ zoom: 5 });
    expect(mapOpening(undefined)).toBeUndefined();
  });

  it.each([
    [{ zoom: 0 }],
    [{ zoom: MAP_LIMITS.viewZoom }],
    [{ bearing: -90 }],
    [{ bearing: -180 }],
    [{ bearing: 180 }],
    [{ center: [-180, -90] }],
    [{ center: [180, 90] }],
    [{ bounds: [-180, -90, 180, 90] }],
    [{ bounds: [0, -90, 360, 90] }],
    [{ bounds: [-360, 0, -360, 0] }],
  ])("takes %j, which is on a bound, as it is", (raw) => {
    expect(mapOpening(raw)).toEqual(raw);
  });

  it("takes a zoom as near as a reader can zoom on any map: one building", () => {
    expect(mapOpening({ center: [-87.63, 41.88], zoom: 19 })).toEqual({
      center: [-87.63, 41.88],
      zoom: 19,
    });
    expect(() => mapOpening({ zoom: 19.1 })).toThrow(/from 0 to 19/);
  });

  it.each([
    [{ zoom: MAP_LIMITS.viewZoom + 1 }, /zoom of a view is a number from 0 to 19/],
    [{ center: [200, 0] }, /center of a view is \[lon, lat\]/],
    [{ bounds: [1, 2, 0, 3] }, /bounds of a view are \[west, south, east, north\]/],
    [{ zoom: -0.1 }, /zoom of a view is a number from 0 to 19/],
    [{ center: [180.1, 0] }, /center of a view is \[lon, lat\]/],
    [{ center: [0, -90.1] }, /center of a view is \[lon, lat\]/],
    [{ bounds: [-180, -90.1, 180, 90] }, /bounds of a view are/],
    [{ bounds: [-180, -90, 180, 90.1] }, /bounds of a view are/],
    [{ bounds: [-180, -90, 180.1, 90] }, /bounds of a view are/],
    [{ bounds: [0, -90, 360.1, 90] }, /bounds of a view are/],
    [{ bearing: 400 }, /bearing of a view/],
    [{ bearing: -180.1 }, /bearing of a view is a number of degrees from -180 to 180/],
    [{ bearing: 180.1 }, /bearing of a view is a number of degrees from -180 to 180/],
    [{}, /`view` is where the map opens/],
    ["Chicago", /`view` is where the map opens/],
  ])("fails at the call for %j, with what a view can be", (raw, message) => {
    expect(() => mapOpening(raw)).toThrow(message);
  });

  it("is part of the map, reduced to numbers, and read again as it is", async () => {
    const made = makeMap({ points: [POINT], view: { place: "Chicago", zoom: 14 } });
    expect(made.view).toMatchObject({ place: "Chicago", zoom: 14 });
    expect(made.view?.bounds).toHaveLength(4);
    const { mapSpec } = await pageWith({ cities: false, sets: [] });
    expect(mapSpec(made)).toEqual(made);
    const before = {
      points: [POINT],
      shapes: [],
      view: { center: [-87.65, 41.85], place: "Chicago" },
    };
    expect(mapSpec(before)).toEqual(before);
  });

  it("keeps the tilt a map asks for when it says where it opens, however wide its marks are", () => {
    const wide = [POINT, { lat: 35.68, lon: 139.69 }];
    expect(makeMap({ points: wide, pitch: 45 }).pitch).toBeUndefined();
    expect(makeMap({ points: wide, pitch: 45, view: { place: "Chicago" } }).pitch).toBe(
      45,
    );
    expect(
      makeMap({ points: wide, pitch: 45, view: { place: "Wall Street" } }).pitch,
    ).toBeUndefined();
  });
});

describe("a part of a country that a country answers to", () => {
  it("opens England on England, not on the United Kingdom with Shetland", () => {
    const [west, south, east, north] = boxOf("England") as number[];
    expect([west, south, east, north]).toEqual([-6.309, 49.914, 1.771, 55.805]);
    expect(boxOf("United Kingdom")?.[3]).toBeGreaterThan(60);
    expect(boxOf("england")).toEqual(boxOf("England"));
    expect(boxOf("GB-ENG")).toEqual(boxOf("England"));
  });

  it("opens each of the four nations on itself, and the kingdom by its names", () => {
    expect(boxOf("Scotland")?.[1]).toBeGreaterThan(54);
    expect(boxOf("Wales")?.[2]).toBeLessThan(-2.6);
    expect(boxOf("Northern Ireland")?.[2]).toBeLessThan(-5.4);
    for (const name of ["UK", "Great Britain", "Britain", "GB"])
      expect(boxOf(name), name).toEqual(boxOf("United Kingdom"));
  });

  it("asks for the list of the provinces, and never opens on the kingdom while it is not there", () => {
    expect(
      resolvePlace("England", { cities: loadedCities, index: () => null }),
    ).toEqual({ notLoaded: ["admin1"] });
  });

  it("is every name of a country that is the own name of a first-level region of it", () => {
    const countries = vendor("regions/countries.index.json").regions as unknown[][];
    const regions = vendor("regions/admin1.index.json").regions as unknown[][];
    const parts = countries.flatMap(([, , alts, , , , , , , a2]) =>
      (alts as string[]).flatMap((alt) =>
        regions
          .filter(
            ([id, name, , , , , , , , , level]) =>
              level === 1 && name === alt && String(id).startsWith(`${a2}-`),
          )
          .map(([id]) => [alt.toLowerCase(), id]),
      ),
    );
    expect(Object.fromEntries(parts)).toEqual({
      ...COUNTRY_PARTS,
      macau: "MO-M",
    });
  });
});

describe("a view that names a place beside numbers", () => {
  it("opens on the numbers and keeps no name it did not look up", () => {
    expect(mapOpening({ place: "Texas", center: [2.35, 48.85], zoom: 11 })).toEqual({
      center: [2.35, 48.85],
      zoom: 11,
    });
    expect(mapOpening({ place: "Texas", bounds: [2, 48, 3, 49] })).toEqual({
      bounds: [2, 48, 3, 49],
    });
    const made = makeMap({ points: [POINT], view: { place: "Texas" } });
    expect(made.view).toMatchObject({ place: "Texas" });
    expect(mapSpec(made)).toEqual(made);
  });
});

describe("a map that opens where a Map widget looks", () => {
  const view = {
    center: [-87.63012, 41.88345],
    zoom: 13.42,
    bearing: -24.5,
    pitch: 35.5,
    bounds: [-87.7012, 41.84, -87.56, 41.92],
  };

  it("keeps the middle, the zoom, the turn and the tilt as the widget keeps them", () => {
    const { box, ...opening } = mapOpening(view) ?? {};
    expect(opening).toEqual({
      center: [-87.63012, 41.88345],
      zoom: 13.42,
      bearing: -24.5,
      pitch: 35.5,
    });
    expect(box).toHaveLength(4);
  });

  it("opens on the middle and the zoom, not on the box: the box follows the size of a widget", () => {
    const opening = mapOpening({ ...view, bearing: 0, pitch: 0 });
    expect(opening).toMatchObject({
      center: [-87.63012, 41.88345],
      zoom: 13.42,
      bearing: 0,
      pitch: 0,
    });
    expect(opening?.bounds).toBeUndefined();
  });

  it("tilts a map that asks for no tilt of its own, and leaves a flat view flat", () => {
    const points = [{ lat: 41.88, lon: -87.63, label: "Office" }];
    const tilted = makeMap({ points, view });
    expect(tilted.pitch).toBe(36);
    expect(tilted.view).toMatchObject({ zoom: 13.42, pitch: 35.5 });
    expect(mapSpec(tilted)).toEqual(tilted);
    expect(makeMap({ points, view: { ...view, pitch: 0 } }).pitch).toBeUndefined();
    expect(makeMap({ points, pitch: 50, view }).pitch).toBe(50);
  });

  it.each([[-1], [MAP_LIMITS.pitch + 1], ["flat"], [Number.NaN]])(
    "refuses a tilt of %s",
    (pitch) => {
      expect(() => mapOpening({ center: [0, 0], zoom: 3, pitch })).toThrow(
        /pitch of a view is a number of degrees from 0 to/,
      );
    },
  );
});

describe("the zoom a box asks for", () => {
  it("is the zoom at which the box fills a map of a size, by its narrower side", () => {
    expect(boxZoom([-180, -85, 180, 85], 512, 512)).toBeCloseTo(0, 1);
    expect(boxZoom([-180, -85, 180, 85], 1024, 1024)).toBeCloseTo(1, 1);
    const county = [-74.046, 40.681, -73.906, 40.882];
    expect(boxZoom(county, 800, 400)).toBeCloseTo(10.05, 1);
    expect(boxZoom(county, 400, 800)).toBeCloseTo(10.97, 1);
    const state = boxZoom([-79.763, 40.502, -71.856, 45.016], 800, 400);
    expect(state).toBeLessThan(6);
    expect(boxZoom([-125, 24, -66, 50], 800, 400)).toBeLessThan(state);
  });

  it("stays within the zooms of a view: a box of no size is as near as a view goes", () => {
    expect(boxZoom([-73.97, 40.78, -73.97, 40.78], 800, 400)).toBe(MAP_LIMITS.viewZoom);
    expect(boxZoom([-73.9701, 40.78, -73.97, 40.7801], 800, 400)).toBe(
      MAP_LIMITS.viewZoom,
    );
    expect(boxZoom([-360, -90, 360, 90], 100, 100)).toBe(0);
  });
});

describe("an area people call by another name than its boundary set does", () => {
  const counties = () => loadedRegionIndex("us-counties");
  const regionOf = (name: string) => {
    const answer = resolvePlace(name);
    return answer && "bounds" in answer ? answer.region : undefined;
  };

  it("holds only regions the files of the app have, each under the name of its county", () => {
    const names = PLACE_AREAS.map(({ id, set }) => [
      set,
      id,
      loadedRegionIndex(set)?.get(id)?.name,
    ]);
    expect(names).toEqual([
      ["us-counties", "36061", "New York"],
      ["us-counties", "36047", "Kings"],
      ["us-counties", "36081", "Queens"],
      ["us-counties", "36005", "Bronx"],
      ["us-counties", "36085", "Richmond"],
    ]);
    for (const { id } of PLACE_AREAS) expect(counties()?.get(id)?.bounds).toBeTruthy();
  });

  it("opens a borough of New York City on the box of its county, not on a box guessed around a point", () => {
    expect(boxOf("Manhattan")).toEqual(boxOf("New York County, NY"));
    expect(width("Manhattan")).toBeLessThan(0.2);
    const [lon, lat] = middle("Manhattan") as number[];
    expect(lon).toBeCloseTo(-73.97, 1);
    expect(lat).toBeCloseTo(40.78, 1);
    expect(regionOf("Manhattan")).toEqual({ set: "us-counties", id: "36061" });
    expect(regionOf("Brooklyn")).toEqual({ set: "us-counties", id: "36047" });
    expect(regionOf("Queens")).toEqual({ set: "us-counties", id: "36081" });
    expect(regionOf("The Bronx")).toEqual({ set: "us-counties", id: "36005" });
    expect(regionOf("Bronx")).toEqual({ set: "us-counties", id: "36005" });
    expect(regionOf("Staten Island")).toEqual({ set: "us-counties", id: "36085" });
  });

  it("reads the name with its city or its state after it, and leaves the town of another state alone", () => {
    for (const name of [
      "Manhattan, NY",
      "manhattan, new york",
      "Manhattan, NYC",
      "Manhattan, New York City",
    ])
      expect(regionOf(name)).toEqual({ set: "us-counties", id: "36061" });
    const [lon] = middle("Manhattan, KS") as number[];
    expect(lon).toBeCloseTo(-96.57, 1);
    expect(regionOf("Manhattan, KS")).toBeUndefined();
    expect(boxOf("Manhattan Beach")).not.toEqual(boxOf("Manhattan"));
  });

  it("asks a name that says it is a county of the counties first: the list of cities has it as a point", () => {
    expect(regionOf("Kings County, NY")).toEqual({ set: "us-counties", id: "36047" });
    expect(boxOf("Kings County, NY")).toEqual(boxOf("Brooklyn"));
    expect(regionOf("Cook County, IL")).toEqual({ set: "us-counties", id: "17031" });
    expect(couldBe("Kings County")?.length).toBeGreaterThan(1);
  });

  it("knows a short form that means one place, and never one that means several", () => {
    expect(Object.keys(PLACE_NAMES)).toEqual(["nyc"]);
    expect(boxOf("NYC")).toEqual(boxOf("New York City"));
    expect(boxOf("nyc")).toEqual(boxOf("New York City"));
    expect(width("New York")).toBeGreaterThan(5);
    expect(couldBe("LA")?.length).toBe(2);
  });

  it("says that the list of counties is not loaded, and never gives the point of the list of cities in its place", async () => {
    const sources: PlaceSources = {
      cities: () => loadedCities(),
      index: (set) => (set === "us-counties" ? null : loadedRegionIndex(set)),
    };
    expect(resolvePlace("Manhattan", sources)).toEqual({ notLoaded: ["us-counties"] });
    const needs = new Set<PlaceFile>();
    const { makeMap } = await pageWith({ cities: true, sets: ["admin1", "us-cbsa"] });
    const made = makeMap({ points: [POINT], view: { place: "Manhattan" } }, { needs });
    expect([...needs]).toEqual(["us-counties"]);
    expect(made.view).toEqual({ place: "Manhattan" });
  });
});

describe("five digits as the place of a view", () => {
  beforeAll(() => {
    registerZips(vendor("places/zips.json"));
  });

  it("opens on a ZIP code that is written as one, on a box around its point", () => {
    const box = boxOf("ZIP 10001") as number[];
    expect((box[0] + box[2]) / 2).toBeCloseTo(-73.997, 2);
    expect((box[1] + box[3]) / 2).toBeCloseTo(40.75, 2);
    expect(box[3] - box[1]).toBeCloseTo((2 * ZIP_RADIUS_KM) / 111.32, 3);
    for (const name of [
      "zip 10001",
      "ZIP code 10001",
      "zipcode 10001",
      "Zip: 10001",
      "ZIP 10001-1234",
    ])
      expect(boxOf(name)).toEqual(box);
    expect(resolvePlace("ZIP 10001")).toEqual({ bounds: box });
    expect(resolvePlace("ZIP 00000")).toBeNull();
  });

  it("never chooses between a ZIP code and the county or the metro area of the same digits", () => {
    expect(couldBe("10001")).toEqual([
      'the ZIP code 10001 ("ZIP 10001")',
      'Kent county ("FIPS 10001")',
    ]);
    expect(resolvePlace("FIPS 10001")).toMatchObject({
      region: { set: "us-counties", id: "10001" },
    });
    expect(boxOf("ZIP 10001")).not.toEqual(boxOf("FIPS 10001"));
    const made = makeMap({ points: [POINT], view: { place: "10001" } });
    expect(made.view).toEqual({ place: "10001" });
    expect(made.notes).toEqual([
      '"10001" could be the ZIP code 10001 ("ZIP 10001") or Kent county ("FIPS 10001"): the map opens on its data. Write the one that is meant.',
    ]);
    expect(couldBe("35620")?.[0]).toBe('the ZIP code 35620 ("ZIP 35620")');
    expect(couldBe("35620")?.[1]).toMatch(
      /^the metro area New York.* \("CBSA 35620"\)$/,
    );
    expect(resolvePlace("CBSA 35620")).toMatchObject({
      region: { set: "us-cbsa", id: "35620" },
    });
  });

  it("is the one place that has the digits when only one list knows them", () => {
    const beverly = boxOf("90210") as number[];
    expect((beverly[0] + beverly[2]) / 2).toBeCloseTo(-118.41, 1);
    expect(resolvePlace("36061")).toEqual({
      bounds: boxOf("New York County, NY"),
      region: { set: "us-counties", id: "36061" },
    });
    expect(resolvePlace("fips 36061")).toEqual(resolvePlace("36061"));
    expect(resolvePlace("99999")).toBeNull();
  });

  it("is not looked up while a list that could know the digits is not loaded", () => {
    const sources: PlaceSources = { cities: loadedCities, index: loadedRegionIndex };
    expect(resolvePlace("10001", sources)).toEqual({ notLoaded: ["zips"] });
    expect(
      resolvePlace("10001", {
        cities: loadedCities,
        index: (set) => (set === "us-counties" ? null : loadedRegionIndex(set)),
        zips: loadedZips,
      }),
    ).toEqual({ notLoaded: ["us-counties"] });
    expect(resolvePlace("FIPS 10001", sources)).toMatchObject({
      region: { set: "us-counties", id: "10001" },
    });
    expect(
      resolvePlace("ZIP 10001", {
        cities: () => null,
        index: () => null,
        zips: loadedZips,
      }),
    ).toMatchObject({ bounds: expect.any(Array) });
  });
});

describe("the outline of the place a view names", () => {
  it("is the region the place is, kept by its set and its id", () => {
    expect(mapOpening({ place: "Manhattan", outline: true })).toEqual({
      bounds: boxOf("Manhattan"),
      place: "Manhattan",
      outline: { set: "us-counties", id: "36061" },
    });
    expect(mapOpening({ place: "Texas", outline: true })?.outline).toEqual({
      set: "us-states",
      id: "48",
    });
    expect(mapOpening({ place: "France", outline: true })?.outline?.set).toBe(
      "countries",
    );
    expect(mapOpening({ place: "CA-ON", outline: true })?.outline).toEqual({
      set: "admin1",
      id: "CA-ON",
    });
    expect(mapOpening({ place: "Manhattan" })).not.toHaveProperty("outline");
  });

  it("is not drawn for a city or for a view by numbers, and the map says so", () => {
    const city = makeMap({
      points: [POINT],
      view: { place: "Chicago", outline: true },
    });
    expect(city.view).not.toHaveProperty("outline");
    expect(city.view?.bounds).toBeTruthy();
    expect(city.notes).toEqual([`"Chicago" ${NO_OUTLINE}`]);
    const numbers = makeMap({
      points: [POINT],
      view: { center: [-87.63, 41.88], zoom: 9, outline: true },
    });
    expect(numbers.view).toEqual({ center: [-87.63, 41.88], zoom: 9 });
    expect(numbers.notes).toEqual([`A view by numbers ${NO_OUTLINE}`]);
  });

  it("is read back from a stored map as it is, and never as anything but an id of a set the app ships", () => {
    const made = makeMap({
      points: [POINT],
      view: { place: "Manhattan", outline: true },
    });
    expect(made.view?.outline).toEqual({ set: "us-counties", id: "36061" });
    const again = mapSpec(JSON.parse(JSON.stringify(made)));
    expect(again.view).toEqual(made.view);
    expect(again.notes).toBeUndefined();
    for (const outline of [
      "36061",
      { set: "us-cd119", id: "3612" },
      { set: "https://example.com/a.json", id: "1" },
      { set: "us-counties", id: "../36061" },
      { set: "us-counties", id: "x".repeat(17) },
      { set: "us-counties" },
      false,
    ])
      for (const read of [mapSpec, makeMap])
        expect(() =>
          read({ points: [POINT], view: { center: [0, 0], zoom: 3, outline } }),
        ).toThrow(/outline of a view/);
  });
});

describe("the deepest zoom a view opens at", () => {
  const one = { total: 1, box: [-73.97, 40.78, -73.97, 40.78] };
  const on = (viewZoom: number, more: object = {}) =>
    viewLimit({ viewZoom, streets: false, detailed: false, ...one, ...more });

  it("is where the backdrop ends for one mark, for marks all over a country and for a map without marks", () => {
    expect(on(9)).toBe(9);
    expect(on(7)).toBe(7);
    expect(on(9, { total: 0, box: null })).toBe(9);
    expect(on(9, { total: 40, box: [-125, 24, -66, 50] })).toBe(9);
    expect(on(9, { total: 2 })).toBe(9);
  });

  it("is as near as the marks of one place need: a few are read one by one, more as a pattern", () => {
    const block = [-73.99, 40.74, -73.97, 40.76];
    expect(on(9, { total: 3, box: block })).toBe(17);
    expect(on(9, { total: 30, box: block })).toBe(17);
    expect(on(9, { total: 31, box: block })).toBe(12);
    expect(on(13, { total: 31, box: block })).toBe(13);
  });

  it("is nothing where the backdrop has streets or the map has detail of its own", () => {
    expect(
      viewLimit({ viewZoom: 17, streets: true, detailed: false, ...one }),
    ).toBeNull();
    expect(
      viewLimit({ viewZoom: 9, streets: false, detailed: true, ...one }),
    ).toBeNull();
  });
});
