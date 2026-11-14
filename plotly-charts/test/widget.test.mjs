import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.document = { querySelector: () => null };
const { default: widget, baseStyle, featuresOf, followsTheme, geoSubplots, hasLatex, outlinesOf, splitAtAntimeridian, unwrapPolygons, themedMenus, themedSubplots, mapSubplots, themedFigure, topojsonNames, withMapStyle } = await import("../src/entry.js");

function start(data) {
  const model = { get: (name) => structuredClone({ data }[name]), on() {} };
  return widget.initialize({ model });
}

function typed(Type, dtype, values, shape) {
  const bdata = Buffer.from(new Type(values).buffer).toString("base64");
  return shape ? { dtype, bdata, shape } : { dtype, bdata };
}

const SALES = {
  data: [
    { type: "bar", name: "emea", x: ["Jan", "Feb"], y: [100, 114] },
    { type: "bar", name: "apac", x: ["Jan", "Feb"], y: [105, 104] },
  ],
  layout: { title: { text: "Sales" }, xaxis: { title: { text: "month" } }, template: { layout: { paper_bgcolor: "white" } } },
};

test("a figure its author did not theme follows the workspace's mode, and keeps what the author set", () => {
  const plain = { data: [{ type: "bar", x: ["a"], y: [1] }], layout: { title: "t", yaxis: { gridcolor: "red" } } };
  assert.equal(followsTheme(plain), true);
  const dark = themedFigure(plain, "dark");
  assert.equal(dark.layout.paper_bgcolor, "rgb(17,17,17)");
  assert.equal(dark.layout.font.color, "#f2f5fa");
  assert.equal(dark.layout.yaxis.gridcolor, "red");
  assert.equal(dark.layout.title, "t");
  assert.equal(themedFigure(plain, "light").layout.paper_bgcolor, "white");
  assert.equal(plain.layout.paper_bgcolor, undefined);
});

test("a figure with its own template or background is drawn as its author made it", () => {
  for (const layout of [{ template: {} }, { paper_bgcolor: "black" }, { plot_bgcolor: "black" }]) {
    const figure = { data: [], layout };
    assert.equal(followsTheme(figure), false);
    assert.equal(themedFigure(figure, "dark"), figure);
  }
});

test("traces sharing x values export one row per x", async () => {
  const sales = start(SALES);
  assert.equal(await sales.exportData("csv"), "month,emea,apac\nJan,100,105\nFeb,114,104");
});

test("the figure is exported as the backend returned it", async () => {
  const sales = start(SALES);
  assert.deepEqual(JSON.parse(await sales.exportData("figure")), SALES);
});

test("the agent gets the title and each trace's size and range", async () => {
  assert.deepEqual(await start(SALES).copilotContext(), {
    title: "Sales",
    traces: [
      { name: "emea", type: "bar", points: 2, min: 100, max: 114 },
      { name: "apac", type: "bar", points: 2, min: 104, max: 105 },
    ],
  });
});

test("typed arrays are read as plotly.py writes them", async () => {
  const signal = start({
    data: [
      { type: "scatter", name: 'a, "quoted"', x: typed(Float64Array, "f8", [0, 0.5]), y: typed(Int32Array, "i4", [1, -2]) },
      { type: "scatter", name: "b", x: [0.25], y: [3] },
    ],
    layout: { xaxis: { title: "t" }, yaxis: { title: { text: "value" } } },
  });
  assert.equal(await signal.exportData("csv"), 'trace,t,value\n"a, ""quoted""",0,1\n"a, ""quoted""",0.5,-2\nb,0.25,3');
  assert.deepEqual((await signal.copilotContext()).traces[0], { name: 'a, "quoted"', type: "scatter", points: 2, min: -2, max: 1 });
});

test("a pie exports its labels and values; y without x is indexed", async () => {
  assert.equal(
    await start({ data: [{ type: "pie", name: "share", labels: ["a", "b"], values: [3, 1] }] }).exportData("csv"),
    "x,share\na,3\nb,1",
  );
  assert.equal(await start({ data: [{ name: "n", y: [5, 6] }] }).exportData("csv"), "x,n\n0,5\n1,6");
});

