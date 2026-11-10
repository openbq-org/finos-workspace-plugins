import { fail } from "./mapValues";

export type ContextSchema = "protomaps" | "openmaptiles";

export interface MapContextLayer {
  id: string;
  label: string;
  from: Record<ContextSchema, number>;
}

export const MAP_CONTEXT = [
  { id: "buildings", label: "Buildings", from: { protomaps: 11, openmaptiles: 13 } },
  {
    id: "buildings-3d",
    label: "3D buildings",
    from: { protomaps: 14, openmaptiles: 14 },
  },
  { id: "landuse", label: "Land use", from: { protomaps: 0, openmaptiles: 4 } },
  { id: "green", label: "Parks and forest", from: { protomaps: 2, openmaptiles: 4 } },
  { id: "railways", label: "Railways", from: { protomaps: 11, openmaptiles: 8 } },
  { id: "airports", label: "Airports", from: { protomaps: 6, openmaptiles: 10 } },
  {
    id: "pois",
    label: "Points of interest",
    from: { protomaps: 13, openmaptiles: 14 },
  },
] as const satisfies readonly MapContextLayer[];

export type MapContextId = (typeof MAP_CONTEXT)[number]["id"];

export const MAP_CONTEXT_IDS: readonly MapContextId[] = MAP_CONTEXT.map(({ id }) => id);

const isContextId = (value: unknown): value is MapContextId =>
  typeof value === "string" && (MAP_CONTEXT_IDS as readonly string[]).includes(value);

const inOrder = (wanted: ReadonlySet<unknown>): MapContextId[] =>
  MAP_CONTEXT_IDS.filter((id) => wanted.has(id));

export function mapContext(raw: unknown): MapContextId[] {
  if (raw === undefined || raw === null) return [];
  const list = MAP_CONTEXT_IDS.join(", ");
  if (!Array.isArray(raw))
    return fail(`"context" must be a list of context layers of the basemap: ${list}.`);
  if (raw.length > MAP_CONTEXT_IDS.length)
    return fail(
      `"context" has at most ${MAP_CONTEXT_IDS.length} entries, one for each context layer: ${list}.`,
    );
  const unknown = raw.findIndex((entry) => !isContextId(entry));
  if (unknown >= 0)
    return fail(
      `entry ${unknown + 1} of "context" is not a context layer of the basemap. The layers are: ${list}.`,
    );
  return inOrder(new Set(raw));
}

export function contextIds(raw: unknown): MapContextId[] {
  if (!Array.isArray(raw)) return [];
  return inOrder(new Set(raw.slice(0, MAP_CONTEXT_IDS.length * 2)));
}

export function contextOn(
  asked: readonly string[] | undefined,
  reader: { context?: readonly string[]; contextOff?: readonly string[] } | undefined,
): Set<MapContextId> {
  const off = new Set<string>(reader?.contextOff ?? []);
  return new Set(
    inOrder(new Set([...(asked ?? []), ...(reader?.context ?? [])])).filter(
      (id) => !off.has(id),
    ),
  );
}

export const contextAvailable = (
  layer: MapContextLayer,
  schema: ContextSchema,
  dataZoom: number,
): boolean => layer.from[schema] <= dataZoom;
