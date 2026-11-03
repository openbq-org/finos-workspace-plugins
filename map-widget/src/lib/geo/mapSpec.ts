import { MAP_LIMITS } from "~/lib/codemode/limits";
import { geoJsonInput, type MapInput } from "./geoJson";
import { basemapAsked, boundariesAsked } from "./mapAsks";
import { mapContext } from "./mapContext";
import type { FileAsks } from "./mapFileConvention";
import { fitFiles, noMarkFits } from "./mapFileFit";
import { type FileInput, readMapFile } from "./mapFileReader";
import {
  layerHeads,
  layerMarks,
  layerOf,
  type MapLayer,
  mapFrames,
  sourceId,
} from "./mapLayers";
import { points, shapes } from "./mapMarks";
import { opensSomewhere, readOpening } from "./mapOpening";
import { regions } from "./mapRegionMarks";
import { declaredSources, depthOf, openingFrame, withoutMarks } from "./mapSpecParts";
import type { MakeOptions, MapSpec } from "./mapSpecTypes";
import { mapSummary } from "./mapSummary";
import { FLAT_NOTE, mapPitch, tooWideToTilt } from "./mapTilt";
import { fail, heading, isPlain, listOf, text } from "./mapValues";
import {
  checkSize,
  cityNotes,
  codeNotes,
  heightNotes,
  MAP_CREDIT_IDS,
  MAP_CREDITS,
  markBudget,
  namedPlaces,
  noCityKnown,
  noCityLoaded,
  noPlaceKnown,
  noZipKnown,
  noZipLoaded,
  unplacedNote,
  zipNotes,
} from "./markBudget";

export const MAP_RAW_INPUTS = ["geojson", "kml", "kmz", "file"] as const;

export function makeMap(raw: unknown, options: MakeOptions = {}): MapSpec {
  return reduced(raw, true, options);
}

export function mapSpec(raw: unknown): MapSpec {
  return reduced(raw, false);
}

const GEOJSON_TYPES = new Set([
  "FeatureCollection",
  "Feature",
  "GeometryCollection",
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
]);
const bareGeoJson = (raw: Record<string, unknown>): boolean =>
  typeof raw.type === "string" &&
  GEOJSON_TYPES.has(raw.type) &&
  ["features", "geometry", "coordinates", "geometries"].some((key) =>
    Object.hasOwn(raw, key),
  );

