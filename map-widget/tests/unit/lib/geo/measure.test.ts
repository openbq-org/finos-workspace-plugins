import { describe, expect, it } from "vitest";
import { circleRing, EARTH_KM, kmBetween, type Position } from "~/lib/geo/geodesy";
import { mapShapes } from "~/lib/geo/mapShapes";
import {
  areaText,
  circleKm2,
  lengthText,
  measureOf,
  measureText,
  pathKm,
  placeText,
  ringKm2,
  ringRoundKm,
  segmentsKm,
  shapeMeasure,
} from "~/lib/geo/measure";

const LENGTH_TOLERANCE = 0.006;
const AREA_TOLERANCE = 0.01;
const within = (value: number, reference: number, tolerance: number) =>
  expect(Math.abs(value - reference) / reference).toBeLessThan(tolerance);

const cell = (west: number, south: number, size = 1): Position[] => [
  [west, south],
  [west + size, south],
  [west + size, south + size],
  [west, south + size],
  [west, south],
];
const R = 6371.0088;

describe("the length of a path", () => {
  it("is 3,974 km from JFK to LAX, along the great circle", () => {
    const km = pathKm([
      [-73.7781, 40.6413],
      [-118.4085, 33.9416],
    ]);
    within(km, 3974, 0.002);
    within(km, 3983, LENGTH_TOLERANCE);
  });

  it("is 111.32 km for a degree of longitude at the equator, within the tolerance of a sphere", () => {
    const km = pathKm([
      [0, 0],
      [1, 0],
    ]);
    expect(km).toBeCloseTo(111.195, 3);
    within(km, 111.32, LENGTH_TOLERANCE);
    within(
      pathKm([
        [0, 89],
        [0, 90],
      ]),
      111.694,
      LENGTH_TOLERANCE,
    );
  });

  it("is the same across the 180th meridian however the path is written, and the short way round", () => {
    const past = pathKm([
      [170, -17],
      [190, -17],
    ]);
    const folded = pathKm([
      [170, -17],
      [-170, -17],
    ]);
    expect(past).toBeCloseTo(folded, 9);
    expect(past).toBeGreaterThan(2100);
    expect(past).toBeLessThan(2130);
  });

  it("is the sum of its stretches, each of which is said", () => {
    const path: Position[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const stretches = segmentsKm(path);
    expect(stretches).toHaveLength(3);
    expect(stretches[0]).toBeCloseTo(111.195, 3);
    expect(stretches[1]).toBeCloseTo(111.195, 3);
    expect(stretches[2]).toBeCloseTo(111.178, 3);
    expect(pathKm(path)).toBeCloseTo(stretches[0] + stretches[1] + stretches[2], 9);
    expect(pathKm([[2, 2]])).toBe(0);
    expect(pathKm([])).toBe(0);
  });
});

describe("the area inside an outline", () => {
  it("is 12,309 sq km for a cell of one degree at the equator and 6,123 at 60 degrees north, within the tolerance of a sphere", () => {
    const equator = ringKm2(cell(0, 0));
    const north = ringKm2(cell(10, 60));
    expect(equator).toBeCloseTo(12363.72, 0);
    expect(north).toBeCloseTo(6088.4, 0);
    within(equator, 12308.46, AREA_TOLERANCE);
    within(north, 6123.14, AREA_TOLERANCE);
    expect(north / equator).toBeCloseTo(0.4924, 3);
    const rad = Math.PI / 180;
    within(
      ringKm2(cell(0, 88)),
      R * R * rad * (Math.sin(89 * rad) - Math.sin(88 * rad)),
      0.005,
    );
    within(ringKm2(cell(0, 88)), 326.6, AREA_TOLERANCE);
  });

  it("is the same whichever way the outline runs, closed or left open", () => {
    const ring = cell(2, 48);
    const back = [...ring].reverse();
    expect(ringKm2(back)).toBeCloseTo(ringKm2(ring), 6);
    expect(ringKm2(ring.slice(0, -1))).toBeCloseTo(ringKm2(ring), 6);
    expect(ringKm2(ring.slice(0, 2))).toBe(0);
  });

  it("is the same across the 180th meridian, written past it or folded", () => {
    const here = ringKm2(cell(10, -18, 2));
    expect(ringKm2(cell(179, -18, 2))).toBeCloseTo(here, 4);
    expect(
      ringKm2([
        [179, -18],
        [-179, -18],
        [-179, -16],
        [179, -16],
        [179, -18],
      ]),
    ).toBeCloseTo(here, 4);
  });

  it("is an eighth of the earth for the triangle of the equator, two meridians a quarter turn apart and a pole", () => {
    const eighth = (4 * Math.PI * R * R) / 8;
    for (const pole of [90, -90]) {
      expect(
        ringKm2([
          [0, 0],
          [90, 0],
          [0, pole],
          [0, 0],
        ]),
      ).toBeCloseTo(eighth, 3);
      expect(
        ringKm2([
          [0, 0],
          [90, 0],
          [-133, pole],
        ]),
      ).toBeCloseTo(eighth, 3);
    }
  });

  it("is the cap around a pole for an outline that goes round it, and the smaller of the two regions of any outline", () => {
    const round = Array.from({ length: 360 }, (_, at): Position => [at - 180, 80]);
    const cap = 2 * Math.PI * R * R * (1 - Math.sin((80 * Math.PI) / 180));
    within(ringKm2(round), cap, 0.001);
    const most = Array.from({ length: 360 }, (_, at): Position => [at - 180, -80]);
    within(ringKm2(most), cap, 0.001);
  });

  it("agrees with the outline of a circle, whose area is that of a cap of the sphere", () => {
    for (const [centre, km] of [
      [[2.35, 48.85], 100],
      [[20, 60], 500],
      [[179, -16], 1500],
      [[20, 86], 900],
    ] as [Position, number][]) {
      const ring = circleRing(centre, km, 720);
      within(ringKm2(ring), circleKm2(km), 0.0005);
      within(ringRoundKm(ring), measureOf("circle", [centre], km).roundKm ?? 0, 0.0005);
    }
    expect(circleKm2(1000)).toBeLessThan(Math.PI * 1e6);
    within(circleKm2(1000), Math.PI * 1e6, 0.003);
    expect(circleKm2((Math.PI / 2) * R)).toBeCloseTo(2 * Math.PI * R * R, 3);
  });

  it("draws a circle of 500 km at 60 degrees north as a circle of the earth: twice as wide in degrees as it is tall", () => {
    const ring = circleRing([20, 60], 500);
    const lons = ring.map(([lon]) => lon);
    const lats = ring.map(([, lat]) => lat);
    const wide = Math.max(...lons) - Math.min(...lons);
    const tall = Math.max(...lats) - Math.min(...lats);
    expect(tall).toBeCloseTo((2 * 500) / 111.195, 1);
    expect(wide / tall).toBeGreaterThan(1.9);
    for (const place of ring) expect(kmBetween(place, [20, 60])).toBeCloseTo(500, 6);
  });
});

describe("what a shape measures, and how it is said", () => {
  const [line, area, circle, point] = mapShapes([
    {
      id: "l",
      kind: "line",
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
      },
    },
    {
      id: "a",
      kind: "polygon",
      geometry: { type: "Polygon", coordinates: [cell(0, 0)] },
    },
    {
      id: "c",
      kind: "circle",
      geometry: { type: "Point", coordinates: [20, 60] },
      radiusKm: 500,
    },
    {
      id: "p",
      kind: "point",
      geometry: { type: "Point", coordinates: [-73.98567, 40.74844] },
    },
  ]);

  it("measures each kind by what it is", () => {
    expect(shapeMeasure(line).lengthKm).toBeCloseTo(222.39, 2);
    expect(shapeMeasure(line).segmentsKm).toHaveLength(2);
    expect(shapeMeasure(area).areaKm2).toBeCloseTo(12363.72, 0);
    expect(shapeMeasure(area).roundKm).toBeCloseTo(444.76, 1);
    expect(shapeMeasure(circle)).toMatchObject({ radiusKm: 500 });
    expect(shapeMeasure(circle).areaKm2).toBeCloseTo(circleKm2(500), 6);
    expect(shapeMeasure(point)).toEqual({
      kind: "point",
      place: [-73.98567, 40.74844],
    });
  });

  it("writes a length and an area in the unit of their size, in the units the reader has", () => {
    expect(lengthText(0.4321, "metric")).toBe("432 m");
    expect(lengthText(12.345, "metric")).toBe("12.3 km");
    expect(lengthText(3974.2, "metric")).toBe("3,974 km");
    expect(lengthText(0.05, "imperial")).toBe("164 ft");
    expect(lengthText(3974.2, "imperial")).toBe("2,469 mi");
    expect(areaText(0.0005, "metric")).toBe("500 m²");
    expect(areaText(0.5, "metric")).toBe("50 ha");
    expect(areaText(12363.7, "metric")).toBe("12,364 km²");
    expect(areaText(0.0001, "imperial")).toBe("1,076 sq ft");
    expect(areaText(0.5, "imperial")).toBe("124 acres");
    expect(areaText(12363.7, "imperial")).toBe("4,774 sq mi");
    expect(lengthText(Number.NaN, "metric")).toBe("");
  });

  it("writes a place as its latitude and its longitude, and a shape on one line", () => {
    expect(placeText([-73.98567, 40.74844])).toBe("40.74844, -73.98567");
    expect(placeText([190, -17])).toBe("-17, -170");
    expect(measureText(shapeMeasure(point), "metric")).toBe("40.74844, -73.98567");
    expect(measureText(shapeMeasure(line), "metric")).toBe("222 km");
    expect(measureText(shapeMeasure(area), "metric")).toBe("12,364 km², 445 km round");
    expect(measureText(shapeMeasure(circle), "imperial")).toBe(
      "303,088 sq mi, radius 311 mi",
    );
  });
});

