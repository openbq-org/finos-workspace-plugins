import { type MapLayer, mapFrames, mapLayers, type ShownLayer } from "../mapLayers";
import type { MapPoint, MapRegion, MapShape, Marked } from "../mapMarkTypes";
import { pointKey, regionKey } from "../mapNotes";
import { type DrawnShape, shapeName, shapePath } from "../mapShapes";
import type { MapSpec } from "../mapSpecTypes";
import { MAP_CREDITS } from "../markBudget";
import { shapeMeasure } from "../measure";
import type { MapMember, MemberLayer } from "./convention";
import type { GeoGeometry, GeoPosition } from "./types";

export type MapExportFormat = "geojson" | "kml" | "kmz";

export interface MapExportOptions {
  shapeOf?: (layer: ShownLayer, region: MapRegion) => GeoGeometry | undefined;
  nameOf?: (layer: ShownLayer, region: MapRegion) => string | undefined;
  notes?: Record<string, string>;
  name?: string;
  shapes?: readonly DrawnShape[];
}

export const DRAWN_LAYER = "My shapes";

export interface ExportFeature {
  layer: number;
  geometry: GeoGeometry;
  name?: string;
  mark: Marked;
  note?: string;
}

export interface ExportModel {
  title: string;
  layers: {
    name: string;
    valueLabel?: string;
    sizeLabel?: string;
    range?: [number, number];
  }[];
  features: ExportFeature[];
  images: {
    layer: number;
    name: string;
    mime: string;
    data: string;
    corners: GeoPosition[];
  }[];
  notes: string[];
  credits: string[];
  member: MapMember;
}

const LAYER_WORDS: Record<MapLayer["kind"], string> = {
  regions: "Regions",
  points: "Points",
  heat: "Density",
  clusters: "Clusters",
  lines: "Lines",
  polygons: "Areas",
  flows: "Flows",
  columns: "Columns",
  source: "Source",
  image: "Image",
};

const closed = (ring: GeoPosition[]): GeoPosition[] => {
  const [first, last] = [ring[0], ring[ring.length - 1]];
  return first && last && (first[0] !== last[0] || first[1] !== last[1])
    ? [...ring, [first[0], first[1]]]
    : ring;
};

const turn = (ring: readonly GeoPosition[]): number => {
  let sum = 0;
  for (let at = 0; at + 1 < ring.length; at++)
    sum += ring[at][0] * ring[at + 1][1] - ring[at + 1][0] * ring[at][1];
  return sum;
};

const rings = (area: readonly GeoPosition[][]): GeoPosition[][] =>
  area.map((ring, at) => {
    const whole = closed(ring);
    const around = turn(whole);
    return around === 0 || around > 0 === (at === 0) ? whole : [...whole].reverse();
  });

export const fileGeometry = (geometry: GeoGeometry): GeoGeometry =>
  geometry.type === "Polygon"
    ? { type: "Polygon", coordinates: rings(geometry.coordinates) }
    : geometry.type === "MultiPolygon"
      ? { type: "MultiPolygon", coordinates: geometry.coordinates.map(rings) }
      : geometry;

const shapeGeometry = (shape: MapShape): GeoGeometry =>
  shape.type === "line"
    ? { type: "LineString", coordinates: shape.coordinates }
    : { type: "Polygon", coordinates: rings(shape.coordinates) };

const pointGeometry = (point: MapPoint): GeoGeometry => ({
  type: "Point",
  coordinates: [point.lon, point.lat],
});

const rounded = (value: number) => Math.round(value * 1e4) / 1e4;

function measured(shape: DrawnShape): Record<string, number> {
  const { lengthKm, areaKm2, roundKm } = shapeMeasure(shape);
  return {
    ...(lengthKm === undefined ? {} : { length_km: rounded(lengthKm) }),
    ...(areaKm2 === undefined ? {} : { area_km2: rounded(areaKm2) }),
    ...(roundKm === undefined ? {} : { perimeter_km: rounded(roundKm) }),
  };
}

const fold = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

