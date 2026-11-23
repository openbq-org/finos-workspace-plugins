import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { widgetMap } from "~/lib/geo/mapData";
import { makeMap } from "~/lib/geo/mapSpec";
import type { PlaceNeeds } from "~/lib/geo/placeFiles";
import {
  buildZipIndex,
  registerZips,
  type ZipsData,
  zipCode,
} from "~/lib/geo/regions/zips";
import { namesZip } from "~/lib/utils/displayNumber";

async function pageWithoutZips() {
  vi.resetModules();
  const [{ makeMap }, { widgetMap }, { loadedZips }] = await Promise.all([
    import("~/lib/geo/mapSpec"),
    import("~/lib/geo/mapData"),
    import("~/lib/geo/regions/zips"),
  ]);
  return { makeMap, widgetMap, loadedZips };
}

const DATA = JSON.parse(
  readFileSync(join(process.cwd(), "vendor/geo/places/zips.json"), "utf8"),
) as ZipsData;

describe("the table of US ZIP codes the app ships", () => {
  const index = buildZipIndex(DATA);

  it("holds every ZIP Code Tabulation Area of the Gazetteer, and says where it is from", () => {
    expect(index.size).toBe(33_791);
    expect(DATA.source).toContain("US Census Bureau");
    expect(DATA.vintage).toBe("2025 Gazetteer (2020 Census ZCTAs)");
    expect(DATA.licence).toContain("Public domain");
  });

  it.each([
    ["10001", 40.751, -73.997],
    ["02134", 42.359, -71.13],
    ["90210", 34.101, -118.415],
    ["60601", 41.885, -87.622],
    ["00601", 18.181, -66.75],
    ["99929", 56.221, -131.924],
    ["96815", 21.274, -157.823],
  ])("places %s where its area is", (code, lat, lon) => {
    const place = index.place(code);
    expect(place).not.toBeNull();
    expect(place?.[1]).toBeCloseTo(lat, 2);
    expect(place?.[0]).toBeCloseTo(lon, 2);
  });

  it("has no place for a code no area has, and none for what is no five digits", () => {
    for (const code of ["00000", "99999", "12345678", "1234", "abcde", "", "1000l"])
      expect(index.place(code)).toBeNull();
  });

  it("refuses a table that is not in the form the script writes", () => {
    expect(() => buildZipIndex({ ...DATA, table: 3 as never })).toThrow();
    expect(() => buildZipIndex({ ...DATA, count: 1e9 })).toThrow();
    expect(() => buildZipIndex({ ...DATA, table: DATA.table.slice(0, 400) })).toThrow(
      /ends before its last code/,
    );
  });
});

describe("what value is a ZIP code", () => {
  it("is five digits as text, with its leading zeros, and the first five of ZIP+4", () => {
    expect(zipCode("02134", false)).toEqual({ code: "02134" });
    expect(zipCode(" 10001 ", false)).toEqual({ code: "10001" });
    expect(zipCode("02134-1001", false)).toEqual({ code: "02134" });
    expect(zipCode("021341001", false)).toEqual({ code: "02134" });
    expect(zipCode(90210, false)).toEqual({ code: "90210" });
  });

  it("never pads a short number by guess: only where the column is named as ZIP codes are", () => {
    expect(zipCode(2134, false)).toEqual({ short: "2134" });
    expect(zipCode("2134", false)).toEqual({ short: "2134" });
    expect(zipCode(501, false)).toEqual({ short: "501" });
    expect(zipCode(2134, true)).toEqual({ code: "02134" });
    expect(zipCode("2134", true)).toEqual({ code: "02134" });
    expect(zipCode(501, true)).toEqual({ code: "00501" });
  });

  it("is nothing else: no word, no fraction, no number of nine digits, no code of another country", () => {
    for (const value of [
      "",
      "N/A",
      "SW1A 1AA",
      "K1A 0B1",
      "12",
      12,
      2134.5,
      -2134,
      123456,
      21341001,
      "0213",
      "02134-10",
      "021 34",
      null,
      undefined,
      {},
      ["02134"],
      true,
    ])
      expect(zipCode(value, true), JSON.stringify(value)).toBeNull();
    expect(zipCode("0213", false)).toBeNull();
  });

  it("reads the name of a column as the number rule of the app does", () => {
    for (const name of [
      "zip",
      "ZIP",
      "zip_code",
      "ZipCode",
      "zip5",
      "billing zip",
      "postal_code",
      "Postal Code",
      "postcode",
      "zcta",
      "ZCTA5",
      "customer_zip_code",
    ])
      expect(namesZip(name), name).toBe(true);
    for (const name of [
      "units",
      "code",
      "id",
      "zip households",
      "zip code population",
      "count per zip",
      "state",
      "fips",
      "zipper",
      "",
      undefined,
    ])
      expect(namesZip(name), String(name)).toBe(false);
  });
});

