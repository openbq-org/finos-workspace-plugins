import { MAP_BOUNDARY_IDS, type MapBoundaryId } from "./mapBoundaries";
import { MAP_ID } from "./mapLayers";
import { isPlain } from "./mapValues";
import type { MapViewState } from "./mapViewState";

export const MAP_BASEMAP_PARTS = ["names", "roads", "borders"] as const;
export type MapBasemapPart = (typeof MAP_BASEMAP_PARTS)[number];

export interface MapBasemap {
  source?: string;
  choice?: "plain";
  names?: false;
  roads?: false;
  borders?: false;
}

export const BOUNDARIES_NOTE = `A boundary layer the map asks for is not one of the app and was left out. The boundary layers are: ${MAP_BOUNDARY_IDS.join(", ")}.`;
export const BASEMAP_NOTE =
  'The basemap the map asks for is not one a map can name, so it opens on the standard one. A basemap is "standard", "plain", or the id of an imagery source of a connected backend.';

export function boundariesAsked(raw: unknown, notes: string[]): MapBoundaryId[] {
  if (raw === undefined || raw === null) return [];
  const read = Array.isArray(raw) ? raw.slice(0, MAP_BOUNDARY_IDS.length * 2) : null;
  const wanted = new Set<unknown>(read ?? []);
  const kept = MAP_BOUNDARY_IDS.filter((id) => wanted.has(id));
  if (!read || read.length < (raw as unknown[]).length || wanted.size > kept.length)
    notes.push(BOUNDARIES_NOTE);
  return kept;
}

function backdropOf(name: unknown): Pick<MapBasemap, "source" | "choice"> | null {
  if (name === "standard") return {};
  if (name === "plain") return { choice: "plain" };
  return typeof name === "string" && MAP_ID.test(name) ? { source: name } : null;
}

export function basemapAsked(raw: unknown, notes: string[]): MapBasemap | undefined {
  if (raw === undefined || raw === null) return undefined;
  const named = isPlain(raw) ? (raw.source ?? raw.choice ?? "standard") : raw;
  const backdrop = backdropOf(named);
  if (!backdrop) notes.push(BASEMAP_NOTE);
  const asked: MapBasemap = { ...(backdrop ?? {}) };
  if (isPlain(raw))
    for (const part of MAP_BASEMAP_PARTS) if (raw[part] === false) asked[part] = false;
  return Object.keys(asked).length ? asked : undefined;
}

export const backdropAsked = (basemap: MapBasemap | undefined): string =>
  basemap?.source ?? basemap?.choice ?? "standard";

export interface MapAsks {
  boundaries: readonly MapBoundaryId[];
  off: readonly MapBasemapPart[];
}

const NOTHING: MapAsks = { boundaries: [], off: [] };

export function mapAsks(spec: {
  boundaries?: readonly MapBoundaryId[];
  basemap?: MapBasemap;
}): MapAsks {
  const off = MAP_BASEMAP_PARTS.filter((part) => spec.basemap?.[part] === false);
  const boundaries = spec.boundaries ?? [];
  return boundaries.length || off.length ? { boundaries, off } : NOTHING;
}

export function viewOver(asks: MapAsks, view: MapViewState): MapViewState {
  const { boundariesOff, ...rest } = view;
  const parts = view.basemap ?? {};
  const overruled = MAP_BASEMAP_PARTS.some((part) => parts[part] === true);
  if (!asks.boundaries.length && !asks.off.length && !boundariesOff && !overruled)
    return view;
  const off = new Set<string>(boundariesOff ?? []);
  const on = new Set<string>([...asks.boundaries, ...(view.boundaries ?? [])]);
  const boundaries = MAP_BOUNDARY_IDS.filter((id) => on.has(id) && !off.has(id));
  const basemap: NonNullable<MapViewState["basemap"]> = { ...parts };
  for (const part of MAP_BASEMAP_PARTS) {
    if (parts[part] === true) delete basemap[part];
    else if (asks.off.includes(part)) basemap[part] = false;
  }
  const { boundaries: _before, basemap: _parts, ...kept } = rest;
  return {
    ...kept,
    ...(boundaries.length ? { boundaries } : {}),
    ...(Object.keys(basemap).length ? { basemap } : {}),
  };
}

export function viewUnder(asks: MapAsks, shown: MapViewState): MapViewState {
  if (!asks.boundaries.length && !asks.off.length) return shown;
  const on = shown.boundaries ?? [];
  const boundaries = on.filter((id) => !asks.boundaries.includes(id));
  const boundariesOff = asks.boundaries.filter((id) => !on.includes(id));
  const basemap: NonNullable<MapViewState["basemap"]> = { ...(shown.basemap ?? {}) };
  for (const part of asks.off) {
    if (basemap[part] === false) delete basemap[part];
    else basemap[part] = true;
  }
  const { boundaries: _on, boundariesOff: _off, basemap: _parts, ...kept } = shown;
  return {
    ...kept,
    ...(boundaries.length ? { boundaries } : {}),
    ...(boundariesOff.length ? { boundariesOff } : {}),
    ...(Object.keys(basemap).length ? { basemap } : {}),
  };
}
