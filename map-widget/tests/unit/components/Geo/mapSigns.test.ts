import { describe, expect, it } from "vitest";
import {
  drawMarkers,
  emphasisFirst,
  MARKER_SIZE,
  type PlacedMarker,
  signBox,
  signReach,
  signWord,
} from "~/components/Geo/mapSigns";
import { inkOn, MAP_THEMES, toneColor } from "~/components/Geo/mapTheme";
import { MAP_MARKER_TONES, MAP_MARKERS } from "~/lib/geo/mapMarkTypes";

const contrast = (a: string, b: string) => {
  const light = (hex: string) => {
    const [r, g, b] = [1, 3, 5]
      .map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255)
      .map((part) =>
        part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4,
      );
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [high, low] = [light(a), light(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};

describe("the colours of a sign", () => {
  it("are the colour of the tone in the theme, the accent without one, or the mark's own", () => {
    for (const theme of [MAP_THEMES.light, MAP_THEMES.dark]) {
      expect(toneColor(theme, undefined)).toBe(theme.tones.accent);
      for (const tone of MAP_MARKER_TONES)
        expect(toneColor(theme, tone)).toBe(theme.tones[tone]);
      expect(toneColor(theme, "#123abc")).toBe("#123abc");
      expect(toneColor(theme, "constructor")).toBe("constructor");
    }
  });

  it("keep the accent the colour the marked regions always had", () => {
    expect(MAP_THEMES.light.tones.accent).toBe(MAP_THEMES.light.mark);
    expect(MAP_THEMES.dark.tones.accent).toBe(MAP_THEMES.dark.mark);
  });

  it("carry a glyph that is read, in both themes and on a colour of the data", () => {
    for (const theme of [MAP_THEMES.light, MAP_THEMES.dark])
      for (const tone of MAP_MARKER_TONES)
        expect(
          contrast(theme.tones[tone], inkOn(theme.tones[tone])),
        ).toBeGreaterThanOrEqual(4.5);
    for (const own of [
      "#000000",
      "#ffffff",
      "#ff0000",
      "#00ff00",
      "#0000ff",
      "#777777",
    ])
      expect(contrast(own, inkOn(own))).toBeGreaterThanOrEqual(3);
  });

  it("stand out from the land, the sea and the middle of the scale of their theme", () => {
    const surfaces = { light: "#ffffff", dark: "#06122f" };
    for (const name of ["light", "dark"] as const) {
      const theme = MAP_THEMES[name];
      for (const tone of ["positive", "negative", "neutral"] as const) {
        expect(contrast(theme.tones[tone], theme.land)).toBeGreaterThanOrEqual(3);
        expect(contrast(theme.tones[tone], surfaces[name])).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("where a sign is drawn", () => {
  const point = (more: Partial<PlacedMarker> = {}): PlacedMarker => ({
    marker: "star",
    x: 100,
    y: 100,
    radius: 6,
    anchored: true,
    ...more,
  });

  it("is above a point, which stays in view", () => {
    for (const marker of ["pin", "check", "star", "flag", 7, 42] as const) {
      const box = signBox(point({ marker }));
      expect((box.left + box.right) / 2).toBe(100);
      expect(box.bottom).toBeLessThanOrEqual(100 - 6 + 2);
      expect(box.bottom - box.top).toBe(MARKER_SIZE);
    }
  });

  it("is on the middle of a region, a line, an area and a flow", () => {
    const box = signBox(point({ anchored: false, radius: undefined }));
    expect(box).toEqual({ left: 90, top: 90, right: 110, bottom: 110 });
  });

  it("is wider for a rank of two digits, so the number is not cut", () => {
    const one = signBox(point({ marker: 9 }));
    const two = signBox(point({ marker: 10 }));
    expect(one.right - one.left).toBe(MARKER_SIZE);
    expect(two.right - two.left).toBeGreaterThan(MARKER_SIZE);
    expect(signBox(point({ marker: 99 }))).toEqual(two);
  });

  it("is a circle around the mark for a ring: larger than the point, never under a size that is seen", () => {
    const small = signBox(point({ marker: "ring", radius: 3 }));
    const large = signBox(point({ marker: "ring", radius: 18 }));
    expect(small.right - small.left).toBeGreaterThanOrEqual(22);
    expect((small.left + small.right) / 2).toBe(100);
    expect((small.top + small.bottom) / 2).toBe(100);
    expect(large.right - large.left).toBeGreaterThanOrEqual(2 * (18 + 4));
    const region = signBox(
      point({ marker: "ring", anchored: false, radius: undefined }),
    );
    expect(region.right - region.left).toBeGreaterThanOrEqual(24);
  });

  it("says how far a tag stays from the mark: clear of the sign over it or around it", () => {
    expect(signReach(point({ marker: "star", radius: 3 }))).toBe(MARKER_SIZE / 2);
    expect(signReach(point({ marker: "star", radius: 16 }))).toBe(16);
    expect(signReach(point({ marker: 88, radius: 3 }))).toBeGreaterThan(
      MARKER_SIZE / 2,
    );
    const ring = point({ marker: "ring", radius: 8 });
    expect(signReach(ring)).toBe((signBox(ring).right - signBox(ring).left) / 2);
  });
});

describe("drawMarkers", () => {
  const layerOf = (markers: PlacedMarker[]) => {
    const layer = document.createElement("div");
    drawMarkers(layer, markers);
    return layer;
  };

  it("draws each sign of the list with a glyph of the app, and a ring without one", () => {
    const layer = layerOf(
      MAP_MARKERS.map((marker, at) => ({ marker, x: 40 * at + 20, y: 50 })),
    );
    expect(layer.children).toHaveLength(MAP_MARKERS.length);
    for (const badge of layer.children) {
      const sign = (badge as HTMLElement).dataset.marker;
      if (sign === "ring") expect(badge.querySelector("svg")).toBeNull();
      else
        expect(badge.querySelector("path")?.getAttribute("d")).toMatch(
          /^M[\d .a-zA-Z-]+$/,
        );
    }
    expect(layer.querySelectorAll("img, a, [href], [src], image, use")).toHaveLength(0);
  });

  it("writes a rank as its digits, in a text node", () => {
    const layer = layerOf([
      { marker: 3, x: 10, y: 10 },
      { marker: 42, x: 60, y: 10 },
    ]);
    expect([...layer.children].map((badge) => badge.textContent)).toEqual(["3", "42"]);
    expect(layer.querySelector("svg")).toBeNull();
    expect(layer.children[0].childNodes[0].nodeType).toBe(Node.TEXT_NODE);
  });

  it("draws in the colour it is given, with the ink that is read on it", () => {
    const layer = layerOf([
      { marker: "check", x: 10, y: 10, color: "#157a4e" },
      { marker: "ring", x: 60, y: 10, color: "#c8332a" },
      { marker: "star", x: 90, y: 10 },
    ]);
    const [badge, ring, plain] = [...layer.children] as HTMLElement[];
    expect(badge.style.backgroundColor).toBe("rgb(21, 122, 78)");
    expect(badge.style.color).toBe("rgb(255, 255, 255)");
    expect(ring.style.borderColor).toBe("rgb(200, 51, 42)");
    expect(ring.style.backgroundColor).toBe("");
    expect(plain.style.backgroundColor).toBe("");
  });

  it("reuses its elements when the signs change, and removes those that are gone", () => {
    const layer = layerOf([
      { marker: "star", x: 10, y: 10 },
      { marker: 5, x: 60, y: 10 },
    ]);
    const first = layer.children[0];
    drawMarkers(layer, [{ marker: 12, x: 30, y: 30, color: "#c8332a" }]);
    expect(layer.children).toHaveLength(1);
    expect(layer.children[0]).toBe(first);
    expect(first.textContent).toBe("12");
    expect(first.querySelector("svg")).toBeNull();
    drawMarkers(layer, [{ marker: "flag", x: 30, y: 30 }]);
    expect(first.textContent).toBe("");
    expect(first.querySelector("path")).not.toBeNull();
    expect((first as HTMLElement).style.backgroundColor).toBe("");
  });

  it("names a sign for the card of its mark", () => {
    expect(signWord("flag")).toBe("flag");
    expect(signWord(3)).toBe("rank 3");
  });
});

describe("the order the marks are tagged in", () => {
  it("puts the marks with a sign or a highlight first, so a cap leaves out the others", () => {
    const marks = [
      ...Array.from({ length: 300 }, () => ({})),
      { marker: 1 as const },
      { highlight: true as const },
      {},
    ];
    const order = emphasisFirst(marks, () => false);
    expect(order.slice(0, 2)).toEqual([300, 301]);
    expect(order).toHaveLength(marks.length);
    expect(order.slice(2, 5)).toEqual([0, 1, 2]);
    expect(emphasisFirst(marks, (at) => at === 302).slice(0, 3)).toEqual([
      300, 301, 302,
    ]);
  });
});
