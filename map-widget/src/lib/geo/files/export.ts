import { fileStem } from "~/lib/utils/fileStem";
import type { MapSpec } from "../mapSpecTypes";
import { MAP_MEMBER } from "./convention";
import {
  about,
  type MapExportFormat,
  type MapExportOptions,
  modelOf,
  propertiesOf,
} from "./exportModel";

export function toGeoJson(spec: MapSpec, options: MapExportOptions = {}): string {
  const model = modelOf(spec, options, "geojson");
  return JSON.stringify({
    type: "FeatureCollection",
    name: model.title,
    ...(about(model) ? { description: about(model) } : {}),
    ...(model.credits.length ? { attribution: model.credits.join(" ") } : {}),
    [MAP_MEMBER]: model.member,
    features: model.features.map((feature) => ({
      type: "Feature",
      geometry: feature.geometry,
      properties: propertiesOf(feature, model),
    })),
  });
}

export function exportFileName(
  name: string | undefined,
  format: MapExportFormat,
): string {
  return `${fileStem(name, "map")}.${format}`;
}

export const EXPORT_MIME: Record<MapExportFormat, string> = {
  geojson: "application/geo+json",
  kml: "application/vnd.google-earth.kml+xml",
  kmz: "application/vnd.google-earth.kmz",
};
