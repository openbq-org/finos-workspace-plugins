import { describe, expect, it } from "vitest";
import { type GeoFileOutcome, parseGeoFile } from "~/lib/geo/files";
import {
  dbf,
  fixtures,
  PRJ,
  png,
  SAMPLE_GPX,
  SAMPLE_KML,
  shp,
  squareCcw,
  squareCw,
  utf8,
  zip,
} from "../../../../fixtures/geo/files/builders";
import { cpuBudget, cpuNow } from "../../../machinePace";
import { random, refusal } from "./support";

describe("safety: any bytes", () => {
  const written = fixtures();
  const names = Object.keys(written);
  const parts: Record<string, Uint8Array> = {
    ...written,
    "stored-shapefile.zip": zip(
      {
        "a.shp": shp([
          { kind: "polygon", parts: [squareCw(0, 0, 10), squareCcw(2, 2, 2)] },
          {
            kind: "polyline",
            parts: [
              [
                [0, 0],
                [1, 1],
              ],
              [
                [2, 2],
                [3, 3],
              ],
            ],
          },
          {
            kind: "multipoint",
            points: [
              [0, 0],
              [1, 1],
            ],
          },
          { kind: "point", at: [1, 2] },
        ]),
        "a.dbf": dbf(
          [
            { name: "NAME", type: "C", length: 8 },
            { name: "N", type: "N", length: 6 },
          ],
          [
            ["a", "1"],
            ["b", "2"],
            ["c", "3"],
            ["d", "4"],
          ],
        ),
        "a.prj": PRJ.wgs84,
      },
      0,
    ),
    "stored.kmz": zip({ "doc.kml": SAMPLE_KML, "files/photo.png": png(64, 64) }, 0),
    "sample.gpx": utf8(SAMPLE_GPX),
  };

  function settles(bytes: Uint8Array, what: string) {
    const started = cpuNow();
    let outcome: GeoFileOutcome;
    try {
      outcome = parseGeoFile(bytes);
    } catch (cause) {
      throw new Error(`${what}: parseGeoFile threw ${String(cause)}`);
    }
    const took = cpuNow() - started;
    if (outcome.error?.code === "internal")
      throw new Error(`${what}: the reader failed with a defect`);
    if (took > cpuBudget(2000)) throw new Error(`${what}: took ${took.toFixed(0)} ms`);
    return outcome;
  }

  it.each(Object.keys(parts))(
    "reads %s cut at any length as a result or a typed error",
    (name) => {
      const bytes = parts[name];
      const next = random(name.length * 7919 + bytes.length);
      const lengths =
        bytes.length <= 700
          ? Array.from({ length: bytes.length }, (_, at) => at)
          : Array.from({ length: 700 }, () => Math.floor(next() * bytes.length));
      for (const length of lengths)
        settles(bytes.subarray(0, length), `${name} cut at ${length}`);
    },
  );

  it.each(Object.keys(parts))(
    "reads %s with bytes changed at random as a result or a typed error",
    (name) => {
      const bytes = parts[name];
      const next = random(bytes.length * 31 + name.length);
      for (let round = 0; round < 400; round++) {
        const changed = Uint8Array.from(bytes);
        const changes = 1 + Math.floor(next() * 8);
        for (let change = 0; change < changes; change++) {
          const at = Math.floor(next() * changed.length);
          const roll = next();
          changed[at] =
            roll < 0.3
              ? 0xff
              : roll < 0.5
                ? 0x00
                : roll < 0.6
                  ? 0x7f
                  : Math.floor(next() * 256);
        }
        settles(changed, `${name} round ${round}`);
      }
    },
  );

  it("reads bytes that are nothing as an error that says so", () => {
    const next = random(42);
    for (let round = 0; round < 300; round++) {
      const noise = Uint8Array.from({ length: Math.floor(next() * 600) }, () =>
        Math.floor(next() * 256),
      );
      const starts = [[0x50, 0x4b, 3, 4], [0x3c], [0x7b], [0, 0, 0x27, 0x0a], []][
        round % 5
      ];
      noise.set(starts.slice(0, noise.length));
      settles(noise, `noise ${round}`);
    }
    expect(refusal(new Uint8Array(0))).toEqual({
      code: "empty",
      message: "The file is empty.",
    });
    expect(refusal(utf8("lat,lon\n1,2\n"), { name: "points.csv" }).message).toMatch(
      /A CSV file is a table/,
    );
    expect(
      refusal(shp([{ kind: "point", at: [1, 2] }]), { name: "a.bin" }).message,
    ).toMatch(/Zip it with its .dbf and .prj/);
    expect(
      refusal(utf8("hello"), { name: "https://attacker.example/x.zip?q=<b>" }).message,
    ).toBe(
      "The file is not a map file that is read: KML, KMZ, a zipped shapefile, GPX or GeoJSON.",
    );
  });

  it("covers every fixture", () => {
    expect(names.length).toBeGreaterThan(20);
  });
});
