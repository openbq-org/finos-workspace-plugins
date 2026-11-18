import { readGeoJson } from "./geojson";
import { readGpx } from "./gpx";
import { type KmlImages, readKml } from "./kml";
import { GEO_FILE_LIMITS as LIMITS } from "./limits";
import { readShapefiles } from "./shapefile";
import {
  failFile,
  GeoFileFailure,
  type GeoFileHint,
  type GeoFileOutcome,
  type GeoFileResult,
} from "./types";
import { parseXmlDocument, xmlText } from "./xml";
import { type Archive, type ArchiveEntry, isZip, openArchive } from "./zip";

export { GEO_FILE_LIMITS } from "./limits";
export * from "./types";

const KML_ROOTS = new Set(["kml", "Document", "Folder", "Placemark"]);

function readXml(bytes: Uint8Array): GeoFileResult {
  const root = parseXmlDocument(xmlText(bytes));
  if (KML_ROOTS.has(root.name)) return readKml(root, "kml", null);
  if (root.name === "gpx") return readGpx(root);
  return failFile(
    "unknown-format",
    "The file is XML but neither KML nor GPX. A map file is KML, KMZ, a zipped shapefile, GPX or GeoJSON.",
  );
}

function readKmz(archive: Archive, main: ArchiveEntry): GeoFileResult {
  if (main.size > LIMITS.xmlBytes)
    return failFile(
      "too-large",
      `The KML document of the archive is over ${LIMITS.xmlBytes / 1024 / 1024} MB. Simplify it or split it.`,
    );
  const bytes = archive.read([main.name]).get(main.name);
  if (!bytes)
    return failFile("malformed", "The KML document of the archive cannot be read.");
  const folder = main.path.includes("/")
    ? main.path.slice(0, main.path.lastIndexOf("/") + 1)
    : "";
  const images: KmlImages = (path) => {
    const isImage = (extension: string) =>
      extension === "png" ||
      extension === "jpg" ||
      extension === "jpeg" ||
      extension === "webp";
    const wanted = [folder + path, path];
    const entry =
      archive.entries.find(
        (item) => isImage(item.extension) && wanted.includes(item.path),
      ) ??
      archive.entries.find(
        (item) =>
          isImage(item.extension) &&
          wanted.some((name) => name.toLowerCase() === item.path.toLowerCase()),
      );
    if (!entry) return "missing";
    if (entry.size > LIMITS.overlayBytes) return "too-large";
    return archive.read([entry.name]).get(entry.name) ?? "missing";
  };
  return readKml(parseXmlDocument(xmlText(bytes)), "kmz", images);
}

function readArchive(bytes: Uint8Array): GeoFileResult {
  const archive = openArchive(bytes);
  const has = (extension: string) =>
    archive.entries.some((entry) => entry.extension === extension);
  const kml = archive.entries.find((entry) => entry.extension === "kml");
  let result: GeoFileResult;
  if (has("shp")) result = readShapefiles(archive);
  else if (kml) result = readKmz(archive, kml);
  else if (archive.nested > 0)
    return failFile(
      "refused",
      "The archive holds another archive, and an archive inside an archive is not opened. Zip the .shp, .dbf and .prj files themselves, or give the KMZ file as it is.",
    );
  else
    return failFile(
      "unknown-format",
      "The archive has no .kml document and no .shp layer. A map archive is a KMZ file or a zipped shapefile.",
    );
  const notes = [...result.notes];
  if (archive.nested > 0)
    notes.push(
      `${archive.nested.toLocaleString("en-US")} ${archive.nested === 1 ? "archive" : "archives"} inside the archive ${archive.nested === 1 ? "was" : "were"} not opened.`,
    );
  if (archive.outside > 0)
    notes.push(
      `${archive.outside.toLocaleString("en-US")} ${archive.outside === 1 ? "entry" : "entries"} with a path that leaves the archive ${archive.outside === 1 ? "was" : "were"} ignored.`,
    );
  return { ...result, notes: notes.slice(0, LIMITS.notes) };
}

const NOT_READ: Record<string, string> = {
  shp: "A .shp file is one part of a shapefile. Zip it with its .dbf and .prj files and give the .zip.",
  dbf: "A .dbf file is one part of a shapefile. Zip it with its .shp and .prj files and give the .zip.",
  csv: "A CSV file is a table, not a map file. Load it as data and map its columns.",
  gpkg: "A GeoPackage is not read. Export it as GeoJSON or as a zipped shapefile.",
  tif: "A raster image is not read. A map file has points, lines and areas.",
  tiff: "A raster image is not read. A map file has points, lines and areas.",
};

function read(bytes: Uint8Array, hint: GeoFileHint | undefined): GeoFileResult {
  if (bytes.length === 0) return failFile("empty", "The file is empty.");
  if (bytes.length > LIMITS.fileBytes)
    return failFile(
      "too-large",
      `The file is over ${LIMITS.fileBytes / 1024 / 1024} MB. Simplify it, or split it into smaller files.`,
    );
  if (isZip(bytes)) return readArchive(bytes);
  let at = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) at = 3;
  const wide =
    (bytes[0] === 0xff && bytes[1] === 0xfe) ||
    (bytes[0] === 0xfe && bytes[1] === 0xff);
  while (at < bytes.length && (bytes[at] === 32 || (bytes[at] >= 9 && bytes[at] <= 13)))
    at++;
  if (wide || bytes[at] === 0x3c) return readXml(bytes);
  if (bytes[at] === 0x7b || bytes[at] === 0x5b)
    return readGeoJson(new TextDecoder("utf-8").decode(bytes.subarray(at)));
  const extension = /\.([A-Za-z0-9]{1,8})$/.exec(hint?.name ?? "")?.[1]?.toLowerCase();
  const shp =
    bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0x27 && bytes[3] === 0x0a;
  return failFile(
    "unknown-format",
    (shp ? NOT_READ.shp : extension && NOT_READ[extension]) ||
      "The file is not a map file that is read: KML, KMZ, a zipped shapefile, GPX or GeoJSON.",
  );
}

export function parseGeoFile(bytes: Uint8Array, hint?: GeoFileHint): GeoFileOutcome {
  try {
    const file = read(bytes, hint);
    if (file.features.length === 0 && file.overlays.length === 0)
      return {
        ok: false,
        error: {
          code: "empty",
          message: ["The file has nothing a map draws.", ...file.notes].join(" "),
        },
      };
    return { ok: true, file };
  } catch (cause) {
    if (cause instanceof GeoFileFailure)
      return { ok: false, error: { code: cause.code, message: cause.message } };
    return {
      ok: false,
      error: {
        code: "internal",
        message:
          "The file could not be read: the reader failed. This is a defect of the app, not of the file.",
      },
    };
  }
}
