import { describe, expect, it } from "vitest";
import { MAP_LIMITS } from "~/lib/codemode/limits";
import { mapSpec } from "~/lib/geo/mapSpec";
import { ELLIPSIS, tagOf } from "~/lib/geo/mapValues";

const MAX = MAP_LIMITS.tagChars;

describe("the tag of a mark that is too long", () => {
  it("is not cut inside a date: the date goes whole, and an ellipsis says the text goes on", () => {
    const cut = tagOf("City of London Office 1: opened 2026-03-27", MAX);
    expect(cut).toBe(`City of London Office 1: opened${ELLIPSIS}`);
    expect((cut as string).length).toBeLessThanOrEqual(MAX);
  });

  it("is not cut inside a number", () => {
    expect(tagOf("Kuala Cenaku Estate, Riau, Indonesia: 23,792 ha", MAX)).toBe(
      `Kuala Cenaku Estate, Riau, Indonesia${ELLIPSIS}`,
    );
  });

  it("keeps as much of a long word as fits, with the ellipsis inside the limit", () => {
    const word = "x".repeat(60);
    const cut = tagOf(word, MAX) as string;
    expect(cut).toBe(`${"x".repeat(MAX - 1)}${ELLIPSIS}`);
    expect(cut.length).toBe(MAX);
  });

  it("leaves a tag that fits as it is, and reads its own result as it is", () => {
    expect(tagOf("4.2%", MAX)).toBe("4.2%");
    expect(tagOf("a".repeat(MAX), MAX)).toBe("a".repeat(MAX));
    const cut = tagOf("Southwark Office 4: opened on 2026-06-25 by the board", MAX);
    expect(tagOf(cut, MAX)).toBe(cut);
    expect(tagOf(undefined, MAX)).toBeUndefined();
  });

  it("is how the reducer of a map reads a tag, so a map is reduced to the same map twice", () => {
    const raw = {
      points: [
        { lat: 51.5, lon: -0.1, tag: "City of London Office 1: opened 2026-03-27" },
      ],
    };
    const once = mapSpec(raw);
    expect(once.points?.[0].tag).toBe(`City of London Office 1: opened${ELLIPSIS}`);
    expect(mapSpec(once)).toEqual(once);
  });
});

describe("a tag whose first word is a number or a date that passes the limit", () => {
  it("is never cut inside it: it ends at the last whole part, or there is no tag", () => {
    const dates = "2026-09-01/2026-12-31/2027-03-31/2027-06-30/2027-09-30";
    expect(tagOf(dates, 40)).toBe("2026-09-01/2026-12-31/2027-03-31\u2026");
    expect(tagOf("1".repeat(45), 40)).toBeUndefined();
    expect(tagOf("a".repeat(45), 40)).toBe(`${"a".repeat(39)}\u2026`);
  });
});
