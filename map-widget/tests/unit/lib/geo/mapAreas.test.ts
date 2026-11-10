import { describe, expect, it } from "vitest";
import { MAP_LIMITS } from "~/lib/codemode/limits";
import { toGeoJson } from "~/lib/geo/files/export";
import { widgetMap } from "~/lib/geo/mapData";
import { AREA_HEIGHT_MAX, FLOOR_METRES } from "~/lib/geo/mapMarkTypes";
import { makeMap, mapSpec } from "~/lib/geo/mapSpec";
import { cpuBudget, cpuNow } from "../../machinePace";

const RING = [
  [-87.63, 41.88],
  [-87.629, 41.88],
  [-87.629, 41.881],
  [-87.63, 41.881],
  [-87.63, 41.88],
];
const area = (more: object = {}) => ({ type: "polygon", coordinates: [RING], ...more });
const heightsOf = (raw: unknown) =>
  mapSpec(raw).shapes.map((shape) =>
    shape.type === "polygon" ? shape.height : "line",
  );

describe("an area that stands: the footprint of a building", () => {
  it("keeps its height in metres, to a tenth", () => {
    expect(heightsOf({ shapes: [area({ height: 96.44 })] })).toEqual([96.4]);
  });

  it("takes its floors when it gives no height, and holds metres only", () => {
    const spec = mapSpec({
      shapes: [area({ floors: 10 }), area({ height: 20, floors: 99 })],
    });
    expect(heightsOf(spec)).toEqual([10 * FLOOR_METRES, 20]);
    expect(JSON.stringify(spec)).not.toContain("floors");
  });

  it("is bounded: nothing stands taller than the limit, and what is no height lies flat", () => {
    expect(
      heightsOf({
        shapes: [
          area({ height: 12_000 }),
          area({ height: 0 }),
          area({ height: -4 }),
          area({ height: "forty" }),
          area({ height: Number.NaN }),
          area(),
        ],
      }),
    ).toEqual([AREA_HEIGHT_MAX, undefined, undefined, undefined, undefined, undefined]);
  });

  it("comes out equal when it is read again", () => {
    const once = mapSpec({
      layers: [{ kind: "polygons", shapes: [area({ height: 55, value: 3 })] }],
    });
    expect(mapSpec(once)).toEqual(once);
  });

  it("gives a line no height", () => {
    const spec = mapSpec({
      shapes: [{ type: "line", coordinates: RING, height: 30 }],
    });
    expect(Object.keys(spec.shapes[0])).not.toContain("height");
  });

  it("is read from the height or the floors of a GeoJSON feature, which stay in its card", () => {
    const feature = (properties: object) => ({
      type: "Feature",
      properties,
      geometry: { type: "Polygon", coordinates: [RING] },
    });
    const spec = makeMap({
      geojson: {
        type: "FeatureCollection",
        features: [
          feature({ name: "A", height: 80 }),
          feature({ name: "B", floors: 5 }),
          feature({ name: "C" }),
        ],
      },
    });
    expect(heightsOf(spec)).toEqual([80, 16, undefined]);
    expect(spec.shapes[0].props).toEqual({ height: 80 });
  });

  it("is read from the property the definition of a Map widget names, with the value that colours it", () => {
    const made = widgetMap(
      {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { name: "A", height_m: 61, energy: 210 },
            geometry: { type: "Polygon", coordinates: [RING] },
          },
        ],
      },
      { value: "energy", height: "height_m", title: "Downtown", valueLabel: "Energy" },
      [],
    );
    expect(made?.spec).toMatchObject({
      title: "Downtown",
      valueLabel: "Energy",
      shapes: [
        { label: "A", value: 210, height: 61, props: { height_m: 61, energy: 210 } },
      ],
    });
  });

  it("is written with its height in a file, and a reader of the file draws it as tall again", () => {
    const spec = mapSpec({
      layers: [
        {
          kind: "polygons",
          name: "Buildings",
          shapes: [area({ label: "A", height: 42, value: 7 })],
        },
      ],
    });
    const written = JSON.parse(toGeoJson(spec));
    expect(written.features[0].properties).toMatchObject({
      name: "A",
      value: 7,
      height: 42,
    });
    expect(heightsOf(makeMap({ geojson: written }))).toEqual([42]);
  });
});

