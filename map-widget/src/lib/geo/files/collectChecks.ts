import { UNPRINTED_CHARACTER } from "../mapValues";
import type { GeoGeometry, GeoStyle } from "./types";

const UNCLEAN = new RegExp(`(?:\\s|${UNPRINTED_CHARACTER})+`, "g");

const ADDRESS = /:\/\/|^\s*(?:javascript|data|vbscript|file|blob|mailto):/i;

export const isAddress = (text: string) => ADDRESS.test(text);

export function boundedText(
  value: string,
  max: number,
): { text: string; cut: boolean } {
  const head = value.length > max * 4 + 64 ? value.slice(0, max * 4 + 64) : value;
  const clean = head.replace(UNCLEAN, " ").trim();
  if (clean.length <= max && head.length === value.length)
    return { text: clean, cut: false };
  let text = clean.slice(0, max);
  const last = text.charCodeAt(text.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) text = text.slice(0, -1);
  return { text: text.trimEnd(), cut: true };
}

const HEX_COLOR = /^#[0-9a-f]{6}$/;

export function checkedStyle(raw: GeoStyle | undefined): GeoStyle | undefined {
  if (!raw) return undefined;
  const style: GeoStyle = {};
  for (const key of ["color", "fillColor"] as const) {
    const value = raw[key];
    if (typeof value !== "string") continue;
    const lower = value.trim().toLowerCase();
    const long = /^#[0-9a-f]{3}$/.test(lower)
      ? `#${lower[1]}${lower[1]}${lower[2]}${lower[2]}${lower[3]}${lower[3]}`
      : lower;
    if (HEX_COLOR.test(long)) style[key] = long;
  }
  if (typeof raw.lineWidth === "number" && Number.isFinite(raw.lineWidth))
    style.lineWidth = Math.min(32, Math.max(0, raw.lineWidth));
  if (typeof raw.fillOpacity === "number" && Number.isFinite(raw.fillOpacity))
    style.fillOpacity = Math.min(1, Math.max(0, raw.fillOpacity));
  return Object.keys(style).length > 0 ? style : undefined;
}

export function positionCount(geometry: GeoGeometry): number {
  switch (geometry.type) {
    case "Point":
      return 1;
    case "MultiPoint":
    case "LineString":
      return geometry.coordinates.length;
    case "MultiLineString":
    case "Polygon": {
      let total = 0;
      for (const part of geometry.coordinates) total += part.length;
      return total;
    }
    case "MultiPolygon": {
      let total = 0;
      for (const polygon of geometry.coordinates)
        for (const ring of polygon) total += ring.length;
      return total;
    }
  }
}

export function partCount(geometry: GeoGeometry): number {
  switch (geometry.type) {
    case "MultiLineString":
    case "Polygon":
      return geometry.coordinates.length;
    case "MultiPolygon": {
      let total = 0;
      for (const polygon of geometry.coordinates) total += polygon.length;
      return total;
    }
    default:
      return 1;
  }
}
