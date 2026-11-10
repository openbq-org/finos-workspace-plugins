import { describe, expect, it, vi } from "vitest";
import { makeWidgetMap } from "~/lib/geo/widgetMapMake";

const parses = vi.hoisted(() => ({ count: 0 }));
vi.mock("~/lib/geo/files", async (original) => {
  const files = await original<typeof import("~/lib/geo/files")>();
  return {
    ...files,
    parseGeoFile: (...args: Parameters<typeof files.parseGeoFile>) => {
      parses.count++;
      return files.parseGeoFile(...args);
    },
  };
});
const loaded = vi.hoisted(() => [] as string[][]);
vi.mock("~/lib/geo/mapPlaceSets", () => ({
  loadPlaceFiles: async (files: string[]) => {
    loaded.push(files);
  },
}));

const KML =
  "<kml><Document><Placemark><name>North field</name><Point><coordinates>-93.7,42.0</coordinates></Point></Placemark></Document></kml>";

describe("the map of a Map widget made again with the places it needed", () => {
  it("parses its file once", async () => {
    const made = await makeWidgetMap({
      payload: {
        file: { name: "fields.kml", text: KML },
        points: [{ city: "Chicago", country: "US", label: "HQ" }],
      },
      mapping: undefined,
      sourceIds: [],
    });
    expect(loaded).toEqual([["cities"]]);
    expect(JSON.stringify(made?.spec)).toContain('"label":"North field"');
    expect(parses.count).toBe(1);
  });
});
