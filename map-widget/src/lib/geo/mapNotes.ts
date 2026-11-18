import { MAP_LIMITS } from "~/lib/codemode/limits";
import type { MapPoint, MapRegion } from "./mapMarkTypes";
import { isPlain, text } from "./mapValues";

export type MapNotes = Record<string, string>;

const NOTE_KEY =
  /^(?:p:-?[0-9]{1,3}\.[0-9]{4},-?[0-9]{1,3}\.[0-9]{4}|r:[0-9A-Za-z: -]{2,64})$/;

export const pointKey = (point: Pick<MapPoint, "lat" | "lon">) =>
  `p:${point.lat.toFixed(4)},${point.lon.toFixed(4)}`;

export const regionKey = (region: Pick<MapRegion, "code">) => `r:${region.code}`;

export function mapNotes(raw: unknown): MapNotes {
  if (!isPlain(raw)) return {};
  const kept: [string, string][] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (kept.length >= MAP_LIMITS.notes) break;
    if (!NOTE_KEY.test(key)) continue;
    const note =
      typeof value === "string" ? text(value, MAP_LIMITS.noteChars) : undefined;
    if (note !== undefined) kept.push([key, note]);
  }
  return Object.fromEntries(kept);
}
