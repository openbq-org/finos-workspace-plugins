import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { fixtures, packedFixtures } from "../../../../fixtures/geo/files/builders";
import { fixture } from "./support";

describe("the fixtures of geographic files", () => {
  const written = fixtures();

  it.each(Object.keys(written))("%s is what the script writes", (name) => {
    expect(
      existsSync(join(process.cwd(), "tests/fixtures/geo/files", name)),
      "run: bun tests/fixtures/geo/files/make.ts",
    ).toBe(true);
    expect(Buffer.from(fixture(name)).equals(Buffer.from(written[name]))).toBe(true);
  });

  it("are small enough to commit", () => {
    const total = Object.values(written).reduce((sum, bytes) => sum + bytes.length, 0);
    expect(total).toBeLessThan(200 * 1024);
  });
});

describe("the fixtures of the folder of map fixtures", () => {
  const above = (name: string) =>
    new Uint8Array(readFileSync(join(process.cwd(), "tests/fixtures/geo", name)));
  const packed = packedFixtures(above);

  it.each(Object.keys(packed))("%s is what the script writes", (name) => {
    expect(
      Buffer.from(above(name)).equals(Buffer.from(packed[name])),
      "run: bun tests/fixtures/geo/files/make.ts",
    ).toBe(true);
  });

  it("fed-districts.kmz holds the KML document beside it, and nothing else", () => {
    const entries = unzipSync(above("fed-districts.kmz"));
    expect(Object.keys(entries)).toEqual(["doc.kml"]);
    expect(
      Buffer.from(entries["doc.kml"]).equals(Buffer.from(above("fed-districts.kml"))),
    ).toBe(true);
  });
});
