import { describe, expect, it } from "vitest";
import { GEO_FILE_LIMITS } from "~/lib/geo/files";
import { utf8 } from "../../../../fixtures/geo/files/builders";
import { cpuBudget, cpuNow } from "../../../machinePace";
import { fixture, read, refusal } from "./support";

const file = (value: unknown) => utf8(JSON.stringify(value));
const point = (properties: Record<string, unknown> = {}, at = [1, 2]) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: at },
  properties,
});
const collection = (features: unknown[]) => ({ type: "FeatureCollection", features });

describe("geojson: what is read", () => {
  it("reads a FeatureCollection: geometry without height, typed properties, name and style", () => {
    const result = read(fixture("collection.geojson"));
    expect(result.kind).toBe("geojson");
    expect(result.features).toEqual([
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [2.3522, 48.8566] },
        properties: {
          name: "Paris",
          population: 2161000,
          capital: true,
          since: "0508-01-01",
          tags: '["city","capital"]',
          meta: '{"source":"census","year":2020}',
        },
        name: "Paris",
        description: "The capital of France",
        style: { color: "#cc0000" },
      },
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [2.35, 48.85],
            [4.83, 45.76],
          ],
        },
        properties: { name: "Paris to Lyon" },
        name: "Paris to Lyon",
        style: { color: "#0055aa", lineWidth: 4 },
      },
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [2, 48],
              [3, 48],
              [3, 49],
              [2, 49],
              [2, 48],
            ],
          ],
        },
        properties: { title: "Box", population: null },
        name: "Box",
        style: { fillColor: "#ffcc00", fillOpacity: 0.4 },
      },
    ]);
    expect(result.columns).toEqual([
      { name: "name", kind: "text" },
      { name: "population", kind: "number" },
      { name: "capital", kind: "text" },
      { name: "since", kind: "date" },
      { name: "tags", kind: "text" },
      { name: "meta", kind: "text" },
      { name: "title", kind: "text" },
    ]);
    expect(result.bounds).toEqual([2, 45.76, 4.83, 49]);
    expect(result.groups).toEqual([]);
    expect(result.overlays).toEqual([]);
    expect(result.notes).toEqual([
      "1 feature has no geometry and is not on the map.",
      "1 value that is an address was left out. Addresses in a file are not kept.",
    ]);
  });

  it("reads one Feature and a bare geometry", () => {
    expect(read(fixture("feature.geojson")).features).toHaveLength(1);
    const bare = read(fixture("geometry.geojson"));
    expect(bare.features).toEqual([
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [2, 48],
              [3, 48],
              [3, 49],
              [2, 49],
              [2, 48],
            ],
          ],
        },
        properties: {},
      },
    ]);
  });

  it("flattens a GeometryCollection into features that share the properties", () => {
    const result = read(fixture("geometry-collection.geojson"));
    expect(
      result.features.map((feature) => [feature.geometry.type, feature.name]),
    ).toEqual([
      ["Point", "Campus"],
      ["MultiPoint", "Campus"],
      ["MultiPolygon", "Campus"],
    ]);
  });

  it("reads a file with a byte order mark and white space before it", () => {
    const bytes = Uint8Array.of(0xef, 0xbb, 0xbf, 0x0a, 0x20, ...file(point()));
    expect(read(bytes).features).toHaveLength(1);
  });

  it("closes a ring that is not closed, and makes a multi of one part the simple kind", () => {
    const [feature] = read(
      file({
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [0, 0],
              [1, 0],
              [1, 1],
            ],
          ],
        ],
      }),
    ).features;
    expect(feature.geometry).toEqual({
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    });
  });
});

