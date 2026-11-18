import { describe, expect, it } from "vitest";
import { MAP_LIMITS } from "~/lib/codemode/limits";
import { mapFrames, mapLayers, mapOpeningFrame } from "~/lib/geo/mapLayers";
import { makeMap, mapSpec } from "~/lib/geo/mapSpec";
import { mapSummary } from "~/lib/geo/mapSummary";

const ATTACKER = "https://attacker.example";
const NYC = { lat: 40.71, lon: -74.01 };
const CHI = { lat: 41.88, lon: -87.63 };
const states = (items: unknown[]) => ({ set: "us-states", items });
const dots = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ lat: 0, lon: i / 1000 }));

describe("mapSpec: a map of the first form", () => {
  it("comes out without layers, as it always did", () => {
    const old = {
      title: "Old",
      valueLabel: "Rate",
      points: [{ ...NYC, value: 1 }],
      regions: states([{ code: "06", value: 2 }]),
      shapes: [],
    };
    expect(mapSpec(old)).toEqual(old);
    expect(Object.keys(mapSpec(old))).toEqual([
      "title",
      "valueLabel",
      "points",
      "regions",
      "shapes",
    ]);
  });

  it("is seen as layers in the order it was always drawn, one scale for all", () => {
    const spec = mapSpec({
      valueLabel: "Rate",
      points: [NYC],
      regions: states([{ code: "CA", value: 2 }]),
      shapes: [
        {
          type: "line",
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        },
        {
          type: "polygon",
          coordinates: [
            [
              [0, 0],
              [1, 1],
              [1, 0],
            ],
          ],
        },
      ],
    });
    const seen = mapLayers(spec);
    expect(seen.map((layer) => [layer.id, layer.kind, layer.implicit])).toEqual([
      ["regions", "regions", true],
      ["polygons", "polygons", true],
      ["lines", "lines", true],
      ["points", "points", true],
    ]);
    expect(seen[0].valueLabel).toBe("Rate");
    expect(seen[3].valueLabel).toBeUndefined();
  });
});

