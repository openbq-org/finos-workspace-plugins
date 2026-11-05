import { compileFormatter } from "./expression.js";
import { withOpacity } from "./colors.js";

const DEFAULT_POINT_SIZE = 5;
const STYLE_KEYS = ["fill", "stroke", "strokeWidth", "size"];

function pick(style) {
  const out = {};
  if (!style || typeof style !== "object") return out;
  for (const key of STYLE_KEYS) if (style[key] !== undefined) out[key] = style[key];
  return out;
}

export function pointStyle(points, params) {
  if (!points || typeof points !== "object") return null;
  let style = null;
  const add = (s) => { if (s) style = { ...(style ?? {}), ...pick(s) }; };
  const y = params.yValue;
  if (points.positiveNegative && typeof y === "number") add(y >= 0 ? points.positiveNegative.positive : points.positiveNegative.negative);
  if ((params.first || params.last) && points.firstLast) add(points.firstLast);
  if (params.min && points.minimum) add(points.minimum);
  if (params.max && points.maximum) add(points.maximum);
  if (params.highlighted && points.highlighted) add(points.highlighted);
  return style;
}

function compile(source) {
  if (!source) return null;
  try {
    return compileFormatter(source);
  } catch (e) {
    console.warn("ag-grid sparkline customFormatter:", e.message);
    return null;
  }
}

function applyOpacity(style, opacity) {
  const out = { ...style };
  const alpha = typeof out.fillOpacity === "number" ? out.fillOpacity : opacity;
  if (out.fill && typeof alpha === "number") out.fill = withOpacity(out.fill, alpha);
  delete out.fillOpacity;
  return out;
}

export function pointParams(params) {
  const datum = params.datum && typeof params.datum === "object" ? params.datum : {};
  return {
    yValue: params.yValue ?? datum.y,
    xValue: params.xValue ?? datum.x,
    first: params.first ?? datum.first === true,
    last: params.last ?? datum.last === true,
    min: params.min ?? datum.min === true,
    max: params.max ?? datum.max === true,
    highlighted: typeof params.highlightState === "string" && params.highlightState.startsWith("highlighted"),
    datum,
  };
}

export function sparklineOptions(sparkline) {
  const type = sparkline?.type ?? "line";
  const o = sparkline?.options && typeof sparkline.options === "object" ? sparkline.options : {};
  const custom = compile(o.customFormatter);
  const points = o.pointsOfInterest;
  const options = { xKey: "x", yKey: "y" };
  if (o.padding) options.padding = { ...o.padding };
  if (typeof o.min === "number") options.min = o.min;
  if (typeof o.max === "number") options.max = o.max;

  if (type === "bar") {
    options.type = "bar";
    options.direction = o.direction === "horizontal" ? "horizontal" : "vertical";
    if (o.fill) options.fill = withOpacity(o.fill, o.fillOpacity);
    if (o.stroke) options.stroke = o.stroke;
    if (typeof o.strokeWidth === "number") options.strokeWidth = o.strokeWidth;
    if (points || custom) {
      options.itemStyler = (params) => {
        const at = pointParams(params);
        const style = { ...(pointStyle(points, at) ?? {}), ...(custom ? custom(at) : {}) };
        delete style.size;
        return applyOpacity(style, o.fillOpacity);
      };
    }
    return options;
  }

  options.type = type === "area" ? "area" : "line";
  if (o.stroke) options.stroke = o.stroke;
  if (typeof o.strokeWidth === "number") options.strokeWidth = o.strokeWidth;
  if (type === "area" && o.fill) options.fill = withOpacity(o.fill, o.fillOpacity ?? 0.3);

  const markers = o.markers && typeof o.markers === "object" ? o.markers : {};
  const markersOn = markers.enabled === true;
  if (markersOn || points || custom) {
    const base = markersOn ? pick(markers) : { size: 0 };
    options.marker = { enabled: true, ...base };
    options.marker.itemStyler = (params) => {
      const at = pointParams(params);
      const poi = pointStyle(points, at);
      const style = { ...base, ...(poi ?? {}), ...(custom ? custom(at) : {}) };
      if (!markersOn && poi && style.size === 0) style.size = DEFAULT_POINT_SIZE;
      return applyOpacity(style, undefined);
    };
  }
  return options;
}

export function sparklineData(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  if (value && typeof value === "object" && Array.isArray(value.values)) return value.values;
  return [];
}

export function sparklinePoints(value) {
  const values = sparklineData(value).map((v) => (typeof v === "number" ? v : Number(v)));
  const finite = values.filter(Number.isFinite);
  const min = finite.length ? Math.min(...finite) : null;
  const max = finite.length ? Math.max(...finite) : null;
  return values.map((y, x) => ({
    x,
    y: Number.isFinite(y) ? y : null,
    first: x === 0,
    last: x === values.length - 1,
    min: y === min,
    max: y === max,
  }));
}
