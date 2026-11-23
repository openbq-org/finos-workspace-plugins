import { describe, expect, it } from "vitest";
import { featuresOf, ids, scene, styleOf, theme } from "./support";

const line = (label: string) => ({
  type: "line",
  label,
  coordinates: [
    [-80, 30],
    [-70, 40],
  ],
});
const area = {
  type: "polygon",
  coordinates: [
    [
      [-100, 40],
      [-99, 40],
      [-99, 41],
      [-100, 40],
    ],
  ],
};

describe("a map of the first form", () => {
  const built = scene({
    valueLabel: "Rate",
    points: [{ lat: 40, lon: -74, value: 9 }],
    regions: {
      set: "us-counties",
      items: [
        { code: "06037", value: 1 },
        { code: "17031", value: 3 },
      ],
    },
    shapes: [line("Route"), area],
  });

  it("is drawn in the order it always was", () => {
    expect(ids(built)).toEqual([
      "sea",
      "world-land",
      "states-land",
      "regions",
      "county-borders",
      "world-borders",
      "state-borders",
      "regions-outline",
      "regions-marked",
      "regions-small",
      "regions-hover",
      "polygons",
      "polygons-outline",
      "lines",
      "points",
      "points-hover",
    ]);
  });

  it("has its top-level marks as layers that share one scale: that of the regions", () => {
    expect(built.layers.map(({ id, kind, count }) => [id, kind, count])).toEqual([
      ["regions", "regions", 2],
      ["polygons", "polygons", 1],
      ["lines", "lines", 1],
      ["points", "points", 1],
    ]);
    const [regions, areas, lines, points] = built.layers;
    expect(regions.scale).toMatchObject({ min: 1, max: 3 });
    expect(regions.valueLabel).toBe("Rate");
    expect([areas.scale, lines.scale, points.scale]).toEqual([null, null, null]);
    expect(built.scale).toBe(regions.scale);
    expect(built.marks.find((mark) => mark.kind === "point")?.color).toBe(theme.mark);
    expect(regions.name).toBe("Rate");
    expect(points.name).toBe("Points");
  });

  it("says which layers of the style draw each layer, and what carries its opacity", () => {
    const [regions, , , points] = built.layers;
    expect(regions.parts).toEqual([
      { id: "regions", opacity: { "fill-opacity": 1 } },
      { id: "county-borders", opacity: { "line-opacity": 1 } },
      { id: "regions-outline", opacity: { "line-opacity": 1 } },
      { id: "regions-marked", opacity: { "line-opacity": 1 } },
      {
        id: "regions-small",
        opacity: { "circle-opacity": 1, "circle-stroke-opacity": 1 },
      },
      { id: "regions-hover", opacity: {} },
    ]);
    expect(points.parts).toEqual([
      { id: "points", opacity: { "circle-opacity": 0.92, "circle-stroke-opacity": 1 } },
      { id: "points-hover", opacity: {} },
    ]);
    expect(regions.swatch).toBe("fill");
    expect(points.swatch).toBe("circle");
    expect(built.layers[2].swatch).toBe("line");
  });

  it("gives every mark the layer it is of", () => {
    expect(built.marks.map((mark) => mark.layer)).toEqual([
      "regions",
      "regions",
      "polygons",
      "lines",
      "points",
    ]);
    expect(built.frames).toEqual([]);
    expect(built.timed).toEqual([]);
    expect([...built.pointer].sort()).toEqual([
      "lines",
      "points",
      "polygons",
      "regions",
      "regions-small",
    ]);
    expect(built.hover).toEqual(["regions-hover", "points-hover"]);
  });

  it("uses the scale of the points when no region has a value, and of the shapes without those", () => {
    const byPoints = scene({
      points: [
        { lat: 1, lon: 1, value: 1 },
        { lat: 2, lon: 2, value: 5 },
      ],
      shapes: [{ ...line("a"), value: 100 }],
    });
    expect(byPoints.layers.map((layer) => layer.scale?.max)).toEqual([undefined, 5]);
    const byShapes = scene({
      points: [{ lat: 1, lon: 1 }],
      shapes: [
        { ...line("a"), value: 2 },
        { ...area, value: 8 },
      ],
    });
    expect(byShapes.layers.map((layer) => layer.scale?.max)).toEqual([8, 8, undefined]);
    expect(byShapes.marks[0].color).toBe(theme.sequential.at(-1));
  });
});

