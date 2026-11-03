import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GEO_FILE_LIMITS } from "~/lib/geo/files";
import {
  fixtures,
  PRJ,
  shp,
  shpContent,
  shpFrom,
  utf8,
  zip,
} from "../../../../fixtures/geo/files/builders";
import { cpuBudget } from "../../../machinePace";
import { fixture, kml, POINT, read, strings, timed } from "./support";

describe("safety: a file of a million positions", () => {
  const MILLION = 1_000_000;

  it("leaves a GeoJSON area of a million positions out within a time bound", () => {
    const ring = `[${"[1.5,2.5],".repeat(MILLION)}[1.5,2.5]]`;
    const text = `{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[1,2]},"properties":{}},{"type":"Feature","geometry":{"type":"Polygon","coordinates":[${ring}]},"properties":{}}]}`;
    const [outcome, took] = timed(utf8(text));
    expect(took).toBeLessThan(cpuBudget(4000));
    expect(outcome.file?.features).toHaveLength(1);
    expect(outcome.file?.notes).toEqual([
      "1 shape was left out: the lines and areas of one file have at most 100,000 positions together. Simplify the file to see all of it.",
    ]);
  });

  it("leaves a KML area of a million positions out without reading all of them", () => {
    const text = kml(
      `${POINT}<Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>${"1,2 ".repeat(MILLION)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>${POINT}`,
    );
    const [outcome, took] = timed(utf8(text));
    expect(took).toBeLessThan(cpuBudget(3000));
    expect(outcome.file?.features).toHaveLength(2);
    expect(outcome.file?.notes[0]).toMatch(/^1 shape was left out/);
  });

  it("leaves a shapefile area of a million positions out without making a list of them", () => {
    const content = new Uint8Array(48 + MILLION * 16);
    const view = new DataView(content.buffer);
    view.setInt32(0, 5, true);
    view.setInt32(36, 1, true);
    view.setInt32(40, MILLION, true);
    const archive = zip(
      {
        "a.shp": shpFrom([content, shpContent({ kind: "point", at: [1, 2] })], 5),
        "a.prj": PRJ.wgs84,
      },
      0,
    );
    const [outcome, took] = timed(archive);
    expect(took).toBeLessThan(cpuBudget(2000));
    expect(outcome.file?.features).toHaveLength(1);
    expect(outcome.file?.notes.some((note) => /^1 shape was left out/.test(note))).toBe(
      true,
    );
  });

  it("refuses a file over the size of a file before it looks at it", () => {
    const [outcome, took] = timed(
      new Uint8Array(GEO_FILE_LIMITS.fileBytes + 1).fill(0x7b),
    );
    expect(outcome).toEqual({
      ok: false,
      error: {
        code: "too-large",
        message: "The file is over 32 MB. Simplify it, or split it into smaller files.",
      },
    });
    expect(took).toBeLessThan(cpuBudget(500));
  });
});

describe("safety: the result", () => {
  const good = Object.keys(fixtures()).filter(
    (name) => !name.startsWith("hostile-") && !/stateplane|crs-3857/.test(name),
  );

  it.each(good)("has no address in any field of %s but a description", (name) => {
    const result = read(fixture(name));
    for (const [path, text] of strings(result)) {
      expect(text, path).not.toMatch(/https?:|:\/\/|attacker|www\./i);
      expect(text, path).not.toMatch(/^\s*(?:javascript|data|file|blob):/i);
    }
    for (const image of result.overlays)
      expect(Object.keys(image)).toEqual(
        expect.arrayContaining(["name", "corners", "image"]),
      );
    const optional = ["title", "map"];
    expect(
      Object.keys(result)
        .filter((key) => !optional.includes(key))
        .sort(),
    ).toEqual(["bounds", "columns", "features", "groups", "kind", "notes", "overlays"]);
  });

  it("is plain data that crosses to another thread as it is", () => {
    for (const name of good) {
      const result = read(fixture(name));
      const copy = structuredClone(result);
      const { overlays, ...rest } = result;
      const { overlays: copied, ...copiedRest } = copy;
      expect(copiedRest).toEqual(rest);
      expect(JSON.parse(JSON.stringify(rest))).toEqual(rest);
      expect(copied).toHaveLength(overlays.length);
      overlays.forEach((image, at) => {
        expect(ArrayBuffer.isView(image.image.bytes)).toBe(true);
        expect(Array.from(copied[at].image.bytes)).toEqual(
          Array.from(image.image.bytes),
        );
        expect(copied[at].corners).toEqual(image.corners);
      });
    }
  });

  it("gives the same result for the same bytes", () => {
    for (const name of good) expect(read(fixture(name))).toEqual(read(fixture(name)));
  });

  it("bounds its notes", () => {
    const layers: Record<string, Uint8Array | string> = {};
    for (let at = 0; at < 40; at++) {
      layers[`layer${at}.shp`] = shp([{ kind: "point", at: [1, 2] }]);
      layers[`layer${at}.prj`] = at === 0 ? PRJ.wgs84 : PRJ.statePlane;
    }
    const result = read(zip(layers));
    expect(result.notes.length).toBeLessThanOrEqual(GEO_FILE_LIMITS.notes);
    for (const note of result.notes)
      expect(note.length).toBeLessThanOrEqual(GEO_FILE_LIMITS.noteChars);
    expect(result.notes[0]).toBe(
      "The archive has more than 16 layers. Only the first 16 were read.",
    );
  });

  it("needs no page: the readers name no document, no window and no network", () => {
    const folder = join(process.cwd(), "src/lib/geo/files");
    const sources = readdirSync(folder).filter((name) => name.endsWith(".ts"));
    expect(sources.length).toBeGreaterThan(10);
    for (const name of sources) {
      const code = readFileSync(join(folder, name), "utf8").replace(
        /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
        "",
      );
      expect(code, name).not.toMatch(
        /\b(?:document|window|navigator|fetch|XMLHttpRequest|WebSocket|DOMParser|importScripts|localStorage|Image|eval|Function)\s*[.(]|\bimport\s*\(|\bnew\s+(?:URL|Worker|Request)\b|\bawait\b|\bPromise\b|setTimeout/,
      );
    }
  });
});
