import { describe, expect, it } from "vitest";
import { insideMap } from "~/components/Geo/mapInside";
import { mapShapes } from "~/lib/geo/mapShapes";
import { mapSpec } from "~/lib/geo/mapSpec";

const [europe, pacific, point] = mapShapes([
  {
    id: "europe",
    kind: "rectangle",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-10, 36],
          [20, 36],
          [20, 56],
          [-10, 56],
          [-10, 36],
        ],
      ],
    },
  },
  {
    id: "pacific",
    kind: "circle",
    geometry: { type: "Point", coordinates: [179.5, -17] },
    radiusKm: 800,
  },
  { id: "p", kind: "point", geometry: { type: "Point", coordinates: [2, 48] } },
]);

const spec = mapSpec({
  points: [
    { lat: 48.85, lon: 2.35, label: "Paris" },
    { lat: 40.71, lon: -74.01, label: "New York" },
    { lat: -17.7, lon: 178.0, label: "Suva side" },
    { lat: -16.5, lon: -179.4, label: "East of the meridian" },
  ],
  regions: {
    set: "countries",
    items: [
      { code: "FR", value: 1 },
      { code: "US", value: 2 },
      { code: "DE", value: 3 },
    ],
  },
  shapes: [
    {
      type: "polygon",
      label: "Field in Spain",
      coordinates: [
        [
          [-4, 40],
          [-3, 40],
          [-3, 41],
          [-4, 41],
          [-4, 40],
        ],
      ],
    },
    {
      type: "line",
      label: "Road that starts inside and ends in Asia",
      coordinates: [
        [2, 48],
        [60, 50],
        [100, 40],
      ],
    },
  ],
  layers: [
    {
      id: "trade",
      kind: "flows",
      flows: [
        { from: [2.35, 48.85], to: [13.4, 52.52], label: "Paris to Berlin" },
        { from: [2.35, 48.85], to: [-74, 40.7], label: "Paris to New York" },
      ],
    },
    {
      id: "density",
      kind: "heat",
      points: [
        { lat: 45, lon: 5 },
        { lat: 0, lon: 100 },
      ],
    },
  ],
});

describe("insideMap", () => {
  it("is the map itself when no shape encloses anything", () => {
    expect(insideMap(spec, []).spec).toBe(spec);
    expect(insideMap(spec, [point]).spec).toBe(spec);
  });

  it("keeps a point where it is, a region and an area by their middle, a line by its middle position, a flow by both ends", () => {
    const { spec: left, kept, total } = insideMap(spec, [europe]);
    expect(left.points.map((mark) => mark.label)).toEqual(["Paris"]);
    expect(left.regions?.items.map((item) => item.code)).toEqual(["250", "276"]);
    expect(left.shapes.map((mark) => mark.label)).toEqual(["Field in Spain"]);
    const [flows, heat] = left.layers ?? [];
    expect(flows.kind === "flows" && flows.flows.map((flow) => flow.label)).toEqual([
      "Paris to Berlin",
    ]);
    expect(heat.kind === "heat" && heat.points).toHaveLength(1);
    expect({ kept, total }).toEqual({ kept: 6, total: 13 });
  });

  it("does not change the map it was given", () => {
    const before = JSON.stringify(spec);
    insideMap(spec, [europe]);
    expect(JSON.stringify(spec)).toBe(before);
  });

  it("keeps what is inside one of several shapes, also across the 180th meridian", () => {
    const { spec: left } = insideMap(spec, [europe, pacific]);
    expect(left.points.map((mark) => mark.label)).toEqual([
      "Paris",
      "Suva side",
      "East of the meridian",
    ]);
  });

  it("keeps every layer in its place when none of its marks is inside", () => {
    const { spec: left, kept } = insideMap(spec, [pacific]);
    expect(left.layers?.map((layer) => layer.id)).toEqual(["trade", "density"]);
    expect(left.regions?.items).toEqual([]);
    expect(kept).toBe(2);
  });

  it("asks 20,000 points of a shape of 500 corners in well bounded work", () => {
    const corners = Array.from({ length: 499 }, (_, at) => {
      const turn = (at / 499) * 2 * Math.PI;
      return [10 * Math.cos(turn), 10 * Math.sin(turn)];
    });
    const [round] = mapShapes([
      {
        id: "round",
        kind: "polygon",
        geometry: { type: "Polygon", coordinates: [[...corners, corners[0]]] },
      },
    ]);
    const many = mapSpec({
      points: Array.from({ length: 20_000 }, (_, at) => ({
        lat: ((at * 37) % 160) - 80,
        lon: ((at * 91) % 340) - 170,
      })),
    });
    const { kept, total } = insideMap(many, [round]);
    expect(total).toBe(20_000);
    expect(kept).toBeGreaterThan(50);
    expect(kept).toBeLessThan(400);
  });
});
