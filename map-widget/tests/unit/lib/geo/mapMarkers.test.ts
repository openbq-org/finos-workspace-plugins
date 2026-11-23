import { describe, expect, it } from "vitest";
import { MAP_LIMITS } from "~/lib/codemode/limits";
import { markerOf, markerToneOf } from "~/lib/geo/mapMarks";
import { MAP_MARKER_TONES, MAP_MARKERS } from "~/lib/geo/mapMarkTypes";
import { mapSpec } from "~/lib/geo/mapSpec";
import { mapSummary } from "~/lib/geo/mapSummary";

const NYC = { lat: 40.71, lon: -74.01 };
const pointOf = (more: Record<string, unknown>) =>
  mapSpec({ points: [{ ...NYC, ...more }] }).points[0];

describe("the sign of a mark", () => {
  it("is one of the signs of the app, true for the pin, or a rank from 1 to 99", () => {
    expect([...MAP_MARKERS]).toEqual(["pin", "check", "star", "flag", "ring"]);
    for (const sign of MAP_MARKERS) expect(markerOf(sign)).toBe(sign);
    expect(markerOf(true)).toBe("pin");
    expect(markerOf(1)).toBe(1);
    expect(markerOf(MAP_LIMITS.markerRanks)).toBe(99);
    expect(markerOf("3")).toBe(3);
    expect(markerOf("42")).toBe(42);
  });

  it("is nothing for any other value: a rank out of range, text, an address, markup", () => {
    for (const hostile of [
      0,
      100,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "0",
      "100",
      "03",
      "3 ",
      "1e1",
      "+3",
      "three",
      "Pin",
      "https://attacker.example/pin.png",
      "<img src=x onerror=alert(1)>",
      "url(https://attacker.example)",
      false,
      null,
      undefined,
      [1],
      { toString: () => "3" },
    ])
      expect(markerOf(hostile)).toBeUndefined();
  });

  it("is kept on every kind of mark, and a rank is stored as a number", () => {
    const spec = mapSpec({
      points: [
        { ...NYC, marker: "flag" },
        { ...NYC, marker: "7" },
        { ...NYC, marker: "banner" },
      ],
      regions: { set: "us-states", items: [{ code: "CA", marker: "ring" }] },
      shapes: [
        {
          type: "line",
          coordinates: [
            [0, 0],
            [1, 1],
          ],
          marker: 2,
        },
      ],
      layers: [
        { kind: "flows", flows: [{ from: [0, 0], to: [1, 1], marker: "check" }] },
      ],
    });
    expect(spec.points.map((point) => point.marker)).toEqual(["flag", 7, undefined]);
    expect(spec.regions?.items[0].marker).toBe("ring");
    expect(spec.shapes[0].marker).toBe(2);
    expect(JSON.stringify(spec.layers)).toContain('"marker":"check"');
  });
});

describe("the tone of a sign", () => {
  it("is a tone of the app or a colour of the grammar", () => {
    expect([...MAP_MARKER_TONES]).toEqual([
      "accent",
      "positive",
      "negative",
      "neutral",
    ]);
    for (const tone of MAP_MARKER_TONES) expect(markerToneOf(tone)).toBe(tone);
    expect(markerToneOf("#F00")).toBe("#f00");
    expect(markerToneOf("#1F62BD")).toBe("#1f62bd");
  });

  it("is nothing for any other value", () => {
    for (const hostile of [
      "red",
      "Positive",
      "rgb(255,0,0)",
      "#12345",
      "#1234567",
      "url(https://attacker.example/a.png)",
      "var(--brand-main)",
      "#fff; background: url(https://attacker.example)",
      "javascript:alert(1)",
      7,
      true,
      null,
      {},
    ])
      expect(markerToneOf(hostile)).toBeUndefined();
  });

  it("is kept with a sign or a highlight, and left out without one and when it is the accent", () => {
    expect(pointOf({ marker: "star", markerColor: "negative" })).toEqual({
      ...NYC,
      marker: "star",
      markerColor: "negative",
    });
    expect(pointOf({ highlight: true, markerColor: "#0A0" })).toEqual({
      ...NYC,
      markerColor: "#0a0",
      highlight: true,
    });
    expect(pointOf({ markerColor: "negative" })).toEqual(NYC);
    expect(pointOf({ marker: "pin", markerColor: "accent" })).toEqual({
      ...NYC,
      marker: "pin",
    });
    expect(pointOf({ marker: "pin", markerColor: "https://attacker.example" })).toEqual(
      { ...NYC, marker: "pin" },
    );
  });
});

