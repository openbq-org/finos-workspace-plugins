import { namesZip } from "~/lib/utils/displayNumber";
import type { ParsedFiles } from "./mapFileReader";
import { MAP_MARKERS } from "./mapMarkTypes";
import { makeMap } from "./mapSpec";
import type { MapSpec } from "./mapSpecTypes";
import { isPlain, numberOf, type Plain } from "./mapValues";
import type { PlaceFile, PlaceNeeds } from "./placeFiles";

export interface MapColumns {
  lat?: string;
  lon?: string;
  city?: string;
  zip?: string;
  state?: string;
  county?: string;
  country?: string;
  province?: string;
  metro?: string;
  district?: string;
  keepZero?: true;
  within?: string;
  time?: string;
  as?: "points" | "regions";
  value?: string;
  label?: string;
  tag?: string;
  marker?: string;
  size?: string;
  color?: string;
  category?: string;
  height?: string;
  props?: string[];
  valueLabel?: string;
  title?: string;
}

const name = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 && value.length <= 200
    ? value
    : undefined;

const COLUMN_KEYS = [
  "lat",
  "lon",
  "city",
  "zip",
  "state",
  "county",
  "country",
  "province",
  "metro",
  "district",
  "time",
  "value",
  "label",
  "tag",
  "marker",
  "size",
  "color",
  "category",
] as const;

export function mapColumns(raw: unknown): MapColumns | null {
  if (!isPlain(raw)) return null;
  const columns: MapColumns = {};
  for (const key of COLUMN_KEYS) {
    const column = name(raw[key]);
    if (column !== undefined) columns[key] = column;
  }
  if (Array.isArray(raw.props))
    columns.props = raw.props.flatMap((item) => name(item) ?? []).slice(0, 12);
  if (raw.as === "points" || raw.as === "regions") columns.as = raw.as;
  if (raw.keepZero === true) columns.keepZero = true;
  const valueLabel = name(raw.valueLabel);
  if (valueLabel !== undefined) columns.valueLabel = valueLabel;
  const title = name(raw.title);
  if (title !== undefined) columns.title = title;
  const within = name(raw.within);
  if (within !== undefined && within.length <= 80) columns.within = within;
  const placed =
    (columns.lat !== undefined && columns.lon !== undefined) ||
    columns.city !== undefined ||
    columns.zip !== undefined ||
    REGION_COLUMNS.some(([key]) => columns[key] !== undefined);
  return placed ? columns : null;
}

const REGION_COLUMNS = [
  ["state", "us-states"],
  ["county", "us-counties"],
  ["country", "countries"],
  ["province", "admin1"],
  ["metro", "us-cbsa"],
  ["district", "us-cd119"],
] as const;

const cellOf = (row: Plain, column: string | undefined): unknown =>
  column !== undefined && Object.hasOwn(row, column) ? row[column] : undefined;

const filled = (cell: unknown) => cell !== undefined && cell !== null && cell !== "";

const categoryOf = (cell: unknown): string | undefined =>
  !filled(cell) || typeof cell === "object" ? undefined : String(cell);

function markOf(row: Plain, columns: MapColumns): Plain {
  const sign = cellOf(row, columns.marker);
  const props: Plain = {};
  for (const column of columns.props ?? []) {
    const cell = cellOf(row, column);
    if (filled(cell) && typeof cell !== "object") props[column] = cell;
  }
  return {
    value: numberOf(cellOf(row, columns.value)),
    label: cellOf(row, columns.label),
    tag: cellOf(row, columns.tag),
    color: cellOf(row, columns.color),
    category: categoryOf(cellOf(row, columns.category)),
    marker: sign === true || MAP_MARKERS.includes(sign as never) ? sign : undefined,
    time: cellOf(row, columns.time),
    props,
  };
}

export function mapFromRows(rows: readonly unknown[], columns: MapColumns): Plain {
  const header = {
    ...(columns.title === undefined ? {} : { title: columns.title }),
    ...(columns.valueLabel === undefined ? {} : { valueLabel: columns.valueLabel }),
    ...(columns.size === undefined ? {} : { sizeLabel: columns.size }),
    ...(columns.category === undefined ? {} : { categoryLabel: columns.category }),
  };
  const objects = rows.filter(isPlain);
  const byCity = (row: Record<string, unknown>): Plain[] =>
    columns.city === undefined || !filled(cellOf(row, columns.city))
      ? []
      : [
          {
            city: cellOf(row, columns.city),
            ...(filled(cellOf(row, columns.country))
              ? { country: cellOf(row, columns.country) }
              : {}),
            ...(filled(cellOf(row, columns.state))
              ? { state: cellOf(row, columns.state) }
              : {}),
            size: numberOf(cellOf(row, columns.size)),
            ...markOf(row, columns),
          },
        ];
  if (columns.lat !== undefined && columns.lon !== undefined) {
    let zero = 0;
    const points = objects.flatMap((row) => {
      const lat = numberOf(cellOf(row, columns.lat));
      const lon = numberOf(cellOf(row, columns.lon));
      const none = lat === 0 && lon === 0 && !columns.keepZero;
      if (lat === undefined || lon === undefined || none) {
        const placed = byCity(row);
        if (none && placed.length === 0) zero++;
        return placed;
      }
      return [
        {
          lat,
          lon,
          size: numberOf(cellOf(row, columns.size)),
          ...markOf(row, columns),
        },
      ];
    });
    return {
      ...header,
      points,
      ...(zero
        ? {
            notes: [
              `${zero.toLocaleString("en-US")} ${zero === 1 ? "row has" : "rows have"} latitude 0 and longitude 0 (no position) and ${zero === 1 ? "is" : "are"} not drawn.`,
            ],
          }
        : {}),
    };
  }
  if (columns.city !== undefined) return { ...header, points: objects.flatMap(byCity) };
  if (columns.zip !== undefined) {
    const named = namesZip(columns.zip);
    return {
      ...header,
      points: objects.flatMap((row) =>
        filled(cellOf(row, columns.zip))
          ? [
              {
                zip: cellOf(row, columns.zip),
                ...(named ? { zipNamed: true } : {}),
                size: numberOf(cellOf(row, columns.size)),
                ...markOf(row, columns),
              },
            ]
          : [],
      ),
    };
  }
  const found = REGION_COLUMNS.find(([key]) => columns[key] !== undefined);
  if (!found) return { ...header, points: [] };
  const [kind, set] = found;
  const placed = objects.filter((row) => filled(cellOf(row, columns[kind])));
  if (columns.as === "points" && (kind === "state" || kind === "country"))
    return {
      ...header,
      points: placed.map((row) => ({
        [kind]: cellOf(row, columns[kind]),
        size: numberOf(cellOf(row, columns.size)),
        ...markOf(row, columns),
      })),
    };
  return {
    ...header,
    regions: {
      set,
      ...(kind === "province" && columns.within !== undefined
        ? { within: { country: columns.within } }
        : {}),
      items: placed.map((row) => ({
        code: cellOf(row, columns[kind]),
        ...markOf(row, columns),
      })),
    },
  };
}

