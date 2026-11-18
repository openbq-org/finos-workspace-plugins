import type { Feature } from "geojson";
import { range } from "../mapGeometry";
import { type Builder, placeBox, stepOf, timeOf } from "./draft";

const LEAST_WEIGHT = 0.1;

const CELL_DEGREES = 2;
const FULLEST = 2.5;

export function fullestPlace(
  points: readonly { lat: number; lon: number; time?: string }[],
  weights: readonly number[],
): number {
  const cells = new Map<string, number>();
  let fullest = 0;
  const always = new Map<string, number>();
  points.forEach((point, at) => {
    const place = `${Math.floor(point.lon / CELL_DEGREES)}:${Math.floor(point.lat / CELL_DEGREES)}`;
    const sums = point.time === undefined ? always : cells;
    const key = point.time === undefined ? place : `${point.time}|${place}`;
    sums.set(key, (sums.get(key) ?? 0) + weights[at]);
  });
  for (const [key, sum] of cells)
    fullest = Math.max(
      fullest,
      sum + (always.get(key.slice(key.indexOf("|") + 1)) ?? 0),
    );
  for (const sum of always.values()) fullest = Math.max(fullest, sum);
  return fullest;
}

export const heatLayer: Builder<"heat"> = (draft, layer, to) => {
  const { heat } = draft.theme;
  const domain = range(layer.points);
  const span = domain ? domain[1] - domain[0] : 0;
  const features: Feature[] = layer.points.map((point) => {
    draft.reach(placeBox(draft, point.lon, point.lat));
    draft.listed.push({
      kind: "point",
      layer: layer.id,
      ...timeOf(point),
      at: [point.lon, point.lat],
      label: point.label,
      value: point.value,
      props: point.props,
      color: heat[heat.length - 1],
    });
    const weight =
      domain && span > 0 && point.value !== undefined
        ? LEAST_WEIGHT + ((1 - LEAST_WEIGHT) * (point.value - domain[0])) / span
        : domain && span > 0
          ? LEAST_WEIGHT
          : 1;
    return {
      type: "Feature",
      properties: { w: Math.round(weight * 1000) / 1000, ...stepOf(point) },
      geometry: { type: "Point", coordinates: [point.lon, point.lat] },
    };
  });
  if (!features.length) return { count: 0, swatch: "heat", ramp: heat };
  const fullest = fullestPlace(
    layer.points,
    features.map((item) => Number(item.properties?.w) || 0),
  );
  const each = Math.min(1, FULLEST / Math.max(fullest, FULLEST));
  const { base } = to;
  to.data(base, features);
  to.add(
    "overlay",
    {
      id: base,
      type: "heatmap",
      source: base,
      paint: {
        "heatmap-weight": ["get", "w"],
        "heatmap-intensity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          0,
          each,
          6,
          each * 2.5,
          12,
          each * 8,
        ],
        "heatmap-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          0,
          10,
          4,
          18,
          9,
          30,
          14,
          44,
        ],
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0,
          "rgba(0,0,0,0)",
          ...heat.flatMap((color, at) => [
            0.12 + (0.88 * at) / (heat.length - 1),
            color,
          ]),
        ],
        "heatmap-opacity": 0.78,
      },
    },
    { "heatmap-opacity": 0.78 },
  );
  return { count: features.length, swatch: "heat", ramp: heat };
};