describe("a height the map does not draw as it was written", () => {
  const RING_OF = [
    [
      [0, 0],
      [0.001, 0],
      [0.001, 0.001],
      [0, 0],
    ],
  ];
  const tall = (height: unknown) => ({ type: "polygon", coordinates: RING_OF, height });

  it("reads a height written as text, as the other numbers of a row are read", () => {
    const spec = makeMap({
      shapes: [tall("12"), tall(" 96.44 "), { ...tall(undefined), floors: "3" }],
    });
    expect(spec.shapes.map((shape) => "height" in shape && shape.height)).toEqual([
      12, 96.4, 9.6,
    ]);
    expect(spec.notes).toBeUndefined();
  });

  it("says how many areas are drawn at the limit, and nothing when none is", () => {
    const spec = makeMap({
      shapes: [
        tall(5000),
        tall(1200),
        tall(1001),
        tall(40),
        tall(30),
        tall(20),
        tall(1000),
      ],
    });
    expect(spec.notes).toEqual([
      "3 areas are drawn at 1,000 m, the most an area stands.",
    ]);
    expect(makeMap({ shapes: [tall(1000), tall(40)] }).notes).toBeUndefined();
  });

  it("says that the unit may not be metres when most heights are over the limit", () => {
    const spec = makeMap({ shapes: [tall(4500), tall(12000), tall(980), tall(3000)] });
    expect(spec.notes).toEqual([
      "3 areas are drawn at 1,000 m, the most an area stands: most heights are over it, so they may not be in metres (a height is in metres: divide centimetres by 100, multiply feet by 0.3048).",
    ]);
  });

  it("says how many heights are no number, with the first, and lays those areas flat", () => {
    const spec = makeMap({
      shapes: [tall("12 m"), tall("tall"), tall(30), tall(0), tall(null)],
    });
    expect(spec.shapes.map((shape) => "height" in shape)).toEqual([
      false,
      false,
      true,
      false,
      false,
    ]);
    expect(spec.notes).toEqual([
      '2 areas have a height that is no number ("12 m") and lie flat: a height is a number of metres.',
    ]);
    expect(mapSpec(spec)).toEqual(spec);
  });
});

describe("more lines and areas than a map draws", () => {
  const SQUARE = [
    [
      [0, 0],
      [0.01, 0],
      [0.01, 0.01],
      [0, 0],
    ],
  ];
  const REMEDY =
    "Aggregate them to regions the app has (plot.regions by state, county or country), keep the ones the question is about, or serve them as vector tiles from a map source of a backend (workspace.mapSources).";

  it("is a limit measured in a browser: 3,500 areas like census tracts, which a metro area has", () => {
    expect(MAP_LIMITS.shapes).toBe(3_500);
    const tracts = Array.from({ length: 3_300 }, () => ({
      type: "polygon",
      coordinates: SQUARE,
    }));
    expect(makeMap({ shapes: tracts }).shapes).toHaveLength(3_300);
  });

  it("says how many there are, and what to do, for shapes given as they are", () => {
    const shapes = Array.from({ length: MAP_LIMITS.shapes + 250 }, () => ({
      type: "polygon",
      coordinates: SQUARE,
    }));
    expect(() => makeMap({ shapes })).toThrow(
      `output.map: the map has 3,750 lines and areas. A map draws at most 3,500. ${REMEDY}`,
    );
  });

  it("says the real number of a GeoJSON value, not one over the limit, without copying past it", () => {
    const polygon = { type: "Polygon", coordinates: SQUARE };
    const collection = {
      type: "FeatureCollection",
      features: Array.from({ length: 50_000 }, () => ({
        type: "Feature",
        properties: {},
        geometry: polygon,
      })),
    };
    const started = cpuNow();
    expect(() => makeMap({ geojson: collection })).toThrow(
      `output.map: the GeoJSON has 50,000 lines and areas. A map draws at most 3,500. ${REMEDY}`,
    );
    expect(cpuNow() - started).toBeLessThan(cpuBudget(1_000));
  });

  it("says that each part of a multi-shape is one, when that is what takes the map over", () => {
    const two = {
      type: "MultiPolygon",
      coordinates: [SQUARE, SQUARE],
    };
    const collection = {
      type: "FeatureCollection",
      features: Array.from({ length: 2_400 }, () => ({
        type: "Feature",
        properties: {},
        geometry: two,
      })),
    };
    expect(() => makeMap({ geojson: collection })).toThrow(
      `output.map: the GeoJSON has 4,800 lines and areas: each part of a MultiPolygon or a MultiLineString is one, and its 2,400 features have 4,800 parts. A map draws at most 3,500. ${REMEDY}`,
    );
    const fits = { ...collection, features: collection.features.slice(0, 1_000) };
    expect(makeMap({ geojson: fits }).shapes).toHaveLength(2_000);
  });

  it("says the same of the points of a GeoJSON value", () => {
    const collection = {
      type: "FeatureCollection",
      features: Array.from({ length: MAP_LIMITS.points + 5_000 }, () => ({
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [1, 2] },
      })),
    };
    expect(() => makeMap({ geojson: collection })).toThrow(
      /the map has 25,000 points\./,
    );
  });
});
