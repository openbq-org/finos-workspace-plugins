import { describe, expect, it } from "vitest";
import { MAP_THEMES } from "~/components/Geo/mapTheme";
import { featuresOf, ids, scene, styleOf, theme } from "./support";

const LINE = {
  type: "line",
  coordinates: [
    [-100, 40],
    [-90, 42],
  ],
};
const AREA = {
  type: "polygon",
  coordinates: [
    [
      [-100, 40],
      [-90, 40],
      [-90, 45],
      [-100, 40],
    ],
  ],
};

describe("the tone of the marks of a scene", () => {
  const built = scene({
    points: [
      { lat: 40, lon: -100, marker: 1 },
      { lat: 41, lon: -101, marker: "flag", markerColor: "negative" },
      { lat: 42, lon: -102, highlight: true, markerColor: "#123456" },
      { lat: 43, lon: -103 },
    ],
  });

  it("is the colour of the theme for a tone, the accent without one, and its own colour", () => {
    expect(built.marks.map((mark) => mark.tone)).toEqual([
      theme.tones.accent,
      theme.tones.negative,
      "#123456",
      undefined,
    ]);
    expect(built.marks.map((mark) => mark.marker)).toEqual([
      1,
      "flag",
      undefined,
      undefined,
    ]);
    expect(built.marks.map((mark) => mark.highlight)).toEqual([
      undefined,
      undefined,
      true,
      undefined,
    ]);
  });

  it("follows the theme", () => {
    const dark = scene(
      { points: [{ lat: 40, lon: -100, marker: "star", markerColor: "positive" }] },
      { theme: MAP_THEMES.dark },
    );
    expect(dark.marks[0].tone).toBe(MAP_THEMES.dark.tones.positive);
  });
});

describe("a highlighted point", () => {
  const built = scene({
    points: [
      { lat: 40, lon: -100, highlight: true, markerColor: "positive", size: 4 },
      { lat: 41, lon: -101 },
    ],
  });

  it("has a halo in its tone under the points, around its dot", () => {
    const halo = styleOf(built, "points-highlight");
    expect(halo.type).toBe("circle");
    expect(halo.source).toBe("points");
    expect(halo.filter).toEqual(["==", ["get", "h"], 1]);
    expect(halo.paint["circle-color"]).toEqual(["get", "hc"]);
    expect(halo.paint["circle-stroke-color"]).toEqual(["get", "hc"]);
    expect(halo.paint["circle-radius"]).toEqual(["+", ["get", "r"], 5]);
    expect(ids(built).indexOf("points-highlight")).toBeLessThan(
      ids(built).indexOf("points"),
    );
    expect(featuresOf(built, "points").map((item) => item.properties?.h)).toEqual([
      1,
      undefined,
    ]);
    expect(featuresOf(built, "points")[0].properties?.hc).toBe(theme.tones.positive);
  });

  it("is part of its layer: it goes with the layer when a reader hides or fades it", () => {
    expect(built.layers[0].parts.map((part) => part.id)).toContain("points-highlight");
    expect(styleOf(built, "points").paint["circle-color"]).toEqual(["get", "color"]);
  });

  it("adds nothing to a map without a highlight", () => {
    const plain = scene({ points: [{ lat: 40, lon: -100, marker: "pin" }] });
    expect(ids(plain)).not.toContain("points-highlight");
    expect(featuresOf(plain, "points")[0].properties).not.toHaveProperty("h");
  });
});

describe("a marked or highlighted region", () => {
  const built = scene({
    regions: {
      set: "us-states",
      items: [
        { code: "CA", value: 1, marker: "star" },
        { code: "TX", value: 2, marker: 2, markerColor: "negative" },
        { code: "NY", value: 3, highlight: true, markerColor: "#00aa00" },
        { code: "FL", value: 4 },
      ],
    },
  });

  it("has an outline in its tone, thicker for a highlight", () => {
    const outline = styleOf(built, "regions-marked");
    expect(outline.filter).toEqual(["==", ["get", "m"], 1]);
    expect(outline.paint["line-color"]).toEqual(["get", "mc"]);
    expect(outline.paint["line-width"]).toEqual([
      "case",
      ["==", ["get", "h"], 1],
      3.6,
      2.4,
    ]);
    expect(
      featuresOf(built, "regions").map((item) => [
        item.properties?.m,
        item.properties?.mc,
        item.properties?.h,
      ]),
    ).toEqual([
      [1, theme.tones.accent, undefined],
      [1, theme.tones.negative, undefined],
      [1, "#00aa00", 1],
      [0, undefined, undefined],
    ]);
  });
});

describe("a highlighted line, area and flow", () => {
  const built = scene({
    shapes: [
      { ...LINE, highlight: true },
      { ...LINE, value: 1 },
      { ...AREA, highlight: true, markerColor: "neutral" },
    ],
    layers: [
      {
        id: "trade",
        kind: "flows",
        flows: [
          { from: [-100, 40], to: [-90, 30], value: 5, highlight: true },
          { from: [-100, 40], to: [-80, 35], value: 2 },
        ],
      },
    ],
  });

  it("gives a line a wider line in its tone under it", () => {
    const glow = styleOf(built, "lines-highlight");
    expect(glow.type).toBe("line");
    expect(glow.filter).toEqual(["==", ["get", "h"], 1]);
    expect(glow.paint["line-color"]).toEqual(["get", "hc"]);
    expect(glow.paint["line-width"]).toBeGreaterThan(
      styleOf(built, "lines").paint["line-width"] as number,
    );
    expect(ids(built).indexOf("lines-highlight")).toBeLessThan(
      ids(built).indexOf("lines"),
    );
    expect(featuresOf(built, "lines")[0].properties?.hc).toBe(theme.tones.accent);
  });

  it("gives an area a thicker outline in its tone over its own", () => {
    const glow = styleOf(built, "polygons-highlight");
    expect(glow.type).toBe("line");
    expect(glow.paint["line-color"]).toEqual(["get", "hc"]);
    expect(ids(built).indexOf("polygons-highlight")).toBeGreaterThan(
      ids(built).indexOf("polygons-outline"),
    );
    expect(featuresOf(built, "polygons")[0].properties?.hc).toBe(theme.tones.neutral);
  });

  it("gives a flow a wider arc in its tone under the arcs", () => {
    const glow = styleOf(built, "l:trade-highlight");
    expect(glow.type).toBe("line");
    expect(glow.filter).toEqual(["==", ["get", "h"], 1]);
    expect(glow.paint["line-width"]).toEqual(["+", ["get", "w"], 5]);
    const style = ids(built);
    const arcs = style.filter((id) => /^l:trade-\d+$/.test(id));
    expect(arcs.length).toBeGreaterThan(0);
    for (const id of arcs)
      expect(style.indexOf("l:trade-highlight")).toBeLessThan(style.indexOf(id));
    expect(built.marks.find((mark) => mark.kind === "flow")?.highlight).toBe(true);
  });

  it("adds no layer of the style to shapes and flows without a highlight", () => {
    const plain = scene({
      shapes: [LINE, AREA],
      layers: [{ kind: "flows", flows: [{ from: [-100, 40], to: [-90, 30] }] }],
    });
    expect(ids(plain).filter((id) => id.endsWith("-highlight"))).toEqual([]);
  });
});