test("a heatmap has no CSV; its range comes from z", async () => {
  const heatmap = start({
    data: [{ type: "heatmap", x: ["a", "b"], y: ["a", "b"], z: typed(Float64Array, "f8", [1, -0.5, -0.5, 1], "2, 2") }],
    layout: { title: "Correlation" },
  });
  assert.deepEqual((await heatmap.exportOptions()).map((o) => o.id), ["figure"]);
  assert.equal(await heatmap.exportData("csv"), null);
  assert.deepEqual(await heatmap.copilotContext(), {
    title: "Correlation",
    traces: [{ name: null, type: "heatmap", points: 4, min: -0.5, max: 1 }],
  });
});

test("the images are offered only once the chart is drawn", async () => {
  const sales = start(SALES);
  assert.deepEqual((await sales.exportOptions()).map((o) => o.id), ["csv", "figure"]);
  assert.equal(await sales.exportData("svg"), null);
  assert.equal(await sales.exportData("png"), null);
  assert.equal(await sales.exportData("anything else"), null);
});

test("a drawn chart exports a PNG as bytes and an SVG as text", async () => {
  const graph = { clientWidth: 400, clientHeight: 300 };
  const calls = [];
  globalThis.document.querySelector = () => graph;
  globalThis.window = {
    Plotly: {
      async toImage(target, options) {
        calls.push(options);
        return options.format === "png" ? `data:image/png;base64,${Buffer.from([137, 80, 78, 71]).toString("base64")}` : "data:image/svg+xml,%3Csvg%2F%3E";
      },
    },
  };
  try {
    const sales = start(SALES);
    assert.deepEqual((await sales.exportOptions()).map((o) => o.id), ["csv", "figure", "png", "svg"]);
    assert.deepEqual([...(await sales.exportData("png"))], [137, 80, 78, 71]);
    assert.equal(await sales.exportData("svg"), "<svg/>");
    assert.deepEqual(calls.map((o) => [o.format, o.width, o.height]), [["png", 400, 300], ["svg", 400, 300]]);
  } finally {
    globalThis.document.querySelector = () => null;
    delete globalThis.window;
  }
});

test("the agent also gets the saved zoom and the hidden series", async () => {
  const model = { get: (name) => structuredClone({ data: SALES, state: { axes: { xaxis: [0, 1] }, visible: { 1: false } } }[name]), on() {} };
  const context = await widget.initialize({ model }).copilotContext();
  assert.deepEqual(context.zoom, { xaxis: [0, 1] });
  assert.deepEqual(context.hidden, ["apac"]);
});

test("a response that is neither a figure nor rows: nothing to export, nothing for the agent", async () => {
  for (const data of [[], [1, 2], "{\"data\": []}", { layout: {} }, null]) {
    const other = start(data);
    assert.deepEqual(await other.exportOptions(), []);
    assert.equal(await other.exportData("figure"), null);
    assert.equal(await other.copilotContext(), null);
  }
});

test("candlesticks export their open, high, low and close, and range from low to high", async () => {
  const stock = start({
    data: [
      {
        type: "candlestick",
        name: "ACME",
        x: ["2026-01-01", "2026-01-02"],
        open: typed(Float64Array, "f8", [100, 101.5]),
        high: typed(Float64Array, "f8", [103.86, 102]),
        low: typed(Float64Array, "f8", [99, 89.66]),
        close: typed(Float64Array, "f8", [101.5, 96.76]),
      },
    ],
    layout: { xaxis: { title: { text: "date" } } },
  });
  assert.deepEqual((await stock.exportOptions()).map((o) => o.id), ["csv", "figure"]);
  assert.equal(
    await stock.exportData("csv"),
    "date,open,high,low,close\n2026-01-01,100,103.86,99,101.5\n2026-01-02,101.5,102,89.66,96.76",
  );
  assert.deepEqual((await stock.copilotContext()).traces, [
    { name: "ACME", type: "candlestick", points: 2, min: 89.66, max: 103.86 },
  ]);
});

