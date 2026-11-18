import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import "~/lib/geo/mapFile";
import { MAP_LIMITS } from "~/lib/codemode/limits";
import { mapCategories, mapFrames } from "~/lib/geo/mapLayers";
import { mapRows } from "~/lib/geo/mapRows";
import { makeMap, mapSpec } from "~/lib/geo/mapSpec";
import { mapSummary } from "~/lib/geo/mapSummary";
import { jpegHeader, png, webpHeader, zip } from "../../../fixtures/geo/files/builders";

const fixture = (name: string) =>
  readFileSync(join(process.cwd(), "tests/fixtures/geo/files", name));
const base64 = (name: string) => fixture(name).toString("base64");
const base64Of = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const CORNERS = [
  [-94, 42.1],
  [-93, 42.1],
  [-93, 41.9],
  [-94, 41.9],
];

describe("output.map({ file })", () => {
  it("reads a KMZ into layers under its folders, with its image and no address", () => {
    const spec = makeMap({ file: { name: "sample.kmz", data: base64("sample.kmz") } });
    expect(
      (spec.layers ?? []).map(({ kind, name, group }) => ({ kind, name, group })),
    ).toEqual([
      { kind: "image", name: "Survey photo", group: undefined },
      { kind: "points", name: "Sites", group: "Sites" },
      {
        kind: "lines",
        name: "Sites / Routes",
        group: "Sites / Routes",
      },
      { kind: "polygons", name: "Areas", group: "Zones" },
      { kind: "lines", name: "Lines", group: "Zones" },
      { kind: "points", name: "Points", group: "Zones" },
    ]);
    expect({ title: spec.title, points: spec.points, shapes: spec.shapes }).toEqual({
      title: "Field survey",
      points: [],
      shapes: [],
    });
    const images = (spec.layers ?? []).flatMap((layer) =>
      layer.kind === "image" ? [layer.image] : [],
    );
    expect(images).toHaveLength(1);
    expect(images[0].mime).toBe("image/png");
    expect(images[0].data).toBe(
      base64Of(unzipSync(fixture("sample.kmz"))["files/photo.png"]),
    );
    expect(images[0].corners).toHaveLength(4);
    for (const [lon, lat] of images[0].corners) {
      expect(lon).toBeGreaterThan(-77.08);
      expect(lon).toBeLessThan(-77);
      expect(lat).toBeGreaterThan(38.86);
      expect(lat).toBeLessThan(38.94);
      expect([-77.06, -77.02]).not.toContain(lon);
    }
    expect(JSON.stringify(spec)).not.toMatch(/https?:\/\//);
    expect(mapSpec(spec)).toEqual(spec);
  });

  it("reads a zipped shapefile, GPX and GeoJSON, by bytes or by text", () => {
    const shp = makeMap({
      file: { name: "areas.zip", data: base64("shp-polygon-holes-wgs84.zip") },
    });
    expect(mapSummary(shp).shapes).toBeGreaterThan(0);
    expect(shp.title).toBe("areas");
    const gpx = makeMap({
      file: { name: "a.gpx", text: fixture("sample.gpx").toString() },
    });
    expect(mapSummary(gpx).points + mapSummary(gpx).shapes).toBeGreaterThan(0);
    const geo = makeMap({
      file: { name: "a.geojson", text: fixture("collection.geojson").toString() },
    });
    expect(mapRows(geo).length).toBeGreaterThan(0);
  });

  it("colours by a number property, and says when the file has none of that name", () => {
    const text = JSON.stringify({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name: "A", acres: 12 },
          geometry: { type: "Point", coordinates: [-93, 42] },
        },
      ],
    });
    const spec = makeMap({ file: { name: "a.geojson", text, value: "acres" } });
    expect(spec.points[0]).toMatchObject({ lat: 42, lon: -93, value: 12 });
    const other = makeMap({ file: { name: "a.geojson", text, value: "yield" } });
    expect(other.notes?.join(" ")).toMatch(/no property "yield" to colour by.*acres/);
    expect(mapSummary(other).notes).toEqual(other.notes);
  });

  it("colours by a text property as categories, bounded, and says when `value` names text", () => {
    const feature = (name: string, crop: unknown, lon: number) => ({
      type: "Feature",
      properties: { name, crop, acres: 10 },
      geometry: { type: "Point", coordinates: [lon, 42] },
    });
    const file = (features: unknown[], options: object) => ({
      file: {
        name: "a.geojson",
        text: JSON.stringify({ type: "FeatureCollection", features }),
        ...options,
      },
    });
    const three = [
      feature("A", "soy", -93),
      feature("B", "corn", -94),
      feature("C", "soy", -95),
    ];
    const spec = makeMap(file(three, { category: "crop" }));
    expect(spec.points.map((point) => point.category)).toEqual(["soy", "corn", "soy"]);
    expect(spec.categoryLabel).toBe("crop");
    expect(mapCategories(spec)).toEqual(["corn", "soy"]);
    expect(mapSummary(spec)).toMatchObject({
      categories: ["corn", "soy"],
      categoryLabel: "crop",
    });
    expect(mapSpec(spec)).toEqual(spec);
    const wrong = makeMap(file(three, { value: "crop" }));
    expect(wrong.points[0]).not.toHaveProperty("value");
    expect(wrong.notes?.join(" ")).toMatch(
      /The property "crop" is text, so `value` colours nothing by it: pass it as `category`/,
    );
    expect(makeMap(file(three, { category: "kind" })).notes?.join(" ")).toMatch(
      /no property "kind" to colour by/,
    );
    const many = Array.from({ length: 14 }, (_, at) =>
      feature(`F${at}`, `crop ${at}`, -93 - at / 10),
    );
    const cut = makeMap(file(many, { category: "crop" }));
    expect(mapCategories(cut)).toHaveLength(MAP_LIMITS.categories);
    expect(cut.points[13]).not.toHaveProperty("category");
    expect(cut.notes?.join(" ")).toMatch(
      /has 14 values: the first 12 have a colour of their own/,
    );
    const odd = mapSpec({
      points: [
        { lat: 1, lon: 1, category: `a\u0000<b>${"x".repeat(80)}` },
        { lat: 2, lon: 2, category: { toString: () => "x" } },
        { lat: 3, lon: 3, category: 7 },
      ],
      categoryLabel: "kind",
    });
    expect(odd.points[0].category).toHaveLength(MAP_LIMITS.categoryChars);
    expect(odd.points[1]).not.toHaveProperty("category");
    expect(odd.points[2].category).toBe("7");
    expect(
      mapSpec({ points: [{ lat: 1, lon: 1 }], categoryLabel: "kind" }),
    ).not.toHaveProperty("categoryLabel");
  });

  it.each([
    ["hostile-doctype.kml"],
    ["hostile-bomb.kmz"],
    ["hostile-deep.kml"],
    ["hostile-nested.zip"],
    ["hostile-truncated-shp.zip"],
  ])("refuses %s with the reason, as an error of output.map", (name) => {
    expect(() => makeMap({ file: { name, data: base64(name) } })).toThrow(
      /^output\.map: the file cannot be read: /,
    );
  });

  it("refuses what is not a file, and a file over the size a map reads", () => {
    expect(() => makeMap({ file: "https://attacker.example/a.kml" })).toThrow(
      /"file" must be \{ name, data \}/,
    );
    expect(() => makeMap({ file: { name: "a.kml", url: "https://x" } })).toThrow(
      /"file" must be/,
    );
    expect(() => makeMap({ file: { name: "a.kmz", data: "not base64!" } })).toThrow(
      /not base64/,
    );
    expect(() =>
      makeMap({ file: { name: "a.kml", text: "x".repeat(MAP_LIMITS.fileChars + 1) } }),
    ).toThrow(/at most 4 MB.*map source/);
  });
});

