import { describe, expect, it, vi } from "vitest";
import {
  dotBox,
  type PlacedMarker,
  signBox,
  signReach,
} from "~/components/Geo/mapSigns";
import {
  NAMED_POINTS_TAGGED,
  namesAsTags,
  placeTags,
  type TagCandidate,
  TRACK_AIR,
  tagMeasure,
  tagText,
  tagWidth,
  trackOrder,
} from "~/components/Geo/mapTags";
import { MAP_LIMITS } from "~/lib/codemode/limits";

const tag = (more: Partial<TagCandidate> & { x: number; y: number }): TagCandidate => ({
  mark: 0,
  text: "Tallest: 278 Wacker Exchange (37 m)",
  note: false,
  offset: 14,
  centred: false,
  ...more,
});
const sign = (x: number, y: number) => ({
  left: x - 10,
  top: y - 10,
  right: x + 10,
  bottom: y + 10,
});

describe("the tag of a mark an answer singles out", () => {
  const taken = [
    sign(258, 131),
    sign(207, 180),
    { left: 0, top: 0, right: 436, bottom: 48 },
  ];
  const tallest = tag({ x: 137, y: 145, marked: true });

  it("is placed along the row above or below its mark when none of its eight places is free", () => {
    expect(tagWidth(tallest.text)).toBeGreaterThan(200);
    const [placed] = placeTags([tallest], 470, 400, taken);
    expect(placed).toBeDefined();
    const box = {
      left: placed.left,
      right: placed.left + tagWidth(tallest.text),
      top: placed.top,
      bottom: placed.top + 18,
    };
    expect(box.left).toBeLessThanOrEqual(137);
    expect(box.right).toBeGreaterThanOrEqual(137);
    expect(box.left).toBeGreaterThanOrEqual(2);
    for (const other of taken)
      expect(
        box.left < other.right + 2 &&
          other.left < box.right + 2 &&
          box.top < other.bottom + 2 &&
          other.top < box.bottom + 2,
      ).toBe(false);
  });

  it("is not looked for further when the mark is a plain one: its text is in its card", () => {
    expect(placeTags([{ ...tallest, marked: false }], 470, 400, taken)).toEqual([]);
  });

  it("keeps its first place when that is free", () => {
    const [placed] = placeTags([tag({ x: 137, y: 245, marked: true })], 470, 400, []);
    expect(placed).toMatchObject({ left: 137 + 18, top: 245 - 9 });
  });
});

describe("the tags along a track", () => {
  const track = Array.from({ length: 32 }, (_, at) =>
    tag({
      mark: at,
      text: `Sep ${9 + Math.floor(at / 8)}, ${String((at % 8) * 3).padStart(2, "0")}:00`,
      x: 600 + at * 2,
      y: 700 - at * 9,
      offset: 4,
      track: "points-1",
    }),
  );
  const boxOf = (placed: { left: number; top: number; text: string }) => ({
    left: placed.left,
    right: placed.left + tagWidth(placed.text),
    top: placed.top,
    bottom: placed.top + 18,
  });

  it("tries the first place and the last, then the middle of the longest stretch", () => {
    expect(trackOrder(9)).toEqual([0, 8, 4, 2, 6, 1, 3, 5, 7]);
    expect(trackOrder(2)).toEqual([0, 1]);
    expect([...trackOrder(32)].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 32 }, (_, at) => at),
    );
  });

  it("keeps the first, the last and the marked places, and thins the others", () => {
    const peak = { ...track[20], marked: true, text: "Peak: 110 mph" };
    const placed = placeTags(
      [...track.slice(0, 20), peak, ...track.slice(21)],
      1280,
      760,
    );
    const marks = placed.map((item) => item.mark);
    expect(marks).toContain(0);
    expect(marks).toContain(31);
    expect(marks).toContain(20);
    expect(placed.length).toBeGreaterThan(3);
    expect(placed.length).toBeLessThan(track.length);
  });

  it("never stacks two of them: each has the height of a tag of air to the others", () => {
    const placed = placeTags(track, 1280, 760).map(boxOf);
    for (const a of placed)
      for (const b of placed) {
        if (a === b) continue;
        const beside =
          a.left >= b.right + TRACK_AIR.x || b.left >= a.right + TRACK_AIR.x;
        const apart =
          a.top >= b.bottom + TRACK_AIR.y || b.top >= a.bottom + TRACK_AIR.y;
        expect(beside || apart).toBe(true);
      }
  });

  it("places the same tags without a track as close as tags of points go", () => {
    const plain = track.map(({ track: _track, ...rest }) => rest);
    expect(placeTags(plain, 1280, 760).length).toBeGreaterThan(
      placeTags(track, 1280, 760).length,
    );
  });
});