function reduced(raw: unknown, making: boolean, options: MakeOptions = {}): MapSpec {
  if (Array.isArray(raw))
    return fail(
      'it was given a list (rows), not a map. Rows go through a map helper first, and the rows of plot.mark go to the helper that draws them, with `marks: true`: output.map(plot.regions(plot.mark(rows, { top: 5, by: "value" }), { county: "fips", value: "value", marks: true }), { name: "Map" }).',
    );
  if (!isPlain(raw))
    return fail(
      "it needs a map: { points: [{ lat, lon, label, tag }], regions: { set, items }, shapes: [...] }. The plot helpers return one: plot.points, plot.regions.",
    );
  if (depthOf(raw) > MAP_LIMITS.depth)
    return fail(`the map is nested more than ${MAP_LIMITS.depth} levels deep.`);
  const written = MAP_RAW_INPUTS.find((key) => raw[key] !== undefined);
  if (!making && written !== undefined)
    return fail(
      `a map that was made holds no "${written}": a file, GeoJSON, KML or KMZ is read into marks where the map is made (output.map in the code of a run, the data of a Map widget). A map that is stored, shared, in an answer or drawn is the reduced map, and this one is not.`,
    );
  const flat = (value: unknown, as: "kml" | "kmz") =>
    !making || value === undefined ? null : readMapFile(value, { layers: 0, as });
  const geojson =
    making && raw.geojson !== undefined
      ? geoJsonInput(raw.geojson, options.geojson)
      : null;
  const read: (MapInput | FileInput | null)[] = [
    geojson,
    flat(raw.kml, "kml"),
    flat(raw.kmz, "kmz"),
  ];
  const given = listOf(raw.layers, "layers");
  const file =
    !making || raw.file === undefined
      ? null
      : readMapFile(
          labelled(raw.file, raw.valueLabel),
          { layers: Math.max(0, MAP_LIMITS.layers - given.length) },
          options.parsed,
        );
  const fromFile = file?.layers ?? [];
  const asks: FileAsks =
    [geojson, read[1], read[2], file].find((input) => input?.asks)?.asks ?? {};
  const own = [...fromFile, ...given];
  const sourceNotes: string[] = [];
  const heads = layerHeads(
    options.sources?.length
      ? [...own, ...declaredSources(options.sources, own, sourceNotes)]
      : own,
  );
  const budget = markBudget(options.needs);
  const marks = points(
    [...listOf(raw.points, "points"), ...(geojson?.points ?? [])],
    budget,
  );
  const drawn = shapes(
    [...listOf(raw.shapes, "shapes"), ...(geojson?.shapes ?? [])],
    budget,
  );
  const shaded =
    raw.regions === undefined || raw.regions === null
      ? undefined
      : regions(raw.regions, budget);
  const more: (MapLayer | null)[] = heads.map((head, at) =>
    at < fromFile.length ? null : layerOf(head, budget),
  );
  const files = [read[1], read[2], file].flatMap((input) => (input ? [input] : []));
  const fitted = fitFiles(files, heads.slice(0, fromFile.length), budget);
  marks.push(...fitted.points);
  drawn.push(...fitted.shapes);
  fitted.layers.forEach((layer, at) => {
    more[at] = layer;
  });
  const { fit } = fitted;
  const layered = more.flatMap((layer) => (layer ? [layer] : []));
  const viewPitch = isPlain(raw.view) ? raw.view.pitch : undefined;
  const asked = mapPitch(
    raw.pitch ??
      asks.pitch ??
      (typeof viewPitch === "number" && viewPitch > 0 && viewPitch <= MAP_LIMITS.pitch
        ? viewPitch
        : undefined),
  );
  const wide =
    Boolean(asked) &&
    !layered.some((layer) => layer.kind === "columns") &&
    tooWideToTilt(
      mapSummary({
        points: marks,
        ...(shaded ? { regions: shaded } : {}),
        shapes: drawn,
        ...(layered.length ? { layers: layered } : {}),
      }).bounds,
    );
  const { view, note: unresolved } = readOpening(
    raw.view ?? asks.view,
    making,
    budget.needs,
  );
  const asksNotes: string[] = [];
  if (isPlain(raw.basemap) && raw.basemap.source !== undefined)
    sourceId(raw.basemap.source, "the basemap");
  const backdrop = basemapAsked(raw.basemap ?? asks.basemap, asksNotes);
  const boundaries = boundariesAsked(raw.boundaries ?? asks.boundaries, asksNotes);
  const opening = opensSomewhere(view);
  const pitch = wide && !opening ? undefined : asked;
  const notes = [
    ...(unresolved ? [unresolved] : []),
    ...(wide && !opening ? [FLAT_NOTE] : []),
    unplacedNote(budget),
    ...codeNotes(budget),
    ...cityNotes(budget),
    ...zipNotes(budget),
    ...heightNotes(budget),
    fit.note,
    ...fitted.notes,
    ...sourceNotes,
    ...asksNotes,
    ...listOf(raw.notes, "notes"),
    ...read.flatMap((input) => (input && "notes" in input ? (input.notes ?? []) : [])),
    ...(file?.notes ?? []),
    ...(asks.notes ?? []),
  ]
    .flatMap((note) => text(note, MAP_LIMITS.mapNoteChars) ?? [])
    .slice(0, MAP_LIMITS.mapNotes);
  const had = [...listOf(raw.credits, "credits"), ...(asks.credits ?? [])];
  const said = listOf(raw.notes, "notes");
  const credits = MAP_CREDIT_IDS.filter(
    (id) =>
      had.includes(id) ||
      said.includes(MAP_CREDITS[id].note) ||
      (id === "geonames" && budget.cities.placed > 0),
  );
  const byName = namedPlaces(budget, raw.byName);
  if (
    marks.length === 0 &&
    drawn.length === 0 &&
    !shaded?.items.length &&
    layered.every(
      (item) =>
        item.kind !== "source" &&
        item.kind !== "image" &&
        layerMarks(item).length === 0,
    )
  )
    return budget.cities.unmatched.count + budget.cities.ambiguous.count > 0
      ? noCityKnown(budget)
      : budget.cities.unloaded > 0
        ? noCityLoaded(budget)
        : budget.zips.unmatched.count + budget.zips.short.count > 0
          ? noZipKnown(budget)
          : budget.zips.unloaded > 0
            ? noZipLoaded(budget)
            : budget.unplaced.count > 0
              ? noPlaceKnown(budget)
              : fit.given > 0
                ? noMarkFits(fit)
                : fail(
                    bareGeoJson(raw)
                      ? `it was given a GeoJSON ${String(raw.type)} as the map, and a map has no "features" or "coordinates" of its own: pass it under its key, output.map({ geojson: <the GeoJSON> }, { name }), or draw rows that carry their shape with plot.areas(rows, { geometry: "<column>" }).`
                      : "the map is empty. Give it points (plot.points), regions (plot.regions), shapes or layers with marks.",
                  );
  const title = [raw.title, ...read.map((input) => input?.title), file?.title]
    .map((name) => heading(name, MAP_LIMITS.titleChars))
    .find((name) => name !== undefined);
  const valueLabel = heading(raw.valueLabel ?? asks.valueLabel, MAP_LIMITS.titleChars);
  const sizeLabel = heading(raw.sizeLabel ?? asks.sizeLabel, MAP_LIMITS.titleChars);
  const categoryLabel =
    text(raw.categoryLabel, MAP_LIMITS.titleChars) ??
    text(file?.categoryLabel, MAP_LIMITS.titleChars) ??
    asks.categoryLabel;
  const context = mapContext(raw.context ?? asks.context);
  const result: MapSpec = {
    ...(title === undefined ? {} : { title }),
    ...(valueLabel === undefined ? {} : { valueLabel }),
    ...(sizeLabel !== undefined && marks.some((mark) => mark.size !== undefined)
      ? { sizeLabel }
      : {}),
    points: marks,
    ...(shaded ? { regions: shaded } : {}),
    shapes: drawn,
    ...(layered.length ? { layers: layered } : {}),
    ...(backdrop ? { basemap: backdrop } : {}),
    ...(context.length ? { context } : {}),
    ...(boundaries.length ? { boundaries } : {}),
    ...(pitch ? { pitch } : {}),
    ...(view ? { view } : {}),
    ...(categoryLabel !== undefined && budget.categories.size ? { categoryLabel } : {}),
    ...(notes.length ? { notes } : {}),
    ...(credits.length ? { credits } : {}),
    ...(byName ? { byName } : {}),
  };
  const frame = openingFrame(
    raw.frame ??
      (asks.frame !== undefined && mapFrames(result).includes(asks.frame)
        ? asks.frame
        : undefined),
    result,
  );
  const map = frame === undefined ? result : { ...result, frame };
  checkSize(budget, JSON.stringify(map, withoutMarks).length);
  reducedMaps.add(map);
  return map;
}

const labelled = (file: unknown, valueLabel: unknown): unknown =>
  isPlain(file) && file.valueLabel === undefined && typeof valueLabel === "string"
    ? { ...file, valueLabel }
    : file;

const reducedMaps = new WeakSet<object>();

export const isReducedMap = (value: unknown): value is MapSpec =>
  typeof value === "object" && value !== null && reducedMaps.has(value);