describe("a map with a list of layers", () => {
  const built = scene({
    regions: { set: "us-states", items: [{ code: "CA", value: 5 }] },
    layers: [
      {
        id: "elevators",
        name: "Elevators",
        kind: "points",
        valueLabel: "Capacity",
        opacity: 0.5,
        points: [
          { lat: 41, lon: -93, value: 10 },
          { lat: 42, lon: -94, value: 30 },
        ],
      },
      {
        id: "depots",
        kind: "points",
        visible: false,
        group: "Sites",
        points: [{ lat: 40, lon: -90 }],
      },
      { id: "plants", kind: "points", points: [{ lat: 39, lon: -91 }] },
      {
        id: "yield",
        kind: "regions",
        regions: {
          set: "us-counties",
          items: [
            { code: "19169", value: 180 },
            { code: "17031", value: 120 },
          ],
        },
      },
    ],
  });

  it("draws the layers in their order, the fills under the lines and the points on top", () => {
    const order = ids(built);
    expect(order.indexOf("l:yield")).toBeLessThan(order.indexOf("l:elevators"));
    expect(order.indexOf("regions")).toBeLessThan(order.indexOf("l:yield"));
    expect(order.indexOf("l:yield-outline")).toBeGreaterThan(
      order.indexOf("state-borders"),
    );
    expect(order.indexOf("l:elevators")).toBeLessThan(order.indexOf("l:depots"));
    expect(order.indexOf("l:depots")).toBeLessThan(order.indexOf("l:plants"));
    expect(built.layers.map((layer) => layer.id)).toEqual([
      "regions",
      "elevators",
      "depots",
      "plants",
      "yield",
    ]);
  });

  it("gives each layer with values a scale of its own, in a hue of its own", () => {
    const [regions, elevators, depots, plants, crop] = built.layers;
    expect(regions.scale).toMatchObject({ min: 5, max: 5 });
    expect(elevators.scale).toMatchObject({ min: 10, max: 30 });
    expect(crop.scale).toMatchObject({ min: 120, max: 180 });
    expect(regions.scale?.stops).toBe(theme.sequential);
    expect(elevators.scale?.stops).toBe(theme.ramps[0]);
    expect(crop.scale?.stops).toBe(theme.ramps[1]);
    expect(depots.scale).toBeNull();
    expect([depots.color, plants.color]).toEqual([theme.series[0], theme.series[1]]);
    const colors = Object.fromEntries(
      built.marks.map((mark) => [`${mark.layer}:${mark.value ?? ""}`, mark.color]),
    );
    expect(colors["elevators:30"]).toBe(theme.ramps[0].at(-1));
    expect(colors["yield:180"]).toBe(theme.ramps[1].at(-1));
    expect(colors["depots:"]).toBe(theme.series[0]);
  });

  it("keeps what the map says of a layer: its name, its folder, off, and how opaque", () => {
    const [, elevators, depots] = built.layers;
    expect(elevators).toMatchObject({
      name: "Elevators",
      valueLabel: "Capacity",
      opacity: 0.5,
    });
    expect(elevators.visible).toBeUndefined();
    expect(depots).toMatchObject({ name: "Points", group: "Sites", visible: false });
    expect(elevators.parts.map((part) => part.id)).toEqual([
      "l:elevators-groups",
      "l:elevators-count",
      "l:elevators",
      "l:elevators-hover",
    ]);
  });

  it("never gives a layer of the list an id of the style that the basemap could have", () => {
    const named = scene({
      layers: [
        { id: "water", kind: "points", points: [{ lat: 1, lon: 1 }] },
        { id: "sea", kind: "points", points: [{ lat: 2, lon: 2 }] },
      ],
    });
    expect(ids(named).filter((id) => id === "sea")).toHaveLength(1);
    expect(ids(named)).toContain("l:water");
    expect(Object.keys(named.sources)).toContain("l:sea");
  });

  it("draws regions of several boundary sets in one map", () => {
    expect(featuresOf(built, "regions")).toHaveLength(1);
    expect(featuresOf(built, "l:yield")).toHaveLength(2);
    expect(built.unshaped).toEqual([]);
    expect(built.layers[4].parts.map((part) => part.id)).toContain("l:yield-mesh");
    expect(ids(built).filter((id) => id === "state-borders")).toHaveLength(1);
  });

  it("names a region whose set has no shapes here, and draws the rest", () => {
    const partial = scene(
      {
        layers: [
          {
            id: "a",
            kind: "regions",
            regions: { set: "us-states", items: [{ code: "CA", value: 1 }] },
          },
          { id: "b", kind: "points", points: [{ lat: 1, lon: 1 }] },
        ],
      },
      { sets: {} },
    );
    expect(partial.unshaped).toEqual(["California"]);
    expect(partial.layers.map((layer) => layer.count)).toEqual([0, 1]);
  });
});