describe("a map that places rows by their ZIP code", () => {
  beforeAll(() => {
    registerZips(DATA);
  });

  it("puts a point at the middle of the area of each code, and many rows of one code at one place", () => {
    const made = makeMap({
      points: [
        { zip: "10001", label: "A" },
        { zip: "10001-0001", label: "B" },
        { zip: 90210, label: "C" },
      ],
    });
    expect(made.points.map(({ lat, lon, label }) => [label, lat, lon])).toEqual([
      ["A", 40.751, -73.997],
      ["B", 40.751, -73.997],
      ["C", 34.101, -118.415],
    ]);
    expect(JSON.stringify(made)).not.toContain("zip");
    expect(made.notes).toBeUndefined();
  });

  it("leaves out and names the codes no area has, and the short numbers of a column that is not named", () => {
    const made = makeMap({
      points: [
        { zip: "10001" },
        { zip: "00000" },
        { zip: "N/A" },
        { zip: 2134 },
        { zip: 2134, zipNamed: true },
      ],
    });
    expect(made.points).toHaveLength(2);
    expect(made.points[1]).toMatchObject({ lat: 42.359, lon: -71.13 });
    expect(made.notes).toEqual([
      "2 ZIP codes are not on the map (no area of the Census Bureau has that code: a post office box, one building, or no ZIP code): 00000, N/A.",
      '1 value has fewer than five digits and is not read as ZIP codes: 2134. Lost zeros are put back only in a column named zip, zip_code or postal_code: name it so, or write "02134" as text.',
    ]);
  });

  it("fails with what a ZIP code is when none of the rows has one", () => {
    expect(() =>
      makeMap({ points: [{ zip: "abc" }, { zip: 12 }, { zip: 2134 }] }),
    ).toThrow(
      /none of the points could be placed by its ZIP code\. No area has the code: abc, 12\. Fewer than five digits: 2134\. A ZIP code is five digits as text/,
    );
  });

  it("asks for the table when it is not loaded, and says that it did not load: never that a code is unknown", async () => {
    const { makeMap, loadedZips } = await pageWithoutZips();
    expect(loadedZips()).toBeNull();
    const needs: PlaceNeeds = new Set();
    const made = makeMap(
      { points: [{ lat: 1, lon: 2 }, { zip: "10001" }, { zip: "90210" }] },
      { needs },
    );
    expect([...needs]).toEqual(["zips"]);
    expect(made.points).toHaveLength(1);
    expect(made.notes).toEqual([
      "The table of US ZIP codes could not be loaded: 2 rows placed by their ZIP code are not drawn. Try again.",
    ]);
    expect(() => makeMap({ points: [{ zip: "10001" }] })).toThrow(
      /the table of US ZIP codes could not be loaded, and every point of the map is placed by its ZIP code \(1\)/,
    );
  });

  it("keeps the coordinates of a row that has them, whatever its ZIP code says", () => {
    const made = makeMap({ points: [{ lat: 1, lon: 2, zip: "10001" }] });
    expect(made.points[0]).toMatchObject({ lat: 1, lon: 2 });
  });
});

describe("`data.map.zip` of a Map widget", () => {
  beforeAll(() => {
    registerZips(DATA);
  });
  const rows = [
    { name: "Ada", zip: "10001", spend: 12 },
    { name: "Bo", zip: 2134, spend: 5 },
    { name: "Cy", zip: "", spend: 1 },
    { name: "Di", zip: "02134-1001", spend: 7 },
  ];

  it("places the rows by a column named as ZIP codes are, with the zeros a spreadsheet dropped", () => {
    const made = widgetMap(rows, { zip: "zip", label: "name", value: "spend" }, []);
    expect(made?.error).toBeUndefined();
    expect(made?.spec?.points.map(({ label, lat }) => [label, lat])).toEqual([
      ["Ada", 40.751],
      ["Bo", 42.359],
      ["Di", 42.359],
    ]);
    expect(made?.spec?.notes).toBeUndefined();
  });

  it("pads nothing in a column whose name does not say ZIP code, and says so", () => {
    const made = widgetMap(
      rows.map(({ zip, ...row }) => ({ ...row, area: zip })),
      { zip: "area", label: "name" },
      [],
    );
    expect(made?.spec?.points.map(({ label }) => label)).toEqual(["Ada", "Di"]);
    expect(made?.spec?.notes?.[0]).toMatch(
      /^1 value has fewer than five digits and is not read as ZIP codes: 2134\./,
    );
  });

  it("says which list the map needs when the table is not loaded", async () => {
    const { widgetMap } = await pageWithoutZips();
    const made = widgetMap(rows, { zip: "zip" }, []);
    expect(made?.needs).toEqual(["zips"]);
  });
});
