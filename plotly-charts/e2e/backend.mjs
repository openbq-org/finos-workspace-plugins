import { createServer } from "node:http";
import { FIGURES, KIND_IDS } from "./figures.mjs";

export const BACKEND_NAME = "E2E plotly charts";

export const WIDGETS = {
  e2e_sales: { name: "E2E sales", description: "Sales of three regions", category: "E2E Plotly", type: "plotly", endpoint: "/sales" },
  e2e_modebar: { name: "E2E modebar", description: "Sales with the modebar the author asks for", category: "E2E Plotly", type: "plotly", endpoint: "/sales", data: { plotly: { modebar: true } } },
};

const kind = (name, description, endpoint) => ({ name, description, category: "E2E Plotly", type: "plotly", endpoint, gridData: { w: 20, h: 18 } });

export const KINDS = {
  lines: { widget: kind("E2E lines", "Dates on a line", "/kinds/lines"), figure: {
    data: [
      { type: "scatter", mode: "lines+markers", name: "price", x: ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"], y: [10, 12, 11, 15] },
      { type: "scatter", mode: "lines", name: "average", x: ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"], y: [9, 10, 11, 12] },
    ],
    layout: { title: { text: "Price" }, xaxis: { title: { text: "Day" } }, yaxis: { title: { text: "USD" } } },
  } },
  pie: { widget: kind("E2E pie", "Shares of a whole", "/kinds/pie"), figure: {
    data: [{ type: "pie", name: "share", labels: ["Rates", "FX", "Credit"], values: [50, 30, 20] }],
    layout: { title: { text: "Share" } },
  } },
  heatmap: { widget: kind("E2E heatmap", "A grid", "/kinds/heatmap"), figure: {
    data: [{ type: "heatmap", x: ["a", "b", "c"], y: ["p", "q"], z: [[1, 2, 3], [3, 1, 2]] }],
    layout: { title: { text: "Grid" } },
  } },
  geo: { widget: kind("E2E geo", "Cities on the world outlines", "/kinds/geo"), figure: {
    data: [{ type: "scattergeo", mode: "markers", lat: [40.7, 51.5, 35.7], lon: [-74, -0.1, 139.7], text: ["New York", "London", "Tokyo"], marker: { size: 10 } }],
    layout: { title: { text: "Cities" }, geo: { projection: { type: "natural earth" } } },
  } },
  tiles: { widget: kind("E2E tile map", "A tile map that draws over the bundled base map", "/kinds/tiles"), figure: {
    data: [{ type: "scattermap", mode: "markers", lat: [40.7, 51.5], lon: [-74, -0.1], marker: { size: 12 } }],
    layout: { title: { text: "Tiles" }, map: { center: { lat: 45, lon: -35 }, zoom: 1.5 } },
  } },
  surface: { widget: kind("E2E surface", "A 3D surface", "/kinds/surface"), figure: {
    data: [{ type: "surface", z: [[1, 2, 3, 2], [2, 4, 5, 3], [3, 5, 7, 4], [2, 3, 4, 2]] }],
    layout: { title: { text: "Surface" } },
  } },
  latex: { widget: kind("E2E latex", "LaTeX in a title", "/kinds/latex"), figure: {
    data: [{ type: "bar", x: ["a", "b"], y: [1, 2] }],
    layout: { title: { text: "$\\sum_{i=1}^{n} x_i$" } },
  } },
  candles: { widget: kind("E2E candles", "Open, high, low, close", "/kinds/candles"), figure: {
    data: [{ type: "candlestick", x: ["2026-01-01", "2026-01-02", "2026-01-03"], open: [10, 11, 12], high: [12, 13, 14], low: [9, 10, 11], close: [11, 12, 11.5] }],
    layout: { title: { text: "Candles" } },
  } },
};

export const SALES = {
  data: [
    { type: "bar", name: "emea", x: ["Jan", "Feb", "Mar"], y: [100, 114, 121] },
    { type: "bar", name: "apac", x: ["Jan", "Feb", "Mar"], y: [105, 104, 131] },
    { type: "bar", name: "amer", x: ["Jan", "Feb", "Mar"], y: [90, 99, 87] },
  ],
  layout: { title: { text: "Sales" }, barmode: "group", xaxis: { title: { text: "Month" } }, yaxis: { title: { text: "Units" } } },
};

WIDGETS.e2e_huge = { name: "E2E huge", description: "More points than a static chart holds", category: "E2E Plotly", type: "plotly", endpoint: "/huge" };
WIDGETS.e2e_figure = { name: "E2E figure", description: "The figure the test chooses", category: "E2E Plotly", type: "plotly", endpoint: "/figure", gridData: { w: 20, h: 18 } };

for (const [id, { widget }] of Object.entries(KINDS)) WIDGETS[`e2e_${id}`] = widget;

const HUGE = { data: [{ type: "scatter", mode: "lines", y: [...Array(60000)].map((_, i) => Math.sin(i / 50) * 1.123456789) }], layout: { title: { text: "Huge" } } };

export function startBackend({ port, listen }) {
  const requests = [];
  let current = KIND_IDS[0];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://localhost:${port}`);
    requests.push(`${url.pathname}${url.search}`);
    const send = (status, body) => response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(body));
    if (url.pathname === "/widgets.json") send(200, WIDGETS);
    else if (url.pathname === "/sales") send(200, SALES);
    else if (url.pathname === "/huge") send(200, HUGE);
    else if (url.pathname === "/figure") send(200, FIGURES[current]);
    else if (url.pathname.startsWith("/kinds/") && KINDS[url.pathname.slice(7)]) send(200, KINDS[url.pathname.slice(7)].figure);
    else send(404, { detail: "not found" });
  });
  return new Promise((resolve) => server.listen(port, listen, () => resolve({ server, requests, show: (id) => { current = id; } })));
}
