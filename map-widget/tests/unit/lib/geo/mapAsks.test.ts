import { describe, expect, it } from "vitest";
import {
  BASEMAP_NOTE,
  BOUNDARIES_NOTE,
  backdropAsked,
  basemapAsked,
  boundariesAsked,
  mapAsks,
  viewOver,
  viewUnder,
} from "~/lib/geo/mapAsks";
import { MAP_BOUNDARY_IDS } from "~/lib/geo/mapBoundaries";
import { makeMap, mapSpec } from "~/lib/geo/mapSpec";
import { mapViewState } from "~/lib/geo/mapViewState";

const ATTACKER = "https://attacker.example/tiles/{z}/{x}/{y}.png";
const POINTS = [{ lat: 40.75, lon: -73.98, label: "Office" }];

describe("what a map asks of the view it opens with", () => {
  describe("boundary layers", () => {
    it("keeps the ids of the fixed list once, in the order of the list", () => {
      const notes: string[] = [];
      expect(
        boundariesAsked(["us-counties", "countries", "us-counties"], notes),
      ).toEqual(["countries", "us-counties"]);
      expect(notes).toEqual([]);
    });

    it("leaves out what is not of the list and says so once, without repeating what was written", () => {
      const notes: string[] = [];
      expect(boundariesAsked(["us-counties", ATTACKER, "zip-codes", 7], notes)).toEqual(
        ["us-counties"],
      );
      expect(notes).toEqual([BOUNDARIES_NOTE]);
      expect(notes[0]).not.toContain("attacker");
      for (const id of MAP_BOUNDARY_IDS) expect(notes[0]).toContain(id);
    });

    it("reads a bounded number of entries and never throws", () => {
      const notes: string[] = [];
      const many = Array.from({ length: 50_000 }, () => "cities");
      expect(boundariesAsked(many, notes)).toEqual(["cities"]);
      expect(notes).toEqual([BOUNDARIES_NOTE]);
      for (const hostile of ["us-states", 7, { length: 2 }, true])
        expect(boundariesAsked(hostile, [])).toEqual([]);
      expect(boundariesAsked(undefined, notes)).toEqual([]);
    });
  });

  describe("the basemap", () => {
    it("is the standard one, the plain one, or a source by its id", () => {
      const notes: string[] = [];
      expect(basemapAsked("standard", notes)).toBeUndefined();
      expect(basemapAsked("plain", notes)).toEqual({ choice: "plain" });
      expect(basemapAsked("naip", notes)).toEqual({ source: "naip" });
      expect(basemapAsked({ source: "naip" }, notes)).toEqual({ source: "naip" });
      expect(basemapAsked({ choice: "naip" }, notes)).toEqual({ source: "naip" });
      expect(notes).toEqual([]);
      expect(backdropAsked(undefined)).toBe("standard");
      expect(backdropAsked({ choice: "plain" })).toBe("plain");
      expect(backdropAsked({ source: "naip" })).toBe("naip");
    });

    it("leaves parts of the backdrop out in the keys of the view state, and copies no other key", () => {
      const asked = basemapAsked(
        {
          choice: "plain",
          names: false,
          roads: false,
          borders: true,
          tiles: [ATTACKER],
          style: ATTACKER,
          glyphs: ATTACKER,
        },
        [],
      );
      expect(asked).toEqual({ choice: "plain", names: false, roads: false });
      expect(JSON.stringify(asked)).not.toContain("attacker");
    });

    it("takes an address for no backdrop: the map is on the standard one, and a note says what a basemap can be", () => {
      for (const hostile of [ATTACKER, "Satellite!", 7, { choice: ATTACKER }]) {
        const notes: string[] = [];
        expect(basemapAsked(hostile, notes)).toBeUndefined();
        expect(notes).toEqual([BASEMAP_NOTE]);
        expect(notes[0]).not.toContain("attacker");
      }
    });
  });

  describe("on both entry points of the reducer", () => {
    const raw = {
      points: POINTS,
      boundaries: ["us-counties", "nope"],
      basemap: { choice: "plain", roads: false },
      context: ["buildings"],
    };

    it("is part of the map that is made, with a note for what was left out", () => {
      const made = makeMap(raw);
      expect(made.boundaries).toEqual(["us-counties"]);
      expect(made.basemap).toEqual({ choice: "plain", roads: false });
      expect(made.context).toEqual(["buildings"]);
      expect(made.notes).toEqual([BOUNDARIES_NOTE]);
    });

    it("comes out equal when the stored map is read again", () => {
      const made = makeMap(raw);
      const stored = JSON.parse(JSON.stringify(made));
      expect(mapSpec(stored)).toEqual(made);
      expect(mapSpec(mapSpec(stored))).toEqual(made);
    });

    it("drops a hostile value of a stored map and keeps the map", () => {
      const stored = mapSpec({
        points: POINTS,
        shapes: [],
        boundaries: [ATTACKER, { set: "us-states", url: ATTACKER }],
        basemap: { choice: ATTACKER, tiles: [ATTACKER], names: "no" },
      });
      expect(stored.boundaries).toBeUndefined();
      expect(stored.basemap).toBeUndefined();
      expect(JSON.stringify(stored)).not.toContain("attacker");
      expect(stored.points).toHaveLength(1);
    });

    it("still refuses the id of a source that is not of the grammar of an id", () => {
      expect(() => makeMap({ points: POINTS, basemap: { source: ATTACKER } })).toThrow(
        /basemap/,
      );
    });

    it("keeps a map of the first form as it was: the id of a source alone", () => {
      const made = mapSpec({ points: POINTS, shapes: [], basemap: { source: "naip" } });
      expect(made.basemap).toEqual({ source: "naip" });
    });
  });

  describe("under what the reader switched", () => {
    const asks = mapAsks({ boundaries: ["us-counties"], basemap: { roads: false } });

    it("is on when the map opens, with nothing stored", () => {
      expect(viewOver(asks, {})).toEqual({
        boundaries: ["us-counties"],
        basemap: { roads: false },
      });
      expect(viewUnder(asks, viewOver(asks, {}))).toEqual({});
    });

    it("hands a map that asks for nothing the very state it had", () => {
      const view = mapViewState({ boundaries: ["cities"], basemap: { names: false } });
      const none = mapAsks({});
      expect(viewOver(none, view)).toBe(view);
      expect(viewUnder(none, view)).toBe(view);
    });

    it("keeps what the reader turned off of it, and what the reader turned on besides", () => {
      const shown = viewOver(asks, {});
      const changed = {
        ...shown,
        boundaries: ["cities" as const],
        basemap: { names: false as const },
      };
      const kept = mapViewState(viewUnder(asks, changed));
      expect(kept).toEqual({
        boundaries: ["cities"],
        boundariesOff: ["us-counties"],
        basemap: { names: false, roads: true },
      });
      expect(viewOver(asks, mapViewState(JSON.parse(JSON.stringify(kept))))).toEqual({
        boundaries: ["cities"],
        basemap: { names: false },
      });
    });

    it("is read from a stored view state without trust", () => {
      expect(
        mapViewState({
          boundaries: ["cities", ATTACKER],
          boundariesOff: ["cities", "us-states", ATTACKER, 3],
          basemap: { names: "yes", roads: true, borders: false },
        }),
      ).toEqual({
        boundariesOff: ["us-states", "cities"],
        basemap: { roads: true, borders: false },
      });
    });
  });
});

describe("the building of the basemap under a point", () => {
  it("is a highlight of a point, kept by both entry points", () => {
    const made = makeMap({
      points: [
        { lat: 40.75, lon: -73.98, highlight: "building", markerColor: "positive" },
      ],
    });
    expect(made.points[0]).toMatchObject({
      highlight: "building",
      markerColor: "positive",
    });
    expect(mapSpec(JSON.parse(JSON.stringify(made)))).toEqual(made);
  });

  it("is a plain highlight on any other mark, and any other word is no highlight", () => {
    const made = makeMap({
      points: [{ lat: 1, lon: 2, highlight: "castle" }],
      shapes: [
        {
          type: "line",
          coordinates: [
            [0, 0],
            [1, 1],
          ],
          highlight: "building",
        },
      ],
    });
    expect(made.points[0].highlight).toBeUndefined();
    expect(made.shapes[0].highlight).toBe(true);
  });
});
