import { describe, expect, it } from "vitest";
import { GROUP_MAX_ZOOM, GROUP_RADIUS } from "~/components/Geo/mapCrowd";
import {
  BUBBLE_OPACITY,
  KEPT_APART,
  TRACK_RADIUS,
} from "~/components/Geo/scene/points";
import { featuresOf, scene, styleOf, theme } from "./support";

const spread = (count: number, more: (at: number) => object = () => ({})) =>
  Array.from({ length: count }, (_, at) => ({
    lat: (at % 15) - 7,
    lon: 95 + (at % 25),
    ...more(at),
  }));
const sourceOf = (built: ReturnType<typeof scene>, id: string) =>
  built.sources[id] as unknown as Record<string, unknown>;

const fillOf = (built: ReturnType<typeof scene>) => {
  const [word, some, ground, fill] = styleOf(built, "points-groups").paint[
    "circle-color"
  ] as [string, unknown, string, unknown];
  expect([word, some, ground]).toEqual([
    "case",
    [">", ["to-number", ["get", "marked"]], 0],
    theme.markStroke,
  ]);
  return fill as unknown[] | string;
};

describe("a layer of points that can be drawn in counted circles", () => {
  it("is one source the map library can make clusters of, apart until a view says it is crowded", () => {
    const built = scene({ points: spread(40) });
    expect(sourceOf(built, "points")).toMatchObject({
      cluster: false,
      clusterRadius: GROUP_RADIUS,
      clusterMaxZoom: GROUP_MAX_ZOOM,
    });
    expect(built.clustered).toMatchObject([
      {
        layer: "points",
        source: "points",
        circles: "points-groups",
        single: "points",
        optional: { radius: GROUP_RADIUS, maxZoom: GROUP_MAX_ZOOM },
      },
    ]);
    expect(built.layers[0]).toMatchObject({ groupable: true, count: 40 });
    expect(built.pointer).toEqual(["points"]);
    expect(styleOf(built, "points").filter).toEqual(["!", ["has", "point_count"]]);
    expect(built.glyphs).toBe(true);
  });

  it("stays the layer it always was for one point: nothing can lie on it", () => {
    const built = scene({ points: spread(1) });
    expect(sourceOf(built, "points").cluster).toBeUndefined();
    expect(built.clustered).toEqual([]);
    expect(built.layers[0].groupable).toBeUndefined();
  });

  it("gives a circle the colour of the category most of its points have", () => {
    const built = scene({
      categoryLabel: "country",
      points: spread(30, (at) => ({ category: at % 3 ? "Indonesia" : "Malaysia" })),
    });
    const [first, second] = built.categories;
    expect(sourceOf(built, "points").clusterProperties).toMatchObject({
      c0: ["+", ["case", ["==", ["get", "c"], 0], 1, 0]],
      c1: ["+", ["case", ["==", ["get", "c"], 1], 1, 0]],
      plain: ["+", ["case", ["has", "p"], 1, 0]],
    });
    const colour = fillOf(built);
    expect(colour[0]).toBe("case");
    const named = Object.fromEntries(built.categories.map((c) => [c.name, c.color]));
    expect(colour[2]).toBe(named.Malaysia);
    expect(colour[4]).toBe(named.Indonesia);
    expect(colour.at(-1)).toBe(built.layers[0].color);
    expect([first.color, second.color]).toContain(colour[2]);
  });

  it("gives a circle of points on a scale the colour of the average of its values", () => {
    const built = scene({ points: spread(30, (at) => ({ value: at })) });
    const scale = built.layers[0].scale;
    expect(sourceOf(built, "points").clusterProperties).toMatchObject({
      sum: ["+", ["coalesce", ["get", "value"], 0]],
      valued: ["+", ["case", ["has", "value"], 1, 0]],
    });
    const colour = fillOf(built);
    const [, has, ramp, none] = colour as [string, unknown, unknown[], string];
    expect(has).toEqual([">", ["to-number", ["get", "valued"]], 0]);
    expect(ramp.slice(0, 3)).toEqual([
      "interpolate",
      ["linear"],
      ["/", ["to-number", ["get", "sum"]], ["to-number", ["get", "valued"]]],
    ]);
    expect(ramp.slice(3, 5)).toEqual([0, scale?.stops[0]]);
    expect(ramp.slice(-2)).toEqual([29, scale?.stops.at(-1)]);
    expect(none).toBe(theme.tones.neutral);
    const plain = scene({ points: spread(30) });
    expect(fillOf(plain)).toBe(theme.mark);
  });

  it("keeps the few points an answer singles out apart, each drawn by itself", () => {
    const built = scene({
      points: spread(40, (at) => (at < 5 ? { marker: at + 1, tag: `#${at + 1}` } : {})),
    });
    expect(featuresOf(built, "points")).toHaveLength(35);
    expect(featuresOf(built, "points-apart")).toHaveLength(5);
    expect(sourceOf(built, "points-apart").cluster).toBeUndefined();
    expect(built.clustered[0]).toMatchObject({ kept: "points-apart" });
    expect(built.pointer).toEqual(["points", "points-apart"]);
    expect(
      featuresOf(built, "points").every((item) => item.properties?.m === undefined),
    ).toBe(true);
  });

  it("lets more singled out points than are read one by one join the circles, which say how many they hold", () => {
    const built = scene({
      points: spread(100, (at) =>
        at < KEPT_APART + 8 ? { marker: "star", markerColor: "negative" } : {},
      ),
    });
    expect(built.sources["points-apart"]).toBeUndefined();
    expect(featuresOf(built, "points")).toHaveLength(100);
    expect(
      featuresOf(built, "points").filter((item) => item.properties?.m === 1),
    ).toHaveLength(KEPT_APART + 8);
    const circles = styleOf(built, "points-groups");
    expect(circles.paint["circle-stroke-color"]).toEqual([
      "case",
      [">", ["to-number", ["get", "marked"]], 0],
      theme.tones.negative,
      theme.markStroke,
    ]);
    const words = JSON.stringify(styleOf(built, "points-count").layout["text-field"]);
    expect(words).toContain('"marked"');
    expect(words).toContain("of ");
  });

  it("draws a point with a colour of its own as a point of no category in a circle", () => {
    const built = scene({
      points: spread(4, (at) => ({
        category: "a",
        ...(at ? {} : { color: "#ff0000" }),
      })),
    });
    expect(featuresOf(built, "points").map((item) => item.properties?.p)).toEqual([
      1,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("points sized by a value: bubbles", () => {
  const stores = spread(40, (at) => ({ size: 100 + at * 50, label: `Store ${at}` }));
  const built = scene({ sizeLabel: "revenue_musd", points: stores });

  it("are drawn the larger under the smaller, see-through, each with a ring", () => {
    const dots = styleOf(built, "points");
    expect(dots.layout?.["circle-sort-key"]).toEqual(["-", 0, ["get", "r"]]);
    expect(dots.paint).toMatchObject({
      "circle-opacity": BUBBLE_OPACITY,
      "circle-stroke-color": theme.markStroke,
      "circle-stroke-width": 1.5,
    });
    expect(built.layers[0]).toMatchObject({
      sized: true,
      sizeLabel: "revenue musd",
    });
    expect(built.marks[3]).toMatchObject({ size: 250 });
  });

  it("say the sum of their sizes when they are grouped, never how many they are", () => {
    expect(sourceOf(built, "points").clusterProperties).toMatchObject({
      total: ["+", ["coalesce", ["get", "size"], 0]],
    });
    expect(featuresOf(built, "points")[3].properties).toMatchObject({ size: 250 });
    expect(built.clustered[0]).toMatchObject({ sized: true });
    const count = styleOf(built, "points-count");
    const text = JSON.stringify(count.layout?.["text-field"]);
    expect(text).toContain('["to-number",["get","total"]]');
    expect(text).not.toContain("point_count");
    expect(
      JSON.stringify(styleOf(built, "points-groups").paint["circle-radius"]),
    ).toContain('["sqrt",["/",["to-number",["get","total"]],2050]]');
  });

  it("leave plain points as they were: opaque dots and counted circles", () => {
    const plain = scene({ points: spread(40) });
    expect(styleOf(plain, "points").layout).toBeUndefined();
    expect(styleOf(plain, "points").paint["circle-opacity"]).toBe(0.92);
    expect(plain.layers[0].sized).toBeUndefined();
    expect(sourceOf(plain, "points").clusterProperties).not.toHaveProperty("total");
  });
});

describe("the points of a track", () => {
  const places = spread(12);
  const line = {
    type: "line",
    coordinates: places.map(({ lon, lat }) => [lon, lat]),
  };

  it("are small vertices of the line through them, and are not grouped by the map", () => {
    const built = scene({
      layers: [
        { kind: "lines", shapes: [line] },
        { id: "positions", kind: "points", points: places },
      ],
    });
    expect(built.clustered[0]).toMatchObject({ layer: "positions", track: true });
    expect(
      featuresOf(built, "l:positions").every(
        (dot) => dot.properties?.r === TRACK_RADIUS,
      ),
    ).toBe(true);
    expect(built.layers[1].groupable).toBe(true);
  });

  it("keep the sizes they have", () => {
    const built = scene({
      layers: [
        { kind: "lines", shapes: [line] },
        {
          id: "positions",
          kind: "points",
          points: places.map((place, at) => ({ ...place, size: at + 1 })),
        },
      ],
    });
    const radii = featuresOf(built, "l:positions").map((dot) => dot.properties?.r);
    expect(new Set(radii).size).toBeGreaterThan(3);
  });

  it("are not the points of a map whose line goes somewhere else", () => {
    const built = scene({
      layers: [
        {
          kind: "lines",
          shapes: [
            {
              type: "line",
              coordinates: [
                [0, 0],
                [1, 1],
              ],
            },
          ],
        },
        { id: "positions", kind: "points", points: places },
      ],
    });
    expect(built.clustered[0].track).toBeUndefined();
  });
});

describe("points with a tag", () => {
  it("are never in a circle while they are few: they are drawn one by one, as the marked are", () => {
    const built = scene({
      points: spread(40, (at) => (at < 5 ? { tag: `Top ${at + 1}` } : {})),
    });
    expect(featuresOf(built, "points-apart")).toHaveLength(5);
    expect(featuresOf(built, "points")).toHaveLength(35);
  });

  it("join the others when they are more than can be read one by one", () => {
    const built = scene({ points: spread(40, (at) => ({ tag: `Store ${at}` })) });
    expect(Object.keys(built.sources)).not.toContain("points-apart");
    expect(featuresOf(built, "points")).toHaveLength(40);
    expect(featuresOf(built, "points").some((dot) => dot.properties?.m === 1)).toBe(
      false,
    );
  });
});
