import { describe, expect, it } from "vitest";
import "~/lib/geo/mapFile";
import { base64Of } from "~/lib/geo/base64";
import { toGeoJson } from "~/lib/geo/files/export";
import { toKml, toKmz } from "~/lib/geo/files/exportKml";
import type { MapExportOptions } from "~/lib/geo/files/exportModel";
import type { GeoGeometry } from "~/lib/geo/files/types";
import { mapFrames, mapLayers, type ShownLayer } from "~/lib/geo/mapLayers";
import { type DrawnShape, mapShapes, shapeName } from "~/lib/geo/mapShapes";
import { makeMap } from "~/lib/geo/mapSpec";
import type { MapSpec } from "~/lib/geo/mapSpecTypes";
import { random } from "./support";

const FORMATS = ["geojson", "kml", "kmz"] as const;
type Format = (typeof FORMATS)[number];

const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHxcCAr7pzPIAAAAASUVORK5CYII=";

const box = (lon: number, lat: number, side: number) => [
  [
    [lon, lat],
    [lon + side, lat],
    [lon + side, lat + side],
    [lon, lat + side],
    [lon, lat],
  ],
];

const shapeOf: MapExportOptions["shapeOf"] = (_layer, region) => {
  const at = [...region.code].reduce((sum, letter) => sum + letter.charCodeAt(0), 0);
  const lon = -120 + (at % 40);
  return region.code === "CA"
    ? ({
        type: "MultiPolygon",
        coordinates: [box(lon, 30, 4), box(lon + 5, 30, 1)],
      } as GeoGeometry)
    : ({ type: "Polygon", coordinates: box(lon, 40, 2) } as GeoGeometry);
};

interface Kind {
  spec: MapSpec;
  options?: MapExportOptions;
  says?: string[];
}

const drawn: DrawnShape[] = mapShapes([
  {
    id: "s1",
    kind: "point",
    geometry: { type: "Point", coordinates: [2, 47] },
    name: "Meeting point",
    note: "bring the keys",
  },
  {
    id: "s2",
    kind: "line",
    geometry: {
      type: "LineString",
      coordinates: [
        [2.35, 48.85],
        [4.84, 45.76],
      ],
    },
  },
  {
    id: "s3",
    kind: "polygon",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 46],
          [1.5, 46],
          [1, 47.2],
          [0, 46],
        ],
      ],
    },
    name: "Delivery zone",
  },
  {
    id: "s4",
    kind: "rectangle",
    geometry: { type: "Polygon", coordinates: box(3, 49, 1) },
  },
  {
    id: "s5",
    kind: "circle",
    geometry: { type: "Point", coordinates: [4.84, 45.76] },
    radiusKm: 60,
    name: "Around Lyon",
  },
]);

