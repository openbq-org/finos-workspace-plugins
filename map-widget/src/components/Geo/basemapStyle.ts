import type { LayerSpecification } from "maplibre-gl";

export const BASEMAP_SOURCE = "basemap";

export interface BasemapLayers {
  under: LayerSpecification[];
  labels: LayerSpecification[];
}

export type BasemapPart = "names" | "roads" | "borders";

export function basemapPart(layer: LayerSpecification): BasemapPart | null {
  if (layer.type === "symbol") return "names";
  const from = "source-layer" in layer ? layer["source-layer"] : undefined;
  if (from === "boundaries" || from === "boundary") return "borders";
  if (from === "roads" || from === "transportation") return "roads";
  return null;
}

const ICON_LAYERS = new Set(["roads_oneway", "roads_shields", "pois"]);

type Flavor = Record<string, unknown>;

const TUNED: Record<"light" | "dark", Flavor> = {
  light: {
    background: "#d5e1ea",
    earth: "#f4f3f0",
    water: "#d5e1ea",
    park_a: "#e9efe4",
    park_b: "#e3ebdc",
    wood_a: "#e8eee3",
    wood_b: "#e3ebdc",
    scrub_a: "#ecefe6",
    scrub_b: "#e8ece1",
    glacier: "#f7f9fa",
    sand: "#f2efe6",
    beach: "#f2efe6",
    aerodrome: "#ecebe7",
    boundaries: "#aab2bf",
    highway: "#ffffff",
    highway_casing_late: "#d6d3cc",
    highway_casing_early: "#d6d3cc",
    major: "#ffffff",
    major_casing_late: "#e0ddd6",
    major_casing_early: "#e0ddd6",
    railway: "#c9c7c1",
    city_label: "#3b4352",
    city_label_halo: "rgba(255,255,255,0.8)",
    subplace_label: "#6b7483",
    subplace_label_halo: "rgba(255,255,255,0.8)",
    state_label: "#4a5363",
    state_label_halo: "rgba(255,255,255,0.7)",
    country_label: "#3f4756",
    ocean_label: "#7f97b0",
    roads_label_major: "#7b8494",
    roads_label_minor: "#8a93a3",
    landcover: {
      grassland: "#eff2eb",
      barren: "#f5f3ed",
      urban_area: "#eeede9",
      farmland: "#f0f2ec",
      glacier: "#f9fafb",
      scrub: "#eff1ea",
      forest: "#e7eee4",
    },
  },
  dark: {
    background: "#070f20",
    earth: "#1d2a45",
    water: "#070f20",
    park_a: "#182a38",
    park_b: "#182a38",
    wood_a: "#182a38",
    wood_b: "#182a38",
    scrub_a: "#19263a",
    scrub_b: "#19263a",
    glacier: "#243049",
    sand: "#1c2740",
    beach: "#1c2740",
    aerodrome: "#1d2941",
    boundaries: "#5a6a8c",
    highway: "#3d4d6f",
    highway_casing_late: "#141d31",
    highway_casing_early: "#141d31",
    major: "#34435f",
    major_casing_late: "#141d31",
    major_casing_early: "#141d31",
    railway: "#2f3c58",
    city_label: "#c6cedd",
    city_label_halo: "#0b1528",
    subplace_label: "#8d98b0",
    subplace_label_halo: "#0b1528",
    state_label: "#8591ab",
    state_label_halo: "#0b1528",
    country_label: "#a3aec5",
    ocean_label: "#4f6690",
    roads_label_major: "#7f8aa3",
    roads_label_major_halo: "#0b1528",
    roads_label_minor: "#6d7892",
    roads_label_minor_halo: "#0b1528",
    landcover: {
      grassland: "#19283b",
      barren: "#1b263c",
      urban_area: "#1a2439",
      farmland: "#19273a",
      glacier: "#243049",
      scrub: "#19263a",
      forest: "#172a39",
    },
  },
};

const BORDER = { light: "#8791a3", dark: "#6b7ba0" };

export const MAP_GROUND = {
  light: { land: TUNED.light.earth, water: TUNED.light.water, border: BORDER.light },
  dark: { land: TUNED.dark.earth, water: TUNED.dark.water, border: BORDER.dark },
} as const;
const NAME = [
  "case",
  ["has", "script"],
  ["coalesce", ["get", "name:en"], ""],
  ["coalesce", ["get", "name:en"], ["get", "name"], ""],
];

