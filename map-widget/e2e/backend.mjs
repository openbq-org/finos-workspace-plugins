import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { CITIES, STATES } from "./data.mjs";

export const BACKEND_NAME = "E2E map examples";
export const CATEGORY = "E2E Map";

const PROBE_MAP = {
  lat: "lat",
  lon: "lon",
  label: "label",
  value: "value",
  tag: "tag",
  category: "category",
  props: ["note"],
  valueLabel: "Value",
  title: "Probe",
};

export const UNLISTED_HOST = "unlisted.invalid";

export const HOSTILE_SOURCES = [
  { id: "script", kind: "raster-tiles", url: "javascript:alert(1)//{z}/{x}/{y}", attribution: "script" },
  { id: "data", kind: "geojson", url: "data:application/json,{}", attribution: "data" },
  { id: "insecure", kind: "raster-tiles", url: "http://insecure.example/{z}/{x}/{y}.png", attribution: "insecure" },
  { id: "file", kind: "geojson", url: "file:///etc/passwd", attribution: "file" },
  { id: "login", kind: "raster-tiles", url: "https://user:pass@tiles.example/{z}/{x}/{y}.png", attribution: "login" },
  { id: "dots", kind: "raster-tiles", url: "https://tiles.example/../{z}/{x}/{y}.png", attribution: "dots" },
  { id: "unlisted", kind: "raster-tiles", url: `https://${UNLISTED_HOST}/tiles/{z}/{x}/{y}.png`, attribution: "unlisted" },
];

export const WIDGETS = {
  us_cities: {
    name: "Largest US Cities",
    description: "The twenty largest US cities by their 2020 Census population",
    category: CATEGORY,
    type: "map",
    endpoint: "/us-cities",
    data: {
      map: {
        lat: "lat",
        lon: "lon",
        label: "city",
        value: "population",
        category: "region",
        tag: "city",
        props: ["state"],
        valueLabel: "Population (2020 Census)",
        title: "Largest US cities",
      },
    },
  },
  us_states: {
    name: "US Population By State",
    description: "The resident population of each state and the District of Columbia at the 2020 Census",
    category: CATEGORY,
    type: "map",
    endpoint: "/us-states",
    data: { map: { state: "state", value: "population", label: "state", valueLabel: "Population (2020 Census)", title: "US population by state" } },
  },
  map_probe_sources: {
    name: "Map Probe Sources",
    description: "A map with hostile map sources, whose rows the test chooses",
    category: CATEGORY,
    type: "map",
    endpoint: "/probe",
    data: { map: { ...PROBE_MAP, sources: HOSTILE_SOURCES } },
  },
  map_probe: {
    name: "Map Probe",
    description: "A map whose response the test chooses",
    category: CATEGORY,
    type: "map",
    endpoint: "/probe",
    data: { map: PROBE_MAP },
  },
};

export function startBackend({ port, listen }) {
  let probe = [];
  const requests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://localhost:${port}`);
    requests.push(url.pathname);
    const send = (status, body) =>
      response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(body));
    if (url.pathname === "/widgets.json") return send(200, WIDGETS);
    if (url.pathname === "/us-cities") return send(200, CITIES);
    if (url.pathname === "/us-states") return send(200, STATES);
    if (url.pathname === "/probe") return send(200, probe);
    return send(404, { detail: "not found" });
  });
  return new Promise((resolve) =>
    server.listen(port, listen, () =>
      resolve({
        server,
        requests,
        serve: (body) => {
          probe = body;
        },
      }),
    ),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.E2E_BACKEND_PORT ?? 8041);
  await startBackend({ port, listen: process.env.E2E_BACKEND_LISTEN ?? "0.0.0.0" });
  console.log(`map examples backend on ${port}`);
}
