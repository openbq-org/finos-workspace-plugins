import type { MapSign } from "~/lib/geo/mapMarkTypes";
import type { SceneMark } from "./scene/sceneTypes";
import type { SceneLayer } from "./sceneLayer";

export interface LegendKey {
  id: string;
  text: string;
  sign?: MapSign | "rank" | "highlight";
  tone?: string;
}

export const KEY_LINES = 3;
const MEANS = { rank: "Ranked", highlight: "Highlighted" } as const;
export const SUMMED = "Circles: the sum of their places";

export function legendKeys(
  marks: readonly SceneMark[],
  shown: (mark: SceneMark) => boolean,
  layers: readonly SceneLayer[],
  grouped: ReadonlySet<string>,
): LegendKey[] {
  const keys: LegendKey[] = [];
  const sizes = new Set<string>();
  for (const layer of layers) {
    if (!layer.sized) continue;
    if (layer.sizeLabel && layer.sizeLabel !== layer.valueLabel)
      sizes.add(layer.sizeLabel);
    if (grouped.has(layer.id) && !keys.some((key) => key.id === "summed"))
      keys.push({ id: "summed", text: SUMMED });
  }
  for (const label of sizes)
    keys.unshift({ id: `size:${label}`, text: `Size: ${label}` });
  const signs = new Map<string, LegendKey>();
  for (const mark of marks) {
    if (signs.size >= KEY_LINES) break;
    if ((mark.marker === undefined && !mark.highlight) || !shown(mark)) continue;
    const sign =
      mark.marker === undefined
        ? "highlight"
        : typeof mark.marker === "number"
          ? "rank"
          : mark.marker;
    const text =
      mark.meaning ??
      (sign === "rank" || sign === "highlight" ? MEANS[sign] : "Marked");
    const id = `${sign}|${text}`;
    if (!signs.has(id))
      signs.set(id, { id, text, sign, ...(mark.tone ? { tone: mark.tone } : {}) });
  }
  return [...keys, ...signs.values()];
}
