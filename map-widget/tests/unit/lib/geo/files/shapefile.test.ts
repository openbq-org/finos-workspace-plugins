import { describe, expect, it } from "vitest";
import { polygonsOf } from "~/lib/geo/files/shp";
import {
  type DbfColumn,
  dbf,
  PRJ,
  shp,
  shpContent,
  shpFrom,
  squareCcw,
  squareCw,
  toWebMercator,
  utf8,
  windows1252,
  zip,
} from "../../../../fixtures/geo/files/builders";
import { fixture, read, refusal } from "./support";

const NAME: DbfColumn[] = [{ name: "NAME", type: "C", length: 16 }];
const names = (...values: string[]) =>
  dbf(
    NAME,
    values.map((value) => [value]),
  );
const twoPoints = () =>
  shp([
    { kind: "point", at: [2.35, 48.85] },
    { kind: "point", at: [8.54, 47.37] },
  ]);

describe("shapefile: what is read", () => {
  it("reads points with a table of every kind of column", () => {
    const result = read(fixture("shp-points-wgs84.zip"));
    expect(result.kind).toBe("shapefile");
    expect(result.groups).toEqual([{ name: "cities" }]);
    expect(result.features).toEqual([
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-74.006, 40.7128] },
        properties: {
          NAME: "New York",
          POP: 8336817,
          AREA_KM2: 783.8,
          CAPITAL: false,
          FOUNDED: "1624-01-01",
        },
        name: "New York",
        group: 0,
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-87.6298, 41.8781] },
        properties: {
          NAME: "Chicago",
          POP: 2746388,
          AREA_KM2: 606.1,
          CAPITAL: false,
          FOUNDED: "1833-08-12",
        },
        name: "Chicago",
        group: 0,
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-104.9903, 39.7392] },
        properties: {
          NAME: "Denver",
          POP: 715522,
          AREA_KM2: 401.2,
          CAPITAL: true,
          FOUNDED: "1858-11-22",
        },
        name: "Denver",
        group: 0,
      },
    ]);
    expect(result.columns).toEqual([
      { name: "NAME", kind: "text" },
      { name: "POP", kind: "number" },
      { name: "AREA_KM2", kind: "number" },
      { name: "CAPITAL", kind: "text" },
      { name: "FOUNDED", kind: "date" },
    ]);
    expect(result.bounds).toEqual([-104.9903, 39.7392, -74.006, 41.8781]);
    expect(result.notes).toEqual([]);
  });

  it("reads lines, keeps each shape with its own row past a shape that is null, and reads NAD83 as WGS84", () => {
    const result = read(fixture("shp-lines-wgs84.zip"));
    expect(result.features.map((feature) => [feature.name, feature.geometry])).toEqual([
      [
        "Northeast",
        {
          type: "LineString",
          coordinates: [
            [-74, 40.7],
            [-75, 40.2],
            [-77, 38.9],
          ],
        },
      ],
      [
        "Midwest",
        {
          type: "MultiLineString",
          coordinates: [
            [
              [-87.6, 41.9],
              [-90.2, 38.6],
            ],
            [
              [-93.3, 44.9],
              [-87.9, 43],
            ],
          ],
        },
      ],
    ]);
    expect(result.notes).toEqual([
      'The layer "roads" is in NAD83. It was read as WGS84: the two are a metre or two apart.',
    ]);
  });

  it("reads an area with holes: the outline counter clockwise, then its holes clockwise", () => {
    const [park] = read(fixture("shp-polygon-holes-wgs84.zip")).features;
    expect(park.geometry).toEqual({
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
        [
          [2, 2],
          [2, 4],
          [4, 4],
          [4, 2],
          [2, 2],
        ],
        [
          [6, 6],
          [6, 8],
          [8, 8],
          [8, 6],
          [6, 6],
        ],
      ],
    });
  });

  it("gives each hole to the smallest outline around it, whatever the order of the rings", () => {
    const [islands] = read(fixture("shp-multipolygon-wgs84.zip")).features;
    expect(islands.geometry.type).toBe("MultiPolygon");
    const outlines =
      islands.geometry.type === "MultiPolygon" &&
      islands.geometry.coordinates.map((polygon) => polygon.map((ring) => ring[0]));
    expect(outlines).toEqual([
      [
        [0, 0],
        [1, 1],
      ],
      [
        [20, 0],
        [21, 1],
      ],
      [[3, 3]],
    ]);
  });

  it("converts Web Mercator to longitude and latitude, by its name and by its code", () => {
    const result = read(fixture("shp-points-webmercator.zip"));
    const expected = read(fixture("shp-points-wgs84.zip"));
    result.features.forEach((feature, at) => {
      const want = expected.features[at].geometry;
      if (feature.geometry.type !== "Point" || want.type !== "Point")
        throw new Error("a point");
      expect(feature.geometry.coordinates[0]).toBeCloseTo(want.coordinates[0], 6);
      expect(feature.geometry.coordinates[1]).toBeCloseTo(want.coordinates[1], 6);
      expect(feature.properties).toEqual(expected.features[at].properties);
    });
    expect(result.notes).toEqual([
      'The layer "cities" is in Web Mercator (EPSG:3857) and was converted to longitude and latitude.',
    ]);
    const byCode = read(
      zip({
        "a.shp": shp([{ kind: "point", at: toWebMercator([151.2093, -33.8688]) }]),
        "a.prj": PRJ.epsg3857,
      }),
    );
    const [sydney] = byCode.features;
    expect(
      sydney.geometry.type === "Point" && sydney.geometry.coordinates[0],
    ).toBeCloseTo(151.2093, 6);
    expect(
      sydney.geometry.type === "Point" && sydney.geometry.coordinates[1],
    ).toBeCloseTo(-33.8688, 6);
  });

  it("leaves out a position outside the square of Web Mercator", () => {
    const result = read(
      zip({
        "a.shp": shp([
          { kind: "point", at: [3e7, 0] },
          { kind: "point", at: [0, Number.NaN] },
          { kind: "point", at: [0, 0] },
        ]),
        "a.prj": PRJ.webMercator,
      }),
    );
    expect(result.features).toHaveLength(1);
    expect(result.notes).toContain(
      "2 features were left out: a position is not a longitude from -180 to 180 and a latitude from -90 to 90.",
    );
  });

  it("reads text in Windows-1252 when the .cpg file says so", () => {
    const result = read(fixture("shp-points-cp1252.zip"));
    expect(result.features.map((feature) => feature.properties)).toEqual([
      { NAME: "Café Œillet", PRICE: "5 €" },
      { NAME: "Zürich Süd", PRICE: "7 €" },
    ]);
    expect(result.notes).toEqual([]);
  });

  it.each([
    ["UTF-8 by its .cpg file", { "a.cpg": "UTF-8\r\n" }, 0, utf8, "Café Œillet €", []],
    ["UTF-8 by a code page number", { "a.cpg": "65001" }, 0, utf8, "Café Œillet €", []],
    [
      "Latin-1 by its .cpg file",
      { "a.cpg": "ISO-8859-1" },
      0,
      windows1252,
      "Café illet",
      [],
    ],
    [
      "Windows-1252 by the code page byte of the table",
      {},
      0x57,
      windows1252,
      "Café Œillet €",
      [],
    ],
    [
      "Latin-1, with a note, when nothing says",
      {},
      0,
      windows1252,
      "Café illet",
      [
        'The table of the layer "a" does not say what its text is in (it has no .cpg file). It was read as Latin-1: letters with accents may be wrong.',
      ],
    ],
    [
      "Latin-1, with a note, when the .cpg file names an encoding that is not read",
      { "a.cpg": "Big5 <script>" },
      0,
      windows1252,
      "Café illet",
      [
        'The table of the layer "a" says its text is in Big5 script, which is not read. It was read as Latin-1: letters with accents may be wrong.',
      ],
    ],
  ])("reads text as %s", (_what, extra, languageDriver, encode, text, notes) => {
    const result = read(
      zip({
        "a.shp": shp([{ kind: "point", at: [1, 2] }]),
        "a.dbf": dbf([{ name: "T", type: "C", length: 24 }], [["Café Œillet €"]], {
          encode,
          languageDriver,
        }),
        "a.prj": PRJ.wgs84,
        ...extra,
      }),
    );
    expect(result.features[0].properties.T).toBe(text);
    expect(result.notes).toEqual(notes);
  });

  it("says nothing about the encoding of a table that is all ASCII", () => {
    expect(
      read(
        zip({ "a.shp": twoPoints(), "a.dbf": names("One", "Two"), "a.prj": PRJ.wgs84 }),
      ).notes,
    ).toEqual([]);
  });

  it("reads the kinds with heights and measures, and ignores both", () => {
    const pointZ = new Uint8Array(36);
    pointZ.set(shpContent({ kind: "point", at: [10, 20] }));
    new DataView(pointZ.buffer).setInt32(0, 11, true);
    new DataView(pointZ.buffer).setFloat64(20, 9999, true);
    const flat = shpContent({ kind: "polygon", parts: [squareCw(0, 0, 1)] });
    const polygonZ = new Uint8Array(flat.length + 16 + 5 * 8);
    polygonZ.set(flat);
    new DataView(polygonZ.buffer).setInt32(0, 15, true);
    for (let at = flat.length; at < polygonZ.length; at += 8)
      new DataView(polygonZ.buffer).setFloat64(at, 7777, true);
    const multipointM = new Uint8Array(40 + 32 + 16 + 16);
    multipointM.set(
      shpContent({
        kind: "multipoint",
        points: [
          [1, 1],
          [2, 2],
        ],
      }),
    );
    new DataView(multipointM.buffer).setInt32(0, 28, true);
    const result = read(
      zip({
        "z.shp": shpFrom([pointZ, polygonZ, multipointM], 11),
        "z.prj": PRJ.wgs84,
        "z.dbf": names("P", "A", "M"),
      }),
    );
    expect(result.features.map((feature) => [feature.name, feature.geometry])).toEqual([
      ["P", { type: "Point", coordinates: [10, 20] }],
      [
        "A",
        {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
              [0, 0],
            ],
          ],
        },
      ],
      [
        "M",
        {
          type: "MultiPoint",
          coordinates: [
            [1, 1],
            [2, 2],
          ],
        },
      ],
    ]);
  });

  it("reads the values of a table as what its columns say they are", () => {
    const columns: DbfColumn[] = [
      { name: "N", type: "N", length: 8 },
      { name: "F", type: "F", length: 12 },
      { name: "L", type: "L", length: 1 },
      { name: "D", type: "D", length: 8 },
      { name: "C", type: "C", length: 6 },
      { name: "MEMO", type: "M", length: 10 },
    ];
    const result = read(
      zip({
        "a.shp": shp(
          Array.from({ length: 4 }, (_, at) => ({
            kind: "point" as const,
            at: [at, at],
          })),
        ),
        "a.prj": PRJ.wgs84,
        "a.dbf": dbf(columns, [
          ["-12", "1.5e3", "y", "20240229", " pad ", "1"],
          ["", "", "?", "", "", ""],
          ["****", "abc", "N", "2024-02", "0042", ""],
          ["7.25", "-0.5", "T", "00000000", "x", ""],
        ]),
      }),
    );
    expect(result.features.map((feature) => feature.properties)).toEqual([
      { N: -12, F: 1500, L: true, D: "2024-02-29", C: "pad" },
      { N: null, F: null, L: null, D: null, C: null },
      { N: null, F: null, L: false, D: null, C: "0042" },
      { N: 7.25, F: -0.5, L: true, D: null, C: "x" },
    ]);
    expect(result.columns).toEqual([
      { name: "N", kind: "number" },
      { name: "F", kind: "number" },
      { name: "L", kind: "text" },
      { name: "D", kind: "date" },
      { name: "C", kind: "text" },
    ]);
  });

  it("reads the layers of an archive as groups, whatever the case of their names and folders", () => {
    const result = read(
      zip({
        "One/Cities.SHP": twoPoints(),
        "One/cities.Dbf": names("Paris", "Zurich"),
        "One/CITIES.prj": PRJ.wgs84,
        "two/park.shp": shp([{ kind: "polygon", parts: [squareCw(0, 0, 10)] }]),
        "two/park.dbf": names("Park"),
        "two/park.prj": PRJ.wgs84,
      }),
    );
    expect(result.groups).toEqual([{ name: "Cities" }, { name: "park" }]);
    expect(result.features.map((feature) => [feature.name, feature.group])).toEqual([
      ["Paris", 0],
      ["Zurich", 0],
      ["Park", 1],
    ]);
  });

  it("reads shapes without a table, a table shorter than its shapes, and a row that was deleted", () => {
    const bare = read(zip({ "a.shp": twoPoints(), "a.prj": PRJ.wgs84 }));
    expect(bare.features.map((feature) => feature.properties)).toEqual([{}, {}]);
    expect(bare.notes).toEqual([
      'The layer "a" has no .dbf table: its shapes have no properties.',
    ]);
    const short = read(
      zip({ "a.shp": twoPoints(), "a.prj": PRJ.wgs84, "a.dbf": names("Only") }),
    );
    expect(short.features.map((feature) => feature.properties)).toEqual([
      { NAME: "Only" },
      {},
    ]);
    const deleted = read(
      zip({
        "a.shp": twoPoints(),
        "a.prj": PRJ.wgs84,
        "a.dbf": dbf(NAME, [["Gone"], ["Kept"]], { deleted: [0] }),
      }),
    );
    expect(deleted.features.map((feature) => feature.properties)).toEqual([
      {},
      { NAME: "Kept" },
    ]);
  });
});