test("a candlestick with volume bars on the same dates shares their rows", async () => {
  const csv = await start({
    data: [
      { type: "candlestick", name: "ACME", x: ["d1"], open: [1], high: [3], low: [0.5], close: [2] },
      { type: "bar", name: "volume", x: ["d1"], y: [900] },
    ],
  }).exportData("csv");
  assert.equal(csv, "x,ACME open,ACME high,ACME low,ACME close,volume\nd1,1,3,0.5,2,900");
});

test("rows, as a widget with raw shows them, export as CSV and JSON", async () => {
  const rows = [
    { month: "Jan", a: 43, note: 'big, "really"' },
    { month: "Feb", a: 22, extra: { k: 1 } },
  ];
  const view = start(rows);
  assert.deepEqual((await view.exportOptions()).map((o) => o.id), ["csv", "rows"]);
  assert.equal(
    await view.exportData("csv"),
    'month,a,note,extra\nJan,43,"big, ""really""",\nFeb,22,,"{""k"":1}"',
  );
  assert.deepEqual(JSON.parse(await view.exportData("rows")), rows);
  assert.equal(await view.copilotContext(), null);
});

test("geo traces name the outlines plotly.js would fetch", () => {
  const geo = (layout, traces = [{ type: "scattergeo" }]) => topojsonNames({ data: traces, layout });
  assert.deepEqual(geo({}), ["world_110m"]);
  assert.deepEqual(geo({ geo: { scope: "usa" } }, [{ type: "choropleth" }]), ["usa_110m"]);
  assert.deepEqual(geo({ geo2: { scope: "north america", resolution: 50 } }, [{ type: "scattergeo", geo: "geo2" }]), [
    "north-america_50m",
  ]);
  assert.deepEqual(geo({}, [{ type: "scatter" }]), []);
});

test("LaTeX is found in the figure's text, not in its data", () => {
  assert.equal(hasLatex({ title: { text: "$E = mc^2$" } }), true);
  assert.equal(hasLatex({ annotations: [{ text: "x is $\\alpha$" }] }), true);
  assert.equal(hasLatex({ title: { text: "Sales in $" } }), false);
  assert.equal(hasLatex({ type: "bar", x: Array.from({ length: 2000 }, () => "$1 to $2") }), false);
  assert.equal(hasLatex({ y: { dtype: "f8", bdata: "$x$" } }), false);
});

const TOPOLOGY = {
  type: "Topology",
  transform: { scale: [0.5, 0.5], translate: [10, 20] },
  arcs: [
    [[0, 0], [2, 0], [0, 2]],
    [[2, 2], [-2, 0], [0, -2]],
    [[2, 0], [2, 0], [0, 2], [-2, 0]],
  ],
  objects: {
    land: {
      type: "GeometryCollection",
      geometries: [
        { type: "Polygon", arcs: [[0, 1]] },
        { type: "MultiPolygon", arcs: [[[2, ~0]]] },
        { type: "MultiPolygon", arcs: [[], [[0, 1]]] },
        { type: "MultiPolygon", arcs: [[]] },
      ],
    },
    coast: { type: "LineString", arcs: [0] },
  },
};

test("TopoJSON becomes GeoJSON: arcs decoded, joined, and reversed by a negative index", () => {
  const land = featuresOf(TOPOLOGY, "land");
  assert.deepEqual(land.features[0].geometry, {
    type: "Polygon",
    coordinates: [[[10, 20], [11, 20], [11, 21], [10, 21], [10, 20]]],
  });
  assert.deepEqual(land.features[1].geometry, {
    type: "MultiPolygon",
    coordinates: [[[[11, 20], [12, 20], [12, 21], [11, 21], [11, 20], [10, 20]]]],
  });
  assert.deepEqual(land.features[2].geometry.coordinates, [land.features[0].geometry.coordinates]);
  assert.equal(land.features.length, 3);
  assert.deepEqual(featuresOf(TOPOLOGY, "coast").features[0].geometry, {
    type: "LineString",
    coordinates: [[10, 20], [11, 20], [11, 21]],
  });
});

