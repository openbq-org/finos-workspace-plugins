import { describe, expect, it } from "vitest";
import {
  applyMapView,
  FAINT_BUILDINGS,
  opensOnCity,
  standingShown,
} from "~/components/Geo/applyMapView";
import type { Basemap } from "~/components/Geo/basemap";
import { contextLayers } from "~/components/Geo/basemapContext";
import { insidePoint, liftPixels } from "~/components/Geo/mapGeometry";
import { markPlace } from "~/components/Geo/markPlace";
import { STANDING_OPACITY } from "~/components/Geo/scene/shapes";
import { FakeMap } from "../fakeMap";
import { featuresOf, ids, scene, styleOf, theme } from "./support";

const box = (
  west: number,
  south: number,
  wide = 0.0006,
  high = 0.0005,
): [number, number][] => [
  [west, south],
  [west + wide, south],
  [west + wide, south + high],
  [west, south + high],
  [west, south],
];
const footprint = (at: number, more: object = {}) => ({
  type: "polygon",
  coordinates: [box(-87.63 + at * 0.001, 41.88)],
  label: `B${at}`,
  ...more,
});
const buildings = (shapes: unknown[], more: object = {}) => ({
  layers: [
    { kind: "polygons", name: "Buildings", valueLabel: "Energy", shapes, ...more },
  ],
});

describe("a place inside an area", () => {
  it("is the centre of gravity of a block", () => {
    expect(insidePoint([box(0, 0, 2, 2)])).toEqual([1, 1]);
  });

  it("is inside an L, whose box has its middle in the notch", () => {
    const el = [
      [0, 0],
      [4, 0],
      [4, 1],
      [1, 1],
      [1, 4],
      [0, 4],
      [0, 0],
    ] as [number, number][];
    const [x, y] = insidePoint([el]) as [number, number];
    expect(x <= 1 || y <= 1).toBe(true);
    expect(x).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(0);
  });

  it("is in the ring of an area with a hole, not in the hole", () => {
    const hole = [
      box(1, 1, 2, 2)[0],
      box(1, 1, 2, 2)[3],
      box(1, 1, 2, 2)[2],
      box(1, 1, 2, 2)[1],
      box(1, 1, 2, 2)[0],
    ];
    const [x, y] = insidePoint([box(0, 0, 4, 4), hole]) as [number, number];
    expect(x > 1 && x < 3 && y > 1 && y < 3).toBe(false);
    expect(x >= 0 && x <= 4 && y >= 0 && y <= 4).toBe(true);
  });

  it("is nothing for an area without an outline", () => {
    expect(insidePoint([])).toBeNull();
  });
});

describe("how far up the canvas a roof is from its foot", () => {
  it("is nothing on a flat map and for what does not stand", () => {
    expect(liftPixels([1, 0], [0, -1], 100, 0)).toBe(0);
    expect(liftPixels([1, 0], [0, -1], 0, 45)).toBe(0);
  });

  it("is the height at the scale of the ground across the view, by the sine of the tilt", () => {
    const up = liftPixels([2, 0], [0, -1], 50, 60);
    expect(up).toBeCloseTo(2 * 50 * Math.sin(Math.PI / 3), 6);
    expect(liftPixels([0, 1], [2, 0], 50, 60)).toBeCloseTo(up, 6);
  });

  it("moves the place of a mark that stands up the canvas, only on a tilted map", () => {
    const map = (pitch: number) => ({
      getPitch: () => pitch,
      project: ([lon, lat]: [number, number]) => ({
        x: lon * 111_320 * Math.cos((41.88 * Math.PI) / 180),
        y: -lat * 111_320,
      }),
    });
    const at: [number, number] = [-87.63, 41.88];
    const foot = markPlace(map(0) as never, at, 100);
    expect(markPlace(map(45) as never, at)).toEqual(foot);
    const roof = markPlace(map(45) as never, at, 100);
    expect(roof.x).toBeCloseTo(foot.x, 6);
    expect(foot.y - roof.y).toBeCloseTo(100 * Math.SQRT1_2, 0);
  });
});

