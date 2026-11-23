import { EXPORT_MIME, exportFileName, toGeoJson } from "./files/export";
import { toKml, toKmz } from "./files/exportKml";
import type { MapExportFormat, MapExportOptions } from "./files/exportModel";
import type { GeoGeometry } from "./files/types";
import { mapLayers, type ShownLayer } from "./mapLayers";
import { isDeferredSet, type MapRegion, type MapRegions } from "./mapMarkTypes";
import type { MapSpec } from "./mapSpecTypes";
import { loadRegionIndex, loadRegionShapes, matchRegion } from "./regions/registry";
import type { RegionShapes } from "./regions/shapes";

const regionsOf = (layer: ShownLayer): MapRegions | undefined =>
  layer.kind === "regions" || layer.kind === "columns" ? layer.regions : undefined;

function shapeId(regions: MapRegions, region: MapRegion): string | undefined {
  if (!isDeferredSet(regions.set)) return region.code;
  const match = matchRegion(regions.set, region.code, regions.within);
  return match && "id" in match ? match.id : undefined;
}

export async function exportShapes(
  spec: MapSpec,
  signal?: AbortSignal,
): Promise<Required<Pick<MapExportOptions, "shapeOf" | "nameOf">>> {
  const groups = new Map<MapRegions["set"], MapRegions[]>();
  for (const layer of mapLayers(spec)) {
    const regions = regionsOf(layer);
    if (!regions) continue;
    const group = groups.get(regions.set) ?? [];
    group.push(regions);
    groups.set(regions.set, group);
  }
  const loaded = new Map<string, RegionShapes[]>(
    await Promise.all(
      [...groups].map(async ([set, group]) => {
        await loadRegionIndex(set, signal);
        const ids = group.flatMap((regions) =>
          regions.items.flatMap((region) => shapeId(regions, region) ?? []),
        );
        return [set, await loadRegionShapes(set, ids, signal)] as const;
      }),
    ),
  );
  const shape = (layer: ShownLayer, region: MapRegion) => {
    const regions = regionsOf(layer);
    const id = regions && shapeId(regions, region);
    if (!regions || id === undefined) return undefined;
    for (const part of loaded.get(regions.set) ?? []) {
      const found = part.shapeOf(id);
      if (found) return found;
    }
    return undefined;
  };
  return {
    shapeOf: (layer, region) => {
      const geometry = shape(layer, region)?.geometry;
      return geometry?.type === "Polygon" || geometry?.type === "MultiPolygon"
        ? (geometry as GeoGeometry)
        : undefined;
    },
    nameOf: (layer, region) => {
      const name = shape(layer, region)?.properties?.name;
      return typeof name === "string" && name !== region.code ? name : undefined;
    },
  };
}

export interface MapExportFile {
  name: string;
  mime: string;
  content: string | Uint8Array;
}

export function writeMap(
  spec: MapSpec,
  format: MapExportFormat,
  given: MapExportOptions = {},
): MapExportFile {
  return {
    name: exportFileName(given.name ?? spec.title, format),
    mime: EXPORT_MIME[format],
    content:
      format === "geojson"
        ? toGeoJson(spec, given)
        : format === "kml"
          ? toKml(spec, given)
          : toKmz(spec, given),
  };
}

export async function exportMap(
  spec: MapSpec,
  format: MapExportFormat,
  options: Omit<MapExportOptions, "shapeOf" | "nameOf"> = {},
  signal?: AbortSignal,
): Promise<MapExportFile> {
  return writeMap(spec, format, {
    ...options,
    ...(await exportShapes(spec, signal)),
  });
}
