import type { Feature, Geometry } from "geojson";
import type { ExpressionSpecification } from "maplibre-gl";
import type { MapRegion, MapRegions } from "~/lib/geo/mapMarkTypes";
import { regionKey } from "~/lib/geo/mapNotes";
import type { MapBounds } from "~/lib/geo/mapSummary";
import { regionCandidate } from "~/lib/geo/regionFacts";
import { boundsOf } from "~/lib/geo/regions/boundaries";
import { regionOf } from "~/lib/geo/regions/codes";
import {
  grow,
  middle,
  SMALL_REGION_DEGREES,
  SMALL_REGION_DOTS,
  SMALL_REGION_PIXELS,
} from "../mapGeometry";
import {
  type Builder,
  type Draft,
  emphasisOf,
  type RegionShapeSource,
  stepOf,
  timeOf,
} from "./draft";

export const SMALL_REGION_SHARE = 25;
const MARKED_CROWD = 60;

export interface ShapedRegion {
  item: MapRegion;
  shape: Feature<Geometry, { code: string; name: string }>;
  box: MapBounds | null;
  centre: [number, number] | null;
}

export function shapedRegions(
  draft: Draft,
  regions: MapRegions,
  boundaries: RegionShapeSource | undefined,
): ShapedRegion[] {
  const found: ShapedRegion[] = [];
  if (draft.unloaded.has(regions.set)) return found;
  const said = new Set<string>();
  const placed = new Set<string>();
  const shaded = new Set<string>();
  for (const item of regions.items) {
    const match = boundaries?.resolve
      ? boundaries.resolve(item.code, regions.within)
      : { id: item.code };
    if (match && "ambiguous" in match) {
      if (!said.has(item.code))
        draft.ambiguous.push({
          set: regions.set,
          code: item.label ?? item.code,
          candidates: match.ambiguous.map((id) =>
            regionCandidate(regions.set, boundaries?.info?.(id)?.name ?? id, id),
          ),
        });
      said.add(item.code);
      continue;
    }
    const id = match && "id" in match ? match.id : null;
    const known =
      id === null ? null : (boundaries?.info?.(id) ?? regionOf(regions.set, id));
    const shape = id === null ? undefined : boundaries?.shapeOf(id);
    if (!shape) {
      draft.unshaped.add(item.label ?? known?.name ?? item.code);
      continue;
    }
    const once = `${shape.properties.code}\n${item.time ?? ""}`;
    if (shaded.has(once)) continue;
    shaded.add(once);
    const box = boundsOf(shape, draft.unwrap);
    if (!placed.has(shape.properties.code)) draft.reach(box);
    placed.add(shape.properties.code);
    found.push({
      item,
      shape,
      box,
      centre: known?.centre ?? middle(boundsOf(shape, false)),
    });
  }
  return found;
}

export const regionsLayer: Builder<"regions"> = (draft, layer, to, tint) => {
  const { theme } = draft;
  const boundaries = draft.sets[layer.regions.set];
  const shaded: Feature[] = [];
  const small: Feature[] = [];
  const dotted = new Set<string>();
  const spans: number[] = [];
  const codes: string[] = [];
  let extent: MapBounds | null = null;
  for (const { item, shape, box, centre } of shapedRegions(
    draft,
    layer.regions,
    boundaries,
  )) {
    const index = draft.marks.length;
    const color =
      item.color ??
      (item.value !== undefined && tint.scale
        ? tint.scale.color(item.value)
        : tint.color);
    const emphasis = emphasisOf(draft, item);
    shaded.push({
      ...shape,
      id: index,
      properties: {
        i: index,
        fill: color,
        m: emphasis.tone ? 1 : 0,
        ...(emphasis.tone ? { mc: emphasis.tone } : {}),
        ...(emphasis.highlight ? { h: 1 } : {}),
        ...stepOf(item),
      },
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
      ...emphasis,
    });
    const span = box ? Math.max(box[2] - box[0], box[3] - box[1]) : 0;
    extent = grow(extent, box);
    if (centre && span > 0 && span < SMALL_REGION_DEGREES) {
      spans.push(span);
      codes.push(shape.properties.code);
      small.push({
        type: "Feature",
        id: index,
        properties: {
          i: index,
          fill: color,
          z: Math.log2((SMALL_REGION_PIXELS * 360) / (256 * span)),
          ...stepOf(item),
        },
        geometry: { type: "Point", coordinates: centre },
      });
    }
  }
  if (!shaded.length) return { count: 0, swatch: "fill" };
  const reach = extent ? Math.max(extent[2] - extent[0], extent[3] - extent[1]) : 0;
  for (let at = small.length - 1; at >= 0; at--) {
    if (spans[at] * SMALL_REGION_SHARE >= reach) small.splice(at, 1);
    else dotted.add(codes[at]);
  }
  const dense = dotted.size > SMALL_REGION_DOTS;

  const { base } = to;
  to.data(base, shaded);
  to.add(
    "fill",
    {
      id: base,
      type: "fill",
      source: base,
      paint: {
        "fill-color": ["get", "fill"],
        "fill-opacity": draft.translucent ? 0.74 : 1,
      },
    },
    { "fill-opacity": draft.translucent ? 0.74 : 1 },
    { pointer: true },
  );
  if (boundaries?.outer && boundaries.borders) {
    const mesh = layer.implicit ? "county-borders" : `${base}-mesh`;
    draft.sources[mesh] = { type: "geojson", data: boundaries.borders, tolerance: 0.2 };
    draft.slots.fill.push({
      id: mesh,
      type: "line",
      source: mesh,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": theme.innerBorder, "line-width": 0.3 },
    });
    to.parts.push({ id: mesh, opacity: { "line-opacity": 1 } });
  }
  to.add(
    "line",
    {
      id: `${base}-outline`,
      type: "line",
      source: base,
      layout: { "line-join": "round" },
      paint: {
        "line-color": theme.shaded,
        "line-width": dense ? ["interpolate", ["linear"], ["zoom"], 4, 0.15, 7, 1] : 1,
      },
    },
    { "line-opacity": 1 },
  );
  const width: ExpressionSpecification = ["case", ["==", ["get", "h"], 1], 3.6, 2.4];
  const crowd =
    dense && shaded.filter((shape) => shape.properties?.m === 1).length > MARKED_CROWD;
  to.add(
    "line",
    {
      id: `${base}-marked`,
      type: "line",
      source: base,
      filter: ["==", ["get", "m"], 1],
      layout: { "line-join": "round" },
      paint: {
        "line-color": ["get", "mc"],
        "line-width": crowd
          ? ["interpolate", ["linear"], ["zoom"], 4, 0.3, 8, width]
          : width,
      },
    },
    { "line-opacity": 1 },
  );
  if (small.length && dotted.size <= SMALL_REGION_DOTS) {
    to.data(`${base}-small`, small);
    to.add(
      "line",
      {
        id: `${base}-small`,
        type: "circle",
        source: `${base}-small`,
        filter: ["<", ["zoom"], ["get", "z"]],
        paint: {
          "circle-color": ["get", "fill"],
          "circle-radius": 5,
          "circle-stroke-color": theme.shaded,
          "circle-stroke-width": 1.5,
        },
      },
      { "circle-opacity": 1, "circle-stroke-opacity": 1 },
      { pointer: true },
    );
  }
  to.add(
    "line",
    {
      id: `${base}-hover`,
      type: "line",
      source: base,
      filter: ["==", ["get", "i"], -1],
      paint: { "line-color": theme.hover, "line-width": 1.6 },
    },
    {},
    { hover: true },
  );
  return { count: shaded.length, swatch: "fill" };
};
