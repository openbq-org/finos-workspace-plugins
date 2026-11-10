import { describe, expect, it } from "vitest";
import { MAP_THEMES } from "~/components/Geo/mapTheme";
import { heldSource, rasterBackdrop, sourceStyle } from "~/components/Geo/sourceLayers";
import { MAP_LIMITS } from "~/lib/codemode/limits";
import type { HeldMapSource } from "~/lib/geo/mapSourceTypes";

const theme = MAP_THEMES.light;
const held = (more: Partial<HeldMapSource> = {}): HeldMapSource => ({
  id: "ndvi",
  name: "NDVI",
  kind: "raster-tiles",
  attribution: "Reference backend",
  role: "overlay",
  url: "https://data.example/tiles/ndvi/{z}/{x}/{y}.png",
  origin: "https://data.example",
  backend: "Reference",
  headers: { Authorization: "Bearer secret" },
  ...more,
});

describe("heldSource", () => {
  it("finds a source by its id, and says why an id names none", () => {
    const sources = { sources: [held()], ambiguous: ["twice"] };
    expect(heldSource(sources, "ndvi")).toEqual({ source: sources.sources[0] });
    expect(heldSource(sources, "other")).toEqual({
      note: "This source is not connected.",
    });
    expect(heldSource(sources, "twice")).toEqual({
      note: "Two connected backends declare this source.",
    });
  });

  it("does not take an ambiguous id even when one source has it", () => {
    expect(heldSource({ sources: [held()], ambiguous: ["ndvi"] }, "ndvi")).toEqual({
      note: "Two connected backends declare this source.",
    });
  });
});