describe("a layer of areas that stand", () => {
  const built = scene(
    buildings([
      footprint(0, { height: 40, value: 120 }),
      footprint(1, { height: 180, value: 310, highlight: true, tag: "Tallest" }),
      footprint(2, { value: 200 }),
    ]),
  );

  it("is drawn as prisms of their metres, in the colour of their value", () => {
    const layer = styleOf(built, "l:polygons-1");
    expect(layer.type).toBe("fill-extrusion");
    expect(layer.paint).toMatchObject({
      "fill-extrusion-color": ["get", "color"],
      "fill-extrusion-height": ["coalesce", ["get", "m"], 0],
      "fill-extrusion-base": 0,
      "fill-extrusion-opacity": STANDING_OPACITY,
    });
    expect(featuresOf(built, "l:polygons-1").map((item) => item.properties?.m)).toEqual(
      [40, 180, undefined],
    );
    expect(built.standing).toEqual(["polygons-1"]);
    expect(built.layers[0]).toMatchObject({
      count: 3,
      swatch: "fill",
      valueLabel: "Energy",
    });
    expect(built.layers[0].scale).not.toBeNull();
  });

  it("is read by the pointer, and the area under it has a roof in the colour of the pointer", () => {
    expect(built.pointer).toEqual(["l:polygons-1"]);
    expect(built.hover).toEqual(["l:polygons-1-hover"]);
    const hover = styleOf(built, "l:polygons-1-hover");
    expect(hover.type).toBe("fill-extrusion");
    expect(hover.paint["fill-extrusion-color"]).toBe(theme.hover);
    expect(hover.paint["fill-extrusion-base"]).toEqual(["coalesce", ["get", "m"], 0]);
  });

  it("leaves the courtyard of a highlighted area open: its collar has the holes of the area", () => {
    const hole = [
      [-87.6298, 41.8782],
      [-87.6296, 41.8782],
      [-87.6296, 41.8784],
      [-87.6298, 41.8782],
    ];
    const ring = scene({
      layers: [
        {
          kind: "polygons",
          shapes: [
            {
              type: "polygon",
              coordinates: [
                [
                  [-87.63, 41.878],
                  [-87.629, 41.878],
                  [-87.629, 41.879],
                  [-87.63, 41.879],
                  [-87.63, 41.878],
                ],
                hole,
              ],
              height: 60,
              highlight: true,
            },
          ],
        },
      ],
    });
    const [collar] = featuresOf(ring, "l:polygons-1-collars");
    const rings = (collar.geometry as { coordinates: number[][][] }).coordinates;
    expect(rings).toHaveLength(2);
    expect(rings[1]).toEqual(hole);
  });

  it("sets a highlighted area apart by a collar in its tone around the top of its walls", () => {
    const band = styleOf(built, "l:polygons-1-highlight");
    expect(band.type).toBe("fill-extrusion");
    expect(band.source).toBe("l:polygons-1-collars");
    expect(band.paint["fill-extrusion-color"]).toEqual(["get", "hc"]);
    const [collar, ...others] = featuresOf(built, "l:polygons-1-collars");
    expect(others).toEqual([]);
    expect(collar.properties).toMatchObject({ from: 180 - 12.6, to: 179.9 });
    const low = scene(
      buildings([
        footprint(0, { height: 200 }),
        footprint(1, { height: 10, highlight: true }),
      ]),
    );
    expect(featuresOf(low, "l:polygons-1-collars")[0].properties).toMatchObject({
      from: 6.5,
      to: 9.9,
    });
    const lons = (feature: (typeof collar)["geometry"]) =>
      feature.type === "Polygon" ? feature.coordinates[0].map(([lon]) => lon) : [];
    const [area] = featuresOf(built, "l:polygons-1").slice(1, 2);
    expect(Math.min(...lons(collar.geometry))).toBeLessThan(
      Math.min(...lons(area.geometry)),
    );
    expect(Math.max(...lons(collar.geometry))).toBeGreaterThan(
      Math.max(...lons(area.geometry)),
    );
  });

  it("anchors the tag of an area inside it and at its roof", () => {
    const [low, tall, flat] = built.marks;
    expect(tall).toMatchObject({
      kind: "shape",
      tag: "Tallest",
      lift: 180,
      highlight: true,
    });
    expect(low.lift).toBe(40);
    expect(flat.lift).toBeUndefined();
    const [lon, lat] = tall.at as [number, number];
    expect(lon).toBeCloseTo(-87.629 + 0.0003, 6);
    expect(lat).toBeCloseTo(41.88 + 0.00025, 6);
  });

  it("stays the flat layer it always was when no area has a height", () => {
    const flat = scene(
      buildings([footprint(0, { value: 1 }), footprint(1, { value: 2 })]),
    );
    expect(styleOf(flat, "l:polygons-1").type).toBe("fill");
    expect(ids(flat)).toContain("l:polygons-1-outline");
    expect(flat.standing).toEqual([]);
  });

  it("opens tilted on the view of a city, and flat on a wider one", () => {
    expect(standingShown(built, {})).toBe(true);
    expect(opensOnCity(built)).toBe(true);
    expect(standingShown(built, { hidden: ["polygons-1"] })).toBe(false);
    const wide = scene(
      buildings([
        footprint(0, { height: 40 }),
        { type: "polygon", coordinates: [box(-80, 35)], height: 30 },
      ]),
    );
    expect(standingShown(wide, {})).toBe(true);
    expect(opensOnCity(wide)).toBe(false);
  });
});

