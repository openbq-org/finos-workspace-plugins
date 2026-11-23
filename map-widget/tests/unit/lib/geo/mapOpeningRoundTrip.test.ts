import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { mapOpening } from "~/lib/geo/mapOpening";
import "~/lib/geo/mapPlaceSets";
import { makeMap, mapSpec } from "~/lib/geo/mapSpec";
import { registerCities } from "~/lib/geo/regions/cities";
import { bundledIndex } from "~/lib/geo/regions/codes";
import type { RegionIndex } from "~/lib/geo/regions/regionTypes";
import { loadedRegionIndex, registerRegionIndex } from "~/lib/geo/regions/registry";

const POINT = { lat: 41.88, lon: -87.63 };
const vendor = (path: string) =>
  JSON.parse(readFileSync(join(process.cwd(), "vendor/geo", path), "utf8"));

beforeAll(() => {
  registerCities(vendor("places/cities.json"));
  for (const set of ["admin1", "us-cbsa", "us-counties", "us-cd119"])
    registerRegionIndex(vendor(`regions/${set}.index.json`));
});

function roundTrip(place: string) {
  const made = makeMap({ points: [POINT], view: { place } });
  expect(mapSpec(made), place).toEqual(made);
  return made.view;
}

const SETS: [
  string,
  () => RegionIndex | null,
  (id: string, short: string) => string,
][] = [
  ["us-states", () => bundledIndex("us-states"), (_id, short) => `US-${short}`],
  ["countries", () => bundledIndex("countries"), (_id, short) => short],
  ["admin1", () => loadedRegionIndex("admin1"), (id) => id],
  ["us-cbsa", () => loadedRegionIndex("us-cbsa"), (id) => `CBSA ${id}`],
  ["us-counties", () => loadedRegionIndex("us-counties"), (id) => `FIPS ${id}`],
];

describe("a view by place is a map the page reads again", () => {
  it.each(SETS)(
    "for every region of %s, by its code and by its name",
    (_set, index, written) => {
      const found = index();
      const regions = (found?.ids() ?? []).flatMap((id) => found?.get(id) ?? []);
      expect(regions.length).toBeGreaterThan(50);
      let resolved = 0;
      for (const { id, name, short } of regions) {
        const code = written(id, short);
        if (code && roundTrip(code)?.bounds) resolved++;
        roundTrip(name);
      }
      expect(resolved).toBeGreaterThan(regions.length * 0.8);
    },
  );

  it("for the box of every congressional district, which a view gives as bounds", () => {
    const index = loadedRegionIndex("us-cd119");
    const districts = (index?.ids() ?? []).flatMap((id) => index?.get(id) ?? []);
    expect(districts.length).toBeGreaterThan(400);
    for (const { viewBounds, bounds } of districts) {
      const box = viewBounds ?? bounds;
      if (!box) continue;
      const made = makeMap({ points: [POINT], view: { bounds: [...box] } });
      expect(mapSpec(made)).toEqual(made);
    }
  });

  it("for a sample of the cities, the ones next to the 180th meridian among them", () => {
    const { countries } = vendor("places/cities.json") as {
      countries: Record<string, [string, number, ...unknown[]][]>;
    };
    let resolved = 0;
    const sample = Object.values(countries)
      .flat()
      .filter((city, at) => at % 40 === 0 || Math.abs(city[1]) > 175_000);
    expect(sample.length).toBeGreaterThan(300);
    for (const city of sample) if (roundTrip(String(city[0]))?.bounds) resolved++;
    expect(resolved).toBeGreaterThan(sample.length / 3);
  });

  it.each([
    "United States",
    "USA",
    "America",
    "Alaska",
    "Russia",
    "New Zealand",
    "Fiji",
  ])("opens %s on a box that crosses the meridian west to east", (place) => {
    const view = roundTrip(place);
    expect(view?.bounds).toHaveLength(4);
    const [west, , east] = view?.bounds ?? [0, 0, 0, 0];
    expect(west).toBeLessThanOrEqual(east);
    expect(east - west).toBeLessThanOrEqual(360);
  });

  it("takes the bounds of a view as the camera does: west to east, to one turn past the meridian", () => {
    expect(mapOpening({ bounds: [170, -50, 190, -30] })?.bounds).toEqual([
      170, -50, 190, -30,
    ]);
    expect(mapOpening({ bounds: [-190, 50, -170, 60] })?.bounds?.[0]).toBe(-190);
    const refused = /bounds of a view are \[west, south, east, north\]/;
    expect(() => mapOpening({ bounds: [170, -50, -170, -30] })).toThrow(refused);
    expect(() => mapOpening({ bounds: [-200, 0, 200, 10] })).toThrow(refused);
    expect(() => mapOpening({ bounds: [0, 0, 361, 10] })).toThrow(refused);
    expect(() => mapOpening({ bounds: [0, -91, 10, 10] })).toThrow(refused);
  });
});
