import { isLight, MAP_THEMES } from "../mapTheme";
import type { Builder } from "./draft";
import { pointFeatures } from "./points";

const COUNT_FONT = ["Noto Sans Medium"];
export const CLUSTER_RADIUS = 40;
export const CLUSTER_MAX_ZOOM = 12;

export const clustersLayer: Builder<"clusters"> = (draft, layer, to, tint) => {
  const { theme } = draft;
  const features = pointFeatures(draft, layer.id, layer.points, tint);
  if (!features.length) return { count: 0, swatch: "circle" };
  const { base } = to;
  const color = tint.scale ? tint.scale.color(tint.scale.max) : tint.color;
  to.data(base, features, {
    cluster: true,
    clusterRadius: CLUSTER_RADIUS,
    clusterMaxZoom: CLUSTER_MAX_ZOOM,
    clusterProperties: { sum: ["+", ["coalesce", ["get", "value"], 0]] },
  });
  const circles = `${base}-clusters`;
  draft.slots.top.push(
    {
      id: circles,
      type: "circle",
      source: base,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": color,
        "circle-opacity": 0.88,
        "circle-radius": [
          "step",
          ["get", "point_count"],
          12,
          10,
          15,
          100,
          19,
          1000,
          24,
        ],
        "circle-stroke-color": theme.markStroke,
        "circle-stroke-width": 1.5,
      },
    },
    {
      id: `${base}-count`,
      type: "symbol",
      source: base,
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-font": COUNT_FONT,
        "text-size": 11,
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": isLight(color) ? MAP_THEMES.light.hover : MAP_THEMES.dark.hover,
      },
    },
  );
  to.parts.push(
    { id: circles, opacity: { "circle-opacity": 0.88, "circle-stroke-opacity": 1 } },
    { id: `${base}-count`, opacity: { "text-opacity": 1 } },
  );
  draft.glyphs = true;
  draft.slots.top.push({
    id: base,
    type: "circle",
    source: base,
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": ["get", "color"],
      "circle-radius": ["get", "r"],
      "circle-opacity": 0.92,
      "circle-stroke-color": theme.markStroke,
      "circle-stroke-width": 1.2,
    },
  });
  to.parts.push({
    id: base,
    opacity: { "circle-opacity": 0.92, "circle-stroke-opacity": 1 },
  });
  draft.pointer.push(base);
  to.add(
    "top",
    {
      id: `${base}-hover`,
      type: "circle",
      source: base,
      filter: ["==", ["get", "i"], -1],
      paint: {
        "circle-color": ["get", "color"],
        "circle-radius": ["+", ["get", "r"], 2],
        "circle-stroke-color": theme.hover,
        "circle-stroke-width": 2,
      },
    },
    {},
    { hover: true },
  );
  draft.clustered.push({
    layer: layer.id,
    source: base,
    circles,
    single: base,
    features,
    timed: layer.points.some((point) => point.time !== undefined),
  });
  return { count: features.length, swatch: "circle", color };
};