describe("the folders of a file and the layers a map has", () => {
  const folder = (name: string, lon: number, more = "") =>
    `<Folder><name>${name}</name><Placemark><name>${name} point</name><Point><coordinates>${lon},1</coordinates></Point></Placemark>${more}</Folder>`;
  const LINE =
    "<Placemark><name>road</name><LineString><coordinates>0,0 1,1</coordinates></LineString></Placemark>";
  const folders = (count: number, more = "") =>
    `<kml><Document>${Array.from({ length: count }, (_, at) => folder(`F${at + 1}`, at, at >= 11 ? more : "")).join("")}</Document></kml>`;
  const labels = (spec: ReturnType<typeof makeMap>) =>
    (spec.layers ?? []).flatMap((layer) =>
      "points" in layer && layer.points
        ? layer.points.map((point) => point.label)
        : "shapes" in layer
          ? layer.shapes.map((shape) => shape.label)
          : [],
    );

  it("draws a file of 14 folders beside a layer of the map: the last folders are one group", () => {
    const spec = makeMap({
      file: { name: "many.kml", text: folders(14) },
      layers: [{ kind: "points", name: "Offices", points: [{ lat: 1, lon: 1 }] }],
    });
    expect(spec.layers).toHaveLength(MAP_LIMITS.layers);
    expect(spec.layers?.map((layer) => layer.group ?? layer.name)).toEqual([
      ...Array.from({ length: 10 }, (_, at) => `F${at + 1}`),
      "Other",
      "Offices",
    ]);
    expect(spec.layers?.[10]).toMatchObject({ kind: "points", name: "Other" });
    expect(labels(spec).filter(Boolean)).toHaveLength(14);
    expect(spec.points).toEqual([]);
    expect(spec.notes).toContain(
      'The file has 14 folders and the map has room for 11 more layers: 10 folders are layers, and the marks of the 4 others are together under "Other".',
    );
    expect(mapSpec(spec)).toEqual(spec);
  });

  it("splits the group of the others by what it holds, and keeps room for it", () => {
    const spec = makeMap({ file: { name: "many.kml", text: folders(14, LINE) } });
    expect(spec.layers).toHaveLength(MAP_LIMITS.layers);
    expect(
      spec.layers?.slice(-2).map(({ kind, name, group }) => ({ kind, name, group })),
    ).toEqual([
      { kind: "lines", name: "Lines", group: "Other" },
      { kind: "points", name: "Points", group: "Other" },
    ]);
    expect(labels(spec).filter(Boolean)).toHaveLength(17);
  });

  it("draws the marks of the folders on the map itself when the map has no room for a layer", () => {
    const spec = makeMap({
      file: { name: "many.kml", text: folders(3) },
      layers: Array.from({ length: MAP_LIMITS.layers }, (_, at) => ({
        kind: "points",
        points: [{ lat: 1, lon: at }],
      })),
    });
    expect(spec.layers).toHaveLength(MAP_LIMITS.layers);
    expect(spec.points.map((point) => point.label)).toEqual([
      "F1 point",
      "F2 point",
      "F3 point",
    ]);
    expect(spec.notes?.join(" ")).toMatch(
      /The file has 3 folders and the map has no room for more layers: their marks are drawn together/,
    );
  });

  it("leaves out the images a map has no room for, with a note", () => {
    const spec = makeMap({
      file: { name: "sample.kmz", data: base64("sample.kmz") },
      layers: Array.from({ length: MAP_LIMITS.layers }, (_, at) => ({
        kind: "points",
        points: [{ lat: 1, lon: at }],
      })),
    });
    expect(spec.layers?.some((layer) => layer.kind === "image")).toBe(false);
    expect(spec.notes?.join(" ")).toMatch(
      /The file has 1 image and none is drawn: the map has no room for more layers\./,
    );
  });

  it("still refuses more layers than a map has when the caller gives them", () => {
    expect(() =>
      makeMap({
        layers: Array.from({ length: MAP_LIMITS.layers + 1 }, () => ({
          kind: "points",
          points: [{ lat: 1, lon: 1 }],
        })),
      }),
    ).toThrow(/the map has 13 layers\. A map has at most 12/);
  });
});

