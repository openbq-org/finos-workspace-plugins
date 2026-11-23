const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const days = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05", "2026-01-06"];
const ys = [4, 7, 5, 9, 8, 12];
const ys2 = [3, 5, 6, 6, 9, 10];
const grid = [[1, 20, 30, 20], [20, 1, 60, 30], [30, 60, 1, 40], [10, 30, 40, 1]];
const surfaceZ = [...Array(12)].map((_, i) => [...Array(12)].map((_, j) => Math.sin(i / 2) * Math.cos(j / 2)));
const title = (text) => ({ title: { text } });
const typed = (Type, dtype, values) => ({ dtype, bdata: Buffer.from(new Type(values).buffer).toString("base64") });
const ring = (n, fn) => [...Array(n)].map((_, i) => fn(i));
const cities = { lat: [40.7, 51.5, 35.7, -33.9, -23.5], lon: [-74, -0.1, 139.7, 151.2, -46.6], text: ["New York", "London", "Tokyo", "Sydney", "São Paulo"] };
const carpet = { type: "carpet", a: [4, 4, 4, 4.5, 4.5, 4.5, 5, 5, 5, 6, 6, 6], b: [1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3], y: [2, 3.5, 4, 3, 4.5, 5, 5.5, 6.5, 7.5, 8, 8.5, 10], aaxis: { tickprefix: "a = ", smoothing: 0 }, baxis: { tickprefix: "b = ", smoothing: 0 } };
const frame = (name, y) => ({ name, data: [{ y }] });

