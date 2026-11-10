import type { LayerSpecification } from "maplibre-gl";
import type { ShownLayer } from "~/lib/geo/mapLayers";
import {
  layerMarks,
  mapCategories,
  mapFrames,
  mapLayers,
  mapOpeningFrame,
  panelLayerName,
} from "~/lib/geo/mapLayers";
import { humanLabel } from "~/lib/geo/mapValues";
import { placeKey } from "./mapCrowd";
import { aboutUnitedStates, range } from "./mapGeometry";
import { sceneOpening } from "./mapOpeningScene";
import { type MapScale, type MapTheme, mapScale } from "./mapTheme";
import { baseLayers, hasTiles } from "./scene/base";
import { clustersLayer } from "./scene/clusters";
import { columnsLayer } from "./scene/columns";
import {
  type Builder,
  layerDraft,
  newDraft,
  type Scene,
  type SceneInput,
  type Tint,
} from "./scene/draft";
import { flowsLayer } from "./scene/flows";
import { heatLayer } from "./scene/heat";
import { imageLayer } from "./scene/image";
import { pointsLayer } from "./scene/points";
import { regionsLayer } from "./scene/regions";
import { shapesLayer } from "./scene/shapes";
import { sourceLayer } from "./scene/source";
import { humanTimes } from "./scene/times";
import type { SceneLayer } from "./sceneLayer";
import { NOT_LOADED } from "./sourceLayers";

const BUILDERS: { [K in ShownLayer["kind"]]: Builder<K> } = {
  regions: regionsLayer,
  points: pointsLayer,
  lines: shapesLayer,
  polygons: shapesLayer,
  heat: heatLayer,
  clusters: clustersLayer,
  flows: flowsLayer,
  columns: columnsLayer,
  source: sourceLayer,
  image: imageLayer,
};

const CATEGORY_KINDS: ReadonlySet<string> = new Set([
  "points",
  "clusters",
  "lines",
  "polygons",
  "columns",
]);

const SCALED_KINDS: ReadonlySet<string> = new Set([
  "regions",
  "points",
  "clusters",
  "lines",
  "polygons",
  "flows",
  "columns",
]);

function tints(
  layers: readonly ShownLayer[],
  theme: MapTheme,
  categories: ReadonlyMap<string, string>,
): Tint[] {
  const implicit = layers.filter((layer) => layer.implicit);
  const valued = (kinds: readonly string[]) =>
    implicit
      .filter((layer) => kinds.includes(layer.kind))
      .flatMap((layer) => layerMarks(layer));
  const groups = [["regions"], ["points"], ["polygons", "lines"]];
  const scaled = groups.find((kinds) => range(valued(kinds))) ?? groups[2];
  const domain = range(valued(scaled));
  const shared = domain ? mapScale(domain[0], domain[1], theme) : null;
  const measured = new Map<string, { domain: [number, number]; scale?: MapScale }>();
  for (const layer of layers) {
    if (layer.implicit || !layer.valueLabel || !SCALED_KINDS.has(layer.kind)) continue;
    const own = range(layerMarks(layer));
    if (!own) continue;
    const before = measured.get(layer.valueLabel);
    measured.set(layer.valueLabel, {
      domain: before
        ? [Math.min(before.domain[0], own[0]), Math.max(before.domain[1], own[1])]
        : own,
    });
  }
  let ramp = shared ? 1 : 0;
  let series = implicit.some((layer) => layer.kind !== "regions") ? 1 : 0;
  const hues = [theme.sequential, ...theme.ramps];
  return layers.map((layer) => {
    const regions =
      layer.kind === "regions" || (layer.kind === "columns" && !!layer.regions);
    let scale: MapScale | null = null;
    let color = regions ? theme.focus : theme.mark;
    if (layer.implicit) scale = scaled.includes(layer.kind) ? shared : null;
    else if (
      layer.kind !== "heat" &&
      layer.kind !== "source" &&
      layer.kind !== "image"
    ) {
      const own = range(layerMarks(layer));
      const same = layer.valueLabel ? measured.get(layer.valueLabel) : undefined;
      if (own && same) {
        same.scale ??= mapScale(same.domain[0], same.domain[1], {
          ...theme,
          sequential: hues[ramp++ % hues.length],
        });
        scale = same.scale;
      } else if (own)
        scale = mapScale(own[0], own[1], {
          ...theme,
          sequential: hues[ramp++ % hues.length],
        });
      else color = theme.series[series++ % theme.series.length];
    }
    const plain = color;
    return {
      scale,
      color,
      of: (mark) =>
        mark.color ??
        (mark.category === undefined ? undefined : categories.get(mark.category)) ??
        (scale && mark.value !== undefined ? scale.color(mark.value) : plain),
    };
  });
}