describe("geojson: what is refused or left out", () => {
  it.each([
    ["urn:ogc:def:crs:OGC:1.3:CRS84"],
    ["urn:ogc:def:crs:OGC::CRS84"],
    ["EPSG:4326"],
    ["urn:ogc:def:crs:EPSG::4326"],
  ])("accepts the reference system %s", (name) => {
    const crs = { type: "name", properties: { name } };
    expect(read(file({ ...collection([point()]), crs })).features).toHaveLength(1);
  });

  it("refuses a reference system that is not WGS84", () => {
    const error = refusal(fixture("crs-3857.geojson"));
    expect(error.code).toBe("unsupported-projection");
    expect(error.message).toMatch(/EPSG::3857.*Re-export it as WGS84/);
    for (const crs of [
      { type: "link", properties: { href: "https://attacker.example/crs" } },
      { type: "name", properties: {} },
      "EPSG:4326",
    ]) {
      const refused = refusal(file({ ...collection([point()]), crs }));
      expect(refused.code).toBe("unsupported-projection");
      expect(refused.message).not.toContain("attacker");
    }
  });

  it("leaves out a feature with a position outside the world, and says so", () => {
    const result = read(
      file(
        collection([point({ name: "ok" }), point({}, [200, 0]), point({}, [0, 91])]),
      ),
    );
    expect(result.features.map((feature) => feature.name)).toEqual(["ok"]);
    expect(result.notes).toEqual([
      "2 features were left out: a position is not a longitude from -180 to 180 and a latitude from -90 to 90.",
    ]);
  });

  it.each([
    ["a position of texts", { type: "Point", coordinates: ["1", "2"] }],
    ["a position of one number", { type: "Point", coordinates: [1] }],
    ["a position that is not a number", { type: "Point", coordinates: [null, null] }],
    ["a line of one position", { type: "LineString", coordinates: [[1, 2]] }],
    ["a line that is not a list", { type: "LineString", coordinates: "1,2 3,4" }],
    ["an area whose ring is a position", { type: "Polygon", coordinates: [[1, 2]] }],
    [
      "an area with a ring of two positions",
      {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 1],
          ],
        ],
      },
    ],
    ["a kind nobody knows", { type: "Circle", coordinates: [1, 2], radius: 3 }],
    ["no kind", { coordinates: [1, 2] }],
    [
      "a collection too deep",
      Array.from({ length: 12 }).reduce(
        (inner) => ({ type: "GeometryCollection", geometries: [inner] }),
        { type: "Point", coordinates: [1, 2] },
      ),
    ],
  ])("leaves out %s and keeps the rest", (_what, geometry) => {
    const result = read(
      file(
        collection([
          { type: "Feature", geometry, properties: {} },
          point({ name: "ok" }),
        ]),
      ),
    );
    expect(result.features.map((feature) => feature.name)).toEqual(["ok"]);
    expect(result.notes).toHaveLength(1);
  });

  it("says what a JSON file is when it is not GeoJSON", () => {
    expect(refusal(utf8('{"type":"FeatureCollection","features":[')).code).toBe(
      "malformed",
    );
    expect(refusal(utf8('{"rows":[1,2]}')).code).toBe("unknown-format");
    expect(refusal(utf8("[1,2,3]")).code).toBe("unknown-format");
    expect(refusal(utf8('{"type":"Topology","objects":{}}')).message).toMatch(
      /TopoJSON/,
    );
    expect(refusal(file({ type: "FeatureCollection", features: 3 })).code).toBe(
      "malformed",
    );
    expect(refusal(file(collection([]))).code).toBe("empty");
  });

  it("refuses brackets nested deeper than GeoJSON ever is, before it parses them", () => {
    const deep = `{"type":"Point","coordinates":${"[".repeat(2_000_000)}`;
    const started = cpuNow();
    const error = refusal(utf8(deep));
    expect(cpuNow() - started).toBeLessThan(cpuBudget(1000));
    expect(error.code).toBe("too-large");
    expect(error.message).toMatch(/nested more than 64 levels/);
    const quoted = file(point({ note: `${"[".repeat(500)}\\"${"{".repeat(500)}` }));
    expect(read(quoted).features).toHaveLength(1);
  });
});

