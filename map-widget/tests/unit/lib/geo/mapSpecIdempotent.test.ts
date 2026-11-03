import { describe, expect, it } from "vitest";
import "~/lib/geo/mapFile";
import { MAP_LIMITS } from "~/lib/codemode/limits";
import { makeMap, mapSpec } from "~/lib/geo/mapSpec";
import type { MapSpec } from "~/lib/geo/mapSpecTypes";
import { random } from "./files/support";

const ATTACKER = "https://attacker.example";
const text = (value: unknown) => JSON.stringify(value);

describe("mapSpec: idempotent", () => {
  it.each([
    [
      {
        points: [
          { state: "ny", tag: 4.4, label: " New   York ", color: "#ABC", size: 3 },
        ],
      },
    ],
    [
      {
        valueLabel: "Rate",
        regions: {
          set: "us-counties",
          items: [
            { code: 6037, value: 1 },
            { code: "Cook County, IL" },
            { code: "nowhere" },
          ],
        },
      },
    ],
    [
      {
        geojson: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: { name: "A", "marker-color": "#f00", rank: 2 },
              geometry: { type: "Point", coordinates: [10, 20] },
            },
            {
              type: "Feature",
              properties: { title: "B" },
              geometry: {
                type: "MultiPolygon",
                coordinates: [
                  [
                    [
                      [0, 0],
                      [1, 0],
                      [1, 1],
                      [0, 0],
                    ],
                  ],
                  [
                    [
                      [5, 5],
                      [6, 5],
                      [6, 6],
                      [5, 5],
                    ],
                  ],
                ],
              },
            },
          ],
        },
      },
    ],
    [
      {
        kml: `<kml><Document><name>${"N".repeat(200)}\u202e${"M".repeat(219)}</name><Placemark><name>P</name><Point><coordinates>1,2</coordinates></Point></Placemark></Document></kml>`,
      },
    ],
    [
      {
        file: {
          name: `fields\u202e${"x".repeat(200)}.geojson`,
          text: JSON.stringify({
            type: "Feature",
            properties: { "crop\u202e type": "corn" },
            geometry: { type: "Point", coordinates: [1, 2] },
          }),
          category: "crop\u202e type",
        },
      },
    ],
    [
      {
        points: [
          { lat: 1, lon: 2, label: `${"a".repeat(119)} b`, tag: `${"t".repeat(39)} u` },
        ],
      },
    ],
    [
      {
        points: [
          {
            lat: 1,
            lon: 2,
            props: {
              [`${"k".repeat(39)} x`]: 1,
              [`${"k".repeat(39)}`]: 2,
              [`${"k".repeat(39)}  `]: 3,
            },
          },
        ],
      },
    ],
    [
      {
        regions: {
          set: "us-states",
          items: [{ code: "CA" }, { code: "nowhere" }],
          unmatched: ["x"],
          unmatchedCount: 1e9,
        },
      },
    ],
  ])("gives the same map when it is run on its own result", (raw) => {
    const once = makeMap(raw);
    expect(makeMap(once)).toEqual(once);
    expect(mapSpec(once)).toEqual(once);
    expect(mapSpec(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });

  it("bounds and cleans every text it falls back to, and cuts without leaving a space", () => {
    const named = makeMap({
      kml: `<kml><Document><name>${"N".repeat(200)}\u202e${"M".repeat(219)}</name><Placemark><name>P</name><Point><coordinates>1,2</coordinates></Point></Placemark></Document></kml>`,
    });
    expect(named.title).toBe(`${"N".repeat(120)}`);
    const filed = makeMap({
      file: {
        name: `fields\u202e${"x".repeat(200)}.geojson`,
        text: JSON.stringify({
          type: "Feature",
          properties: { "crop\u202e type": "corn" },
          geometry: { type: "Point", coordinates: [1, 2] },
        }),
        category: "crop\u202e type",
      },
    });
    expect(JSON.stringify(filed)).not.toContain("\u202e");
    expect(filed.title?.length).toBeLessThanOrEqual(MAP_LIMITS.titleChars);
    const cut = mapSpec({
      title: `${"T".repeat(119)} x`,
      points: [
        {
          lat: 1,
          lon: 2,
          label: `${"a".repeat(119)} b`,
          tag: `${"t".repeat(39)} u`,
          category: `${"c".repeat(39)} d`,
          time: `${"2".repeat(23)} 0`,
          props: {
            [`${"k".repeat(39)} x`]: `${"v".repeat(199)} w`,
            [`${"k".repeat(39)}`]: "second",
            other: 1,
          },
        },
      ],
    });
    expect(cut.title).toBe("T".repeat(119));
    expect(cut.points[0]).toEqual({
      lat: 1,
      lon: 2,
      label: "a".repeat(119),
      tag: `${"t".repeat(39)}\u2026`,
      category: "c".repeat(39),
      time: "2".repeat(23),
      props: { ["k".repeat(39)]: "v".repeat(199), other: 1 },
    });
    expect(
      mapSpec({ points: [{ lat: 1, lon: 2, tag: `${"t".repeat(39)}\u{1F600}` }] })
        .points[0].tag,
    ).toBe(`${"t".repeat(39)}\u2026`);
  });

  it("gives the same map again for 400 generated maps of hostile texts and odd values", () => {
    const next = random(20261010);
    const pick = <T>(items: readonly T[]): T =>
      items[Math.floor(next() * items.length)];
    const whole = (max: number) => Math.floor(next() * (max + 1));
    const TEXTS = [
      "plain",
      " padded   inside ",
      `${"a".repeat(119)} b`,
      `${"a".repeat(39)} b`,
      `${"a".repeat(23)} b`,
      `${"a".repeat(59)} b c`,
      `${"a".repeat(199)}  b`,
      `${"a".repeat(79)}\tb`,
      "over\u202eride",
      "\u2066iso\u2069late",
      "nul\u0000l and \u007f",
      "line\nbreak\r\nand tab\t",
      "\u00a0\u2003wide spaces\u3000",
      `${"e".repeat(39)}\u{1F600}`,
      `${"e".repeat(119)}\u{1F600}x`,
      "\ud83d lone",
      "",
      "   ",
      "__proto__",
      "constructor",
      "toString",
      "7",
      "007",
      "2024",
      "2024-03",
      "<img src=x onerror=alert(1)>",
      "https://attacker.example/a.png",
      "x".repeat(500),
    ];
    const NUMBERS = [
      0,
      -0,
      1,
      -1,
      0.5,
      1e21,
      -1e-7,
      42,
      99,
      100,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ];
    const any = () =>
      pick<unknown>([
        ...TEXTS,
        ...NUMBERS,
        true,
        false,
        null,
        undefined,
        [],
        {},
        ["a"],
        { a: 1 },
      ]);
    const mark = () => {
      const fields: Record<string, unknown> = {};
      for (const key of [
        "label",
        "tag",
        "value",
        "color",
        "category",
        "marker",
        "markerColor",
        "highlight",
        "time",
        "size",
      ])
        if (next() < 0.5)
          fields[key] =
            key === "color" || key === "markerColor"
              ? pick(["#ABC", "#a1b2c3", "accent", "negative", "red", 7, null])
              : key === "marker"
                ? pick(["pin", "star", true, 5, "5", "05", 0, 100, "x"])
                : any();
      if (next() < 0.5) {
        const props: Record<string, unknown> = {};
        for (let at = whole(16); at > 0; at--) props[String(pick(TEXTS))] = any();
        fields.props = props;
      }
      return fields;
    };
    const point = () =>
      next() < 0.8
        ? { lat: next() * 180 - 90, lon: next() * 360 - 180, ...mark() }
        : {
            [pick(["state", "country"])]: pick([
              "CA",
              "ny",
              "France",
              "DE",
              "Texas",
              6,
              "Atlantis",
              "GI",
            ]),
            ...mark(),
          };
    const position = () => [next() * 360 - 180, next() * 180 - 90, next() * 100];
    const shape = () =>
      next() < 0.5
        ? { type: "line", coordinates: [position(), position(), position()], ...mark() }
        : {
            type: "polygon",
            coordinates: [[position(), position(), position(), position()]],
            ...mark(),
          };
    const regions = () => {
      const set = pick([
        "us-states",
        "us-counties",
        "countries",
        "admin1",
        "us-cbsa",
        "us-cd119",
      ]);
      const codes: Record<string, unknown[]> = {
        "us-states": ["CA", "ny", "Texas", 6, "06", "nowhere", "DC"],
        "us-counties": ["06037", 6037, "Cook County, IL", "17031", "nowhere"],
        countries: ["US", "FRA", 276, "Japan", "Atlantis"],
        admin1: ["CA-ON", "Bayern", "Ontario", ...TEXTS],
        "us-cbsa": ["35620", "Chicago", ...TEXTS],
        "us-cd119": ["CA-12", "AK-AL", ...TEXTS],
      };
      return {
        set,
        items: Array.from({ length: 1 + whole(6) }, () => ({
          code: pick(codes[set]),
          ...mark(),
        })),
        ...(next() < 0.3 ? { within: { country: any(), state: any() } } : {}),
        ...(next() < 0.3
          ? {
              unmatched: [any(), any()],
              unmatchedCount: pick([0, 1, 2.5, 5000, 1e9, -3, "4"]),
            }
          : {}),
      };
    };
    const list = <T>(make: () => T, max: number) =>
      Array.from({ length: whole(max) }, make);
    const layer = () => {
      const kind = pick([
        "regions",
        "points",
        "lines",
        "polygons",
        "heat",
        "clusters",
        "flows",
        "columns",
        "source",
      ]);
      const base = {
        kind,
        id: pick([
          "a",
          "points",
          "points-1",
          "Bad Id",
          undefined,
          "x".repeat(41),
          "dup",
          "dup",
        ]),
        name: any(),
        valueLabel: any(),
        group: any(),
        visible: pick([false, true, undefined, 0]),
        opacity: pick([0.5, -1, 2, 1, -0, "x", undefined]),
      };
      if (kind === "regions") return { ...base, regions: regions() };
      if (kind === "lines")
        return {
          ...base,
          shapes: list(
            () => ({ type: "line", coordinates: [position(), position()], ...mark() }),
            3,
          ),
        };
      if (kind === "polygons")
        return {
          ...base,
          shapes: list(
            () => ({
              type: "polygon",
              coordinates: [[position(), position(), position()]],
              ...mark(),
            }),
            3,
          ),
        };
      if (kind === "flows")
        return {
          ...base,
          flows: list(
            () => ({
              from: pick<unknown>([position(), { state: "IA" }, { lat: 1, lon: 2 }]),
              to: pick<unknown>([position(), { country: "FR" }]),
              ...mark(),
            }),
            3,
          ),
        };
      if (kind === "columns")
        return next() < 0.5
          ? { ...base, points: list(point, 3) }
          : { ...base, regions: regions() };
      if (kind === "source") return { ...base, source: pick(["ndvi", "a_b-1"]) };
      return { ...base, points: list(point, 4) };
    };
    let made = 0;
    for (let run = 0; run < 400; run++) {
      const raw: Record<string, unknown> = {
        title: any(),
        valueLabel: any(),
        categoryLabel: any(),
        points: list(point, 5),
        shapes: list(shape, 3),
        ...(next() < 0.5 ? { regions: regions() } : {}),
        ...(next() < 0.6 ? { layers: list(layer, 6) } : {}),
        ...(next() < 0.3 ? { notes: list(any, 12) } : {}),
        ...(next() < 0.3
          ? { context: list(() => pick(["green", "buildings", "nope", 3]), 4) }
          : {}),
        ...(next() < 0.2 ? { basemap: { source: pick(["ndvi", "sat"]) } } : {}),
      };
      let once: MapSpec;
      try {
        once = makeMap(raw);
      } catch (cause) {
        expect(String(cause), `run ${run}`).toMatch(/^Error: output\.map: /);
        continue;
      }
      made++;
      expect(makeMap(once), `made again, run ${run}`).toEqual(once);
      expect(mapSpec(once), `read, run ${run}`).toEqual(once);
      const stored = JSON.parse(JSON.stringify(once));
      expect(mapSpec(mapSpec(stored)), `stored, run ${run}`).toEqual(mapSpec(stored));
      expect(JSON.stringify(once).length, `run ${run}`).toBeLessThanOrEqual(
        MAP_LIMITS.chars,
      );
      expect(JSON.stringify(once), `run ${run}`).not.toMatch(
        /[\u202a-\u202e\u2066-\u2069]|\\u0000|\\u007f/,
      );
    }
    expect(made).toBeGreaterThan(150);
  });

  it("reads GeoJSON into points and shapes and keeps no GeoJSON", () => {
    const spec = makeMap({
      geojson: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {
              name: "A",
              "marker-color": "#f00",
              rank: 2,
              link: { href: ATTACKER },
            },
            geometry: { type: "Point", coordinates: [10, 20] },
          },
          {
            type: "Feature",
            properties: { label: "Line", value: 3 },
            geometry: {
              type: "MultiLineString",
              coordinates: [
                [
                  [0, 0],
                  [1, 1],
                ],
                [
                  [2, 2],
                  [3, 3],
                ],
              ],
            },
          },
        ],
      },
    });
    expect(spec).toEqual({
      points: [{ lat: 20, lon: 10, label: "A", color: "#f00", props: { rank: 2 } }],
      shapes: [
        {
          type: "line",
          coordinates: [
            [0, 0],
            [1, 1],
          ],
          label: "Line",
          value: 3,
        },
        {
          type: "line",
          coordinates: [
            [2, 2],
            [3, 3],
          ],
          label: "Line",
          value: 3,
        },
      ],
    });
  });
});
