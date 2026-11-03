import { memo } from "react";
import type { SceneLayer } from "./sceneLayer";

const BOX = "flex size-3 shrink-0 items-center justify-center";
const EDGE = "border border-general-border-primary";

export const gradientOf = (stops: readonly string[]) =>
  stops.length > 1
    ? `linear-gradient(to right, ${stops.join(", ")})`
    : (stops[0] ?? "");

export const sideBySide = (colors: readonly string[]) =>
  colors.length > 1
    ? `linear-gradient(to right, ${colors
        .map(
          (color, at) =>
            `${color} ${(at * 100) / colors.length}% ${((at + 1) * 100) / colors.length}%`,
        )
        .join(", ")})`
    : (colors[0] ?? "");

export const LayerSwatch = memo(function LayerSwatch({
  layer,
}: {
  layer: Pick<
    SceneLayer,
    "swatch" | "color" | "ramp" | "scale" | "categories" | "colors"
  >;
}) {
  const { swatch, color } = layer;
  const paint = layer.scale
    ? gradientOf(layer.scale.stops)
    : layer.categories?.length
      ? sideBySide(layer.categories)
      : layer.colors?.length
        ? sideBySide(layer.colors)
        : color;
  switch (swatch) {
    case "circle":
      return (
        <span aria-hidden data-swatch={swatch} className={BOX}>
          <span
            className={`size-2.5 rounded-full ${EDGE}`}
            style={{ background: paint }}
          />
        </span>
      );
    case "line":
      return (
        <span aria-hidden data-swatch={swatch} className={BOX}>
          <span className="h-0.5 w-3 rounded-full" style={{ background: paint }} />
        </span>
      );
    case "heat":
      return (
        <span
          aria-hidden
          data-swatch={swatch}
          className={`${BOX} rounded-full ${EDGE}`}
          style={{ background: gradientOf(layer.ramp ?? [color]) }}
        />
      );
    case "arc":
      return (
        <svg
          aria-hidden
          data-swatch={swatch}
          viewBox="0 0 12 12"
          className="size-3 shrink-0"
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
        >
          <path d="M1.5 10 Q6 -3 10.5 10" />
        </svg>
      );
    case "column":
      return (
        <svg
          aria-hidden
          data-swatch={swatch}
          viewBox="0 0 12 12"
          className="size-3 shrink-0"
          fill={color}
        >
          <rect x="1" y="7" width="2.5" height="4" />
          <rect x="4.75" y="1" width="2.5" height="10" />
          <rect x="8.5" y="4.5" width="2.5" height="6.5" />
        </svg>
      );
    case "raster":
      return (
        <span
          aria-hidden
          data-swatch={swatch}
          className={`${BOX} rounded-sm ${EDGE}`}
          style={{
            background: `conic-gradient(${color} 25%, transparent 0 50%, ${color} 0 75%, transparent 0)`,
          }}
        />
      );
    default:
      return (
        <span
          aria-hidden
          data-swatch="fill"
          className={`${BOX} rounded-sm ${EDGE}`}
          style={{ background: paint }}
        />
      );
  }
});
