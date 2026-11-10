import { describe, expect, it } from "vitest";
import { MAP_LIMITS } from "~/lib/codemode/limits";
import { kmBetween } from "~/lib/geo/geodesy";
import {
  type DrawnShape,
  mapShapes,
  newShapeId,
  shapeFacts,
  shapeFeature,
  shapeHolds,
  shapeName,
  shapePath,
} from "~/lib/geo/mapShapes";

const square = (id: string, extra: object = {}) => ({
  id,
  kind: "polygon",
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
    ],
  },
  ...extra,
});
const circle = {
  id: "round",
  kind: "circle",
  geometry: { type: "Point", coordinates: [2.35, 48.85] },
  radiusKm: 100,
};

describe("the stored shapes of a map are reduced every time they are read", () => {
  it("keeps the five kinds, each with its geometry, its name, its colour and its note", () => {
    const stored = [
      { id: "p", kind: "point", geometry: { type: "Point", coordinates: [2, 48] } },
      {
        id: "l",
        kind: "line",
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        },
      },
      square("a", { name: "Delivery zone", color: 3, note: "Mondays only" }),
      { ...square("r"), kind: "rectangle" },
      circle,
    ];
    expect(mapShapes(stored)).toEqual(stored);
    expect(mapShapes(mapShapes(stored))).toEqual(stored);
  });

  it("never throws, and gives no shape for what is no list", () => {
    for (const raw of [undefined, null, 3, "x", {}, { length: 2 }, [null, 1, "a", []]])
      expect(mapShapes(raw)).toEqual([]);
  });

  it("leaves out a shape whose position is no number in range", () => {
    const at = (coordinates: unknown) =>
      mapShapes([{ id: "p", kind: "point", geometry: { type: "Point", coordinates } }]);
    for (const bad of [
      [Number.NaN, 0],
      [0, Number.POSITIVE_INFINITY],
      ["2", 48],
      [0, 91],
      [0, -90.01],
      [541, 0],
      [0],
      null,
      { 0: 1, 1: 2 },
    ])
      expect(at(bad)).toEqual([]);
    expect(at([2.123456789, 48.987654321])[0].geometry.coordinates).toEqual([
      2.123457, 48.987654,
    ]);
  });

  it("leaves out a path or an outline of more positions than a shape has, without reading them", () => {
    const long = Array.from({ length: MAP_LIMITS.drawnVertices + 1 }, (_, at) => [
      at / 100,
      0,
    ]);
    expect(
      mapShapes([
        { id: "l", kind: "line", geometry: { type: "LineString", coordinates: long } },
      ]),
    ).toEqual([]);
    expect(
      mapShapes([
        {
          id: "a",
          kind: "polygon",
          geometry: { type: "Polygon", coordinates: [long] },
        },
      ]),
    ).toEqual([]);
    const most = long.slice(0, MAP_LIMITS.drawnVertices);
    expect(
      mapShapes([
        { id: "l", kind: "line", geometry: { type: "LineString", coordinates: most } },
      ]),
    ).toHaveLength(1);
  });

  it("keeps the first shapes a map holds, and one of each id", () => {
    const many = Array.from({ length: MAP_LIMITS.drawnShapes + 50 }, (_, at) => ({
      id: `s${at}`,
      kind: "point",
      geometry: { type: "Point", coordinates: [0, 0] },
    }));
    expect(mapShapes(many)).toHaveLength(MAP_LIMITS.drawnShapes);
    expect(mapShapes([square("a"), square("a"), square("b")])).toHaveLength(2);
  });

  it("reads only the keys of a shape itself: an id, a kind or a geometry it inherits is none", () => {
    const inherited = Object.create({
      id: "x",
      kind: "point",
      geometry: { type: "Point", coordinates: [0, 0] },
    });
    expect(mapShapes([inherited])).toEqual([]);
    const hostile = JSON.parse(
      '{"id":"a","kind":"polygon","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"url":"https://evil.example","style":{"tiles":["x"]},"geometry":{"type":"Polygon","__proto__":{"x":1},"coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}}',
    );
    const [kept] = mapShapes([hostile]);
    expect(Object.keys(kept)).toEqual(["id", "kind", "geometry"]);
    expect(Object.keys(kept.geometry)).toEqual(["type", "coordinates"]);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    expect(JSON.stringify(kept)).not.toContain("evil");
  });

  it("refuses an id that is not of the grammar, a kind it does not know and a geometry of another kind", () => {
    const point = { type: "Point", coordinates: [0, 0] };
    expect(
      mapShapes([
        { id: "../x", kind: "point", geometry: point },
        { id: "A", kind: "point", geometry: point },
        { id: "__proto__", kind: "point", geometry: point },
        { id: "a".repeat(41), kind: "point", geometry: point },
        { id: "k", kind: "ellipse", geometry: point },
        { id: "l", kind: "line", geometry: point },
        {
          id: "h",
          kind: "polygon",
          geometry: { type: "Polygon", coordinates: [[], []] },
        },
        {
          ...square("r5"),
          kind: "rectangle",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0.5, 2],
                [0, 1],
                [0, 0],
              ],
            ],
          },
        },
        { id: 3, kind: "point", geometry: point },
      ]),
    ).toEqual([]);
  });

  it("keeps a name and a note as bounded text without the characters that reorder or control it", () => {
    const [kept] = mapShapes([
      square("a", {
        name: `<img src=x onerror=alert(1)>‮${"n".repeat(200)}`,
        note: `<script>alert(1)</script>\u0000${"t".repeat(600)}`,
        color: "red",
      }),
    ]);
    expect(kept.name).toHaveLength(MAP_LIMITS.drawnNameChars);
    expect(kept.name?.startsWith("<img src=x onerror=alert(1)>n")).toBe(true);
    expect(kept.note).toHaveLength(MAP_LIMITS.drawnNoteChars);
    expect(kept.note).not.toContain("\u0000");
    expect(kept.color).toBeUndefined();
    for (const color of [6, -1, 1.5, Number.NaN, "#f00", { toString: () => "1" }])
      expect(mapShapes([square("a", { color })])[0].color).toBeUndefined();
    expect(mapShapes([square("a", { color: 5 })])[0].color).toBe(5);
  });

  it("keeps a circle only with a radius above nothing and within what a circle has", () => {
    for (const radiusKm of [
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "5",
      undefined,
      5_000.1,
    ])
      expect(mapShapes([{ ...circle, radiusKm }])).toEqual([]);
    expect(mapShapes([{ ...circle, radiusKm: 5_000 }])).toHaveLength(1);
    expect(mapShapes([square("a", { radiusKm: 5 })])[0].radiusKm).toBeUndefined();
  });

  it("closes an outline that was left open, and writes a shape over the 180th meridian without a jump", () => {
    const [open] = mapShapes([
      {
        id: "a",
        kind: "polygon",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [170, 0],
              [190, 0],
              [190, 10],
            ],
          ],
        },
      },
    ]);
    expect(open.geometry.coordinates[0]).toEqual([
      [170, 0],
      [190, 0],
      [190, 10],
      [170, 0],
    ]);
    const [turned] = mapShapes([
      {
        id: "l",
        kind: "line",
        geometry: {
          type: "LineString",
          coordinates: [
            [530, 0],
            [540, 5],
          ],
        },
      },
    ]);
    expect(turned.geometry.coordinates).toEqual([
      [170, 0],
      [180, 5],
    ]);
  });
});

