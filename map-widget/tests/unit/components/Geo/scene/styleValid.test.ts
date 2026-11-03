import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import type { StyleSpecification } from "maplibre-gl";
import { beforeEach, describe, expect, it } from "vitest";
import { applyMapView } from "~/components/Geo/applyMapView";
import { glyphsUrl } from "~/components/Geo/basemap";
import { MAP_THEMES } from "~/components/Geo/mapTheme";
import { pictureSources } from "~/components/Geo/scene/image";
import type { Scene } from "~/components/Geo/scene/sceneTypes";
import type { MapViewState } from "~/lib/geo/mapViewState";
import { FakeMap } from "../fakeMap";
import { held, scene } from "./support";

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const SQUARE = (west: number, south: number, size = 0.01) => [
  [
    [west, south],
    [west + size, south],
    [west + size, south + size],
    [west, south + size],
    [west, south],
  ],
];
const spread = (count: number, more: (at: number) => object = () => ({})) =>
  Array.from({ length: count }, (_, at) => ({
    lat: 30 + (at % 15),
    lon: -120 + (at % 50),
    ...more(at),
  }));

const styleOf = (built: Scene): StyleSpecification => ({
  version: 8,
  glyphs: glyphsUrl("http://localhost"),
  sources: {
    ...built.sources,
    ...Object.fromEntries(
      Object.entries(pictureSources(built.pictures).sources).map(([id, source]) => [
        id,
        { ...source, url: "http://localhost/picture.png" },
      ]),
    ),
  } as StyleSpecification["sources"],
  layers: built.style as StyleSpecification["layers"],
});
const errorsOf = (style: StyleSpecification) =>
  validateStyleMin(style).map((error) => error.message);

function viewed(built: Scene, view: MapViewState, frame?: string): StyleSpecification {
  const map = new FakeMap();
  map.setStyle({ sources: built.sources, layers: built.style }, { diff: false });
  map.loadStyle();
  applyMapView(map.map, built, view, frame);
  const style = structuredClone(styleOf(built));
  const layer = (id: unknown) => {
    const found = style.layers.find((item) => item.id === id) as
      | (Record<string, unknown> & {
          paint?: Record<string, unknown>;
          layout?: Record<string, unknown>;
        })
      | undefined;
    if (!found) throw new Error(`The view changes a layer the style has not: ${id}`);
    return found;
  };
  for (const [id, filter] of map.setFilter.mock.calls) {
    if (filter === null || filter === undefined) delete layer(id).filter;
    else layer(id).filter = filter;
  }
  for (const [id, name, value] of map.setPaintProperty.mock.calls)
    layer(id).paint = { ...layer(id).paint, [name as string]: value };
  for (const [id, name, value] of map.setLayoutProperty.mock.calls)
    layer(id).layout = { ...layer(id).layout, [name as string]: value };
  return style;
}

const MARKS = { marker: "star", tag: "4.2%", highlight: true, markerColor: "negative" };

