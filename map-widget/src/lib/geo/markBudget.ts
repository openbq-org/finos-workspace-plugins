import { MAP_LIMITS, megabytes } from "~/lib/codemode/limits";
import { AREA_HEIGHT_MAX } from "./mapMarkTypes";
import type { NamedPlaces } from "./mapSpecTypes";
import { count, fail, isPlain } from "./mapValues";
import { type PlaceNeeds, placeFileWords } from "./placeFiles";
import { REGION_SET_WORDS } from "./regions/regionTypes";

export interface MarkBudget {
  points: number;
  regions: number;
  timedRegions: boolean;
  shapes: number;
  vertices: number;
  flows: number;
  images: number;
  pixels: number;
  frames: Set<string>;
  categories: Set<string>;
  unplaced: { count: number; examples: string[] };
  cities: {
    placed: number;
    unmatched: { count: number; examples: string[] };
    ambiguous: { count: number; examples: string[] };
    unloaded: number;
    renamed: { count: number; examples: string[] };
  };
  zips: {
    placed: number;
    unmatched: { count: number; examples: string[] };
    short: { count: number; examples: string[] };
    unloaded: number;
  };
  heights: { standing: number; clamped: number; unread: number; example?: string };
  codes: { names: number; short: Map<string, { as: string; rows: number }> };
  needs: PlaceNeeds;
  size: Record<SizedKind, number>;
}

const SIZED = {
  points: "its points",
  regions: "its regions",
  shapes: "its lines and areas",
  flows: "its flows",
  images: "its images",
} as const;
type SizedKind = keyof typeof SIZED;

const SMALLER: Record<SizedKind, string> = {
  points:
    "draw fewer points (aggregate the rows first: table.groupBy), or give each fewer or shorter values (`props`)",
  regions:
    "give each region fewer or shorter values (`props`), or draw fewer steps of time",
  shapes:
    "simplify the lines and areas (fewer positions), draw fewer, or give each fewer or shorter values",
  flows: "keep the largest flows, or give each fewer or shorter values",
  images: "use fewer or smaller images",
};

const ENVELOPE_CHARS = 512;

export const MAP_ROOM_CHARS = MAP_LIMITS.chars - ENVELOPE_CHARS;

export function checkSize(budget: MarkBudget, more = 0): void {
  const kinds = (Object.keys(SIZED) as SizedKind[])
    .filter((kind) => budget.size[kind] > 0)
    .sort((a, b) => budget.size[b] - budget.size[a]);
  const total = kinds.reduce((sum, kind) => sum + budget.size[kind], more);
  if (total <= MAP_ROOM_CHARS) return;
  const named = kinds.filter(
    (kind, at) => at === 0 || budget.size[kind] > MAP_LIMITS.chars / 20,
  );
  fail(
    `the map is over ${megabytes(MAP_LIMITS.chars)} as data (${named.map((kind) => `${SIZED[kind]} take ${megabytes(budget.size[kind])}`).join(", ")}). A map has at most ${megabytes(MAP_LIMITS.chars)}, all its layers and images together: ${SMALLER[kinds[0] ?? "points"]}.`,
  );
}

export function weigh<T>(budget: MarkBudget, kind: SizedKind, mark: T): T {
  budget.size[kind] += JSON.stringify(mark).length + 1;
  checkSize(budget);
  return mark;
}

export const sizeTaken = (budget: MarkBudget): number =>
  Object.values(budget.size).reduce((sum, chars) => sum + chars, 0);

export function charge(budget: MarkBudget, kind: "points" | "shapes", chars: number) {
  budget.size[kind] += chars;
}

export function weighImage(budget: MarkBudget, data: string): void {
  budget.size.images += data.length;
  checkSize(budget);
}

