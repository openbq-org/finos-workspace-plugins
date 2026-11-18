import { displayTimes } from "~/lib/utils/displayTime";
import type { SceneMark } from "./sceneTypes";

export function humanTimes(marks: SceneMark[]): void {
  const byLayer = new Map<string, SceneMark[]>();
  for (const mark of marks) {
    const of = byLayer.get(mark.layer);
    if (of) of.push(mark);
    else byLayer.set(mark.layer, [mark]);
  }
  for (const layer of byLayer.values())
    for (const field of ["tag", "label"] as const) {
      const texts = layer.map((mark) => mark[field]);
      const shown = displayTimes(texts);
      layer.forEach((mark, at) => {
        if (shown[at] !== texts[at]) mark[field] = shown[at];
      });
    }
}
