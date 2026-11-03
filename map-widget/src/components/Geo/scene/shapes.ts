import type { Feature, Geometry } from "geojson";
import type { ExpressionSpecification } from "maplibre-gl";
import { boundsOf } from "~/lib/geo/regions/boundaries";
import { insidePoint, middle } from "../mapGeometry";
import { type Builder, emphasisOf, GLOWING, glowOf, stepOf, timeOf } from "./draft";

const ROOF_BAND = 0.07;
const ROOF_BAND_LEAST = 2.5;
const COLLAR_MOST = 0.35;
const COLLAR_WIDER = 1.07;

function widened(outline: readonly [number, number][]): [number, number][] {
  let west = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  for (const [lon, lat] of outline) {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  const [cx, cy] = [(west + east) / 2, (south + north) / 2];
  return outline.map(([lon, lat]) => [
    cx + (lon - cx) * COLLAR_WIDER,
    cy + (lat - cy) * COLLAR_WIDER,
  ]);
}
export const STANDING_OPACITY = 0.94;

export const shapesLayer: Builder<"lines" | "polygons"> = (draft, layer, to, tint) => {
  const features: Feature[] = [];
  for (const item of layer.shapes) {
    const color = tint.of(item);
    const geometry: Geometry =
      item.type === "line"
        ? { type: "LineString", coordinates: item.coordinates }
        : { type: "Polygon", coordinates: item.coordinates };
    const index = draft.marks.length;
    const shape: Feature = {
      type: "Feature",
      id: index,
      properties: { i: index, color, ...glowOf(draft, item), ...stepOf(item) },
      geometry,
    };
    features.push(shape);
    draft.reach(boundsOf(shape, draft.unwrap));
    const tall = item.type === "polygon" ? item.height : undefined;
    if (tall !== undefined && shape.properties) shape.properties.m = tall;
    draft.marks.push({
      kind: "shape",
      layer: layer.id,
      ...timeOf(item),
      at:
        (item.type === "polygon" ? insidePoint(item.coordinates) : null) ??
        middle(boundsOf(shape, false)),
      ...(tall === undefined ? {} : { lift: tall }),
      label: item.label,
      tag: item.tag,
      value: item.value,
      props: item.props,
      color,
      ...emphasisOf(draft, item),
    });
  }
  const areas = layer.kind === "polygons";
  if (!features.length) return { count: 0, swatch: areas ? "fill" : "line" };
  const { base } = to;
  to.data(base, features);
  const glowing = layer.shapes.some((item) => item.highlight);
  const fill = layer.shapes.some((item) => item.category !== undefined) ? 0.55 : 0.28;
  const tallest = Math.max(
    0,
    ...layer.shapes.map((item) => (item.type === "polygon" ? (item.height ?? 0) : 0)),
  );
  if (areas && tallest > 0) {
    const band = Math.max(ROOF_BAND_LEAST, Math.round(tallest * ROOF_BAND * 10) / 10);
    const height: ExpressionSpecification = ["coalesce", ["get", "m"], 0];
    to.add(
      "top",
      {
        id: base,
        type: "fill-extrusion",
        source: base,
        paint: {
          "fill-extrusion-color": ["get", "color"],
          "fill-extrusion-height": height,
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": STANDING_OPACITY,
          "fill-extrusion-vertical-gradient": true,
        },
      },
      { "fill-extrusion-opacity": STANDING_OPACITY },
      { pointer: true },
    );
    if (glowing) {
      const collars: Feature[] = [];
      features.forEach((feature, at) => {
        const item = layer.shapes[at];
        if (!item.highlight || item.type !== "polygon") return;
        const tall = item.height ?? 0;
        collars.push({
          type: "Feature",
          properties: {
            ...feature.properties,
            from: Math.max(tall * (1 - COLLAR_MOST), tall - band),
            to: Math.max(0.2, tall - 0.1),
          },
          geometry: {
            type: "Polygon",
            coordinates: [widened(item.coordinates[0]), ...item.coordinates.slice(1)],
          },
        });
      });
      to.data(`${base}-collars`, collars);
      to.add(
        "top",
        {
          id: `${base}-highlight`,
          type: "fill-extrusion",
          source: `${base}-collars`,
          paint: {
            "fill-extrusion-color": ["get", "hc"],
            "fill-extrusion-base": ["get", "from"],
            "fill-extrusion-height": ["get", "to"],
            "fill-extrusion-opacity": 1,
            "fill-extrusion-vertical-gradient": false,
          },
        },
        { "fill-extrusion-opacity": 1 },
      );
    }
    to.add(
      "top",
      {
        id: `${base}-hover`,
        type: "fill-extrusion",
        source: base,
        filter: ["==", ["get", "i"], -1],
        paint: {
          "fill-extrusion-color": draft.theme.hover,
          "fill-extrusion-base": height,
          "fill-extrusion-height": ["+", height, 0.6],
          "fill-extrusion-opacity": 1,
          "fill-extrusion-vertical-gradient": false,
        },
      },
      {},
      { hover: true },
    );
    draft.standing.push(layer.id);
    return { count: features.length, swatch: "fill" };
  }
  if (areas) {
    to.add(
      "line",
      {
        id: base,
        type: "fill",
        source: base,
        paint: { "fill-color": ["get", "color"], "fill-opacity": fill },
      },
      { "fill-opacity": fill },
      { pointer: true },
    );
    to.add(
      "line",
      {
        id: `${base}-outline`,
        type: "line",
        source: base,
        paint: { "line-color": ["get", "color"], "line-width": 1.5 },
      },
      { "line-opacity": 1 },
    );
    if (glowing)
      to.add(
        "line",
        {
          id: `${base}-highlight`,
          type: "line",
          source: base,
          filter: GLOWING,
          layout: { "line-join": "round" },
          paint: { "line-color": ["get", "hc"], "line-width": 3.6 },
        },
        { "line-opacity": 1 },
      );
  } else {
    if (glowing)
      to.add(
        "line",
        {
          id: `${base}-highlight`,
          type: "line",
          source: base,
          filter: GLOWING,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": ["get", "hc"], "line-width": 8, "line-opacity": 0.5 },
        },
        { "line-opacity": 0.5 },
      );
    to.add(
      "line",
      {
        id: base,
        type: "line",
        source: base,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 2.5 },
      },
      { "line-opacity": 1 },
      { pointer: true },
    );
  }
  return { count: features.length, swatch: areas ? "fill" : "line" };
};