describe("the buildings of the basemap under footprints of the map", () => {
  const basemap: Basemap = {
    kind: "openfreemap",
    source: { type: "vector", url: "https://tiles.example/planet" },
    under: [
      { id: "background", type: "background", paint: { "background-color": "#ddd" } },
      { id: "water", type: "fill", source: "basemap", "source-layer": "water" },
    ],
    labels: [],
    maxZoom: 17,
    detailZoom: 14,
    credit: "OpenFreeMap",
    schema: "openmaptiles",
    context: contextLayers("openmaptiles", "light", () => true, 14),
  };
  const opacityOf = (built: ReturnType<typeof scene>, id: string) => {
    const { paint, type } = styleOf(built, id);
    return paint[`${type}-opacity`];
  };

  const strengths = (built: ReturnType<typeof scene>, view: object) => {
    const map = new FakeMap();
    map.setStyle({ sources: {}, layers: built.style });
    map.loadStyle();
    applyMapView(map.map, built, view, undefined);
    return new Map(
      map.setPaintProperty.mock.calls
        .filter(([id]) => String(id).startsWith("context-buildings"))
        .map(([id, , value]) => [String(id), value as number]),
    );
  };

  it("keep a part of their strength while a layer of the map stands, so the footprints of the data are what is read", () => {
    const plain = scene({ points: [{ lat: 41.88, lon: -87.63 }] }, { basemap });
    const standing = scene(buildings([footprint(0, { height: 40 })]), { basemap });
    const tall = ids(plain).filter((id) => id.startsWith("context-buildings"));
    expect(tall.length).toBeGreaterThan(1);
    const drawn = strengths(standing, {});
    for (const id of tall) {
      const full = (opacityOf(plain, id) as number | undefined) ?? 1;
      expect(drawn.get(id), id).toBeCloseTo(full * FAINT_BUILDINGS, 2);
      expect(opacityOf(standing, id)).toEqual(opacityOf(plain, id));
    }
    expect(styleOf(standing, "water")).toEqual(styleOf(plain, "water"));
  });

  it("are at full strength again when the reader turns the footprints off", () => {
    const standing = scene(buildings([footprint(0, { height: 40 })]), { basemap });
    const [layer] = standing.standing;
    const off = strengths(standing, { hidden: [layer] });
    const on = strengths(standing, {});
    expect(off.size).toBeGreaterThan(1);
    for (const [id, strength] of off) {
      expect(strength, id).toBeCloseTo((on.get(id) ?? 0) / FAINT_BUILDINGS, 2);
      expect(strength).toBeGreaterThan(on.get(id) ?? 1);
    }
  });

  it("are as they were under areas that lie flat", () => {
    const plain = scene({ points: [{ lat: 41.88, lon: -87.63 }] }, { basemap });
    const flat = scene(buildings([footprint(0, { value: 4 })]), { basemap });
    for (const id of ids(plain).filter((item) => item.startsWith("context-buildings")))
      expect(opacityOf(flat, id)).toEqual(opacityOf(plain, id));
    const drawn = strengths(flat, {});
    for (const [id, strength] of drawn)
      expect(strength, id).toBe((opacityOf(plain, id) as number | undefined) ?? 1);
  });

  it("open tilted only at the zoom of a city: a centre seen from afar is no city", () => {
    const built = scene(buildings([footprint(0, { height: 40 })]), { basemap });
    const at = (opening: object) => opensOnCity({ bounds: built.bounds, opening });
    expect(at({ center: [-87.63, 41.88] })).toBe(true);
    expect(at({ center: [-87.63, 41.88], zoom: 15 })).toBe(true);
    expect(at({ center: [-87.63, 41.88], zoom: 2 })).toBe(false);
    expect(at({ bounds: [-87.7, 41.8, -87.6, 41.9], zoom: 4 })).toBe(false);
    expect(at({ zoom: 3 })).toBe(false);
  });
});
