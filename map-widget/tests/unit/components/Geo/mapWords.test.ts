import { describe, expect, it } from "vitest";
import { described, mapNote, NAMED, noteHead } from "~/components/Geo/mapWords";
import { mapSpec } from "~/lib/geo/mapSpec";
import { CITIES_CREDIT } from "~/lib/geo/markBudget";

describe("described", () => {
  it("reads a map of the first form as it always did", () => {
    const spec = mapSpec({
      valueLabel: "Rate (%)",
      points: [{ lat: 1, lon: 1 }],
      regions: { set: "us-states", items: [{ code: "CA" }, { code: "TX" }] },
      shapes: [
        {
          type: "line",
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        },
      ],
    });
    expect(described("Rates", spec)).toBe(
      "Map Rates: 2 shaded regions, 1 line, 1 point, by Rate (%)",
    );
  });

  it("says the layers of a map that has a list of them, and its steps of time", () => {
    const spec = mapSpec({
      regions: { set: "us-states", items: [{ code: "CA", value: 1 }] },
      layers: [
        {
          name: "Elevators",
          kind: "clusters",
          points: [
            { lat: 1, lon: 1, time: "2023" },
            { lat: 1, lon: 1, time: "2024" },
          ],
        },
        { kind: "heat", points: [{ lat: 2, lon: 2 }] },
        { kind: "flows", flows: [{ from: [0, 0], to: [1, 1] }] },
        { kind: "columns", points: [{ lat: 3, lon: 3 }] },
        { name: "NDVI", kind: "source", source: "ndvi" },
      ],
    });
    expect(described("Farm", spec)).toBe(
      "Map Farm: 6 layers: Regions (1 shaded region), Elevators (2 points in clusters), Density (density of 1 point), Flows (1 flow), Columns (1 column), NDVI (a source of a backend), over 2 steps of time",
    );
  });
});