describe("shapefile: the reference system of a layer", () => {
  it("refuses a layer in a projection it does not convert, and names it", () => {
    const error = refusal(fixture("shp-points-stateplane.zip"));
    expect(error.code).toBe("unsupported-projection");
    expect(error.message).toBe(
      'The layer "cities" was left out: it is in the projection "NAD 1983 StatePlane New York Long Island FIPS 3104 Feet", which is not converted. Re-export it as WGS84 (EPSG:4326).',
    );
  });

  it("reads the other layers of an archive when one is in a projection", () => {
    const result = read(fixture("shp-two-layers.zip"));
    expect(result.groups).toEqual([{ name: "cities" }]);
    expect(result.features).toHaveLength(3);
    expect(result.notes).toEqual([
      'The layer "park" was left out: it is in the projection "NAD 1983 StatePlane New York Long Island FIPS 3104 Feet", which is not converted. Re-export it as WGS84 (EPSG:4326).',
    ]);
  });

  it("reads a layer without a .prj file when every position is a longitude and a latitude", () => {
    const result = read(fixture("shp-points-noprj.zip"));
    expect(result.features).toHaveLength(3);
    expect(result.notes).toEqual([
      'The layer "cities" has no .prj file. Its positions are longitudes and latitudes, so it was read as WGS84.',
    ]);
  });

  it("refuses a layer without a .prj file when one position is not", () => {
    const error = refusal(
      zip({
        "grid.shp": shp([
          { kind: "point", at: [10, 20] },
          {
            kind: "polyline",
            parts: [
              [
                [1, 1],
                [500000, 4649776],
              ],
            ],
          },
        ]),
        "grid.dbf": names("a", "b"),
      }),
    );
    expect(error.code).toBe("unsupported-projection");
    expect(error.message).toBe(
      'The layer "grid" was left out: it has no .prj file and its positions are not longitudes and latitudes. Re-export it as WGS84 (EPSG:4326).',
    );
  });

  it("reads another geographic system as WGS84, with a note that names it", () => {
    const result = read(
      zip({ "a.shp": twoPoints(), "a.prj": PRJ.etrs89, "a.dbf": names("a", "b") }),
    );
    expect(result.features).toHaveLength(2);
    expect(result.notes).toEqual([
      'The layer "a" is in the geographic system "GCS ETRS 1989". It was read as WGS84: positions can be off by up to a few hundred metres.',
    ]);
  });

  it.each([
    [
      "a .prj file that is no reference system",
      "hello <b>world</b> https://attacker.example",
      /its \.prj file does not say a reference system/,
    ],
    [
      "a geographic system in grads",
      'GEOGCS["NTF (Paris)",DATUM["NTF"],UNIT["grad",0.015707963]]',
      /projection "NTF \(Paris\)"/,
    ],
    [
      "a compound system on a projection",
      `COMPD_CS["x",${PRJ.statePlane},VERT_CS["NAVD88"]]`,
      /which is not converted/,
    ],
    [
      "a WKT2 projection",
      'PROJCRS["ETRS89 / UTM zone 32N",BASEGEOGCRS["ETRS89"]]',
      /projection "ETRS89 \/ UTM zone 32N"/,
    ],
  ])("refuses %s", (_what, prj, message) => {
    const error = refusal(zip({ "a.shp": twoPoints(), "a.prj": prj }));
    expect(error.code).toBe("unsupported-projection");
    expect(error.message).toMatch(message);
    expect(error.message).not.toMatch(/attacker|<b>/);
  });

  it("leaves out a layer of a kind of shape the map does not draw", () => {
    const multipatch = new Uint8Array(60);
    new DataView(multipatch.buffer).setInt32(0, 31, true);
    const error = refusal(
      zip({ "roof.shp": shpFrom([multipatch], 31), "roof.prj": PRJ.wgs84 }),
    );
    expect(error.message).toBe(
      'The layer "roof" was left out: its shapes are of a kind (multipatch) the map does not draw.',
    );
  });
});

