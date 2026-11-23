import type { Feature } from "geojson";
import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";
import type { MapPoint } from "~/lib/geo/mapMarkTypes";
import { pointKey } from "~/lib/geo/mapNotes";
import { GROUP_MAX_ZOOM, GROUP_RADIUS, onTrack } from "../mapCrowd";
import { radii } from "../mapGeometry";
import { toneColor } from "../mapTheme";
import {
  type Builder,
  type Draft,
  emphasisOf,
  GLOWING,
  glowOf,
  placeBox,
  stepOf,
  type Tint,
  timeOf,
} from "./draft";
import { average, dominant, groupLayers, IN_GROUP } from "./pointGroups";

export const TRACK_RADIUS = 4;
export const BUBBLE_OPACITY = 0.62;
export const KEPT_APART = 30;
const singledOut = (point: MapPoint) =>
  point.marker !== undefined || Boolean(point.highlight);
const keptApart = (point: MapPoint) => singledOut(point) || point.tag !== undefined;

export function pointFeatures(
  draft: Draft,
  layer: string,
  points: readonly MapPoint[],
  tint: Tint,
  track = false,
): Feature[] {
  const sized = points.some((point) => point.size !== undefined);
  const sizes = track && !sized ? points.map(() => TRACK_RADIUS) : radii(points);
  return points.map((point, at) => {
    const color = tint.of(point);
    draft.reach(placeBox(draft, point.lon, point.lat));
    const index = draft.marks.length;
    draft.marks.push({
      kind: "point",
      layer,
      ...timeOf(point),
      key: pointKey(point),
      at: [point.lon, point.lat],
      label: point.label,
      tag: point.tag,
      value: point.value,
      props: point.props,
      color,
      radius: sizes[at],
      ...(point.size === undefined ? {} : { size: point.size }),
      ...emphasisOf(draft, point),
    });
    return {
      type: "Feature",
      id: index,
      properties: {
        i: index,
        color,
        r: sizes[at],
        ...(point.value === undefined ? {} : { value: point.value }),
        ...(point.size === undefined ? {} : { size: point.size }),
        ...glowOf(draft, point),
        ...stepOf(point),
      },
      geometry: { type: "Point", coordinates: [point.lon, point.lat] },
    };
  });
}

