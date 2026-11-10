import "./mapFile";
import { base64Of } from "./base64";
import { type WidgetMap, widgetMap } from "./mapData";
import type { ParsedFiles } from "./mapFileReader";
import { loadPlaceFiles } from "./mapPlaceSets";

export interface WidgetMapInput {
  payload: unknown;
  mapping: unknown;
  sourceIds: readonly string[];
  file?: { name: string; bytes: ArrayBuffer };
}

export async function makeWidgetMap({
  payload: given,
  mapping,
  sourceIds,
  file,
}: WidgetMapInput): Promise<WidgetMap | null> {
  const payload = file
    ? { file: { name: file.name, data: base64Of(new Uint8Array(file.bytes)) } }
    : given;
  const parsed: ParsedFiles = new Map();
  const first = widgetMap(payload, mapping, sourceIds, parsed);
  if (!first?.needs.length) return first;
  await loadPlaceFiles([...first.needs].sort());
  return widgetMap(payload, mapping, sourceIds, parsed);
}
