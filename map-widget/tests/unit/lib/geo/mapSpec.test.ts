import { describe, expect, it } from "vitest";
import "~/lib/geo/mapFile";
import { MAP_LIMITS } from "~/lib/codemode/limits";
import { BASEMAP_NOTE } from "~/lib/geo/mapAsks";
import { mapSpec } from "~/lib/geo/mapSpec";
import type { MapSpec } from "~/lib/geo/mapSpecTypes";
import { mapColor } from "~/lib/geo/mapValues";

const ATTACKER = "https://attacker.example";
const text = (value: unknown) => JSON.stringify(value);
const NYC = { lat: 40.71, lon: -74.01 };

describe("mapSpec: what is a map", () => {
  it("keeps points with their label, tag, value, size, colour and other values", () => {
    expect(
      mapSpec({
        title: "Offices",
        valueLabel: "Headcount",
        points: [
          {
            ...NYC,
            label: "New York",
            tag: "4.2%",
            value: 4.2,
            size: 10,
            color: "#FF0000",
            props: { region: "East", staff: 120, open: true, note: null },
          },
        ],
      }),
    ).toEqual({
      title: "Offices",
      valueLabel: "Headcount",
      points: [
        {
          ...NYC,
          label: "New York",
          tag: "4.2%",
          value: 4.2,
          color: "#ff0000",
          props: { region: "East", staff: 120, open: true, note: null },
          size: 10,
        },
      ],
      shapes: [],
    });
  });

  it("places a point at the centre of a state or a country", () => {
    const { points } = mapSpec({
      points: [
        { state: "CA", tag: "5.3" },
        { country: "France", label: "France" },
      ],
    });
    expect(points[0]).toEqual({ lat: 37.254, lon: -119.982, tag: "5.3" });
    expect(points[1]).toEqual({ lat: 48.032, lon: 1.473, label: "France" });
  });

  it("places a point in every country that has a shape, the small ones too", () => {
    const { points } = mapSpec({
      points: ["SG", "HK", "VA", "MT", "BH", "LI", "Kosovo"].map((country) => ({
        country,
      })),
    });
    expect(points).toHaveLength(7);
    for (const point of points) {
      expect(Math.abs(point.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(point.lon)).toBeLessThanOrEqual(180);
    }
  });

  it("skips and counts a point whose state or country has no place, and draws the others", () => {
    const spec = mapSpec({
      points: [
        { state: "CA", label: "kept" },
        { country: "Atlantis", label: "lost" },
        { state: "ZZ" },
        { country: "GI" },
        { country: "France" },
        { state: 5.5 },
      ],
      notes: ["a note of the file"],
    });
    expect(spec.points.map((point) => point.label)).toEqual(["kept", undefined]);
    expect(spec.notes).toEqual([
      '4 points or flows name a state or a country that has no place on the map and are not drawn: "Atlantis", "ZZ", "GI", 5.5.',
      "a note of the file",
    ]);
    expect(mapSpec(spec)).toEqual(spec);
    const one = mapSpec({ points: [{ ...NYC }, { country: "Atlantis" }] });
    expect(one.notes).toEqual([
      '1 point or flow names a state or a country that has no place on the map and is not drawn: "Atlantis".',
    ]);
  });

  it("skips and counts a flow with such an end, in every layer, and names the first five", () => {
    const spec = mapSpec({
      layers: [
        {
          kind: "flows",
          flows: [
            { from: { state: "IA" }, to: { country: "FR" }, value: 1 },
            { from: { state: "IA" }, to: { country: "Narnia" }, value: 2 },
            { from: { country: "Mordor" }, to: [0, 0], value: 3 },
          ],
        },
        {
          kind: "points",
          points: ["A1", "B2", "C3", "D4", "E5"]
            .map((state) => ({ state }))
            .concat([{ state: "TX" }]),
        },
      ],
    });
    expect(spec.layers?.[0]).toMatchObject({ flows: [{ value: 1 }] });
    expect(spec.layers?.[1]).toMatchObject({ points: [{ lat: expect.any(Number) }] });
    expect(spec.notes).toEqual([
      '7 points or flows name a state or a country that has no place on the map and are not drawn: "Narnia", "Mordor", "A1", "B2", "C3", ...',
    ]);
  });

  it("fails a map whose places all match nothing, with the spellings a place can have", () => {
    expect(() =>
      mapSpec({ points: [{ country: "Atlantis" }, { state: "Narnia" }] }),
    ).toThrow(
      'output.map: none of the 2 points or flows names a state or a country the app knows, for example "Atlantis", "Narnia". A point is placed by `state` (a state is its postal code ("CA"), its name ("California") or its FIPS code ("06")) or by `country` (a country is its ISO code ("US", "USA" or 840) or its English name ("United States")), or by a latitude and a longitude.',
    );
    expect(() => mapSpec({ points: [{ label: "x" }] })).toThrow(/point 1 has no place/);
    expect(() => mapSpec({ points: [{ lat: 95, lon: 0 }] })).toThrow(/lat 95/);
  });

  it("writes a number that is given as a tag or a label as its text", () => {
    expect(mapSpec({ points: [{ ...NYC, tag: 4.2, label: 7 }] }).points[0]).toEqual({
      ...NYC,
      label: "7",
      tag: "4.2",
    });
  });

  it("keeps lines and areas with positions in range", () => {
    const spec = mapSpec({
      shapes: [
        {
          type: "line",
          coordinates: [
            [-74, 40.7],
            [-73.9, 40.8, 12],
          ],
          label: "Route",
        },
        {
          type: "polygon",
          coordinates: [
            [
              [-74, 40],
              [-73, 40],
              [-73, 41],
              [-74, 40],
            ],
          ],
          color: "#0af",
        },
      ],
    });
    expect(spec.shapes).toEqual([
      {
        type: "line",
        coordinates: [
          [-74, 40.7],
          [-73.9, 40.8],
        ],
        label: "Route",
      },
      {
        type: "polygon",
        coordinates: [
          [
            [-74, 40],
            [-73, 40],
            [-73, 41],
            [-74, 40],
          ],
        ],
        color: "#0af",
      },
    ]);
  });

  it("reads regions by any spelling of their code, once each", () => {
    const spec = mapSpec({
      regions: {
        set: "us-states",
        items: [
          { code: "CA", value: 5.3, label: "California" },
          { code: "texas", value: 4.1 },
          { code: 36, value: 4.4 },
          { code: "California", value: 99 },
        ],
      },
    });
    expect(spec.regions).toEqual({
      set: "us-states",
      items: [
        { code: "06", label: "California", value: 5.3 },
        { code: "48", value: 4.1 },
        { code: "36", value: 4.4 },
      ],
    });
  });

  it("leaves out a region that matches nothing, and says how many", () => {
    const spec = mapSpec({
      regions: {
        set: "countries",
        items: [
          { code: "US", value: 1 },
          { code: "Atlantis", value: 2 },
          { code: "Narnia", value: 3 },
        ],
      },
    });
    expect(spec.regions).toEqual({
      set: "countries",
      items: [{ code: "840", value: 1 }],
      unmatched: ["Atlantis", "Narnia"],
      unmatchedCount: 2,
    });
  });

  it.each([
    [undefined],
    [null],
    ["a map"],
    [[]],
    [{}],
    [{ points: [] }],
    [{ points: "x" }],
    [{ points: [NYC], shapes: "x" }],
    [{ regions: { set: "us-states", items: [] } }],
  ])("refuses %j with a message that names the call", (raw) => {
    expect(() => mapSpec(raw)).toThrow(/^output\.map: /);
  });

  it.each([
    [{ lat: 91, lon: 0 }],
    [{ lat: 0, lon: 181 }],
    [{ lat: "40.7", lon: "-74" }],
    [{ lat: Number.NaN, lon: 0 }],
    [{ lat: Number.POSITIVE_INFINITY, lon: 0 }],
    [{ lat: 40 }],
    [{ lon: 40 }],
    [{ lat: null, lon: null }],
  ])("refuses the point %j and says what a place is", (point) => {
    expect(() => mapSpec({ points: [NYC, point] })).toThrow(
      /^output\.map: point 2 has lat .* latitude and a longitude as numbers/,
    );
  });

  it("says that an address is not a place, for a point without coordinates", () => {
    expect(() =>
      mapSpec({ points: [{ label: "HQ", address: "1 Main St, Springfield" }] }),
    ).toThrow(
      /point 1 has no place\..*or a city, a US ZIP code, a state or a country\. A street address is not a place on a map: the data source turns addresses into coordinates/,
    );
  });

  it("says which spellings a region has when none matches", () => {
    expect(() =>
      mapSpec({
        regions: {
          set: "us-states",
          items: [{ code: "1 Main St" }, { code: "Springfield" }],
        },
      }),
    ).toThrow(
      /none of the 2 regions is a US state the app knows, for example "1 Main St", "Springfield"\. In this set a state is its postal code \("CA"\).*An address or a city is not a region/,
    );
  });

  it("refuses a boundary set the app does not ship", () => {
    expect(() =>
      mapSpec({ regions: { set: `${ATTACKER}/shapes.json`, items: [{ code: "CA" }] } }),
    ).toThrow(/The app ships these boundary sets: us-states, us-counties, countries/);
  });

  it("refuses a position out of range and a shape of another type", () => {
    expect(() =>
      mapSpec({
        shapes: [
          {
            type: "line",
            coordinates: [
              [0, 0],
              [200, 0],
            ],
          },
        ],
      }),
    ).toThrow(/shape 1 has the position \[200,0\]/);
    expect(() =>
      mapSpec({
        shapes: [
          {
            type: "image",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        ],
      }),
    ).toThrow(/A shape is a "line" or a "polygon"/);
    expect(() =>
      mapSpec({ shapes: [{ type: "line", coordinates: [[0, 0]] }] }),
    ).toThrow(/two positions or more/);
  });
});

describe("mapSpec: what a map cannot hold", () => {
  const hostile = {
    title: "T",
    style: `${ATTACKER}/style.json`,
    sources: { tiles: { type: "raster", tiles: [`${ATTACKER}/{z}/{x}/{y}.png`] } },
    glyphs: `${ATTACKER}/{fontstack}/{range}.pbf`,
    sprite: `${ATTACKER}/sprite`,
    tiles: [`${ATTACKER}/tiles`],
    basemap: `${ATTACKER}/base.pmtiles`,
    __proto__: { polluted: true },
    points: [
      {
        ...NYC,
        icon: `${ATTACKER}/pin.png`,
        image: `${ATTACKER}/pin.png`,
        url: `${ATTACKER}/a`,
        href: `${ATTACKER}/b`,
        html: `<img src="${ATTACKER}/c">`,
        color: `url(${ATTACKER}/d)`,
        props: { nested: { url: `${ATTACKER}/e` }, list: [`${ATTACKER}/f`] },
      },
    ],
    regions: {
      set: "us-states",
      url: `${ATTACKER}/shapes.json`,
      geojson: `${ATTACKER}/shapes.geojson`,
      items: [
        { code: "CA", geometry: { type: "Polygon", coordinates: [] }, url: ATTACKER },
      ],
    },
    shapes: [
      {
        type: "line",
        coordinates: [
          [0, 0],
          [1, 1],
        ],
        pattern: `${ATTACKER}/p.png`,
        color: "red",
      },
    ],
  };

  it("copies no key it does not list", () => {
    const spec = mapSpec(hostile);
    expect(text(spec)).not.toContain("attacker");
    expect(spec).toEqual({
      title: "T",
      points: [NYC],
      notes: [BASEMAP_NOTE],
      regions: { set: "us-states", items: [{ code: "06" }] },
      shapes: [
        {
          type: "line",
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        },
      ],
    });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("refuses a map whose layers are layers of a style", () => {
    expect(() =>
      mapSpec({ ...hostile, layers: [{ id: "x", type: "raster", source: "tiles" }] }),
    ).toThrow(/layer 1 has the kind undefined/);
  });

  it("keeps an address that is written as a label as the text it is", () => {
    const spec = mapSpec({
      points: [
        { ...NYC, label: `<img src=${ATTACKER}/x onerror=alert(1)>`, tag: ATTACKER },
      ],
    });
    expect(spec.points[0].label).toBe(`<img src=${ATTACKER}/x onerror=alert(1)>`);
    expect(spec.points[0].tag).toBe(ATTACKER);
  });

  it.each([
    ["red"],
    ["rgb(1,2,3)"],
    [`url(${ATTACKER})`],
    ["#12"],
    ["#12345"],
    ["#gggggg"],
    ["#fff;background:url(x)"],
    [123],
    [null],
  ])("leaves the colour %j out", (color) => {
    expect(mapColor(color)).toBeUndefined();
  });

  it("takes a hex colour of three or six digits", () => {
    expect(mapColor("#FfF")).toBe("#fff");
    expect(mapColor("#1A2b3C")).toBe("#1a2b3c");
  });

  it("bounds every text and takes control characters out", () => {
    const long = "x".repeat(1000);
    const [point] = mapSpec({
      title: long,
      points: [
        {
          ...NYC,
          label: `a\u0000b\u202e${long}`,
          tag: `line\none\t${long}`,
          props: Object.fromEntries(
            Array.from({ length: 40 }, (_, at) => [`k${at}${long}`, long]),
          ),
        },
      ],
    }).points;
    expect(point.label).toHaveLength(MAP_LIMITS.labelChars);
    expect(point.label?.startsWith("abxx")).toBe(true);
    expect(point.tag).toHaveLength(MAP_LIMITS.tagChars);
    expect(point.tag?.startsWith("line one x")).toBe(true);
    const props = Object.entries(point.props ?? {});
    expect(props).toHaveLength(MAP_LIMITS.props);
    for (const [key, value] of props) {
      expect(key.length).toBeLessThanOrEqual(MAP_LIMITS.propNameChars);
      expect(String(value).length).toBeLessThanOrEqual(MAP_LIMITS.propValueChars);
    }
  });

  it("drops a value and a size that are not numbers the scale can read", () => {
    expect(
      mapSpec({
        points: [
          { ...NYC, value: "4.2", size: -3 },
          { ...NYC, value: Number.NaN, size: "9" },
        ],
      }).points,
    ).toEqual([NYC, NYC]);
  });
});

describe("mapSpec: limits", () => {
  const many = (n: number) => Array.from({ length: n }, () => NYC);

  it("draws the last number of points it allows and refuses one more", () => {
    expect(mapSpec({ points: many(MAP_LIMITS.points) }).points).toHaveLength(
      MAP_LIMITS.points,
    );
    expect(() => mapSpec({ points: many(MAP_LIMITS.points + 1) })).toThrow(
      /the map has 20,001 points\. A map draws at most 20,000: aggregate the rows first/,
    );
  });

  it("counts the positions of all lines and areas together", () => {
    const path = Array.from({ length: MAP_LIMITS.vertices / 2 }, (_, at) => [
      (at % 360) - 180,
      0,
    ]);
    const line = { type: "line", coordinates: path };
    expect(mapSpec({ shapes: [line, line] }).shapes).toHaveLength(2);
    expect(() =>
      mapSpec({
        shapes: [
          line,
          line,
          {
            type: "line",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        ],
      }),
    ).toThrow(/more than 100,000 positions together/);
  });

  const segment = {
    type: "line",
    coordinates: [
      [0, 0],
      [1, 1],
    ],
  };
  const ring = [
    [0, 0],
    [1, 0],
    [1, 1],
  ];
  const pixel = {
    mime: "image/png",
    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    corners: [
      [-94, 42.1],
      [-93, 42.1],
      [-93, 41.9],
      [-94, 41.9],
    ],
  };
  const said = (n: number) => n.toLocaleString("en-US");
  const counted: {
    limit: "shapes" | "rings" | "regions" | "frames" | "images";
    of: (n: number) => unknown;
    held: (spec: MapSpec) => number | undefined;
    refusal: (most: number) => string;
  }[] = [
    {
      limit: "shapes",
      of: (n) => ({ shapes: Array.from({ length: n }, () => segment) }),
      held: (spec) => spec.shapes.length,
      refusal: (most) => `the map has ${said(most + 1)} lines and areas`,
    },
    {
      limit: "rings",
      of: (n) => ({
        shapes: [
          { type: "polygon", coordinates: Array.from({ length: n }, () => ring) },
        ],
      }),
      held: (spec) => spec.shapes[0].coordinates.length,
      refusal: (most) =>
        `has ${said(most + 1)} rings. An area has at most ${said(most)}.`,
    },
    {
      limit: "regions",
      of: (n) => ({
        regions: {
          set: "us-counties",
          items: Array.from({ length: n }, (_, at) => ({ code: String(10001 + at) })),
        },
      }),
      held: (spec) => spec.regions?.items.length,
      refusal: (most) => `the map has ${said(most + 1)} regions`,
    },
    {
      limit: "frames",
      of: (n) => ({
        points: Array.from({ length: n }, (_, at) => ({ ...NYC, time: at })),
      }),
      held: (spec) => new Set(spec.points.map((point) => point.time)).size,
      refusal: (most) => `the map has more than ${most} steps of time`,
    },
    {
      limit: "images",
      of: (n) => ({
        layers: Array.from({ length: n }, () => ({ kind: "image", image: pixel })),
      }),
      held: (spec) => spec.layers?.length,
      refusal: (most) => `the map has more than ${most} images`,
    },
  ];

  it.each(counted)(
    "holds the last number of $limit it allows and refuses one more",
    ({ limit, of, held, refusal }) => {
      const most = MAP_LIMITS[limit];
      expect(held(mapSpec(of(most)))).toBe(most);
      expect(() => mapSpec(of(most + 1))).toThrow(refusal(most));
    },
  );

  it("reads a map nested as deeply as the limit and refuses one level more, without overflowing", () => {
    const nested = (levels: number) => {
      let value: unknown = 1;
      for (let level = 5; level < levels; level++) value = [value];
      return { points: [{ ...NYC, props: { nested: value } }] };
    };
    const refusal = `output.map: the map is nested more than ${MAP_LIMITS.depth} levels deep.`;
    expect(mapSpec(nested(MAP_LIMITS.depth)).points).toHaveLength(1);
    expect(() => mapSpec(nested(MAP_LIMITS.depth + 1))).toThrow(refusal);
    expect(() => mapSpec(nested(5000))).toThrow(refusal);
  });
});

describe("mapSpec: the tilt a map opens at", () => {
  const points = [{ lat: 41.88, lon: -87.63, label: "Headquarters" }];

  it("keeps a tilt within the limit, in whole degrees, and nothing for a flat map", () => {
    const spec = mapSpec({ points, pitch: 44.6, context: ["buildings-3d"] });
    expect(spec.pitch).toBe(45);
    expect(spec.context).toEqual(["buildings-3d"]);
    expect(mapSpec({ points, pitch: 60 }).pitch).toBe(60);
    expect("pitch" in mapSpec({ points, pitch: 0 })).toBe(false);
    expect("pitch" in mapSpec({ points })).toBe(false);
    expect(mapSpec(spec)).toEqual(spec);
  });

  it.each([61, -1, 90, Number.NaN, Number.POSITIVE_INFINITY, "45", true, {}])(
    "refuses %s with what a tilt is",
    (pitch) => {
      expect(() => mapSpec({ points, pitch })).toThrow(
        "output.map: `pitch` is the tilt the map opens at, in degrees: a number from 0 (flat) to 60. 45 is a map seen at an angle.",
      );
    },
  );
});

describe("mapSpec: context layers of the basemap", () => {
  const points = [{ lat: 41.59, lon: -93.62 }];

  it("keeps the context layers a map asks for, as ids of the fixed list", () => {
    const spec = mapSpec({ points, context: ["pois", "buildings", "buildings"] });
    expect(spec.context).toEqual(["buildings", "pois"]);
    expect(mapSpec(spec)).toEqual(spec);
  });

  it("has no key for a map that asks for none", () => {
    expect("context" in mapSpec({ points })).toBe(false);
    expect("context" in mapSpec({ points, context: [] })).toBe(false);
  });

  it.each([
    [["roads"]],
    [["https://attacker.example/{z}/{x}/{y}.pbf"]],
    ["buildings"],
    [{ id: "buildings" }],
    [[{ url: "https://attacker.example" }]],
  ])("fails at the call for the context %j", (context) => {
    expect(() => mapSpec({ points, context })).toThrow(/^output\.map: .*context/);
  });
});

describe("mapSpec: the view the agent asks for", () => {
  it("opens at the center and zoom it names", () => {
    const spec = mapSpec({
      points: [{ ...NYC, label: "New York" }],
      view: { center: { lat: 48.8566, lon: 2.3522 }, zoom: 12 },
    }) as MapSpec;
    expect(spec.view).toMatchObject({ center: [2.3522, 48.8566], zoom: 12 });
  });

  it("opens on the bounds it names", () => {
    const spec = mapSpec({
      points: [{ ...NYC }],
      view: { bounds: [-80, 35, -70, 45] },
    }) as MapSpec;
    expect(spec.view?.bounds).toEqual([-80, 35, -70, 45]);
  });
});
