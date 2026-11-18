import { MAP_LIMITS } from "~/lib/codemode/limits";
import type { MapBounds } from "./mapSummary";
import { fail } from "./mapValues";

export function mapPitch(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (
    typeof raw !== "number" ||
    !Number.isFinite(raw) ||
    raw < 0 ||
    raw > MAP_LIMITS.pitch
  )
    return fail(
      `\`pitch\` is the tilt the map opens at, in degrees: a number from 0 (flat) to ${MAP_LIMITS.pitch}. 45 is a map seen at an angle.`,
    );
  return Math.round(raw);
}

export const TILT_MAX_SPAN_DEGREES = 3;
export const FLAT_NOTE =
  "Drawn flat: a tilt shows nothing on a map this wide. A map of one city or region opens tilted.";
export function tooWideToTilt(bounds: MapBounds | undefined): boolean {
  if (!bounds) return false;
  const [west, south, east, north] = bounds;
  return east - west > TILT_MAX_SPAN_DEGREES || north - south > TILT_MAX_SPAN_DEGREES;
}
