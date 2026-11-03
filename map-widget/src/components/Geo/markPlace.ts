import type { Map as MapLibreMap } from "maplibre-gl";
import { liftPixels } from "./mapGeometry";

const STEP = 1e-4;
const METRES_PER_DEGREE = 111_320;

export function markPlace(
  map: Pick<MapLibreMap, "project" | "getPitch">,
  at: [number, number],
  lift?: number,
): { x: number; y: number } {
  const foot = map.project(at);
  const pitch = lift ? map.getPitch() : 0;
  if (!lift || !pitch) return { x: foot.x, y: foot.y };
  const [lon, lat] = at;
  const metres = STEP * METRES_PER_DEGREE;
  const across = STEP / Math.max(0.1, Math.cos((lat * Math.PI) / 180));
  const east = map.project([lon + across, lat]);
  const north = map.project([lon, lat + STEP]);
  const up = liftPixels(
    [(east.x - foot.x) / metres, (east.y - foot.y) / metres],
    [(north.x - foot.x) / metres, (north.y - foot.y) / metres],
    lift,
    pitch,
  );
  return { x: foot.x, y: foot.y - up };
}
