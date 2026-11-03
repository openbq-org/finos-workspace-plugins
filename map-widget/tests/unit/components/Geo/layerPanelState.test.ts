import { describe, expect, it } from "vitest";
import {
  groupLabels,
  groupVisible,
  opacityPercent,
  setBasemapChoice,
  setBasemapPart,
  setContextLayer,
  setLayerGrouped,
  setLayerOpacity,
  setLegendClosed,
  setPanelOpen,
  toggleGroup,
  toggleLayer,
} from "~/components/Geo/layerPanelState";
import { layerOpacity, layerVisible, mapViewState } from "~/lib/geo/mapViewState";

const regions = { id: "regions" };
const points = { id: "points", opacity: 0.7 };
const off = { id: "ndvi", visible: false as const };

describe("showing and hiding a layer", () => {
  it("turns a layer off through `hidden`, and on again by removing it", () => {
    const hidden = toggleLayer({}, regions);
    expect(hidden).toEqual({ hidden: ["regions"] });
    expect(layerVisible(regions, hidden)).toBe(false);
    expect(toggleLayer(hidden, regions)).toEqual({});
  });

  it("turns on a layer the map leaves off through `shown`, and off again by removing it", () => {
    const shown = toggleLayer({}, off);
    expect(shown).toEqual({ shown: ["ndvi"] });
    expect(layerVisible(off, shown)).toBe(true);
    expect(toggleLayer(shown, off)).toEqual({});
  });

  it("keeps the rest of the state, and never lists a layer twice", () => {
    const view = {
      hidden: ["points"],
      opacity: { points: 0.5 },
      legend: "closed" as const,
    };
    expect(toggleLayer(view, regions)).toEqual({
      hidden: ["points", "regions"],
      opacity: { points: 0.5 },
      legend: "closed",
    });
    expect(toggleLayer({ hidden: ["regions", "regions"] }, regions)).toEqual({});
    expect(view).toEqual({
      hidden: ["points"],
      opacity: { points: 0.5 },
      legend: "closed",
    });
  });

  it("cleans a state that came in dirty", () => {
    const dirty = { hidden: ["https://attacker.example"], url: "x" } as never;
    expect(toggleLayer(dirty, regions)).toEqual({ hidden: ["regions"] });
  });
});

describe("showing and hiding a group", () => {
  const layers = [
    { id: "a", group: "Crops" },
    { id: "b", group: "Crops", visible: false as const },
    { id: "c", group: "Crops", note: "This source is not connected." },
    { id: "d", group: "Other" },
    { id: "e" },
  ];

  it("turns every layer of the group off when one is on", () => {
    expect(groupVisible(layers, "Crops", {})).toBe(true);
    const next = toggleGroup({ shown: ["b"] }, layers, "Crops");
    expect(next).toEqual({ hidden: ["a"] });
    expect(groupVisible(layers, "Crops", next)).toBe(false);
  });

  it("turns every layer of the group on when all are off, each by its own rule", () => {
    const next = toggleGroup({ hidden: ["a", "d"] }, layers, "Crops");
    expect(next).toEqual({ hidden: ["d"], shown: ["b"] });
    expect(layers.slice(0, 2).every((layer) => layerVisible(layer, next))).toBe(true);
  });

  it("leaves a layer that is not drawn and the layers of other groups as they are", () => {
    expect(toggleGroup({}, layers, "Crops")).toEqual({ hidden: ["a"] });
    expect(toggleGroup({}, layers, "Nothing")).toEqual({});
    expect(groupVisible([layers[2]], "Crops", {})).toBe(false);
  });
});

describe("the opacity of a layer", () => {
  it("is kept when it differs from what the map says, on the steps of the slider", () => {
    expect(setLayerOpacity({}, regions, 0.52)).toEqual({ opacity: { regions: 0.5 } });
    expect(setLayerOpacity({}, regions, 0)).toEqual({ opacity: { regions: 0 } });
    expect(setLayerOpacity({}, points, 0.3)).toEqual({ opacity: { points: 0.3 } });
  });

  it("is removed when it is what the map says", () => {
    expect(setLayerOpacity({ opacity: { regions: 0.5 } }, regions, 1)).toEqual({});
    expect(
      setLayerOpacity({ opacity: { points: 0.2, regions: 0.5 } }, points, 0.7),
    ).toEqual({ opacity: { regions: 0.5 } });
  });

  it("makes a layer the map draws faded fully opaque, in a state that stays reduced", () => {
    const next = setLayerOpacity({}, points, 1);
    expect(mapViewState(next)).toEqual(next);
    expect(layerOpacity(points, next)).toBeGreaterThan(0.98);
    expect(opacityPercent(points, next)).toBe(100);
  });

  it("is bounded for a value that is no opacity", () => {
    expect(setLayerOpacity({}, regions, -4)).toEqual({ opacity: { regions: 0 } });
    expect(setLayerOpacity({}, regions, 40)).toEqual({});
    expect(setLayerOpacity({}, regions, Number.NaN)).toEqual({});
  });

  it("gives the slider its place", () => {
    expect(opacityPercent(regions, {})).toBe(100);
    expect(opacityPercent(points, {})).toBe(70);
    expect(opacityPercent(points, { opacity: { points: 0.25 } })).toBe(25);
  });
});

