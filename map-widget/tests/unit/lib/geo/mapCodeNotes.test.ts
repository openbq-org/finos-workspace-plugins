import { describe, expect, it } from "vitest";
import { makeMap, mapSpec } from "~/lib/geo/mapSpec";

describe("a country cell that says N/A", () => {
  it("is left out and counted, never drawn in Namibia", () => {
    const map = mapSpec({
      points: [
        { country: "Brazil", label: "Acme" },
        { country: "N/A", label: "Unknown vendor" },
      ],
    });
    expect((map.points ?? []).map((point) => point.label)).toEqual(["Acme"]);
    expect((map.notes ?? []).join(" ")).toMatch(/N\/A/);
  });
});

describe("a cell of two letters that is a code and may be a word", () => {
  const names = ["Brazil", "France", "Germany", "Japan", "Kenya"].map((country) => ({
    code: country,
    value: 1,
  }));
  const shaded = (codes: string[]) =>
    makeMap({
      regions: {
        set: "countries",
        items: [...names, ...codes.map((code) => ({ code, value: 2 }))],
      },
    });

  it("says that NA was read as Namibia, in a column of codes too: an export of R writes it for no value", () => {
    const map = makeMap({
      regions: {
        set: "countries",
        items: ["US", "DE", "NA"].map((code, at) => ({
          code,
          value: at,
          time: "2020",
        })),
      },
    });
    expect(map.regions?.items).toHaveLength(3);
    expect(map.notes).toEqual([
      '"NA" was read as Namibia in 1 row. In an export of R or pandas it says that a cell has no value: leave such a cell empty.',
    ]);
    const points = makeMap({
      points: [{ country: "NA" }, { country: "NA" }, { country: "Brazil" }],
    });
    expect(points.notes?.[0]).toMatch(/^"NA" was read as Namibia in 2 rows\./);
  });

  it("says which words of two letters it read as regions in a column of names, and takes none in silence", () => {
    const map = shaded(["No", "NR", "IN"]);
    expect(map.regions?.items).toHaveLength(8);
    expect(map.notes).toEqual([
      'In a column of names, 3 cells of two letters were read as codes: "No" as Norway, "NR" as Nauru, "IN" as India. If one is a word or says that there is no value, leave the cell empty or write the name.',
    ]);
    const states = makeMap({
      regions: {
        set: "us-states",
        items: ["Texas", "Ohio", "Iowa", "Utah", "Maine", "OR", "OK"].map((code) => ({
          code,
          value: 1,
        })),
      },
    });
    expect(states.notes?.[0]).toMatch(/"OR" as Oregon, "OK" as Oklahoma/);
  });

  it("says nothing of a column of codes, and nothing of a code that is no word", () => {
    expect(
      makeMap({
        regions: {
          set: "countries",
          items: ["US", "DE", "NO", "IN", "NR"].map((code) => ({ code, value: 1 })),
        },
      }).notes,
    ).toBeUndefined();
    expect(shaded(["FR", "JP"]).notes).toBeUndefined();
  });

  it("is no region when it is written with what says no value", () => {
    const map = makeMap({
      regions: {
        set: "countries",
        items: [...names, { code: "<NA>", value: 3 }, { code: "(n/a)", value: 3 }],
      },
    });
    expect(map.regions?.items).toHaveLength(5);
    expect(map.regions?.unmatchedCount).toBe(2);
  });
});
