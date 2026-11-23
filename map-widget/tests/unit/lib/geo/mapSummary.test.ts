import { describe, expect, it } from "vitest";
import { MAP_LIMITS } from "~/lib/codemode/limits";
import { mapSpec } from "~/lib/geo/mapSpec";
import { mapSummary } from "~/lib/geo/mapSummary";

describe("mapSummary", () => {
  it("says what a map is in a few facts, never its positions", () => {
    const spec = mapSpec({
      title: "Unemployment",
      valueLabel: "Rate (%)",
      points: [
        { lat: 10, lon: 20, label: "A", tag: "1", value: 2 },
        { lat: -5, lon: 30, label: "B", value: 7 },
      ],
      regions: {
        set: "us-states",
        items: [{ code: "CA", value: 5.3, label: "California" }, { code: "nope" }],
      },
      shapes: [
        {
          type: "line",
          coordinates: [
            [0, 0],
            [40, 50],
          ],
        },
      ],
    });
    expect(mapSummary(spec)).toEqual({
      points: 2,
      regions: 1,
      regionSet: "us-states",
      shapes: 1,
      tags: 1,
      title: "Unemployment",
      valueLabel: "Rate (%)",
      bounds: [0, -5, 40, 50],
      valueRange: [2, 7],
      labels: ["A", "B", "California"],
      unmatched: 1,
      unmatchedCodes: ["nope"],
    });
  });

  it("is small for the largest map", () => {
    const spec = mapSpec({
      points: Array.from({ length: MAP_LIMITS.points }, (_, at) => ({
        lat: (at % 170) - 85,
        lon: (at % 350) - 175,
        label: `Point ${at} ${"x".repeat(35)}`,
        tag: "t",
        value: at,
      })),
    });
    expect(JSON.stringify(spec).length).toBeGreaterThan(MAP_LIMITS.chars * 0.9);
    expect(JSON.stringify(mapSummary(spec)).length).toBeLessThan(1200);
  });
});