describe("mapSpec: layers", () => {
  const layered = {
    title: "Corn",
    layers: [
      {
        id: "yield",
        name: "Corn yield",
        kind: "regions",
        valueLabel: "bu/ac",
        regions: states([{ code: "IA", value: 200 }, { code: "Atlantis" }]),
      },
      {
        kind: "points",
        points: [{ ...CHI, label: "Elevator", value: 5 }],
        opacity: 0.5,
      },
      { kind: "heat", points: [NYC], visible: false },
      { kind: "clusters", points: [NYC, CHI] },
      {
        kind: "lines",
        group: "Routes",
        shapes: [
          {
            type: "line",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        ],
      },
      {
        kind: "flows",
        flows: [
          { from: { state: "IA" }, to: { state: "LA" }, value: 3, label: "IA to LA" },
          { from: { lat: 41, lon: -93 }, to: [-90, 30] },
        ],
      },
      { kind: "columns", regions: states([{ code: "IL", value: 1 }]) },
      { kind: "columns", points: [{ ...NYC, value: 4 }] },
      { kind: "source", source: "ndvi", name: "NDVI" },
    ],
    basemap: { source: "imagery" },
  };

  it("keeps each layer with its kind, an id and only the fields of a layer", () => {
    const spec = mapSpec(layered);
    expect(spec.points).toEqual([]);
    expect(spec.layers?.map((layer) => layer.id)).toEqual([
      "yield",
      "points-1",
      "heat-1",
      "clusters-1",
      "lines-1",
      "flows-1",
      "columns-1",
      "columns-2",
      "source-1",
    ]);
    expect(spec.layers?.[0]).toEqual({
      id: "yield",
      name: "Corn yield",
      valueLabel: "bu/ac",
      kind: "regions",
      regions: {
        set: "us-states",
        items: [{ code: "19", value: 200 }],
        unmatched: ["Atlantis"],
        unmatchedCount: 1,
      },
    });
    expect(spec.layers?.[1]).toMatchObject({ opacity: 0.5 });
    expect(spec.layers?.[2]).toMatchObject({ visible: false });
    expect(spec.layers?.[4]).toMatchObject({ group: "Routes" });
    expect(spec.layers?.[8]).toEqual({
      id: "source-1",
      name: "NDVI",
      kind: "source",
      source: "ndvi",
    });
    expect(spec.basemap).toEqual({ source: "imagery" });
  });

  it("turns the ends of a flow into positions", () => {
    const flows = mapSpec(layered).layers?.[5];
    expect(flows?.kind === "flows" && flows.flows[0].from).toEqual([
      expect.closeTo(-93.5, 0),
      expect.closeTo(42, 0),
    ]);
    expect(flows?.kind === "flows" && flows.flows[1]).toEqual({
      from: [-93, 41],
      to: [-90, 30],
    });
  });

  it("is idempotent", () => {
    const once = mapSpec(layered);
    expect(mapSpec(once)).toEqual(once);
    expect(JSON.stringify(mapSpec(JSON.parse(JSON.stringify(once))))).toBe(
      JSON.stringify(once),
    );
  });

  it("draws the top-level marks under the layers of the list", () => {
    const spec = mapSpec({ points: [NYC], layers: [{ kind: "heat", points: [CHI] }] });
    expect(mapLayers(spec).map((layer) => layer.id)).toEqual(["points", "heat-1"]);
  });

  it("gives a layer another id when its id is taken, missing or not of the grammar", () => {
    const spec = mapSpec({
      layers: [
        { id: "points", kind: "points", points: [NYC] },
        { id: "a", kind: "points", points: [NYC] },
        { id: "a", kind: "points", points: [NYC] },
        { id: `${ATTACKER}/x`, kind: "points", points: [NYC] },
        { id: 7, kind: "points", points: [NYC] },
      ],
    });
    expect(spec.layers?.map((layer) => layer.id)).toEqual([
      "points-1",
      "a",
      "points-2",
      "points-3",
      "points-4",
    ]);
  });

  it("clamps an opacity, and keeps visible only when it is false", () => {
    const spec = mapSpec({
      layers: [
        { kind: "points", points: [NYC], opacity: -3, visible: true },
        { kind: "points", points: [NYC], opacity: 4 },
        { kind: "points", points: [NYC], opacity: "0.5", visible: "no" },
      ],
    });
    expect(spec.layers?.[0]).toEqual({
      id: "points-1",
      opacity: 0,
      kind: "points",
      points: [NYC],
    });
    expect(spec.layers?.[1]).toEqual({ id: "points-2", kind: "points", points: [NYC] });
    expect(spec.layers?.[2]).toEqual({ id: "points-3", kind: "points", points: [NYC] });
  });

  it.each([
    [{ kind: "tiles", url: ATTACKER }, /layer 1 has the kind "tiles"/],
    [{ type: "raster", source: "x" }, /layer 1 has the kind undefined/],
    ["points", /layer 1 is not an object/],
    [{ kind: "columns" }, /needs either points or regions/],
    [
      { kind: "columns", points: [NYC], regions: states([{ code: "CA" }]) },
      /needs either points or regions/,
    ],
    [
      {
        kind: "polygons",
        shapes: [
          {
            type: "line",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        ],
      },
      /a shape that is not a polygon/,
    ],
    [{ kind: "flows", flows: [{ from: "Iowa", to: [0, 0] }] }, /An end of a flow is/],
    [
      { kind: "flows", flows: [{ from: [0, 0], to: { state: "Narnia" } }] },
      /none of the 1 points or flows names a state or a country the app knows, for example "Narnia"/,
    ],
    [{ kind: "flows", flows: [{ from: [0, 0], to: [999, 0] }] }, /position/],
    [{ kind: "points", points: "all" }, /"points" must be a list/],
  ])("refuses the layer %j", (layer, message) => {
    expect(() => mapSpec({ layers: [layer] })).toThrow(message);
  });

  it.each([
    `${ATTACKER}/{z}/{x}/{y}.png`,
    "//attacker.example/x",
    "Ndvi",
    "a/b",
    "a.b",
    "a:b",
    "",
    "x".repeat(41),
    7,
    null,
    { id: "ndvi" },
    ["ndvi"],
  ])("refuses the source %j: a source is an id, never an address", (source) => {
    expect(() => mapSpec({ layers: [{ kind: "source", source }] })).toThrow(
      /A map never carries an address/,
    );
    expect(() => mapSpec({ points: [NYC], basemap: { source } })).toThrow(
      /A map never carries an address/,
    );
  });

  it("copies no address a layer carries", () => {
    const spec = mapSpec({
      basemap: { source: "base", url: ATTACKER, tiles: [ATTACKER] },
      layers: [
        {
          kind: "source",
          source: "ndvi",
          url: ATTACKER,
          tiles: [`${ATTACKER}/{z}/{x}/{y}`],
          endpoint: ATTACKER,
          attribution: ATTACKER,
          style: { sources: {} },
        },
        {
          kind: "points",
          points: [{ ...NYC, icon: ATTACKER }],
          source: ATTACKER,
          paint: {},
        },
      ],
    });
    expect(JSON.stringify(spec)).not.toContain("attacker");
  });

  it("ignores a basemap that is not an object with a source", () => {
    expect(mapSpec({ points: [NYC], basemap: ATTACKER }).basemap).toBeUndefined();
    expect(
      mapSpec({ points: [NYC], basemap: { url: ATTACKER } }).basemap,
    ).toBeUndefined();
  });

  it("is a map with only a source layer, and empty with only empty layers", () => {
    expect(
      mapSpec({ layers: [{ kind: "source", source: "ndvi" }] }).layers,
    ).toHaveLength(1);
    expect(() => mapSpec({ layers: [{ kind: "points", points: [] }] })).toThrow(
      /the map is empty/,
    );
    expect(() => mapSpec({ layers: [] })).toThrow(/the map is empty/);
  });
});

describe("mapSpec: the limits of a map are those of all its layers together", () => {
  it("counts the points of every layer", () => {
    const half = dots(MAP_LIMITS.points / 2);
    expect(() =>
      mapSpec({
        points: half,
        layers: [
          { kind: "heat", points: half },
          { kind: "clusters", points: [NYC] },
        ],
      }),
    ).toThrow(/20,001 points\. A map draws at most 20,000/);
    expect(
      mapSpec({ points: half, layers: [{ kind: "heat", points: half }] }).layers,
    ).toHaveLength(1);
  });

  it("counts the regions, the shapes and the positions of every layer", () => {
    const many = Array.from({ length: MAP_LIMITS.regions }, () => ({ code: "CA" }));
    expect(() =>
      mapSpec({
        regions: states(many),
        layers: [{ kind: "columns", regions: states([{ code: "TX" }]) }],
      }),
    ).toThrow(/4,001 regions/);
    const line = {
      type: "line",
      coordinates: Array.from({ length: 60_000 }, (_, i) => [i / 1000, 0]),
    };
    expect(() =>
      mapSpec({ shapes: [line], layers: [{ kind: "lines", shapes: [line] }] }),
    ).toThrow(/more than 100,000 positions together/);
  });

  it("has at most 12 layers and 2,000 flows", () => {
    const layer = { kind: "points", points: [NYC] };
    expect(() =>
      mapSpec({ layers: Array.from({ length: MAP_LIMITS.layers + 1 }, () => layer) }),
    ).toThrow(/13 layers\. A map has at most 12/);
    const flow = { from: [0, 0], to: [1, 1] };
    expect(() =>
      mapSpec({
        layers: [
          { kind: "flows", flows: Array.from({ length: 1200 }, () => flow) },
          { kind: "flows", flows: Array.from({ length: 801 }, () => flow) },
        ],
      }),
    ).toThrow(/2,001 flows\. A map draws at most 2,000/);
  });
});

describe("mapSpec: the limits of a map, over all its layers", () => {
  const said = (n: number) => n.toLocaleString("en-US");
  const flow = { from: [0, 0], to: [1, 1] };
  const path = (positions: number) => ({
    type: "line",
    coordinates: Array.from({ length: positions }, (_, i) => [(i % 360) - 180, 0]),
  });
  const counties = (from: number, n: number) => ({
    set: "us-counties",
    items: Array.from({ length: n }, (_, i) => ({ code: String(10001 + from + i) })),
  });
  const counted: {
    limit: "layers" | "flows" | "vertices" | "regions" | "shapes";
    of: (n: number) => unknown;
    held: (layers: ReturnType<typeof mapLayers>) => number;
    refusal: (most: number) => string;
  }[] = [
    {
      limit: "layers",
      of: (n) => ({
        layers: Array.from({ length: n }, () => ({ kind: "points", points: [NYC] })),
      }),
      held: (layers) => layers.length,
      refusal: (most) => `the map has ${most + 1} layers. A map has at most ${most}.`,
    },
    {
      limit: "flows",
      of: (n) => ({
        layers: [
          { kind: "flows", flows: Array.from({ length: n - 1 }, () => flow) },
          { kind: "flows", flows: [flow] },
        ],
      }),
      held: (layers) =>
        layers.reduce(
          (sum, layer) => sum + (layer.kind === "flows" ? layer.flows.length : 0),
          0,
        ),
      refusal: (most) =>
        `the map has ${said(most + 1)} flows. A map draws at most ${said(most)}`,
    },
    {
      limit: "vertices",
      of: (n) => ({
        shapes: [path(n - 2)],
        layers: [{ kind: "lines", shapes: [path(2)] }],
      }),
      held: (layers) =>
        layers.reduce(
          (sum, layer) =>
            sum +
            (layer.kind === "lines"
              ? layer.shapes.reduce((all, shape) => all + shape.coordinates.length, 0)
              : 0),
          0,
        ),
      refusal: (most) =>
        `the lines and areas have more than ${said(most)} positions together`,
    },
    {
      limit: "regions",
      of: (n) => ({
        regions: counties(0, n - 1),
        layers: [{ kind: "regions", regions: counties(n - 1, 1) }],
      }),
      held: (layers) =>
        layers.reduce(
          (sum, layer) =>
            sum + (layer.kind === "regions" ? layer.regions.items.length : 0),
          0,
        ),
      refusal: (most) =>
        `the map has ${said(most + 1)} regions. A map has at most ${said(most)}`,
    },
    {
      limit: "shapes",
      of: (n) => ({
        shapes: Array.from({ length: n - 1 }, () => path(2)),
        layers: [{ kind: "lines", shapes: [path(2)] }],
      }),
      held: (layers) =>
        layers.reduce(
          (sum, layer) => sum + (layer.kind === "lines" ? layer.shapes.length : 0),
          0,
        ),
      refusal: (most) =>
        `the map has ${said(most + 1)} lines and areas. A map draws at most ${said(most)}`,
    },
  ];

  it.each(counted)(
    "holds the last number of $limit it allows and refuses one more",
    ({ limit, of, held, refusal }) => {
      const most = MAP_LIMITS[limit];
      expect(held(mapLayers(mapSpec(of(most))))).toBe(most);
      expect(() => mapSpec(of(most + 1))).toThrow(refusal(most));
    },
  );
});

describe("mapSpec: a map that plays", () => {
  const rows = [2021, 2022, 2023].flatMap((year) => [
    { code: "CA", value: year - 2000, time: year },
    { code: "TX", value: year - 2010, time: String(year) },
  ]);

  it("keeps one region for each step, and the first row of a step", () => {
    const spec = mapSpec({
      regions: states([...rows, { code: "California", value: 99, time: 2021 }]),
    });
    expect(spec.regions?.items).toHaveLength(6);
    expect(spec.regions?.items[0]).toEqual({ code: "06", value: 21, time: "2021" });
    expect(mapFrames(spec)).toEqual(["2021", "2022", "2023"]);
  });

  it("orders steps that are numbers as numbers and other text as text", () => {
    const at = (time: unknown) => ({ ...NYC, time });
    expect(mapFrames(mapSpec({ points: [at(10), at(9), at(100)] }))).toEqual([
      "9",
      "10",
      "100",
    ]);
    expect(
      mapFrames(mapSpec({ points: [at("2024-03"), at("2023-12"), at("2024-01")] })),
    ).toEqual(["2023-12", "2024-01", "2024-03"]);
  });

  it("reads the steps of every layer, and has none without a time", () => {
    expect(mapFrames(mapSpec({ points: [NYC] }))).toEqual([]);
    expect(
      mapFrames(
        mapSpec({
          points: [{ ...NYC, time: "b" }],
          layers: [{ kind: "flows", flows: [{ from: [0, 0], to: [1, 1], time: "a" }] }],
        }),
      ),
    ).toEqual(["a", "b"]);
  });

  it("refuses more steps than a map plays", () => {
    const points = Array.from({ length: MAP_LIMITS.frames + 1 }, (_, i) => ({
      ...NYC,
      time: i,
    }));
    expect(() => mapSpec({ points })).toThrow(/more than 60 steps of time/);
    expect(mapSpec({ points: points.slice(1) }).points).toHaveLength(60);
  });

  it("bounds the text of a step", () => {
    const spec = mapSpec({ points: [{ ...NYC, time: `${"x".repeat(40)}\u0000` }] });
    expect(spec.points[0].time).toHaveLength(MAP_LIMITS.frameChars);
    expect(mapSpec({ points: [{ ...NYC, time: { a: 1 } }] }).points[0]).toEqual(NYC);
  });
});

describe("mapSpec: the step a map that plays opens on", () => {
  const at = (time: unknown) => ({ ...NYC, time });
  const points = [at(2019), at(2020), at(2021)];

  it("keeps a step of the map as text, and comes out equal the second time", () => {
    const spec = mapSpec({ points, frame: 2020 });
    expect(spec.frame).toBe("2020");
    expect(mapSpec(spec)).toEqual(spec);
    expect(mapSpec({ points, frame: " 2021 " }).frame).toBe("2021");
    expect(mapSpec({ points }).frame).toBeUndefined();
    expect(mapSummary(spec).frame).toBe("2020");
  });

  it("refuses a step the map does not have, with the steps it has", () => {
    expect(() => mapSpec({ points, frame: "2018" })).toThrow(
      /`frame` is "2018", which is not a step of this map: its 3 steps go from 2019 to 2021\./,
    );
    expect(() => mapSpec({ points: [NYC], frame: "2020" })).toThrow(
      /`frame` is the step a map that plays opens on, and this map has no steps/,
    );
  });

  it("reads hostile input as no step or as bounded text", () => {
    for (const frame of [{ toString: () => "2020" }, ["2020"], null, true, ""])
      expect(mapSpec({ points, frame }).frame).toBeUndefined();
    expect(() =>
      mapSpec({ points, frame: `2020\u0000<script>${"x".repeat(200)}` }),
    ).toThrow(/^output\.map: `frame` is "2020<script>x{12}", which is not a step/);
  });
});

describe("mapSummary: a map of layers", () => {
  it("counts the marks of all layers and says what each layer is, never its marks", () => {
    const summary = mapSummary(
      mapSpec({
        title: "Corn",
        layers: [
          {
            id: "yield",
            name: "Corn yield",
            valueLabel: "bu/ac",
            kind: "regions",
            regions: states([
              { code: "IA", value: 200, label: "Iowa", time: 2024 },
              { code: "IL", value: 210, time: 2025 },
            ]),
          },
          {
            kind: "points",
            points: [{ ...CHI, value: 5, marker: "star", label: "Top" }],
          },
          { kind: "flows", flows: [{ from: [-93, 41], to: [-90, 30], value: 3 }] },
          { kind: "source", source: "ndvi", visible: false },
        ],
        basemap: { source: "imagery" },
      }),
    );
    expect(summary).toEqual({
      points: 1,
      regions: 2,
      regionSet: "us-states",
      shapes: 0,
      flows: 1,
      tags: 0,
      marked: 1,
      markedLabels: ["Top"],
      title: "Corn",
      bounds: [-93, 30, -87.63, 41.88],
      valueRange: [3, 210],
      labels: ["Iowa", "Top"],
      layers: [
        {
          id: "yield",
          kind: "regions",
          name: "Corn yield",
          valueLabel: "bu/ac",
          count: 2,
          valueRange: [200, 210],
          regionSet: "us-states",
        },
        { id: "points-1", kind: "points", count: 1, valueRange: [5, 5] },
        { id: "flows-1", kind: "flows", count: 1, valueRange: [3, 3] },
        { id: "source-1", kind: "source", count: 0, source: "ndvi", hidden: true },
      ],
      frames: 2,
      frameRange: ["2024", "2025"],
      frame: "2025",
      basemapSource: "imagery",
    });
  });

  it("is what it always was for a map of the first form", () => {
    const summary = mapSummary(
      mapSpec({ points: [{ ...NYC, label: "NY", value: 1 }], valueLabel: "V" }),
    );
    expect(summary).toEqual({
      points: 1,
      regions: 0,
      shapes: 0,
      tags: 0,
      valueLabel: "V",
      bounds: [-74.01, 40.71, -74.01, 40.71],
      valueRange: [1, 1],
      labels: ["NY"],
    });
  });
});

describe("the regions a map shades over its steps", () => {
  const county = (at: number) => String(1001 + at * 2).padStart(5, "0");

  it("says fewer steps or fewer regions when the rows have a time: not to aggregate the steps away", () => {
    const items = [2023, 2024].flatMap((year) =>
      Array.from({ length: 2100 }, (_, at) => ({
        code: county(at),
        value: at,
        time: year,
      })),
    );
    expect(() => makeMap({ regions: { set: "us-counties", items } })).toThrow(
      "output.map: the map has 4,200 regions over its steps of time, and a region counts once on each step. A map has at most 4,000 over all its steps: draw fewer steps or fewer regions (regions x steps is at most 4,000).",
    );
    expect(() =>
      makeMap({
        layers: [
          {
            kind: "regions",
            regions: { set: "us-counties", items: items.slice(0, 2100) },
          },
          {
            kind: "columns",
            regions: { set: "us-counties", items: items.slice(2100) },
          },
        ],
      }),
    ).toThrow(/regions x steps is at most 4,000/);
  });

  it("says to aggregate when the rows have no time", () => {
    const items = Array.from({ length: 4001 }, (_, at) => ({ code: county(at) }));
    expect(() => makeMap({ regions: { set: "us-counties", items } })).toThrow(
      "output.map: the map has 4,001 regions. A map has at most 4,000: aggregate the rows to one row for each region first (table.groupBy).",
    );
  });

  it("draws the most a map has: 2,000 regions on two steps", () => {
    const items = [2023, 2024].flatMap((year) =>
      Array.from({ length: 2000 }, (_, at) => ({ code: county(at), time: year })),
    );
    expect(
      makeMap({ regions: { set: "us-counties", items } }).regions?.items,
    ).toHaveLength(4000);
  });
});

describe("the step a map that plays opens on", () => {
  const steps = (counts: Record<string, number>, more: object = {}) =>
    mapSpec({
      points: Object.entries(counts).flatMap(([time, count]) =>
        Array.from({ length: count }, (_, at) => ({ lat: at, lon: at, time })),
      ),
      ...more,
    });

  it("is its last step when the steps are equally full, as regions over the years are", () => {
    expect(mapOpeningFrame(steps({ "2023": 5, "2024": 5, "2025": 5 }))).toBe("2025");
  });

  it("is the latest step with at least half the marks of the fullest one", () => {
    expect(mapOpeningFrame(steps({ "2025-10": 12, "2025-11": 9, "2025-12": 2 }))).toBe(
      "2025-11",
    );
    expect(mapOpeningFrame(steps({ "2025-10": 12, "2025-11": 6, "2025-12": 6 }))).toBe(
      "2025-12",
    );
  });

  it("is the step the map names, however full it is, and no step of a map that does not play", () => {
    expect(
      mapOpeningFrame(steps({ "2025-10": 12, "2025-12": 1 }, { frame: "2025-12" })),
    ).toBe("2025-12");
    expect(mapOpeningFrame(mapSpec({ points: [{ lat: 1, lon: 1 }] }))).toBeUndefined();
  });
});