describe("sourceStyle", () => {
  it("draws raster tiles with the tiles, the zooms, the bounds and the opacity of the declaration", () => {
    const drawn = sourceStyle(
      held({
        opacity: 0.7,
        minzoom: 3,
        maxzoom: 9,
        tileSize: 256,
        bounds: [-104.1, 36, -80.5, 49.4],
      }),
      "l:x",
      theme,
    );
    expect(drawn.source).toEqual({
      type: "raster",
      tiles: ["https://data.example/tiles/ndvi/{z}/{x}/{y}.png"],
      tileSize: 256,
      minzoom: 3,
      maxzoom: 9,
      bounds: [-104.1, 36, -80.5, 49.4],
    });
    expect(drawn.layers).toEqual([
      {
        spec: {
          id: "l:x",
          type: "raster",
          source: "l:x",
          paint: { "raster-opacity": 0.7, "raster-fade-duration": 0 },
        },
        opacity: { "raster-opacity": 0.7 },
      },
    ]);
    expect(drawn.swatch).toBe("raster");
  });

  it("draws one image at its corners", () => {
    const coordinates: HeldMapSource["coordinates"] = [
      [-94, 42.1],
      [-93.5, 42.1],
      [-93.5, 41.9],
      [-94, 41.9],
    ];
    const drawn = sourceStyle(
      held({ kind: "image", url: "https://data.example/field.png", coordinates }),
      "l:x",
      theme,
    );
    expect(drawn.source).toEqual({
      type: "image",
      url: "https://data.example/field.png",
      coordinates,
    });
    expect(drawn.layers[0].spec.type).toBe("raster");
    expect(sourceStyle(held({ kind: "image" }), "l:x", theme).layers).toEqual([]);
  });

  it("reads a PMTiles file through the protocol of the basemap: raster, or vector when it declares layers", () => {
    const url = "https://data.example/soil.pmtiles";
    expect(sourceStyle(held({ kind: "pmtiles", url }), "l:x", theme).source).toEqual({
      type: "raster",
      url: `pmtiles://${url}`,
      tileSize: 256,
    });
    const vector = sourceStyle(
      held({
        kind: "pmtiles",
        url,
        layers: [{ sourceLayer: "soil", type: "fill", color: "#aabbcc" }],
      }),
      "l:x",
      theme,
    );
    expect(vector.source).toEqual({ type: "vector", url: `pmtiles://${url}` });
    expect(vector.layers[0].spec).toMatchObject({
      type: "fill",
      "source-layer": "soil",
    });
  });

  it("draws vector data only by the declared layers, with expressions it builds itself", () => {
    const drawn = sourceStyle(
      held({
        kind: "vector-tiles",
        url: "https://data.example/zcta/{z}/{x}/{y}.pbf",
        layers: [
          {
            sourceLayer: "zcta",
            type: "fill",
            color: { property: "value", scale: "sequential", domain: [0, 10] },
            opacity: 0.8,
          },
          { sourceLayer: "zcta", type: "line", color: "#112233", width: 2 },
          { sourceLayer: "towns", type: "circle", color: "#445566", radius: 4 },
          { type: "fill", color: "#000000" },
        ],
      }),
      "l:x",
      theme,
    );
    expect(drawn.source).toEqual({
      type: "vector",
      tiles: ["https://data.example/zcta/{z}/{x}/{y}.pbf"],
    });
    expect(drawn.layers.map((layer) => layer.spec.id)).toEqual([
      "l:x-0",
      "l:x-1",
      "l:x-2",
    ]);
    const [fill, line, circle] = drawn.layers;
    const color = (fill.spec.paint as Record<string, unknown>)[
      "fill-color"
    ] as unknown[];
    expect(color.slice(0, 3)).toEqual([
      "interpolate",
      ["linear"],
      ["to-number", ["get", "value"], 0],
    ]);
    expect(color.slice(3, 5)).toEqual([0, theme.sequential[0]]);
    expect(color.slice(-2)).toEqual([10, theme.sequential.at(-1)]);
    expect(fill.opacity).toEqual({ "fill-opacity": 0.8 });
    expect(line.spec.paint).toEqual({
      "line-color": "#112233",
      "line-width": 2,
      "line-opacity": 1,
    });
    expect(circle.spec.paint).toMatchObject({
      "circle-color": "#445566",
      "circle-radius": 4,
    });
    expect(drawn.swatch).toBe("fill");
  });

  it("passes nothing of a declaration through that is not a listed field of the right kind", () => {
    const hostile = {
      sourceLayer: "a",
      type: "symbol",
      color: ["get", "x"],
      opacity: "1",
      width: 9999,
      radius: -4,
      layout: { "icon-image": "https://attacker.example/x.png" },
      paint: { "fill-pattern": "x" },
      filter: ["==", 1, 1],
    };
    const drawn = sourceStyle(
      held({
        kind: "geojson",
        url: "https://data.example/fields.geojson",
        layers: [
          hostile,
          { ...hostile, type: "line" },
          { ...hostile, type: "circle" },
          {
            type: "fill",
            color: { property: "v", scale: "nonsense", domain: [5, 5] },
          },
        ] as unknown as HeldMapSource["layers"],
      }),
      "l:x",
      theme,
    );
    expect(drawn.source).toEqual({
      type: "geojson",
      data: "https://data.example/fields.geojson",
    });
    expect(JSON.stringify(drawn)).not.toMatch(/attacker|icon|pattern|symbol/);
    const [line, circle, fill] = drawn.layers.map((layer) => layer.spec);
    expect(line.paint).toEqual({
      "line-color": theme.series[0],
      "line-width": 20,
      "line-opacity": 1,
    });
    expect((circle.paint as Record<string, unknown>)["circle-radius"]).toBe(0);
    expect((fill.paint as Record<string, unknown>)["fill-color"]).toBe(theme.series[0]);
    for (const layer of drawn.layers) expect(layer.spec).not.toHaveProperty("filter");
  });

  it("draws a GeoJSON file that declares no layer: its areas, its lines and its points", () => {
    const drawn = sourceStyle(
      held({ kind: "geojson", url: "https://data.example/a.geojson", opacity: 0.5 }),
      "l:x",
      theme,
    );
    expect(drawn.swatch).toBe("fill");
    expect(
      drawn.layers.map(({ spec }) => [
        spec.id,
        spec.type,
        (spec as { filter?: unknown }).filter,
      ]),
    ).toEqual([
      [
        "l:x-0",
        "fill",
        ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]],
      ],
      ["l:x-1", "line", undefined],
      [
        "l:x-2",
        "circle",
        ["in", ["geometry-type"], ["literal", ["Point", "MultiPoint"]]],
      ],
    ]);
    expect(drawn.layers[0].spec.paint).toEqual({
      "fill-color": theme.series[0],
      "fill-opacity": 0.15,
    });
    expect(drawn.layers.map(({ opacity }) => opacity)).toEqual([
      { "fill-opacity": 0.15 },
      { "line-opacity": 0.5 },
      { "circle-opacity": 0.5 },
    ]);
    expect(
      sourceStyle(
        held({ kind: "vector-tiles", url: "https://data.example/{z}/{x}/{y}.mvt" }),
        "l:v",
        theme,
      ).layers,
    ).toEqual([]);
  });

  it("draws every layer of a source that declares as many as it may, and not the one after", () => {
    const cap = MAP_LIMITS.sourceStyleLayers;
    const widths = (count: number) =>
      sourceStyle(
        held({
          kind: "geojson",
          url: "https://data.example/a.geojson",
          layers: Array.from({ length: count }, (_, at) => ({
            type: "line" as const,
            color: "#112233",
            width: at + 1,
          })),
        }),
        "l:x",
        theme,
      ).layers.map(({ spec }) => (spec.paint as Record<string, unknown>)["line-width"]);
    const first = Array.from({ length: cap }, (_, at) => at + 1);
    expect(widths(cap)).toEqual(first);
    expect(widths(cap + 1)).toEqual(first);
  });

  it.each([
    [39.5, 39.5],
    [40, 40],
    [40.5, 40],
    [0, 0],
  ])(
    "draws a circle of radius %d with radius %d: 40 is the largest",
    (declared, drawn) => {
      const [circle] = sourceStyle(
        held({
          kind: "geojson",
          url: "https://data.example/a.geojson",
          layers: [{ type: "circle", color: "#112233", radius: declared }],
        }),
        "l:x",
        theme,
      ).layers;
      expect((circle.spec.paint as Record<string, unknown>)["circle-radius"]).toBe(
        drawn,
      );
    },
  );
});

