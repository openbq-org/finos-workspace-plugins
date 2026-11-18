import { describe, expect, it } from "vitest";
import { marksReach } from "~/components/Geo/mapFit";
import { MAP_THEMES } from "~/components/Geo/mapTheme";
import { CLUSTER_MAX_ZOOM, CLUSTER_RADIUS } from "~/components/Geo/scene/clusters";
import {
  COLUMN_SIDES,
  coveredBy,
  extentOf,
  prism,
  TALLEST,
} from "~/components/Geo/scene/columns";
import { ARC_POSITIONS, arc } from "~/components/Geo/scene/flows";
import { fullestPlace } from "~/components/Geo/scene/heat";
import { MAP_LIMITS } from "~/lib/codemode/limits";
import { featuresOf, ids, scene, styleOf, theme } from "./support";

const spread = (count: number, more: (at: number) => object = () => ({})) =>
  Array.from({ length: count }, (_, at) => ({
    lat: 30 + (at % 15),
    lon: -120 + (at % 50),
    ...more(at),
  }));

describe("a layer of density", () => {
  const built = scene({
    layers: [
      {
        id: "storms",
        kind: "heat",
        points: [
          { lat: 40, lon: -100, value: 10, label: "a", tag: "t", marker: "pin" },
          { lat: 41, lon: -101, value: 60 },
          { lat: 42, lon: -102 },
        ],
      },
    ],
  });

  it("is one heatmap layer of the style, under the names of the basemap", () => {
    const layer = styleOf(built, "l:storms");
    expect(layer.type).toBe("heatmap");
    expect(layer.paint["heatmap-weight"]).toEqual(["get", "w"]);
    expect((layer.paint["heatmap-radius"] as unknown[]).slice(0, 3)).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
    ]);
    expect((layer.paint["heatmap-intensity"] as unknown[])[2]).toEqual(["zoom"]);
    expect(built.layers[0]).toMatchObject({
      kind: "heat",
      count: 3,
      swatch: "heat",
      scale: null,
      parts: [{ id: "l:storms", opacity: { "heatmap-opacity": 0.78 } }],
    });
  });

  it("weighs a point by its value within the values of the layer, and never by nothing", () => {
    expect(featuresOf(built, "l:storms").map((item) => item.properties?.w)).toEqual([
      0.1, 1, 0.1,
    ]);
    const plain = scene({
      layers: [{ kind: "heat", points: [{ lat: 1, lon: 1 }] }],
    });
    expect(featuresOf(plain, "l:heat-1")[0].properties?.w).toBe(1);
  });

  it("has the ramp of the theme, which is also what the legend shows", () => {
    const color = styleOf(built, "l:storms").paint["heatmap-color"] as unknown[];
    expect(color[2]).toEqual(["heatmap-density"]);
    expect(color.slice(3, 5)).toEqual([0, "rgba(0,0,0,0)"]);
    expect(color.at(-1)).toBe(theme.heat.at(-1));
    expect(built.layers[0].ramp).toBe(theme.heat);
    const dark = scene(
      { layers: [{ kind: "heat", points: [{ lat: 1, lon: 1 }] }] },
      { theme: MAP_THEMES.dark },
    );
    expect(dark.layers[0].ramp).toBe(MAP_THEMES.dark.heat);
  });

  it("has no mark: a point of a density has no card, no tag and no sign", () => {
    expect(built.marks).toEqual([]);
    expect(built.pointer).toEqual([]);
    expect(built.bounds).toEqual([-102, 40, -100, 42]);
  });

  it("lets each point add less the more points there are", () => {
    const intensity = (count: number) =>
      (
        styleOf(
          scene({ layers: [{ id: "h", kind: "heat", points: spread(count) }] }),
          "l:h",
        ).paint["heatmap-intensity"] as number[]
      )[4];
    expect(intensity(10)).toBe(1);
    expect(intensity(MAP_LIMITS.points)).toBeLessThan(intensity(400));
    expect(intensity(MAP_LIMITS.points)).toBeGreaterThan(0);
  });

  it("reckons its strength from the fullest place, so places are told apart by how full they are", () => {
    const port = (lat: number, lon: number, count: number, time?: string) =>
      Array.from({ length: count }, () => ({ lat, lon, ...(time ? { time } : {}) }));
    const ones = (count: number) => Array.from({ length: count }, () => 1);
    const ports = [...port(4, 3, 80), ...port(34, -118, 10)];
    expect(fullestPlace(ports, ones(90))).toBe(80);
    const year = ["01", "02", "03", "04"].flatMap((month, at) =>
      port(4, 3, 10 + at, `2025-${month}`),
    );
    expect(fullestPlace(year, ones(year.length))).toBe(13);
    expect(fullestPlace([...year, ...port(4, 3, 2)], ones(year.length + 2))).toBe(15);
    const strength = (points: object[]) =>
      (
        styleOf(scene({ layers: [{ id: "h", kind: "heat", points }] }), "l:h").paint[
          "heatmap-intensity"
        ] as number[]
      )[4];
    expect(strength(year)).toBe(strength(port(4, 3, 13)));
  });
});