describe("the times of a file", () => {
  const stamp = (at: number) =>
    new Date(Date.UTC(2020, 0, 1 + at)).toISOString().replace(".000", "");
  const gpx = (count: number) =>
    `<gpx version="1.1">${Array.from(
      { length: count },
      (_, at) =>
        `<wpt lat="${40 + at / 100}" lon="-74"><name>W${at}</name><time>${stamp(at)}</time></wpt>`,
    ).join("")}</gpx>`;
  const kml = (
    whens: string[],
    inside = (when: string) => `<TimeStamp><when>${when}</when></TimeStamp>`,
  ) =>
    `<kml><Document>${whens
      .map(
        (when, at) =>
          `<Placemark><name>P${at}</name>${inside(when)}<Point><coordinates>${at},1</coordinates></Point></Placemark>`,
      )
      .join("")}</Document></kml>`;
  const marks = (spec: ReturnType<typeof makeMap>) => [
    ...spec.points,
    ...(spec.layers ?? []).flatMap((layer) =>
      "points" in layer ? (layer.points ?? []) : [],
    ),
  ];

  it("reads a GPX file of 61 timed waypoints as one map: a time is a value of its mark, not a step", () => {
    const spec = makeMap({ file: { name: "walk.gpx", text: gpx(61) } });
    expect(marks(spec)).toHaveLength(61);
    expect(mapFrames(spec)).toEqual([]);
    expect(marks(spec)[0]).toMatchObject({
      label: "W0",
      props: { time: "2020-01-01T00:00:00Z" },
    });
    expect(marks(spec)[0]).not.toHaveProperty("time");
    const three = makeMap({ file: { name: "walk.gpx", text: gpx(3) } });
    expect(mapFrames(three)).toEqual([]);
    expect(marks(three)).toHaveLength(3);
  });

  it("never plays a GPX file by the times its points were recorded, also when asked", () => {
    const spec = makeMap({ file: { name: "walk.gpx", text: gpx(3), time: true } });
    expect(mapFrames(spec)).toEqual([]);
    expect(spec.notes).toContain(
      "The times of a GPX file say when its points were recorded: they are values of the marks, not steps of the map.",
    );
    const track = makeMap({
      file: { name: "a.gpx", text: fixture("sample.gpx").toString(), time: "time" },
    });
    expect(mapFrames(track)).toEqual([]);
  });

  it("does not play a KML file by its TimeStamps unless the caller asks", () => {
    const text = kml([
      "2024-05-01T09:30:00Z",
      "2024-05-02T10:00:00Z",
      "2024-05-02T18:00:00Z",
    ]);
    const plain = makeMap({ file: { name: "a.kml", text } });
    expect(mapFrames(plain)).toEqual([]);
    expect(marks(plain)[0]).toMatchObject({ props: { time: "2024-05-01T09:30:00Z" } });
    const played = makeMap({ file: { name: "a.kml", text, time: true } });
    expect(mapFrames(played)).toEqual(["2024-05-01", "2024-05-02"]);
    expect(marks(played).map((mark) => mark.time)).toEqual([
      "2024-05-01",
      "2024-05-02",
      "2024-05-02",
    ]);
    expect(mapSpec(played)).toEqual(played);
  });

  it("plays by a property the caller names: a year, a month", () => {
    const text = JSON.stringify({
      type: "FeatureCollection",
      features: [2022, 2023, 2023, "2024-03"].map((year, at) => ({
        type: "Feature",
        properties: { year, name: `F${at}` },
        geometry: { type: "Point", coordinates: [at, 1] },
      })),
    });
    const spec = makeMap({ file: { name: "a.geojson", text, time: "year" } });
    expect(marks(spec).map((mark) => mark.time)).toEqual([
      "2022",
      "2023",
      "2023",
      "2024-03",
    ]);
    const missing = makeMap({ file: { name: "a.geojson", text, time: "when" } });
    expect(mapFrames(missing)).toEqual([]);
    expect(missing.notes?.join(" ")).toMatch(
      /The file has no property "when" to play by\. Its properties: year/,
    );
  });

  const byProperty = (values: unknown[]) =>
    makeMap({
      file: {
        name: "a.geojson",
        text: JSON.stringify({
          type: "FeatureCollection",
          features: values.map((who, at) => ({
            type: "Feature",
            properties: { who, name: `F${at}` },
            geometry: { type: "Point", coordinates: [at, 1] },
          })),
        }),
        time: "who",
      },
    });

  it("does not play by a property that is no date or period, however short its values are", () => {
    const spec = byProperty(["n0", "n1", "n2", "n3", "n4", "n5", "n6"]);
    expect(mapFrames(spec)).toEqual([]);
    expect(marks(spec)).toHaveLength(7);
    expect(marks(spec)[0]).toMatchObject({ props: { who: "n0" } });
    expect(marks(spec)[0]).not.toHaveProperty("time");
    expect(spec.notes).toContain(
      'The property "who" is no time to play by: "n0" is no year, quarter, month or date written year first. The marks are on one map and keep it as a value.',
    );
    for (const value of [
      12,
      20245,
      "2024-13",
      "2024-02-30",
      "2024-Q5",
      "Q1 2024",
      "May",
    ])
      expect(mapFrames(byProperty([2024, value])), String(value)).toEqual([]);
  });

  it("plays by a year, a quarter, a month and a date, each under one sortable name", () => {
    const spec = byProperty([
      "2024-3",
      2023,
      "2024Q1",
      "2024-q2",
      "2024-03-05",
      "2024-3-5",
      "2024-03-05 14:30",
      " 2023 ",
    ]);
    expect(marks(spec).map((mark) => mark.time)).toEqual([
      "2024-03",
      "2023",
      "2024-Q1",
      "2024-Q2",
      "2024-03-05",
      "2024-03-05",
      "2024-03-05",
      "2023",
    ]);
    expect(mapFrames(spec)).toEqual([
      "2023",
      "2024-03",
      "2024-03-05",
      "2024-Q1",
      "2024-Q2",
    ]);
    expect(mapSpec(spec)).toEqual(spec);
  });

  it("keeps the times as values, with a note, when they are more steps than a map plays", () => {
    const whens = Array.from({ length: 61 }, (_, at) => stamp(at));
    const spec = makeMap({ file: { name: "a.kml", text: kml(whens), time: true } });
    expect(marks(spec)).toHaveLength(61);
    expect(mapFrames(spec)).toEqual([]);
    expect(spec.notes).toContain(
      'The property "time" has 61 dates or periods and a map plays at most 60: the marks are drawn on one map and keep it as a value. Aggregate the file to fewer periods.',
    );
    const sixty = makeMap({
      file: { name: "a.kml", text: kml(whens.slice(0, 60)), time: true },
    });
    expect(mapFrames(sixty)).toHaveLength(60);
  });

  it("keeps the times as values, with a note, when one is a span or no date: no step has a cut name", () => {
    const span = (when: string) =>
      `<TimeSpan><begin>${when}</begin><end>2025-01-01T00:00:00Z</end></TimeSpan>`;
    const spec = makeMap({
      file: {
        name: "a.kml",
        text: kml(["2020-01-01T00:00:00Z", "2021-01-01T00:00:00Z"], span),
        time: true,
      },
    });
    expect(mapFrames(spec)).toEqual([]);
    expect(marks(spec)[0]).toMatchObject({
      props: { time: "2020-01-01T00:00:00Z/2025-01-01T00:00:00Z" },
    });
    expect(spec.notes).toContain(
      'The property "time" is no time to play by: "2020-01-01T00:00:00Z/2025-01-01T" is no year, quarter, month or date written year first. The marks are on one map and keep it as a value.',
    );
    const long = JSON.stringify({
      type: "Feature",
      properties: { when: "the first quarter of the fiscal year 2024" },
      geometry: { type: "Point", coordinates: [1, 1] },
    });
    expect(
      mapFrames(makeMap({ file: { name: "a.geojson", text: long, time: "when" } })),
    ).toEqual([]);
  });
});

