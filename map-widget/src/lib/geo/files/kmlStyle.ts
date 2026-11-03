import type { GeoGeometry, GeoStyle } from "./types";
import { childOf, numberOf, textOf, type XmlNode } from "./xml";

interface Rgba {
  color: string;
  alpha: number;
}

function kmlColor(value: string): Rgba | undefined {
  const hex = /^[0-9a-fA-F]{8}$/.exec(value.trim())?.[0];
  if (!hex) return undefined;
  return {
    color: `#${hex.slice(6, 8)}${hex.slice(4, 6)}${hex.slice(2, 4)}`.toLowerCase(),
    alpha: Number.parseInt(hex.slice(0, 2), 16) / 255,
  };
}

export interface KmlStyle {
  line?: string;
  width?: number;
  fill?: string;
  fillOpacity?: number;
  icon?: string;
}

export function styleFrom(node: XmlNode | undefined): KmlStyle {
  const style: KmlStyle = {};
  if (!node) return style;
  const line = childOf(node, "LineStyle");
  if (line) {
    style.line = kmlColor(textOf(childOf(line, "color")))?.color;
    const width = numberOf(textOf(childOf(line, "width")));
    if (Number.isFinite(width)) style.width = width;
  }
  const poly = childOf(node, "PolyStyle");
  if (poly) {
    const color = kmlColor(textOf(childOf(poly, "color")));
    if (color) {
      style.fill = color.color;
      style.fillOpacity = Math.round(color.alpha * 1000) / 1000;
    }
    if (textOf(childOf(poly, "fill")) === "0") style.fillOpacity = 0;
    if (textOf(childOf(poly, "outline")) === "0") style.width = 0;
  }
  style.icon = kmlColor(textOf(childOf(childOf(node, "IconStyle"), "color")))?.color;
  return style;
}

export function styleFor(
  style: KmlStyle,
  type: GeoGeometry["type"],
): GeoStyle | undefined {
  const drawn: GeoStyle = {};
  if (type === "Point" || type === "MultiPoint") {
    const color = style.icon ?? style.line;
    if (color) drawn.color = color;
    return color ? drawn : undefined;
  }
  if (style.line) drawn.color = style.line;
  if (style.width !== undefined) drawn.lineWidth = style.width;
  if (type === "Polygon" || type === "MultiPolygon") {
    if (style.fill) drawn.fillColor = style.fill;
    if (style.fillOpacity !== undefined) drawn.fillOpacity = style.fillOpacity;
  }
  return Object.keys(drawn).length > 0 ? drawn : undefined;
}
