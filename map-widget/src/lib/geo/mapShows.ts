import { mapAsks, viewOver } from "./mapAsks";
import { mapBoundary } from "./mapBoundaries";
import { contextOn } from "./mapContext";
import { marksInView } from "./mapInView";
import {
  layerMarks,
  layerName,
  type MapLayerKind,
  mapFrames,
  mapLayers,
  mapOpeningFrame,
  type ShownLayer,
} from "./mapLayers";
import type { MapPoint, Marked } from "./mapMarkTypes";
import type { MapSpec } from "./mapSpecTypes";
import { humanLabel } from "./mapValues";
import { layerVisible, type MapCamera, type MapViewState } from "./mapViewState";
import {
  type ReaderSwitched,
  type ReaderView,
  readerSwitched,
  readerView,
} from "./readerView";
import type { City, CityIndex } from "./regions/cities";
import { matchCountry, matchState, regionOf } from "./regions/codes";

export const MAP_SHOWS = {
  chars: 4_000,
  layers: 6,
  extremes: 3,
  categories: 8,
  places: 5,
  card: 8,
  columns: 12,
  layersOff: 12,
  textChars: 60,
  titleChars: 120,
  frameChars: 24,
  placeChars: 40,
  cityKm: 25,
  nearKm: 120,
  placed: 5_000,
} as const;

export interface MapScale {
  by: string;
  min: number;
  max: number;
}

export interface MapShowsLayer {
  name: string;
  kind: MapLayerKind;
  marks: number;
  in_view?: number;
  colour?: MapScale;
  size?: MapScale;
  colour_categories?: {
    by?: string;
    of: { name: string; marks: number }[];
    more?: number;
  };
  ranked_by?: string;
  largest?: { name: string; value: number }[];
  smallest?: { name: string; value: number }[];
}

export interface MapShows {
  drawn: string;
  title?: string;
  where?: string;
  view?: ReaderView;
  layers: MapShowsLayer[];
  more_layers?: number;
  layers_off?: string[];
  frames?: { count: number; first: string; last: string; on: string };
  switched?: ReaderSwitched;
  boundaries?: string[];
  context?: string[];
  card?: string[];
  not_on_map?: string[];
  notes?: string[];
}

const cut = (text: string, chars: number = MAP_SHOWS.textChars) =>
  text.length > chars ? `${text.slice(0, chars - 3)}...` : text;

const figure = (value: number) => Number(value.toPrecision(6));

const counted = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

const NOUNS: Record<MapLayerKind, [string, string]> = {
  regions: ["region", "regions"],
  points: ["point", "points"],
  heat: ["point", "points"],
  clusters: ["point", "points"],
  columns: ["column", "columns"],
  lines: ["line", "lines"],
  polygons: ["area", "areas"],
  flows: ["flow", "flows"],
  source: ["mark", "marks"],
  image: ["mark", "marks"],
};

type Mark = Marked & { code?: string; lat?: number; lon?: number; size?: number };

function markName(mark: Mark, set: string | undefined): string {
  const named =
    mark.label ??
    (mark.code === undefined ? undefined : regionOf(set, mark.code)?.name) ??
    mark.tag ??
    mark.code;
  if (named !== undefined) return cut(String(named));
  return mark.lat !== undefined && mark.lon !== undefined
    ? `${mark.lat.toFixed(2)}, ${mark.lon.toFixed(2)}`
    : "unnamed";
}

