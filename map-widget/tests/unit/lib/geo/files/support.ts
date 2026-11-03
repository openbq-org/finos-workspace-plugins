import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import {
  type GeoFileError,
  type GeoFileHint,
  type GeoFileOutcome,
  type GeoFileResult,
  parseGeoFile,
} from "~/lib/geo/files";
import { cpuNow } from "../../../machinePace";

export const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(process.cwd(), "tests/fixtures/geo/files", name)));

export function read(bytes: Uint8Array, hint?: GeoFileHint): GeoFileResult {
  const outcome = parseGeoFile(bytes, hint);
  if (outcome.error) throw new Error(`${outcome.error.code}: ${outcome.error.message}`);
  return outcome.file;
}

export function refusal(bytes: Uint8Array, hint?: GeoFileHint): GeoFileError {
  const outcome = parseGeoFile(bytes, hint);
  expect(outcome.ok).toBe(false);
  if (!outcome.error) throw new Error("the file was read");
  expect(outcome.error.code).not.toBe("internal");
  return outcome.error;
}

export function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function strings(value: unknown, path = "$"): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (value instanceof Uint8Array || value === null || typeof value !== "object")
    return [];
  return Object.entries(value).flatMap(([key, item]) =>
    key === "description"
      ? []
      : [...strings(key, `${path}.${key}#`), ...strings(item, `${path}.${key}`)],
  );
}

export const POINT =
  "<Placemark><name>P</name><Point><coordinates>1,2</coordinates></Point></Placemark>";
export const kml = (body: string) => `<kml><Document>${body}</Document></kml>`;

export function timed(bytes: Uint8Array): [GeoFileOutcome, number] {
  const started = cpuNow();
  const outcome = parseGeoFile(bytes);
  return [outcome, cpuNow() - started];
}
