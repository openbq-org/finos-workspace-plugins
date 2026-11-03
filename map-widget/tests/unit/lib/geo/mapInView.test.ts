import { describe, expect, it } from "vitest";
import { mapNote } from "~/components/Geo/mapWords";
import {
  countedArea,
  inViewNote,
  MARK_EDGE_PIXELS,
  marksInView,
} from "~/lib/geo/mapInView";
import { mapSpec } from "~/lib/geo/mapSpec";

const MANHATTAN = [-74.03, 40.7, -73.93, 40.8];
const offices = [
  { lat: 34.05, lon: -118.24, label: "Los Angeles" },
  { lat: 41.88, lon: -87.63, label: "Chicago" },
  { lat: 40.7527, lon: -73.9772, label: "Midtown" },
];

describe("the points of a map inside the view it opens on", () => {
  it("counts them, with the points of every layer of points", () => {
    expect(marksInView({ points: offices }, MANHATTAN)).toEqual({ inside: 1, of: 3 });
    expect(
      marksInView(
        {
          points: offices.slice(0, 1),
          layers: [{ id: "more", kind: "points", points: offices.slice(1) }] as never,
        },
        MANHATTAN,
      ),
    ).toEqual({ inside: 1, of: 3 });
  });

  it("says how far the nearest point is from the middle of the view when none is inside", () => {
    const found = marksInView({ points: offices.slice(0, 2) }, MANHATTAN);
    expect(found?.inside).toBe(0);
    expect(found?.nearestKm).toBeGreaterThan(1100);
    expect(found?.nearestKm).toBeLessThan(1200);
  });

  it("says nothing without a box, without a point, or for a box that is not four numbers", () => {
    expect(marksInView({ points: offices }, undefined)).toBeUndefined();
    expect(marksInView({ points: [] }, MANHATTAN)).toBeUndefined();
    expect(marksInView({ points: offices }, [1, 2, Number.NaN, 4])).toBeUndefined();
  });

  it("is a note of the map only when a point is outside the view", () => {
    expect(inViewNote({ inside: 0, of: 4, nearestKm: 9 })).toBe(
      "None of the 4 points are in this view: Show all data fits the map to them.",
    );
    expect(inViewNote({ inside: 0, of: 1 })).toBe(
      "The point is not in this view: Show all data fits the map to it.",
    );
    expect(inViewNote({ inside: 2, of: 9 })).toBe(
      "2 of 9 points are in this view: Show all data fits the map to all of them.",
    );
    expect(inViewNote({ inside: 3, of: 3 })).toBeNull();
    expect(inViewNote(undefined)).toBeNull();
    expect(inViewNote({ inside: 2, of: 58 }, "map-widget")).toBe(
      "2 of 58 points are in the area your Map shows: Show all data fits the map to all of them.",
    );
    expect(inViewNote({ inside: 1, of: 58 }, "map-widget")).toBe(
      "1 of 58 points is in the area your Map shows: Show all data fits the map to all of them.",
    );
    expect(inViewNote({ inside: 0, of: 1 }, "map-widget")).toBe(
      "The point is not in the area your Map shows: Show all data fits the map to it.",
    );
    expect(inViewNote({ inside: 58, of: 58 }, "map-widget")).toBeNull();
  });

  it("is said over a map that opens on a box its points are not in", () => {
    const empty = mapSpec({ points: offices.slice(0, 2), view: { bounds: MANHATTAN } });
    expect(mapNote(empty, null)).toContain("None of the 2 points are in this view");
    const all = mapSpec({ points: offices.slice(2), view: { bounds: MANHATTAN } });
    expect(mapNote(all, null)).toBeNull();
    const widget = mapSpec({
      points: offices.slice(0, 2),
      view: {
        center: [-73.98, 40.75],
        zoom: 13.27,
        bearing: 0,
        pitch: 0,
        bounds: MANHATTAN,
      },
    });
    expect(widget.view).toMatchObject({
      center: [-73.98, 40.75],
      zoom: 13.27,
      box: MANHATTAN,
    });
    expect(widget.view?.bounds).toBeUndefined();
    expect(mapNote(widget, null)).toContain(
      "None of the 2 points are in the area your Map shows: Show all data fits the map to them.",
    );
    expect(mapSpec(JSON.parse(JSON.stringify(widget))).view?.box).toEqual(MANHATTAN);
    expect(mapNote(mapSpec({ points: offices }), null)).toBeNull();
  });
});

describe("a point at the very edge of the view a map opens on", () => {
  const box = [-73.98, 40.75, -73.97, 40.756];
  const pixel = 360 / (512 * 2 ** 16);
  const at = (lon: number, lat = 40.753) => ({ points: [{ lat, lon }] });

  it("is counted as a reader sees it: a mark a few pixels outside the box still shows, and one far outside does not", () => {
    expect(marksInView(at(-73.97 + 3 * pixel), box, 16)).toEqual({ inside: 1, of: 1 });
    expect(marksInView(at(-73.97 - 3 * pixel), box, 16)).toEqual({ inside: 1, of: 1 });
    expect(
      marksInView(at(-73.97 + (MARK_EDGE_PIXELS + 2) * pixel), box, 16)?.inside,
    ).toBe(0);
    const tall = pixel * Math.cos((40.753 * Math.PI) / 180);
    expect(marksInView(at(-73.975, 40.756 + 3 * tall), box, 16)?.inside).toBe(1);
    expect(
      marksInView(at(-73.975, 40.756 + (MARK_EDGE_PIXELS + 2) * tall), box, 16)?.inside,
    ).toBe(0);
  });

  it("is outside a box that names no zoom: nothing says how far a mark reaches", () => {
    expect(marksInView(at(-73.97 + 3 * pixel), box)?.inside).toBe(0);
    expect(marksInView(at(-73.97), box)?.inside).toBe(1);
  });

  it("gives the note over the map and the reply of a run the same count", () => {
    const edge = at(-73.97 + 3 * pixel);
    expect(inViewNote(marksInView(edge, box, 16))).toBeNull();
    expect(inViewNote(marksInView(edge, box))).toBe(
      "The point is not in this view: Show all data fits the map to it.",
    );
  });
});

describe("whose area the points of a map are counted in", () => {
  const box = [-74.05, 40.7, -73.9, 40.8];

  it("is the area of a Map widget for a view that has the box its reader saw", () => {
    expect(countedArea({ box })).toBe("map-widget");
    expect(countedArea({}, box)).toBe("map-widget");
  });

  it("is the view itself for a box or a place, and for a view that names no box", () => {
    expect(countedArea({ bounds: box })).toBe("view");
    expect(countedArea({ bounds: box, box })).toBe("view");
    expect(countedArea({})).toBe("view");
    expect(countedArea(undefined)).toBe("view");
  });
});
