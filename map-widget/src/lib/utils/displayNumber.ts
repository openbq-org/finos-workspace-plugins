export type NumberKind = "year" | "identifier" | "coordinate" | "quantity";

export const YEAR_RANGE = { min: 1000, max: 2100 } as const;

export const COORDINATE_DIGITS = 5;

const SAMPLE = 200;

const MEASURE_WORDS = new Set([
  "per",
  "count",
  "counts",
  "cnt",
  "total",
  "sum",
  "avg",
  "average",
  "mean",
  "median",
  "rate",
  "ratio",
  "change",
  "growth",
  "pct",
  "percent",
  "share",
  "over",
  "ago",
  "old",
  "age",
  "duration",
  "size",
  "amount",
  "balance",
  "value",
  "volume",
  "sales",
  "revenue",
  "income",
  "budget",
  "return",
  "price",
  "cost",
  "units",
  "sold",
  "qty",
  "quantity",
  "population",
  "households",
  "headcount",
  "net",
  "gross",
  "exposure",
  "position",
  "positions",
  "days",
  "months",
  "weeks",
  "hours",
]);

const YEAR_NAMES = new Set(["year", "yr", "fy", "vintage", "cohort"]);
const YEAR_QUALIFIERS = new Set([
  "fiscal",
  "calendar",
  "tax",
  "model",
  "report",
  "reporting",
  "filing",
  "start",
  "end",
  "first",
  "last",
  "min",
  "max",
  "birth",
  "founding",
  "construction",
  "launch",
  "release",
]);
const YEAR_EVENTS = new Set([
  "built",
  "founded",
  "opened",
  "established",
  "incorporated",
  "constructed",
]);
const YEAR_FILLERS = new Set(["date", "in", "on", "of", "the"]);

const CODE_WORDS = new Set([
  "fips",
  "geoid",
  "zip",
  "zipcode",
  "postcode",
  "cusip",
  "isin",
  "sedol",
  "naics",
  "sic",
  "sku",
  "cik",
  "lei",
  "ein",
  "ssn",
  "npi",
  "upc",
  "ean",
  "gtin",
  "cbsa",
]);
const ID_WORDS = new Set(["id", "code", "postal", "phone", "account"]);
const ID_SUFFIXES = new Set(["number", "no", "num", "nbr", "nr"]);
const CODE_LENGTH = /^\d{1,2}$/;

const LATITUDE_WORDS = new Set(["lat", "latitude"]);
const LONGITUDE_WORDS = new Set(["lon", "lng", "long", "longitude"]);
const COORDINATE_QUALIFIERS = new Set([
  "origin",
  "dest",
  "destination",
  "start",
  "end",
  "from",
  "to",
  "source",
  "src",
  "dst",
  "target",
  "pickup",
  "dropoff",
  "center",
  "centre",
  "centroid",
  "min",
  "max",
  "north",
  "south",
  "east",
  "west",
  "home",
  "store",
  "site",
  "station",
  "airport",
  "port",
  "city",
  "geo",
  "gps",
  "location",
  "point",
  "deg",
  "degrees",
  "decimal",
  "wgs84",
]);

type Axis = "latitude" | "longitude";

interface NameReading {
  year: boolean;
  measure?: true;
  identifier: boolean;
  axis?: Axis;
  paired?: "always" | "known";
}

const NOTHING: NameReading = { year: false, identifier: false };
const MEASURE: NameReading = { ...NOTHING, measure: true };

