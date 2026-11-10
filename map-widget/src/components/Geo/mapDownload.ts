import { notify, saveFile } from "~/host";
import type { MapExportFormat } from "~/lib/geo/files/exportModel";
import type { MapNotes } from "~/lib/geo/mapNotes";
import type { DrawnShape } from "~/lib/geo/mapShapes";
import type { MapSpec } from "~/lib/geo/mapSpecTypes";

export const EXPORT_FORMATS: readonly [MapExportFormat, string, string][] = [
  ["kml", "KML", "Export the map as a KML file"],
  ["kmz", "KMZ", "Export the map as a KMZ file, with its images"],
  ["geojson", "GeoJSON", "Export the map as a GeoJSON file"],
];

const FAILED = "The map could not be exported";
const said = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

export async function saveMapFile(
  spec: MapSpec,
  format: MapExportFormat,
  options: { notes?: MapNotes; name?: string; shapes?: readonly DrawnShape[] } = {},
): Promise<void> {
  let exporter: typeof import("~/lib/geo/mapExport");
  let shapes: Awaited<ReturnType<typeof exporter.exportShapes>>;
  try {
    exporter = await import("~/lib/geo/mapExport");
    shapes = await exporter.exportShapes(spec);
  } catch {
    notify("error", `${FAILED}: a boundary file of its regions did not load. Try again.`);
    return;
  }
  let file: ReturnType<typeof exporter.writeMap>;
  try {
    file = exporter.writeMap(spec, format, { ...options, ...shapes });
  } catch (cause) {
    notify(
      "error",
      `${FAILED}: the ${format === "geojson" ? "GeoJSON" : format.toUpperCase()} file could not be written (${said(cause)}). A map with fewer marks or smaller images may fit.`,
    );
    return;
  }
  try {
    await saveFile(file.name, file.mime, file.content);
  } catch (cause) {
    notify("error", `${FAILED}: the host did not save the file (${said(cause)}).`);
    return;
  }
  notify("info", `Saved ${file.name}`);
}