describe("a layer of the kind image", () => {
  const layer = (image: unknown) => ({
    layers: [{ kind: "image", name: "Scan", image }],
  });

  it("keeps the bytes and the corners, and is idempotent", () => {
    const spec = mapSpec(
      layer({ mime: "image/png", data: PNG, corners: CORNERS, url: "x" }),
    );
    expect(spec.layers?.[0]).toEqual({
      id: "image-1",
      name: "Scan",
      kind: "image",
      image: { mime: "image/png", data: PNG, corners: CORNERS },
    });
    expect(mapSpec(spec)).toEqual(spec);
  });

  it.each([
    [{ mime: "image/svg+xml", data: PNG, corners: CORNERS }],
    [{ mime: "image/png", data: "PHN2Zz48L3N2Zz4=", corners: CORNERS }],
    [{ mime: "image/jpeg", data: PNG, corners: CORNERS }],
    [{ mime: "image/png", data: `${PNG}!`, corners: CORNERS }],
    [{ mime: "image/png", data: "https://attacker.example/a.png", corners: CORNERS }],
    [{ mime: "image/png", url: "https://attacker.example/a.png", corners: CORNERS }],
    [{ mime: "image/png", data: PNG, corners: CORNERS.slice(1) }],
    [{ mime: "image/png", data: PNG, corners: [[999, 0], ...CORNERS.slice(1)] }],
    [{ mime: "toString", data: PNG, corners: CORNERS }],
    ["https://attacker.example/a.png"],
  ])("refuses %j", (image) => {
    expect(() => mapSpec(layer(image))).toThrow(
      /A map never takes the address of an image/,
    );
  });

  it("refuses an image whose header declares more pixels than a map holds, however few bytes it has", () => {
    const huge = base64Of(png(60_000, 60_000, 0).subarray(0, 66));
    expect(huge).toHaveLength(88);
    expect(() =>
      mapSpec(layer({ mime: "image/png", data: huge, corners: CORNERS })),
    ).toThrow(
      "output.map: layer 1 holds an image of 60,000 by 60,000 pixels. An image of a map has at most 8,192 pixels on a side and 16,777,216 pixels: export it smaller.",
    );
    const sides: [number, number][] = [
      [8193, 1],
      [1, 8193],
      [8192, 2049],
    ];
    for (const [width, height] of sides)
      expect(() =>
        mapSpec(
          layer({
            mime: "image/png",
            data: base64Of(png(width, height, 0)),
            corners: CORNERS,
          }),
        ),
      ).toThrow(/has at most 8,192 pixels on a side and 16,777,216 pixels/);
    const largest = layer({
      mime: "image/png",
      data: base64Of(png(8192, 2048, 0)),
      corners: CORNERS,
    });
    expect(mapSpec(largest).layers).toHaveLength(1);
    for (const [mime, bytes] of [
      ["image/jpeg", jpegHeader(60_000, 60_000)],
      ["image/webp", webpHeader(16_000, 16_000)],
    ] as const)
      expect(() =>
        mapSpec(layer({ mime, data: base64Of(bytes), corners: CORNERS })),
      ).toThrow(/pixels on a side/);
  });

  it("reads what an image is from its bytes: a start that only looks like one is refused", () => {
    const riff = (kind: string) =>
      Uint8Array.from(
        `RIFF\u0024\u0000\u0000\u0000${kind}fmt ${"\u0000".repeat(40)}`,
        (char) => char.charCodeAt(0),
      );
    const cases: [string, Uint8Array][] = [
      ["image/webp", riff("WAVE")],
      [
        "image/png",
        Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4),
      ],
      ["image/jpeg", Uint8Array.of(0xff, 0xd8, 0xff, 0xd9, 0, 0)],
      ["image/webp", png(2, 2)],
      ["image/png", jpegHeader(2, 2)],
    ];
    for (const [mime, bytes] of cases)
      expect(
        () => mapSpec(layer({ mime, data: base64Of(bytes), corners: CORNERS })),
        mime,
      ).toThrow(/A map never takes the address of an image/);
    for (const [mime, bytes] of [
      ["image/jpeg", jpegHeader(640, 480)],
      ["image/webp", webpHeader(640, 480)],
      ["image/png", png(2, 2)],
    ] as const)
      expect(
        mapSpec(layer({ mime, data: base64Of(bytes), corners: CORNERS })).layers,
      ).toHaveLength(1);
  });

  it("bounds the size and the number of images", () => {
    const image = { mime: "image/png", data: PNG, corners: CORNERS };
    const big = `${PNG.slice(0, 12)}${"A".repeat(MAP_LIMITS.imageChars)}`;
    expect(() => mapSpec(layer({ ...image, data: big }))).toThrow(
      /has at most 1367 KB/,
    );
    expect(() =>
      mapSpec({
        layers: Array.from({ length: MAP_LIMITS.images + 1 }, () => ({
          kind: "image",
          image,
        })),
      }),
    ).toThrow(/more than 4 images/);
  });

  it("bounds the pixels all the images of a map declare together: a few hundred bytes each can ask for 256 MB", () => {
    const small = png(4096, 4096, 1);
    expect(small.length).toBeLessThan(600);
    const image = { mime: "image/png", data: base64Of(small), corners: CORNERS };
    const pictures = (count: number) => ({
      layers: Array.from({ length: count }, () => ({ kind: "image", image })),
    });
    expect(mapSpec(pictures(2)).layers).toHaveLength(2);
    expect(MAP_LIMITS.imagePixels).toBe(2 * 4096 * 4096);
    for (const read of [mapSpec, makeMap])
      expect(() => read(pictures(3))).toThrow(
        "output.map: the images of the map declare 50,331,648 pixels together. The images of a map have at most 33,554,432 pixels together (two of 4,096 by 4,096): export them smaller, or use fewer.",
      );
    const overlay = (name: string) =>
      `<GroundOverlay><name>${name}</name><Icon><href>${name}.png</href></Icon><LatLonBox><north>1</north><south>0</south><east>1</east><west>0</west></LatLonBox></GroundOverlay>`;
    const kmz = zip({
      "doc.kml": `<kml><Document>${overlay("a")}${overlay("b")}${overlay("c")}</Document></kml>`,
      "a.png": small,
      "b.png": small,
      "c.png": small,
    });
    const spec = makeMap({ file: { name: "three.kmz", data: base64Of(kmz) } });
    expect(spec.layers?.map((layer) => layer.name)).toEqual(["a", "b"]);
    expect(spec.notes).toContain(
      'The image "c" is not drawn: with it the images of the map would declare more than the 33,554,432 pixels a map decodes.',
    );
    expect(mapSpec(spec)).toEqual(spec);
  });
});