describe("tags next to signs", () => {
  const tag = (mark: number, x: number, y: number, more = {}) => ({
    mark,
    text: "1,200 bu",
    note: false,
    x,
    y,
    offset: 6,
    centred: false,
    ...more,
  });
  const apart = (
    a: { left: number; top: number; right: number; bottom: number },
    b: { left: number; top: number; right: number; bottom: number },
  ) => a.left >= b.right || b.left >= a.right || a.top >= b.bottom || b.top >= a.bottom;

  it("never lie on a sign: a badge, a rank of two digits, a flag, a ring", () => {
    const signs: PlacedMarker[] = [
      { marker: "flag", x: 80, y: 80, radius: 5, anchored: true },
      { marker: 88, x: 200, y: 80, radius: 5, anchored: true },
      { marker: "ring", x: 320, y: 80, radius: 9, anchored: true },
      { marker: "star", x: 140, y: 190, anchored: false },
      { marker: 4, x: 260, y: 190, radius: 14, anchored: true },
    ];
    const placed = placeTags(
      signs.map((sign, at) => tag(at, sign.x, sign.y, { offset: signReach(sign) })),
      400,
      300,
      signs.map(signBox),
    );
    expect(placed).toHaveLength(signs.length);
    for (const item of placed) {
      const box = {
        left: item.left,
        top: item.top,
        right: item.left + tagWidth(item.text),
        bottom: item.top + 18,
      };
      for (const sign of signs) expect(apart(box, signBox(sign))).toBe(true);
    }
  });

  it("never lie on the dot of another point, tagged or not, and stay beside their own", () => {
    const own = dotBox(100, 100, 6);
    const other = dotBox(130, 100, 8);
    const [placed] = placeTags([tag(0, 100, 100)], 400, 300, [own, other]);
    expect(placed).toBeDefined();
    const box = {
      left: placed.left,
      top: placed.top,
      right: placed.left + tagWidth(placed.text),
      bottom: placed.top + 18,
    };
    expect(apart(box, own)).toBe(true);
    expect(apart(box, other)).toBe(true);
    expect(placeTags([tag(0, 100, 100)], 400, 300, [own])[0].left).toBe(110);
  });

  it("slide along the edge above or below a mark, and take a corner when its sides are taken", () => {
    const text = "Plymouth Grain Terminal: 6,540,000 bu";
    const w = tagWidth(text);
    const right = { left: 80, top: 95, right: 380, bottom: 110 };
    const [edge] = placeTags([tag(0, 60, 100, { text })], 400, 300, [right]);
    expect(edge).toEqual({ mark: 0, text, note: false, left: 2, top: 100 - 10 - 18 });
    expect(edge.left + w).toBeLessThanOrEqual(398);
    const sides = [
      { left: 212, top: 144, right: 330, bottom: 160 },
      { left: 70, top: 140, right: 188, bottom: 160 },
      { left: 180, top: 118, right: 205, bottom: 136 },
      { left: 180, top: 164, right: 220, bottom: 182 },
    ];
    const [corner] = placeTags([tag(0, 200, 150, { text: "4.2%" })], 400, 300, sides);
    expect(corner).toMatchObject({ left: 210, top: 150 - 10 - 18 });
    for (const box of sides)
      expect(
        apart(
          {
            left: corner.left,
            top: corner.top,
            right: corner.left + tagWidth("4.2%"),
            bottom: corner.top + 18,
          },
          box,
        ),
      ).toBe(true);
  });

  it("keeps the tags of the marks an answer singles out when there are more tags than a map shows", () => {
    const many = Array.from({ length: 200 }, (_, at) =>
      tag(at, 30 + (at % 25) * 70, 20 + Math.floor(at / 25) * 30, {
        text: "4.2%",
        marked: at >= 190,
      }),
    );
    const shown = placeTags(many, 2000, 800);
    expect(shown).toHaveLength(MAP_LIMITS.tagsShown);
    for (let at = 190; at < 200; at++)
      expect(shown.some((item) => item.mark === at)).toBe(true);
  });
});

