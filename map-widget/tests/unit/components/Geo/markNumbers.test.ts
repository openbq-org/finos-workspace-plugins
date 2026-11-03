import { describe, expect, it } from "vitest";
import { markNumbers } from "~/components/Geo/markNumbers";
import type { SceneMark } from "~/components/Geo/scene/sceneTypes";

const mark = (layer: string, more: Partial<SceneMark> = {}): SceneMark => ({
  kind: "point",
  layer,
  at: [0, 0],
  color: "#000",
  ...more,
});

describe("what the numbers of the marks of a map are", () => {
  it("decides the values of a layer once, from every mark of it", () => {
    const years = [mark("a", { value: 1931 }), mark("a", { value: 2004 })];
    const mixed = [mark("a", { value: 1931 }), mark("a", { value: 12 })];
    expect(markNumbers(years).value(years[0], "year_built")).toBe("year");
    expect(markNumbers(mixed).value(mixed[0], "year_built")).toBe("quantity");
    expect(markNumbers(mixed).value(mixed[1], "year_built")).toBe("quantity");
  });

  it("decides each layer by its own marks", () => {
    const marks = [
      mark("built", { value: 1931 }),
      mark("homes", { value: 1931 }),
      mark("homes", { value: 250000 }),
    ];
    const numbers = markNumbers(marks);
    expect(numbers.value(marks[0], "Year built")).toBe("year");
    expect(numbers.value(marks[1], "Year built")).toBe("quantity");
  });

  it("decides what the points are sized by, and each of the other values, as a column", () => {
    const marks = [
      mark("a", { size: 2019, props: { parcel_id: 10482233, fiscal_year: 2020 } }),
      mark("a", { size: 2020, props: { parcel_id: 7, fiscal_year: 2020.5 } }),
    ];
    const numbers = markNumbers(marks);
    expect(numbers.size(marks[0], "Vintage")).toBe("year");
    expect(numbers.prop(marks[1], "parcel_id")).toBe("identifier");
    expect(numbers.prop(marks[0], "fiscal_year")).toBe("quantity");
  });

  it("gives the rule the other values of a mark as the columns beside one of them", () => {
    const pair = [mark("a", { props: { lat: 40.7127753, long: -74.0059728 } })];
    const held = [mark("a", { props: { long: 1250, short: 300 } })];
    expect(markNumbers(pair).prop(pair[0], "long")).toBe("coordinate");
    expect(markNumbers(held).prop(held[0], "long")).toBe("quantity");
  });

  it("reads a mark that is none of the scene by its own values", () => {
    const numbers = markNumbers([mark("a", { value: 12 })]);
    const group = mark("a", { props: { "Sum of visitors": 2020 } });
    expect(numbers.prop(group, "Sum of visitors")).toBe("quantity");
    expect(numbers.value(mark("other", { value: 1931 }), "year")).toBe("year");
  });
});
