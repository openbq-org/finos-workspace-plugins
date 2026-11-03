import { EXPORT_MIME } from "~/lib/geo/files/export";
import type { MapExportFormat } from "~/lib/geo/files/exportModel";
import { mapText } from "~/lib/geo/mapRows";
import { getShown } from "./widget";

const FORMATS: readonly [MapExportFormat, string][] = [
  ["kml", "Map (KML)"],
  ["kmz", "Map (KMZ)"],
  ["geojson", "Map (GeoJSON)"],
];

export async function exportOptions() {
  return getShown()
    ? FORMATS.map(([id, label]) => ({
        id,
        label,
        extension: id,
        mime: EXPORT_MIME[id],
      }))
    : [];
}

export async function exportData(id: string) {
  const shown = getShown();
  const format = FORMATS.find(([candidate]) => candidate === id)?.[0];
  if (!shown || !format) return null;
  const exporter = await import("~/lib/geo/mapExport");
  const regions = await exporter.exportShapes(shown.spec);
  return exporter.writeMap(shown.spec, format, {
    notes: shown.notes,
    name: shown.name,
    shapes: shown.shapes,
    ...regions,
  }).content;
}

export async function copilotContext() {
  const shown = getShown();
  if (!shown) return null;
  return { map: JSON.parse(mapText(shown.spec, shown.shapes, shown.view)) };
}