const KINDS: Record<string, Kind> = {
  "points that ask for their building, with a view": {
    spec: makeMap({
      title: "Manhattan landmarks with building outlines",
      layers: [
        {
          kind: "points",
          points: [
            [40.758, -73.9855, "Times Square"],
            [40.7527, -73.9772, "Grand Central Terminal"],
            [40.7484, -73.9857, "Empire State Building"],
          ].map(([lat, lon, name]) => ({
            lat,
            lon,
            label: name,
            tag: name,
            highlight: "building",
            meaning: "Highlighted",
          })),
        },
      ],
      view: { center: [-73.9815, 40.7532], zoom: 15 },
      context: ["buildings"],
      notes: ["The building outlines come from the basemap, not from the data."],
    }),
    says: ["building outlines"],
  },
  "regions by state with values and a legend": {
    spec: makeMap({
      title: "Unemployment by state",
      valueLabel: "Unemployment rate (%)",
      regions: {
        set: "us-states",
        items: [
          {
            code: "CA",
            value: 5.5,
            tag: "CA 5.5%",
            marker: "star",
            label: "California",
          },
          { code: "TX", value: 4.1, tag: "TX 4.1%", label: "Texas" },
          { code: "NY", value: 4, label: "New York" },
        ],
      },
      boundaries: ["us-states"],
      basemap: { choice: "plain" },
    }),
    options: { shapeOf },
    says: ["regions are the areas of their boundaries"],
  },
  "areas that stand, with a hole": {
    spec: makeMap({
      title: "Towers by height",
      pitch: 50,
      layers: [
        {
          kind: "polygons",
          name: "Towers",
          valueLabel: "Height (m)",
          shapes: [
            {
              type: "polygon",
              coordinates: box(-87.636, 41.878, 0.001),
              label: "Willis Tower",
              value: 442,
              height: 442,
              tag: "442 m",
              props: { floors_total: 110, owner: 'A & B <Co> "]]>' },
            },
            {
              type: "polygon",
              coordinates: [
                ...box(-87.6222, 41.8853, 0.001),
                box(-87.622, 41.8855, 0.0004)[0],
              ],
              label: "Aon Center",
              value: 346,
              height: 346,
              color: "#ff00cc",
            },
          ],
        },
      ],
    }),
  },
  flows: {
    spec: makeMap({
      title: "Shipments",
      layers: [
        {
          kind: "flows",
          name: "Routes",
          valueLabel: "Containers",
          flows: [
            {
              from: [-118.24, 34.05],
              to: [139.69, 35.68],
              value: 900,
              label: "LA to Tokyo",
            },
            { from: [-74.01, 40.71], to: [-0.13, 51.51], value: 400, tag: "400" },
          ],
        },
      ],
    }),
    says: ["flows are lines"],
  },
  "a map that plays by year": {
    spec: makeMap({
      title: "Rate by state and year",
      valueLabel: "Rate (%)",
      frame: "2022",
      regions: {
        set: "us-states",
        items: ["2021", "2022", "2023"].flatMap((time, at) => [
          { code: "TX", value: 4 + at, time, label: "Texas" },
          { code: "NY", value: 5 + at, time, label: "New York" },
        ]),
      },
    }),
    options: { shapeOf },
    says: ["regions are the areas of their boundaries"],
  },
  "a map that plays by steps that are no dates": {
    spec: makeMap({
      points: [
        { lat: 1, lon: 2, label: "Depot", time: "Week 1", value: 3 },
        { lat: 1, lon: 2, label: "Depot", time: "Week 2", value: 5 },
      ],
    }),
  },
  "several layers, one hidden, with categories, signs and sizes": {
    spec: makeMap({
      title: "Sites and risks",
      categoryLabel: "Ownership",
      layers: [
        {
          id: "zones",
          kind: "polygons",
          name: "Flood zones",
          valueLabel: "Depth (m)",
          opacity: 0.5,
          shapes: [
            {
              type: "polygon",
              coordinates: box(2.2, 48.8, 0.2),
              label: "Seine basin",
              value: 2.5,
            },
          ],
        },
        {
          id: "roads",
          kind: "lines",
          name: "Roads",
          shapes: [
            {
              type: "line",
              coordinates: [
                [2.2, 48.85],
                [2.35, 48.86],
                [2.5, 48.9],
              ],
              label: "A13",
              color: "#aa3300",
              highlight: true,
            },
          ],
        },
        {
          id: "depots",
          kind: "points",
          name: "Depots",
          valueLabel: "Staff",
          sizeLabel: "Trucks",
          points: [
            {
              lat: 48.85,
              lon: 2.35,
              label: "Paris",
              value: 120,
              size: 30,
              tag: "HQ",
              marker: "star",
              markerColor: "positive",
              meaning: "Head office",
              category: "owned",
            },
            {
              lat: 48.9,
              lon: 2.45,
              label: "Bobigny",
              value: 40,
              size: 10,
              marker: 2,
              category: "leased",
              props: { since: 2019, manager: "Ana", open: true, zip: "007" },
            },
          ],
        },
        {
          id: "old",
          kind: "points",
          name: "Closed sites",
          visible: false,
          points: [{ lat: 48.8, lon: 2.25, label: "Boulogne", tag: "closed 2020" }],
        },
        {
          id: "density",
          kind: "heat",
          name: "Calls",
          points: [{ lat: 48.86, lon: 2.3, value: 4 }],
        },
      ],
    }),
    says: ["a density"],
  },
  "shapes drawn by hand and tags of the reader": {
    spec: makeMap({
      layers: [
        {
          kind: "points",
          name: "Stores",
          points: [
            { lat: 48.85, lon: 2.35, label: "Paris", tag: "Paris" },
            { lat: 45.76, lon: 4.84, label: "Lyon" },
          ],
        },
      ],
    }),
    options: { shapes: drawn, notes: { "p:45.7600,4.8400": "visit in May" } },
    says: ["drawn by hand"],
  },
  "cities credited to GeoNames": {
    spec: makeMap({
      title: "Offices by city",
      valueLabel: "Staff",
      points: [
        { lat: 47.37, lon: 8.54, label: "Zurich", value: 300, tag: "Zurich" },
        { lat: 46.2, lon: 6.14, label: "Geneva", value: 120 },
      ],
      credits: ["geonames"],
    }),
  },
  "points by ZIP code": {
    spec: makeMap({
      title: "Customers by ZIP",
      points: [
        {
          lat: 40.751,
          lon: -73.997,
          label: "Ada",
          tag: "Ada",
          props: { zip: "10001" },
        },
        { lat: 41.886, lon: -87.622, label: "Bo", props: { zip: "60601" } },
        { lat: 42.36, lon: -71.06, label: "Di", props: { zip: "02134" } },
      ],
    }),
  },
  "a map source of a backend among its layers": {
    spec: makeMap({
      title: "Sites over radar",
      layers: [
        { id: "radar", kind: "source", name: "Radar", source: "radar" },
        {
          id: "sites",
          kind: "points",
          name: "Sites",
          points: [{ lat: 1, lon: 2, label: "A" }],
        },
      ],
    }),
    says: ['"Radar" is a map source'],
  },
  "an image laid on the ground": {
    spec: makeMap({
      title: "Survey with a scan",
      points: [{ lat: 46.2, lon: 6.14, label: "Benchmark", tag: "B1" }],
      layers: [
        {
          kind: "image",
          name: "Scan",
          image: {
            mime: "image/png",
            data: TINY_PNG,
            corners: [
              [6.1, 46.25],
              [6.2, 46.25],
              [6.2, 46.15],
              [6.1, 46.15],
            ],
          },
        },
      ],
    }),
  },
};