export function modelOf(
  spec: MapSpec,
  options: MapExportOptions,
  format: MapExportFormat,
): ExportModel {
  const model: ExportModel = {
    title: options.name ?? spec.title ?? "Map",
    layers: [],
    features: [],
    images: [],
    notes: [],
    credits: (spec.credits ?? []).map((id) => MAP_CREDITS[id].file),
    member: { version: 1 },
  };
  let unshaped = 0;
  const names = new Set<string>();
  const named = (wanted: string): string => {
    let name = wanted;
    for (let nth = 2; names.has(name); nth++) name = `${wanted} ${nth}`;
    names.add(name);
    return name;
  };
  const rewritten = new Set<string>();
  const switched: MemberLayer[] = [];
  const folders = new Map<string, number>();
  let tagged = false;
  for (const layer of mapLayers(spec)) {
    if (layer.kind === "source") {
      const name = layer.name ?? LAYER_WORDS[layer.kind];
      model.notes.push(
        `The layer "${name}" is a map source of a connected backend and is not in this file.`,
      );
      continue;
    }
    const shared = layer.group === undefined ? undefined : folders.get(layer.group);
    const name =
      shared === undefined
        ? named(layer.group ?? layer.name ?? LAYER_WORDS[layer.kind])
        : model.layers[shared].name;
    if (layer.visible === false || layer.opacity !== undefined)
      switched.push({
        name,
        ...(layer.visible === false ? { hidden: true as const } : {}),
        ...(layer.opacity === undefined ? {} : { opacity: layer.opacity }),
      });
    const at = shared ?? model.layers.length;
    if (layer.group !== undefined && shared === undefined) folders.set(layer.group, at);
    const add = (geometry: GeoGeometry, mark: Marked, note?: string) => {
      if (note) tagged = true;
      model.features.push({ layer: at, geometry, mark, ...(note ? { note } : {}) });
    };
    const before = model.features.length;
    const points = (list: readonly MapPoint[]) => {
      for (const point of list)
        add(pointGeometry(point), point, options.notes?.[pointKey(point)]);
    };
    const regions = (list: readonly MapRegion[]) => {
      for (const region of list) {
        const geometry = options.shapeOf?.(layer, region);
        const called =
          region.label === undefined ? options.nameOf?.(layer, region) : undefined;
        if (geometry) rewritten.add("regions are the areas of their boundaries");
        if (geometry)
          add(
            fileGeometry(geometry),
            called === undefined ? region : { ...region, label: called },
            options.notes?.[regionKey(region)],
          );
        else unshaped++;
      }
    };
    if (layer.kind === "image") {
      model.images.push({
        layer: at,
        name,
        mime: layer.image.mime,
        data: layer.image.data,
        corners: layer.image.corners,
      });
    } else if (layer.kind === "regions") regions(layer.regions.items);
    else if (layer.kind === "lines" || layer.kind === "polygons")
      for (const shape of layer.shapes) add(shapeGeometry(shape), shape);
    else if (layer.kind === "flows") {
      if (layer.flows.length) rewritten.add("flows are lines");
      for (const flow of layer.flows)
        add({ type: "LineString", coordinates: [flow.from, flow.to] }, flow);
    } else if (layer.kind === "columns") {
      points(layer.points ?? []);
      regions(layer.regions?.items ?? []);
    } else if (
      layer.kind === "points" ||
      layer.kind === "heat" ||
      layer.kind === "clusters"
    )
      points(layer.points);
    if (layer.kind === "heat") rewritten.add("a density is its points");
    if (layer.kind === "clusters") rewritten.add("grouped points are single points");
    if (layer.kind === "columns") rewritten.add("columns are the marks they stand on");
    const values = model.features
      .slice(before)
      .flatMap(({ mark }) => (mark.value === undefined ? [] : [mark.value]));
    if (shared !== undefined) continue;
    model.layers.push({
      name,
      ...(layer.valueLabel ? { valueLabel: layer.valueLabel } : {}),
      ...("sizeLabel" in layer && layer.sizeLabel
        ? { sizeLabel: layer.sizeLabel }
        : {}),
      ...(values.length ? { range: [Math.min(...values), Math.max(...values)] } : {}),
    });
  }
  const drawn = options.shapes ?? [];
  if (drawn.length) {
    const at = model.layers.length;
    model.layers.push({ name: named(DRAWN_LAYER) });
    let folded = 0;
    for (const shape of drawn) {
      const path = shapePath(shape);
      if (path.some(([lon]) => lon > 180 || lon < -180)) folded++;
      const places = path.map(([lon, lat]): GeoPosition => [fold(lon), lat]);
      const geometry: GeoGeometry =
        shape.kind === "point"
          ? { type: "Point", coordinates: places[0] }
          : shape.kind === "line"
            ? { type: "LineString", coordinates: places }
            : { type: "Polygon", coordinates: [places] };
      model.features.push({
        layer: at,
        geometry: fileGeometry(geometry),
        mark: {
          label: shapeName(shape, drawn),
          props: {
            kind: shape.kind,
            ...(shape.radiusKm === undefined ? {} : { radius_km: shape.radiusKm }),
            ...measured(shape),
          },
        },
        ...(shape.note ? { note: shape.note } : {}),
      });
    }
    if (folded > 0)
      model.notes.push(
        `${folded.toLocaleString("en-US")} drawn shape${folded === 1 ? " crosses" : "s cross"} the 180th meridian: ${folded === 1 ? "its" : "their"} longitudes are written between -180 and 180.`,
      );
  }
  if (model.features.some((feature) => feature.mark.highlight === "building"))
    model.notes.push(BUILDINGS_NOT_EXPORTED);
  if (unshaped > 0)
    model.notes.push(
      `${unshaped.toLocaleString("en-US")} region${unshaped === 1 ? " has" : "s have"} no boundary shape here and ${unshaped === 1 ? "is" : "are"} not in this file.`,
    );
  if (format !== "kmz" && model.images.length)
    model.notes.push(
      `${model.images.length} image${model.images.length === 1 ? " is" : "s are"} not in this file: ${format === "kml" ? "a KML file" : "GeoJSON"} holds no image. A KMZ file holds them.`,
    );
  if (rewritten.size)
    model.notes.push(
      `A file holds the marks of a map, not how a layer draws them: ${[...rewritten].join(", ")}.`,
    );
  if (drawn.length) model.notes.push(DRAWN_AS_MARKS);
  if (tagged) model.notes.push(TAGS_AS_NOTES);
  const said = [...new Set([...(spec.notes ?? []), ...model.notes])];
  model.notes = model.notes.filter((note) => !(spec.notes ?? []).includes(note));
  const frames = mapFrames(spec);
  model.member = {
    version: 1,
    ...(spec.credits?.length ? { credits: [...spec.credits] } : {}),
    ...(said.length ? { notes: said } : {}),
    ...(frames.length ? { time: true as const } : {}),
    ...(model.features.some(({ mark }) => mark.category !== undefined)
      ? { category: true as const }
      : {}),
    ...(spec.frame === undefined ? {} : { frame: spec.frame }),
    ...(spec.categoryLabel === undefined ? {} : { categoryLabel: spec.categoryLabel }),
    ...(switched.length ? { layers: switched } : {}),
    ...(spec.view === undefined ? {} : { view: spec.view }),
    ...(spec.context?.length ? { context: [...spec.context] } : {}),
    ...(spec.boundaries?.length ? { boundaries: [...spec.boundaries] } : {}),
    ...(spec.basemap && spec.basemap.source === undefined
      ? { basemap: spec.basemap }
      : {}),
    ...(spec.pitch === undefined ? {} : { pitch: spec.pitch }),
  };
  return model;
}