describe("placeTags among the dots of other marks", () => {
  const ring = [-1, 0, 1].flatMap((dx) =>
    [-1, 0, 1].map((dy) => ({
      left: 200 + dx * 60 - 40,
      top: 200 + dy * 30 - 14,
      right: 200 + dx * 60 + 40,
      bottom: 200 + dy * 30 + 14,
    })),
  );
  const tag = (marked: boolean) => ({
    mark: 0,
    text: "Bandera 97.5",
    note: false,
    marked,
    x: 200,
    y: 200,
    offset: 6,
    centred: false,
  });

  it("leaves the tag of a plain mark out when its only places are on other dots", () => {
    expect(placeTags([tag(false)], 400, 400, [], ring)).toEqual([]);
  });

  it("shows the tag of the mark an answer singles out there: it is the one name the map needs", () => {
    const [placed] = placeTags([tag(true)], 400, 400, [], ring);
    expect(placed.text).toBe("Bandera 97.5");
    expect(
      placeTags(
        [tag(true)],
        400,
        400,
        [{ left: 0, top: 0, right: 400, bottom: 400 }],
        ring,
      ),
    ).toEqual([]);
  });

  it("stays off the dots where it has a free place", () => {
    const free = ring.filter((box) => box.left < 200);
    const [placed] = placeTags([tag(true)], 400, 400, [], free);
    expect(placed.left).toBeGreaterThan(200);
  });
});

describe("placeTags", () => {
  const tag = (mark: number, x: number, y: number, more = {}) => ({
    mark,
    text: "4.2%",
    note: false,
    x,
    y,
    offset: 6,
    centred: false,
    ...more,
  });
  const boxes = (placed: ReturnType<typeof placeTags>) =>
    placed.map((item) => ({
      left: item.left,
      right: item.left + tagWidth(item.text),
      top: item.top,
      bottom: item.top + 18,
    }));

  it("puts a tag beside its mark and never two tags on each other", () => {
    const placed = placeTags(
      Array.from({ length: 40 }, (_, at) =>
        tag(at, 200 + (at % 5) * 9, 150 + Math.floor(at / 5) * 7),
      ),
      400,
      300,
    );
    expect(placed.length).toBeGreaterThan(3);
    const all = boxes(placed);
    for (let a = 0; a < all.length; a++)
      for (let b = a + 1; b < all.length; b++)
        expect(
          all[a].left < all[b].right &&
            all[b].left < all[a].right &&
            all[a].top < all[b].bottom &&
            all[b].top < all[a].bottom,
        ).toBe(false);
  });

  it("leaves out a tag whose mark is off the canvas, and keeps tags inside it", () => {
    expect(placeTags([tag(0, -5, 10), tag(1, 500, 10)], 400, 300)).toEqual([]);
    const [edge] = placeTags([tag(0, 395, 150)], 400, 300);
    expect(edge.left + tagWidth("4.2%")).toBeLessThanOrEqual(398);
  });

  it("places a tag of the user first and shows a bounded number", () => {
    const crowd = [tag(0, 100, 100), tag(1, 100, 100, { note: true, text: "mine" })];
    expect(placeTags(crowd, 400, 300)[0]).toMatchObject({ mark: 1, note: true });
    const many = Array.from({ length: 500 }, (_, at) =>
      tag(at, 30 + (at % 25) * 70, 20 + Math.floor(at / 25) * 30),
    );
    expect(placeTags(many, 2000, 800)).toHaveLength(MAP_LIMITS.tagsShown);
  });

  it("does not cover the point of another mark", () => {
    const placed = placeTags([tag(0, 100, 100), tag(1, 130, 100)], 400, 300);
    const first = placed.find((item) => item.mark === 0);
    expect(placed).toHaveLength(2);
    expect(first?.left).not.toBe(110);
  });

  it("does not cover the controls or the legend", () => {
    expect(
      placeTags([tag(0, 380, 20)], 400, 300, [
        { left: 300, top: 0, right: 400, bottom: 90 },
      ]),
    ).toEqual([]);
  });

  it("ends a tag left of its mark at its gap from the mark, by the width it is drawn", () => {
    const text = "Philadelphia: 1,574,281";
    const [placed] = placeTags([tag(0, 380, 100, { text, width: 128 })], 400, 300);
    expect(placed.left + 128).toBe(380 - (6 + 4));
  });

  it("measures a tag in its font, every figure as wide as a zero", () => {
    const measured: string[] = [];
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({
        font: "",
        measureText: (text: string) => {
          measured.push(text);
          return { width: text.length * 5.2 };
        },
      } as never);
    const widthOf = tagMeasure(document.createElement("div"));
    expect(widthOf("Dallas: 1,329,491")).toBe(Math.ceil(17 * 5.2) + 14);
    expect(measured).toEqual(["Dallas: 0,000,000"]);
    getContext.mockRestore();
  });

  it("joins the tag of the data and the tag of the user", () => {
    expect(tagText("4.2%", "watch")).toBe("4.2% · watch");
    expect(tagText(undefined, "watch")).toBe("watch");
    expect(tagText(undefined, undefined)).toBe("");
  });
});

