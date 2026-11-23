import { describe, expect, it } from "vitest";
import { mapSpec } from "~/lib/geo/mapSpec";
import { heading } from "~/lib/geo/mapValues";

const POINT = { lat: 41.9, lon: -87.6 };

describe("the texts that name a map", () => {
  it("write a long dash as a plain hyphen, and leave a range of years as it is", () => {
    expect(heading("Balyasny offices — 3D", 120)).toBe("Balyasny offices - 3D");
    expect(heading("Offices—3D", 120)).toBe("Offices - 3D");
    expect(heading("Cocoa production, 2016–2025", 120)).toBe(
      "Cocoa production, 2016–2025",
    );
    expect(heading(heading("A — B", 120), 120)).toBe("A - B");
    expect(heading(null, 120)).toBeUndefined();
  });

  it("are read so by the reducer: the title, the label of the scale and the name of a layer", () => {
    const map = mapSpec({
      title: "Offices — 3D",
      valueLabel: "Staff — 2026",
      layers: [{ kind: "points", name: "Offices — Europe", points: [POINT] }],
    });
    expect(map.title).toBe("Offices - 3D");
    expect(map.valueLabel).toBe("Staff - 2026");
    expect(map.layers?.[0].name).toBe("Offices - Europe");
    expect(
      mapSpec({ points: [{ ...POINT, label: "Rhine — Scheldt" }] }).points?.[0].label,
    ).toBe("Rhine — Scheldt");
  });
});

describe("a long dash between two numbers", () => {
  it("is a plain hyphen without spaces: a range of years reads as one", () => {
    expect(heading("Yields 1990\u20142020", 120)).toBe("Yields 1990-2020");
    expect(heading("1990 \u2014 2020", 120)).toBe("1990-2020");
    expect(heading("Offices\u20143D", 120)).toBe("Offices - 3D");
    expect(heading("Offices \u2014 2020 plan", 120)).toBe("Offices - 2020 plan");
  });
});