describe("shapefile: rings", () => {
  const firsts = (rings: [number, number][][]) =>
    polygonsOf(rings).map((polygon) => polygon.map((ring) => ring[0]));

  it("reads rings that all run counter clockwise as outlines: a file written the wrong way round", () => {
    expect(firsts([squareCcw(0, 0, 4), squareCcw(10, 10, 4)])).toEqual([
      [[0, 0]],
      [[10, 10]],
    ]);
  });

  it("reads a hole in nothing as an outline", () => {
    expect(firsts([squareCw(0, 0, 4), squareCcw(50, 50, 2)])).toEqual([
      [[0, 0]],
      [[50, 50]],
    ]);
  });

  it("gives a hole to the inner of two outlines around it", () => {
    const result = polygonsOf([
      squareCw(0, 0, 100),
      squareCw(10, 10, 50),
      squareCcw(20, 20, 5),
    ]);
    expect(result.map((polygon) => polygon.length)).toEqual([1, 2]);
  });

  it("winds every result as GeoJSON does", () => {
    const signed = (ring: [number, number][]) =>
      ring.reduce((sum, [x, y], at) => {
        const [nx, ny] = ring[(at + 1) % ring.length];
        return sum + (x * ny - nx * y);
      }, 0);
    for (const polygon of polygonsOf([
      squareCw(0, 0, 10),
      squareCcw(2, 2, 2),
      squareCcw(40, 40, 2),
    ])) {
      expect(signed(polygon[0])).toBeGreaterThan(0);
      for (const hole of polygon.slice(1)) expect(signed(hole)).toBeLessThan(0);
    }
  });
});