const written = (kind: Kind, format: Format): string | Uint8Array =>
  format === "geojson"
    ? toGeoJson(kind.spec, kind.options)
    : format === "kml"
      ? toKml(kind.spec, kind.options)
      : toKmz(kind.spec, kind.options);
const bytesOf = (content: string | Uint8Array) =>
  typeof content === "string" ? new TextEncoder().encode(content) : content;

const asFile = (content: string | Uint8Array, format: Format): MapSpec =>
  makeMap({ file: { name: `map.${format}`, data: base64Of(bytesOf(content)) } });
const flat = (content: string | Uint8Array, format: Format): MapSpec =>
  format === "geojson"
    ? makeMap({ geojson: JSON.parse(content as string) })
    : format === "kml"
      ? makeMap({ kml: content })
      : makeMap({ kmz: base64Of(content as Uint8Array) });

interface Row {
  layer: string;
  geometry: "point" | "line" | "area";
  place: string;
  said: Record<string, unknown>;
}

const SAID = [
  "label",
  "tag",
  "value",
  "size",
  "category",
  "marker",
  "markerColor",
  "meaning",
  "highlight",
  "height",
  "color",
  "time",
] as const;

const placeOf = (positions: readonly (readonly number[])[]) =>
  [...new Set(positions.map(([lon, lat]) => `${lon.toFixed(6)},${lat.toFixed(6)}`))]
    .sort()
    .join(" ");
const saidBy = (mark: object, more: Record<string, unknown> = {}) => {
  const from = mark as Record<string, unknown>;
  return {
    ...Object.fromEntries(
      SAID.flatMap((key) => (from[key] === undefined ? [] : [[key, from[key]]])),
    ),
    ...((from.props as object | undefined) ?? {}),
    ...more,
  };
};

const WORDS: Record<string, string> = {
  regions: "Regions",
  points: "Points",
  heat: "Density",
  clusters: "Clusters",
  lines: "Lines",
  polygons: "Areas",
  flows: "Flows",
  columns: "Columns",
  image: "Image",
};
const layerName = (layer: ShownLayer): string =>
  layer.group ?? layer.name ?? WORDS[layer.kind];

function rowsOf(spec: MapSpec): Row[] {
  const rows: Row[] = [];
  for (const layer of mapLayers(spec)) {
    const name = layerName(layer);
    if ("points" in layer)
      for (const point of layer.points ?? [])
        rows.push({
          layer: name,
          geometry: "point",
          place: placeOf([[point.lon, point.lat]]),
          said: saidBy(point),
        });
    if ("shapes" in layer)
      for (const shape of layer.shapes)
        rows.push({
          layer: name,
          geometry: shape.type === "line" ? "line" : "area",
          place: placeOf(
            shape.type === "line" ? shape.coordinates : shape.coordinates.flat(),
          ),
          said: saidBy(shape),
        });
    if (layer.kind === "flows")
      for (const flow of layer.flows)
        rows.push({
          layer: name,
          geometry: "line",
          place: placeOf([flow.from, flow.to]),
          said: saidBy(flow),
        });
  }
  return rows.sort((a, b) =>
    `${a.layer}|${a.geometry}|${a.place}|${JSON.stringify(a.said)}`.localeCompare(
      `${b.layer}|${b.geometry}|${b.place}|${JSON.stringify(b.said)}`,
    ),
  );
}

