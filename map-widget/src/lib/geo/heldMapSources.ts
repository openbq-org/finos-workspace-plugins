import { mapSourceDeclarations } from "./mapSources";
import { tileSample } from "./mapSourceAddress";
import type { HeldMapSource } from "./mapSourceTypes";

export interface RefusedHeldSource {
  backend: string;
  widget: string;
  id?: string;
  reason: string;
}

export interface HeldMapSources {
  sources: HeldMapSource[];
  ambiguous: string[];
  refused: RefusedHeldSource[];
}

export const NO_HELD: HeldMapSources = { sources: [], ambiguous: [], refused: [] };

const parsed = (url: string): URL | null => {
  try {
    return new URL(url);
  } catch {
    return null;
  }
};

const plainColors = (raw: unknown): unknown =>
  Array.isArray(raw)
    ? raw.map((source) => {
        if (!source || typeof source !== "object" || !Array.isArray(source.layers))
          return source;
        return {
          ...source,
          layers: source.layers.map((layer: Record<string, unknown>) => {
            const color = layer?.color as Record<string, unknown> | undefined;
            return color && typeof color.value === "string"
              ? { ...layer, color: color.value }
              : layer;
          }),
        };
      })
    : raw;

function declaredBy(
  origin: string,
  raw: unknown,
  refused: RefusedHeldSource[],
): HeldMapSource[] {
  const read = mapSourceDeclarations(raw);
  for (const item of read.refused) refused.push({ backend: origin, widget: "map", ...item });
  const held: HeldMapSource[] = [];
  for (const declaration of read.sources) {
    const { endpoint: _endpoint, url, ...facts } = declaration;
    const address = url === undefined ? null : parsed(tileSample(url));
    if (!address || address.protocol !== "https:" || address.username || address.password) {
      refused.push({
        backend: origin,
        widget: "map",
        id: declaration.id,
        reason: "a source needs an https address: a plugin has no backend to put an endpoint after.",
      });
      continue;
    }
    held.push({
      ...facts,
      url: url as string,
      origin: address.origin,
      backend: address.origin,
      headers: {},
    });
  }
  return held;
}

const jsonOf = (text: string): unknown => {
  try {
    return text.trim() ? JSON.parse(text) : undefined;
  } catch {
    return null;
  }
};

export function heldMapSources(declared: unknown, admin: string): HeldMapSources {
  const refused: RefusedHeldSource[] = [];
  const written = jsonOf(admin);
  if (written === null)
    refused.push({
      backend: "admin settings",
      widget: "map",
      reason: "the map sources of the settings are not JSON.",
    });
  const lists = [
    declaredBy("widget", plainColors(declared), refused),
    declaredBy("admin settings", written ?? undefined, refused),
  ];
  const owners = new Map<string, number>();
  for (const list of lists) for (const { id } of list) owners.set(id, (owners.get(id) ?? 0) + 1);
  const shared = (id: string) => (owners.get(id) ?? 0) > 1;
  return {
    sources: lists.flat().filter(({ id }) => !shared(id)),
    ambiguous: [...owners.keys()].filter(shared).sort(),
    refused,
  };
}
