import "~/lib/geo/mapFile";
import { describe, expect, it } from "vitest";
import { mapColumns, mapFromData, mapFromRows, widgetMap } from "~/lib/geo/mapData";
import { makeMap, mapSpec } from "~/lib/geo/mapSpec";

const ADDRESS = "https://tiles.evil.example/{z}/{x}/{y}.png";
const mapping = {
  lat: "lat",
  lon: "lon",
  value: "yield",
  label: "name",
  props: ["url", "endpoint"],
  title: "Yield",
  sources: [
    { id: "ndvi", kind: "raster-tiles", url: ADDRESS, attribution: "x" },
    { id: "local", kind: "raster-tiles", endpoint: "t/{z}/{x}/{y}", attribution: "x" },
  ],
  source: ADDRESS,
  url: ADDRESS,
  endpoint: ADDRESS,
  basemap: { source: ADDRESS, url: ADDRESS },
  layers: [{ id: "x", kind: "source", source: ADDRESS, url: ADDRESS }],
};
const rows = [
  { lat: 41, lon: -93, yield: 180, name: "Polk" },
  { lat: 42, lon: -94, yield: 175, name: "Story" },
];

describe("the mapping of a Map widget and its sources", () => {
  it("keeps the columns of a mapping and nothing of its sources", () => {
    const columns = mapColumns(mapping);
    expect(columns).toEqual({
      lat: "lat",
      lon: "lon",
      value: "yield",
      label: "name",
      props: ["url", "endpoint"],
      title: "Yield",
    });
    expect(JSON.stringify(columns)).not.toContain("evil");
  });

  it("draws rows without an address or an id of a source", () => {
    for (const shape of [
      mapping,
      { ...mapping, lat: undefined, lon: undefined, state: "name" },
      { ...mapping, lat: undefined, lon: undefined, county: "name" },
      { ...mapping, lat: undefined, lon: undefined, country: "name", as: "points" },
    ]) {
      const columns = mapColumns(shape);
      expect(columns).not.toBeNull();
      const drawn = [
        mapFromData(rows, shape),
        mapFromRows(rows, columns as NonNullable<typeof columns>),
      ];
      for (const spec of drawn) {
        const text = JSON.stringify(spec);
        expect(text).not.toContain("evil");
        expect(text).not.toContain("{z}");
        expect(text).not.toContain("ndvi");
        expect(spec).not.toHaveProperty("sources");
        expect(spec).not.toHaveProperty("layers");
        expect(spec).not.toHaveProperty("basemap");
      }
    }
  });
});

describe("the Map widget: files, more region sets, time and declared sources", () => {
  it("reads a file an endpoint returns through the file reader, coloured by `value`", () => {
    expect(mapFromData({ kmz: "AAAA" }, { value: "acres", title: "Fields" })).toEqual({
      title: "Fields",
      file: { name: ".kmz", data: "AAAA", value: "acres" },
    });
    expect(mapFromData({ shapefile: "AAAA" }, undefined)).toEqual({
      file: { name: ".zip", data: "AAAA" },
    });
    expect(mapFromData({ gpx: "<gpx/>" }, null)).toEqual({
      file: { name: ".gpx", text: "<gpx/>" },
    });
  });

  it("shades provinces, metro areas and districts, and plays over a time column", () => {
    const columns = mapColumns({
      province: "p",
      within: "Canada",
      value: "v",
      time: "y",
    });
    const map = mapFromRows([{ p: "Ontario", v: 1, y: 2024 }], columns ?? {});
    expect(mapSpec(map).regions).toEqual({
      set: "admin1",
      within: { country: "Canada" },
      items: [{ code: "Ontario", value: 1, time: "2024" }],
    });
    expect(
      mapFromRows([{ m: "35620" }], mapColumns({ metro: "m" }) ?? {}),
    ).toMatchObject({
      regions: { set: "us-cbsa" },
    });
    expect(mapColumns({ district: "d" })).toEqual({ district: "d" });
  });

  it("adds the declared sources as layers by id, off, once", () => {
    const map = makeMap(
      { points: [{ lat: 1, lon: 2 }] },
      { sources: ["ndvi", "soil"] },
    );
    expect(map.layers).toEqual([
      { id: "ndvi", visible: false, kind: "source", source: "ndvi" },
      { id: "soil", visible: false, kind: "source", source: "soil" },
    ]);
    expect(makeMap(map, { sources: ["ndvi"] })).toEqual(map);
    expect(makeMap({ points: [{ lat: 1, lon: 2 }] }, { sources: [] })).toEqual({
      points: [{ lat: 1, lon: 2 }],
      shapes: [],
    });
  });
});

