import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";
import { inkOn, type MapScale, type MapTheme } from "../mapTheme";

const SUM_RADIUS = { least: 9, most: 34 } as const;

function shortSum(value: ExpressionSpecification): ExpressionSpecification {
  const part = (by: number, unit: string): ExpressionSpecification => [
    "concat",
    ["to-string", ["/", ["round", ["/", value, by / 10]], 10]],
    unit,
  ];
  return [
    "case",
    [">=", value, 1e9],
    part(1e9, "B"),
    [">=", value, 1e6],
    part(1e6, "M"),
    [">=", value, 1e3],
    part(1e3, "K"),
    ["to-string", ["/", ["round", ["*", value, 10]], 10]],
  ] as ExpressionSpecification;
}

export function average(scale: MapScale, other: string): ExpressionSpecification {
  const span = scale.max - scale.min;
  const stops = scale.stops.flatMap((stop, at) => [
    scale.min + (span * at) / (scale.stops.length - 1),
    stop,
  ]);
  const valued: ExpressionSpecification = ["to-number", ["get", "valued"]];
  return [
    "case",
    [">", valued, 0],
    span > 0
      ? [
          "interpolate",
          ["linear"],
          ["/", ["to-number", ["get", "sum"]], valued],
          ...stops,
        ]
      : scale.color(scale.min),
    other,
  ] as ExpressionSpecification;
}

const COUNT_FONT = ["Noto Sans Medium"];
const GROUP_SIZES = [11, 10, 14, 100, 17] as const;
const MARKED_GROUP_SIZES = [16, 100, 19] as const;

export function dominant(
  counts: readonly string[],
  colours: readonly string[],
  other: string,
): ExpressionSpecification | string {
  if (!counts.length) return other;
  const n = (property: string) => ["to-number", ["get", property]];
  const cases: unknown[] = [];
  counts.forEach((count, at) => {
    const most: unknown[] = [[">", n(count), 0]];
    for (const later of [...counts.slice(at + 1), "plain"])
      most.push([">=", n(count), n(later)]);
    cases.push(["all", ...most], colours[at]);
  });
  return ["case", ...cases, other] as ExpressionSpecification;
}

export const IN_GROUP: ExpressionSpecification = ["has", "point_count"];

export function groupLayers({
  base,
  theme,
  fill,
  tone,
  largest,
  opacity,
  averaged,
  counts,
  colours,
  neutral,
}: {
  base: string;
  theme: MapTheme;
  fill: ExpressionSpecification | string;
  tone: string;
  largest: number;
  opacity: number;
  averaged: boolean;
  counts: readonly string[];
  colours: readonly string[];
  neutral: string;
}): LayerSpecification[] {
  const groups = `${base}-groups`;
  const sized = largest > 0;
  const some: ExpressionSpecification = [">", ["to-number", ["get", "marked"]], 0];
  const total: ExpressionSpecification = [
    "to-string",
    ["get", "point_count_abbreviated"],
  ];
  const sum: ExpressionSpecification = ["to-number", ["get", "total"]];
  const sumRadius: ExpressionSpecification = [
    "min",
    SUM_RADIUS.most,
    ["max", SUM_RADIUS.least, ["+", 3, ["*", 17, ["sqrt", ["/", sum, largest || 1]]]]],
  ];
  return [
    {
      id: groups,
      type: "circle",
      source: base,
      filter: IN_GROUP,
      paint: {
        "circle-color": ["case", some, theme.markStroke, fill],
        "circle-opacity": opacity,
        "circle-radius": sized
          ? sumRadius
          : [
              "case",
              some,
              ["step", ["get", "point_count"], ...MARKED_GROUP_SIZES],
              ["step", ["get", "point_count"], ...GROUP_SIZES],
            ],
        "circle-stroke-color": ["case", some, tone, theme.markStroke],
        "circle-stroke-width": ["case", some, 3, 1.5],
      },
    },
    {
      id: `${base}-count`,
      type: "symbol",
      source: base,
      filter: IN_GROUP,
      layout: {
        "text-field": sized
          ? shortSum(sum)
          : [
              "case",
              some,
              [
                "format",
                ["to-string", ["get", "marked"]],
                {},
                "\nof ",
                { "font-scale": 0.8 },
                total,
                { "font-scale": 0.8 },
              ],
              ["format", total, {}],
            ],
        "text-font": COUNT_FONT,
        "text-size": 11,
        "text-line-height": 1,
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": sized
          ? theme.hover
          : [
              "case",
              some,
              theme.hover,
              averaged
                ? theme.hover
                : dominant(counts, colours.map(inkOn), inkOn(neutral)),
            ],
        ...(averaged || sized
          ? { "text-halo-color": theme.markStroke, "text-halo-width": 1.2 }
          : {}),
      },
    },
  ];
}