const TOPOLOGY_WORLD = {
  ...TOPOLOGY,
  objects: {
    land: TOPOLOGY.objects.land,
    lakes: { type: "GeometryCollection", geometries: [] },
    countries: TOPOLOGY.objects.land,
    coastlines: { type: "GeometryCollection", geometries: [TOPOLOGY.objects.coast] },
  },
};

test("tile maps: their subplots, white-bg without remote fonts, and the package's base map", () => {
  const figure = {
    data: [{ type: "scattermap" }, { type: "densitymap", subplot: "map2" }, { type: "bar" }],
    layout: { map: { style: "white-bg", zoom: 3 }, map2: { style: "carto-positron" } },
  };
  assert.deepEqual(mapSubplots(figure), ["map", "map2"]);
  const plain = withMapStyle(figure, mapSubplots(figure));
  assert.equal(plain.layout.map.style.glyphs, undefined);
  assert.equal(plain.layout.map.style.layers[0].paint["background-color"], "#FFFFFF");
  assert.equal(plain.layout.map.zoom, 3);
  assert.equal(plain.layout.map2.style, "carto-positron");
  const base = baseStyle(TOPOLOGY_WORLD, "light");
  assert.equal(base.glyphs, undefined);
  assert.deepEqual(base.layers.map((layer) => layer.id), ["water", "land", "lakes", "borders", "coastlines"]);
  assert.equal(base.sources.land.data.features.length, 3);
  const onBase = withMapStyle(figure, mapSubplots(figure), base);
  assert.equal(onBase.layout.map.style, base);
  assert.equal(onBase.layout.map2.style, base);
  assert.equal(figure.layout.map.style, "white-bg");
});

test("geo subplots follow the mode with the base map's colours, and keep what the author set", () => {
  const figure = { data: [{ type: "scattergeo", lat: [1], lon: [2] }, { type: "choropleth", geo: "geo2", locations: ["USA"], z: [1] }], layout: { geo2: { oceancolor: "teal", scope: "usa" } } };
  assert.deepEqual(geoSubplots(figure), ["geo", "geo2"]);
  const dark = themedFigure(figure, "dark").layout;
  assert.equal(dark.geo.oceancolor, baseStyle({ transform: undefined, arcs: [], objects: { land: { type: "GeometryCollection", geometries: [] }, lakes: { type: "GeometryCollection", geometries: [] }, countries: { type: "GeometryCollection", geometries: [] }, coastlines: { type: "GeometryCollection", geometries: [] } } }, "dark").layers[0].paint["background-color"]);
  assert.equal(dark.geo.bgcolor, "rgb(17,17,17)");
  assert.equal(dark.geo.showocean, true);
  assert.equal(dark.geo2.oceancolor, "teal");
  assert.equal(dark.geo2.scope, "usa");
  assert.notEqual(themedFigure(figure, "light").layout.geo.landcolor, dark.geo.landcolor);
  assert.equal(themedFigure({ data: [{ type: "bar" }], layout: {} }, "dark").layout.geo, undefined);
  assert.equal(figure.layout.geo, undefined);
});

test("polar, ternary and smith subplots follow the mode, axes included, and keep what the author set", () => {
  const figure = {
    data: [{ type: "scatterpolar", r: [1], theta: [1] }, { type: "barpolar", subplot: "polar2", r: [1], theta: [1] }, { type: "scatterternary", a: [1], b: [1], c: [1] }, { type: "scattersmith", real: [1], imag: [1] }],
    layout: { polar: { radialaxis: { gridcolor: "red" }, bgcolor: "teal" }, ternary: { aaxis: { title: { text: "a" } } } },
  };
  const dark = themedFigure(figure, "dark").layout;
  assert.deepEqual(Object.keys(dark).filter((key) => /^(polar|ternary|smith)/.test(key)).sort(), ["polar", "polar2", "smith", "ternary"]);
  assert.equal(dark.polar.bgcolor, "teal");
  assert.equal(dark.polar.radialaxis.gridcolor, "red");
  assert.equal(dark.polar.radialaxis.linecolor, "#506784");
  assert.equal(dark.polar2.bgcolor, "rgb(17,17,17)");
  assert.equal(dark.polar2.angularaxis.gridcolor, "#506784");
  assert.equal(dark.ternary.aaxis.title.text, "a");
  assert.equal(dark.ternary.baxis.linecolor, "#506784");
  assert.equal(dark.smith.realaxis.gridcolor, "#506784");
  assert.equal(themedFigure(figure, "light").layout.smith.bgcolor, "#E5ECF6");
  assert.equal(themedSubplots({ data: [{ type: "bar" }], layout: {} }, { plot: "x", grid: "y" }).polar, undefined);
  assert.equal(figure.layout.polar2, undefined);
});