describe("regions of a set that is matched when the map is drawn", () => {
  it("keeps the codes as text, with the country or state they are in", () => {
    const spec = mapSpec({
      regions: {
        set: "admin1",
        within: { country: "Canada", url: "https://attacker.example" },
        items: [
          { code: " Ontario ", value: 1 },
          { code: "Ontario", value: 2 },
          { code: null },
        ],
      },
    });
    expect(spec.regions).toEqual({
      set: "admin1",
      within: { country: "Canada" },
      items: [{ code: "Ontario", value: 1 }],
      unmatched: ["object"],
      unmatchedCount: 1,
    });
    expect(mapSpec(spec)).toEqual(spec);
    expect(mapRows(spec)[0].place).toBe("Ontario");
  });

  it("takes metro areas and districts, and no other set", () => {
    for (const set of ["us-cbsa", "us-cd119"])
      expect(
        mapSpec({ regions: { set, items: [{ code: "35620" }] } }).regions?.set,
      ).toBe(set);
    expect(() =>
      mapSpec({ regions: { set: "https://attacker.example", items: [{ code: "1" }] } }),
    ).toThrow(
      /The app ships these boundary sets: us-states, us-counties, countries, admin1, us-cbsa, us-cd119/,
    );
  });

  it("does not keep `within` for a set the reducer matches", () => {
    const spec = mapSpec({
      regions: { set: "us-states", within: { country: "US" }, items: [{ code: "CA" }] },
    });
    expect(spec.regions).toEqual({ set: "us-states", items: [{ code: "06" }] });
  });
});

describe("a map file where no reader is loaded", () => {
  it("is refused by the reducer with the reason", async () => {
    const marks = await import("~/lib/geo/mapFileReader");
    const { fileInput } = await import("~/lib/geo/mapFile");
    marks.provideFileReader(null as never);
    try {
      expect(() => makeMap({ file: { name: "a.kml", text: "<kml/>" } })).toThrow(
        /a map file is read where a map is made: in the code of a run and in a Map widget/,
      );
    } finally {
      marks.provideFileReader(fileInput);
    }
  });
});