describe("the measure of a rectangle", () => {
  const box = (
    west: number,
    south: number,
    east: number,
    north: number,
  ): Position[] => [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
  const RAD = Math.PI / 180;

  it("is the area between its two parallels, not between great circles", () => {
    const { areaKm2 } = measureOf("rectangle", box(-125, 30, -65, 49));
    const exact =
      EARTH_KM * EARTH_KM * 60 * RAD * (Math.sin(49 * RAD) - Math.sin(30 * RAD));
    expect(areaKm2).toBeCloseTo(exact, 3);
    expect(ringKm2(box(-125, 30, -65, 49)) / exact).toBeLessThan(0.98);
  });

  it("is as long round as its two meridians and its two parallels", () => {
    const { roundKm } = measureOf("rectangle", box(0, 50, 60, 60));
    const exact =
      EARTH_KM * (2 * 10 * RAD + 60 * RAD * (Math.cos(50 * RAD) + Math.cos(60 * RAD)));
    expect(roundKm).toBeCloseTo(exact, 6);
  });

  it("measures the same written over the 180th meridian, open or closed, from any corner", () => {
    const near = measureOf("rectangle", box(10, -5, 30, 5));
    const far = measureOf("rectangle", box(170, -5, 190, 5));
    expect(far.areaKm2).toBeCloseTo(near.areaKm2 ?? 0, 6);
    expect(far.roundKm).toBeCloseTo(near.roundKm ?? 0, 6);
    const ring = box(10, -5, 30, 5);
    expect(measureOf("rectangle", ring.slice(0, -1))).toEqual(near);
    expect(
      measureOf("rectangle", [ring[2], ring[3], ring[0], ring[1], ring[2]]),
    ).toEqual(near);
  });

  it("measures an outline that is no such box by its great circles", () => {
    const leaning: Position[] = [
      [0, 0],
      [10, 1],
      [10, 11],
      [0, 10],
      [0, 0],
    ];
    expect(measureOf("rectangle", leaning).areaKm2).toBe(ringKm2(leaning));
    expect(measureOf("rectangle", leaning.slice(0, 2)).areaKm2).toBe(0);
  });
});
