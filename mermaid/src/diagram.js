const FENCE = /^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/;

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 20;

export function sourceOf(response) {
  const text = typeof response === "string" ? response : response && typeof response === "object" ? response.diagram : null;
  if (typeof text !== "string") return null;
  const source = (FENCE.exec(text)?.[1] ?? text).trim();
  return source || null;
}

export const modeOf = (theme) => (theme?.mode === "light" ? "light" : "dark");

export const TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "border",
  "accent",
  "brand-main",
  "brand-lighter",
  "brand-darker",
  "alert-error",
  "alert-success",
  "alert-warning",
  "alert-informative",
];

export const SERIES = 12;

export const VARIABLES = [
  "fontFamily",
  "fontSize",
  "background",
  "textColor",
  "titleColor",
  "lineColor",
  "primaryColor",
  "primaryTextColor",
  "primaryBorderColor",
  "secondaryColor",
  "secondaryTextColor",
  "secondaryBorderColor",
  "tertiaryColor",
  "tertiaryTextColor",
  "tertiaryBorderColor",
  "mainBkg",
  "nodeBorder",
  "nodeTextColor",
  "clusterBkg",
  "clusterBorder",
  "edgeLabelBackground",
  "noteBkgColor",
  "noteTextColor",
  "noteBorderColor",
  "actorBkg",
  "actorBorder",
  "actorTextColor",
  "actorLineColor",
  "signalColor",
  "signalTextColor",
  "labelBoxBkgColor",
  "labelBoxBorderColor",
  "labelTextColor",
  "loopTextColor",
  "activationBkgColor",
  "activationBorderColor",
  "sequenceNumberColor",
  "errorBkgColor",
  "errorTextColor",
  "taskBkgColor",
  "taskBorderColor",
  "taskTextColor",
  "taskTextLightColor",
  "taskTextDarkColor",
  "taskTextOutsideColor",
  "activeTaskBkgColor",
  "activeTaskBorderColor",
  "doneTaskBkgColor",
  "doneTaskBorderColor",
  "critBkgColor",
  "critBorderColor",
  "gridColor",
  "sectionBkgColor",
  "altSectionBkgColor",
  "sectionBkgColor2",
  "todayLineColor",
  "attributeBackgroundColorOdd",
  "attributeBackgroundColorEven",
  "classText",
];

const XY_CHART = {
  backgroundColor: "--mm-xy-background-color",
  titleColor: "--mm-xy-title-color",
  xAxisLabelColor: "--mm-xy-label-color",
  xAxisTitleColor: "--mm-xy-label-color",
  xAxisTickColor: "--mm-xy-line-color",
  xAxisLineColor: "--mm-xy-line-color",
  yAxisLabelColor: "--mm-xy-label-color",
  yAxisTitleColor: "--mm-xy-label-color",
  yAxisTickColor: "--mm-xy-line-color",
  yAxisLineColor: "--mm-xy-line-color",
};

const kebab = (name) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

export function configFor(theme, read) {
  const value = (name) => String(read(name) ?? "").trim();
  const variables = { darkMode: modeOf(theme) === "dark" };
  for (const name of VARIABLES) {
    const color = value(`--mm-${kebab(name)}`);
    if (color) variables[name] = color;
  }
  const series = Array.from({ length: SERIES }, (_, i) => value(`--mm-series-${i + 1}`)).filter(Boolean);
  const label = value("--mm-series-label");
  series.forEach((color, i) => {
    variables[`cScale${i}`] = color;
    if (label) variables[`cScaleLabel${i}`] = label;
    if (i < 6) variables[`actor${i}`] = color;
    if (i < 8) {
      variables[`git${i}`] = color;
      if (label) variables[`gitBranchLabel${i}`] = label;
    }
  });
  const xyChart = Object.fromEntries(Object.entries(XY_CHART).map(([key, name]) => [key, value(name)]).filter(([, color]) => color));
  if (series.length) xyChart.plotColorPalette = series.join(",");
  if (Object.keys(xyChart).length) variables.xyChart = xyChart;
  const font = value("--mm-font-family");
  return {
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    htmlLabels: false,
    layout: "dagre",
    theme: "base",
    ...(font ? { fontFamily: font } : {}),
    themeVariables: variables,
  };
}

export function fit(content, area) {
  const k = Math.min(area.w / content.w, area.h / content.h, 1);
  return { k, x: (area.w - content.w * k) / 2, y: (area.h - content.h * k) / 2 };
}

export function zoomAt(view, factor, px, py) {
  const k = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.k * factor));
  const ratio = k / view.k;
  return { k, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio };
}

export function boxOf(viewBox) {
  const [x, y, w, h] = String(viewBox ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  return [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0 ? { x, y, w, h } : null;
}

export function exportSize(box, limit = 8192, scale = 2) {
  const factor = Math.min(scale, limit / Math.max(box.w, box.h));
  return { width: Math.round(box.w * factor), height: Math.round(box.h * factor) };
}