export const markBudget = (needs: PlaceNeeds = new Set()): MarkBudget => ({
  points: MAP_LIMITS.points,
  regions: MAP_LIMITS.regions,
  timedRegions: false,
  shapes: MAP_LIMITS.shapes,
  vertices: MAP_LIMITS.vertices,
  flows: MAP_LIMITS.flows,
  images: MAP_LIMITS.images,
  pixels: MAP_LIMITS.imagePixels,
  frames: new Set(),
  categories: new Set(),
  unplaced: { count: 0, examples: [] },
  cities: {
    placed: 0,
    unmatched: { count: 0, examples: [] },
    ambiguous: { count: 0, examples: [] },
    unloaded: 0,
    renamed: { count: 0, examples: [] },
  },
  zips: {
    placed: 0,
    unmatched: { count: 0, examples: [] },
    short: { count: 0, examples: [] },
    unloaded: 0,
  },
  heights: { standing: 0, clamped: 0, unread: 0 },
  codes: { names: 0, short: new Map() },
  needs,
  size: { points: 0, regions: 0, shapes: 0, flows: 0, images: 0 },
});

export function unplacedNote(budget: MarkBudget): string | undefined {
  const { count: left, examples } = budget.unplaced;
  if (left === 0) return undefined;
  const listed =
    left > examples.length ? `${examples.join(", ")}, ...` : `${examples.join(", ")}.`;
  return left === 1
    ? `1 point or flow names a state or a country that has no place on the map and is not drawn: ${listed}`
    : `${count(left)} points or flows name a state or a country that has no place on the map and are not drawn: ${listed}`;
}

const WORD_CODES = new Set(["NA", "NO", "ND", "NR", "IN", "OR", "ME", "HI", "OK"]);

