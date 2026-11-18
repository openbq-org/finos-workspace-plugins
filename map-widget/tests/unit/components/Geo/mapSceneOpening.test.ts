import { describe, expect, it } from "vitest";
import { STANDING_MAX_ZOOM, viewBounds } from "~/components/Geo/mapGeometry";
import {
  HELD_NOTE,
  HELD_PLAIN_NOTE,
  mapNote,
  STREET_NOTE,
} from "~/components/Geo/mapWords";
import { BOUNDARY_MAX_ZOOM, BOUNDARY_VIEW_ZOOM } from "~/components/Geo/scene/base";
import { MAP_LIMITS } from "~/lib/codemode/limits";
import { mapSpec } from "~/lib/geo/mapSpec";
import { scene, states } from "./scene/support";

describe("buildScene", () => {
  it("opens a map of the United States on the contiguous states and counts the rest", () => {
    const all = scene({
      regions: {
        set: "us-states",
        items: states.shapes.features
          .map((shape) => shape.properties.code)
          .filter((code) => Number(code) <= 56)
          .map((code) => ({ code, value: 1 })),
      },
    });
    expect(all.outside).toBe(2);
    expect(all.bounds?.[0]).toBeGreaterThan(-126);
    const few = scene({
      regions: {
        set: "us-states",
        items: [{ code: "AK" }, { code: "HI" }, { code: "CA" }],
      },
    });
    expect(few.outside).toBe(0);
    expect(few.bounds?.[0]).toBeLessThan(-170);
  });

  it("keeps the waters and the borders around the contiguous states in the view: a storm over the Gulf is not outside", () => {
    const track = scene({
      points: [
        { lat: 23.2, lon: -86.5 },
        { lat: 25.1, lon: -88.7 },
        { lat: 29.9, lon: -90.5 },
        { lat: 36.1, lon: -87.5 },
        { lat: 41.9, lon: -87.6 },
      ],
    });
    expect(track.outside).toBe(0);
    expect(track.bounds?.[1]).toBeLessThan(24);
  });

  it("opens one place as near as the backdrop shows it: a pin at street level on a basemap without streets is a pin on nothing", () => {
    const street = { center: [-74.0113, 40.7074], zoom: 16 };
    const pin = scene({ points: [{ lat: 40.7074, lon: -74.0113 }], view: street });
    expect(pin.streets).toBe(false);
    expect(pin.openingLimit).toBe(pin.backdropZoom);
    expect(pin.opening?.zoom).toBe(16);
    expect(pin.maxZoom).toBeLessThan(16);
    const spec = mapSpec({ points: [{ lat: 40.7074, lon: -74.0113 }] });
    expect(mapNote(spec, pin)).toBeNull();
    expect(mapNote(spec, pin, "past")).toBe(STREET_NOTE);
    expect(mapNote(spec, pin, "held")).toBe(HELD_PLAIN_NOTE);
    const wide = scene({
      points: [
        { lat: 40.7074, lon: -74.0113 },
        { lat: 34.05, lon: -118.24 },
      ],
      view: street,
    });
    expect(wide.openingLimit).toBe(wide.backdropZoom);
    const blockOf = (view: object) =>
      scene({
        points: [
          { lat: 41.8772, lon: -87.6364 },
          { lat: 41.8777, lon: -87.636 },
        ],
        view,
      });
    expect(
      blockOf({ center: [-87.65, 41.85], place: "Chicago" }).opening,
    ).toBeUndefined();
    expect(blockOf({ center: [-87.65, 41.85], place: "Chicago" }).detailZoom).toBe(17);
    expect(
      blockOf({ center: [-87.65, 41.85], zoom: 11, place: "Chicago" }).opening?.zoom,
    ).toBe(11);
    expect(blockOf({ center: [-74, 40.7], place: "New York" }).opening?.center).toEqual(
      [-74, 40.7],
    );
    const block = scene({
      points: [
        { lat: 40.7074, lon: -74.0113 },
        { lat: 40.7081, lon: -74.0102 },
      ],
      view: street,
    });
    expect(block.openingLimit).toBe(17);
    expect(block.opening?.zoom).toBe(16);
    expect(block.maxZoom).toBeGreaterThanOrEqual(16);
  });

  it("holds a view that asks for the nearest zoom to what its backdrop shows, and lets it through where nothing limits it", () => {
    expect(MAP_LIMITS.viewZoom).toBe(STANDING_MAX_ZOOM);
    const nearest = { center: [-74.0113, 40.7074], zoom: MAP_LIMITS.viewZoom };
    const pin = scene({ points: [{ lat: 40.7074, lon: -74.0113 }], view: nearest });
    expect(pin.opening?.zoom).toBe(19);
    expect(pin.openingLimit).toBe(pin.backdropZoom);
    expect(pin.maxZoom).toBeLessThan(19);
    expect(
      mapNote(mapSpec({ points: [{ lat: 40.7074, lon: -74.0113 }] }), pin, "held"),
    ).toBe(HELD_PLAIN_NOTE);
    expect(
      mapNote(
        mapSpec({ points: [{ lat: 40.7074, lon: -74.0113 }] }),
        { ...pin, backdrop: "standard" },
        "held",
      ),
    ).toBe(HELD_NOTE);
    const lot = scene({
      shapes: [
        {
          type: "polygon",
          coordinates: [
            [
              [-74.0114, 40.7073],
              [-74.0112, 40.7073],
              [-74.0112, 40.7075],
              [-74.0114, 40.7073],
            ],
          ],
        },
      ],
      view: nearest,
    });
    expect(lot.openingLimit).toBeUndefined();
    expect(lot.opening?.zoom).toBe(19);
    expect(lot.maxZoom).toBe(19);
  });

  it("opens a few shapes of one place as near as a block is read, and many or wide ones as shapes always opened", () => {
    const lot = (at: number) => ({
      type: "polygon",
      coordinates: [
        [
          [-87.6366 + at * 0.0004, 41.8769],
          [-87.6363 + at * 0.0004, 41.8769],
          [-87.6363 + at * 0.0004, 41.8773],
          [-87.6366 + at * 0.0004, 41.8769],
        ],
      ],
    });
    const block = scene({ shapes: [0, 1, 2, 3, 4].map(lot) });
    expect(block.detailZoom).toBe(17);
    const many = scene({ shapes: Array.from({ length: 40 }, (_, at) => lot(at)) });
    expect(many.detailZoom).toBe(14);
    const apart = scene({
      shapes: [
        lot(0),
        {
          ...lot(0),
          coordinates: [lot(0).coordinates[0].map(([x, y]) => [x + 20, y])],
        },
      ],
    });
    expect(apart.detailZoom).toBe(14);
  });

  it("opens on its data when the place of its view was not resolved", () => {
    const built = scene({
      points: [
        { lat: 41.8772, lon: -87.6364 },
        { lat: 34.05, lon: -118.24 },
      ],
      view: { place: "Wall Street" },
    });
    expect(built.opening).toBeUndefined();
    expect(built.openingLimit).toBeUndefined();
    expect(built.bounds?.[0]).toBeCloseTo(-118.24, 2);
  });

  it("opens the view of a state on all its layers, as far as the backdrop goes", () => {
    const texas = [-106.65, 25.84, -93.51, 36.5];
    const built = scene({
      regions: {
        set: "us-states",
        items: [
          { code: "TX", value: 1 },
          { code: "NY", value: 2 },
        ],
      },
      points: [{ lat: 40.7, lon: -74 }],
      view: { bounds: texas, place: "Texas" },
    });
    expect(built.opening).toEqual({ bounds: texas, place: "Texas" });
    expect(built.marks).toHaveLength(3);
    expect(built.openingLimit).toBe(built.backdropZoom);
  });

  it("says which of the marks outside the view are in another country: a store in London is not Alaska", () => {
    const home = Array.from({ length: 9 }, (_, at) => ({
      lat: 35 + at,
      lon: -100 + at,
    }));
    const note = (more: { lat: number; lon: number }[]) => {
      const raw = {
        regions: { set: "us-states", items: [{ code: "IA", value: 1 }] },
        points: [...home, ...more],
      };
      return mapNote(mapSpec(raw), scene(raw));
    };
    expect(note([{ lat: 61.2, lon: -149.9 }])).toBe(
      "1 more outside this view (Alaska, Hawaii, territories): zoom out.",
    );
    expect(note([{ lat: 51.5, lon: -0.1 }])).toBe(
      "1 more outside this view (outside the United States): zoom out.",
    );
    expect(
      note([
        { lat: 21.3, lon: -157.9 },
        { lat: 51.5, lon: -0.1 },
      ]),
    ).toBe("2 more outside this view (1 outside the United States): zoom out.");
  });

  it("counts a region outside the view once, however many steps of time it has", () => {
    const codes = states.shapes.features
      .map((shape) => shape.properties.code)
      .filter((code) => Number(code) <= 56);
    const played = scene({
      regions: {
        set: "us-states",
        items: ["2023", "2024", "2025"].flatMap((time) =>
          codes.map((code) => ({ code, value: 1, time })),
        ),
      },
    });
    expect(played.outside).toBe(2);
  });
});