describe("sourceStyle: elevation", () => {
  const terrain = (more: Partial<HeldMapSource> = {}) =>
    held({
      id: "terrain",
      kind: "raster-dem",
      encoding: "terrarium",
      url: "https://data.example/tiles/terrain/{z}/{x}/{y}.png",
      minzoom: 3,
      maxzoom: 10,
      bounds: [-104.1, 36, -80.5, 49.4],
      ...more,
    });

  it("is a source of elevation and one layer of shaded relief", () => {
    const drawn = sourceStyle(terrain(), "l:t", theme);
    expect(drawn.source).toEqual({
      type: "raster-dem",
      tiles: ["https://data.example/tiles/terrain/{z}/{x}/{y}.png"],
      tileSize: 256,
      encoding: "terrarium",
      minzoom: 3,
      maxzoom: 10,
      bounds: [-104.1, 36, -80.5, 49.4],
    });
    expect(drawn.layers).toHaveLength(1);
    const [{ spec, opacity }] = drawn.layers;
    expect(spec).toMatchObject({ id: "l:t", type: "hillshade", source: "l:t" });
    expect(opacity).toEqual({ "hillshade-exaggeration": 0.7 });
    expect((spec.paint as Record<string, unknown>)["hillshade-exaggeration"]).toBe(0.7);
    expect(drawn.swatch).toBe("raster");
  });

  it("is as strong as the declaration says, and takes the size of its tiles", () => {
    const drawn = sourceStyle(
      terrain({ opacity: 0.5, tileSize: 512, encoding: "mapbox" }),
      "l:t",
      theme,
    );
    expect(drawn.layers[0].opacity).toEqual({ "hillshade-exaggeration": 0.35 });
    expect(drawn.source).toMatchObject({ tileSize: 512, encoding: "mapbox" });
  });

  it("has quiet colours of its own in each theme, and no colour of a declaration", () => {
    const paintOf = (which: typeof theme) =>
      sourceStyle(terrain(), "l:t", which).layers[0].spec.paint as Record<
        string,
        string
      >;
    const light = paintOf(MAP_THEMES.light);
    const dark = paintOf(MAP_THEMES.dark);
    for (const key of [
      "hillshade-shadow-color",
      "hillshade-highlight-color",
      "hillshade-accent-color",
    ]) {
      expect(light[key]).toMatch(/^(#|rgba\()/);
      expect(dark[key]).not.toBe(light[key]);
    }
  });

  it("draws nothing without an encoding the app knows", () => {
    for (const encoding of [undefined, "custom"]) {
      const drawn = sourceStyle(terrain({ encoding: encoding as never }), "l:t", theme);
      expect(drawn.source).toBeNull();
      expect(drawn.layers).toEqual([]);
    }
  });

  it("is never the picture under a map", () => {
    expect(rasterBackdrop(terrain())).toBeNull();
    expect(rasterBackdrop(terrain({ role: "imagery" }))).toBeNull();
  });
});

describe("rasterBackdrop", () => {
  it("is the picture of a raster source, and nothing for vector data", () => {
    expect(rasterBackdrop(held({ role: "imagery" }))?.type).toBe("raster");
    expect(
      rasterBackdrop(held({ kind: "geojson", url: "https://data.example/a.geojson" })),
    ).toBeNull();
    expect(
      rasterBackdrop(
        held({ kind: "pmtiles", layers: [{ type: "fill", color: "#000000" }] }),
      ),
    ).toBeNull();
  });
});
