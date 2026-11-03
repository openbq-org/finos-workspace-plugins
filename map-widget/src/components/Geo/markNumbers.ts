import { type NumberKind, numberKind } from "~/lib/utils/displayNumber";
import type { SceneMark } from "./scene/sceneTypes";

export interface MarkNumbers {
  value: (mark: SceneMark, label: string | undefined) => NumberKind;
  size: (mark: SceneMark, label: string | undefined) => NumberKind;
  prop: (mark: SceneMark, key: string) => NumberKind;
}

export function markNumbers(marks: readonly SceneMark[]): MarkNumbers {
  let layers: Map<string, SceneMark[]> | undefined;
  const rowsOf = (mark: SceneMark): readonly SceneMark[] => {
    if (!layers) {
      layers = new Map();
      for (const one of marks) {
        const of = layers.get(one.layer);
        if (of) of.push(one);
        else layers.set(one.layer, [one]);
      }
    }
    return layers.get(mark.layer) ?? [mark];
  };
  const kinds = new Map<string, NumberKind>();
  const once = (column: string, decide: () => NumberKind) => {
    const known = kinds.get(column);
    if (known) return known;
    const kind = decide();
    kinds.set(column, kind);
    return kind;
  };
  function* cells(mark: SceneMark, read: (row: SceneMark) => unknown) {
    for (const row of rowsOf(mark)) yield read(row);
  }
  return {
    value: (mark, label) =>
      once(`value\0${mark.layer}`, () =>
        numberKind(
          label,
          cells(mark, (row) => row.value),
        ),
      ),
    size: (mark, label) =>
      once(`size\0${mark.layer}`, () =>
        numberKind(
          label,
          cells(mark, (row) => row.size),
        ),
      ),
    prop: (mark, key) =>
      once(`prop\0${mark.layer}\0${key}`, () =>
        numberKind(
          key,
          cells(mark, (row) =>
            row.props && Object.hasOwn(row.props, key) ? row.props[key] : undefined,
          ),
          undefined,
          Object.keys(mark.props ?? {}),
        ),
      ),
  };
}
