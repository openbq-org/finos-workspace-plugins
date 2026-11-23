import { describe, expect, it } from "vitest";
import {
  contextAvailable,
  contextIds,
  contextOn,
  MAP_CONTEXT,
  MAP_CONTEXT_IDS,
  mapContext,
} from "~/lib/geo/mapContext";
import { MAP_ID } from "~/lib/geo/mapLayers";

const ATTACKER = "https://attacker.example/tiles/{z}/{x}/{y}.pbf";

describe("the context layers of a basemap", () => {
  it("is one fixed list of ids of the grammar of an id, each with a label and its zooms", () => {
    expect(MAP_CONTEXT_IDS).toEqual([
      "buildings",
      "buildings-3d",
      "landuse",
      "green",
      "railways",
      "airports",
      "pois",
    ]);
    for (const layer of MAP_CONTEXT) {
      expect(layer.id).toMatch(MAP_ID);
      expect(layer.label.length).toBeGreaterThan(0);
      for (const zoom of Object.values(layer.from)) {
        expect(Number.isInteger(zoom)).toBe(true);
        expect(zoom).toBeGreaterThanOrEqual(0);
        expect(zoom).toBeLessThanOrEqual(15);
      }
    }
  });

  describe("mapContext, what a map asks for", () => {
    it("keeps the ids of the list once, in the order of the list", () => {
      const kept = mapContext(["pois", "buildings", "pois", "green"]);
      expect(kept).toEqual(["buildings", "green", "pois"]);
      expect(mapContext(kept)).toEqual(kept);
    });

    it("is nothing for a map that asks for none", () => {
      expect(mapContext(undefined)).toEqual([]);
      expect(mapContext(null)).toEqual([]);
      expect(mapContext([])).toEqual([]);
    });

    it.each([
      [["roads"]],
      [["Buildings"]],
      [[ATTACKER]],
      [["buildings", "__proto__"]],
      [[7]],
      [[null]],
      [[{ id: "buildings" }]],
      [[["buildings"]]],
    ])("fails at the call for %j, with the list", (raw) => {
      expect(() => mapContext(raw)).toThrow(
        /^output\.map: .*context.*buildings, buildings-3d, landuse, green, railways, airports, pois/,
      );
    });

    it("never repeats an address in its message", () => {
      expect(() => mapContext(["buildings", ATTACKER])).toThrow(
        /^output\.map: entry 2 of "context" is not a context layer of the basemap\. The layers are: [a-z0-9-]+(, [a-z0-9-]+)*\.$/,
      );
    });

    it.each([["buildings"], [{ buildings: true }], [7], [true]])(
      "fails for %j, which is no list",
      (raw) => {
        expect(() => mapContext(raw)).toThrow(/^output\.map: .*context.*list/);
      },
    );

    it("reads no more entries than a map can ask for", () => {
      const many = Array.from({ length: 5000 }, () => "buildings");
      expect(() => mapContext(many)).toThrow(/at most/);
    });
  });

  describe("contextIds, what a stored view state names", () => {
    it("keeps the ids of the list once and drops everything else without a word", () => {
      expect(
        contextIds(["pois", ATTACKER, "roads", 7, null, "pois", "buildings", {}]),
      ).toEqual(["buildings", "pois"]);
    });

    it.each([null, undefined, "buildings", 7, { 0: "buildings" }])(
      "is empty for %j",
      (raw) => {
        expect(contextIds(raw)).toEqual([]);
      },
    );

    it("reads a bounded number of entries", () => {
      const raw = [...Array.from({ length: 1000 }, () => "nope"), "buildings"];
      expect(contextIds(raw)).toEqual([]);
    });
  });

  describe("contextOn, what is drawn", () => {
    it("is what the map asks for when the reader changed nothing", () => {
      expect([...contextOn(["buildings", "green"], undefined)]).toEqual([
        "buildings",
        "green",
      ]);
      expect([...contextOn(undefined, undefined)]).toEqual([]);
    });

    it("adds what the reader turned on and leaves out what the reader turned off", () => {
      const on = contextOn(["buildings", "green"], {
        context: ["pois"],
        contextOff: ["green"],
      });
      expect([...on].sort()).toEqual(["buildings", "pois"]);
    });

    it("lets the reader win over the map", () => {
      expect([...contextOn(["buildings"], { contextOff: ["buildings"] })]).toEqual([]);
    });
  });

  describe("contextAvailable, by what the tiles of a backdrop hold", () => {
    const of = (id: string) => MAP_CONTEXT.find((layer) => layer.id === id);

    it("has buildings and points of interest only on tiles that go deep enough", () => {
      for (const id of ["buildings", "buildings-3d", "pois", "railways"]) {
        const layer = of(id);
        if (!layer) throw new Error(id);
        expect(contextAvailable(layer, "protomaps", 6)).toBe(false);
        expect(contextAvailable(layer, "protomaps", 15)).toBe(true);
        expect(contextAvailable(layer, "openmaptiles", 14)).toBe(true);
      }
    });

    it("has land use, parks and airports on the low zooms of the bundled file", () => {
      for (const id of ["landuse", "green", "airports"]) {
        const layer = of(id);
        if (!layer) throw new Error(id);
        expect(contextAvailable(layer, "protomaps", 6)).toBe(true);
      }
    });
  });
});
