import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import {
  type ContextStyle,
  contextLayers,
  contextParts,
  placeContext,
  stockContext,
} from "~/components/Geo/basemapContext";
import { openFreeMapLayers, protomapsLayers } from "~/components/Geo/basemapStyle";
import dark from "~/components/Geo/styles/openfreemap-dark.json";
import positron from "~/components/Geo/styles/openfreemap-positron.json";
import { type ContextSchema, MAP_CONTEXT_IDS } from "~/lib/geo/mapContext";

const BUNDLED = new Set([
  "boundaries",
  "earth",
  "landcover",
  "landuse",
  "places",
  "pois",
  "roads",
  "water",
]);
const CASES: [ContextSchema, number][] = [
  ["protomaps", 15],
  ["openmaptiles", 14],
];
const THEMES = ["light", "dark"] as const;
const all = (context: ContextStyle[]) => context.flatMap(contextParts);
const byId = (context: ContextStyle[], id: string) =>
  context.find((item) => item.id === id) as ContextStyle;
const layer = (context: ContextStyle[], id: string) =>
  all(context).find((item) => item.id === id) as LayerSpecification & {
    filter?: unknown;
    paint: Record<string, unknown>;
    layout: Record<string, unknown>;
    minzoom?: number;
    "source-layer": string;
  };