const KINDS: [string, unknown][] = [
  [
    "regions (top level)",
    {
      regions: {
        set: "us-states",
        items: [
          { code: "CA", value: 5.5, ...MARKS },
          { code: "TX", value: -4.1, color: "#ff0000" },
          { code: "DC", value: 1 },
        ],
      },
    },
  ],
  [
    "regions (a layer, by category)",
    {
      layers: [
        {
          id: "blocs",
          kind: "regions",
          opacity: 0.5,
          regions: {
            set: "countries",
            items: [
              { code: "FR", category: "EU", ...MARKS },
              { code: "US", category: "NAFTA" },
            ],
          },
        },
      ],
    },
  ],
  [
    "points (top level: values, sizes, colours, marks)",
    {
      points: [
        { lat: 40, lon: -100, value: 3, size: 2, label: "a", ...MARKS },
        { lat: 41, lon: -101, value: -7, size: 9, color: "#0a0" },
        { lat: 42, lon: -102, marker: 3 },
      ],
    },
  ],
  [
    "points (a layer, by category)",
    {
      layers: [
        {
          id: "sites",
          kind: "points",
          points: spread(40, (at) => ({ category: at % 2 ? "A" : "B", value: at })),
        },
      ],
    },
  ],
  [
    "lines",
    {
      layers: [
        {
          id: "routes",
          kind: "lines",
          shapes: [
            {
              type: "line",
              coordinates: [
                [-100, 40],
                [-90, 30],
              ],
              value: 4,
              ...MARKS,
            },
            {
              type: "line",
              coordinates: [
                [-80, 40],
                [-70, 30],
              ],
              value: 9,
              color: "#00f",
            },
          ],
        },
      ],
    },
  ],
  [
    "areas, flat",
    {
      layers: [
        {
          id: "fields",
          kind: "polygons",
          shapes: [
            { type: "polygon", coordinates: SQUARE(-93.6, 41.6), value: 2, ...MARKS },
            { type: "polygon", coordinates: SQUARE(-93.5, 41.5), category: "corn" },
          ],
        },
      ],
    },
  ],
  [
    "areas that stand (extruded)",
    {
      layers: [
        {
          id: "towers",
          kind: "polygons",
          shapes: [
            {
              type: "polygon",
              coordinates: SQUARE(-93.6, 41.6, 0.001),
              height: 120,
              value: 2,
              ...MARKS,
            },
            { type: "polygon", coordinates: SQUARE(-93.59, 41.6, 0.001), height: 30 },
            { type: "polygon", coordinates: SQUARE(-93.58, 41.6, 0.001) },
          ],
        },
      ],
    },
  ],
  [
    "heat",
    {
      layers: [
        { id: "storms", kind: "heat", points: spread(30, (at) => ({ value: at })) },
      ],
    },
  ],
  [
    "clusters",
    {
      layers: [
        { id: "shops", kind: "clusters", points: spread(30, (at) => ({ value: at })) },
      ],
    },
  ],
  [
    "flows",
    {
      layers: [
        {
          id: "trade",
          kind: "flows",
          flows: [
            { from: [-100, 40], to: [2, 48], value: 5, label: "a", highlight: true },
            { from: { state: "CA" }, to: { country: "JP" }, value: 9, color: "#f0f" },
          ],
        },
      ],
    },
  ],
  [
    "columns on points",
    {
      layers: [
        {
          id: "bars",
          kind: "columns",
          points: spread(12, (at) => ({ value: at + 1, ...(at === 0 ? MARKS : {}) })),
        },
      ],
    },
  ],
  [
    "columns on regions",
    {
      layers: [
        {
          id: "bars",
          kind: "columns",
          regions: {
            set: "us-states",
            items: [
              { code: "CA", value: 5 },
              { code: "TX", value: 9 },
            ],
          },
        },
      ],
    },
  ],
  [
    "arrows (the lines plot.arrows makes: a shaft and a head)",
    {
      layers: [
        {
          id: "wind",
          kind: "lines",
          shapes: [
            {
              type: "line",
              coordinates: [
                [-100, 40],
                [-100, 40.4],
                [-100.1, 40.3],
                [-100, 40.4],
                [-99.9, 40.3],
              ],
              value: 12,
              tag: "12 kt",
            },
          ],
        },
      ],
    },
  ],
  [
    "an image",
    {
      points: [{ lat: 42, lon: -93.7 }],
      layers: [
        {
          id: "overlay",
          kind: "image",
          opacity: 0.6,
          image: {
            mime: "image/png",
            data: PNG,
            corners: [
              [-94, 42.1],
              [-93.5, 42.1],
              [-93.5, 41.9],
              [-94, 41.9],
            ],
          },
        },
      ],
    },
  ],
  [
    "marks of every kind together, on a map that plays",
    {
      frame: "2022",
      points: [
        { lat: 40, lon: -100, value: 3, time: "2021", ...MARKS },
        { lat: 41, lon: -101, value: 5, time: "2022", marker: "ring" },
        { lat: 42, lon: -102, value: 5, marker: 12, markerColor: "#123456" },
      ],
      regions: {
        set: "us-states",
        items: [
          { code: "CA", value: 5.5, time: "2021", ...MARKS },
          { code: "CA", value: 6.5, time: "2022" },
        ],
      },
      layers: [
        {
          id: "trade",
          kind: "flows",
          flows: [
            { from: [-100, 40], to: [-90, 30], value: 5, time: "2021" },
            {
              from: [-100, 40],
              to: [-80, 35],
              value: 7,
              time: "2022",
              highlight: true,
            },
          ],
        },
        {
          id: "shops",
          kind: "clusters",
          points: spread(20, (at) => ({ time: at % 2 ? "2021" : "2022" })),
        },
        {
          id: "storms",
          kind: "heat",
          points: spread(20, (at) => ({ time: at % 2 ? "2021" : "2022", value: at })),
        },
        {
          id: "towers",
          kind: "polygons",
          shapes: [
            {
              type: "polygon",
              coordinates: SQUARE(-93.6, 41.6, 0.001),
              height: 120,
              time: "2021",
              highlight: true,
            },
          ],
        },
      ],
    },
  ],
];

