import { describe, expect, it } from "vitest";
import { mapSpec } from "~/lib/geo/mapSpec";
import { mapSummary } from "~/lib/geo/mapSummary";
import { FLAT_NOTE, tooWideToTilt } from "~/lib/geo/mapTilt";

const office = (lat: number, lon: number, label: string) => ({ lat, lon, label });
const LONDON = [
  office(51.514, -0.089, "City"),
  office(51.505, -0.02, "Canary Wharf"),
  office(51.47, -0.44, "Heathrow"),
];
const WORLD = [
  office(41.88, -87.63, "Chicago"),
  office(51.51, -0.13, "London"),
  office(1.35, 103.82, "Singapore"),
];

describe("the tilt a map asks for", () => {
  it("is kept on a map of one city", () => {
    const map = mapSpec({ points: LONDON, pitch: 45 });
    expect(map.pitch).toBe(45);
    expect(map.notes ?? []).not.toContain(FLAT_NOTE);
  });

  it("is left out on a map as wide as the world, which says why", () => {
    const map = mapSpec({ points: WORLD, pitch: 45, context: ["buildings-3d"] });
    expect(map.pitch).toBeUndefined();
    expect(map.notes).toEqual([FLAT_NOTE]);
    expect(mapSummary(map).notes).toEqual([FLAT_NOTE]);
    expect(mapSpec(map)).toEqual(map);
  });

  it("is kept for bars, which stand on a tilted map at any width", () => {
    const map = mapSpec({
      layers: [{ kind: "columns", points: WORLD.map((p) => ({ ...p, value: 3 })) }],
      pitch: 50,
    });
    expect(map.pitch).toBe(50);
    expect(map.notes ?? []).not.toContain(FLAT_NOTE);
  });

  it("is judged by the width of the marks: three degrees is a large region", () => {
    expect(tooWideToTilt([-0.6, 51.3, 0.1, 51.6])).toBe(false);
    expect(tooWideToTilt([-3.2, 51.3, 0.1, 51.6])).toBe(true);
    expect(tooWideToTilt([0, 40, 1, 44.5])).toBe(true);
    expect(tooWideToTilt(undefined)).toBe(false);
  });
});