describe("the context layers as layers of the style", () => {
  it.each(CASES)("has every context layer on detailed %s tiles", (schema, zoom) => {
    for (const theme of THEMES) {
      const context = contextLayers(schema, theme, () => true, zoom);
      expect(context.map(({ id }) => id)).toEqual(MAP_CONTEXT_IDS);
      for (const item of context) {
        expect(contextParts(item).length).toBeGreaterThan(0);
        for (const part of contextParts(item)) {
          expect(part.id.startsWith(`context-${item.id}`)).toBe(true);
          expect((part as { minzoom?: number }).minzoom ?? 0).toBeGreaterThanOrEqual(
            item.from,
          );
        }
      }
    }
  });

  it.each(
    CASES,
  )("reads the tiles of the basemap and nothing else (%s)", (schema, zoom) => {
    for (const theme of THEMES) {
      const layers = all(contextLayers(schema, theme, () => true, zoom));
      const ids = layers.map(({ id }) => id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const part of layers) {
        expect("source" in part && part.source).toBe("basemap");
        expect("source-layer" in part && part["source-layer"]).toBeTruthy();

        expect(part.layout?.visibility).toBe("none");
      }
      const text = JSON.stringify(layers);
      expect(text).not.toMatch(/https?:|icon-|-pattern|sprite|url/);

      for (const part of layers.filter((item) => item.type === "symbol"))
        expect(part.layout?.["text-font"]).toEqual(["Noto Sans Regular"]);
    }
  });

  it.each(CASES)("is a valid style of the map library (%s)", (schema, zoom) => {
    for (const theme of THEMES) {
      const style: StyleSpecification = {
        version: 8,
        glyphs: "http://localhost/basemap/fonts/{fontstack}/{range}.pbf",
        sources: {
          basemap: { type: "vector", tiles: ["http://localhost/{z}/{x}/{y}"] },
        },
        layers: all(contextLayers(schema, theme, () => true, zoom)),
      };
      expect(validateStyleMin(style).map((error) => error.message)).toEqual([]);
    }
  });

  it("puts tints of the land apart from footprints, lines and dots, and names last", () => {
    for (const [schema, zoom] of CASES) {
      const context = contextLayers(schema, "light", () => true, zoom);
      for (const item of context) {
        expect(
          [...item.land, ...item.cover].every((part) => part.type === "fill"),
        ).toBe(true);
        expect(item.names.every((part) => part.type === "symbol")).toBe(true);
        expect(item.detail.some((part) => part.type === "symbol")).toBe(false);
      }
      expect(byId(context, "landuse").detail).toEqual([]);
      expect(byId(context, "buildings").cover).toEqual([]);
      expect(byId(context, "green").detail).toEqual([]);
      expect(byId(context, "buildings").land).toEqual([]);
      expect(byId(context, "pois").names).toHaveLength(1);
    }
  });

  it("draws the OpenMapTiles schema of the tile service", () => {
    const context = contextLayers("openmaptiles", "light", () => true, 14);
    expect(layer(context, "context-buildings")).toMatchObject({
      type: "fill",
      "source-layer": "building",
      minzoom: 13,
    });
    const tall = layer(context, "context-buildings-3d");
    expect(tall).toMatchObject({
      type: "fill-extrusion",
      "source-layer": "building",
      minzoom: 14,
      filter: ["!=", ["get", "hide_3d"], true],
    });
    expect(tall.paint["fill-extrusion-height"]).toEqual([
      "to-number",
      ["get", "render_height"],
      5,
    ]);
    expect(tall.paint["fill-extrusion-base"]).toEqual([
      "to-number",
      ["get", "render_min_height"],
      0,
    ]);
    expect(layer(context, "context-landuse")).toMatchObject({
      type: "fill",
      "source-layer": "landuse",
      filter: [
        "in",
        ["get", "class"],
        [
          "literal",
          [
            "residential",
            "suburb",
            "neighbourhood",
            "commercial",
            "retail",
            "industrial",
          ],
        ],
      ],
    });
    expect(layer(context, "context-landuse-farmland")["source-layer"]).toBe(
      "landcover",
    );
    expect(layer(context, "context-green")["source-layer"]).toBe("park");
    expect(layer(context, "context-green-cover")).toMatchObject({
      "source-layer": "landcover",
      filter: ["in", ["get", "class"], ["literal", ["wood", "grass"]]],
    });
    const rail = layer(context, "context-railways");
    expect(rail).toMatchObject({ type: "line", "source-layer": "transportation" });
    expect(JSON.stringify(rail.filter)).toContain('["==",["get","class"],"rail"]');
    expect(layer(context, "context-airports")).toMatchObject({
      type: "fill",
      "source-layer": "aeroway",
    });
    expect(layer(context, "context-airports-runway")).toMatchObject({
      type: "line",
      "source-layer": "aeroway",
    });
    expect(layer(context, "context-pois")).toMatchObject({
      type: "circle",
      "source-layer": "poi",
      minzoom: 14,
    });
    expect(layer(context, "context-pois-names")).toMatchObject({
      type: "symbol",
      "source-layer": "poi",
      minzoom: 15,
    });
    expect(layer(context, "context-pois-names").layout["text-field"]).toEqual([
      "coalesce",
      ["get", "name_en"],
      ["get", "name:latin"],
      "",
    ]);
  });

  it("draws the Protomaps schema of a file", () => {
    const context = contextLayers("protomaps", "dark", () => true, 15);
    expect(layer(context, "context-buildings")).toMatchObject({
      type: "fill",
      "source-layer": "buildings",
      minzoom: 11,
    });
    expect(
      layer(context, "context-buildings-3d").paint["fill-extrusion-height"],
    ).toEqual(["to-number", ["get", "height"], 5]);
    expect(layer(context, "context-railways")).toMatchObject({
      type: "line",
      "source-layer": "roads",
      filter: ["==", ["get", "kind"], "rail"],
      minzoom: 11,
    });
    expect(layer(context, "context-green")["source-layer"]).toBe("landuse");
    expect(layer(context, "context-airports-runway")).toMatchObject({
      "source-layer": "roads",
      filter: ["==", ["get", "kind_detail"], "runway"],
    });
    expect(layer(context, "context-pois")["source-layer"]).toBe("pois");
  });

  it("has land use, parks and airports on the file the app ships, and no buildings", () => {
    const context = contextLayers("protomaps", "light", (name) => BUNDLED.has(name), 6);
    expect(context.map(({ id }) => id)).toEqual(["landuse", "green", "airports"]);
    expect(byId(context, "green").from).toBe(2);
    expect(byId(context, "airports").from).toBe(6);
  });

  it("makes nothing of a layer the tiles do not have", () => {
    const has = (name: string) => ["earth", "water", "boundaries"].includes(name);
    expect(contextLayers("protomaps", "light", has, 15)).toEqual([]);
    const noPois = contextLayers("protomaps", "light", (name) => name !== "pois", 15);
    expect(noPois.map(({ id }) => id)).not.toContain("pois");
  });

  it("has colours of its own for each theme", () => {
    for (const [schema, zoom] of CASES) {
      const light = JSON.stringify(
        all(contextLayers(schema, "light", () => true, zoom)),
      );
      const night = JSON.stringify(
        all(contextLayers(schema, "dark", () => true, zoom)),
      );
      expect(light).not.toBe(night);
    }
  });
});

