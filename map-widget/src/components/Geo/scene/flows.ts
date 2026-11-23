import type { Feature } from "geojson";
import type { MapFlow } from "~/lib/geo/mapMarkTypes";
import { range } from "../mapGeometry";
import { type Builder, emphasisOf, GLOWING, glowOf, stepOf, timeOf } from "./draft";

export const ARC_POSITIONS = 24;
const BEND = 0.2;
const MAX_CLASSES = 12;
const GLOW_WIDTH = 5;
const END_SHARE = 0.5;
const END_MORE = 1.6;

const DEG = Math.PI / 180;
const mercator = (lat: number) =>
  Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * DEG) / 2)) / DEG;
const latitude = (y: number) => (2 * Math.atan(Math.exp(y * DEG)) - Math.PI / 2) / DEG;

export function arc(
  from: readonly [number, number],
  to: readonly [number, number],
  positions = ARC_POSITIONS,
): [number, number][] {
  const ax = from[0];
  const ay = mercator(from[1]);
  const bx = to[0] - ax > 180 ? to[0] - 360 : to[0] - ax < -180 ? to[0] + 360 : to[0];
  const by = mercator(to[1]);
  const cx = (ax + bx) / 2 + (by - ay) * BEND;
  const cy = (ay + by) / 2 - (bx - ax) * BEND;
  return Array.from({ length: positions }, (_, at) => {
    const t = at / (positions - 1);
    const u = 1 - t;
    return [
      u * u * ax + 2 * u * t * cx + t * t * bx,
      latitude(u * u * ay + 2 * u * t * cy + t * t * by),
    ];
  });
}

const faint = (hex: string, alpha: number) => {
  const full =
    hex.length === 4
      ? [...hex.slice(1)].map((digit) => digit + digit).join("")
      : hex.slice(1);
  const [r, g, b] = [0, 2, 4].map((at) => Number.parseInt(full.slice(at, at + 2), 16));
  return `rgba(${r},${g},${b},${alpha})`;
};

export const flowsLayer: Builder<"flows"> = (draft, layer, to, tint) => {
  const flows = layer.flows;
  if (!flows.length) return { count: 0, swatch: "arc" };
  const domain = range(flows);
  const span = domain ? domain[1] - domain[0] : 0;
  const widest = flows.length > 500 ? 3 : flows.length > 100 ? 4.5 : 6;
  const opacity = flows.length > 500 ? 0.55 : flows.length > 100 ? 0.7 : 0.9;
  const outline = flows.length > 500 ? 0 : 0.8;
  const widthOf = (flow: MapFlow) =>
    domain && flow.value !== undefined
      ? 1.2 +
        (widest - 1.2) * Math.sqrt(span > 0 ? (flow.value - domain[0]) / span : 0.5)
      : domain
        ? 1.2
        : Math.min(2.5, widest / 2);
  const stops = tint.scale?.stops ?? [];
  const classes: string[] = [...stops];
  const classOf = (flow: MapFlow): number => {
    if (flow.color === undefined && tint.scale && flow.value !== undefined) {
      const { min, max } = tint.scale;
      const t = max > min ? (flow.value - min) / (max - min) : 0.6;
      return Math.round(Math.min(1, Math.max(0, t)) * (stops.length - 1));
    }
    const color = flow.color ?? tint.color;
    let at = classes.indexOf(color);
    if (at < 0 && classes.length < MAX_CLASSES) at = classes.push(color) - 1;
    if (at < 0) {
      at = classes.indexOf(tint.color);
      if (at < 0) at = 0;
    }
    return at;
  };

  const order = flows
    .map((flow, at) => ({ flow, at }))
    .sort((a, b) => (a.flow.value ?? 0) - (b.flow.value ?? 0));
  const arcs: Feature[] = [];
  const ends: Feature[] = [];
  const first = draft.marks.length;
  for (const flow of flows)
    draft.marks.push({
      kind: "flow",
      layer: layer.id,
      ...timeOf(flow),
      at: null,
      label: flow.label,
      tag: flow.tag,
      value: flow.value,
      props: flow.props,
      color: tint.color,
      ...emphasisOf(draft, flow),
    });
  for (const { flow, at } of order) {
    const index = first + at;
    const line = arc(flow.from, flow.to);
    const group = classOf(flow);
    const width = Math.round(widthOf(flow) * 10) / 10;
    const mark = draft.marks[index];
    mark.color = classes[group];
    mark.at = line[Math.floor(line.length / 2)];
    mark.reach = Math.max(
      width * END_SHARE + END_MORE + outline,
      (width + (flow.highlight ? GLOW_WIDTH : 0)) / 2,
    );
    let [west, south, east, north] = [line[0][0], line[0][1], line[0][0], line[0][1]];
    for (const [lon, lat] of line) {
      west = Math.min(west, lon);
      east = Math.max(east, lon);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
    draft.reach(
      draft.unwrap && west > 0
        ? [west - 360, south, east - 360, north]
        : [west, south, east, north],
    );
    const properties = { i: index, c: group, w: width, ...stepOf(flow) };
    arcs.push({
      type: "Feature",
      id: index,
      properties: { ...properties, ...glowOf(draft, flow) },
      geometry: { type: "LineString", coordinates: line },
    });
    ends.push({
      type: "Feature",
      id: index,
      properties: { ...properties, color: classes[group] },
      geometry: { type: "Point", coordinates: line[line.length - 1] },
    });
  }

  const { base } = to;
  to.data(base, arcs, { lineMetrics: true });
  if (flows.some((flow) => flow.highlight))
    to.add(
      "top",
      {
        id: `${base}-highlight`,
        type: "line",
        source: base,
        filter: GLOWING,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "hc"],
          "line-width": ["+", ["get", "w"], GLOW_WIDTH],
          "line-opacity": 0.5,
        },
      },
      { "line-opacity": 0.5 },
    );
  classes.forEach((color, group) => {
    if (!arcs.some((feature) => feature.properties?.c === group)) return;
    to.add(
      "top",
      {
        id: `${base}-${group}`,
        type: "line",
        source: base,
        filter: ["==", ["get", "c"], group],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-width": ["get", "w"],
          "line-opacity": opacity,
          "line-gradient": [
            "interpolate",
            ["linear"],
            ["line-progress"],
            0,
            faint(color, 0.12),
            1,
            color,
          ],
        },
      },
      { "line-opacity": opacity },
      { pointer: true },
    );
  });
  to.data(`${base}-ends`, ends);
  to.add(
    "top",
    {
      id: `${base}-ends`,
      type: "circle",
      source: `${base}-ends`,
      paint: {
        "circle-color": ["get", "color"],
        "circle-radius": ["+", ["*", ["get", "w"], END_SHARE], END_MORE],
        "circle-opacity": opacity,
        "circle-stroke-color": draft.theme.markStroke,
        "circle-stroke-width": outline,
      },
    },
    { "circle-opacity": opacity, "circle-stroke-opacity": opacity },
    { pointer: true },
  );
  to.add(
    "top",
    {
      id: `${base}-hover`,
      type: "line",
      source: base,
      filter: ["==", ["get", "i"], -1],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": draft.theme.hover,
        "line-width": ["+", ["get", "w"], 1.5],
      },
    },
    {},
    { hover: true },
  );
  return { count: flows.length, swatch: "arc" };
};
