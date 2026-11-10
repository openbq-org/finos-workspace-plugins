export const MARK_NAMES = [
  "layer",
  "name",
  "value",
  "valueLabel",
  "size",
  "sizeLabel",
  "tag",
  "category",
  "time",
  "marker",
  "markerColor",
  "highlight",
  "meaning",
  "height",
  "color",
  "note",
] as const;
export type MarkName = (typeof MARK_NAMES)[number];

export const MAP_MEMBER = "map";
export const MAP_MEMBER_CHARS = 16 * 1024;

export interface MemberLayer {
  name: string;
  hidden?: true;
  opacity?: number;
}

export interface MapMember {
  version: 1;
  credits?: string[];
  notes?: string[];
  time?: true;
  category?: true;
  frame?: string;
  categoryLabel?: string;
  layers?: MemberLayer[];
  view?: unknown;
  context?: string[];
  boundaries?: string[];
  basemap?: unknown;
  pitch?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const MEMBER_DEPTH = 6;
const MEMBER_VALUES = 2_000;

function small(value: unknown): boolean {
  let left = MEMBER_VALUES;
  let chars = 0;
  const walk = (item: unknown, depth: number): boolean => {
    if (--left < 0 || depth > MEMBER_DEPTH) return false;
    if (typeof item === "string") chars += item.length;
    if (chars > MAP_MEMBER_CHARS) return false;
    if (typeof item !== "object" || item === null) return true;
    for (const key in item) {
      chars += key.length;
      if (!walk((item as Record<string, unknown>)[key], depth + 1)) return false;
    }
    return true;
  };
  return walk(value, 0);
}

export function memberOf(raw: unknown): Record<string, unknown> | undefined {
  let value = raw;
  if (typeof raw === "string") {
    if (raw.length > MAP_MEMBER_CHARS) return undefined;
    try {
      value = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return isRecord(value) && small(value) ? value : undefined;
}

export function describedBy(
  layer: string | undefined,
  data: readonly (readonly [string, string])[],
  when: string | undefined,
): string {
  const valueLabel = data.find(([name]) => name === "valueLabel")?.[1];
  const sizeLabel = data.find(([name]) => name === "sizeLabel")?.[1];
  return [
    ...(layer === undefined ? [] : [`layer: ${layer}`]),
    ...data.flatMap(([key, value]) =>
      key === "valueLabel" || key === "sizeLabel" || value === ""
        ? []
        : [
            key === "value" && valueLabel !== undefined
              ? `${valueLabel}: ${value}`
              : key === "size" && sizeLabel !== undefined
                ? `${sizeLabel}: ${value}`
                : `${key}: ${value}`,
          ],
    ),
    ...(when === undefined ? [] : [`time: ${when}`]),
  ].join("\n");
}
