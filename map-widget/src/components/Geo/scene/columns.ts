import type { Feature } from "geojson";
import { pointKey, regionKey } from "~/lib/geo/mapNotes";
import type { MapBounds } from "~/lib/geo/mapSummary";
import { FEW_MARKS, LOCAL_SPAN_DEGREES, range } from "../mapGeometry";
import { type Builder, emphasisOf, placeBox, stepOf, timeOf } from "./draft";
import { shapedRegions } from "./regions";

export const TALLEST = 0.15;
export const COLUMN_SIDES = 12;
const LEAST_EXTENT = 20_000;
const FEW_EXTENT = 400;
const METRES_PER_DEGREE = 111_320;

export function extentOf(box: MapBounds | null, least = LEAST_EXTENT): number {
  if (!box) return least;
  const lat = (box[1] + box[3]) / 2;
  const across =
    (box[2] - box[0]) *
    METRES_PER_DEGREE *
    Math.max(0.1, Math.cos((lat * Math.PI) / 180));
  const up = (box[3] - box[1]) * METRES_PER_DEGREE;
  return Math.max(least, across, up);
}

export function coveredBy(places: readonly [number, number][]): MapBounds | null {
  if (!places.length) return null;
  const cut = places.length >= 20 ? Math.floor(places.length * 0.05) : 0;
  const lons = places.map(([lon]) => lon).sort((a, b) => a - b);
  const lats = places.map(([, lat]) => lat).sort((a, b) => a - b);
  return [
    lons[cut],
    lats[cut],
    lons[lons.length - 1 - cut],
    lats[lats.length - 1 - cut],
  ];
}

export function prism(lon: number, lat: number, radius: number): [number, number][] {
  const dy = radius / METRES_PER_DEGREE;
  const dx = dy / Math.max(0.1, Math.cos((lat * Math.PI) / 180));
  const ring = Array.from({ length: COLUMN_SIDES }, (_, at): [number, number] => {
    const angle = (2 * Math.PI * at) / COLUMN_SIDES;
    return [lon + dx * Math.cos(angle), lat + dy * Math.sin(angle)];
  });
  return [...ring, ring[0]];
}

export const columnsLayer: Builder<"columns"> = (draft, layer, to, tint) => {
  const items = layer.points ?? layer.regions?.items ?? [];
  const domain = range(items);
  const top = domain ? Math.max(domain[1], 0) : 0;
  const part = (value: number | undefined) =>
    !domain
      ? 0.25
      : value === undefined || top <= 0
        ? 0.02
        : Math.max(0.02, value / top);
  const features: Feature[] = [];
  const places: [number, number][] = [];
  const least = () => {
    const box = layer.points ? coveredBy(places) : null;
    if (!box || places.length > FEW_MARKS) return LEAST_EXTENT;
    const span = Math.max(box[2] - box[0], box[3] - box[1]);
    return span > 0 && span <= LOCAL_SPAN_DEGREES ? FEW_EXTENT : LEAST_EXTENT;
  };

  if (layer.regions) {
    const boundaries = draft.sets[layer.regions.set];
    for (const { item, shape, box, centre } of shapedRegions(
      draft,
      layer.regions,
      boundaries,
    )) {
      if (box) places.push([(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]);
      const index = draft.marks.length;
      const color = tint.of(item);
      features.push({
        ...shape,
        id: index,
        properties: { i: index, color, h: part(item.value), ...stepOf(item) },
      });
      draft.marks.push({
        kind: "region",
        code: shape.properties.code,
        layer: layer.id,
        ...timeOf(item),
        key: regionKey({ code: shape.properties.code }),
        at: centre,
        label: item.label ?? shape.properties.name,
        tag: item.tag,
        value: item.value,
        props: item.props,
        color,
        ...emphasisOf(draft, item),
      });
    }
  } else {
    const points = layer.points ?? [];
    for (const point of points) {
      const [lon, lat] = placeBox(draft, point.lon, point.lat);
      places.push([lon, lat]);
    }
    const radius =
      extentOf(coveredBy(places), least()) / (2.5 * Math.sqrt(points.length) + 30);
    for (const point of points) {
      draft.reach(placeBox(draft, point.lon, point.lat));
      const index = draft.marks.length;
      const color = tint.of(point);
      features.push({
        type: "Feature",
        id: index,
        properties: { i: index, color, h: part(point.value), ...stepOf(point) },
        geometry: {
          type: "Polygon",
          coordinates: [prism(point.lon, point.lat, radius)],
        },
      });
      draft.marks.push({
        kind: "point",
        layer: layer.id,
        ...timeOf(point),
        key: pointKey(point),
        at: [point.lon, point.lat],
        label: point.label,
        tag: point.tag,
        value: point.value,
        props: point.props,
        color,
        ...emphasisOf(draft, point),
      });
    }
  }
  if (!features.length) return { count: 0, swatch: "column" };

  const tallest = Math.round(extentOf(coveredBy(places), least()) * TALLEST);
  for (const feature of features)
    if (feature.properties)
      feature.properties.h = Math.round(feature.properties.h * tallest);
  const { base } = to;
  to.data(base, features);
  to.add(
    "top",
    {
      id: base,
      type: "fill-extrusion",
      source: base,
      paint: {
        "fill-extrusion-color": ["get", "color"],
        "fill-extrusion-height": ["get", "h"],
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": 1,
        "fill-extrusion-vertical-gradient": true,
      },
    },
    { "fill-extrusion-opacity": 1 },
    { pointer: true },
  );
  to.add(
    "top",
    {
      id: `${base}-hover`,
      type: "line",
      source: base,
      filter: ["==", ["get", "i"], -1],
      paint: { "line-color": draft.theme.hover, "line-width": 1.6 },
    },
    {},
    { hover: true },
  );
  return { count: features.length, swatch: "column" };
};
