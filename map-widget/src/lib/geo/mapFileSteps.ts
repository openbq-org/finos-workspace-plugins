import { MAP_LIMITS } from "~/lib/codemode/limits";
import type { GeoFileResult } from "./files";
import { text } from "./mapValues";

const pad = (value: string) => value.padStart(2, "0");
const hasDay = (year: number, month: number, day: number) =>
  day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();

const FORMS: readonly [RegExp, (...parts: string[]) => string | null][] = [
  [/^(\d{4})$/, (year) => year],
  [/^(\d{4})[- ]?[Qq]([1-4])$/, (year, quarter) => `${year}-Q${quarter}`],
  [
    /^(\d{4})-(\d{1,2})$/,
    (year, month) =>
      Number(month) >= 1 && Number(month) <= 12 ? `${year}-${pad(month)}` : null,
  ],
  [
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/,
    (year, month, day) =>
      Number(month) >= 1 &&
      Number(month) <= 12 &&
      hasDay(Number(year), Number(month), Number(day))
        ? `${year}-${pad(month)}-${pad(day)}`
        : null,
  ],
];
const NO_STEP = "no year, quarter, month or date written year first";

export function stepOf(value: unknown): string | null {
  const shown = text(value, MAP_LIMITS.propValueChars);
  if (shown === undefined) return null;
  for (const [form, step] of FORMS) {
    const parts = form.exec(shown);
    if (parts) return step(...parts.slice(1));
  }
  return null;
}

export interface FileSteps {
  key: string;
  steps: Map<unknown, string>;
}

export function stepsOf(
  file: GeoFileResult,
  asked: unknown,
  notes: string[],
): FileSteps | undefined {
  const key = asked === true ? "time" : typeof asked === "string" ? asked : undefined;
  if (key === undefined) return undefined;
  const named = JSON.stringify(key.slice(0, 60));
  if (file.kind === "gpx" && key === "time") {
    notes.push(
      "The times of a GPX file say when its points were recorded: they are values of the marks, not steps of the map.",
    );
    return undefined;
  }
  if (!file.columns.some(({ name }) => name === key)) {
    notes.push(
      `The file has no property ${named} to play by. Its properties: ${
        file.columns
          .slice(0, 12)
          .map(({ name }) => name)
          .join(", ") || "none"
      }.`,
    );
    return undefined;
  }
  const kept = "the marks are drawn on one map and keep it as a value";
  const steps = new Map<unknown, string>();
  const labels = new Set<string>();
  for (const { properties } of file.features) {
    const value = Object.hasOwn(properties, key) ? properties[key] : undefined;
    if (value === undefined || value === null || value === "" || steps.has(value))
      continue;
    const step = stepOf(value);
    if (step === null) {
      notes.push(
        `The property ${named} is no time to play by: ${JSON.stringify(String(value).slice(0, 32))} is ${NO_STEP}. The marks are on one map and keep it as a value.`,
      );
      return undefined;
    }
    steps.set(value, step);
    labels.add(step);
  }
  if (labels.size > MAP_LIMITS.frames) {
    notes.push(
      `The property ${named} has ${labels.size.toLocaleString("en-US")} dates or periods and a map plays at most ${MAP_LIMITS.frames}: ${kept}. Aggregate the file to fewer periods.`,
    );
    return undefined;
  }
  return { key, steps };
}

export function writtenSteps(
  file: GeoFileResult,
  notes: string[],
): FileSteps | undefined {
  const steps = new Map<unknown, string>();
  const labels = new Set<string>();
  for (const { properties } of file.features) {
    const value = Object.hasOwn(properties, "time") ? properties.time : undefined;
    if (value === undefined || value === null || value === "" || steps.has(value))
      continue;
    const step =
      typeof value === "string" || typeof value === "number"
        ? text(String(value), MAP_LIMITS.propValueChars)
        : undefined;
    if (step === undefined || step.length > MAP_LIMITS.frameChars) {
      notes.push(
        `The file says its marks are played by their time, and ${JSON.stringify(String(value).slice(0, 32))} is longer than a step is (${MAP_LIMITS.frameChars} characters): the marks are on one map and keep it as a value.`,
      );
      return undefined;
    }
    steps.set(value, step);
    labels.add(step);
  }
  if (labels.size === 0) return undefined;
  if (labels.size > MAP_LIMITS.frames) {
    notes.push(
      `The file says its marks are played by their time, which has ${labels.size.toLocaleString("en-US")} steps, and a map plays at most ${MAP_LIMITS.frames}: the marks are drawn on one map and keep it as a value.`,
    );
    return undefined;
  }
  return { key: "time", steps };
}