function expected({ spec, options = {} }: Kind): Row[] {
  const regions: Row[] = [];
  const withAreas: MapSpec = {
    ...spec,
    points: [],
    shapes: [],
    regions: undefined,
    layers: mapLayers(spec).flatMap(({ implicit: _top, ...layer }) => {
      if (layer.kind !== "regions" && !("regions" in layer && layer.regions))
        return [layer];
      const name = layerName(layer as ShownLayer);
      for (const region of layer.regions?.items ?? []) {
        const geometry = options.shapeOf?.(layer as never, region);
        if (!geometry) continue;
        const parts =
          geometry.type === "MultiPolygon"
            ? geometry.coordinates
            : [(geometry as { coordinates: number[][][] }).coordinates];
        const { code: _code, ...mark } = region;
        parts.forEach((rings, at) => {
          const {
            tag: _tag,
            marker: _marker,
            highlight: _h,
            meaning: _m,
            markerColor: _c,
            ...plain
          } = mark as Record<string, unknown>;
          regions.push({
            layer: name,
            geometry: "area",
            place: placeOf(rings.flat()),
            said: saidBy(at === 0 ? mark : plain),
          });
        });
      }
      return [];
    }),
  };
  const all = options.shapes ?? [];
  const byHand: Row[] = all.map((shape) => ({
    layer: "My shapes",
    geometry:
      shape.kind === "point" ? "point" : shape.kind === "line" ? "line" : "area",
    place: "",
    said: { label: shapeName(shape, all), kind: shape.kind },
  }));
  const rows = [...rowsOf(withAreas), ...regions];
  for (const [key, note] of Object.entries(options.notes ?? {})) {
    const [lat, lon] = key.slice(2).split(",").map(Number);
    const row = rows.find((item) => item.place === placeOf([[lon, lat]]));
    if (row) row.said = { tag: note, ...row.said, note };
  }
  return [...rows, ...byHand];
}

const comparable = (rows: Row[], kind: Kind): Row[] =>
  rows.map((row) =>
    row.layer === "My shapes" && kind.options?.shapes
      ? { ...row, place: "", said: { label: row.said.label, kind: row.said.kind } }
      : row,
  );
