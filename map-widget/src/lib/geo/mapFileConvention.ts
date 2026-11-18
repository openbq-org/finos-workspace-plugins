import { MAP_LIMITS } from "~/lib/codemode/limits";
import { isAddress } from "./files/collectChecks";
import { MAP_MEMBER_CHARS, type MarkName } from "./files/convention";
import { MAP_BOUNDARY_IDS, type MapBoundaryId } from "./mapBoundaries";
import { contextIds, type MapContextId } from "./mapContext";
import { markerOf, markerToneOf } from "./mapMarks";
import { type MapOpening, mapOpening } from "./mapOpening";
import { finite, isPlain, mapColor, type Plain, text } from "./mapValues";
import { MAP_CREDIT_IDS, type MapCreditId } from "./markBudget";

export interface ConventionMark {
  mark: Plain;
  rest: Record<string, unknown>;
  layer?: string;
  valueLabel?: string;
  sizeLabel?: string;
}

const TAKEN: readonly MarkName[] = [
  "tag",
  "size",
  "marker",
  "markerColor",
  "highlight",
  "meaning",
  "color",
];

const scalar = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim()
    ? value
    : finite(value)
      ? String(value)
      : undefined;

const isTrue = (value: unknown) => value === true || value === "true";

export function conventionMark(properties: Record<string, unknown>): ConventionMark {
  const own = (name: MarkName) =>
    Object.hasOwn(properties, name) ? properties[name] : undefined;
  const mark: Plain = {};
  const tag = scalar(own("tag"));
  if (tag !== undefined) mark.tag = tag;
  const size = own("size");
  if (finite(size) && size >= 0) mark.size = size;
  const marker = markerOf(own("marker") === true ? undefined : own("marker"));
  if (marker !== undefined) mark.marker = marker;
  const highlight = own("highlight");
  if (highlight === "building" || isTrue(highlight))
    mark.highlight = highlight === "building" ? "building" : true;
  if (mark.marker !== undefined || mark.highlight !== undefined) {
    const tone = markerToneOf(own("markerColor"));
    if (tone !== undefined) mark.markerColor = tone;
    const meaning = scalar(own("meaning"));
    if (meaning !== undefined) mark.meaning = meaning;
  }
  const color = mapColor(own("color"));
  if (color !== undefined) mark.color = color;
  const rest: Record<string, unknown> = {};
  for (const key of Object.keys(properties)) {
    if (key === "layer" || key === "valueLabel" || key === "sizeLabel") continue;
    if ((TAKEN as readonly string[]).includes(key) && mark[key] !== undefined) continue;
    rest[key] = properties[key];
  }
  const note = scalar(own("note"));
  if (mark.tag === undefined && note !== undefined) mark.tag = note;
  const layer = text(own("layer"), MAP_LIMITS.layerNameChars);
  const valueLabel = text(own("valueLabel"), MAP_LIMITS.titleChars);
  const sizeLabel = text(own("sizeLabel"), MAP_LIMITS.titleChars);
  return {
    mark,
    rest,
    ...(layer === undefined || isAddress(layer) ? {} : { layer }),
    ...(valueLabel === undefined ? {} : { valueLabel }),
    ...(sizeLabel === undefined ? {} : { sizeLabel }),
  };
}

export interface FileAsks {
  credits?: MapCreditId[];
  notes?: string[];
  time?: true;
  category?: true;
  frame?: string;
  categoryLabel?: string;
  valueLabel?: string;
  sizeLabel?: string;
  layers?: Map<string, { hidden?: true; opacity?: number }>;
  view?: MapOpening;
  context?: MapContextId[];
  boundaries?: MapBoundaryId[];
  basemap?: Plain | string;
  pitch?: number;
}

const BACKDROPS = ["standard", "plain"];

function backdrop(raw: unknown): Plain | string | undefined {
  if (typeof raw === "string") return BACKDROPS.includes(raw) ? raw : undefined;
  if (!isPlain(raw)) return undefined;
  const asked: Plain = {};
  if (typeof raw.choice === "string" && BACKDROPS.includes(raw.choice))
    asked.choice = raw.choice;
  for (const part of ["names", "roads", "borders"])
    if (raw[part] === false) asked[part] = false;
  return Object.keys(asked).length ? asked : undefined;
}

function opening(raw: unknown): MapOpening | undefined {
  if (!isPlain(raw) || raw.place !== undefined) return undefined;
  try {
    return mapOpening(raw);
  } catch {
    return undefined;
  }
}

export function fileAsks(member: Record<string, unknown> | undefined): FileAsks {
  if (!member) return {};
  const asks: FileAsks = {};
  const list = (raw: unknown, most: number): unknown[] =>
    Array.isArray(raw) ? raw.slice(0, most) : [];
  const credits = MAP_CREDIT_IDS.filter((id) =>
    list(member.credits, MAP_CREDIT_IDS.length * 2).includes(id),
  );
  if (credits.length) asks.credits = credits;
  const notes = list(member.notes, MAP_LIMITS.mapNotes).flatMap((note) => {
    const line =
      typeof note === "string" && note.length <= MAP_MEMBER_CHARS
        ? text(note, MAP_LIMITS.mapNoteChars)
        : undefined;
    return line === undefined || isAddress(line) ? [] : [line];
  });
  if (notes.length) asks.notes = notes;
  if (member.time === true) asks.time = true;
  if (member.category === true) asks.category = true;
  const frame = text(member.frame, MAP_LIMITS.frameChars);
  if (frame !== undefined) asks.frame = frame;
  const categoryLabel = text(member.categoryLabel, MAP_LIMITS.titleChars);
  if (categoryLabel !== undefined && !isAddress(categoryLabel))
    asks.categoryLabel = categoryLabel;
  const layers = new Map<string, { hidden?: true; opacity?: number }>();
  for (const layer of list(member.layers, MAP_LIMITS.layers * 2)) {
    if (!isPlain(layer)) continue;
    const name = text(layer.name, MAP_LIMITS.layerNameChars);
    if (name === undefined) continue;
    const opacity = layer.opacity;
    layers.set(name, {
      ...(layer.hidden === true ? { hidden: true as const } : {}),
      ...(finite(opacity) && opacity >= 0 && opacity < 1 ? { opacity } : {}),
    });
  }
  if (layers.size) asks.layers = layers;
  const view = opening(member.view);
  if (view !== undefined) asks.view = view;
  const context = contextIds(member.context);
  if (context.length) asks.context = context;
  const wanted = new Set(list(member.boundaries, MAP_BOUNDARY_IDS.length * 2));
  const boundaries = MAP_BOUNDARY_IDS.filter((id) => wanted.has(id));
  if (boundaries.length) asks.boundaries = boundaries;
  const basemap = backdrop(member.basemap);
  if (basemap !== undefined) asks.basemap = basemap;
  const pitch = member.pitch;
  if (finite(pitch) && pitch > 0 && pitch <= MAP_LIMITS.pitch) asks.pitch = pitch;
  return asks;
}

export const flatNote = (layers: number): string =>
  `The marks of the ${layers} layers of the file are drawn together: it was given under a key that reads a file without its layers. Give it as { file: { name, text } } (a KMZ file: { name, data }) to keep them.`;
