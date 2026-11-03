import type { LayerSpecification, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useState } from "react";
import { mapLayers } from "~/lib/geo/mapLayers";
import type { MapSpec } from "~/lib/geo/mapSpecTypes";
import { BASEMAP_SOURCE } from "./basemapStyle";
import { type MapTheme, toneColor } from "./mapTheme";
import type { Scene } from "./scene/sceneTypes";

export const BUILDING_MARKS = 200;

const SOURCE = "building-marks";
export const BUILDING_PROBE = "building-probe";
const FILL = "building-marks-fill";
const LINE = "building-marks-line";
const RAISED = "building-marks-raised";
export const BUILDING_LAYERS = [BUILDING_PROBE, FILL, RAISED, LINE] as const;

const HEIGHT = { unknown: 12, max: 1_000 } as const;

export type BuildingsState = "none" | "missing" | "far" | "drawn";

interface BuildingMark {
  key: string;
  lon: number;
  lat: number;
  color: string;
}

type Ring = readonly (readonly number[])[];

const inRing = (lon: number, lat: number, ring: Ring): boolean => {
  let inside = false;
  for (let at = 0, before = ring.length - 1; at < ring.length; before = at++) {
    const [x1, y1] = ring[at];
    const [x2, y2] = ring[before];
    if (y1 > lat !== y2 > lat && lon < ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1)
      inside = !inside;
  }
  return inside;
};

function polygonsOf(geometry: unknown): Ring[][] {
  const shape = geometry as { type?: unknown; coordinates?: unknown } | undefined;
  if (!shape || !Array.isArray(shape.coordinates)) return [];
  if (shape.type === "Polygon") return [shape.coordinates as Ring[]];
  if (shape.type === "MultiPolygon") return shape.coordinates as Ring[][];
  return [];
}

const onPolygon = (lon: number, lat: number, [outline, ...holes]: Ring[]): boolean =>
  Array.isArray(outline) &&
  inRing(lon, lat, outline) &&
  !holes.some((hole) => inRing(lon, lat, hole));

export const onFootprint = (lon: number, lat: number, geometry: unknown): boolean =>
  polygonsOf(geometry).some((polygon) => onPolygon(lon, lat, polygon));

function groundOf([outline]: Ring[]): number {
  let twice = 0;
  for (let at = 0, before = outline.length - 1; at < outline.length; before = at++)
    twice += outline[before][0] * outline[at][1] - outline[at][0] * outline[before][1];
  return Math.abs(twice) / 2;
}

export function buildingAt(
  lon: number,
  lat: number,
  footprints: readonly {
    geometry: unknown;
    properties?: Record<string, unknown> | null;
  }[],
): { geometry: { type: "Polygon"; coordinates: Ring[] }; height: number } | null {
  let found: Ring[] | null = null;
  let ground = 0;
  let height = 0;
  for (const footprint of footprints)
    for (const polygon of polygonsOf(footprint.geometry)) {
      if (!onPolygon(lon, lat, polygon)) continue;
      height = Math.max(height, heightOf(footprint.properties));
      const covers = groundOf(polygon);
      if (found && covers <= ground) continue;
      found = polygon;
      ground = covers;
    }
  return found ? { geometry: { type: "Polygon", coordinates: found }, height } : null;
}

export function buildingMarks(
  spec: MapSpec,
  theme: Pick<MapTheme, "tones">,
): BuildingMark[] {
  const marks: BuildingMark[] = [];
  for (const layer of mapLayers(spec)) {
    if (!("points" in layer) || !layer.points) continue;
    layer.points.forEach((point, at) => {
      if (point.highlight === "building")
        marks.push({
          key: `${layer.id}:${at}`,
          lon: point.lon,
          lat: point.lat,
          color: point.color ?? toneColor(theme, point.markerColor),
        });
    });
  }
  return marks;
}

function heightOf(properties: Record<string, unknown> | null | undefined): number {
  const said = Number(properties?.render_height ?? properties?.height);
  return Number.isFinite(said) && said > 0
    ? Math.min(said, HEIGHT.max)
    : HEIGHT.unknown;
}

const layersOf = (sourceLayer: string, from: number): LayerSpecification[] => [
  {
    id: BUILDING_PROBE,
    type: "fill",
    source: BASEMAP_SOURCE,
    "source-layer": sourceLayer,
    minzoom: from,
    paint: { "fill-opacity": 0 },
  },
  {
    id: FILL,
    type: "fill",
    source: SOURCE,
    paint: { "fill-color": ["get", "color"], "fill-opacity": 0.38 },
  },
  {
    id: RAISED,
    type: "fill-extrusion",
    source: SOURCE,
    layout: { visibility: "none" },
    paint: {
      "fill-extrusion-color": ["get", "color"],
      "fill-extrusion-height": ["get", "height"],
      "fill-extrusion-opacity": 0.88,
    },
  },
  {
    id: LINE,
    type: "line",
    source: SOURCE,
    layout: { "line-join": "round" },
    paint: { "line-color": ["get", "color"], "line-width": 2.5 },
  },
];