describe("widgetMap: the map of a Map widget is made once, from what its endpoint returned", () => {
  const KML =
    "<kml><Document><Placemark><name>North</name><Point><coordinates>-93.7,42</coordinates></Point></Placemark></Document></kml>";

  it("makes a reduced map of rows, with the declared sources as layers that are off", () => {
    const made = widgetMap(
      [{ lat: 41.6, lon: -93.6, name: "Elevator", yield: 180 }],
      mapping,
      ["ndvi"],
    );
    expect(made?.spec).toEqual({
      title: "Yield",
      points: [{ lat: 41.6, lon: -93.6, label: "Elevator", value: 180 }],
      shapes: [],
      layers: [{ id: "ndvi", kind: "source", source: "ndvi", visible: false }],
    });
  });

  it("reads the file of an endpoint into marks: the map it gives holds no file", () => {
    const made = widgetMap({ kml: KML }, {}, []);
    expect(made?.spec?.points).toMatchObject([{ lat: 42, lon: -93.7, label: "North" }]);
    expect(Object.keys(made?.spec ?? {})).not.toContain("file");
    expect(mapSpec(made?.spec)).toEqual(made?.spec);
  });

  it("lists the lists of places its map needed, for the widget to load and make it again", () => {
    const byCity = widgetMap({ points: [{ city: "Chicago" }] }, undefined, []);
    expect(byCity?.needs).toEqual(["cities"]);
    expect(byCity?.error).toMatch(
      /^The map cannot be drawn: the list of cities could not be loaded/,
    );
    expect(byCity?.error).not.toMatch(/output\.map|code/);
    const viewed = widgetMap(
      { points: [{ lat: 41.88, lon: -87.63 }], view: { place: "Chicago" } },
      undefined,
      [],
    );
    expect(viewed?.needs).toEqual(["admin1", "cities"]);
    expect(viewed?.spec?.notes?.[0]).toMatch(/^"Chicago" was not looked up/);
    expect(
      widgetMap([{ lat: 1, lon: 2 }], { lat: "lat", lon: "lon" }, [])?.needs,
    ).toEqual([]);
  });

  it("says why a map cannot be drawn, and gives null for data that is no map", () => {
    expect(widgetMap({ kml: "<kml><Document/></kml>" }, {}, [])?.error).toMatch(
      /^The map cannot be drawn: the file cannot be read/,
    );
    expect(
      widgetMap([{ lat: 95, lon: 0 }], { lat: "lat", lon: "lon" }, [])?.error,
    ).toMatch(/lat 95/);
    expect(
      widgetMap([{ lat: 95, lon: 0 }], { lat: "lat", lon: "lon" }, [])?.error,
    ).not.toMatch(/output\.map/);
    expect(widgetMap({ rows: 3 }, {}, [])).toBeNull();
    expect(widgetMap([{ a: 1 }], {}, [])).toBeNull();
  });
});

describe("widgetMap: the sources a widget declares and the layers a map has", () => {
  const ids = Array.from({ length: 13 }, (_, at) => `s${at + 1}`);
  const rows = [{ lat: 41.6, lon: -93.6 }];
  const columns = { lat: "lat", lon: "lon" };

  it("lists the sources there is room for, and says which are not listed", () => {
    const made = widgetMap(rows, columns, ids);
    expect(made?.error).toBeUndefined();
    expect(made?.spec?.layers?.map((layer) => layer.id)).toEqual(ids.slice(0, 12));
    expect(made?.spec?.notes).toEqual([
      "The widget declares 13 map sources and the map has room for 12 more layers: 1 is not listed (s13).",
    ]);
  });

  it("gives the layers of the data their place first: the folders of a file, then the sources", () => {
    const folder = (at: number) =>
      `<Folder><name>F${at}</name><Placemark><Point><coordinates>${at},1</coordinates></Point></Placemark></Folder>`;
    const kml = `<kml><Document>${Array.from({ length: 10 }, (_, at) => folder(at)).join("")}</Document></kml>`;
    const made = widgetMap({ kml }, {}, ids.slice(0, 5));
    expect(made?.spec?.layers).toHaveLength(12);
    expect(made?.spec?.layers?.slice(-2).map((layer) => layer.id)).toEqual([
      "s1",
      "s2",
    ]);
    expect(made?.spec?.notes?.join(" ")).toMatch(
      /The widget declares 5 map sources and the map has room for 2 more layers: 3 are not listed \(s3, s4, s5\)\./,
    );
  });
});

