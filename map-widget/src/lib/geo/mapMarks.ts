import { MAP_LIMITS } from "~/lib/codemode/limits";
import {
  AREA_HEIGHT_MAX,
  FLOOR_METRES,
  MAP_MARKER_TONES,
  MAP_MARKERS,
  type MapFlow,
  type MapMarker,
  type MapMarkerTone,
  type MapPoint,
  type MapShape,
  type MapSign,
  type MapValue,
  type Marked,
  MEANING_CHARS,
} from "./mapMarkTypes";
import { placeOf, position } from "./mapPlaces";
import {
  count,
  fail,
  finite,
  isPlain,
  mapColor,
  numberOf,
  type Plain,
  shown,
  tagOf,
  text,
} from "./mapValues";
import { type MarkBudget, tooManyPoints, tooManyShapes, weigh } from "./markBudget";

const RANK = /^[1-9]\d?$/;

export function markerOf(value: unknown): MapMarker | undefined {
  if (value === true) return "pin";
  if (typeof value === "string") {
    if (MAP_MARKERS.includes(value as MapSign)) return value as MapSign;
    return RANK.test(value) ? Number(value) : undefined;
  }
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAP_LIMITS.markerRanks
    ? value
    : undefined;
}

export const markerToneOf = (value: unknown): MapMarkerTone | string | undefined =>
  MAP_MARKER_TONES.includes(value as MapMarkerTone)
    ? (value as MapMarkerTone)
    : mapColor(value);

function props(raw: unknown): Record<string, MapValue> | undefined {
  if (!isPlain(raw)) return undefined;
  const kept = new Map<string, MapValue>();
  for (const [key, value] of Object.entries(raw)) {
    if (kept.size >= MAP_LIMITS.props) break;
    const name = text(key, MAP_LIMITS.propNameChars);
    if (!name || name === "__proto__" || kept.has(name)) continue;
    if (typeof value === "string") {
      const shown = text(value, MAP_LIMITS.propValueChars);
      if (shown !== undefined) kept.set(name, shown);
    } else if (finite(value)) kept.set(name, value);
    else if (typeof value === "boolean") kept.set(name, value);
    else if (value === null) kept.set(name, null);
  }
  return kept.size ? Object.fromEntries(kept) : undefined;
}

export function marked(raw: Plain, budget: MarkBudget, isPoint = false): Marked {
  const label = text(raw.label, MAP_LIMITS.labelChars);
  const tag = tagOf(raw.tag, MAP_LIMITS.tagChars);
  const color = mapColor(raw.color);
  const other = props(raw.props);
  const marker = markerOf(raw.marker);
  const building = raw.highlight === "building";
  const highlight = raw.highlight === true || building;
  const tone =
    marker === undefined && !highlight ? undefined : markerToneOf(raw.markerColor);
  const meaning =
    marker === undefined && !highlight ? undefined : text(raw.meaning, MEANING_CHARS);
  const time = text(raw.time, MAP_LIMITS.frameChars);
  if (time !== undefined && !budget.frames.has(time)) {
    if (budget.frames.size >= MAP_LIMITS.frames)
      fail(
        `the map has more than ${MAP_LIMITS.frames} steps of time. A map that plays has at most ${MAP_LIMITS.frames}: aggregate the rows to fewer steps (a year in place of a month).`,
      );
    budget.frames.add(time);
  }
  const named = text(raw.category, MAP_LIMITS.categoryChars);
  const category =
    named !== undefined &&
    (budget.categories.has(named) || budget.categories.size < MAP_LIMITS.categories)
      ? named
      : undefined;
  if (category !== undefined) budget.categories.add(category);
  return {
    ...(label === undefined ? {} : { label }),
    ...(tag === undefined ? {} : { tag }),
    ...(finite(raw.value) ? { value: raw.value } : {}),
    ...(color === undefined ? {} : { color }),
    ...(category === undefined ? {} : { category }),
    ...(other === undefined ? {} : { props: other }),
    ...(marker === undefined ? {} : { marker }),
    ...(tone === undefined || tone === "accent" ? {} : { markerColor: tone }),
    ...(highlight
      ? { highlight: building && isPoint ? ("building" as const) : (true as const) }
      : {}),
    ...(meaning === undefined ? {} : { meaning }),
    ...(time === undefined ? {} : { time }),
  };
}

function point(raw: unknown, at: number, budget: MarkBudget): MapPoint | null {
  if (!isPlain(raw)) return fail(`point ${at + 1} is not an object.`);
  const place = placeOf(raw, `point ${at + 1}`, budget);
  if (!place) return null;
  const [lon, lat] = place;
  const size = raw.size;
  return {
    lat,
    lon,
    ...marked(raw, budget, true),
    ...(finite(size) && size >= 0 ? { size } : {}),
  };
}

