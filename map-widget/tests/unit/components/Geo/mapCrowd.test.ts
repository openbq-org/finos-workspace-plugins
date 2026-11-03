import { describe, expect, it } from "vitest";
import {
  coincidingDots,
  crowded,
  crowdedSized,
  type Dot,
  hiddenDots,
  onTrack,
  placeKey,
  SIZED_CROWD_LEAST,
} from "~/components/Geo/mapCrowd";
import { cpuBudget, cpuNow } from "../../machinePace";

const dot = (x: number, y: number, r = 6): Dot => ({ x, y, r });

describe("whether the points of a map are crowded where it opens", () => {
  it("counts a point whose middle is inside the dot of another", () => {
    expect(hiddenDots([dot(10, 10), dot(12, 10), dot(100, 100)])).toBe(2);
    expect(hiddenDots([dot(10, 10), dot(21, 10)])).toBe(0);
    expect(hiddenDots([dot(10, 10)])).toBe(0);
    expect(hiddenDots([])).toBe(0);
  });

  it("reads two shops of one city as a crowd: the one dot is two", () => {
    expect(crowded([dot(50, 50), dot(50, 50), dot(200, 200), dot(300, 80)])).toBe(true);
  });

  it("leaves a map whose points are apart as it is", () => {
    const apart = Array.from({ length: 40 }, (_, at) => dot(at * 20, (at % 5) * 20));
    expect(crowded(apart)).toBe(false);
  });

  it("needs a tenth of the points, so one pair among many is not a crowd", () => {
    const apart = Array.from({ length: 40 }, (_, at) => dot(at * 20, 300));
    expect(crowded([...apart, dot(0, 0), dot(1, 0)])).toBe(false);
    const clump = Array.from({ length: 6 }, (_, at) => dot(at, 0));
    expect(crowded([...apart, ...clump])).toBe(true);
  });

  it("keeps a map of sized points that overlap at their edges: the small one is seen", () => {
    expect(crowded([dot(0, 0, 20), dot(26, 0, 8), dot(60, 0, 20), dot(86, 0, 8)])).toBe(
      false,
    );
  });

  it("measures the most points a map has, each against its neighbours only", () => {
    const many = Array.from({ length: 20_000 }, (_, at) =>
      dot((at % 200) * 2, Math.floor(at / 200) * 2, 3),
    );
    expect(hiddenDots(many)).toBe(20_000);
    expect(crowded(many)).toBe(true);
  });
});

describe("bubbles sized by a value", () => {
  const bubble = (x: number, y: number, r: number): Dot => ({ x, y, r });

  it("coincide when their middles are nearer than half the radius of the smaller", () => {
    expect(coincidingDots([bubble(0, 0, 20), bubble(18, 0, 6)])).toBe(0);
    expect(coincidingDots([bubble(0, 0, 20), bubble(2, 0, 6)])).toBe(2);
    expect(coincidingDots([bubble(0, 0, 20), bubble(3.5, 0, 6)])).toBe(0);
    expect(coincidingDots([bubble(0, 0, 12), bubble(4, 0, 12)])).toBe(2);
    expect(coincidingDots([bubble(0, 0, 12), bubble(7, 0, 12)])).toBe(0);
    expect(coincidingDots([bubble(0, 0, 3), bubble(1.9, 0, 3)])).toBe(2);
    expect(coincidingDots([bubble(0, 0, 3), bubble(2.1, 0, 3)])).toBe(0);
  });

  it("keep their sizes while they only overlap: a map of proportional signs is no crowd", () => {
    const row = Array.from({ length: 40 }, (_, at) => bubble(at * 8, 0, 12));
    expect(crowded(row)).toBe(true);
    expect(crowdedSized(row)).toBe(false);
  });

  it("are grouped only when half of them coincide, and ten at least", () => {
    const pile = (count: number) =>
      Array.from({ length: count }, (_, at) => bubble(100 + (at % 3), 100, 10));
    const apart = (count: number) =>
      Array.from({ length: count }, (_, at) => bubble(at * 60, 300, 10));
    expect(crowdedSized(pile(9))).toBe(false);
    expect(crowdedSized(pile(SIZED_CROWD_LEAST))).toBe(true);
    expect(crowdedSized([...pile(10), ...apart(20)])).toBe(false);
    expect(crowdedSized([...pile(20), ...apart(20)])).toBe(true);
  });

  it("is linear enough for the points of a map", () => {
    const many = Array.from({ length: 20_000 }, (_, at) =>
      bubble((at * 37) % 900, (at * 91) % 500, 3 + (at % 17)),
    );
    const start = cpuNow();
    coincidingDots(many);
    expect(cpuNow() - start).toBeLessThan(cpuBudget(1500));
  });
});

describe("the points of a track", () => {
  const joints = new Set([placeKey(-90, 25), placeKey(-89, 26), placeKey(-88, 27.5)]);
  const at = (lon: number, lat: number) => ({ lon, lat });

  it("are those where a line or a flow of the map turns or ends", () => {
    expect(onTrack([at(-90, 25), at(-89, 26), at(-88, 27.5)], joints)).toBe(true);
    expect(onTrack([at(-90.0000001, 25), at(-89, 26.0000002)], joints)).toBe(true);
  });

  it("are half of the layer at least, and two", () => {
    const stores = Array.from({ length: 7 }, (_, n) => at(-100 - n, 40));
    expect(onTrack([at(-90, 25), at(-89, 26), at(-88, 27.5), ...stores], joints)).toBe(
      false,
    );
    expect(onTrack([at(-90, 25), at(-89, 26), at(-70, 40), at(-71, 41)], joints)).toBe(
      true,
    );
    expect(onTrack([at(-90, 25)], joints)).toBe(false);
    expect(onTrack([at(-90, 25), at(-89, 26)], new Set())).toBe(false);
  });
});