describe("mapFromData", () => {
  it("shades regions by a column of codes, or places points at their centres", () => {
    const rows = [
      { st: "CA", rate: "5.5" },
      { st: "TX", rate: 4.1 },
      { st: "", rate: 1 },
    ];
    expect(mapSpec(mapFromData(rows, { state: "st", value: "rate" })).regions).toEqual({
      set: "us-states",
      items: [
        { code: "06", value: 5.5 },
        { code: "48", value: 4.1 },
      ],
    });
    expect(
      mapSpec(mapFromData(rows, { state: "st", tag: "rate", as: "points" })).points.map(
        (point) => point.tag,
      ),
    ).toEqual(["5.5", "4.1"]);
    expect(mapFromRows([{ f: "06037" }], { county: "f" }).regions).toMatchObject({
      set: "us-counties",
    });
  });

  it("reads a mapping as data: names of columns and nothing else", () => {
    expect(mapColumns(null)).toBeNull();
    expect(mapColumns({ label: "name" })).toBeNull();
    expect(mapColumns({ lat: 1, lon: {} })).toBeNull();
    expect(
      mapColumns({ lat: "a", lon: "b", props: ["x", 2, "y"], as: "tiles" }),
    ).toEqual({
      lat: "a",
      lon: "b",
      props: ["x", "y"],
    });
  });

  it("is null for what is no rows, GeoJSON, KML or map", () => {
    for (const data of [null, "text", 7, {}, { rows: [] }, [{ lat: 1, lon: 2 }]])
      expect(mapFromData(data, undefined)).toBeNull();
  });

  it("takes a file as `output.map` takes it, read by the reader of every map file", () => {
    const kml =
      "<kml><Document><Placemark><name>North field</name><Point><coordinates>-93.6,42.0</coordinates></Point></Placemark></Document></kml>";
    const described = mapFromData({ file: { name: ".kml", text: kml } }, undefined);
    expect(described).toEqual({ file: { name: ".kml", text: kml } });
    const made = widgetMap({ file: { name: ".kml", text: kml } }, undefined, []);
    expect(JSON.stringify(made?.spec)).toContain('"label":"North field"');
    expect(made?.spec).toEqual(widgetMap({ kml }, undefined, [])?.spec);
  });
});

