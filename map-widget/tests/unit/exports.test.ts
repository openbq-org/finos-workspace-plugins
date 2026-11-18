import { afterEach, describe, expect, it } from "vitest";
import { copilotContext, exportData, exportOptions } from "~/exports";
import { mapSpec } from "~/lib/geo/mapSpec";
import { setShown } from "~/widget";

const spec = mapSpec({
  title: "Offices",
  points: [
    { lat: 40.7, lon: -74, label: "New York", value: 120 },
    { lat: 51.5, lon: -0.1, label: "London", value: 85 },
  ],
});

const show = () =>
  setShown({ spec, name: "Offices", notes: {}, shapes: [], view: undefined });

afterEach(() => setShown(null));

describe("the exports of a map", () => {
  it("offer nothing until a map is drawn", async () => {
    expect(await exportOptions()).toEqual([]);
    expect(await exportData("kml")).toBeNull();
    expect(await copilotContext()).toBeNull();
  });

  it("are KML, KMZ and GeoJSON of the map that is drawn", async () => {
    show();
    const options = await exportOptions();
    expect(options.map((option) => option.id)).toEqual(["kml", "kmz", "geojson"]);
    expect(options.map((option) => option.extension)).toEqual([
      "kml",
      "kmz",
      "geojson",
    ]);
    const geojson = JSON.parse(String(await exportData("geojson")));
    expect(
      geojson.features.map(
        (feature: { properties: { name: string } }) => feature.properties.name,
      ),
    ).toEqual(["New York", "London"]);
    expect(String(await exportData("kml"))).toContain("<kml");
    expect(await exportData("kmz")).toBeInstanceOf(Uint8Array);
    expect(await exportData("pdf")).toBeNull();
  });

  it("give the agent what the map is and its rows", async () => {
    show();
    const context = await copilotContext();
    expect(context?.map.map.points).toBe(2);
    expect(context?.map.rows).toHaveLength(2);
  });
});
