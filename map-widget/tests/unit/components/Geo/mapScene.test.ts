import { describe, expect, it } from "vitest";
import { colorAt, MAP_THEMES, mapScale, shortNumber } from "~/components/Geo/mapTheme";
import { MAP_LIMITS } from "~/lib/codemode/limits";
import { boundsOf } from "~/lib/geo/regions/boundaries";
import { cpuBudget, cpuNow } from "../../machinePace";
import { counties, scene, states, theme, world } from "./scene/support";

describe("boundaries", () => {
  it("has a shape for each region by its code, and by nothing else", () => {
    expect(states.shapeOf("06")?.properties).toEqual({
      code: "06",
      name: "California",
    });
    expect(world.shapeOf("840")?.properties.name).toBe("United States of America");
    expect(counties.shapeOf("06037")?.properties.name).toBe("Los Angeles");
    expect(counties.shapeOf("17:cook")).toBeUndefined();
    expect(counties.shapeOf("17031")?.properties.name).toBe("Cook");
    expect(counties.shapes.features).toHaveLength(3231);
  });

  it("keeps a ring that crosses the 180th meridian in one piece", () => {
    for (const shape of [world.shapeOf("643"), states.shapeOf("02")]) {
      const jumps: number[] = [];
      const visit = (value: unknown) => {
        if (!Array.isArray(value)) return;
        if (Array.isArray(value[0]) && typeof value[0][0] === "number")
          (value as number[][]).forEach(([lon], at) => {
            if (at > 0) jumps.push(Math.abs(lon - (value as number[][])[at - 1][0]));
          });
        else value.forEach(visit);
      };
      visit(
        shape && "coordinates" in shape.geometry ? shape.geometry.coordinates : null,
      );
      expect(Math.max(...jumps)).toBeLessThan(180);
    }
  });

  it("measures Alaska west of the meridian, as one box", () => {
    const alaska = states.shapeOf("02");
    const box = alaska && boundsOf(alaska, true);
    expect(box?.[0]).toBeLessThan(-180);
    expect(box?.[2]).toBeLessThan(-129);
  });
});