describe("what a shape is called, holds and says", () => {
  const shapes = mapShapes([
    square("a"),
    square("b", { name: "Delivery zone" }),
    square("c"),
    circle,
  ]);

  it("names a shape without a name by its kind and its place among those", () => {
    expect(shapes.map((shape) => shapeName(shape, shapes))).toEqual([
      "Area 1",
      "Delivery zone",
      "Area 2",
      "Circle 1",
    ]);
    expect(newShapeId(shapes)).toBe("shape-5");
    expect(newShapeId([...shapes, { ...shapes[0], id: "shape-6" }])).toBe("shape-7");
  });

  it("says what is inside: an area by its outline, a circle by the distance on the sphere", () => {
    expect(shapeHolds(shapes[0], [5, 5])).toBe(true);
    expect(shapeHolds(shapes[0], [11, 5])).toBe(false);
    const round = shapes[3];
    expect(shapeHolds(round, [2.35, 49.7])).toBe(true);
    expect(shapeHolds(round, [2.35, 49.8])).toBe(false);
    for (const place of shapePath(round))
      expect(kmBetween(place, [2.35, 48.85])).toBeCloseTo(100, 6);
    expect(
      shapeHolds(
        mapShapes([
          { id: "p", kind: "point", geometry: { type: "Point", coordinates: [5, 5] } },
        ])[0],
        [5, 5],
      ),
    ).toBe(false);
  });

  it("gives code a feature with the name, and a circle as what geo.buffer returns", () => {
    expect(shapeFeature(shapes[1], shapes)).toEqual({
      type: "Feature",
      properties: { id: "b", name: "Delivery zone", kind: "polygon" },
      geometry: shapes[1].geometry,
    });
    const feature = shapeFeature(shapes[3], shapes);
    expect(feature.properties).toEqual({
      id: "round",
      name: "Circle 1",
      kind: "circle",
      radius_km: 100,
    });
    expect(feature.geometry).toMatchObject({
      type: "Polygon",
      center: { lat: 48.85, lon: 2.35 },
      km: 100,
    });
  });

  it("tells an agent how many shapes there are and names the first five, within the length of a note", () => {
    expect(shapeFacts([])).toBeNull();
    expect(shapeFacts(shapes)).toBe(
      '4 drawn shapes: "Area 1" polygon, "Delivery zone" polygon, "Area 2" polygon, "Circle 1" circle',
    );
    const many: DrawnShape[] = Array.from({ length: 9 }, (_, at) => ({
      ...shapes[0],
      id: `s${at}`,
      name: `${"N".repeat(58)}${at}`,
    }));
    const said = shapeFacts(many) ?? "";
    expect(said.length).toBeLessThanOrEqual(MAP_LIMITS.mapNoteChars);
    expect(said.startsWith("9 drawn shapes: ")).toBe(true);
  });
});