export const FIGURES = {
  "scatter-lines": { data: [{ type: "scatter", mode: "lines", name: "a", x: days, y: ys }, { type: "scatter", mode: "lines+markers", name: "b", x: days, y: ys2 }], layout: { ...title("Lines"), xaxis: { title: { text: "Day" } }, yaxis: { title: { text: "USD" } } } },
  "scatter-markers-text": { data: [{ type: "scatter", mode: "markers+text", x: [1, 2, 3], y: [2, 4, 3], text: ["one", "two", "three"], textposition: "top center", marker: { size: 14 } }], layout: title("Markers and text") },
  "scatter-bubble": { data: [{ type: "scatter", mode: "markers", x: [1, 2, 3, 4], y: [10, 11, 12, 13], marker: { size: [20, 40, 60, 80], color: [1, 2, 3, 4], colorscale: "Viridis", showscale: true } }], layout: title("Bubbles") },
  "scatter-fill": { data: [{ type: "scatter", mode: "lines", fill: "tozeroy", x: days, y: ys }, { type: "scatter", mode: "lines", fill: "tonexty", x: days, y: ys2 }], layout: title("Areas") },
  "scatter-error-bars": { data: [{ type: "scatter", mode: "markers", x: [1, 2, 3], y: [2, 5, 3], error_y: { type: "data", array: [1, 2, 1] }, error_x: { type: "constant", value: 0.2 } }], layout: title("Error bars") },
  "scatter-log-axes": { data: [{ type: "scatter", mode: "lines+markers", x: [1, 10, 100, 1000], y: [1, 100, 10000, 1000000] }], layout: { ...title("Log axes"), xaxis: { type: "log" }, yaxis: { type: "log" } } },
  "scatter-secondary-axis": { data: [{ type: "bar", name: "volume", x: months, y: [100, 120, 90, 140, 130, 160] }, { type: "scatter", mode: "lines+markers", name: "price", x: months, y: ys, yaxis: "y2" }], layout: { ...title("Two y axes"), yaxis2: { overlaying: "y", side: "right" } } },
  "scatter-subplots": { data: [{ type: "scatter", x: days, y: ys, name: "top" }, { type: "scatter", x: days, y: ys2, name: "bottom", xaxis: "x2", yaxis: "y2" }], layout: { ...title("Two plots"), xaxis: { domain: [0, 1], anchor: "y" }, yaxis: { domain: [0.55, 1] }, xaxis2: { domain: [0, 1], anchor: "y2" }, yaxis2: { domain: [0, 0.45] } } },
  "scatter-rangeslider": { data: [{ type: "scatter", mode: "lines", x: days, y: ys }], layout: { ...title("Range slider"), xaxis: { rangeslider: { visible: true } } } },
  "scatter-rangeselector": { data: [{ type: "scatter", mode: "lines", x: ring(60, (i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)), y: ring(60, (i) => Math.sin(i / 6) * 10) }], layout: { ...title("Range selector"), xaxis: { rangeselector: { buttons: [{ count: 7, label: "1w", step: "day", stepmode: "backward" }, { step: "all" }] } } } },
  "scatter-shapes-annotations": { data: [{ type: "scatter", mode: "lines", x: [0, 1, 2, 3], y: [1, 3, 2, 4] }], layout: { ...title("Shapes"), shapes: [{ type: "rect", x0: 0.5, x1: 1.5, y0: 0, y1: 5, fillcolor: "rgba(255,0,0,0.2)", line: { width: 0 } }], annotations: [{ x: 2, y: 2, text: "here", showarrow: true }] } },
  "scatter-typed-arrays": { data: [{ type: "scatter", mode: "lines", y: typed(Float64Array, "f8", [1, 4, 2, 8, 5]) }, { type: "bar", y: typed(Int8Array, "i1", [1, 2, 3, 4, 5]) }], layout: title("Typed arrays") },
  "scatter-latex": { data: [{ type: "scatter", mode: "lines", name: "$\\alpha^2$", x: [1, 2, 3], y: [1, 4, 9] }], layout: { ...title("$\\sum_{i=1}^{n} x_i$"), xaxis: { title: { text: "$\\beta$" } } } },
  "scatter-dropdown": { data: [{ type: "scatter", mode: "lines", y: ys }], layout: { ...title("Dropdown"), updatemenus: [{ buttons: [{ label: "A", method: "restyle", args: ["y", [ys]] }, { label: "B", method: "restyle", args: ["y", [ys2]] }] }] } },
  "scatter-animation": { data: [{ type: "scatter", mode: "lines+markers", y: [1, 2, 3] }], layout: { ...title("Animation"), updatemenus: [{ type: "buttons", buttons: [{ label: "Play", method: "animate", args: [null] }] }], sliders: [{ steps: [{ label: "f1", method: "animate", args: [["f1"]] }, { label: "f2", method: "animate", args: [["f2"]] }] }] }, frames: [frame("f1", [1, 2, 3]), frame("f2", [3, 2, 1])] },
  scattergl: { data: [{ type: "scattergl", mode: "markers", x: ring(2000, (i) => Math.cos(i / 40) * i / 20), y: ring(2000, (i) => Math.sin(i / 40) * i / 20) }], layout: title("scattergl") },
  "bar-grouped": { data: [{ type: "bar", name: "emea", x: months, y: ys }, { type: "bar", name: "apac", x: months, y: ys2 }], layout: { ...title("Grouped"), barmode: "group" } },
  "bar-stacked": { data: [{ type: "bar", name: "emea", x: months, y: ys }, { type: "bar", name: "apac", x: months, y: ys2 }], layout: { ...title("Stacked"), barmode: "stack" } },
  "bar-horizontal-text": { data: [{ type: "bar", orientation: "h", x: [3, 6, 4], y: ["Rates", "FX", "Credit"], text: ["3", "6", "4"], textposition: "auto" }], layout: title("Horizontal") },
  "bar-relative": { data: [{ type: "bar", x: months, y: [2, -3, 4, -1, 3, -2] }, { type: "bar", x: months, y: [1, 2, -2, 3, -1, 1] }], layout: { ...title("Relative"), barmode: "relative" } },
  barpolar: { data: [{ type: "barpolar", r: [3, 5, 2, 4], theta: [0, 90, 180, 270] }], layout: title("Barpolar") },
  waterfall: { data: [{ type: "waterfall", x: ["Start", "Up", "Down", "End"], measure: ["absolute", "relative", "relative", "total"], y: [10, 5, -3, 0] }], layout: title("Waterfall") },
  funnel: { data: [{ type: "funnel", y: ["Visits", "Signups", "Paid"], x: [100, 40, 10] }], layout: title("Funnel") },
  funnelarea: { data: [{ type: "funnelarea", values: [100, 60, 30], text: ["a", "b", "c"] }], layout: title("Funnel area") },
  histogram: { data: [{ type: "histogram", x: ring(200, (i) => Math.sin(i) * 5 + (i % 7)) }], layout: title("Histogram") },
  "histogram-overlay": { data: [{ type: "histogram", x: ring(200, (i) => Math.sin(i) * 5), opacity: 0.6 }, { type: "histogram", x: ring(200, (i) => Math.cos(i) * 5 + 2), opacity: 0.6 }], layout: { ...title("Overlay"), barmode: "overlay" } },
  histogram2d: { data: [{ type: "histogram2d", x: ring(300, (i) => Math.sin(i)), y: ring(300, (i) => Math.cos(i * 1.3)) }], layout: title("2D histogram") },
  histogram2dcontour: { data: [{ type: "histogram2dcontour", x: ring(300, (i) => Math.sin(i)), y: ring(300, (i) => Math.cos(i * 1.3)) }], layout: title("2D histogram contour") },
  box: { data: [{ type: "box", name: "a", y: [1, 2, 2, 3, 4, 5, 9] }, { type: "box", name: "b", y: [2, 3, 3, 4, 6, 7, 8] }], layout: title("Box") },
  violin: { data: [{ type: "violin", name: "a", y: ring(80, (i) => Math.sin(i) * 3 + 5), box: { visible: true } }], layout: title("Violin") },
  pie: { data: [{ type: "pie", labels: ["Rates", "FX", "Credit"], values: [50, 30, 20] }], layout: title("Pie") },
  donut: { data: [{ type: "pie", labels: ["Rates", "FX", "Credit"], values: [50, 30, 20], hole: 0.5 }], layout: title("Donut") },
  sunburst: { data: [{ type: "sunburst", labels: ["All", "A", "B", "a1", "a2"], parents: ["", "All", "All", "A", "A"], values: [10, 6, 4, 3, 3], branchvalues: "total" }], layout: title("Sunburst") },
  treemap: { data: [{ type: "treemap", labels: ["All", "A", "B", "a1", "a2"], parents: ["", "All", "All", "A", "A"], values: [10, 6, 4, 3, 3], branchvalues: "total" }], layout: title("Treemap") },
  icicle: { data: [{ type: "icicle", labels: ["All", "A", "B", "a1", "a2"], parents: ["", "All", "All", "A", "A"], values: [10, 6, 4, 3, 3], branchvalues: "total" }], layout: title("Icicle") },
  sankey: { data: [{ type: "sankey", node: { label: ["A", "B", "C", "D"] }, link: { source: [0, 0, 1], target: [2, 3, 3], value: [4, 2, 3] } }], layout: title("Sankey") },
  parcats: { data: [{ type: "parcats", dimensions: [{ label: "Class", values: ["a", "b", "a", "b"] }, { label: "Kind", values: ["x", "x", "y", "y"] }] }], layout: title("Parallel categories") },
  parcoords: { data: [{ type: "parcoords", dimensions: [{ label: "a", values: [1, 2, 3, 4] }, { label: "b", values: [4, 3, 2, 1] }, { label: "c", values: [2, 4, 1, 3] }] }], layout: title("Parallel coordinates") },
  heatmap: { data: [{ type: "heatmap", x: ["a", "b", "c", "d"], y: ["p", "q", "r", "s"], z: grid }], layout: title("Heatmap") },
  "heatmap-typed": { data: [{ type: "heatmap", z: { ...typed(Int8Array, "i1", [1, 2, 3, 4, 5, 6, 7, 8, 9]), shape: "3, 3" } }], layout: title("Typed heatmap") },
  contour: { data: [{ type: "contour", z: grid }], layout: title("Contour") },
  image: { data: [{ type: "image", z: [[[255, 0, 0], [0, 255, 0]], [[0, 0, 255], [255, 255, 0]]] }], layout: title("Image") },
  table: { data: [{ type: "table", header: { values: ["a", "b"] }, cells: { values: [[1, 2, 3], ["x", "y", "z"]] } }], layout: title("Table") },
  indicator: { data: [{ type: "indicator", mode: "number+delta", value: 120, delta: { reference: 100 } }], layout: title("Indicator") },
  "indicator-gauge": { data: [{ type: "indicator", mode: "gauge+number", value: 60, gauge: { axis: { range: [0, 100] } } }], layout: title("Gauge") },
  carpet: { data: [carpet], layout: title("Carpet") },
  contourcarpet: { data: [carpet, { type: "contourcarpet", a: [4, 4, 4, 4.5, 4.5, 4.5, 5, 5, 5, 6, 6, 6], b: [1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3], z: [1, 1.96, 2.56, 3.0625, 4, 5.0625, 1, 7.5625, 9, 12.25, 15.21, 14.0625] }], layout: title("Contour carpet") },
  scattercarpet: { data: [carpet, { type: "scattercarpet", a: [4, 4.5, 5, 6], b: [1.5, 2.5, 1.5, 3], mode: "markers" }], layout: title("Scatter carpet") },
  scatterpolar: { data: [{ type: "scatterpolar", mode: "lines+markers", r: [1, 3, 2, 4, 1], theta: [0, 72, 144, 216, 288] }], layout: title("Polar") },
  scatterternary: { data: [{ type: "scatterternary", mode: "markers", a: [1, 2, 3], b: [3, 2, 1], c: [2, 2, 2] }], layout: title("Ternary") },
  scattersmith: { data: [{ type: "scattersmith", mode: "markers", real: [0.5, 1, 2], imag: [0.5, 1, -1] }], layout: title("Smith") },
  splom: { data: [{ type: "splom", dimensions: [{ label: "a", values: [1, 2, 3, 4] }, { label: "b", values: [4, 3, 2, 1] }, { label: "c", values: [2, 4, 1, 3] }] }], layout: title("Scatter matrix") },
  candlestick: { data: [{ type: "candlestick", x: days.slice(0, 4), open: [10, 11, 12, 11], high: [12, 13, 14, 13], low: [9, 10, 11, 10], close: [11, 12, 11.5, 12.5] }], layout: title("Candlestick") },
  ohlc: { data: [{ type: "ohlc", x: days.slice(0, 4), open: [10, 11, 12, 11], high: [12, 13, 14, 13], low: [9, 10, 11, 10], close: [11, 12, 11.5, 12.5] }], layout: title("OHLC") },
  scatter3d: { data: [{ type: "scatter3d", mode: "markers", x: [1, 2, 3, 4], y: [4, 3, 2, 1], z: [1, 3, 2, 4] }], layout: title("Scatter 3D") },
  mesh3d: { data: [{ type: "mesh3d", x: [0, 1, 2, 0], y: [0, 0, 1, 2], z: [0, 2, 0, 1], i: [0, 0, 0, 1], j: [1, 2, 3, 2], k: [2, 3, 1, 3] }], layout: title("Mesh 3D") },
  surface: { data: [{ type: "surface", z: surfaceZ }], layout: title("Surface") },
  cone: { data: [{ type: "cone", x: [1, 2], y: [1, 2], z: [1, 2], u: [1, 0], v: [0, 1], w: [0, 0] }], layout: title("Cone") },
  streamtube: { data: [{ type: "streamtube", x: [0, 1, 0, 1], y: [0, 0, 1, 1], z: [0, 0, 0, 0], u: [1, 1, 1, 1], v: [0, 0, 0, 0], w: [0, 0, 0, 0], starts: { x: [0], y: [0.5], z: [0] } }], layout: title("Streamtube") },
  isosurface: { data: [{ type: "isosurface", x: ring(27, (i) => i % 3), y: ring(27, (i) => Math.floor(i / 3) % 3), z: ring(27, (i) => Math.floor(i / 9)), value: ring(27, (i) => (i % 5) - 2), isomin: -1, isomax: 1 }], layout: title("Isosurface") },
  volume: { data: [{ type: "volume", x: ring(27, (i) => i % 3), y: ring(27, (i) => Math.floor(i / 3) % 3), z: ring(27, (i) => Math.floor(i / 9)), value: ring(27, (i) => i % 5), isomin: 0, isomax: 4, opacity: 0.3 }], layout: title("Volume") },
  scattergeo: { data: [{ type: "scattergeo", mode: "markers", ...cities, marker: { size: 10 } }], layout: { ...title("Cities"), geo: { projection: { type: "natural earth" } } } },
  "scattergeo-lines": { data: [{ type: "scattergeo", mode: "lines", lat: [40.7, 51.5, 35.7], lon: [-74, -0.1, 139.7] }], layout: { ...title("Routes"), geo: { projection: { type: "orthographic" } } } },
  choropleth: { data: [{ type: "choropleth", locations: ["USA", "FRA", "BRA", "IND", "AUS"], z: [5, 3, 4, 2, 1], colorscale: "Blues" }], layout: title("Choropleth") },
  "choropleth-usa": { data: [{ type: "choropleth", locationmode: "USA-states", locations: ["CA", "TX", "NY", "FL"], z: [4, 3, 5, 2] }], layout: { ...title("US states"), geo: { scope: "usa" } } },
  scattermap: { data: [{ type: "scattermap", mode: "markers", lat: cities.lat, lon: cities.lon, marker: { size: 12 } }], layout: { ...title("Tile map"), map: { center: { lat: 20, lon: 0 }, zoom: 0.5 } } },
  densitymap: { data: [{ type: "densitymap", lat: cities.lat, lon: cities.lon, z: [1, 2, 3, 2, 1], radius: 30 }], layout: { ...title("Density map"), map: { center: { lat: 20, lon: 0 }, zoom: 0.5 } } },
  choroplethmap: { data: [{ type: "choroplethmap", geojson: { type: "FeatureCollection", features: [{ type: "Feature", id: "a", properties: {}, geometry: { type: "Polygon", coordinates: [[[-10, 40], [10, 40], [10, 55], [-10, 55], [-10, 40]]] } }] }, locations: ["a"], z: [3] }], layout: { ...title("Choropleth map"), map: { center: { lat: 47, lon: 0 }, zoom: 3 } } },
  "scattermap-white-bg": { data: [{ type: "scattermap", mode: "markers", lat: [10], lon: [10], marker: { size: 12 } }], layout: { ...title("White background"), map: { style: "white-bg", center: { lat: 10, lon: 10 }, zoom: 2 } } },
  "own-template": { data: [{ type: "bar", x: months, y: ys }], layout: { ...title("Own colours"), paper_bgcolor: "#fffbe6", plot_bgcolor: "#fff3bf", font: { color: "#5c4400" } } },
  "empty-data": { data: [], layout: title("No traces") },
  "many-traces": { data: ring(30, (i) => ({ type: "scatter", mode: "lines", name: `t${i}`, y: ring(20, (j) => Math.sin(j / 3 + i)) })), layout: title("Thirty traces") },
};

export const KIND_IDS = Object.keys(FIGURES);