describe("a layer of clusters", () => {
  const built = scene({
    layers: [
      {
        id: "stores",
        kind: "clusters",
        points: [
          { lat: 40, lon: -100, value: 2, label: "A", tag: "a" },
          { lat: 40.01, lon: -100.01, value: 5 },
        ],
      },
    ],
  });

  it("is a source the map library clusters, which adds up the values", () => {
    expect(built.sources["l:stores"]).toMatchObject({
      type: "geojson",
      cluster: true,
      clusterRadius: CLUSTER_RADIUS,
      clusterMaxZoom: CLUSTER_MAX_ZOOM,
      clusterProperties: { sum: ["+", ["coalesce", ["get", "value"], 0]] },
    });
    expect(featuresOf(built, "l:stores").map((item) => item.properties?.value)).toEqual(
      [2, 5],
    );
  });

  it("draws a circle by the number of points, the number in it, and a point alone as a point", () => {
    const circles = styleOf(built, "l:stores-clusters");
    expect(circles.filter).toEqual(["has", "point_count"]);
    expect((circles.paint["circle-radius"] as unknown[]).slice(0, 2)).toEqual([
      "step",
      ["get", "point_count"],
    ]);
    const count = styleOf(built, "l:stores-count");
    expect(count.type).toBe("symbol");
    expect(count.layout).toMatchObject({
      "text-field": ["get", "point_count_abbreviated"],
      "text-font": ["Noto Sans Medium"],
    });
    expect(JSON.stringify(count)).not.toMatch(/icon/);
    expect(styleOf(built, "l:stores").filter).toEqual(["!", ["has", "point_count"]]);
  });

  it("asks for the glyphs of the app, and only then", () => {
    expect(built.glyphs).toBe(true);
    expect(scene({ points: [{ lat: 1, lon: 1 }] }).glyphs).toBe(false);
  });

  it("reads a point alone like any point, and says where a click on a cluster zooms", () => {
    expect(built.pointer).toEqual(["l:stores"]);
    expect(built.marks).toHaveLength(2);
    expect(built.marks[0]).toMatchObject({ kind: "point", layer: "stores", tag: "a" });
    expect(built.clustered).toHaveLength(1);
    expect(built.clustered[0]).toMatchObject({
      layer: "stores",
      source: "l:stores",
      circles: "l:stores-clusters",
      single: "l:stores",
      timed: false,
    });
    expect(built.layers[0].parts.map((part) => part.id)).toEqual([
      "l:stores-clusters",
      "l:stores-count",
      "l:stores",
      "l:stores-hover",
    ]);
  });

  it("applies a step of time through the points of the source, not through a filter", () => {
    const timed = scene({
      layers: [
        {
          id: "c",
          kind: "clusters",
          points: [
            { lat: 1, lon: 1, time: "1" },
            { lat: 2, lon: 2, time: "2" },
          ],
        },
      ],
    });
    expect(timed.clustered[0].timed).toBe(true);
    expect(timed.clustered[0].features).toHaveLength(2);
    expect(timed.timed).toEqual([]);
  });

  it("takes the most points a map has", () => {
    const many = scene({
      layers: [{ id: "c", kind: "clusters", points: spread(MAP_LIMITS.points) }],
    });
    expect(many.layers[0].count).toBe(MAP_LIMITS.points);
  });
});

