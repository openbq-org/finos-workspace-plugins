import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAP_LIMITS } from "~/lib/codemode/limits";
import { mapNotes, pointKey, regionKey } from "~/lib/geo/mapNotes";
import { REGION_SET_IDS } from "~/lib/geo/regions/regionTypes";

const text = (value: unknown) => JSON.stringify(value);

describe("mapNotes", () => {
  it("keeps the tags of points and regions as bounded text", () => {
    const point = pointKey({ lat: 40.71234567, lon: -74.0 });
    expect(point).toBe("p:40.7123,-74.0000");
    expect(regionKey({ code: "06" })).toBe("r:06");
    expect(
      mapNotes({
        [point]: "  Watch \n this  ",
        "r:06": "x".repeat(500),
        "r:17:cook": "ok",
        "q:1": "no",
        "p:1,2": "no",
        constructor: "no",
        "r:48": 12,
        "r:36": "",
      }),
    ).toEqual({
      [point]: "Watch this",
      "r:06": "x".repeat(MAP_LIMITS.noteChars),
      "r:17:cook": "ok",
    });
  });

  it.each([[null], [undefined], ["x"], [[1]], [7]])("is empty for %j", (raw) => {
    expect(mapNotes(raw)).toEqual({});
  });

  it("keeps a tag on a region of every boundary set the app ships", () => {
    for (const set of REGION_SET_IDS) {
      const index = JSON.parse(
        readFileSync(
          join(process.cwd(), `vendor/geo/regions/${set}.index.json`),
          "utf8",
        ),
      ) as { columns: string[]; regions: unknown[][] };
      const at = index.columns.indexOf("id");
      const keys = index.regions.map((region) =>
        regionKey({ code: String(region[at]) }),
      );
      const notes = mapNotes(
        Object.fromEntries(keys.slice(0, MAP_LIMITS.notes).map((key) => [key, "n"])),
      );
      expect(Object.keys(notes), set).toHaveLength(
        Math.min(keys.length, MAP_LIMITS.notes),
      );
      for (const key of keys.slice(-50))
        expect(mapNotes({ [key]: "n" }), key).toEqual({ [key]: "n" });
    }
    const kept = { "r:DE-BY": "Bavaria", "r:CA-12": "A district", "r:XKX": "Kosovo" };
    expect(mapNotes(mapNotes(kept))).toEqual(kept);
  });

  it("takes no key that is not a point or a region code", () => {
    const hostile = [
      "r:https://attacker.example/x",
      "r://attacker.example",
      "r:a.b",
      "r:a/b",
      "r:..",
      "r:%2e%2e",
      "r:<b>",
      "r:a_b",
      "r:__proto__",
      "__proto__",
      "r:\u202eab",
      `r:${"A".repeat(65)}`,
      "r:A",
      "R:DE-BY",
      "p:DE-BY",
    ];
    expect(mapNotes(Object.fromEntries(hostile.map((key) => [key, "n"])))).toEqual({});
    expect(mapNotes(JSON.parse('{"__proto__":{"r:06":"n"}}'))).toEqual({});
  });

  it("keeps a bounded number of tags", () => {
    const many = Object.fromEntries(
      Array.from({ length: 1000 }, (_, at) => [
        `r:${String(at).padStart(5, "0")}`,
        "n",
      ]),
    );
    expect(Object.keys(mapNotes(many))).toHaveLength(MAP_LIMITS.notes);
  });
});