describe("placeContext, where the context layers go among the layers of a style", () => {
  const order = (layers: LayerSpecification[]) => {
    const ids = layers.map((item) => item.id);
    return (id: string) => {
      const at = ids.indexOf(id);
      if (at < 0) throw new Error(`no layer ${id}`);
      return at;
    };
  };

  it("keeps every layer once, in the order each list had", async () => {
    const { under } = await protomapsLayers("light", () => true);
    const stock = under.filter((item) => stockContext(item) === null);
    const context = contextLayers("protomaps", "light", () => true, 15);
    const placed = placeContext(stock, context);
    const added = context.flatMap((item) => [
      ...item.land,
      ...item.cover,
      ...item.detail,
    ]);
    expect(placed).toHaveLength(stock.length + added.length);
    expect(placed.filter((item) => stock.includes(item))).toEqual(stock);
    expect(new Set(placed).size).toBe(placed.length);

    expect(placed.some((item) => item.type === "symbol")).toBe(false);
  });

  it("puts a park under the water and a building over the roads of a Protomaps file", async () => {
    const { under } = await protomapsLayers("dark", () => true);
    const at = order(
      placeContext(
        under.filter((item) => stockContext(item) === null),
        contextLayers("protomaps", "dark", () => true, 15),
      ),
    );
    expect(at("context-green")).toBeGreaterThan(at("earth"));
    expect(at("context-green")).toBeLessThan(at("water"));
    expect(at("context-landuse")).toBeLessThan(at("water"));
    expect(at("context-airports")).toBeLessThan(at("water"));
    expect(at("context-buildings")).toBeGreaterThan(at("roads_highway"));
    expect(at("context-railways")).toBeGreaterThan(at("roads_highway"));
    expect(at("context-pois")).toBeLessThan(at("boundaries_country"));
    expect(at("context-buildings-3d")).toBeGreaterThan(at("context-buildings"));
  });

  it.each([
    ["light", positron],
    ["dark", dark],
  ] as const)("puts land use over the faint tints of the tile service and under its roads (%s)", (theme, style) => {
    const { under } = openFreeMapLayers(
      style as LayerSpecification[],
      positron as LayerSpecification[],
      theme,
    );
    const at = order(
      placeContext(
        under.filter((item) => stockContext(item) === null),
        contextLayers("openmaptiles", theme, () => true, 14),
      ),
    );

    expect(at("context-green")).toBeLessThan(at("water"));
    expect(at("context-landuse")).toBeGreaterThan(at("landuse_residential"));
    expect(at("context-green-cover")).toBeGreaterThan(at("landuse_residential"));
    expect(at("context-landuse")).toBeLessThan(at("waterway"));
    expect(at("context-airports")).toBeLessThan(at("highway_minor"));
    expect(at("context-buildings")).toBeGreaterThan(at("highway_motorway_inner"));
    expect(at("context-railways")).toBeGreaterThan(at("highway_motorway_inner"));
    expect(at("context-airports-runway")).toBeLessThan(
      at(theme === "light" ? "boundary_2" : "boundary_state"),
    );
  });

  it("appends to a list that has no water and no border", () => {
    const context = contextLayers("openmaptiles", "light", () => true, 14);
    const land: LayerSpecification = { id: "background", type: "background" };
    const placed = placeContext([land], context);
    expect(placed[0]).toBe(land);
    expect(placed).toHaveLength(
      1 +
        context.flatMap((item) => [...item.land, ...item.cover, ...item.detail]).length,
    );
  });
});

describe("stockContext, the layers of the published styles a context layer replaces", () => {
  it("names the buildings, the railways and the runways of both styles", async () => {
    const protomaps = await protomapsLayers("light", () => true);
    const found = (layers: LayerSpecification[]) =>
      Object.fromEntries(
        layers.flatMap((item) => {
          const context = stockContext(item);
          return context ? [[item.id, context]] : [];
        }),
      );
    expect(found(protomaps.under)).toEqual({
      buildings: "buildings",
      landuse_aerodrome: "airports",
      landuse_runway: "airports",
      roads_runway: "airports",
      roads_taxiway: "airports",
      roads_rail: "railways",
    });
    const service = openFreeMapLayers(
      positron as LayerSpecification[],
      positron as LayerSpecification[],
      "light",
    );
    const light = found(service.under);
    expect(light.building).toBe("buildings");
    expect(light.railway).toBe("railways");
    expect(light.railway_transit_dashline).toBe("railways");
    expect(light["aeroway-runway"]).toBe("airports");
    expect(new Set(Object.values(light))).toEqual(
      new Set(["buildings", "railways", "airports"]),
    );
    const night = found(
      openFreeMapLayers(
        dark as LayerSpecification[],
        positron as LayerSpecification[],
        "dark",
      ).under,
    );
    expect(night.building).toBe("buildings");
    expect(night.railway_minor).toBe("railways");
  });

  it("leaves the land, the water, the roads, the borders and every name to the basemap", async () => {
    const { under, labels } = await protomapsLayers("dark", () => true);
    for (const id of ["earth", "water", "landcover", "roads_highway", "boundaries"])
      expect(
        stockContext(under.find((item) => item.id === id) as LayerSpecification),
      ).toBeNull();
    expect(labels.every((item) => stockContext(item) === null)).toBe(true);
  });
});