describe("the arc of a flow", () => {
  it("has a fixed number of positions from its start to its end", () => {
    const line = arc([-100, 40], [-80, 30]);
    expect(line).toHaveLength(ARC_POSITIONS);
    expect(line[0][0]).toBeCloseTo(-100);
    expect(line[0][1]).toBeCloseTo(40);
    expect(line.at(-1)?.[0]).toBeCloseTo(-80);
    expect(line.at(-1)?.[1]).toBeCloseTo(30);
  });

  it("bends to one side, so a flow and the flow back do not lie on each other", () => {
    const out = arc([-100, 40], [-80, 40]);
    const back = arc([-80, 40], [-100, 40]);
    const middle = (line: [number, number][]) => line[Math.floor(line.length / 2)][1];
    expect(middle(out)).toBeLessThan(39);
    expect(middle(back)).toBeGreaterThan(41);
  });

  it("goes the short way over the 180th meridian, with longitudes that do not jump", () => {
    const line = arc([170, 10], [-170, 10]);
    for (let at = 1; at < line.length; at++)
      expect(Math.abs(line[at][0] - line[at - 1][0])).toBeLessThan(5);
    expect(line.at(-1)?.[0]).toBeCloseTo(190);
    const west = arc([-170, 10], [170, 10]);
    expect(west.at(-1)?.[0]).toBeCloseTo(-190);
  });

  it("stays in the latitudes of the map for a flow near a pole", () => {
    for (const [, lat] of arc([-179, 84], [179, -84]))
      expect(Math.abs(lat)).toBeLessThan(90);
  });
});