describe("geojson: limits", () => {
  it("keeps the first 20,000 features and says the file has more", () => {
    const many = Array.from({ length: GEO_FILE_LIMITS.features + 5 }, (_, at) =>
      point({ n: at }, [at / 1000, 0]),
    );
    const result = read(file(collection(many)));
    expect(result.features).toHaveLength(GEO_FILE_LIMITS.features);
    expect(result.features.at(-1)?.properties.n).toBe(GEO_FILE_LIMITS.features - 1);
    expect(result.notes).toEqual([
      "The file has more than 20,000 features. Only the first 20,000 are shown.",
    ]);
    expect(
      read(file(collection(many.slice(0, GEO_FILE_LIMITS.features)))).notes,
    ).toEqual([]);
  });

  it("leaves out a shape that does not fit in 100,000 positions, and keeps the others", () => {
    const long = Array.from({ length: GEO_FILE_LIMITS.vertices + 1 }, (_, at) => [
      at / 1000,
      0,
    ]);
    const result = read(
      file(
        collection([
          point({ name: "before" }),
          {
            type: "Feature",
            geometry: { type: "LineString", coordinates: long },
            properties: {},
          },
          point({ name: "after" }),
        ]),
      ),
    );
    expect(result.features.map((feature) => feature.name)).toEqual(["before", "after"]);
    expect(result.notes).toEqual([
      "1 shape was left out: the lines and areas of one file have at most 100,000 positions together. Simplify the file to see all of it.",
    ]);
  });

  it("leaves out a shape of more than 2,000 parts", () => {
    const rings = Array.from({ length: GEO_FILE_LIMITS.parts + 1 }, () => [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ]);
    const result = read(
      file(
        collection([
          {
            type: "Feature",
            geometry: { type: "Polygon", coordinates: rings },
            properties: {},
          },
          point(),
        ]),
      ),
    );
    expect(result.features).toHaveLength(1);
    expect(result.notes).toEqual(["1 shape with more than 2,000 parts was left out."]);
  });

  const feature = (geometry: unknown) => ({
    type: "Feature",
    geometry,
    properties: {},
  });
  const ring = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 0],
  ];
  it.each([
    {
      limit: "vertices" as const,
      shape: (count: number) => ({
        type: "LineString",
        coordinates: Array.from({ length: count - 1 }, (_, at) => [at / 1000, 0]),
      }),
      note: (most: string) =>
        `1 shape was left out: the lines and areas of one file have at most ${most} positions together. Simplify the file to see all of it.`,
    },
    {
      limit: "parts" as const,
      shape: (count: number) => ({
        type: "Polygon",
        coordinates: Array.from({ length: count }, () => ring),
      }),
      note: (most: string) => `1 shape with more than ${most} parts was left out.`,
    },
  ])(
    "keeps a shape of exactly the limit of $limit, and leaves out one of one more",
    ({ limit, shape, note }) => {
      const most = GEO_FILE_LIMITS[limit];
      const of = (count: number) =>
        read(file(collection([point({ name: "beside" }), feature(shape(count))])));
      expect(of(most).features).toHaveLength(2);
      expect(of(most).notes).toEqual([]);
      expect(of(most + 1).features.map((kept) => kept.name)).toEqual(["beside"]);
      expect(of(most + 1).notes).toEqual([note(most.toLocaleString("en-US"))]);
    },
  );

  const named = (from: number, count: number) =>
    Object.fromEntries(
      Array.from({ length: count }, (_, at) => [`p${from + at}`, from + at]),
    );
  it.each([
    {
      limit: "properties" as const,
      of: (count: number) => point(named(0, count)),
      held: (result: ReturnType<typeof read>) =>
        Object.keys(result.features[0].properties).length,
      notes: (most: number) => [
        `Some features have more than ${most} properties. Only the first ${most} of each are kept.`,
      ],
    },
    {
      limit: "columns" as const,
      of: (count: number) =>
        collection(
          Array.from({ length: Math.ceil(count / 16) }, (_, at) =>
            point(named(at * 16, Math.min(16, count - at * 16))),
          ),
        ),
      held: (result: ReturnType<typeof read>) => result.columns.length,
      notes: () => [],
    },
  ])(
    "keeps exactly the limit of $limit, and no more of one more",
    ({ limit, of, held, notes }) => {
      const most = GEO_FILE_LIMITS[limit];
      const at = read(file(of(most)));
      expect(held(at)).toBe(most);
      expect(at.notes).toEqual([]);
      const over = read(file(of(most + 1)));
      expect(held(over)).toBe(most);
      expect(over.notes).toEqual(notes(most));
    },
  );

  it("reads JSON nested exactly as deep as the limit, and refuses one level more", () => {
    const nested = (levels: number) =>
      utf8(
        `{"type":"Feature","geometry":{"type":"Point","coordinates":[1,2]},"properties":{"deep":${"[".repeat(levels - 2)}1${"]".repeat(levels - 2)}}}`,
      );
    expect(read(nested(GEO_FILE_LIMITS.jsonDepth)).features).toHaveLength(1);
    const error = refusal(nested(GEO_FILE_LIMITS.jsonDepth + 1));
    expect(error.code).toBe("too-large");
    expect(error.message).toBe(
      `The JSON is nested more than ${GEO_FILE_LIMITS.jsonDepth} levels deep. GeoJSON never is.`,
    );
  });

  it("bounds the properties of a feature: how many, their names and their texts", () => {
    const properties: Record<string, unknown> = {};
    for (let at = 0; at < 50; at++) properties[`p${at}`] = at;
    const many = read(file(point(properties)));
    expect(Object.keys(many.features[0].properties)).toHaveLength(
      GEO_FILE_LIMITS.properties,
    );
    expect(many.notes).toEqual([
      "Some features have more than 32 properties. Only the first 32 of each are kept.",
    ]);

    const long = read(
      file(
        point({
          name: "n".repeat(5000),
          ["k".repeat(500)]: 1,
          text: "t".repeat(100_000),
          nested: { list: Array.from({ length: 10_000 }, (_, at) => at) },
          description: "d".repeat(100_000),
        }),
      ),
    );
    const [feature] = long.features;
    expect(feature.name).toHaveLength(GEO_FILE_LIMITS.nameChars);
    expect(feature.description).toHaveLength(GEO_FILE_LIMITS.descriptionChars);
    expect(Object.keys(feature.properties).map((key) => key.length)).toEqual([
      4, 64, 4, 6,
    ]);
    for (const value of Object.values(feature.properties))
      expect(String(value).length).toBeLessThanOrEqual(
        GEO_FILE_LIMITS.propertyValueChars,
      );
    expect(long.notes).toEqual(["Some long texts were cut."]);
  });

  it("keeps numbers that are numbers, and nothing that could be a key of every object", () => {
    const raw = `{"type":"Feature","geometry":{"type":"Point","coordinates":[1,2]},"properties":{"__proto__":{"polluted":true},"constructor":"c","big":1e999,"nan":null,"line":"a\\nb\\u0000c"}}`;
    const [feature] = read(utf8(raw)).features;
    expect(feature.properties).toEqual({
      constructor: "c",
      big: null,
      nan: null,
      line: "a b c",
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("takes out a mark that reorders text, so a value reads as it is written", () => {
    const raw = `{"type":"Feature","geometry":{"type":"Point","coordinates":[1,2]},"properties":{"file\u2066":"invoice\u202Efdp.exe","c1":"a\u0085b"}}`;
    const [feature] = read(utf8(raw)).features;
    expect(feature.properties).toEqual({ file: "invoice fdp.exe", c1: "a b" });
  });
});