const FILE_KEYS = [
  ["kml", ".kml", "text"],
  ["gpx", ".gpx", "text"],
  ["kmz", ".kmz", "data"],
  ["shapefile", ".zip", "data"],
] as const;

export const NO_MAP_DATA =
  "This widget has no map to draw. Its endpoint must return rows, with the columns of their place named in the widget definition (data.map: lat and lon, or city, or zip, or state, county, country, province, metro or district), or GeoJSON, or a file: { kml } or { gpx } with its text, { kmz } or { shapefile } (zipped) as base64. Rows with street addresses need coordinates: the backend geocodes them.";

export function mapFromData(data: unknown, mapping: unknown): Plain | null {
  if (Array.isArray(data)) {
    const columns = mapColumns(mapping);
    return columns ? mapFromRows(data, columns) : null;
  }
  if (!isPlain(data)) return null;
  const value = isPlain(mapping) ? name(mapping.value) : undefined;
  const height = isPlain(mapping) ? name(mapping.height) : undefined;
  const time = isPlain(mapping) ? name(mapping.time) : undefined;
  const title = isPlain(mapping) ? name(mapping.title) : undefined;
  const category = isPlain(mapping) ? name(mapping.category) : undefined;
  if (
    data.type === "FeatureCollection" ||
    data.type === "Feature" ||
    (typeof data.type === "string" && "coordinates" in data)
  )
    return {
      ...(title === undefined ? {} : { title }),
      ...(isPlain(mapping) && name(mapping.valueLabel) !== undefined
        ? { valueLabel: mapping.valueLabel }
        : {}),
      ...(category === undefined ? {} : { categoryLabel: category }),
      geojson: data,
    };
  for (const [key, file, form] of FILE_KEYS)
    if (typeof data[key] === "string")
      return {
        ...(title === undefined ? {} : { title }),
        ...(isPlain(mapping) && name(mapping.valueLabel) !== undefined
          ? { valueLabel: mapping.valueLabel }
          : {}),
        file: {
          name: file,
          [form]: data[key],
          ...(value === undefined ? {} : { value }),
          ...(category === undefined ? {} : { category }),
          ...(height === undefined ? {} : { height }),
          ...(time === undefined ? {} : { time }),
        },
      };
  if (
    "points" in data ||
    "regions" in data ||
    "shapes" in data ||
    "geojson" in data ||
    "layers" in data ||
    "file" in data
  )
    return data;
  return null;
}

export type WidgetMap = (
  | { spec: MapSpec; error?: undefined }
  | { error: string; spec?: undefined }
) & { needs: PlaceFile[] };

export function widgetMap(
  data: unknown,
  mapping: unknown,
  sourceIds: readonly string[],
  parsed?: ParsedFiles,
): WidgetMap | null {
  const described = mapFromData(data, mapping);
  if (!described) return null;
  const value = isPlain(mapping) ? name(mapping.value) : undefined;
  const height = isPlain(mapping) ? name(mapping.height) : undefined;
  const category = isPlain(mapping) ? name(mapping.category) : undefined;
  const needs: PlaceNeeds = new Set();
  try {
    return {
      spec: makeMap(described, {
        sources: sourceIds,
        needs,
        parsed,
        ...(value === undefined && height === undefined && category === undefined
          ? {}
          : {
              geojson: {
                ...(value === undefined ? {} : { value }),
                ...(height === undefined ? {} : { height }),
                ...(category === undefined ? {} : { category }),
              },
            }),
      }),
      needs: [...needs],
    };
  } catch (cause) {
    return { error: widgetWords(cause), needs: [...needs] };
  }
}

const widgetWords = (cause: unknown): string =>
  (cause instanceof Error ? cause.message : String(cause)).replace(
    /^output\.map: (.)/,
    (_all, first: string) => `The map cannot be drawn: ${first}`,
  );