describe("a map that plays", () => {
  const built = scene({
    points: [{ lat: 40, lon: -74, label: "Always" }],
    layers: [
      {
        id: "rate",
        kind: "regions",
        regions: {
          set: "us-states",
          items: [
            { code: "CA", value: 4, time: "2023" },
            { code: "CA", value: 6, time: "2024" },
            { code: "DC", value: 9, time: "2024" },
          ],
        },
      },
    ],
  });

  it("lists the steps and writes the step of a mark into its feature", () => {
    expect(built.frames).toEqual(["2023", "2024"]);
    expect(featuresOf(built, "l:rate").map((item) => item.properties?.t)).toEqual([
      "2023",
      "2024",
      "2024",
    ]);
    expect(featuresOf(built, "points")[0].properties).not.toHaveProperty("t");
    expect(built.marks.map((mark) => mark.time)).toEqual([
      undefined,
      "2023",
      "2024",
      "2024",
    ]);
  });

  it("says which layers of the style show one step, with the filter each has besides", () => {
    expect(built.timed).toEqual([
      { id: "l:rate" },
      { id: "l:rate-outline" },
      { id: "l:rate-marked", filter: ["==", ["get", "m"], 1] },
      { id: "l:rate-small", filter: ["<", ["zoom"], ["get", "z"]] },
    ]);
    expect(built.hover).toContain("l:rate-hover");
  });

  it("has one scale over all the steps of a layer", () => {
    expect(built.layers[1].scale).toMatchObject({ min: 4, max: 9 });
    expect(styleOf(built, "l:rate").type).toBe("fill");
  });
});

describe("layers that measure the same thing", () => {
  const region = (code: string, value: number) => ({ code, value });
  const built = scene({
    layers: [
      {
        id: "gh",
        kind: "regions",
        valueLabel: "Cocoa (tonnes)",
        regions: { set: "us-states", items: [region("CA", 50), region("NV", 245)] },
      },
      {
        id: "ci",
        kind: "regions",
        valueLabel: "Cocoa (tonnes)",
        regions: { set: "us-states", items: [region("TX", 100), region("OK", 556)] },
      },
      {
        id: "other",
        kind: "points",
        valueLabel: "Staff",
        points: [
          { lat: 1, lon: 1, value: 1 },
          { lat: 2, lon: 2, value: 9 },
        ],
      },
    ],
  });
  const [gh, ci, other] = built.layers;

  it("share one scale in one hue, over the values of both: 245 is not as strong as 556", () => {
    expect(gh.scale).toBe(ci.scale);
    expect(gh.scale).toMatchObject({ min: 50, max: 556 });
    const colour = (layer: string, value: number) =>
      built.marks.find((mark) => mark.layer === layer && mark.value === value)?.color;
    expect(colour("gh", 245)).not.toBe(colour("ci", 556));
    expect(colour("ci", 556)).toBe(gh.scale?.stops.at(-1));
  });

  it("leave a layer that measures another thing on a scale of its own", () => {
    expect(other.scale).not.toBe(gh.scale);
    expect(other.scale).toMatchObject({ min: 1, max: 9 });
    expect(other.scale?.stops).not.toBe(gh.scale?.stops);
  });
});

describe("the sources a backend declared, which the map refused", () => {
  it("are on the scene, with the reason of each", () => {
    const refused = [{ backend: "widget", widget: "map", id: "script", reason: "it does not start with http:// or https://" }];
    const built = scene({ points: [{ lat: 1, lon: 1 }] }, { held: { sources: [], ambiguous: [], refused } });
    expect(built.refused).toEqual(refused);
    expect(scene({ points: [{ lat: 1, lon: 1 }] }).refused).toEqual([]);
  });
});