export const DRAWN_AS_MARKS = `The shapes drawn by hand are marks of the layer "${DRAWN_LAYER}": a circle is its outline, with its radius as a value, and the colour of a shape is not written.`;
export const TAGS_AS_NOTES =
  'The tags added by hand are the value "note" of their marks.';

export const BUILDINGS_NOT_EXPORTED =
  "The building outlines of this map are drawn from the basemap (OpenStreetMap) and are not in this file: it holds the points.";

export const about = (model: ExportModel): string =>
  [...model.notes, ...model.credits].join(" ");

export function propertiesOf(
  feature: ExportFeature,
  model: ExportModel,
): Record<string, string | number | boolean | null> {
  const { mark, note } = feature;
  const layer = model.layers[feature.layer];
  const tall = "height" in mark && typeof mark.height === "number" ? mark.height : null;
  const size = "size" in mark && typeof mark.size === "number" ? mark.size : null;
  const own: Record<string, string | number | boolean | null> = {
    layer: layer.name,
    ...(mark.label === undefined ? {} : { name: mark.label }),
    ...(mark.value === undefined ? {} : { value: mark.value }),
    ...(mark.value === undefined || !layer.valueLabel
      ? {}
      : { valueLabel: layer.valueLabel }),
    ...(size === null ? {} : { size }),
    ...(size === null || !layer.sizeLabel ? {} : { sizeLabel: layer.sizeLabel }),
    ...(mark.tag === undefined ? {} : { tag: mark.tag }),
    ...(mark.category === undefined ? {} : { category: mark.category }),
    ...(mark.time === undefined ? {} : { time: mark.time }),
    ...(mark.marker === undefined ? {} : { marker: mark.marker }),
    ...(mark.markerColor === undefined ? {} : { markerColor: mark.markerColor }),
    ...(mark.highlight ? { highlight: mark.highlight } : {}),
    ...(mark.meaning === undefined ? {} : { meaning: mark.meaning }),
    ...(tall === null ? {} : { height: tall }),
    ...(mark.color === undefined ? {} : { color: mark.color }),
    ...(note ? { note } : {}),
  };
  const other: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(mark.props ?? {})) {
    if (Object.hasOwn(own, key) && own[key] === value) continue;
    other[Object.hasOwn(own, key) ? `${key}_` : key] = value;
  }
  return { ...own, ...other };
}
