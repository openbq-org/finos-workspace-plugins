import { describe, expect, it } from "vitest";
import { GEO_FILE_LIMITS } from "~/lib/geo/files";
import { readDbf } from "~/lib/geo/files/dbf";
import { GeoFileFailure } from "~/lib/geo/files/types";
import {
  dbf,
  lyingDbf,
  PRJ,
  shp,
  shpContent,
  shpFrom,
  squareCcw,
  squareCw,
  zip,
} from "../../../../fixtures/geo/files/builders";
import { cpuBudget } from "../../../machinePace";
import { fixture, read, refusal, timed } from "./support";

describe("safety: a shapefile", () => {
  const prj = { "a.prj": PRJ.wgs84 };
  const layer = (shpBytes: Uint8Array, table?: Uint8Array) =>
    zip({ "a.shp": shpBytes, ...(table ? { "a.dbf": table } : {}), ...prj }, 0);
  const cities = () =>
    shp(
      Array.from({ length: 3 }, (_, at) => ({ kind: "point" as const, at: [at, at] })),
    );
  const table = () =>
    dbf([{ name: "NAME", type: "C", length: 8 }], [["a"], ["b"], ["c"]]);

  it("says a .shp file that is cut short is broken", () => {
    expect(refusal(fixture("hostile-truncated-shp.zip"))).toEqual({
      code: "malformed",
      message:
        'The .shp of "cut" is cut short or its header is wrong: it needs 184 bytes at 0 and has 150.',
    });
  });

  it("checks the count of rows a table declares against the bytes it has", () => {
    const [outcome, took] = timed(fixture("hostile-lying-dbf.zip"));
    expect(outcome).toEqual({
      ok: false,
      error: {
        code: "malformed",
        message:
          'The .dbf of "lie" is broken: its header says 4,000,000,000 rows and it has the bytes of 3.',
      },
    });
    expect(took).toBeLessThan(cpuBudget(500));
    expect(refusal(layer(cities(), lyingDbf(table(), 4))).code).toBe("malformed");
    expect(
      read(layer(cities(), lyingDbf(table(), 2))).features.map(
        (feature) => feature.properties,
      ),
    ).toEqual([{ NAME: "a" }, { NAME: "b" }, {}]);
  });

  it.each([
    [
      "a header shorter than a header",
      (bytes: Uint8Array) => new DataView(bytes.buffer).setUint16(8, 20, true),
      /header is shorter/,
    ],
    [
      "a header longer than the file",
      (bytes: Uint8Array) => new DataView(bytes.buffer).setUint16(8, 60_000, true),
      /cut short or its header is wrong/,
    ],
    [
      "rows of no length",
      (bytes: Uint8Array) => new DataView(bytes.buffer).setUint16(10, 0, true),
      /rows have no length/,
    ],
    [
      "columns longer than its rows",
      (bytes: Uint8Array) => new DataView(bytes.buffer).setUint16(10, 4, true),
      /columns are longer than its rows/,
    ],
    [
      "a column that says it is 255 bytes",
      (bytes: Uint8Array) => {
        bytes[32 + 16] = 255;
      },
      /columns are longer than its rows/,
    ],
  ])("says a table with %s is broken", (_what, change, message) => {
    const bytes = table();
    change(bytes);
    const error = refusal(layer(cities(), bytes));
    expect(error.code).toBe("malformed");
    expect(error.message).toMatch(message);
  });

  it("reads a table whose header has no end mark without reading past the header", () => {
    const bytes = table();
    bytes[32 + 32] = 0x20;
    expect(() => readDbf(bytes, "The table")).not.toThrow();
    expect(() => readDbf(bytes.subarray(0, 20), "The table")).toThrow(GeoFileFailure);
    expect(() => readDbf(new Uint8Array(0), "The table")).toThrow(GeoFileFailure);
  });

  const record = (kind: "polygon" | "polyline" | "multipoint") =>
    kind === "multipoint"
      ? shpContent({
          kind,
          points: [
            [0, 0],
            [1, 1],
          ],
        })
      : shpContent({ kind, parts: [squareCw(0, 0, 1)] });
  const set = (content: Uint8Array, at: number, value: number) => {
    new DataView(content.buffer).setInt32(at, value, true);
    return content;
  };

  it.each([
    ["two billion points in an area", () => set(record("polygon"), 40, 0x7fffffff)],
    ["two billion parts in an area", () => set(record("polygon"), 36, 0x7fffffff)],
    ["a negative count of points", () => set(record("polyline"), 40, -1)],
    ["a negative count of parts", () => set(record("polyline"), 36, -5)],
    ["one point more than its bytes", () => set(record("polygon"), 40, 6)],
    [
      "two billion points in a multipoint",
      () => set(record("multipoint"), 36, 0x7fffffff),
    ],
    ["a negative count in a multipoint", () => set(record("multipoint"), 36, -1)],
    ["a part that starts past the last point", () => set(record("polygon"), 44, 99)],
    ["a part that starts before the first point", () => set(record("polygon"), 44, -3)],
    [
      "a point shorter than a point",
      () => shpContent({ kind: "point", at: [1, 2] }).subarray(0, 12),
    ],
    ["an area shorter than its header", () => record("polygon").subarray(0, 40)],
    ["a kind no shapefile has", () => set(record("polygon"), 0, 77)],
  ])(
    "says a record that declares %s is broken, and makes nothing from the count",
    (_what, content) => {
      const [outcome, took] = timed(layer(shpFrom([content()], 5)));
      expect(outcome.ok).toBe(false);
      expect(outcome.error?.code).toBe("malformed");
      expect(took).toBeLessThan(cpuBudget(500));
    },
  );

  it("says a file whose header or records point past its end is broken", () => {
    const longer = cities();
    new DataView(longer.buffer).setInt32(24, 1_000_000, false);
    expect(refusal(layer(longer)).message).toMatch(/cut short or its header is wrong/);
    const past = cities();
    new DataView(past.buffer).setInt32(104, 0x7fffffff, false);
    expect(refusal(layer(past)).message).toMatch(
      /a record runs past the end of the file/,
    );
    const short = cities();
    new DataView(short.buffer).setInt32(24, 10, false);
    expect(refusal(layer(short)).message).toMatch(/length under its own size/);
    const other = cities();
    new DataView(other.buffer).setInt32(0, 1234, false);
    expect(refusal(layer(other)).message).toMatch(/does not start as a .shp file does/);
  });

  it("ends on records of no length", () => {
    const empty = new Uint8Array(100 + 8 * 1_000_000);
    const view = new DataView(empty.buffer);
    view.setInt32(0, 9994, false);
    view.setInt32(24, empty.length / 2, false);
    const [outcome, took] = timed(layer(empty));
    expect(outcome.error?.code).toBe("empty");
    expect(took).toBeLessThan(cpuBudget(1500));
  });

  it("sorts the rings of the most rings an area may have within a second", () => {
    const rings = Array.from({ length: GEO_FILE_LIMITS.parts }, (_, at) =>
      at % 2 === 0 ? squareCw(0, 0, 80 - at / 100) : squareCcw(1, 1, 40 - at / 100),
    );
    const [outcome, took] = timed(layer(shp([{ kind: "polygon", parts: rings }])));
    expect(outcome.ok).toBe(true);
    expect(took).toBeLessThan(cpuBudget(1500));
  });
});
