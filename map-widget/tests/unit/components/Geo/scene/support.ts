import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Feature } from "geojson";
import type { Topology } from "topojson-specification";
import { aboutUnitedStates } from "~/components/Geo/mapGeometry";
import { buildScene } from "~/components/Geo/mapScene";
import { MAP_THEMES } from "~/components/Geo/mapTheme";
import type { Scene, SceneInput } from "~/components/Geo/scene/sceneTypes";
import type { HeldMapSource } from "~/lib/geo/mapSourceTypes";
import { mapSpec } from "~/lib/geo/mapSpec";
import { boundariesOf } from "~/lib/geo/regions/boundaries";

const topology = (path: string) =>
  JSON.parse(readFileSync(join(process.cwd(), "vendor/geo", path), "utf8")) as Topology;

export const world = boundariesOf(
  "countries",
  topology("world-atlas-2.0.2/countries-110m.json"),
);
export const states = boundariesOf(
  "us-states",
  topology("us-atlas-3.0.1/states-10m.json"),
);
export const counties = boundariesOf(
  "us-counties",
  topology("us-atlas-3.0.1/counties-10m.json"),
);
export const sets = { "us-states": states, "us-counties": counties, countries: world };
export const theme = MAP_THEMES.light;

export const scene = (raw: unknown, more: Partial<SceneInput> = {}): Scene => {
  const spec = mapSpec(raw);
  return buildScene({
    spec,
    world,
    states: aboutUnitedStates(spec) ? states : null,
    sets,
    theme,
    sea: "#ffffff",
    basemap: null,
    ...more,
  });
};

export const featuresOf = (built: Scene, source: string): Feature[] =>
  (built.sources[source] as unknown as { data: { features: Feature[] } }).data.features;

export const styleOf = (built: Scene, id: string) => {
  const layer = built.style.find((item) => item.id === id);
  if (!layer) throw new Error(`The style has no layer "${id}".`);
  return layer as unknown as {
    id: string;
    type: string;
    source: string;
    filter?: unknown;
    layout?: Record<string, unknown>;
    paint: Record<string, unknown>;
  };
};

export const ids = (built: Scene) => built.style.map((layer) => layer.id);

export const held = (more: Partial<HeldMapSource> = {}): HeldMapSource => ({
  id: "ndvi",
  name: "NDVI",
  kind: "raster-tiles",
  attribution: "Reference backend",
  role: "overlay",
  url: "https://data.example/tiles/ndvi/{z}/{x}/{y}.png",
  origin: "https://data.example",
  backend: "Reference",
  headers: { Authorization: "Bearer secret" },
  ...more,
});
