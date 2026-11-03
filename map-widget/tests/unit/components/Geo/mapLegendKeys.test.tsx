import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import MapLegends from "~/components/Geo/MapLegends";
import { KEY_LINES, legendKeys, SUMMED } from "~/components/Geo/mapLegendKeys";
import { scene } from "./scene/support";

const all = () => true;
const NONE: ReadonlySet<string> = new Set();
const keysOf = (raw: unknown, grouped: ReadonlySet<string> = NONE) => {
  const built = scene(raw);
  return legendKeys(built.marks, all, built.layers, grouped);
};
const stores = (more: (at: number) => object = () => ({})) =>
  Array.from({ length: 6 }, (_, at) => ({
    lat: 30 + at,
    lon: -100 + at * 3,
    ...more(at),
  }));

describe("what a legend says of the signs of a map", () => {
  it("says nothing of a map without signs and sizes", () => {
    expect(keysOf({ points: stores() })).toEqual([]);
  });

  it("explains each sign once, by what it is when the map does not say what it means", () => {
    const keys = keysOf({
      points: stores((at) =>
        at === 0
          ? { marker: "star" }
          : at === 1
            ? { marker: "star" }
            : at === 2
              ? { marker: 1 }
              : at === 3
                ? { highlight: true, markerColor: "negative" }
                : {},
      ),
    });
    expect(keys.map(({ sign, text }) => [sign, text])).toEqual([
      ["star", "Marked"],
      ["rank", "Ranked"],
      ["highlight", "Highlighted"],
    ]);
    expect(keys[2].tone).toMatch(/^#/);
    expect(keys[0].tone).toBeDefined();
  });

  it("explains a sign by what the map says it means, one line for each meaning", () => {
    const keys = keysOf({
      points: stores((at) =>
        at < 2
          ? { highlight: true, meaning: "Built before 1950" }
          : at === 2
            ? { marker: "star", meaning: "Tallest" }
            : {},
      ),
    });
    expect(keys.map(({ sign, text }) => [sign, text])).toEqual([
      ["highlight", "Built before 1950"],
      ["star", "Tallest"],
    ]);
  });

  it("has a few lines at most, and only for what is on the map", () => {
    const signs = ["pin", "check", "star", "flag", "ring"];
    const marked = { points: stores((at) => ({ marker: signs[at % signs.length] })) };
    expect(keysOf(marked)).toHaveLength(KEY_LINES);
    const built = scene(marked);
    expect(legendKeys(built.marks, () => false, built.layers, NONE)).toEqual([]);
  });

  it("says what bubbles are sized by, and what a circle of them says when they are grouped", () => {
    const sized = {
      sizeLabel: "teu",
      points: stores((at) => ({ size: at + 1 })),
    };
    expect(keysOf(sized)).toEqual([{ id: "size:teu", text: "Size: teu" }]);
    expect(keysOf({ ...sized, sizeLabel: "TEU_total" })[0].text).toBe(
      "Size: TEU total",
    );
    expect(keysOf(sized, new Set(["points"])).map((key) => key.text)).toEqual([
      "Size: teu",
      SUMMED,
    ]);
    expect(
      keysOf({
        valueLabel: "Revenue",
        sizeLabel: "Revenue",
        points: stores((at) => ({ size: at + 1, value: at + 1 })),
      }),
    ).toEqual([]);
  });
});

describe("the legend of a map with signs", () => {
  it("has a line for each, under the scale of the values", () => {
    const built = scene({
      valueLabel: "Rate",
      points: stores((at) => ({ value: at, ...(at === 2 ? { marker: "flag" } : {}) })),
    });
    render(
      <MapLegends
        layers={built.layers}
        closed={false}
        onToggle={() => undefined}
        compact
        keys={legendKeys(built.marks, all, built.layers, NONE)}
      />,
    );
    const legend = screen.getByRole("group", { name: "Legend" });
    expect(legend.textContent).toContain("Rate");
    expect(legend.querySelector("[data-map-legend-keys]")?.textContent).toBe(
      "flagMarked",
    );
  });

  it("is a legend of its own on a map whose one layer has no scale", () => {
    const built = scene({ points: stores((at) => (at ? {} : { marker: "star" })) });
    const keys = legendKeys(built.marks, all, built.layers, NONE);
    const { container } = render(
      <MapLegends
        layers={built.layers}
        closed={false}
        onToggle={() => undefined}
        compact
        keys={keys}
      />,
    );
    expect(container.querySelector("[data-map-legend]")?.textContent).toBe(
      "starMarked",
    );
    const plain = render(
      <MapLegends
        layers={built.layers}
        closed={false}
        onToggle={() => undefined}
        compact
      />,
    );
    expect(plain.container.querySelector("[data-map-legend]")).toBeNull();
  });
});

describe("the legend of layers whose marks have colours of their own", () => {
  const area = (lon: number, color: string) => ({
    type: "polygon",
    color,
    coordinates: [
      [
        [lon, 0],
        [lon + 1, 0],
        [lon + 1, 1],
        [lon, 0],
      ],
    ],
  });
  const built = scene({
    layers: [
      {
        kind: "polygons",
        name: "Estate boundaries (synthetic) / Riau Agro",
        shapes: [area(0, "#e08a3c"), area(2, "#e08a3c")],
      },
      {
        kind: "polygons",
        name: "Estate boundaries (synthetic) / Siak Estates",
        shapes: [area(4, "#e08a3c"), area(6, "#2e8b57")],
      },
    ],
  });

  it("shows the colours that are drawn, not the colour the layer would have had", () => {
    expect(built.layers[0].color).toBe("#e08a3c");
    expect(built.layers[0].colors).toBeUndefined();
    expect(built.layers[1].colors).toEqual(["#e08a3c", "#2e8b57"]);
    const plain = scene({
      layers: [{ kind: "polygons", shapes: [{ ...area(0, ""), color: undefined }] }],
    });
    expect(plain.layers[0].colors).toBeUndefined();
  });

  it("names two layers of one file by what tells them apart", () => {
    render(
      <MapLegends
        layers={built.layers}
        closed={false}
        onToggle={() => undefined}
        compact={false}
      />,
    );
    const legend = screen.getByRole("group", { name: "Legend" });
    const names = [...legend.querySelectorAll("li span[title]")].map(
      (item) => item.textContent,
    );
    expect(names).toEqual(["Siak Estates", "Riau Agro"]);
    const swatches = [...legend.querySelectorAll("[data-swatch]")] as HTMLElement[];
    expect(swatches[1].style.background).toContain("rgb(224, 138, 60)");
    expect(swatches[0].style.background).toContain("gradient");
  });
});