test("menu buttons keep a light face with dark text in both modes, so the pressed button's near-white face stays readable, and the author's choices win", () => {
  const menus = [{ buttons: [], bgcolor: "pink" }, { buttons: [], font: { size: 20 } }, null];
  const themed = themedMenus(menus, "dark");
  assert.equal(themed[0].bgcolor, "pink");
  assert.equal(themed[0].font.color, "#2a3f5f");
  assert.equal(themed[1].bgcolor, "#C8D4E3");
  assert.deepEqual(themed[1].font, { color: "#2a3f5f", size: 20 });
  assert.equal(themed[2], null);
  assert.equal(themedMenus([{ buttons: [] }], "light")[0].bordercolor, "#2a3f5f");
  const figure = { data: [], layout: { updatemenus: [{ buttons: [] }] } };
  assert.equal(themedFigure(figure, "dark").layout.updatemenus[0].font.color, "#2a3f5f");
  assert.equal(themedFigure({ data: [], layout: {} }, "dark").layout.updatemenus, undefined);
});

test("outlines are cut where a line jumps across the antimeridian, so no stroke runs across the map", () => {
  assert.deepEqual(splitAtAntimeridian([[170, 66], [179, 66], [-179, 66], [-170, 66]]), [[[170, 66], [179, 66]], [[-179, 66], [-170, 66]]]);
  assert.deepEqual(splitAtAntimeridian([[0, 0], [10, 10]]), [[[0, 0], [10, 10]]]);
  assert.deepEqual(splitAtAntimeridian([[0, 0]]), []);
  const lines = outlinesOf({
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[179, 0], [-179, 0], [-179, 5], [179, 5], [179, 0]]] } },
      { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } },
    ],
  });
  assert.equal(lines.features.length, 1);
  assert.equal(lines.features[0].geometry.type, "MultiLineString");
  assert.ok(lines.features[0].geometry.coordinates.every((line) => line.every((point, i) => i === 0 || Math.abs(point[0] - line[i - 1][0]) <= 180)));
  assert.equal(lines.features[0].geometry.coordinates.length, 3);
});

test("a polygon that touches both sides of the antimeridian is drawn in one piece, and a ring that circles the pole is left as it is", () => {
  const touching = { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[179, 65], [179.9, 71], [-180, 71], [-175, 68], [-180, 65], [179, 65]]] } };
  const polar = { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[-180, -84], [-90, -70], [0, -70], [90, -70], [179.6, -84], [-180, -84]]] } };
  const out = unwrapPolygons({ type: "FeatureCollection", features: [touching, polar] }).features;
  const ring = out[0].geometry.coordinates[0];
  assert.deepEqual(ring, [[179, 65], [179.9, 71], [180, 71], [185, 68], [180, 65], [179, 65]]);
  assert.ok(ring.every((point, i) => i === 0 || Math.abs(point[0] - ring[i - 1][0]) <= 180));
  assert.deepEqual(out[1].geometry.coordinates[0], polar.geometry.coordinates[0]);
  assert.deepEqual(touching.geometry.coordinates[0][2], [-180, 71]);
  const unchanged = { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } };
  assert.deepEqual(unwrapPolygons({ type: "FeatureCollection", features: [unchanged] }).features[0], unchanged);
});