export const pointsLayer: Builder<"points"> = (draft, layer, to, tint) => {
  const track = onTrack(layer.points, draft.joints);
  const dots = pointFeatures(draft, layer.id, layer.points, tint, track);
  if (!dots.length) return { count: 0, swatch: "circle" };
  const { base } = to;
  const { theme } = draft;
  const largest = Math.max(0, ...layer.points.map((point) => point.size ?? 0));
  const sized = largest > 0;
  const DOT_PARTS = {
    "circle-opacity": sized ? BUBBLE_OPACITY : 0.92,
    "circle-stroke-opacity": 1,
  };
  const facts = sized ? { sized: true as const } : {};
  const apart = layer.points.filter(keptApart).length;
  const keeps = apart > 0 && apart <= KEPT_APART;
  const stroke = dots.length > 2000 ? 0.5 : sized ? 1.5 : 1.2;
  const dot = (id: string, source: string): LayerSpecification => ({
    id,
    type: "circle",
    source,
    ...(sized ? { layout: { "circle-sort-key": ["-", 0, ["get", "r"]] } } : {}),
    paint: {
      "circle-color": ["get", "color"],
      "circle-radius": ["get", "r"],
      "circle-opacity": DOT_PARTS["circle-opacity"],
      "circle-stroke-color": theme.markStroke,
      "circle-stroke-width": stroke,
    },
  });
  const outline = (id: string, source: string): LayerSpecification => ({
    id,
    type: "circle",
    source,
    filter: ["==", ["get", "i"], -1],
    paint: {
      "circle-color": ["get", "color"],
      "circle-radius": ["+", ["get", "r"], 2],
      "circle-stroke-color": theme.hover,
      "circle-stroke-width": 2,
    },
  });
  const halo = (id: string, source: string): LayerSpecification => ({
    id,
    type: "circle",
    source,
    filter: GLOWING,
    paint: {
      "circle-color": ["get", "hc"],
      "circle-radius": ["+", ["get", "r"], 5],
      "circle-opacity": 0.3,
      "circle-stroke-color": ["get", "hc"],
      "circle-stroke-width": 2,
    },
  });
  const HALO_PARTS = { "circle-opacity": 0.3, "circle-stroke-opacity": 1 };

  if (dots.length - (keeps ? apart : 0) < 2) {
    to.data(base, dots);
    if (layer.points.some((point) => point.highlight))
      to.add("top", halo(`${base}-highlight`, base), HALO_PARTS);
    to.add("top", dot(base, base), DOT_PARTS, { pointer: true });
    to.add("top", outline(`${base}-hover`, base), {}, { hover: true });
    return { count: dots.length, swatch: "circle", ...facts };
  }

  const names: string[] = [];
  const crowd: Feature[] = [];
  const kept: Feature[] = [];
  dots.forEach((feature, index) => {
    const point = layer.points[index];
    const single = singledOut(point);
    if (keeps && keptApart(point)) return void kept.push(feature);
    const category = point.color === undefined ? point.category : undefined;
    let at = category === undefined ? -1 : names.indexOf(category);
    if (category !== undefined && at < 0) at = names.push(category) - 1;
    feature.properties = {
      ...feature.properties,
      ...(at < 0 ? { p: 1 } : { c: at }),
      ...(single ? { m: 1 } : {}),
    };
    crowd.push(feature);
  });
  const counts = names.map((_, at) => `c${at}`);
  const colours = names.map((category) => tint.of({ category }));
  const neutral = tint.scale ? theme.tones.neutral : tint.color;
  const averaged = tint.scale && !names.length ? tint.scale : null;
  const fill = averaged
    ? average(averaged, neutral)
    : dominant(counts, colours, neutral);
  const tone = toneColor(theme, layer.points.find(singledOut)?.markerColor);
  const count = (property: string): ExpressionSpecification => [
    "+",
    ["case", ["has", property], 1, 0],
  ];
  to.data(base, crowd, {
    cluster: false,
    clusterRadius: GROUP_RADIUS,
    clusterMaxZoom: GROUP_MAX_ZOOM,
    clusterProperties: {
      plain: count("p"),
      marked: count("m"),
      ...(sized ? { total: ["+", ["coalesce", ["get", "size"], 0]] } : {}),
      ...(averaged
        ? {
            sum: ["+", ["coalesce", ["get", "value"], 0]],
            valued: count("value"),
          }
        : {}),
      ...Object.fromEntries(
        names.map((_, at) => [
          `c${at}`,
          ["+", ["case", ["==", ["get", "c"], at], 1, 0]],
        ]),
      ),
    },
  });
  const groups = `${base}-groups`;
  draft.slots.top.push(
    ...groupLayers({
      base,
      theme,
      fill,
      tone,
      largest,
      opacity: DOT_PARTS["circle-opacity"],
      averaged: averaged !== null,
      counts,
      colours,
      neutral,
    }),
  );
  to.parts.push(
    { id: groups, opacity: DOT_PARTS },
    { id: `${base}-count`, opacity: { "text-opacity": 1 } },
  );
  draft.glyphs = true;
  to.add(
    "top",
    { ...dot(base, base), filter: ["!", IN_GROUP] } as LayerSpecification,
    DOT_PARTS,
    { pointer: true },
  );
  to.add("top", outline(`${base}-hover`, base), {}, { hover: true });
  const apartId = `${base}-apart`;
  if (kept.length) {
    to.data(apartId, kept);
    if (kept.some((feature) => feature.properties?.h === 1))
      to.add("top", halo(`${base}-highlight`, apartId), HALO_PARTS);
    to.add("top", dot(apartId, apartId), DOT_PARTS, { pointer: true });
    to.add("top", outline(`${apartId}-hover`, apartId), {}, { hover: true });
  }
  draft.clustered.push({
    layer: layer.id,
    source: base,
    circles: groups,
    single: base,
    features: crowd,
    timed: layer.points.some((point) => point.time !== undefined),
    optional: { radius: GROUP_RADIUS, maxZoom: GROUP_MAX_ZOOM },
    ...(kept.length ? { kept: apartId } : {}),
    ...(track ? { track: true as const } : {}),
    ...facts,
  });
  return { count: dots.length, swatch: "circle", groupable: true, ...facts };
};