const SOURCES: [string, Parameters<typeof held>[0]][] = [
  ["raster tiles", { kind: "raster-tiles", minzoom: 2, maxzoom: 12, tileSize: 256 }],
  [
    "vector tiles with a fill, a line and a circle",
    {
      kind: "vector-tiles",
      url: "https://data.example/tiles/fields/{z}/{x}/{y}.pbf",
      layers: [
        { sourceLayer: "fields", type: "fill", color: "#00aa00", opacity: 0.5 },
        {
          sourceLayer: "roads",
          type: "line",
          width: 2,
          color: { property: "change", scale: "diverging", domain: [-5, 5] },
        },
        {
          sourceLayer: "wells",
          type: "circle",
          radius: 4,
          color: { property: "depth", scale: "sequential", domain: [0, 100] },
        },
      ],
    },
  ],
  [
    "GeoJSON",
    {
      kind: "geojson",
      url: "https://data.example/fields.geojson",
      layers: [{ type: "fill", color: "#00aa00" }],
    },
  ],
  [
    "one image",
    {
      kind: "image",
      url: "https://data.example/radar.png",
      coordinates: [
        [-94, 42.1],
        [-93.5, 42.1],
        [-93.5, 41.9],
        [-94, 41.9],
      ],
    },
  ],
  [
    "elevation",
    {
      kind: "raster-dem",
      url: "https://data.example/dem/{z}/{x}/{y}.png",
      encoding: "terrarium",
    },
  ],
  ["a file of tiles", { kind: "pmtiles", url: "https://data.example/ndvi.pmtiles" }],
];

beforeEach(() => FakeMap.reset());

describe("the style of a scene is one the map library takes", () => {
  it.each(KINDS)("%s", (_kind, raw) => {
    for (const theme of [MAP_THEMES.light, MAP_THEMES.dark]) {
      const built = scene(raw, { theme });
      expect(built.style.length).toBeGreaterThan(0);
      expect(errorsOf(styleOf(built))).toEqual([]);
    }
  });

  it.each(SOURCES)("a source of a connected backend: %s", (_kind, source) => {
    const built = scene(
      {
        points: [{ lat: 42, lon: -93.7 }],
        layers: [{ id: "green", kind: "source", source: "ndvi", opacity: 0.7 }],
      },
      { held: { sources: [held(source)], ambiguous: [] } },
    );
    expect(Object.keys(built.sources).some((id) => id.includes("green"))).toBe(true);
    expect(errorsOf(styleOf(built))).toEqual([]);
  });

  it("a source of a connected backend as the backdrop of the map", () => {
    const built = scene(
      { points: [{ lat: 42, lon: -93.7 }], basemap: { source: "ndvi" } },
      { held: { sources: [held({ role: "imagery" })], ambiguous: [] } },
    );
    expect(errorsOf(styleOf(built))).toEqual([]);
  });
});

describe("what the view of a reader sets on a style is taken by the map library too", () => {
  const VIEWS: [string, MapViewState, string | undefined][] = [
    ["as the map opens", {}, undefined],
    ["on a step of time", {}, "2021"],
    ["on the other step", { frame: "2022" }, "2022"],
    [
      "with layers off, faded and grouped",
      {
        hidden: ["points", "trade"],
        opacity: { regions: 0.3, shops: 0.5, storms: 0.2, towers: 0.4 },
        grouped: ["points"],
        basemap: { names: false, roads: false, borders: false },
      },
      "2021",
    ],
  ];

  it.each(KINDS)("%s", (_kind, raw) => {
    const built = scene(raw);
    for (const [what, view, frame] of VIEWS)
      expect(errorsOf(viewed(built, view, frame)), what).toEqual([]);
  });
});