function wordsOf(name: string): string[] {
  return name
    .replace(/\([^)]*\)/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isYearName(words: string[]): boolean {
  const known = (word: string) =>
    YEAR_NAMES.has(word) ||
    YEAR_QUALIFIERS.has(word) ||
    YEAR_EVENTS.has(word) ||
    YEAR_FILLERS.has(word);
  if (!words.every(known)) return false;
  if (words.some((word) => YEAR_NAMES.has(word))) return true;
  return (
    words.some((word) => YEAR_EVENTS.has(word)) &&
    !words.some((word) => YEAR_QUALIFIERS.has(word))
  );
}

function isIdentifierName(words: string[]): boolean {
  const named = [...words];
  while (
    named.length > 1 &&
    (ID_SUFFIXES.has(named[named.length - 1]) ||
      CODE_LENGTH.test(named[named.length - 1]))
  )
    named.pop();
  const head = named[named.length - 1];
  const code = head.replace(/\d{1,2}$/, "");
  return ID_WORDS.has(head) || CODE_WORDS.has(head) || CODE_WORDS.has(code);
}

function coordinateOf(words: string[]): Pick<NameReading, "axis" | "paired"> {
  let axis: Axis | undefined;
  let paired: NameReading["paired"];
  for (const word of words) {
    const latitude = LATITUDE_WORDS.has(word);
    if (latitude || LONGITUDE_WORDS.has(word)) {
      if (axis) return {};
      axis = latitude ? "latitude" : "longitude";
      paired =
        word === "long"
          ? "always"
          : word === "lat" && words.length === 1
            ? "known"
            : undefined;
    } else if (!COORDINATE_QUALIFIERS.has(word)) return {};
  }
  return axis ? { axis, ...(paired ? { paired } : {}) } : {};
}

function readName(name: string): NameReading {
  const words = wordsOf(name);
  if (!words.length) return NOTHING;
  if (words.some((word) => MEASURE_WORDS.has(word))) return MEASURE;
  return {
    year: isYearName(words),
    identifier: isIdentifierName(words),
    ...coordinateOf(words),
  };
}

const readings = new Map<string, NameReading>();
function nameReading(name: string | undefined): NameReading {
  if (!name) return NOTHING;
  const known = readings.get(name);
  if (known) return known;
  const read = readName(name);
  if (readings.size >= 2_000) readings.clear();
  readings.set(name, read);
  return read;
}

export function namesYear(column: string | undefined): boolean {
  return nameReading(column).year;
}

const ZIP_WORDS = new Set(["zip", "zipcode", "zcta", "postal", "postcode"]);

export function namesZip(column: string | undefined): boolean {
  if (!column) return false;
  const words = wordsOf(column);
  if (!words.length || words.some((word) => MEASURE_WORDS.has(word))) return false;
  const named = [...words];
  while (
    named.length > 1 &&
    (ID_SUFFIXES.has(named[named.length - 1]) ||
      CODE_LENGTH.test(named[named.length - 1]) ||
      named[named.length - 1] === "code")
  )
    named.pop();
  return ZIP_WORDS.has(named[named.length - 1].replace(/\d{1,2}$/, ""));
}

function isCoordinateName(
  name: string | undefined,
  reading: NameReading,
  siblings: Iterable<string> | undefined,
): boolean {
  if (!reading.axis) return false;
  if (!reading.paired) return true;
  if (!siblings) return reading.paired === "known";
  for (const sibling of siblings) {
    if (sibling === name) continue;
    const other = nameReading(sibling).axis;
    if (other && other !== reading.axis) return true;
  }
  return false;
}

function declaredKind(type: string | undefined): NumberKind | undefined {
  const declared = type?.trim().toLowerCase();
  if (!declared) return undefined;
  if (declared === "year") return "year";
  if (declared === "id" || declared === "identifier" || declared === "code")
    return "identifier";
  if (declared === "latitude" || declared === "longitude" || declared === "coordinate")
    return "coordinate";
  return undefined;
}

const isWhole = (value: unknown): value is number | bigint =>
  typeof value === "bigint" || (typeof value === "number" && Number.isInteger(value));

const isYearValue = (value: unknown) =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= YEAR_RANGE.min &&
  value <= YEAR_RANGE.max;

const YEAR_RUN_STEP = 10;

function isYearRun(values: Iterable<unknown>): boolean {
  let seen = 0;
  let last: number | undefined;
  let step: number | undefined;
  for (const value of values) {
    if (value === null || value === undefined || typeof value === "string") continue;
    if (!isYearValue(value)) return false;
    const year = value as number;
    if (last !== undefined) {
      const now = year - last;
      if (
        now === 0 ||
        Math.abs(now) > YEAR_RUN_STEP ||
        (step !== undefined && now !== step)
      )
        return false;
      step = now;
    }
    last = year;
    seen += 1;
    if (seen >= SAMPLE) break;
  }
  return seen >= 2;
}

const isCoordinateValue = (value: unknown, reach: number) =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= reach;

const reachOf = (reading: NameReading) => (reading.axis === "latitude" ? 90 : 180);

function fits(kind: NumberKind, value: unknown, reading: NameReading): boolean {
  if (kind === "year") return isYearValue(value);
  if (kind === "identifier") return isWhole(value);
  if (kind === "coordinate") return isCoordinateValue(value, reachOf(reading));
  return true;
}

export function numberKind(
  column: string | undefined,
  values: Iterable<unknown>,
  declaredType?: string,
  siblings?: Iterable<string>,
): NumberKind {
  const reading = nameReading(column);
  const declared = declaredKind(declaredType);
  const candidates: NumberKind[] = declared
    ? [declared]
    : [
        ...(reading.year ? (["year"] as const) : []),
        ...(reading.identifier ? (["identifier"] as const) : []),
        ...(isCoordinateName(column, reading, siblings)
          ? (["coordinate"] as const)
          : []),
      ];
  if (!candidates.length)
    return !reading.measure && isYearRun(values) ? "year" : "quantity";

  let seen = 0;
  let open = candidates;
  for (const value of values) {
    if (typeof value !== "number" && typeof value !== "bigint") continue;
    if (typeof value === "number" && Number.isNaN(value)) continue;
    open = open.filter((kind) => fits(kind, value, reading));
    if (!open.length) return "quantity";
    seen += 1;
    if (seen >= SAMPLE) break;
  }
  return seen ? open[0] : "quantity";
}

export function* columnValues(
  rows: readonly unknown[],
  column: string,
): Generator<unknown> {
  for (const row of rows) {
    if (row !== null && typeof row === "object")
      yield (row as Record<string, unknown>)[column];
  }
}

const coordinateFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: COORDINATE_DIGITS,
  useGrouping: false,
});

const quantityFormats = new Map<number, Intl.NumberFormat>();
function grouped(value: number, decimalDigits: number | undefined): string {
  const digits =
    decimalDigits !== undefined && Number.isFinite(decimalDigits)
      ? Math.min(20, Math.max(0, Math.trunc(decimalDigits)))
      : 2;
  let format = quantityFormats.get(digits);
  if (!format) {
    format = new Intl.NumberFormat("en-US", { maximumFractionDigits: digits });
    quantityFormats.set(digits, format);
  }
  return format.format(value);
}

export interface DisplayNumberOptions {
  column?: string;
  type?: string;
  kind?: NumberKind;
  siblings?: Iterable<string>;
  decimalDigits?: number;
  quantity?: (value: number) => string;
}

export function displayNumber(
  value: unknown,
  options: DisplayNumberOptions = {},
): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "number") return String(value);

  const quantity =
    options.quantity ?? ((n: number) => grouped(n, options.decimalDigits));
  if (!Number.isFinite(value)) return quantity(value);

  const reading = nameReading(options.column);
  const kind =
    options.kind ?? numberKind(options.column, [value], options.type, options.siblings);
  if (kind === "quantity" || !fits(kind, value, reading)) return quantity(value);
  if (kind === "coordinate") return coordinateFormat.format(value);
  return Number.isSafeInteger(value)
    ? String(value)
    : value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 0 });
}
