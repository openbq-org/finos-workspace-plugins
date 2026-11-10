import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { gradientOf, LayerSwatch, sideBySide } from "~/components/Geo/LayerSwatch";
import { MAP_THEMES, mapScale } from "~/components/Geo/mapTheme";
import type { SceneLayer } from "~/components/Geo/sceneLayer";

type Swatched = Pick<SceneLayer, "swatch" | "color" | "ramp" | "scale" | "categories">;

const COLOR = "#ed9b44";
const swatch = (layer: Partial<Swatched>) => {
  const { container } = render(
    <LayerSwatch layer={{ swatch: "fill", color: COLOR, scale: null, ...layer }} />,
  );
  const drawn = container.querySelector("[data-swatch]");
  if (!drawn) throw new Error("no swatch was drawn");
  return drawn as HTMLElement | SVGElement;
};
const paintOf = (drawn: HTMLElement | SVGElement) =>
  drawn.style.background || (drawn.firstElementChild as HTMLElement).style.background;

describe("the colours of a swatch", () => {
  it("runs from the first colour to the last, and is one colour for one", () => {
    expect(gradientOf(["#111111", "#222222", "#333333"])).toBe(
      "linear-gradient(to right, #111111, #222222, #333333)",
    );
    expect(gradientOf(["#111111"])).toBe("#111111");
    expect(gradientOf([])).toBe("");
  });

  it("puts colours side by side with hard edges, each the same width", () => {
    expect(sideBySide(["#111111", "#222222"])).toBe(
      "linear-gradient(to right, #111111 0% 50%, #222222 50% 100%)",
    );
    expect(sideBySide(["#111111"])).toBe("#111111");
    expect(sideBySide([])).toBe("");
  });
});

describe("LayerSwatch", () => {
  it("is hidden from a screen reader: the name of the layer is beside it", () => {
    for (const kind of [
      "fill",
      "circle",
      "line",
      "heat",
      "arc",
      "column",
      "raster",
    ] as const)
      expect(swatch({ swatch: kind }).getAttribute("aria-hidden"), kind).toBe("true");
  });

  it("shows the one colour of a layer without values", () => {
    expect(paintOf(swatch({ swatch: "circle" }))).toBe("rgb(237, 155, 68)");
    expect(paintOf(swatch({ swatch: "line" }))).toBe("rgb(237, 155, 68)");
    expect(swatch({ swatch: "arc" }).getAttribute("stroke")).toBe(COLOR);
    expect(swatch({ swatch: "column" }).getAttribute("fill")).toBe(COLOR);
  });

  it("shows the scale of a layer with values, before its one colour", () => {
    const scale = mapScale(1, 9, MAP_THEMES.light);
    const paint = paintOf(swatch({ scale }));
    expect(paint).toContain("linear-gradient");
    expect(paint).not.toContain("237, 155, 68");
  });

  it("shows the colours of the categories of a layer that is drawn in them", () => {
    const paint = paintOf(swatch({ categories: ["#112233", "#445566"] }));
    expect(paint).toContain("rgb(17, 34, 51) 0% 50%");
    expect(paint).toContain("rgb(68, 85, 102) 50% 100%");
  });

  it("shows a density by its colours from sparse to dense", () => {
    const paint = paintOf(swatch({ swatch: "heat", ramp: ["#000004", "#fcfdbf"] }));
    expect(paint).toContain("rgb(0, 0, 4)");
    expect(paint).toContain("rgb(252, 253, 191)");
  });
});