describe("the basemap", () => {
  it("stores a part only when it is off", () => {
    const next = setBasemapPart({}, "names", false);
    expect(next).toEqual({ basemap: { names: false } });
    expect(setBasemapPart(next, "roads", false)).toEqual({
      basemap: { names: false, roads: false },
    });
    expect(setBasemapPart(next, "names", true)).toEqual({});
    expect(setBasemapPart({ basemap: { choice: "plain" } }, "borders", true)).toEqual({
      basemap: { choice: "plain" },
    });
  });

  it("stores a backdrop only when it is not the first of the list", () => {
    const list = [{ id: "standard" }, { id: "plain" }, { id: "imagery" }];
    const next = setBasemapChoice({ basemap: { roads: false } }, "plain", list);
    expect(next).toEqual({ basemap: { roads: false, choice: "plain" } });
    expect(setBasemapChoice(next, "standard", list)).toEqual({
      basemap: { roads: false },
    });
    expect(setBasemapChoice({}, "standard", list)).toEqual({});
    expect(setBasemapChoice({}, "https://attacker.example", list)).toEqual({});
  });
});

describe("the panel and the legend", () => {
  it("are open or closed in the state, and absent when they are as a map starts", () => {
    expect(setPanelOpen({ hidden: ["a"] }, true)).toEqual({
      hidden: ["a"],
      panel: "open",
    });
    expect(setPanelOpen({ hidden: ["a"], panel: "open" }, false)).toEqual({
      hidden: ["a"],
    });
    expect(setLegendClosed({}, true)).toEqual({ legend: "closed" });
    expect(setLegendClosed({ legend: "closed" }, false)).toEqual({});
  });
});

describe("the name of a folder where room is short", () => {
  it("is its last folder when that tells the folders apart", () => {
    expect([
      ...groupLabels(["Farms / North", "Farms / South", "Farms", "Farms / North"]),
    ]).toEqual([
      ["Farms / North", "North"],
      ["Farms / South", "South"],
      ["Farms", "Farms"],
    ]);
  });

  it("is the whole path when two folders end alike", () => {
    expect(groupLabels(["2024 / Fields", "2025 / Fields"]).get("2024 / Fields")).toBe(
      "2024 / Fields",
    );
    expect(groupLabels(["Imagery"]).get("Imagery")).toBe("Imagery");
  });
});

describe("the context layers of the basemap", () => {
  it("stores one the reader turned on, and nothing once it is off again", () => {
    const on = setContextLayer({}, "buildings", true, []);
    expect(on).toEqual({ basemap: { context: ["buildings"] } });
    expect(setContextLayer(on, "pois", true, [])).toEqual({
      basemap: { context: ["buildings", "pois"] },
    });
    expect(setContextLayer(on, "buildings", false, [])).toEqual({});
    expect(setContextLayer(on, "buildings", true, [])).toEqual(on);
  });

  it("stores one the map asks for only when the reader turned it off", () => {
    const asked = ["green", "buildings"];
    expect(setContextLayer({}, "green", true, asked)).toEqual({});
    const off = setContextLayer({}, "green", false, asked);
    expect(off).toEqual({ basemap: { contextOff: ["green"] } });
    expect(setContextLayer(off, "green", true, asked)).toEqual({});
    expect(
      setContextLayer({ basemap: { context: ["green"] } }, "green", true, asked),
    ).toEqual({});
  });

  it("keeps the rest of the state", () => {
    const view = mapViewState({
      hidden: ["points"],
      basemap: { names: false, choice: "plain", context: ["pois"] },
    });
    expect(setContextLayer(view, "railways", true, [])).toEqual({
      hidden: ["points"],
      basemap: { names: false, choice: "plain", context: ["railways", "pois"] },
    });
    expect(setBasemapPart(view, "roads", false).basemap?.context).toEqual(["pois"]);
  });
});

describe("the close points of a layer", () => {
  const sites = { id: "sites" };
  it("keeps only what differs from how the map opens", () => {
    expect(setLayerGrouped({}, sites, false, true)).toEqual({ ungrouped: ["sites"] });
    expect(setLayerGrouped({ ungrouped: ["sites"] }, sites, true, true)).toEqual({});
    expect(setLayerGrouped({}, sites, true, false)).toEqual({ grouped: ["sites"] });
    expect(setLayerGrouped({ grouped: ["sites"] }, sites, false, false)).toEqual({});
  });
});
