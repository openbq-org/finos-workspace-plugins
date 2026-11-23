import { megabytes } from "~/lib/codemode/limits";
import { bytesOf } from "./base64";
import { GeoFileFailure, parseGeoFile } from "./files";
import { type Archive, openArchive } from "./files/zip";
import { fileAsks, flatNote } from "./mapFileConvention";
import { legendOf, markOf, marksOf } from "./mapFileMarks";
import type { FileInput } from "./mapFileReader";
import { writtenSteps } from "./mapFileSteps";
import { fail } from "./mapValues";

export const FLAT_LIMITS = {
  chars: 2 * 1024 * 1024,
  entries: 64,
  ratio: 200,
} as const;

function kmzDocument(raw: unknown): Uint8Array {
  const tooLarge = () =>
    fail(
      `the KMZ file is over ${megabytes(FLAT_LIMITS.chars)}. A KMZ file with images is large: keep the KML document only, or give the file as { file: { name, data } }.`,
    );
  if (typeof raw === "string" && raw.length > (FLAT_LIMITS.chars * 4) / 3 + 4)
    return tooLarge();
  const bytes =
    raw instanceof Uint8Array ? raw : typeof raw === "string" ? bytesOf(raw) : null;
  if (!bytes) return fail('"kmz" must be a KMZ file as base64 text.');
  if (bytes.length > FLAT_LIMITS.chars) return tooLarge();
  const entries = () =>
    fail(`the KMZ file has more than ${FLAT_LIMITS.entries} entries.`);
  let archive: Archive;
  try {
    archive = openArchive(bytes);
  } catch (cause) {
    return cause instanceof GeoFileFailure && cause.code === "too-large"
      ? entries()
      : fail("the KMZ file is not a zip archive that can be read.");
  }
  if (archive.listed > FLAT_LIMITS.entries) return entries();
  const main = archive.entries.find((entry) => entry.extension === "kml");
  if (!main) return fail("the KMZ file has no .kml document.");
  if (main.size > FLAT_LIMITS.chars)
    return fail(
      `the KML document of the KMZ file is ${main.size.toLocaleString("en-US")} bytes unpacked. A KML file has at most ${FLAT_LIMITS.chars.toLocaleString("en-US")}.`,
    );
  if (main.size > Math.max(main.packed, 1) * FLAT_LIMITS.ratio)
    return fail(
      `the KML document of the KMZ file unpacks to more than ${FLAT_LIMITS.ratio} times its size, which no map does. The file is not read.`,
    );
  try {
    const document = archive.read([main.name]).get(main.name);
    return document ?? fail("the KMZ file has no .kml document.");
  } catch (cause) {
    return fail(
      cause instanceof GeoFileFailure && cause.code === "refused"
        ? "the KML document of the KMZ file unpacks to more than the archive declares for it. The file is not read."
        : "the KMZ file is not a zip archive that can be read.",
    );
  }
}

export function flatInput(raw: unknown, as: "kml" | "kmz"): FileInput {
  const what = as === "kml" ? "KML" : "KMZ file";
  const NOTHING = `the ${what} has no placemark with a Point, a LineString or a Polygon. A file that only links to other files (NetworkLink) or shows an image (an overlay) has nothing the map reads.`;
  let bytes: Uint8Array;
  if (as === "kml") {
    if (typeof raw !== "string") return fail('"kml" must be the text of a KML file.');
    if (raw.length > FLAT_LIMITS.chars)
      return fail(
        `the KML is ${raw.length.toLocaleString("en-US")} characters. A KML file has at most ${FLAT_LIMITS.chars.toLocaleString("en-US")}.`,
      );
    bytes = new TextEncoder().encode(raw);
  } else bytes = kmzDocument(raw);
  const outcome = parseGeoFile(bytes);
  if (outcome.error)
    return fail(
      outcome.error.code === "empty"
        ? NOTHING
        : outcome.error.code === "unknown-format"
          ? `the ${what} is not a KML document: ${outcome.error.message}`
          : `the ${what} cannot be read: ${outcome.error.message}`,
    );
  const file = outcome.file;
  if (file.kind !== "kml")
    return fail(
      `"${as}" must be ${as === "kml" ? "the text of a KML file" : "a KMZ file"}: this is ${file.kind === "gpx" ? "GPX" : "GeoJSON"}. Give it as { file: { name, ${as === "kml" ? "text" : "data"} } }.`,
    );
  if (file.features.length === 0) return fail(NOTHING);
  const shapes: unknown[] = [];
  const marks = { points: [] as unknown[], lines: shapes, polygons: shapes };
  const notes = [...file.notes];
  const asks = fileAsks(file.map);
  const played = asks.time ? writtenSteps(file, notes) : undefined;
  const legend: { valueLabel?: string; sizeLabel?: string } = {};
  const folders = new Set<number>();
  for (const feature of file.features) {
    marksOf(
      feature.geometry,
      markOf(feature, undefined, asks.category ? "category" : undefined, played),
      marks,
    );
    if (feature.group !== undefined) folders.add(feature.group);
    if (legend.valueLabel === undefined || legend.sizeLabel === undefined) {
      const said = legendOf(feature);
      legend.valueLabel ??= said.valueLabel;
      legend.sizeLabel ??= said.sizeLabel;
    }
  }
  if (folders.size > 1) notes.push(flatNote(folders.size));
  const first = file.groups[0];
  const title =
    file.title ??
    (first && first.parent === undefined && first.name !== "Untitled"
      ? first.name
      : undefined);
  return {
    points: marks.points,
    shapes,
    layers: [],
    notes,
    ...(title === undefined ? {} : { title }),
    asks: { ...asks, layers: undefined, ...legend },
  };
}