const EMPTY = { type: "FeatureCollection" as const, features: [] };

function buildingsOf(
  scene: Scene | null,
): { sourceLayer: string; from: number } | null {
  const held = scene?.context.find((item) => item.id === "buildings");
  if (!scene || !held || held.from === null || !held.ids.length) return null;
  const drawn = scene.style.find((layer) => layer.id === held.ids[0]);
  const sourceLayer =
    drawn && "source-layer" in drawn ? drawn["source-layer"] : undefined;
  return typeof sourceLayer === "string" ? { sourceLayer, from: held.from } : null;
}

export function useMapBuildings(
  map: MapLibreMap | null,
  scene: Scene | null,
  spec: MapSpec,
  theme: MapTheme,
): { state: BuildingsState; drawn: string } {
  const marks = useMemo(() => buildingMarks(spec, theme), [spec, theme]);
  const held = useMemo(() => buildingsOf(scene), [scene]);
  const [found, setFound] = useState<{ far: boolean; drawn: string }>({
    far: false,
    drawn: "",
  });

  useEffect(() => {
    if (!map || !scene || !held || !marks.length) return;
    let asked = "";
    const say = (far: boolean, drawn: string) =>
      setFound((before) =>
        before.far === far && before.drawn === drawn ? before : { far, drawn },
      );
    const ensure = (): boolean | null => {
      try {
        if (map.getLayer(BUILDING_PROBE)) return true;
        if (!map.getSource(SOURCE))
          map.addSource(SOURCE, { type: "geojson", data: EMPTY });
        const anchor = scene.marksBefore;
        const before =
          anchor !== undefined && map.getLayer(anchor) ? anchor : undefined;
        for (const layer of layersOf(held.sourceLayer, held.from))
          if (!map.getLayer(layer.id)) map.addLayer(layer, before);
        return false;
      } catch {
        return null;
      }
    };
    const give = (features: unknown[]) => {
      const source = map.getSource(SOURCE) as
        | { setData?: (data: unknown) => unknown }
        | undefined;
      source?.setData?.({ type: "FeatureCollection", features });
    };
    const refresh = () => {
      if (ensure() !== true) return;
      try {
        const zoom = map.getZoom();
        if (zoom < held.from) {
          if (asked !== "far") give([]);
          asked = "far";
          say(true, "");
          return;
        }
        const bounds = map.getBounds();
        const [west, south, east, north] = [
          bounds.getWest(),
          bounds.getSouth(),
          bounds.getEast(),
          bounds.getNorth(),
        ];
        const pitch = map.getPitch();
        const camera = [zoom, west, south, east, north, pitch]
          .map((value) => value.toFixed(5))
          .join(",");
        if (camera === asked) return;
        asked = camera;
        const features: unknown[] = [];
        const keys: string[] = [];
        let looked = 0;
        for (const mark of marks) {
          if (looked >= BUILDING_MARKS) break;
          if (
            mark.lon < west ||
            mark.lon > east ||
            mark.lat < south ||
            mark.lat > north
          )
            continue;
          looked += 1;
          const at = map.project([mark.lon, mark.lat]);
          const hit = buildingAt(
            mark.lon,
            mark.lat,
            map.queryRenderedFeatures([at.x, at.y], { layers: [BUILDING_PROBE] }),
          );
          if (!hit) continue;
          keys.push(mark.key);
          features.push({
            type: "Feature",
            geometry: hit.geometry,
            properties: { key: mark.key, color: mark.color, height: hit.height },
          });
        }
        give(features);
        const raised = pitch > 0;
        map.setLayoutProperty(RAISED, "visibility", raised ? "visible" : "none");
        map.setLayoutProperty(FILL, "visibility", raised ? "none" : "visible");
        say(false, `${keys.join(",")}|${raised ? "raised" : "flat"}`);
      } catch {}
    };
    const fresh = () => {
      asked = "";
      ensure();
    };
    ensure();
    map.on("idle", refresh);
    map.on("style.load", fresh);
    return () => {
      map.off("idle", refresh);
      map.off("style.load", fresh);
      try {
        for (const id of [...BUILDING_LAYERS].reverse())
          if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(SOURCE)) map.removeSource(SOURCE);
      } catch {}
    };
  }, [map, scene, held, marks]);

  return useMemo(() => {
    if (!marks.length) return { state: "none", drawn: "" };
    if (scene && !held) return { state: "missing", drawn: "" };
    return found.far
      ? { state: "far", drawn: "" }
      : { state: "drawn", drawn: found.drawn };
  }, [marks, scene, held, found]);
}
