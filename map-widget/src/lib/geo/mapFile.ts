import { MAP_LIMITS, megabytes } from "~/lib/codemode/limits";
import { base64Of, bytesOf } from "./base64";
import { type GeoFileOutcome, type GeoFileResult, parseGeoFile } from "./files";
import { fileAsks } from "./mapFileConvention";
import { flatInput } from "./mapFileFlat";
import { type Kind, legendOf, markOf, marksOf } from "./mapFileMarks";
import type { ParsedFiles } from "./mapFileReader";
import { type FileInput, type FileRoom, provideFileReader } from "./mapFileReader";
import { stepsOf, writtenSteps } from "./mapFileSteps";
import { count, fail, isPlain, text } from "./mapValues";

const FILE_FORM =
  '"file" must be { name, data } with the file as base64 text, or { name, text } with the text of a KML, GPX or GeoJSON file. The name says what the file is ("fields.kmz", "areas.zip" for a zipped shapefile). `value` names the number property that colours the marks on a scale, `height` the number property that says how high its areas stand in metres, `category` the text property that gives each of its values a colour, and `time` the property whose dates or periods are the steps of a map that plays (`true`: the time a KML file gives its placemarks).';

export function rootGroup(file: GeoFileResult): number | undefined {
  if (file.kind !== "kml" && file.kind !== "kmz") return undefined;
  const tops = file.groups.filter((group) => group.parent === undefined).length;
  return tops === 1 && file.groups[0]?.parent === undefined ? 0 : undefined;
}

function folderName(
  file: GeoFileResult,
  at: number | undefined,
  root: number | undefined,
): string | undefined {
  const names: string[] = [];
  for (let next = at, depth = 0; next !== undefined && depth < 8; depth++) {
    const group = file.groups[next];
    if (!group || next === root) break;
    names.unshift(group.name);
    next = group.parent;
  }
  return text(names.join(" / "), MAP_LIMITS.layerNameChars);
}

const KIND_NAMES: Record<Kind, string> = {
  points: "Points",
  lines: "Lines",
  polygons: "Areas",
};
const KINDS: readonly Kind[] = ["polygons", "lines", "points"];
const OTHER_FOLDERS = "Other";