describe("buildScene", () => {
  it("has no source with an address, no glyphs and no text layer", () => {
    const built = scene({
      title: "T",
      points: [{ lat: 40, lon: -74, tag: "x", value: 1 }],
      regions: { set: "us-states", items: [{ code: "CA", value: 5 }] },
      shapes: [
        {
          type: "line",
          coordinates: [
            [-80, 30],
            [-70, 40],
          ],
        },
      ],
    });
    for (const source of Object.values(built.sources)) {
      expect(source.type).toBe("geojson");
      expect(typeof (source as { data: unknown }).data).toBe("object");
    }
    expect(built.style.map((layer) => layer.type)).not.toContain("symbol");
    expect(JSON.stringify(built.style)).not.toMatch(/https?:|url|glyph|sprite/i);
  });

  it("has no scale for a layer whose marks are all drawn in the colours of their categories", () => {
    const elevator = (category: string | undefined, value: number, lon: number) => ({
      lat: 40,
      lon,
      value,
      ...(category === undefined ? {} : { category }),
    });
    const built = scene({
      layers: [
        {
          id: "keyed",
          kind: "points",
          valueLabel: "Capacity (bu)",
          points: [elevator("river", 400000, -90), elevator("rail", 7580000, -91)],
        },
        {
          id: "mixed",
          kind: "points",
          points: [elevator("river", 1, -92), elevator(undefined, 9, -93)],
        },
        {
          id: "shaded",
          kind: "regions",
          regions: {
            set: "us-states",
            items: [
              { code: "IA", value: 1, category: "river" },
              { code: "IL", value: 2, category: "rail" },
            ],
          },
        },
      ],
    });
    const [keyed, mixed, shaded] = built.layers;
    expect(keyed.scale).toBeNull();
    expect(keyed.categories).toEqual([theme.categories[1], theme.categories[0]]);
    expect(keyed.valueLabel).toBe("Capacity (bu)");
    expect(built.marks.slice(0, 2).map((mark) => mark.value)).toEqual([
      400000, 7580000,
    ]);
    expect(mixed.scale).toMatchObject({ min: 1, max: 9 });
    expect(mixed.categories).toBeUndefined();
    expect(shaded.scale).toMatchObject({ min: 1, max: 2 });
    expect(shaded.categories).toBeUndefined();
    expect(built.scale).toBe(mixed.scale);
  });

  it("gives each category one colour of the theme on every layer, in the order of the names", () => {
    const area = (category: string, lon: number) => ({
      type: "polygon",
      category,
      coordinates: [
        [
          [lon, 40],
          [lon + 1, 40],
          [lon + 1, 41],
          [lon, 40],
        ],
      ],
    });
    const built = scene({
      categoryLabel: "crop",
      points: [{ lat: 40, lon: -90, category: "corn" }],
      layers: [
        { kind: "polygons", shapes: [area("soy", -93), area("corn", -95)] },
        {
          kind: "polygons",
          shapes: [area("corn", -97), { ...area("soy", -99), color: "#123456" }],
        },
      ],
    });
    expect(built.categories).toEqual([
      { name: "corn", color: theme.categories[0] },
      { name: "soy", color: theme.categories[1] },
    ]);
    const lanes = scene({
      categoryLabel: "mode",
      layers: [
        {
          kind: "flows",
          flows: [
            { from: [4.5, 51.9], to: [121.5, 31.2], value: 3, category: "Sea" },
            { from: [4.5, 51.9], to: [-74, 40.7], value: 1, category: "Air" },
          ],
        },
      ],
    });
    expect(lanes.categories).toEqual([]);
    expect(built.categoryLabel).toBe("crop");
    expect(built.layers.map((layer) => layer.categories)).toEqual([
      [theme.categories[0]],
      [theme.categories[1], theme.categories[0]],
      [theme.categories[0], theme.categories[1]],
    ]);
    expect(
      built.style.filter((layer) => layer.type === "fill").map((layer) => layer.paint),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ "fill-opacity": 0.55 })]),
    );
    expect(built.marks.map((mark) => mark.color)).toEqual([
      theme.categories[0],
      theme.categories[1],
      theme.categories[0],
      theme.categories[0],
      "#123456",
    ]);
    expect(scene({ points: [{ lat: 1, lon: 1 }] }).categories).toEqual([]);
    for (const palette of [MAP_THEMES.light.categories, MAP_THEMES.dark.categories]) {
      expect(new Set(palette).size).toBe(MAP_LIMITS.categories);
      for (const color of palette) expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("shades a region by its value and keeps what its card shows", () => {
    const built = scene({
      valueLabel: "Rate",
      regions: {
        set: "us-states",
        items: [
          { code: "CA", value: 6, tag: "6%" },
          { code: "TX", value: 2 },
          { code: "NY", color: "#ff0000" },
        ],
      },
    });
    expect(built.scale).toMatchObject({ min: 2, max: 6, diverging: false });
    const [ca, tx, ny] = built.marks;
    expect(ca).toMatchObject({
      kind: "region",
      key: "r:06",
      label: "California",
      value: 6,
      tag: "6%",
    });
    expect(ca.color).toBe(theme.sequential.at(-1));
    expect(tx.color).toBe(theme.sequential[0]);
    expect(ny.color).toBe("#ff0000");
    expect(ca.at?.[0]).toBeCloseTo(-119.98);
  });

  it("uses two hues that meet at zero for values on both sides of it", () => {
    const built = scene({
      regions: {
        set: "countries",
        items: [
          { code: "DE", value: -2 },
          { code: "FR", value: 1 },
        ],
      },
    });
    expect(built.scale).toMatchObject({ min: -2, max: 2, diverging: true });
    expect(built.scale?.color(0)).toBe(theme.diverging[2]);
  });

  it("draws a region of a few pixels as a dot too, until the map is close enough for its shape", () => {
    const built = scene({
      regions: {
        set: "us-states",
        items: [
          { code: "DC", value: 6, marker: "star", tag: "DC 6.0%" },
          { code: "CA", value: 5.5 },
        ],
      },
    });
    const source = built.sources["regions-small"] as unknown as {
      data: { features: { properties: { i: number; z: number } }[] };
    };
    expect(source.data.features.map((dot) => dot.properties.i)).toEqual([0]);
    expect(source.data.features[0].properties.z).toBeGreaterThan(5);
    expect(source.data.features[0].properties.z).toBeLessThan(9);
    const layer = built.style.find((item) => item.id === "regions-small");
    expect(layer).toMatchObject({
      type: "circle",
      filter: ["<", ["zoom"], ["get", "z"]],
    });
    expect(built.marks[0]).toMatchObject({
      label: "District of Columbia",
      marker: "star",
      tag: "DC 6.0%",
    });
    expect(built.marks[0].at?.[0]).toBeCloseTo(-77.02, 1);
  });

  it("draws no dots where most regions are small: counties are shaded, not a heap of dots", () => {
    const all = counties.shapes.features.map((shape, at) => ({
      code: shape.properties.code,
      value: at % 90,
    }));
    const country = scene({ regions: { set: "us-counties", items: all } });
    expect(country.sources["regions-small"]).toBeUndefined();
    expect(country.style.some((item) => item.id === "regions-small")).toBe(false);
    const width = (built: typeof country) =>
      (
        built.style.find((item) => item.id === "regions-outline") as {
          paint: { "line-width": unknown };
        }
      ).paint["line-width"];
    expect(width(country)).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      4,
      0.15,
      7,
      1,
    ]);
    expect(
      width(
        scene({ regions: { set: "us-states", items: [{ code: "CA", value: 1 }] } }),
      ),
    ).toBe(1);
    const marked = (count: number) =>
      (
        scene({
          regions: {
            set: "us-counties",
            items: all.map((item, at) =>
              at < count ? { ...item, highlight: true } : item,
            ),
          },
        }).style.find((item) => item.id === "regions-marked") as {
          paint: { "line-width": unknown };
        }
      ).paint["line-width"];
    const one = ["case", ["==", ["get", "h"], 1], 3.6, 2.4];
    expect(marked(1002)).toEqual(["interpolate", ["linear"], ["zoom"], 4, 0.3, 8, one]);
    expect(marked(5)).toEqual(one);
    const florida = scene({
      regions: {
        set: "us-counties",
        items: all.filter((item) => String(item.code).startsWith("12")),
      },
    });
    expect(florida.layers[0].count).toBeGreaterThan(60);
    expect(florida.sources["regions-small"]).toBeUndefined();
    const few = scene({
      regions: { set: "us-counties", items: all.filter((_, at) => at % 400 === 0) },
    });
    expect(
      (few.sources["regions-small"] as unknown as { data: { features: unknown[] } })
        .data.features.length,
    ).toBeGreaterThan(4);
  });

  it("counts a small region once, however many steps of time it has", () => {
    const years = Array.from({ length: 30 }, (_, at) => String(1996 + at));
    const built = scene({
      regions: {
        set: "us-states",
        items: years.flatMap((time) =>
          ["DC", "RI", "DE", "CT", "CA"].map((code) => ({ code, value: 1, time })),
        ),
      },
    });
    const dots = built.sources["regions-small"] as unknown as {
      data: { features: unknown[] };
    };
    expect(dots.data.features.length).toBeGreaterThanOrEqual(90);
  });

  it("says which regions have no shape, by their name", () => {
    const built = scene({
      regions: {
        set: "countries",
        items: [
          { code: "SG", value: 1 },
          { code: "FR", value: 2 },
        ],
      },
    });
    expect(built.unshaped).toEqual(["Singapore"]);
    expect(built.marks).toHaveLength(1);
  });

  it("calls the one layer of a map what the map is about, and several by what they hold", () => {
    const stores = [{ lat: 40.7, lon: -74 }];
    expect(scene({ title: "Our stores", points: stores }).layers[0].name).toBe(
      "Our stores",
    );
    expect(scene({ points: stores }).layers[0].name).toBe("Points");
    expect(
      scene({
        title: "Stores and rates",
        points: stores,
        regions: { set: "us-states", items: [{ code: "NY", value: 1 }] },
      }).layers.map((layer) => layer.name),
    ).toEqual(["Regions", "Points"]);
    expect(
      scene({
        title: "Our stores",
        layers: [{ kind: "points", name: "Stores", points: stores }],
      }).layers[0].name,
    ).toBe("Stores");
    expect(
      scene({
        title: "Rates",
        valueLabel: "Rate (%)",
        points: [{ ...stores[0], value: 2 }],
      }).layers[0].name,
    ).toBe("Rate (%)");
  });

  it("sizes points by their size within a clamp", () => {
    const built = scene({
      points: [
        { lat: 1, lon: 1, size: 100 },
        { lat: 2, lon: 2, size: 1 },
        { lat: 3, lon: 3, size: 0 },
      ],
    });
    const radii = built.marks.map((mark) => mark.radius ?? 0);
    expect(radii[0]).toBe(20);
    expect(radii[1]).toBeGreaterThanOrEqual(3);
    expect(radii[2]).toBe(3);
  });

  it("builds the largest map in bounded time", () => {
    const started = cpuNow();
    const built = scene({
      points: Array.from({ length: MAP_LIMITS.points }, (_, at) => ({
        lat: (at % 160) - 80,
        lon: (at % 340) - 170,
        value: at,
        tag: String(at),
      })),
    });
    expect(built.marks).toHaveLength(MAP_LIMITS.points);
    expect(cpuNow() - started).toBeLessThan(cpuBudget(1500));
  });
});

describe("mapTheme", () => {
  it("interpolates between stops and clamps", () => {
    expect(colorAt(["#000000", "#ffffff"], 0.5)).toBe("#808080");
    expect(colorAt(["#000000", "#ffffff"], 7)).toBe("#ffffff");
    expect(colorAt(["#000000", "#ffffff"], Number.NaN)).toBe("#000000");
  });

  it("gives one colour when all values are equal", () => {
    const scale = mapScale(4, 4, theme);
    expect(scale.color(4)).toBe("#407dd3");
    expect(scale.color(-100)).toBe("#407dd3");
    expect(scale.color(4)).toBe(colorAt(theme.sequential, 0.6));
  });

  it("writes numbers short", () => {
    expect(shortNumber(1234567.891)).toBe("1,234,568");
    expect(shortNumber(4.234)).toBe("4.23");
    expect(shortNumber(0.01234)).toBe("0.012");
  });
});
