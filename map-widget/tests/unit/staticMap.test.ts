import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { widgetMap } from "~/lib/geo/mapData";
import { STATIC_POINTS, STATIC_REGIONS, staticMap } from "~/staticMap";
import type { Shown } from "~/widget";
import { problems } from "./schema";

const manifest = JSON.parse(readFileSync(join(process.cwd(), "src/plugin.json"), "utf8"));
const artifact = manifest.contributes.widgets[0].artifact.data;

const shownOf = (data: unknown, mapping: unknown, extra: Partial<Shown> = {}): Shown => {
  const made = widgetMap(data, mapping, []);
  if (!made?.spec) throw new Error(made?.error ?? "no map");
  return { spec: made.spec, name: "Offices", notes: {}, shapes: [], view: undefined, ...extra };
};

const CAMERA = { latitude: 48.8566, longitude: 2.3522, zoom: 12, bearing: 0, pitch: 0 };

const ROWS = [
  { name: "New York", lat: 40.7128, lon: -74.006, staff: 120, kind: "HQ" },
  { name: "London", lat: 51.5072, lon: -0.1276, staff: 85, kind: "Office" },
];
const MAPPING = { lat: "lat", lon: "lon", label: "name", value: "staff", category: "kind", tag: "name", valueLabel: "Staff", title: "Offices" };

describe("a static copy of the map", () => {
  it("keeps the places, their label, tag and value, and the title", () => {
    const made = staticMap(shownOf(ROWS, MAPPING), null);
    expect(made?.data).toEqual({
      title: "Offices",
      valueLabel: "Staff",
      points: [
        { lat: 40.7128, lon: -74.006, label: "New York", tag: "New York", value: 120 },
        { lat: 51.5072, lon: -0.1276, label: "London", tag: "London", value: 85 },
      ],
    });
    expect(problems(made?.data, artifact)).toEqual([]);
    expect(made?.notice).toBe("Static map created.");
  });

  it("opens where the reader is looking, within what the artifact allows", () => {
    const where = (camera: typeof CAMERA) => (staticMap(shownOf(ROWS, MAPPING), camera)?.data as { view: unknown }).view;
    expect(where(CAMERA)).toEqual({ center: { lat: 48.8566, lon: 2.3522 }, zoom: 12, bearing: 0, pitch: 0 });
    expect(where({ ...CAMERA, zoom: 22.4, pitch: 80, longitude: 190, latitude: 95 })).toEqual({
      center: { lat: 90, lon: -170 },
      zoom: 19,
      bearing: 0,
      pitch: 60,
    });
    expect(where({ ...CAMERA, longitude: -540 })).toMatchObject({ center: { lon: -180 } });
    expect(problems(staticMap(shownOf(ROWS, MAPPING), { ...CAMERA, zoom: 22.4, pitch: 80 })?.data, artifact)).toEqual([]);
  });

  it("has no view when the camera is unknown or not a number", () => {
    expect(staticMap(shownOf(ROWS, MAPPING), null)?.data).not.toHaveProperty("view");
    expect(staticMap(shownOf(ROWS, MAPPING), { ...CAMERA, zoom: Number.NaN })?.data).not.toHaveProperty("view");
  });

  it("keeps the first 200 places and says so", () => {
    const rows = [...Array(1500)].map((_, index) => ({ name: `Place ${index}`, lat: 40 + (index % 50) / 10, lon: -74 + Math.floor(index / 50) / 10, staff: index }));
    const made = staticMap(shownOf(rows, MAPPING), CAMERA);
    expect(made?.points).toBe(STATIC_POINTS);
    expect((made?.data as { points: { label: string }[] }).points[199].label).toBe("Place 199");
    expect(made?.notice).toContain("the first 200 places of 1,500 places are kept");
    expect(problems(made?.data, artifact)).toEqual([]);
  });

  it("stays far under what the host takes for a widget, with the longest labels", () => {
    const long = "x".repeat(100);
    const rows = [...Array(5000)].map((_, index) => ({ name: long, tag: long, lat: (index % 170) - 85, lon: (index % 350) - 175, staff: index }));
    const made = staticMap(shownOf(rows, { ...MAPPING, tag: "tag" }), CAMERA);
    expect(made?.points).toBe(STATIC_POINTS);
    expect(JSON.stringify(made?.data).length).toBeLessThan(100 * 1024);
    expect(problems(made?.data, artifact)).toEqual([]);
  });

  it("keeps US states with their value", () => {
    const rows = [
      { state: "California", population: 39538223 },
      { state: "Texas", population: 29145505 },
    ];
    const made = staticMap(shownOf(rows, { state: "state", value: "population", label: "state", valueLabel: "Population" }), null);
    expect(made?.data).toEqual({
      valueLabel: "Population",
      regions: { set: "us-states", items: [{ code: "06", label: "California", value: 39538223 }, { code: "48", label: "Texas", value: 29145505 }] },
      title: "Offices",
    });
    expect(made?.regions).toBe(2);
    expect(problems(made?.data, artifact)).toEqual([]);
  });

  it("keeps at most the regions that the artifact takes", () => {
    expect(STATIC_REGIONS).toBe(artifact.properties.regions.properties.items.maxItems);
    const items = [...Array(300)].map((_, index) => ({ code: String(index + 1).padStart(3, "0"), value: index }));
    const spec = { points: [], shapes: [], regions: { set: "countries", items } } as never;
    const made = staticMap({ spec, name: "Countries", notes: {}, shapes: [], view: undefined }, null);
    expect(made?.regions).toBe(250);
    expect(made?.notice).toContain("the first 250 of 300 regions are kept");
    expect(problems(made?.data, artifact)).toEqual([]);
  });

  it("copies nothing from a map of lines or areas, or of a region set the artifact does not have", () => {
    const geojson = {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[-0.1, 51.5], [2.3, 48.8]] } }],
    };
    expect(staticMap(shownOf(geojson, null), CAMERA)).toBeNull();
    expect(staticMap(shownOf([{ county: "Cook, IL", value: 1 }], { county: "county", value: "value" }), CAMERA)).toBeNull();
  });

  it("says what is left behind: tags, drawn shapes and the lines of the map", () => {
    const shape = { id: "a", type: "line", coordinates: [[0, 0], [1, 1]] } as never;
    const made = staticMap(shownOf(ROWS, MAPPING, { notes: { "p:40.7128,-74.0060": "HQ" }, shapes: [shape] }), null);
    expect(made?.notice).toBe("Static map created: your tags and drawn shapes are not copied.");
  });

  it("leaves a label out when it is empty and cuts it where the artifact does", () => {
    const rows = [{ name: "", lat: 1, lon: 2, staff: 3, tag: "t".repeat(60) }, { name: "n".repeat(300), lat: 2, lon: 3 }];
    const made = staticMap(shownOf(rows, { ...MAPPING, tag: "tag" }), null);
    const [first, second] = (made?.data as { points: Record<string, unknown>[] }).points;
    expect(first).not.toHaveProperty("label");
    expect((first.tag as string).length).toBe(40);
    expect((second.label as string).length).toBe(80);
    expect(problems(made?.data, artifact)).toEqual([]);
  });
});
