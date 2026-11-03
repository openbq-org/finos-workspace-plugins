export type Plain = Record<string, unknown>;

export const isPlain = (value: unknown): value is Plain =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const fail = (message: string): never => {
  throw new Error(`output.map: ${message}`);
};

export const count = (n: number) => n.toLocaleString("en-US");

export const UNPRINTED_CHARACTER =
  "[\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069]";

const UNPRINTED = new RegExp(`(?!\\s)${UNPRINTED_CHARACTER}`, "g");

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

export function heading(value: unknown, max: number): string | undefined {
  const read = text(value, max);
  return read === undefined
    ? undefined
    : text(
        read.replace(/(\d)\s*\u2014\s*(?=\d)/g, "$1-").replace(/\s*\u2014\s*/g, " - "),
        max,
      );
}

export function humanLabel(label: string): string;
export function humanLabel(label: string | undefined): string | undefined;
export function humanLabel(label: string | undefined): string | undefined {
  if (label === undefined || /\s/.test(label) || !label.includes("_")) return label;
  return label.replace(/_+/g, " ").trim() || label;
}

export function text(value: unknown, max: number): string | undefined {
  const given =
    typeof value === "string"
      ? value
      : typeof value === "number" && Number.isFinite(value)
        ? String(value)
        : null;
  if (given === null) return undefined;
  let shown = given.replace(UNPRINTED, "").replace(/\s+/g, " ").trim();
  if (shown.length > max) {
    shown = shown.slice(0, max);
    if (isHighSurrogate(shown.charCodeAt(shown.length - 1))) shown = shown.slice(0, -1);
    shown = shown.trimEnd();
  }
  return shown || undefined;
}

export const ELLIPSIS = "\u2026";

export function tagOf(value: unknown, max: number): string | undefined {
  const whole = text(value, max * 4);
  if (whole === undefined || whole.length <= max) return whole;
  let kept = whole.slice(0, max - 1);
  if (/\S/.test(whole.charAt(max - 1))) {
    const start = kept.search(/\S+$/);
    const word = whole.slice(start).match(/^\S+/)?.[0] ?? "";
    if (start > 0 && /\d/.test(word)) kept = kept.slice(0, start);
    else if (start === 0 && /\d/.test(word))
      kept = kept.replace(/[/|;,_]*[^/|;,_]*$/, "");
  }
  kept = kept.replace(/[\s,;:(-]+$/, "");
  if (isHighSurrogate(kept.charCodeAt(kept.length - 1))) kept = kept.slice(0, -1);
  return kept ? `${kept}${ELLIPSIS}` : undefined;
}

const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export const mapColor = (value: unknown): string | undefined =>
  typeof value === "string" && COLOR.test(value) ? value.toLowerCase() : undefined;

export const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const shown = (value: unknown) =>
  JSON.stringify(typeof value === "string" ? value.slice(0, 40) : value)?.slice(0, 60);

export const listOf = (value: unknown, name: string): unknown[] =>
  value === undefined || value === null
    ? []
    : Array.isArray(value)
      ? value
      : fail(`"${name}" must be a list when it is given.`);

export const numberOf = (cell: unknown): number | undefined => {
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : undefined;
  if (
    typeof cell !== "string" ||
    !/^\s*-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i.test(cell)
  )
    return undefined;
  return Number(cell);
};
