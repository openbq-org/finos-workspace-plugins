import { describe, expect, it } from "vitest";
import { isNoMap, mapText, NO_MAP } from "~/lib/geo/mapRows";
import { mapSpec } from "~/lib/geo/mapSpec";

const layered = mapSpec({
  title: "Flows",
  layers: [
    { kind: "flows", flows: [{ from: [-93, 42], to: [-90, 30], value: 3 }] },
    { kind: "source", source: "ndvi", visible: false },
  ],
});
const widget = (storage: Record<string, unknown> = {}) =>
  ({ id: "w", widgetId: `${STORED_CHART_TYPE}-w`, storage }) as unknown as WidgetT;

describe("a map without marks", () => {
  it("is what a derived widget stores, and nothing else of the first form", () => {
    expect(isNoMap(NO_MAP)).toBe(true);
    expect(isNoMap(mapSpec({ points: [{ lat: 1, lon: 2 }] }))).toBe(false);
    expect(
      isNoMap(mapSpec({ regions: { set: "us-states", items: [{ code: "CA" }] } })),
    ).toBe(false);
  });

  it("is not a map whose marks are all in its layers", () => {
    expect(layered.points).toEqual([]);
    expect(layered.shapes).toEqual([]);
    expect(isNoMap(layered)).toBe(false);
    expect(isNoMap(mapSpec({ layers: [{ kind: "source", source: "ndvi" }] }))).toBe(
      false,
    );
  });
});

describe("what an agent reads of a map widget", () => {
  const map = { points: [{ lat: 41.88, lon: -87.63, label: "Office" }], shapes: [] };

  it("says where the reader left the map, with the box that is visible", () => {
    const text = mapText(map, undefined, {
      camera: {
        center: [-87.63, 41.88],
        zoom: 13,
        box: [-87.7, 41.84, -87.56, 41.92],
        style: "https://attacker.example/style.json",
      },
    });
    expect(JSON.parse(text).view).toEqual({
      center: [-87.63, 41.88],
      zoom: 13,
      bearing: 0,
      pitch: 0,
      bounds: [-87.7, 41.84, -87.56, 41.92],
    });
  });

  it("says nothing of a view for a map nobody moved", () => {
    expect(JSON.parse(mapText(map))).not.toHaveProperty("view");
    expect(JSON.parse(mapText(map, undefined, { camera: "there" }))).not.toHaveProperty(
      "view",
    );
  });
});