export function fileInput(
  raw: unknown,
  room: FileRoom = { layers: MAP_LIMITS.layers },
  parsed?: ParsedFiles,
): FileInput {
  if (room.as) return flatInput(raw, room.as);
  if (!isPlain(raw)) return fail(FILE_FORM);
  const name = text(raw.name, MAP_LIMITS.titleChars);
  const given = typeof raw.data === "string" ? raw.data : raw.text;
  if (typeof given !== "string" || given.length === 0) return fail(FILE_FORM);
  if (given.length > MAP_LIMITS.fileChars)
    return fail(
      `the file is ${megabytes(given.length)} as text. A map reads a file of at most ${megabytes(MAP_LIMITS.fileChars)}, and this one is ${count(given.length - MAP_LIMITS.fileChars)} ${given.length - MAP_LIMITS.fileChars === 1 ? "character" : "characters"} over: simplify or split the file, or serve it from a backend as a map source (vector tiles).`,
    );
  const base64 = typeof raw.data === "string";
  const known = parsed?.get(given);
  let outcome: GeoFileOutcome;
  if (known && known.name === name && known.base64 === base64) outcome = known.outcome;
  else {
    const bytes = base64 ? bytesOf(given) : new TextEncoder().encode(given);
    if (!bytes) return fail('the "data" of the file is not base64 text.');
    outcome = parseGeoFile(bytes, name === undefined ? undefined : { name });
    parsed?.set(given, { name, base64, outcome });
  }
  if (outcome.error)
    return fail(
      `the file cannot be read: ${outcome.error.message}${outcome.error.code === "too-large" ? " Simplify or split the file, or serve it from a backend as a map source (vector tiles)." : ""}`,
    );
  const file = outcome.file;
  const valueKey = typeof raw.value === "string" ? raw.value : undefined;
  const asked = typeof raw.category === "string" ? raw.category : undefined;
  const valueLabel =
    valueKey === undefined ? undefined : text(raw.valueLabel, MAP_LIMITS.titleChars);
  const heightKey = typeof raw.height === "string" ? raw.height : undefined;
  const notes = [...file.notes];
  for (const key of [valueKey, asked]) {
    const column = file.columns.find(({ name }) => name === key);
    if (key !== undefined && !column)
      notes.push(
        `The file has no property "${key.slice(0, 60)}" to colour by. Its properties: ${
          file.columns
            .slice(0, 12)
            .map(({ name }) => name)
            .join(", ") || "none"
        }.`,
      );
    else if (key === valueKey && column?.kind === "text")
      notes.push(
        `The property "${key.slice(0, 60)}" is text, so \`value\` colours nothing by it: pass it as \`category\` and each of its values gets a colour.`,
      );
  }
  const asks = fileAsks(file.map);
  const categoryKey = asked ?? (asks.category ? "category" : undefined);
  const played =
    raw.time === undefined && asks.time
      ? writtenSteps(file, notes)
      : stepsOf(file, raw.time, notes);
  const root = rootGroup(file);
  const categories = new Set<string>();
  if (categoryKey !== undefined)
    for (const { properties } of file.features) {
      const category = text(properties[categoryKey], MAP_LIMITS.categoryChars);
      if (category !== undefined) categories.add(category);
    }
  if (categories.size > MAP_LIMITS.categories)
    notes.push(
      `The property "${categoryKey?.slice(0, 60)}" has ${categories.size} values: the first ${MAP_LIMITS.categories} have a colour of their own, the marks of the others the colour of their layer.`,
    );

  const folders = new Map<number | undefined, Record<Kind, unknown[]>>();
  const bucket = (group: number | undefined) => {
    let held = folders.get(group);
    if (!held) {
      held = { points: [], lines: [], polygons: [] };
      folders.set(group, held);
    }
    return held;
  };
  const top = bucket(undefined);
  const legends = new Map<
    number | undefined,
    { valueLabel?: string; sizeLabel?: string }
  >();
  for (const feature of file.features) {
    const group = feature.group === root ? undefined : feature.group;
    marksOf(
      feature.geometry,
      markOf(feature, valueKey, categoryKey, played, heightKey),
      bucket(group),
    );
    const legend = legends.get(group) ?? {};
    if (legend.valueLabel === undefined || legend.sizeLabel === undefined) {
      const said = legendOf(feature);
      legends.set(group, {
        valueLabel: legend.valueLabel ?? said.valueLabel,
        sizeLabel: legend.sizeLabel ?? said.sizeLabel,
      });
    }
  }

  const imageRoom = Math.min(MAP_LIMITS.images, room.layers);
  const images = file.overlays.slice(0, imageRoom).flatMap((overlay) => {
    const data = base64Of(overlay.image.bytes);
    if (data.length > MAP_LIMITS.imageChars) {
      notes.push(
        `The image "${overlay.name.slice(0, 60)}" is larger than a map holds and is not drawn.`,
      );
      return [];
    }
    return [
      {
        kind: "image",
        name: overlay.name,
        group: folderName(file, overlay.group, root),
        image: { mime: overlay.image.mime, data, corners: overlay.corners },
      },
    ];
  });
  if (file.overlays.length > imageRoom)
    notes.push(
      imageRoom < MAP_LIMITS.images
        ? `The file has ${file.overlays.length} ${file.overlays.length === 1 ? "image" : "images"} and ${imageRoom === 0 ? "none is" : `the first ${imageRoom} ${imageRoom === 1 ? "is" : "are"}`} drawn: the map has no room for more layers.`
        : `The file has ${file.overlays.length} images: the first ${MAP_LIMITS.images} are drawn.`,
    );

  const filled = [...folders].flatMap(([group, held]) => {
    const kinds = KINDS.filter((kind) => held[kind].length > 0);
    return group === undefined || kinds.length === 0 ? [] : [{ group, held, kinds }];
  });
  const layersOf = (
    held: Record<Kind, unknown[]>,
    kinds: readonly Kind[],
    folder: string | undefined,
    legend: { valueLabel?: string; sizeLabel?: string } = {},
  ) => {
    const switched = folder === undefined ? undefined : asks.layers?.get(folder);
    const values = valueLabel ?? legend.valueLabel;
    return kinds.map((kind) => ({
      kind,
      name: kinds.length > 1 ? KIND_NAMES[kind] : folder,
      group: folder,
      ...(values === undefined ? {} : { valueLabel: values }),
      ...(kind === "points" && legend.sizeLabel !== undefined
        ? { sizeLabel: legend.sizeLabel }
        : {}),
      ...(switched?.hidden ? { visible: false } : {}),
      ...(switched?.opacity === undefined ? {} : { opacity: switched.opacity }),
      ...(kind === "points" ? { points: held.points } : { shapes: held[kind] }),
    }));
  };
  const kindsFrom = (at: number) =>
    KINDS.filter((kind) => filled.slice(at).some(({ kinds }) => kinds.includes(kind)));
  const layers: unknown[] = [];
  const left = room.layers - images.length;
  let kept = 0;
  while (
    kept < filled.length &&
    layers.length + filled[kept].kinds.length + kindsFrom(kept + 1).length <= left
  ) {
    const { group, held, kinds } = filled[kept];
    layers.push(
      ...layersOf(held, kinds, folderName(file, group, root), legends.get(group)),
    );
    kept++;
  }
  if (kept < filled.length) {
    const others = filled.slice(kept);
    const together: Record<Kind, unknown[]> = { points: [], lines: [], polygons: [] };
    for (const { held } of others)
      for (const kind of KINDS) together[kind].push(...held[kind]);
    const kinds = kindsFrom(kept);
    const plural = (count: number) =>
      count === 1 ? "folder is a layer" : "folders are layers";
    if (layers.length + kinds.length <= left) {
      layers.push(...layersOf(together, kinds, OTHER_FOLDERS));
      notes.push(
        `The file has ${filled.length} folders and the map has room for ${left} more layers: ${kept} ${plural(kept)}, and the marks of the ${others.length} others are together under "${OTHER_FOLDERS}".`,
      );
    } else {
      for (const kind of KINDS) top[kind].push(...together[kind]);
      notes.push(
        `The file has ${filled.length} folders and the map has no room for more layers: their marks are drawn together, without a layer of their own.`,
      );
    }
  }
  const title = file.title ?? name?.replace(/\.[a-z0-9]{2,7}$/i, "");
  const outside = legends.get(undefined);
  return {
    points: top.points,
    shapes: [...top.polygons, ...top.lines],
    layers: [...images, ...layers],
    notes,
    ...(categories.size && asked !== undefined ? { categoryLabel: asked } : {}),
    ...(title ? { title } : {}),
    asks: {
      ...asks,
      ...(outside?.valueLabel === undefined ? {} : { valueLabel: outside.valueLabel }),
      ...(outside?.sizeLabel === undefined ? {} : { sizeLabel: outside.sizeLabel }),
    },
  };
}

provideFileReader(fileInput);