describe("a highlight", () => {
  it("is true or absent", () => {
    expect(pointOf({ highlight: true })).toEqual({ ...NYC, highlight: true });
    for (const other of [false, 1, "true", "yes", null, {}, "https://attacker.example"])
      expect(pointOf({ highlight: other })).toEqual(NYC);
  });

  it("is kept on a region, a line, an area and a flow", () => {
    const spec = mapSpec({
      regions: { set: "us-states", items: [{ code: "TX", highlight: true }] },
      shapes: [
        {
          type: "line",
          coordinates: [
            [0, 0],
            [1, 1],
          ],
          highlight: true,
        },
        {
          type: "polygon",
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
          highlight: true,
          markerColor: "positive",
        },
      ],
      layers: [
        { kind: "flows", flows: [{ from: [0, 0], to: [1, 1], highlight: true }] },
      ],
    });
    expect(spec.regions?.items[0]).toEqual({ code: "48", highlight: true });
    expect(spec.shapes.map((shape) => shape.highlight)).toEqual([true, true]);
    expect(spec.shapes[1].markerColor).toBe("positive");
    expect(JSON.stringify(spec.layers)).toContain('"highlight":true');
  });
});

describe("the reducer with the new fields", () => {
  const raw = {
    points: [
      {
        ...NYC,
        label: "A",
        tag: "t",
        value: 1,
        marker: "12",
        markerColor: "#ABC",
        highlight: true,
        time: "2024",
      },
    ],
    regions: {
      set: "us-states",
      items: [{ code: "CA", marker: "flag", markerColor: "neutral" }],
    },
  };

  it("gives the same map when it reads its own result", () => {
    const once = mapSpec(raw);
    expect(mapSpec(once)).toEqual(once);
    expect(JSON.stringify(mapSpec(JSON.parse(JSON.stringify(once))))).toBe(
      JSON.stringify(once),
    );
    expect(Object.keys(once.points[0])).toEqual([
      "lat",
      "lon",
      "label",
      "tag",
      "value",
      "marker",
      "markerColor",
      "highlight",
      "time",
    ]);
  });

  it("leaves a map written before them as it was", () => {
    const old = {
      points: [{ ...NYC, label: "A", tag: "1", marker: "star" }],
      regions: { set: "us-states", items: [{ code: "06", value: 2, marker: "pin" }] },
      shapes: [],
    };
    expect(JSON.stringify(mapSpec(old))).toBe(JSON.stringify(old));
  });

  it("copies no key that is not listed", () => {
    const spec = mapSpec({
      points: [
        {
          ...NYC,
          marker: "star",
          markerImage: "https://attacker.example/a.png",
          markerUrl: "https://attacker.example",
          icon: "https://attacker.example/i.svg",
          highlightColor: "url(https://attacker.example)",
        },
      ],
    });
    expect(JSON.stringify(spec)).not.toContain("attacker");
    expect(spec.points[0]).toEqual({ ...NYC, marker: "star" });
  });
});

describe("mapSummary", () => {
  it("counts the highlighted marks, and names the ranked ones among the marked", () => {
    const summary = mapSummary(
      mapSpec({
        points: [
          { ...NYC, label: "First", marker: 1 },
          { ...NYC, label: "Glow", highlight: true },
          { ...NYC, label: "Both", marker: "ring", highlight: true },
          { ...NYC, label: "Plain" },
        ],
      }),
    );
    expect(summary.marked).toBe(2);
    expect(summary.markedLabels).toEqual(["First", "Both"]);
    expect(summary.highlighted).toBe(2);
    expect(mapSummary(mapSpec({ points: [NYC] })).highlighted).toBeUndefined();
  });

  it("names a marked region without a label by its name, and counts a place of a map that plays once", () => {
    const years = [2023, 2024, 2025];
    const summary = mapSummary(
      mapSpec({
        regions: {
          set: "us-states",
          items: years.flatMap((time) => [
            {
              code: "NH",
              value: time,
              time,
              marker: "star",
              tag: "NH: -3.0 pp",
              highlight: true,
            },
            { code: "IA", value: time, time },
          ]),
        },
        points: [{ ...NYC, marker: "pin", tag: "7.2M bu" }],
      }),
    );
    expect(summary).toMatchObject({ marked: 2, tags: 2, highlighted: 1 });
    expect(summary.markedLabels).toEqual(["7.2M bu", "New Hampshire"]);
    const counties = mapSummary(
      mapSpec({
        regions: {
          set: "us-counties",
          items: [
            { code: "19025", marker: 1, tag: "Calhoun, IA: 205.3" },
            { code: "19151", marker: 2 },
          ],
        },
      }),
    );
    expect(counties.markedLabels).toEqual(["Calhoun, IA: 205.3", "19151"]);
  });
});