describe("how near a map goes", () => {
  it("is the detail of the backdrop for points and regions, and past it for shapes", () => {
    const points = scene({ points: [{ lat: 42, lon: -93.6 }] });
    expect(points.maxZoom).toBe(BOUNDARY_VIEW_ZOOM);
    expect(points.detailZoom).toBe(0);
    const shaded = scene({
      regions: { set: "us-counties", items: [{ code: "36061", value: 1 }] },
    });
    expect(shaded.maxZoom).toBe(BOUNDARY_MAX_ZOOM);
    expect(shaded.backdropZoom).toBe(BOUNDARY_VIEW_ZOOM);
    const field = scene({
      shapes: [
        {
          type: "polygon",
          coordinates: [
            [
              [-93.62, 42.03],
              [-93.615, 42.03],
              [-93.615, 42.034],
              [-93.62, 42.034],
              [-93.62, 42.03],
            ],
          ],
        },
      ],
    });
    expect(field.maxZoom).toBe(17);
    expect(field.detailZoom).toBe(14);
  });

  it("is past the detail of the backdrop for several marks of one city, and not for one mark or the world", () => {
    const london = scene({
      points: [
        { lat: 51.514, lon: -0.089 },
        { lat: 51.505, lon: -0.02 },
        { lat: 51.47, lon: -0.44 },
      ],
    });
    expect([london.maxZoom, london.detailZoom]).toEqual([17, 17]);
    const many = scene({
      points: Array.from({ length: 31 }, (_, at) => ({
        lat: 51.47 + at * 0.001,
        lon: -0.44 + at * 0.01,
      })),
    });
    expect([many.maxZoom, many.detailZoom]).toEqual([14, 12]);
    const world = scene({
      points: [
        { lat: 51.5, lon: -0.1 },
        { lat: 1.35, lon: 103.8 },
      ],
    });
    expect([world.maxZoom, world.detailZoom]).toEqual([BOUNDARY_VIEW_ZOOM, 0]);
    const twice = scene({
      points: [
        { lat: 51.5, lon: -0.1 },
        { lat: 51.5, lon: -0.1 },
      ],
    });
    expect([twice.maxZoom, twice.detailZoom]).toEqual([BOUNDARY_VIEW_ZOOM, 0]);
  });
});

describe("viewBounds", () => {
  it("never opens on one point alone, and stays in the latitudes a Mercator map draws", () => {
    expect(viewBounds([10, 10, 10, 10])).toEqual([
      [9.25, 9.5],
      [10.75, 10.5],
    ]);
    expect(viewBounds([-180, -90, 180, 90])).toEqual([
      [-180, -60],
      [180, 80],
    ]);
    expect(viewBounds(null)[0][0]).toBe(-170);
  });

  it("opens closer on marks that are together when the basemap has the detail", () => {
    const span = (closer: number) => {
      const [[west, south], [east, north]] = viewBounds(
        [-74.01, 40.7, -74.0, 40.71],
        closer,
      );
      return [east - west, north - south];
    };
    expect(span(0)).toEqual([1.5, 1]);
    expect(span(7)[0]).toBeCloseTo(1.5 / 128, 6);
    expect(span(7)[1]).toBeCloseTo(0.01, 6);
    expect(viewBounds([-100, 30, -80, 45], 7)).toEqual(viewBounds([-100, 30, -80, 45]));
  });
});