describe("mapNote", () => {
  const spec = mapSpec({
    regions: {
      set: "us-states",
      items: [{ code: "CA" }, { code: "Atlantis" }, { code: "Narnia" }],
    },
    notes: ["2 network links were not read."],
  });

  it("has nothing to say of a map that is all there", () => {
    expect(mapNote(mapSpec({ points: [{ lat: 1, lon: 1 }] }), null)).toBeNull();
  });

  it("names the regions that are not on the map, of every layer", () => {
    const layered = mapSpec({
      points: [{ lat: 1, lon: 1 }],
      layers: [
        {
          kind: "columns",
          regions: { set: "us-states", items: [{ code: "CA" }, { code: "Oz" }] },
        },
      ],
    });
    expect(mapNote(layered, { unshaped: ["Guam"], ambiguous: [], outside: 0 })).toBe(
      "2 regions are not on the map: Oz, Guam.",
    );
  });

  it("says which codes could be several regions, what tells them apart, and what a file left out", () => {
    expect(
      mapNote(spec, {
        unshaped: [],
        ambiguous: [
          {
            set: "admin1",
            code: "Georgia",
            candidates: ["Georgia (US-GA)", "Georgia (GE)"],
          },
        ],
        outside: 3,
      }),
    ).toBe(
      '2 regions are not on the map: Atlantis, Narnia. 1 region could be several: Georgia: Georgia (US-GA) or Georgia (GE). Give the country of the data, or write the ISO 3166-2 code ("CA-ON"). 3 more outside this view (Alaska, Hawaii, territories): zoom out. 2 network links were not read.',
    );
  });

  it("says what tells two regions apart in the words of their set: a county is not told apart by a country", () => {
    const note = (set: string, code: string, candidates: string[]) =>
      mapNote(mapSpec({ points: [{ lat: 1, lon: 1 }] }), {
        unshaped: [],
        ambiguous: [{ set: set as never, code, candidates }],
        outside: 0,
      });
    expect(
      note("us-counties", "Baltimore, MD", [
        "Baltimore county, MD (24005)",
        "Baltimore city, MD (24510)",
      ]),
    ).toBe(
      '1 region could be several: Baltimore, MD: Baltimore county, MD (24005) or Baltimore city, MD (24510). Write "County" or "city" after the name and the state with it ("Baltimore city, MD"), or use the FIPS code.',
    );
    expect(note("us-cbsa", "Portland", ["a (1)", "b (2)"])).toMatch(
      /Use the full name of the metro area, the city with its state \("Portland, OR"\) or the CBSA code\.$/,
    );
    expect(note("us-cd119", "California", ["a (1)", "b (2)"])).toMatch(
      /Write the state and the number of the district \("CA-12"\)\.$/,
    );
    const both = mapNote(mapSpec({ points: [{ lat: 1, lon: 1 }] }), {
      unshaped: [],
      ambiguous: [
        { set: "us-counties", code: "Cook", candidates: ["a (1)", "b (2)"] },
        { set: "admin1", code: "Limburg", candidates: ["c (3)", "d (4)"] },
        { set: "us-counties", code: "Lake", candidates: ["e (5)", "f (6)"] },
      ],
      outside: 0,
    });
    expect(both).toBe(
      '3 regions could be several: Cook: a (1) or b (2); Limburg: c (3) or d (4); Lake: e (5) or f (6). Write "County" or "city" after the name and the state with it ("Baltimore city, MD"), or use the FIPS code. Give the country of the data, or write the ISO 3166-2 code ("CA-ON").',
    );
  });

  it("names a few and says there are more", () => {
    const many = {
      unshaped: Array.from({ length: 9 }, (_, at) => `R${at}`),
      ambiguous: [],
      outside: 0,
    };
    expect(mapNote(mapSpec({ points: [{ lat: 1, lon: 1 }] }), many)).toBe(
      "9 regions are not on the map: R0, R1, R2, R3, R4, ...",
    );
  });

  it("names every one of as many as it names, and cuts the list at one more", () => {
    const note = (count: number) =>
      mapNote(mapSpec({ points: [{ lat: 1, lon: 1 }] }), {
        unshaped: Array.from({ length: count }, (_, at) => `R${at}`),
        ambiguous: [],
        outside: 0,
      });
    const names = Array.from({ length: NAMED }, (_, at) => `R${at}`).join(", ");
    expect(note(NAMED)).toBe(`${NAMED} regions are not on the map: ${names}.`);
    expect(note(NAMED + 1)).toBe(
      `${NAMED + 1} regions are not on the map: ${names}, ...`,
    );
  });

  it("ends a list that is cut with three dots and goes on with the next sentence", () => {
    const unsure = Array.from({ length: NAMED + 1 }, (_, at) => ({
      set: "us-counties" as const,
      code: `C${at}`,
      candidates: ["a (1)", "b (2)"],
    }));
    expect(
      mapNote(mapSpec({ points: [{ lat: 1, lon: 1 }] }), {
        unshaped: [],
        ambiguous: unsure,
        outside: 0,
      }),
    ).toBe(
      '6 regions could be several: C0: a (1) or b (2); C1: a (1) or b (2); C2: a (1) or b (2); C3: a (1) or b (2); C4: a (1) or b (2); ... Write "County" or "city" after the name and the state with it ("Baltimore city, MD"), or use the FIPS code.',
    );
  });
});

describe("the note over a map", () => {
  it("has no credit in it: whose places the cities are is said with the credit of the basemap", () => {
    const spec = mapSpec({
      points: [{ lat: 41.85, lon: -87.65 }],
      credits: ["geonames"],
      notes: ["3 rows have no city and are not drawn.", CITIES_CREDIT],
    });
    expect(mapNote(spec, null)).toBe("3 rows have no city and are not drawn.");
  });
});

describe("noteHead", () => {
  it("is the count and what it counts of a note that lists, and the whole of any other note", () => {
    expect(
      noteHead(
        "3 codes are not on the map (no area has that code: a box, or none): 001, 002, 003.",
      ),
    ).toBe("3 codes are not on the map");
    expect(noteHead("1,204 rows name nothing the app has: a; b; ...")).toBe(
      "1,204 rows name nothing the app has",
    );
    expect(noteHead("12 more outside this view (far away): zoom out.")).toBe(
      "12 more outside this view",
    );
    for (const whole of [
      "Street detail needs a detailed basemap: this is the closest view this one shows.",
      '"XY" was read as a region in 2 rows.',
      "4 layers are off.",
    ])
      expect(noteHead(whole)).toBe(whole);
  });
});