const plainName = (expression: unknown): unknown => {
  if (!Array.isArray(expression)) return expression;
  if (expression[0] === "case" && JSON.stringify(expression).includes('"script"'))
    return NAME;
  return expression.map(plainName);
};

export async function protomapsLayers(
  theme: "light" | "dark",
  has: (layer: string) => boolean,
): Promise<BasemapLayers> {
  const { layers, namedFlavor } = await import("@protomaps/basemaps");
  const flavor = { ...namedFlavor(theme), ...TUNED[theme] } as Parameters<
    typeof layers
  >[1];
  const all = layers(BASEMAP_SOURCE, flavor, { lang: "en" }) as LayerSpecification[];
  const drawn = all.filter(
    (layer) =>
      !ICON_LAYERS.has(layer.id) &&
      (!("source-layer" in layer) ||
        !layer["source-layer"] ||
        has(layer["source-layer"])),
  );
  const labels = drawn
    .filter((layer) => layer.type === "symbol")
    .map((layer) => {
      const { "icon-image": _icon, ...layout } = (layer.layout ?? {}) as Record<
        string,
        unknown
      >;

      layout["text-field"] = plainName(layout["text-field"]);
      return { ...layer, layout } as LayerSpecification;
    });
  const under = drawn
    .filter((layer) => layer.type !== "symbol")
    .map((layer) =>

      layer.id === "boundaries_country"
        ? ({
            ...layer,
            paint: { ...layer.paint, "line-color": BORDER[theme], "line-width": 1 },
          } as LayerSpecification)
        : layer,
    );
  return { under, labels };
}

const LATIN_NAME = ["coalesce", ["get", "name_en"], ["get", "name:latin"], ""];

function grey(color: string): { light: number; alpha: number } | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1];
  if (hex) {
    const step = hex.length === 3 ? 1 : 2;
    const channel = Number.parseInt(hex.slice(0, step).padEnd(2, hex[0]), 16);
    return { light: channel / 255, alpha: 1 };
  }
  const parts = /^(rgb|hsl)a?\(([^)]+)\)$/.exec(color.trim());
  if (!parts) return null;
  const values = parts[2]
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number.parseFloat);
  if (values.length < 3 || values.some(Number.isNaN)) return null;
  const light = parts[1] === "hsl" ? values[2] / 100 : values[0] / 255;
  return { light, alpha: values[3] ?? 1 };
}

const navy = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(navy);
  const found = typeof value === "string" ? grey(value) : null;
  if (!found) return value;

  const light = Math.round(Math.min(40, 15 + found.light * 200));
  return `hsla(221, 30%, ${light}%, ${found.alpha})`;
};

const nameColor = (id: string, colors: Flavor) => {
  if (/water/.test(id)) return colors.ocean_label;
  if (/country|city|capital|town/.test(id)) return colors.city_label;
  if (/state|other|village|suburb/.test(id)) return colors.state_label;
  return colors.roads_label_major;
};

export function openFreeMapLayers(
  style: LayerSpecification[],
  names: LayerSpecification[],
  theme: "light" | "dark",
): BasemapLayers {
  const colors = TUNED[theme];
  const under = style
    .filter((layer) => layer.type !== "symbol")
    .map((layer) => {
      const paint: Record<string, unknown> = { ...(layer.paint ?? {}) };
      if (theme === "dark")
        for (const key of Object.keys(paint))
          if (key.endsWith("-color")) paint[key] = navy(paint[key]);
      if (layer.id === "background") paint["background-color"] = colors.earth;
      else if (layer.id === "water") paint["fill-color"] = colors.water;
      else if (layer.id === "waterway") paint["line-color"] = colors.water;
      return { ...layer, paint } as LayerSpecification;
    });
  const labels = names
    .filter((layer) => layer.type === "symbol")
    .map((layer) => {
      const layout = { ...(layer.layout as Record<string, unknown>) };
      if (JSON.stringify(layout["text-field"]).includes("name:nonlatin"))
        layout["text-field"] = LATIN_NAME;
      const paint = {
        ...(layer.paint ?? {}),
        "text-color": nameColor(layer.id, colors),
        "text-halo-color": colors.city_label_halo,
        "text-halo-width": 1,
      };
      return { ...layer, layout, paint } as LayerSpecification;
    });
  return { under, labels };
}