export { point as readPoint, shape as readShape };

export function points(raw: readonly unknown[], budget: MarkBudget): MapPoint[] {
  budget.points -= raw.length;
  if (budget.points < 0) return tooManyPoints(MAP_LIMITS.points - budget.points);
  return raw.flatMap((item, at) => {
    const made = point(item, at, budget);
    return made ? [weigh(budget, "points", made)] : [];
  });
}

function heightOf(raw: Plain, budget: MarkBudget): number | undefined {
  const [height, floors] = [numberOf(raw.height), numberOf(raw.floors)];
  const metres =
    height !== undefined
      ? height
      : floors !== undefined
        ? floors * FLOOR_METRES
        : undefined;
  if (metres === undefined) {
    const written = text(raw.height, 24) ?? text(raw.floors, 24);
    if (written !== undefined) {
      budget.heights.unread++;
      budget.heights.example ??= written;
    }
    return undefined;
  }
  if (metres <= 0) return undefined;
  budget.heights.standing++;
  if (metres > AREA_HEIGHT_MAX) budget.heights.clamped++;
  return Math.round(Math.min(metres, AREA_HEIGHT_MAX) * 10) / 10;
}

function shape(raw: unknown, at: number, budget: MarkBudget): MapShape {
  if (!isPlain(raw)) return fail(`shape ${at + 1} is not an object.`);
  const what = `shape ${at + 1}`;
  const spend = (positions: number) => {
    budget.vertices -= positions;
    if (budget.vertices < 0)
      fail(
        `the lines and areas have more than ${count(MAP_LIMITS.vertices)} positions together. Simplify the shapes, or draw fewer.`,
      );
  };
  if (raw.type === "line") {
    if (!Array.isArray(raw.coordinates) || raw.coordinates.length < 2)
      return fail(`${what} is a line and needs two positions or more.`);
    spend(raw.coordinates.length);
    return {
      type: "line",
      coordinates: raw.coordinates.map((item) => position(item, what)),
      ...marked(raw, budget),
    };
  }
  if (raw.type === "polygon") {
    const rings = raw.coordinates;
    if (!Array.isArray(rings) || rings.length === 0)
      return fail(`${what} is an area and needs a ring of positions.`);
    const height = heightOf(raw, budget);
    if (rings.length > MAP_LIMITS.rings)
      return fail(
        `${what} has ${count(rings.length)} rings. An area has at most ${MAP_LIMITS.rings}.`,
      );
    return {
      type: "polygon",
      coordinates: rings.map((ring) => {
        if (!Array.isArray(ring) || ring.length < 3)
          return fail(`a ring of ${what} needs three positions or more.`);
        spend(ring.length);
        return ring.map((item) => position(item, what));
      }),
      ...marked(raw, budget),
      ...(height === undefined ? {} : { height }),
    };
  }
  return fail(
    `${what} has the type ${shown(raw.type)}. A shape is a "line" or a "polygon".`,
  );
}

export function shapes(raw: readonly unknown[], budget: MarkBudget): MapShape[] {
  budget.shapes -= raw.length;
  if (budget.shapes < 0) return tooManyShapes(MAP_LIMITS.shapes - budget.shapes);
  return raw.map((item, at) => weigh(budget, "shapes", shape(item, at, budget)));
}

function end(raw: unknown, what: string, budget: MarkBudget): [number, number] | null {
  if (Array.isArray(raw)) return position(raw, what);
  if (isPlain(raw)) return placeOf(raw, what, budget);
  return fail(
    `${what} is ${shown(raw)}. An end of a flow is { lat, lon }, { city }, { state } or { country }.`,
  );
}

export function flows(raw: readonly unknown[], budget: MarkBudget): MapFlow[] {
  budget.flows -= raw.length;
  if (budget.flows < 0)
    return fail(
      `the map has ${count(MAP_LIMITS.flows - budget.flows)} flows. A map draws at most ${count(MAP_LIMITS.flows)}: keep the largest, or aggregate them (table.groupBy).`,
    );
  return raw.flatMap((item, at) => {
    if (!isPlain(item)) return fail(`flow ${at + 1} is not an object.`);
    const from = end(item.from, `the start of flow ${at + 1}`, budget);
    const to = from && end(item.to, `the end of flow ${at + 1}`, budget);
    return from && to
      ? [weigh(budget, "flows", { from, to, ...marked(item, budget) })]
      : [];
  });
}