export function buildScene(input: SceneInput): Scene {
  const { spec, theme } = input;
  const shown = mapLayers(spec);
  const joints = new Set<string>();
  for (const layer of shown) {
    if (layer.kind === "lines")
      for (const shape of layer.shapes)
        if (shape.type === "line")
          for (const [lon, lat] of shape.coordinates) joints.add(placeKey(lon, lat));
    if (layer.kind === "flows")
      for (const flow of layer.flows) {
        joints.add(placeKey(flow.from[0], flow.from[1]));
        joints.add(placeKey(flow.to[0], flow.to[1]));
      }
  }
  const draft = newDraft(input, aboutUnitedStates(spec), hasTiles(input), joints);
  const categories = mapCategories(spec).map((name, at) => ({
    name,
    color: theme.categories[at % theme.categories.length],
  }));
  const palette = new Map(categories.map(({ name, color }) => [name, color]));
  const colours = tints(shown, theme, palette);
  const frames = mapFrames(spec);
  const layers = shown.map((layer, at): SceneLayer => {
    const tint = colours[at];
    const timed = layerMarks(layer).some((mark) => mark.time !== undefined);
    const to = layerDraft(draft, layer, timed);
    const build = BUILDERS[layer.kind] as Builder<typeof layer.kind>;
    const built = build(draft, layer, to, tint);
    const regions =
      layer.kind === "regions" || layer.kind === "columns" ? layer.regions : undefined;
    const marks = layerMarks(layer);
    const kinds =
      CATEGORY_KINDS.has(layer.kind) &&
      marks.length > 0 &&
      marks.every((mark) => mark.category !== undefined)
        ? [
            ...new Set(
              marks.map((mark) => palette.get(mark.category ?? "") ?? tint.color),
            ),
          ]
        : [];
    const own =
      !kinds.length &&
      CATEGORY_KINDS.has(layer.kind) &&
      marks.length > 0 &&
      marks.every((mark) => mark.color !== undefined)
        ? [...new Set(marks.map((mark) => mark.color ?? tint.color))]
        : [];
    return {
      id: layer.id,
      name: panelLayerName(layer, shown.length, spec.title),
      kind: layer.kind,
      ...(layer.group === undefined ? {} : { group: layer.group }),
      ...(layer.visible === false ? { visible: false } : {}),
      ...(layer.opacity === undefined ? {} : { opacity: layer.opacity }),
      parts: to.parts,
      ...(layer.valueLabel === undefined
        ? {}
        : { valueLabel: humanLabel(layer.valueLabel) }),
      ...(layer.sizeLabel === undefined
        ? {}
        : { sizeLabel: humanLabel(layer.sizeLabel) }),
      scale: kinds.length || own.length ? null : tint.scale,
      color: own.length === 1 ? own[0] : tint.color,
      ...(kinds.length ? { categories: kinds.slice(0, 4) } : {}),
      ...(own.length > 1 ? { colors: own.slice(0, 4) } : {}),
      ...built,
      ...(regions && draft.unloaded.has(regions.set) ? { note: NOT_LOADED } : {}),
    };
  });
  const keyed = new Set(
    shown
      .filter((layer) => CATEGORY_KINDS.has(layer.kind))
      .flatMap((layer) => layerMarks(layer).map((mark) => mark.category ?? "")),
  );
  const built = baseLayers(input, draft);
  const base = built;
  const { slots } = draft;
  humanTimes(draft.marks);
  humanTimes(draft.listed);
  return {
    sources: draft.sources,
    style: [
      ...base.under,
      ...slots.backdrop,
      ...slots.fill,
      ...slots.relief,
      ...base.borders,
      ...slots.line,
      ...slots.overlay,
      ...base.labels,
      ...slots.top,
    ],
    layers,
    ...((base.labels[0] ?? slots.top[0])
      ? { overlayBefore: (base.labels[0] ?? slots.top[0]).id }
      : {}),
    ...(slots.top[0] ? { marksBefore: slots.top[0].id } : {}),
    frames,
    categories: categories.filter(({ name }) => keyed.has(name)),
    ...(spec.categoryLabel === undefined
      ? {}
      : { categoryLabel: humanLabel(spec.categoryLabel) }),
    ...(frames.length ? { frame: mapOpeningFrame(spec, frames) } : {}),
    marks: draft.marks,
    listed: draft.listed,
    scale: layers.find((layer) => layer.scale)?.scale ?? null,
    unshaped: [...draft.unshaped],
    ambiguous: draft.ambiguous,
    refused: input.held?.refused ?? [],
    pictures: draft.pictures,
    pointer: draft.pointer,
    hover: draft.hover,
    timed: draft.timed,
    clustered: draft.clustered,
    glyphs: draft.glyphs,
    standing: draft.standing,
    buildings: draft.standing.length ? basemapBuildings(base.under) : [],
    origins: draft.origins,
    ...base.facts,
    ...sceneOpening(spec, draft, layers, shown, base),
  };
}

const FAINT_PAINT = ["fill-opacity", "fill-extrusion-opacity", "line-opacity"] as const;

function basemapBuildings(layers: readonly LayerSpecification[]): Scene["buildings"] {
  return layers.flatMap((layer) => {
    if (!layer.id.startsWith("context-buildings")) return [];
    const property = FAINT_PAINT.find((name) => name.startsWith(`${layer.type}-`));
    if (!property) return [];
    const full = ("paint" in layer ? (layer.paint as Record<string, unknown>) : {})?.[
      property
    ];
    if (full !== undefined && typeof full !== "number") return [];
    return [{ id: layer.id, property, full: typeof full === "number" ? full : 1 }];
  });
}