describe("a layer of flows", () => {
  const built = scene({
    layers: [
      {
        id: "trade",
        kind: "flows",
        valueLabel: "Tons",
        flows: [
          { from: [-100, 40], to: [-80, 30], value: 10, label: "A to B" },
          { from: [-80, 30], to: [-100, 40], value: 90, label: "B to A" },
          { from: [-90, 35], to: [-95, 45], color: "#ff0000" },
        ],
      },
    ],
  });

  it("draws the arcs with a width by their value, faint at the start and full at the end", () => {
    expect(built.sources["l:trade"]).toMatchObject({
      type: "geojson",
      lineMetrics: true,
    });
    const arcs = featuresOf(built, "l:trade");
    expect(arcs).toHaveLength(3);
    const byMark = Object.fromEntries(arcs.map((item) => [item.properties?.i, item]));
    expect(byMark[1].properties?.w).toBeGreaterThan(byMark[0].properties?.w);
    const lines = ids(built).filter((id) => /^l:trade-\d+$/.test(id));
    expect(lines.length).toBe(3);
    for (const id of lines) {
      const paint = styleOf(built, id).paint;
      const gradient = paint["line-gradient"] as unknown[];
      expect(gradient.slice(0, 3)).toEqual([
        "interpolate",
        ["linear"],
        ["line-progress"],
      ]);
      expect(String(gradient[4])).toMatch(/^rgba\(\d+,\d+,\d+,0\.12\)$/);
      expect(String(gradient[6])).toMatch(/^#[0-9a-f]{6}$/);
      expect(paint["line-width"]).toEqual(["get", "w"]);
    }
  });

  it("colours an arc by the scale of the layer, or by its own colour", () => {
    const [small, large, own] = built.marks;
    expect(small.color).toBe(theme.sequential[0]);
    expect(large.color).toBe(theme.sequential.at(-1));
    expect(own.color).toBe("#ff0000");
    expect(built.layers[0].scale).toMatchObject({ min: 10, max: 90 });
  });

  it("marks where each flow ends with a dot", () => {
    const ends = featuresOf(built, "l:trade-ends");
    const end = ends.find((item) => item.properties?.i === 0);
    const [lon, lat] = (end?.geometry as { coordinates: number[] }).coordinates;
    expect(lon).toBeCloseTo(-80);
    expect(lat).toBeCloseTo(30);
    expect(styleOf(built, "l:trade-ends").type).toBe("circle");
  });

  it("reaches as far past its line as its end dot and its width are drawn", () => {
    const paint = styleOf(built, "l:trade-ends").paint;
    const [, [, , share], more] = paint["circle-radius"] as [
      string,
      [string, unknown, number],
      number,
    ];
    const outline = paint["circle-stroke-width"] as number;
    const drawn = featuresOf(built, "l:trade-ends").map((end) => {
      const width = end.properties?.w as number;
      return Math.max(width * share + more + outline, width / 2);
    });
    expect(marksReach(built.marks)).toBeCloseTo(Math.max(...drawn), 6);
    expect(marksReach(built.marks)).toBeGreaterThan(4);

    const glowing = scene({
      layers: [
        {
          id: "lit",
          kind: "flows",
          flows: [{ from: [-100, 40], to: [-80, 30], value: 10, highlight: true }],
        },
      ],
    });
    const glow = styleOf(glowing, "l:lit-highlight").paint["line-width"] as [
      string,
      unknown,
      number,
    ];
    const width = featuresOf(glowing, "l:lit")[0].properties?.w as number;
    expect(marksReach(glowing.marks)).toBeGreaterThanOrEqual((width + glow[2]) / 2);
  });

  it("has a card for each flow, anchored at the middle of its arc", () => {
    expect(built.marks.map((mark) => [mark.kind, mark.layer, mark.label])).toEqual([
      ["flow", "trade", "A to B"],
      ["flow", "trade", "B to A"],
      ["flow", "trade", undefined],
    ]);
    const [lon, lat] = built.marks[0].at as [number, number];
    expect(lon).toBeCloseTo(-90.78676, 4);
    expect(lat).toBeCloseTo(33.28287, 4);
    for (const [at, mark] of built.marks.entries()) {
      const drawn = featuresOf(built, "l:trade").find(
        (item) => item.properties?.i === at,
      );
      const line = (drawn?.geometry as { coordinates: number[][] }).coordinates;
      expect(line).toHaveLength(24);
      expect(mark.at).toEqual(line[12]);
    }
    expect(built.marks[0].key).toBeUndefined();
    expect(built.hover).toEqual(["l:trade-hover"]);
    expect(built.pointer).toContain("l:trade-ends");
    expect(built.layers[0]).toMatchObject({ swatch: "arc", count: 3 });
  });

  it("draws the larger flow over the smaller one", () => {
    const order = featuresOf(built, "l:trade").map((item) => item.properties?.i);
    expect(order.indexOf(1)).toBeGreaterThan(order.indexOf(0));
  });

  it("keeps to a few layers of the style whatever colours the flows bring", () => {
    const many = scene({
      layers: [
        {
          id: "f",
          kind: "flows",
          flows: Array.from({ length: MAP_LIMITS.flows }, (_, at) => ({
            from: [-120 + (at % 40), 30 + (at % 15)],
            to: [-80 - (at % 30), 45 - (at % 12)],
            color: `#${(at * 2713).toString(16).padStart(6, "0").slice(-6)}`,
          })),
        },
      ],
    });
    expect(many.marks).toHaveLength(MAP_LIMITS.flows);
    expect(ids(many).filter((id) => /^l:f-\d+$/.test(id)).length).toBeLessThanOrEqual(
      12,
    );
  });
});

describe("a layer of columns", () => {
  it("raises each region by its value, the tallest a fixed part of what the layer covers", () => {
    const built = scene({
      layers: [
        {
          id: "gdp",
          kind: "columns",
          regions: {
            set: "us-states",
            items: [
              { code: "CA", value: 100 },
              { code: "TX", value: 50 },
              { code: "NY" },
            ],
          },
        },
      ],
    });
    const layer = styleOf(built, "l:gdp");
    expect(layer.type).toBe("fill-extrusion");
    expect(layer.paint).toMatchObject({
      "fill-extrusion-height": ["get", "h"],
      "fill-extrusion-color": ["get", "color"],
      "fill-extrusion-base": 0,
    });
    const [ca, tx, ny] = featuresOf(built, "l:gdp").map((item) => item.properties?.h);
    const most = extentOf(built.bounds) * TALLEST;
    expect(ca).toBeLessThanOrEqual(most);
    expect(ca).toBeGreaterThan(most / 2);
    expect(tx).toBeCloseTo(ca / 2, -1);
    expect(ny).toBeGreaterThan(0);
    expect(ny).toBeLessThan(ca / 20);
    expect(built.marks[0]).toMatchObject({ kind: "region", layer: "gdp", key: "r:06" });
    expect(built.layers[0]).toMatchObject({
      kind: "columns",
      swatch: "column",
      count: 3,
      parts: [
        { id: "l:gdp", opacity: { "fill-extrusion-opacity": 1 } },
        { id: "l:gdp-hover", opacity: {} },
      ],
    });
  });

  it("stands a prism of twelve sides on each point", () => {
    const built = scene({
      layers: [
        {
          id: "plants",
          kind: "columns",
          points: [
            { lat: 40, lon: -100, value: 4, label: "A" },
            { lat: 42, lon: -90, value: 8 },
          ],
        },
      ],
    });
    const [low, tall] = featuresOf(built, "l:plants");
    const ring = (low.geometry as { coordinates: number[][][] }).coordinates[0];
    expect(ring).toHaveLength(COLUMN_SIDES + 1);
    expect(ring[0]).toEqual(ring.at(-1));
    expect(tall.properties?.h).toBeCloseTo(2 * low.properties?.h, -1);
    expect(built.marks[0]).toMatchObject({
      kind: "point",
      layer: "plants",
      label: "A",
    });
    expect(built.marks[0].at).toEqual([-100, 40]);
  });

  it("stands the columns of a few buildings of one block apart: each is narrower than the way to the next", () => {
    const block = [
      { lat: 41.8772, lon: -87.6364, value: 37 },
      { lat: 41.8775, lon: -87.636, value: 16 },
      { lat: 41.8777, lon: -87.6362, value: 25 },
    ];
    const built = scene({ layers: [{ id: "b", kind: "columns", points: block }] });
    const widths = featuresOf(built, "l:b").map((column) => {
      const lons = (
        column.geometry as { coordinates: number[][][] }
      ).coordinates[0].map(([lon]) => lon);
      return Math.max(...lons) - Math.min(...lons);
    });
    for (const width of widths) expect(width).toBeLessThan(0.0004);
    const far = scene({
      layers: [
        {
          id: "b",
          kind: "columns",
          points: block.map((point, at) => ({ ...point, lon: point.lon + at * 10 })),
        },
      ],
    });
    const [ring] = (featuresOf(far, "l:b")[0].geometry as { coordinates: number[][][] })
      .coordinates;
    expect(
      Math.max(...ring.map(([lon]) => lon)) - Math.min(...ring.map(([lon]) => lon)),
    ).toBeGreaterThan(0.1);
  });

  it("does not let a few far places decide how tall every column is", () => {
    const near = Array.from({ length: 40 }, (_, at): [number, number] => [
      -100 + (at % 8),
      35 + Math.floor(at / 8),
    ]);
    const box = coveredBy([...near, [144.8, 13.4], [-170, 60]]);
    expect(box?.[0]).toBeGreaterThanOrEqual(-100);
    expect(box?.[2]).toBeLessThanOrEqual(-93);
    expect(
      coveredBy([
        [0, 0],
        [10, 20],
      ]),
    ).toEqual([0, 0, 10, 20]);
    expect(coveredBy([])).toBeNull();
  });

  it("makes a prism as wide in metres at any latitude", () => {
    const width = (lat: number) => {
      const ring = prism(0, lat, 10_000);
      const lons = ring.map(([lon]) => lon);
      return (Math.max(...lons) - Math.min(...lons)) * Math.cos((lat * Math.PI) / 180);
    };
    expect(width(60)).toBeCloseTo(width(0), 5);
  });

  it("never has a column of no height or of a height out of proportion", () => {
    const one = scene({
      layers: [
        { id: "c", kind: "columns", points: [{ lat: 10, lon: 10, value: 1e12 }] },
      ],
    });
    const [only] = featuresOf(one, "l:c");
    expect(only.properties?.h).toBe(Math.round(20_000 * TALLEST));
    const negative = scene({
      layers: [
        {
          id: "c",
          kind: "columns",
          points: [
            { lat: 10, lon: 10, value: -5 },
            { lat: 11, lon: 11, value: -1 },
          ],
        },
      ],
    });
    for (const item of featuresOf(negative, "l:c")) {
      expect(item.properties?.h).toBeGreaterThan(0);
      expect(Number.isFinite(item.properties?.h)).toBe(true);
    }
  });

  it("takes the most points and the most regions a map has", () => {
    const points = scene({
      layers: [
        {
          id: "c",
          kind: "columns",
          points: spread(MAP_LIMITS.points, (at) => ({ value: at })),
        },
      ],
    });
    expect(featuresOf(points, "l:c")).toHaveLength(MAP_LIMITS.points);
  });
});