const sorted = (rows: Row[]) =>
  [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const withoutLayers = (rows: Row[]) => rows.map((row) => ({ ...row, layer: "" }));

describe.each(Object.entries(KINDS))(
  "a map of %s, written and read back",
  (_name, kind) => {
    const { spec } = kind;
    describe.each(FORMATS)("as %s", (format) => {
      const content = written(kind, format);

      it("is accepted as a file, with every mark where it was, what it says, in its layer", () => {
        const back = asFile(content, format);
        expect(sorted(comparable(rowsOf(back), kind))).toEqual(sorted(expected(kind)));
      });

      it("says what the map is: its title, its legends, its credits, what it opens with and its notes", () => {
        const back = asFile(content, format);
        expect(back.title).toBe(spec.title ?? "Map");
        expect(back.credits).toEqual(spec.credits);
        expect(back.categoryLabel).toBe(spec.categoryLabel);
        for (const key of [
          "view",
          "context",
          "boundaries",
          "basemap",
          "pitch",
        ] as const)
          expect(back[key], key).toEqual(spec[key]);
        expect(mapFrames(back)).toEqual(mapFrames(spec));
        expect(back.frame).toBe(spec.frame);
        const legends = (map: MapSpec) =>
          mapLayers(map)
            .flatMap((layer) => [
              layer.valueLabel ?? (layer.implicit ? map.valueLabel : undefined),
              "sizeLabel" in layer ? layer.sizeLabel : undefined,
            ])
            .filter(Boolean)
            .sort();
        expect([...new Set(legends(back))]).toEqual([...new Set(legends(spec))]);
        const switched = (map: MapSpec) =>
          mapLayers(map)
            .filter((layer) => layer.visible === false || layer.opacity !== undefined)
            .map((layer) => [layerName(layer), layer.visible, layer.opacity]);
        expect(switched(back)).toEqual(
          switched(spec).filter(([name]) =>
            mapLayers(back).some((layer) => layerName(layer) === name),
          ),
        );
        const notes = (back.notes ?? []).join(" ");
        for (const note of spec.notes ?? []) expect(notes).toContain(note);
        for (const part of kind.says ?? []) expect(notes).toContain(part);
      });

      it("is accepted under the key of its format, which reads the same marks without their layers", () => {
        const back = flat(content, format);
        if (kind.options?.shapes)
          expect(
            rowsOf(back)
              .map((row) => row.geometry)
              .sort(),
          ).toEqual(
            expected(kind)
              .map((row) => row.geometry)
              .sort(),
          );
        else
          expect(sorted(withoutLayers(rowsOf(back)))).toEqual(
            sorted(withoutLayers(expected(kind))),
          );
        expect(back.title).toBe(spec.title ?? "Map");
        expect(back.credits).toEqual(spec.credits);
        expect(back.view).toEqual(spec.view);
        for (const note of spec.notes ?? [])
          expect((back.notes ?? []).join(" ")).toContain(note);
      });

      it("reads the same again when the map that came back is written again", () => {
        const first = asFile(content, format);
        const again = asFile(
          format === "geojson"
            ? toGeoJson(first)
            : format === "kml"
              ? toKml(first)
              : toKmz(first),
          format,
        );
        expect(sorted(rowsOf(again))).toEqual(sorted(rowsOf(first)));
        expect(again.notes).toEqual(first.notes);
        expect(again.credits).toEqual(first.credits);
      });
    });

    it("keeps its image in a KMZ file, and says so of the two formats that hold none", () => {
      const images = (map: MapSpec) =>
        mapLayers(map).flatMap((layer) =>
          layer.kind === "image" ? [layer.image] : [],
        );
      if (!images(spec).length) return;
      expect(images(asFile(written(kind, "kmz"), "kmz"))).toEqual(images(spec));
      for (const format of ["kml", "geojson"] as const)
        expect((asFile(written(kind, format), format).notes ?? []).join(" ")).toMatch(
          /1 image is not in this file/,
        );
    });
  },
);

describe("random maps within the limits of a map, written and read back", () => {
  const TEXTS = [
    "Depot",
    "Zürich",
    'A & B <Co> "x"',
    "]]> end",
    "名前",
    "O'Hare",
    "tab\tbed",
  ];
  function someMap(next: () => number): MapSpec {
    const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)];
    const maybe = <T>(value: T) => (next() < 0.5 ? value : undefined);
    const lon = () => Math.round((next() * 340 - 170) * 1e6) / 1e6;
    const lat = () => Math.round((next() * 160 - 80) * 1e6) / 1e6;
    const said = (at: number) => ({
      label: maybe(`${pick(TEXTS)} ${at}`),
      tag: maybe(pick(TEXTS)),
      value: maybe(Math.round(next() * 1e4) / 100),
      color: maybe(pick(["#ff00cc", "#00aa33"])),
      category: maybe(pick(["a", "b", "c"])),
      marker: maybe(pick(["pin", "star", "check", 3])),
      markerColor: maybe(pick(["positive", "negative", "#123456"])),
      highlight: maybe(true),
      meaning: maybe("Set apart"),
      props: maybe({
        code: `0${at}`,
        count: at,
        open: at % 2 === 0,
        note2: pick(TEXTS),
      }),
    });
    const layers = Array.from({ length: 1 + Math.floor(next() * 4) }, (_, at) => {
      const kind = pick(["points", "lines", "polygons"] as const);
      const marks = Array.from({ length: 1 + Math.floor(next() * 6) }, (_, mark) =>
        kind === "points"
          ? {
              lat: lat(),
              lon: lon(),
              size: maybe(Math.round(next() * 50)),
              ...said(mark),
            }
          : kind === "lines"
            ? {
                type: "line",
                coordinates: [
                  [lon(), lat()],
                  [lon(), lat()],
                  [lon(), lat()],
                ],
                ...said(mark),
              }
            : {
                type: "polygon",
                coordinates: box(
                  Math.round(lon() / 2),
                  Math.round(lat() / 2),
                  1 + Math.round(next() * 3),
                ),
                height: maybe(10 + Math.round(next() * 90)),
                ...said(mark),
              },
      );
      return {
        kind,
        name: `Layer ${at + 1}`,
        valueLabel: maybe("Amount"),
        visible: next() < 0.2 ? false : undefined,
        ...(kind === "points" ? { points: marks } : { shapes: marks }),
      };
    });
    return makeMap({ title: maybe(`Map ${pick(TEXTS)}`), layers });
  }

  it.each(FORMATS)("reads back every mark of 40 random maps as %s", (format) => {
    const next = random(20261011);
    for (let run = 0; run < 40; run++) {
      const kind: Kind = { spec: someMap(next) };
      const content = written(kind, format);
      const back = asFile(content, format);
      expect(sorted(rowsOf(back)), `map ${run}`).toEqual(sorted(expected(kind)));
      expect(back.title, `map ${run}`).toBe(kind.spec.title ?? "Map");
      expect(
        sorted(withoutLayers(rowsOf(flat(content, format)))),
        `map ${run}, flat`,
      ).toEqual(sorted(withoutLayers(expected(kind))));
    }
  });
});