describe("the Map widget: `data.map.category` colours the marks by a column of text", () => {
  const rows = [
    { lat: 41, lon: -93, name: "A", operator: "Acme" },
    { lat: 42, lon: -94, name: "B", operator: "Borealis" },
    { lat: 43, lon: -95, name: "C", operator: "" },
  ];

  it("leaves out rows at latitude 0 and longitude 0, says how many, and keeps them when the mapping says so", () => {
    const rows = [
      { name: "HQ", lat: 41.88, lon: -87.63 },
      { name: "Unknown", lat: 0, lon: 0 },
      { name: "Unknown too", lat: "0", lon: 0 },
      { name: "On the equator", lat: 0, lon: 9.45 },
      { name: "Near", lat: 0.001, lon: 0 },
    ];
    const made = mapFromRows(rows, { lat: "lat", lon: "lon", label: "name" });
    expect((made.points as { label: string }[]).map((point) => point.label)).toEqual([
      "HQ",
      "On the equator",
      "Near",
    ]);
    expect(made.notes).toEqual([
      "2 rows have latitude 0 and longitude 0 (no position) and are not drawn.",
    ]);
    const byCity = mapFromRows([{ name: "Unknown", lat: 0, lon: 0, town: "Dallas" }], {
      lat: "lat",
      lon: "lon",
      city: "town",
      label: "name",
    });
    expect(byCity.points).toMatchObject([{ city: "Dallas", label: "Unknown" }]);
    expect(byCity.notes).toBeUndefined();
    const kept = mapColumns({ lat: "lat", lon: "lon", keepZero: true });
    expect(kept).toEqual({ lat: "lat", lon: "lon", keepZero: true });
    expect(mapColumns({ lat: "lat", lon: "lon", keepZero: "true" })).toEqual({
      lat: "lat",
      lon: "lon",
    });
    const all = mapFromRows(rows, { lat: "lat", lon: "lon", keepZero: true });
    expect(all.points).toHaveLength(5);
    expect(all.notes).toBeUndefined();
    expect(mapSpec(mapFromData(rows, { lat: "lat", lon: "lon" })).notes).toEqual([
      "2 rows have latitude 0 and longitude 0 (no position) and are not drawn.",
    ]);
  });

  it("gives each row of points its category, under the name of the column", () => {
    const made = widgetMap(rows, { lat: "lat", lon: "lon", category: "operator" }, []);
    expect(made?.spec?.points.map((point) => point.category)).toEqual([
      "Acme",
      "Borealis",
      undefined,
    ]);
    expect(made?.spec?.categoryLabel).toBe("operator");
  });

  it("gives the regions of rows their category too", () => {
    const made = widgetMap(
      [
        { st: "CA", party: "D" },
        { st: "TX", party: "R" },
      ],
      { state: "st", category: "party" },
      [],
    );
    expect(made?.spec?.regions?.items.map((item) => item.category)).toEqual(["D", "R"]);
    expect(made?.spec?.categoryLabel).toBe("party");
  });

  it("reads the property a mapping names off the features of GeoJSON, and keeps it as a value of the card", () => {
    const feature = (crop: unknown, lon: number) => ({
      type: "Feature",
      properties: { name: `Field ${lon}`, crop },
      geometry: { type: "Point", coordinates: [lon, 41] },
    });
    const made = widgetMap(
      {
        type: "FeatureCollection",
        features: [feature("corn", -93), feature("soy", -94), feature(null, -95)],
      },
      { category: "crop" },
      [],
    );
    expect(made?.spec?.points.map((point) => point.category)).toEqual([
      "corn",
      "soy",
      undefined,
    ]);
    expect(made?.spec?.points[0].props).toEqual({ crop: "corn" });
    expect(made?.spec?.categoryLabel).toBe("crop");
  });

  it("leaves GeoJSON as it was without the key: a property called category is a value of the card", () => {
    const made = widgetMap(
      {
        type: "Feature",
        properties: { category: "corn" },
        geometry: { type: "Point", coordinates: [-93, 41] },
      },
      {},
      [],
    );
    expect(made?.spec?.points[0].category).toBeUndefined();
    expect(made?.spec?.points[0].props).toEqual({ category: "corn" });
    expect(made?.spec?.categoryLabel).toBeUndefined();
  });

  it("hands the property to the reader of a file, which colours its marks by it", () => {
    const place = (crop: string, lon: number) =>
      `<Placemark><name>F${lon}</name><ExtendedData><Data name="crop"><value>${crop}</value></Data></ExtendedData><Point><coordinates>${lon},41</coordinates></Point></Placemark>`;
    const kml = `<kml><Document>${place("corn", -93)}${place("soy", -94)}</Document></kml>`;
    expect(mapFromData({ kml }, { category: "crop" })).toEqual({
      file: { name: ".kml", text: kml, category: "crop" },
    });
    const made = widgetMap({ kml }, { category: "crop" }, []);
    expect(made?.spec?.points.map((point) => point.category)).toEqual(["corn", "soy"]);
    expect(made?.spec?.categoryLabel).toBe("crop");
  });

  it("takes a name of a column only: no category for a mapping that names an object", () => {
    expect(
      mapColumns({ lat: "lat", lon: "lon", category: { a: 1 } })?.category,
    ).toBeUndefined();
  });
});

describe("the Map widget: `data.map.valueLabel` names the scale of every layer of a file", () => {
  const place = (acres: number, lon: number) =>
    `<Placemark><name>F${lon}</name><ExtendedData><Data name="acres"><value>${acres}</value></Data></ExtendedData><Point><coordinates>${lon},41</coordinates></Point></Placemark>`;
  const kml = `<kml><Document><Folder><name>North</name>${place(10, -93)}${place(30, -94)}</Folder></Document></kml>`;

  it("labels the layer of a one-folder file, so its legend says what the scale is", () => {
    const made = widgetMap({ kml }, { value: "acres", valueLabel: "Area (acres)" }, []);
    expect(made?.spec?.layers).toHaveLength(1);
    expect(made?.spec?.layers?.[0]).toMatchObject({
      kind: "points",
      valueLabel: "Area (acres)",
    });
  });

  it("labels nothing when the file is coloured by no value", () => {
    const made = widgetMap({ kml }, { valueLabel: "Area (acres)" }, []);
    expect(made?.spec?.layers?.[0].valueLabel).toBeUndefined();
  });

  it("keeps a label the file was given itself over that of the map", () => {
    const made = makeMap({
      valueLabel: "Of the map",
      file: { name: ".kml", text: kml, value: "acres", valueLabel: "Of the file" },
    });
    expect(made.layers?.[0].valueLabel).toBe("Of the file");
  });
});