export function noteCode(budget: MarkBudget, written: unknown, name: string): void {
  if (typeof written !== "string") return;
  const cell = written.trim();
  if (/^[A-Za-z]{2}$/.test(cell)) {
    if (!WORD_CODES.has(cell.toUpperCase())) return;
    const before = budget.codes.short.get(cell);
    if (before) before.rows++;
    else budget.codes.short.set(cell, { as: name, rows: 1 });
  } else if (/^\p{L}[\p{L}\s.'-]{3,}$/u.test(cell)) budget.codes.names++;
}

export function codeNotes(budget: MarkBudget): string[] {
  const { names, short } = budget.codes;
  const empty = [...short].filter(([cell]) => cell.toUpperCase() === "NA");
  const words = [...short].filter(([cell]) => cell.toUpperCase() !== "NA");
  const rows = (list: typeof words) =>
    list.reduce((sum, [, { rows }]) => sum + rows, 0);
  return [
    ...(empty.length
      ? [
          `${JSON.stringify(empty[0][0])} was read as ${empty[0][1].as} in ${count(rows(empty))} ${rows(empty) === 1 ? "row" : "rows"}. In an export of R or pandas it says that a cell has no value: leave such a cell empty.`,
        ]
      : []),
    ...(words.length && names > rows(words)
      ? [
          `In a column of names, ${count(rows(words))} ${rows(words) === 1 ? "cell" : "cells"} of two letters ${rows(words) === 1 ? "was" : "were"} read as ${rows(words) === 1 ? "a code" : "codes"}: ${words
            .slice(0, MAP_LIMITS.unmatchedShown)
            .map(([cell, { as }]) => `${JSON.stringify(cell)} as ${as}`)
            .join(
              ", ",
            )}. If one is a word or says that there is no value, leave the cell empty or write the name.`,
        ]
      : []),
  ];
}

export function heightNotes(budget: MarkBudget): string[] {
  const { standing, clamped, unread, example } = budget.heights;
  const most = `${count(AREA_HEIGHT_MAX)} m`;
  return [
    ...(clamped > 0
      ? [
          `${count(clamped)} ${clamped === 1 ? "area is" : "areas are"} drawn at ${most}, the most an area stands${
            clamped * 2 > standing
              ? ": most heights are over it, so they may not be in metres (a height is in metres: divide centimetres by 100, multiply feet by 0.3048)."
              : "."
          }`,
        ]
      : []),
    ...(unread > 0
      ? [
          `${count(unread)} ${unread === 1 ? "area has" : "areas have"} a height that is no number (${JSON.stringify(example)}) and ${unread === 1 ? "lies" : "lie"} flat: a height is a number of metres.`,
        ]
      : []),
  ];
}

export const CITIES_CREDIT = "Cities are placed by their name: GeoNames, CC BY 4.0.";

export const MAP_CREDITS = {
  geonames: {
    shown: "Cities: GeoNames, CC BY 4.0",
    file: "Cities are placed by their name: GeoNames (https://www.geonames.org), CC BY 4.0.",
    note: CITIES_CREDIT,
  },
} as const;
export type MapCreditId = keyof typeof MAP_CREDITS;
export const MAP_CREDIT_IDS = Object.keys(MAP_CREDITS) as MapCreditId[];

const WHAT_A_CITY_NEEDS =
  "Give such a row a latitude and a longitude (another widget can have them for the same rows: join by their id), or its country (and its state, in the United States) in a column of its own";

export function cityNotes(budget: MarkBudget): string[] {
  const { placed, unmatched, ambiguous, unloaded, renamed } = budget.cities;
  const listed = ({ count: left, examples }: { count: number; examples: string[] }) =>
    left > examples.length ? `${examples.join("; ")}; ...` : `${examples.join("; ")}.`;
  return [
    ...(unloaded > 0 ? [citiesNotLoaded(unloaded, budget.needs)] : []),
    ...(unmatched.count > 0
      ? [
          `${count(unmatched.count)} ${unmatched.count === 1 ? "city is" : "cities are"} not on the map (the app has no city of that name with 25,000 residents or more): ${listed(unmatched)}`,
        ]
      : []),
    ...(ambiguous.count > 0
      ? [
          `${count(ambiguous.count)} city ${ambiguous.count === 1 ? "name" : "names"} could be several cities and ${ambiguous.count === 1 ? "is" : "are"} not drawn: ${listed(ambiguous)}`,
        ]
      : []),
    ...(renamed.count > 0
      ? [
          `${count(renamed.count)} ${renamed.count === 1 ? "city is" : "cities are"} placed by another name of theirs: ${listed(renamed)}`,
        ]
      : []),
    ...(placed > 0 ? [CITIES_CREDIT] : []),
  ];
}

const keptCount = (value: unknown): number =>
  Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : 0;

export function namedPlaces(
  budget: MarkBudget,
  kept: unknown,
): NamedPlaces | undefined {
  const { cities, zips } = budget;
  const before = isPlain(kept) ? kept : {};
  const placed = cities.placed + zips.placed + keptCount(before.placed);
  const missing =
    cities.unmatched.count +
    cities.ambiguous.count +
    cities.unloaded +
    zips.unmatched.count +
    zips.short.count +
    zips.unloaded +
    keptCount(before.missing);
  return placed + missing > 0 ? { placed, missing } : undefined;
}

const WHAT_A_ZIP_NEEDS =
  'A ZIP code is five digits as text ("02134"), or ZIP+4. A number that lost its leading zeros is read as a ZIP code only in a column named as ZIP codes are (zip, zip_code, postal_code): name the column so, or write the code as text';

export function zipNotes(budget: MarkBudget): string[] {
  const { unmatched, short, unloaded } = budget.zips;
  const listed = ({ count: left, examples }: { count: number; examples: string[] }) =>
    left > examples.length ? `${examples.join(", ")}, ...` : `${examples.join(", ")}.`;
  return [
    ...(unloaded > 0
      ? [
          `The table of US ZIP codes could not be loaded: ${count(unloaded)} ${unloaded === 1 ? "row placed by its ZIP code is" : "rows placed by their ZIP code are"} not drawn. Try again.`,
        ]
      : []),
    ...(unmatched.count > 0
      ? [
          `${count(unmatched.count)} ${unmatched.count === 1 ? "ZIP code is" : "ZIP codes are"} not on the map (no area of the Census Bureau has that code: a post office box, one building, or no ZIP code): ${listed(unmatched)}`,
        ]
      : []),
    ...(short.count > 0
      ? [
          `${count(short.count)} ${short.count === 1 ? "value has" : "values have"} fewer than five digits and ${short.count === 1 ? "is" : "are"} not read as ZIP codes: ${listed(short)} Lost zeros are put back only in a column named zip, zip_code or postal_code: name it so, or write "02134" as text.`,
        ]
      : []),
  ];
}

export const noZipKnown = (budget: MarkBudget): never => {
  const { unmatched, short } = budget.zips;
  return fail(
    [
      "none of the points could be placed by its ZIP code.",
      ...(unmatched.count > 0
        ? [`No area has the code: ${unmatched.examples.join(", ")}.`]
        : []),
      ...(short.count > 0
        ? [`Fewer than five digits: ${short.examples.join(", ")}.`]
        : []),
      `${WHAT_A_ZIP_NEEDS}.`,
    ].join(" "),
  );
};

export const noZipLoaded = (budget: MarkBudget): never =>
  fail(
    `the table of US ZIP codes could not be loaded, and every point of the map is placed by its ZIP code (${count(budget.zips.unloaded)}): nothing can be drawn. Try again, or give a latitude and a longitude.`,
  );

const CITY_FILES = ["cities", "admin1"] as const;
const sentence = (text: string) => `${text[0].toUpperCase()}${text.slice(1)}`;

export const citiesNotLoaded = (rows: number, needs: PlaceNeeds): string =>
  `${sentence(placeFileWords(CITY_FILES.filter((file) => needs.has(file))))} could not be loaded: ${count(rows)} ${rows === 1 ? "row placed by its city is" : "rows placed by their city are"} not drawn. Try again.`;

const FEWER_SHAPES =
  "Aggregate them to regions the app has (plot.regions by state, county or country), keep the ones the question is about, or serve them as vector tiles from a map source of a backend (workspace.mapSources).";

export const tooManyShapes = (
  found: number,
  what = "the map",
  multi?: { features: number; parts: number },
): never =>
  fail(
    `${what} has ${count(found)} lines and areas${
      multi && multi.parts > multi.features
        ? `: each part of a MultiPolygon or a MultiLineString is one, and its ${count(multi.features)} features have ${count(multi.parts)} parts`
        : ""
    }. A map draws at most ${count(MAP_LIMITS.shapes)}. ${FEWER_SHAPES}`,
  );

export const tooManyPoints = (found: number): never =>
  fail(
    `the map has ${count(found)} points. A map draws at most ${count(MAP_LIMITS.points)}: aggregate the rows first (table.groupBy), or keep the largest.`,
  );

export const noCityLoaded = (budget: MarkBudget): never =>
  fail(
    `${placeFileWords(CITY_FILES.filter((file) => budget.needs.has(file)))} could not be loaded, and every point or flow of the map is placed by its city (${count(budget.cities.unloaded)}): nothing can be drawn. Try again, or give a latitude and a longitude.`,
  );

export const noCityKnown = (budget: MarkBudget): never => {
  const { unmatched, ambiguous } = budget.cities;
  return fail(
    [
      "none of the points or flows could be placed by its city.",
      ...(unmatched.count > 0
        ? [
            `No city of that name (25,000 residents or more): ${unmatched.examples.join("; ")}.`,
          ]
        : []),
      ...(ambiguous.count > 0
        ? [`Several cities of that name: ${ambiguous.examples.join("; ")}.`]
        : []),
      `${WHAT_A_CITY_NEEDS}. A street address is not a city: the data source turns addresses into coordinates.`,
    ].join(" "),
  );
};

export const noPlaceKnown = (budget: MarkBudget): never =>
  fail(
    `none of the ${count(budget.unplaced.count)} points or flows names a state or a country the app knows, for example ${budget.unplaced.examples.join(", ")}. A point is placed by \`state\` (${REGION_SET_WORDS["us-states"].forms}) or by \`country\` (${REGION_SET_WORDS.countries.forms}), or by a latitude and a longitude.`,
  );
