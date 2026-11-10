import type { Map as MapLibreMap } from "maplibre-gl";
import { type MutableRefObject, useCallback, useRef, useState } from "react";
import { crowded, crowdedSized, type Dot } from "./mapCrowd";
import type { Scene } from "./scene/sceneTypes";

const NONE: ReadonlySet<string> = new Set();

export interface KeptCrowd {
  of: unknown;
  ids: ReadonlySet<string>;
}

export function useMapCrowd(
  map: MapLibreMap | null,
  scene: Scene | null,
  frame: string | undefined,
  of: unknown,
  kept?: MutableRefObject<KeptCrowd | null>,
): { crowd: ReadonlySet<string>; measure: () => void } {
  const [found, setFound] = useState<KeptCrowd>(
    () => kept?.current ?? { of: null, ids: NONE },
  );
  const now = useRef({ map, scene, frame, of, kept });
  now.current = { map, scene, frame, of, kept };
  const measure = useCallback(() => {
    const { map, scene, frame, of, kept } = now.current;
    if (!map || !scene) return;
    const ids = new Set<string>();
    for (const { layer, features, track, sized, optional } of scene.clustered) {
      if (!optional || track) continue;
      const dots: Dot[] = [];
      for (const feature of features) {
        const at = feature.properties?.t;
        if (at !== undefined && at !== frame) continue;
        if (feature.geometry.type !== "Point") continue;
        const [lon, lat] = feature.geometry.coordinates;
        const { x, y } = map.project([lon, lat]);
        dots.push({ x, y, r: Number(feature.properties?.r) || 0 });
      }
      if (sized ? crowdedSized(dots) : crowded(dots)) ids.add(layer);
    }
    setFound((before) => {
      const same =
        before.of === of &&
        before.ids.size === ids.size &&
        [...ids].every((id) => before.ids.has(id));
      const next = same ? before : { of, ids };
      if (kept) kept.current = next;
      return next;
    });
  }, []);
  return { crowd: found.of === of ? found.ids : NONE, measure };
}
