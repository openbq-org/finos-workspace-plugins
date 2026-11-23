import type { MapLayerKind } from "~/lib/geo/mapLayers";
import type { MapScale } from "./mapTheme";

export interface SceneLayer {
  id: string;
  name: string;
  kind: MapLayerKind;
  group?: string;
  count: number;
  visible?: false;
  opacity?: number;
  parts: { id: string; opacity: Record<string, number> }[];
  valueLabel?: string;
  scale: MapScale | null;
  color: string;
  categories?: readonly string[];
  colors?: readonly string[];
  sizeLabel?: string;
  sized?: true;
  swatch: "fill" | "circle" | "line" | "heat" | "arc" | "column" | "raster";
  ramp?: readonly string[];
  groupable?: true;
  note?: string;
  attribution?: string;
  from?: number;
}