describe("tags of marks sized by their values", () => {
  const port = (mark: number, x: number, y: number, size: number) => ({
    mark,
    text: `Port ${mark}: 1,000 ships`,
    note: false,
    x,
    y,
    offset: size,
    centred: false,
    size,
  });
  const crowd = [
    port(1, 222, 150, 5),
    port(2, 178, 150, 5),
    port(3, 200, 128, 5),
    port(4, 200, 172, 5),
    port(5, 60, 60, 4),
    port(0, 200, 150, 16),
  ];
  const dots = crowd.map((mark) => ({
    ...dotBox(mark.x, mark.y, mark.size),
    size: mark.size,
  }));
  const boxOf = (tag: ReturnType<typeof placeTags>[number]) => ({
    left: tag.left,
    top: tag.top,
    right: tag.left + tagWidth(tag.text),
    bottom: tag.top + 18,
  });
  const clear = (
    a: { left: number; top: number; right: number; bottom: number },
    b: { left: number; top: number; right: number; bottom: number },
  ) => a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom;

  it("keep the tag of the largest mark of a crowd: it may cover the dots of smaller marks", () => {
    const placed = placeTags(crowd, 400, 300, [], dots);
    expect(placed[0].mark).toBe(0);
    expect(placed.map((tag) => tag.mark)).toContain(5);
    const unsized = crowd.map(({ size: _size, ...tag }) => tag);
    const plain = dots.map(({ size: _size, ...dot }) => dot);
    expect(
      placeTags(unsized, 400, 300, [], plain).map((tag) => tag.mark),
    ).not.toContain(0);
  });

  it("never cover the dot of a mark as large as their own", () => {
    const big = dotBox(200, 150, 16);
    for (const tag of placeTags(crowd, 400, 300, [], dots).filter(
      (item) => item.mark !== 0,
    ))
      expect(clear(boxOf(tag), big)).toBe(true);
  });

  it("take a place clear of the names of the basemap first, and one on a name when no other is free", () => {
    const one = port(0, 200, 150, 6);
    const name = { left: 210, top: 130, right: 330, bottom: 170 };
    const [left] = placeTags([one], 400, 300, [], [], (box) => !clear(box, name));
    expect(left.left + tagWidth(one.text)).toBeLessThanOrEqual(200);
    const [first] = placeTags([one], 400, 300, [], [], () => true);
    expect(first.left).toBe(200 + 6 + 4);
  });
});

describe("the names of a few points as their tags", () => {
  const point = (label?: string, tag?: string) => ({ kind: "point", label, tag });

  it("are shown for a map of a few named points that tags none", () => {
    expect(namesAsTags([point("Rotterdam"), point("Antwerp")])).toBe(true);
    expect(
      namesAsTags(
        Array.from({ length: NAMED_POINTS_TAGGED }, (_, i) => point(`Port ${i}`)),
      ),
    ).toBe(true);
  });

  it("are not shown when a mark has a tag, the points are many, or none is named", () => {
    expect(
      namesAsTags([point("Rotterdam", "Rotterdam: 32,584"), point("Antwerp")]),
    ).toBe(false);
    expect(
      namesAsTags(
        Array.from({ length: NAMED_POINTS_TAGGED + 1 }, (_, i) => point(`Port ${i}`)),
      ),
    ).toBe(false);
    expect(namesAsTags([point(), point()])).toBe(false);
    expect(namesAsTags([{ kind: "region", label: "Texas" }])).toBe(false);
  });
});