function scaleOf(
  marks: readonly Mark[],
  read: (mark: Mark) => number | undefined,
): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const mark of marks) {
    const value = read(mark);
    if (value === undefined || !Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return min <= max ? { min: figure(min), max: figure(max) } : null;
}

function extremes(
  marks: readonly Mark[],
  read: (mark: Mark) => number | undefined,
  set: string | undefined,
): Pick<MapShowsLayer, "largest" | "smallest"> {
  const top: { mark: Mark; value: number }[] = [];
  const bottom: { mark: Mark; value: number }[] = [];
  const keep = (
    list: { mark: Mark; value: number }[],
    entry: { mark: Mark; value: number },
    before: (a: number, b: number) => boolean,
  ) => {
    let at = list.length;
    while (at > 0 && before(entry.value, list[at - 1].value)) at--;
    if (at >= MAP_SHOWS.extremes) return;
    list.splice(at, 0, entry);
    if (list.length > MAP_SHOWS.extremes) list.pop();
  };
  let valued = 0;
  for (const mark of marks) {
    const value = read(mark);
    if (value === undefined || !Number.isFinite(value)) continue;
    valued++;
    keep(top, { mark, value }, (a, b) => a > b);
    keep(bottom, { mark, value }, (a, b) => a < b);
  }
  if (valued < 2) return {};
  const named = (list: { mark: Mark; value: number }[]) =>
    list.map(({ mark, value }) => ({
      name: markName(mark, set),
      value: figure(value),
    }));
  return valued <= MAP_SHOWS.extremes
    ? { largest: named(top) }
    : { largest: named(top), smallest: named(bottom) };
}

const grids = new WeakMap<CityIndex, Map<string, City[]>>();
function gridOf(cities: CityIndex): Map<string, City[]> {
  let grid = grids.get(cities);
  if (!grid) {
    grid = new Map();
    for (const city of cities.largest(cities.size)) {
      const key = `${Math.floor(city.lon)},${Math.floor(city.lat)}`;
      const cell = grid.get(key);
      if (cell) cell.push(city);
      else grid.set(key, [city]);
    }
    grids.set(cities, grid);
  }
  return grid;
}

const RADIANS = Math.PI / 180;
function nearKm(lon: number, lat: number, city: City): number {
  const x = (city.lon - lon) * Math.cos(((lat + city.lat) / 2) * RADIANS);
  const y = city.lat - lat;
  return Math.sqrt(x * x + y * y) * 111.32;
}

function nearestCity(
  grid: Map<string, City[]>,
  lon: number,
  lat: number,
): { city: City; km: number; chief: City | null } | null {
  const tall = Math.ceil(MAP_SHOWS.nearKm / 111.32);
  const wide = Math.min(
    8,
    Math.ceil(MAP_SHOWS.nearKm / (111.32 * Math.max(0.05, Math.cos(lat * RADIANS)))),
  );
  let best: { city: City; km: number } | null = null;
  let chief: City | null = null;
  for (let dx = -wide; dx <= wide; dx++)
    for (let dy = -tall; dy <= tall; dy++) {
      const cell = grid.get(`${Math.floor(lon) + dx},${Math.floor(lat) + dy}`);
      if (!cell) continue;
      for (const city of cell) {
        const km = nearKm(lon, lat, city);
        if (km <= MAP_SHOWS.nearKm && (!best || km < best.km)) best = { city, km };
        if (km <= MAP_SHOWS.cityKm && (!chief || city.population > chief.population))
          chief = city;
      }
    }
  return best ? { ...best, chief } : null;
}

const tally = (counts: Map<string, number>, key: string) =>
  counts.set(key, (counts.get(key) ?? 0) + 1);

function listed(counts: Map<string, number>, noun: [string, string]): string {
  const ordered = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const shown = ordered
    .slice(0, MAP_SHOWS.places)
    .map(
      ([name, count]) =>
        `${cut(name, MAP_SHOWS.placeChars)} ${count.toLocaleString("en-US")}`,
    )
    .join(", ");
  const more = ordered.length - MAP_SHOWS.places;
  return more > 0
    ? `${shown} and ${counted(more, `more ${noun[0]}`, `more ${noun[1]}`)}`
    : shown;
}

function placesOf(
  layers: readonly { layer: ShownLayer; marks: readonly Mark[] }[],
  cities: CityIndex | null,
  notes: string[],
): string | undefined {
  const states = new Map<string, number>();
  const countries = new Map<string, number>();
  const towns = new Map<string, number>();
  const points: Mark[] = [];
  for (const { layer, marks } of layers) {
    const set =
      layer.kind === "regions" || layer.kind === "columns"
        ? layer.regions?.set
        : undefined;
    for (const mark of marks) {
      if (mark.lat !== undefined && mark.lon !== undefined) points.push(mark);
      else if (mark.code !== undefined && set === "us-states") {
        const name = regionOf(set, mark.code)?.name;
        if (name) tally(states, name);
      } else if (mark.code !== undefined && set === "countries") {
        const name = regionOf(set, mark.code)?.name;
        if (name) tally(countries, name);
      }
    }
  }
  let unplaced = 0;
  let sampled = 0;
  if (points.length && cities) {
    const grid = gridOf(cities);
    const step = Math.max(1, Math.ceil(points.length / MAP_SHOWS.placed));
    for (let at = 0; at < points.length; at += step) {
      const { lon, lat } = points[at] as { lon: number; lat: number };
      sampled++;
      const near = nearestCity(grid, lon, lat);
      if (!near) {
        unplaced++;
        continue;
      }
      const { city, chief } = near;
      const state = city.state ? matchState(city.state)?.name : undefined;
      if (state) tally(states, state);
      tally(countries, matchCountry(city.country)?.name ?? city.country);
      if (chief) tally(towns, chief.name);
    }
    if (step > 1)
      notes.push(
        `Places are counted on a sample of ${counted(sampled, "point")} of ${points.length.toLocaleString("en-US")}.`,
      );
  } else if (points.length)
    notes.push(
      "The places of the points are not known: the list of cities of the app is not loaded. Read their rows for a place.",
    );
  if (!states.size && !countries.size) return undefined;
  const parts: string[] = [];
  const onlyUs = countries.size <= 1 && states.size > 0;
  if (states.size)
    parts.push(
      `${counted(states.size, "US state")}: ${listed(states, ["state", "states"])}`,
    );
  if (!onlyUs && countries.size)
    parts.push(
      `${counted(countries.size, "country", "countries")}: ${listed(countries, ["country", "countries"])}`,
    );
  if (towns.size) parts.push(`cities: ${listed(towns, ["city", "cities"])}`);
  if (unplaced)
    parts.push(
      `${counted(unplaced, "point")} not within ${MAP_SHOWS.nearKm} km of a listed city`,
    );
  return `${parts.join("; ")}${points.length && cities ? " (points by the nearest listed city)" : ""}`;
}

function cardFields(
  layers: readonly { layer: ShownLayer; marks: readonly Mark[] }[],
  categoryLabel: string | undefined,
  valueColumn: string | undefined,
): string[] {
  const fields: string[] = [];
  const add = (field: string | undefined) => {
    const text = field === undefined ? undefined : cut(field);
    if (text !== undefined && !fields.includes(text) && fields.length < MAP_SHOWS.card)
      fields.push(text);
  };
  for (const { layer, marks } of layers) {
    const sample = marks.slice(0, 20);
    if (sample.some((mark) => mark.label !== undefined)) add("name");
    if (sample.some((mark) => mark.value !== undefined))
      add(humanLabel(layer.valueLabel ?? valueColumn) ?? "Value");
    if (sample.some((mark) => mark.size !== undefined))
      add(humanLabel(layer.sizeLabel) ?? "Size");
    if (sample.some((mark) => mark.category !== undefined))
      add(humanLabel(categoryLabel) ?? "Category");
    if (sample.some((mark) => mark.tag !== undefined)) add("tag");
    for (const mark of sample)
      for (const key of Object.keys(mark.props ?? {})) add(humanLabel(key));
  }
  return fields;
}

export interface MapShowsOptions {
  view?: MapViewState;
  camera?: MapCamera;
  cities: CityIndex | null;
  columns?: { all: readonly string[]; drawn: readonly string[] };
  valueColumn?: string;
}

function drawnLayers(spec: MapSpec, state: MapViewState) {
  const frames = mapFrames(spec);
  const frame = frames.length
    ? state.frame !== undefined && frames.includes(state.frame)
      ? state.frame
      : mapOpeningFrame(spec, frames)
    : undefined;
  const all = mapLayers(spec).filter(
    (layer) => layer.kind !== "source" && layer.kind !== "image",
  );
  const on = all.filter((layer) => layerVisible(layer, state));
  const off = all.filter((layer) => !layerVisible(layer, state));
  const drawn = on.map((layer) => ({
    layer,
    marks: (layerMarks(layer) as readonly Mark[]).filter(
      (mark) => mark.time === undefined || mark.time === frame,
    ),
  }));
  return { frames, frame, off, drawn };
}

function pointsInView(
  drawn: ReturnType<typeof drawnLayers>["drawn"],
  camera: MapShowsOptions["camera"],
) {
  const box =
    camera?.box?.length === 4 && camera.box.every(Number.isFinite)
      ? camera.box
      : undefined;
  let inside = 0;
  let of = 0;
  const seenOf = drawn.map(({ marks }) => {
    const points = marks.filter(
      (mark) => mark.lat !== undefined && mark.lon !== undefined,
    ) as MapPoint[];
    const seen = box
      ? marksInView({ points, layers: [] }, box, camera?.zoom)
      : undefined;
    inside += seen?.inside ?? 0;
    of += seen?.of ?? 0;
    return seen;
  });
  const words =
    box && of
      ? `${inside.toLocaleString("en-US")} of ${counted(of, "point")}`
      : undefined;
  return { seenOf, words };
}

export function mapReader(
  spec: MapSpec,
  options: Pick<MapShowsOptions, "view" | "camera" | "cities">,
): { view?: ReaderView; switched?: ReaderSwitched } {
  const reader = options.view ?? {};
  const view = options.camera
    ? readerView(
        spec,
        options.camera,
        options.cities,
        pointsInView(
          drawnLayers(spec, viewOver(mapAsks(spec), reader)).drawn,
          options.camera,
        ).words,
      )
    : undefined;
  const switched = readerSwitched(spec, reader);
  return { ...(view ? { view } : {}), ...(switched ? { switched } : {}) };
}

export function mapShows(spec: MapSpec, options: MapShowsOptions): MapShows {
  const state = viewOver(mapAsks(spec), options.view ?? {});
  const notes: string[] = [];
  const { frames, frame, off, drawn } = drawnLayers(spec, state);
  const { seenOf, words: inView } = pointsInView(drawn, options.camera);
  const layers: MapShowsLayer[] = drawn
    .slice(0, MAP_SHOWS.layers)
    .map(({ layer, marks }, at) => {
      const set =
        layer.kind === "regions" || layer.kind === "columns"
          ? layer.regions?.set
          : undefined;
      const seen = seenOf[at];
      const colour = scaleOf(marks, (mark) => mark.value);
      const size = scaleOf(marks, (mark) => mark.size);
      const valueWords = cut(
        humanLabel(layer.valueLabel ?? options.valueColumn) ?? "value",
      );
      const sizeWords = cut(humanLabel(layer.sizeLabel) ?? "size");
      const categories = new Map<string, number>();
      for (const mark of marks)
        if (mark.category !== undefined) tally(categories, mark.category);
      const ordered = [...categories].sort(
        (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
      );
      const ranked = colour
        ? { by: valueWords, read: (mark: Mark) => mark.value }
        : size
          ? { by: sizeWords, read: (mark: Mark) => mark.size }
          : null;
      return {
        name: cut(layerName(layer)),
        kind: layer.kind,
        marks: marks.length,
        ...(seen ? { in_view: seen.inside } : {}),
        ...(colour ? { colour: { by: valueWords, ...colour } } : {}),
        ...(size && !(colour && sizeWords === valueWords)
          ? { size: { by: sizeWords, ...size } }
          : {}),
        ...(ordered.length
          ? {
              colour_categories: {
                ...(spec.categoryLabel
                  ? { by: cut(humanLabel(spec.categoryLabel)) }
                  : {}),
                of: ordered
                  .slice(0, MAP_SHOWS.categories)
                  .map(([name, count]) => ({ name: cut(name), marks: count })),
                ...(ordered.length > MAP_SHOWS.categories
                  ? { more: ordered.length - MAP_SHOWS.categories }
                  : {}),
              },
            }
          : {}),
        ...(ranked
          ? { ranked_by: ranked.by, ...extremes(marks, ranked.read, set) }
          : {}),
      };
    });
  const totals = new Map<string, { noun: readonly [string, string]; count: number }>();
  for (const { layer, marks } of drawn) {
    const noun = NOUNS[layer.kind];
    const known = totals.get(noun[1]);
    if (known) known.count += marks.length;
    else totals.set(noun[1], { noun, count: marks.length });
  }
  const words = [...totals.values()]
    .filter(({ count }) => count > 0)
    .map(({ noun, count }) => counted(count, noun[0], noun[1]));
  if (state.inside?.length)
    notes.push(
      "A shape its reader drew filters the marks that are shown: the counts are of all marks.",
    );
  const where = placesOf(drawn, options.cities, notes);
  const view = readerView(spec, options.camera, options.cities, inView);
  const switched = readerSwitched(spec, options.view ?? {});
  const boundaries = (state.boundaries ?? []).map((id) => mapBoundary(id).label);
  const context = [...contextOn(spec.context, state.basemap)];
  const card = cardFields(drawn, spec.categoryLabel, options.valueColumn);
  const used = new Set(options.columns?.drawn ?? []);
  const unused = (options.columns?.all ?? []).filter((name) => !used.has(name));
  return {
    drawn: words.length ? words.join(", ") : "no mark",
    ...(spec.title ? { title: cut(spec.title, MAP_SHOWS.titleChars) } : {}),
    ...(where ? { where } : {}),
    ...(view ? { view } : {}),
    layers,
    ...(drawn.length > MAP_SHOWS.layers
      ? { more_layers: drawn.length - MAP_SHOWS.layers }
      : {}),
    ...(off.length
      ? {
          layers_off: off
            .slice(0, MAP_SHOWS.layersOff)
            .map((layer) => cut(layerName(layer))),
        }
      : {}),
    ...(frames.length && frame !== undefined
      ? {
          frames: {
            count: frames.length,
            first: cut(frames[0], MAP_SHOWS.frameChars),
            last: cut(frames[frames.length - 1], MAP_SHOWS.frameChars),
            on: cut(frame, MAP_SHOWS.frameChars),
          },
        }
      : {}),
    ...(switched ? { switched } : {}),
    ...(boundaries.length ? { boundaries } : {}),
    ...(context.length ? { context } : {}),
    ...(card.length ? { card } : {}),
    ...(unused.length
      ? {
          not_on_map: unused
            .slice(0, MAP_SHOWS.columns)
            .map((name) => cut(name))
            .concat(
              unused.length > MAP_SHOWS.columns
                ? [`and ${unused.length - MAP_SHOWS.columns} more`]
                : [],
            ),
        }
      : {}),
    ...(notes.length ? { notes } : {}),
  };
}

export function mapShowsText(shows: MapShows): string {
  let text = JSON.stringify(shows);
  if (text.length <= MAP_SHOWS.chars) return text;
  const layers = shows.layers.map((layer) => ({ ...layer }));
  let more = shows.more_layers ?? 0;
  const write = () =>
    JSON.stringify({
      ...shows,
      layers,
      ...(more ? { more_layers: more } : {}),
    });
  for (const key of ["smallest", "largest", "colour_categories"] as const)
    for (let at = layers.length - 1; at >= 0; at--) {
      if (layers[at][key] === undefined) continue;
      delete layers[at][key];
      text = write();
      if (text.length <= MAP_SHOWS.chars) return text;
    }
  while (layers.length > 1) {
    layers.pop();
    more++;
    text = write();
    if (text.length <= MAP_SHOWS.chars) return text;
  }
  const { where: _where, card: _card, not_on_map: _columns, ...least } = shows;
  return JSON.stringify({ ...least, layers, ...(more ? { more_layers: more } : {}) });
}
