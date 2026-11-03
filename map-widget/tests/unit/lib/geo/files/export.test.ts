import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseGeoFile } from "~/lib/geo/files";
import { exportFileName, toGeoJson } from "~/lib/geo/files/export";
import { escaped, STYLE_LIMIT, toKml, toKmz } from "~/lib/geo/files/exportKml";
import type { GeoFeature, GeoFileResult, GeoGeometry } from "~/lib/geo/files/types";
import { mapShapes } from "~/lib/geo/mapShapes";
import { makeMap, mapSpec } from "~/lib/geo/mapSpec";
import { shapeMeasure } from "~/lib/geo/measure";
import { cpuBudget, cpuNow } from "../../../machinePace";

const bytes = (content: string | Uint8Array) =>
  typeof content === "string" ? new TextEncoder().encode(content) : content;
const read = (content: string | Uint8Array, name: string): GeoFileResult => {
  const outcome = parseGeoFile(bytes(content), { name });
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.file;
};
const formats = (spec: ReturnType<typeof mapSpec>, options = {}) =>
  [
    ["geojson", read(toGeoJson(spec, options), "map.geojson")],
    ["kml", read(toKml(spec, options), "map.kml")],
    ["kmz", read(toKmz(spec, options), "map.kmz")],
  ] as const;
const layerOf = (file: GeoFileResult, feature: GeoFeature) =>
  feature.group === undefined
    ? feature.properties.layer
    : file.groups[feature.group]?.name;
const positions = (geometry: GeoGeometry): number[][] => {
  const flat: number[][] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value) && typeof value[0] === "number")
      flat.push(value as number[]);
    else if (Array.isArray(value)) value.forEach(walk);
  };
  walk(geometry.coordinates);
  return flat;
};

const offices = mapSpec({
  title: "Offices",
  valueLabel: "Staff",
  points: [
    {
      lat: 41.8781,
      lon: -87.6298,
      label: "Chicago",
      value: 900,
      tag: "HQ",
      props: { region: "Americas", since: 2001 },
    },
    { lat: 51.5072, lon: -0.1276, label: "London", value: 300, marker: "star" },
    { lat: 22.3193, lon: 114.1694, label: "Hong Kong", value: 120 },
  ],
});

describe("a map of points, written and read back", () => {
  it.each(["geojson", "kml", "kmz"] as const)(
    "has the same points, names, values and other values as %s",
    (format) => {
      const file = Object.fromEntries(formats(offices))[format];
      expect(file.features).toHaveLength(3);
      const [chicago, london] = file.features;
      expect(chicago.geometry.type).toBe("Point");
      expect(positions(chicago.geometry)[0][0]).toBeCloseTo(-87.6298, 6);
      expect(positions(chicago.geometry)[0][1]).toBeCloseTo(41.8781, 6);
      expect(chicago.name ?? chicago.properties.name).toBe("Chicago");
      expect(chicago.properties).toMatchObject({
        value: 900,
        tag: "HQ",
        region: "Americas",
        since: 2001,
      });
      expect(london.properties).toMatchObject({ value: 300, marker: "star" });
      expect(layerOf(file, chicago)).toBe("Points");
    },
  );

  it("writes a description a KML reader shows as text: a value of a row is never markup there", () => {
    const hostile = '<img src="https://attacker.example/p.gif"> a < b & c';
    const kml = toKml(
      mapSpec({
        title: hostile,
        points: [{ lat: 1, lon: 2, label: "Depot", props: { owner: hostile } }],
        note: hostile,
      }),
    );
    const descriptions = [
      ...new DOMParser()
        .parseFromString(kml, "application/xml")
        .getElementsByTagName("description"),
    ].map((node) => node.textContent ?? "");
    expect(descriptions.length).toBeGreaterThan(0);
    expect(
      descriptions.filter((text) => text.includes("attacker.example")),
    ).not.toEqual([]);
    for (const text of descriptions) expect(text).not.toContain("<");
    expect(read(kml, "map.kml").features[0].description).toContain(hostile);
  });

  it("writes a coordinate next to zero as decimals: KML has no exponent form", () => {
    const kml = toKml(
      mapSpec({ points: [{ lat: -0.0000004, lon: 0.0000004, label: "Null Island" }] }),
    );
    expect(kml).toContain("<coordinates>0.0000004,-0.0000004</coordinates>");
    expect(
      toKml(mapSpec({ points: [{ lat: -0.00000001, lon: 12.5, label: "Equator" }] })),
    ).toContain("<coordinates>12.5,0</coordinates>");
  });

  it("says what the values are, and the note of the reader, in the description of a placemark", () => {
    const kml = toKml(offices, { notes: { "p:41.8781,-87.6298": "visit in May" } });
    const [chicago] = read(kml, "map.kml").features;
    expect(kml).toContain(
      "<description>layer: Points\nStaff: 900\ntag: HQ\nnote: visit in May\nregion: Americas\nsince: 2001</description>",
    );
    expect(chicago.description).toBeUndefined();
    expect(chicago.properties.note).toBe("visit in May");
  });

  it("colours a placemark by its value, in a few shared styles", () => {
    const kml = toKml(offices);
    expect(kml).toContain(
      '<Style id="s0"><IconStyle><color>ff9c5108</color></IconStyle>',
    );
    expect(kml.match(/<Style /g)).toHaveLength(3);
    const [chicago, , hongKong] = read(kml, "map.kml").features;
    expect(chicago.style?.color).toBe("#08519c");
    expect(hongKong.style?.color).toBe("#c6dbef");
    const many = mapSpec({
      points: Array.from({ length: 200 }, (_, at) => ({
        lat: 10,
        lon: at / 10,
        color: `#${(at * 4099).toString(16).padStart(6, "0").slice(0, 6)}`,
      })),
    });
    expect(toKml(many).match(/<Style /g)).toHaveLength(STYLE_LIMIT);
  });
});

describe("layers, flows, time and regions", () => {
  const layered = mapSpec({
    title: "Corn",
    layers: [
      {
        kind: "polygons",
        name: "Fields",
        shapes: [
          {
            type: "polygon",
            coordinates: [
              [
                [-93.7, 42],
                [-93.6, 42],
                [-93.6, 42.1],
                [-93.7, 42],
              ],
            ],
            label: "North field",
            category: "corn",
          },
        ],
      },
      {
        kind: "flows",
        name: "Shipments",
        flows: [
          { from: [-93.6, 42], to: [-90.07, 29.95], label: "IA to LA", value: 420 },
        ],
      },
      {
        kind: "points",
        name: "Elevators",
        points: [
          { lat: 42.03, lon: -93.62, label: "Ames", value: 2, time: "2024" },
          { lat: 42.03, lon: -93.62, label: "Ames", value: 3, time: "2025" },
        ],
      },
      { kind: "source", source: "ndvi", name: "NDVI" },
    ],
  });

  it.each(["geojson", "kml", "kmz"] as const)(
    "keeps each mark in its layer, a flow as a line and a step of time, as %s",
    (format) => {
      const file = Object.fromEntries(formats(layered))[format];
      expect(file.features.map((feature) => layerOf(file, feature))).toEqual([
        "Fields",
        "Shipments",
        "Elevators",
        "Elevators",
      ]);
      const [field, flow, first, second] = file.features;
      expect(field.geometry.type).toMatch(/Polygon$/);
      expect(positions(field.geometry)).toHaveLength(4);
      expect(field.properties.category).toBe("corn");
      expect(flow.geometry.type).toMatch(/LineString$/);
      expect(positions(flow.geometry)).toEqual([
        [-93.6, 42],
        [-90.07, 29.95],
      ]);
      expect(flow.properties.value).toBe(420);
      expect([String(first.properties.time), String(second.properties.time)]).toEqual([
        "2024",
        "2025",
      ]);
    },
  );

  it("writes a step of time that is a date as a TimeStamp, and any other as a value", () => {
    expect(toKml(layered)).toContain("<TimeStamp><when>2024</when></TimeStamp>");
    const quarters = mapSpec({ points: [{ lat: 1, lon: 2, time: "Q1 2024" }] });
    const kml = toKml(quarters);
    expect(kml).not.toContain("<TimeStamp>");
    expect(kml).toContain('<Data name="time"><value>Q1 2024</value></Data>');
  });

  it("leaves a map source of a backend out, and says so in the file", () => {
    const note =
      'The layer "NDVI" is a map source of a connected backend and is not in this file.';
    expect(toKml(layered)).toContain(`<description>${escaped(note)}`);
    expect(JSON.parse(toGeoJson(layered)).description).toContain(note);
    expect(JSON.parse(toGeoJson(layered)).map.notes).toContain(note);
    expect(toKml(layered)).not.toContain("ndvi");
  });

  it("writes a region as the shape of its boundary, with its value, and counts one without a shape", () => {
    const states = mapSpec({
      valueLabel: "Rate",
      regions: {
        set: "us-states",
        items: [
          { code: "CA", value: 5.5, label: "California" },
          { code: "TX", value: 4.1 },
        ],
      },
    });
    const square: GeoGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [-124, 32],
          [-114, 32],
          [-114, 42],
          [-124, 32],
        ],
      ],
    };
    const options = {
      shapeOf: (_layer: unknown, region: { code: string }) =>
        region.code === "06" ? square : undefined,
    };
    for (const [format, file] of formats(states, options)) {
      expect(file.features, format).toHaveLength(1);
      expect(file.features[0].geometry.type, format).toMatch(/Polygon$/);
      expect(positions(file.features[0].geometry), format).toHaveLength(4);
      expect(file.features[0].properties.value, format).toBe(5.5);
    }
    expect(JSON.parse(toGeoJson(states, options)).description).toContain(
      "1 region has no boundary shape here and is not in this file.",
    );
    const named = { ...options, nameOf: () => "California" };
    for (const [format, file] of formats(states, named)) {
      const [feature] = file.features;
      expect(feature.name ?? feature.properties.name, format).toBe("California");
    }
    const labelled = mapSpec({
      regions: {
        set: "us-states",
        items: [{ code: "CA", value: 1, label: "Golden State" }],
      },
    });
    for (const [format, file] of formats(labelled, named)) {
      const [feature] = file.features;
      expect(feature.name ?? feature.properties.name, format).toBe("Golden State");
    }
    expect(JSON.parse(toGeoJson(states)).features).toEqual([]);
    expect(JSON.parse(toGeoJson(states)).description).toContain(
      "2 regions have no boundary shape here",
    );
  });
});

const DRAWN = [
  {
    id: "zone",
    kind: "polygon",
    name: "Delivery <zone> & more",
    note: "Mondays ]]> only",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [0, 2],
          [2, 2],
          [2, 0],
          [0, 0],
        ],
      ],
    },
  },
  {
    id: "reach",
    kind: "circle",
    geometry: { type: "Point", coordinates: [179.5, -17] },
    radiusKm: 300,
  },
  {
    id: "depot",
    kind: "point",
    name: "Depot",
    geometry: { type: "Point", coordinates: [2.35, 48.85] },
  },
  {
    id: "route",
    kind: "line",
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 0],
        [1, 1],
        [2, 0],
      ],
    },
  },
];

describe("the shapes a reader drew, in a file", () => {
  const shapes = mapShapes(DRAWN);

  it("are a layer of their own, each with its name, its kind and its note, and read back as the same geometry", () => {
    for (const [format, file] of formats(offices, { shapes })) {
      const mine = file.features.filter(
        (feature) => layerOf(file, feature) === "My shapes",
      );
      expect(
        mine.map((feature) => feature.name),
        format,
      ).toEqual(["Delivery <zone> & more", "Circle 1", "Depot", "Line 1"]);
      expect(
        mine.map((feature) => feature.geometry.type),
        format,
      ).toEqual(["Polygon", "Polygon", "Point", "LineString"]);
      expect(mine[0].properties, format).toMatchObject({
        kind: "polygon",
        note: "Mondays ]]> only",
      });
      expect(mine[1].properties, format).toMatchObject({
        kind: "circle",
        radius_km: 300,
      });
      const measures = shapes.map(shapeMeasure);
      expect(Number(mine[0].properties.area_km2), format).toBeCloseTo(
        measures[0].areaKm2 ?? 0,
        3,
      );
      expect(Number(mine[0].properties.perimeter_km), format).toBeCloseTo(
        measures[0].roundKm ?? 0,
        3,
      );
      expect(Number(mine[1].properties.area_km2), format).toBeCloseTo(
        measures[1].areaKm2 ?? 0,
        3,
      );
      expect(Number(mine[3].properties.length_km), format).toBeCloseTo(
        measures[3].lengthKm ?? 0,
        3,
      );
      expect(measures[0].areaKm2).toBeGreaterThan(49_000);
      expect(measures[3].lengthKm).toBeCloseTo(314.5, 0);
      expect(mine[2].properties, format).not.toHaveProperty("length_km");
      expect(file.features).toHaveLength(offices.points.length + shapes.length);
      for (const [lon] of mine.flatMap((feature) => positions(feature.geometry)))
        expect(Math.abs(lon), format).toBeLessThanOrEqual(180);
    }
  });

  it("writes a name and a note as text of the file, and says that a shape over the 180th meridian was folded", () => {
    const kml = toKml(offices, { shapes });
    expect(kml).toContain("<name>Delivery &lt;zone&gt; &amp; more</name>");
    expect(kml).not.toContain("<zone>");
    expect(kml).toContain("Mondays ]]&gt; only");
    expect(kml).toContain(
      "1 drawn shape crosses the 180th meridian: its longitudes are written between -180 and 180.",
    );
    expect(toKml(offices, { shapes: [] })).toBe(toKml(offices));
  });
});

describe("text of a map in a file", () => {
  const HOSTILE = [
    "]]><script>alert(1)</script>",
    "Tom & Jerry <b>bold</b>",
    '" onload="x',
    "</name></Placemark><Placemark><name>forged",
    "<![CDATA[ x ]]>",
    "&lt;already&gt; &amp;",
  ];

  it("is the characters of a name, never markup", () => {
    const spec = mapSpec({
      title: HOSTILE[0],
      points: HOSTILE.map((label, at) => ({
        lat: at,
        lon: at,
        label,
        tag: label,
        props: { [`k${at}`]: label },
      })),
    });
    const kml = toKml(spec);
    expect(kml).not.toContain("<script>");
    expect(kml).not.toContain("<b>");
    expect(kml).not.toContain("]]>");
    for (const [format, file] of formats(spec)) {
      expect(file.features, format).toHaveLength(HOSTILE.length);
      file.features.forEach((feature, at) => {
        expect(feature.name ?? feature.properties.name, format).toBe(HOSTILE[at]);
        expect(feature.properties[`k${at}`], format).toBe(HOSTILE[at]);
      });
    }
  });

  it("drops what XML does not allow and keeps the rest of the text", () => {
    expect(escaped("a\u0000b\u0008c\u000bd￾e\ud800f")).toBe("abcdef");
    expect(escaped("tab\tline\nfeed \u{1f600}")).toBe("tab\tline\nfeed \u{1f600}");
    expect(escaped("‮evil‬")).toBe("‮evil‬");
    expect(escaped(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&apos;");
  });

  it("writes no address: only the name of the format, the id of a style and a path inside the archive", () => {
    const kml = toKml(offices);
    const addresses = kml.match(/[a-z][a-z0-9+.-]*:\/\/[^"<\s]*/gi) ?? [];
    expect(addresses).toEqual(["http://www.opengis.net/kml/2.2"]);
    expect(toGeoJson(offices)).not.toMatch(/:\/\//);
  });
});

describe("the images of a map", () => {
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const withImage = mapSpec({
    title: "Overlay",
    points: [{ lat: 42.05, lon: -93.65, label: "Tower" }],
    layers: [
      {
        kind: "image",
        name: "Scan",
        image: {
          mime: "image/png",
          data: png,
          corners: [
            [-93.7, 42.1],
            [-93.6, 42.1],
            [-93.6, 42],
            [-93.7, 42],
          ],
        },
      },
    ],
  });

  it("are in a KMZ, beside the document, and laid on the same corners when it is read", () => {
    const archive = toKmz(withImage);
    const entries = unzipSync(archive);
    expect(Object.keys(entries).sort()).toEqual(["doc.kml", "files/overlay-1.png"]);
    expect(strFromU8(entries["doc.kml"])).toContain(
      "<Icon><href>files/overlay-1.png</href></Icon>",
    );
    const file = read(archive, "map.kmz");
    expect(file.features).toHaveLength(1);
    expect(file.overlays).toHaveLength(1);
    expect(file.overlays[0].name).toBe("Scan");
    expect(file.overlays[0].corners).toEqual([
      [-93.7, 42.1],
      [-93.6, 42.1],
      [-93.6, 42],
      [-93.7, 42],
    ]);
    expect(file.overlays[0].image.mime).toBe("image/png");
  });

  it("are left out of KML and GeoJSON, which say so", () => {
    expect(toKml(withImage)).toContain(
      "1 image is not in this file: a KML file holds no image. A KMZ file holds them.",
    );
    expect(toKml(withImage)).not.toContain("GroundOverlay");
    expect(JSON.parse(toGeoJson(withImage)).description).toContain(
      "1 image is not in this file: GeoJSON holds no image.",
    );
  });
});

describe("the name of an exported file", () => {
  it.each([
    ["Offices of Balyasny (unverified)", "kml", "Offices-of-Balyasny-unverified.kml"],
    ["../../etc/passwd", "kmz", "etc-passwd.kmz"],
    ['a/b\\c:d*e?f"g<h>i|j', "geojson", "a-b-c-d-e-f-g-h-i-j.geojson"],
    ["  ", "kml", "map.kml"],
    [undefined, "geojson", "map.geojson"],
    ["x".repeat(300), "kml", `${"x".repeat(80)}.kml`],
    ["Zürich ‮offices", "kml", "Zurich-offices.kml"],
  ] as const)("of %s as %s is %s", (name, format, file) => {
    expect(exportFileName(name, format)).toBe(file);
  });
});

describe("the size of an exported file", () => {
  it("writes the most points a map has in a moment", () => {
    const spec = mapSpec({
      points: Array.from({ length: 20_000 }, (_, at) => ({
        lat: (at % 170) - 85,
        lon: (at % 350) - 175,
        label: `P${at}`,
        value: at,
      })),
    });
    const started = cpuNow();
    const kml = toKml(spec);
    const geojson = toGeoJson(spec);
    const kmz = toKmz(spec);
    expect(cpuNow() - started).toBeLessThan(cpuBudget(5_000));
    expect(kml.length).toBeLessThan(8_000_000);
    expect(geojson.length).toBeLessThan(4_000_000);
    expect(kmz.length).toBeLessThan(1_000_000);
    expect(read(kmz, "map.kmz").features).toHaveLength(20_000);
  });
});

describe("whose data an exported file holds", () => {
  const byCity = mapSpec({
    title: "Offices",
    points: [{ lat: 41.85, lon: -87.65, label: "Chicago" }],
    credits: ["geonames"],
  });

  it("says in every format that the places of the cities are from GeoNames, as their licence asks", () => {
    const geojson = JSON.parse(toGeoJson(byCity));
    expect(geojson.attribution).toBe(
      "Cities are placed by their name: GeoNames (https://www.geonames.org), CC BY 4.0.",
    );
    expect(geojson.description).toContain("GeoNames");
    for (const kml of [toKml(byCity), strFromU8(unzipSync(toKmz(byCity))["doc.kml"])]) {
      expect(kml).toMatch(
        /<Document><name>Offices<\/name><description>[^<]*GeoNames \(https:\/\/www\.geonames\.org\), CC BY 4\.0\.[^<]*<\/description>/,
      );
    }
    for (const [, file] of formats(byCity)) expect(file.features).toHaveLength(1);
  });

  it("says nothing of it in the file of a map that places by no city", () => {
    expect(toGeoJson(offices)).not.toContain("GeoNames");
    expect(toKml(offices)).not.toContain("GeoNames");
  });
});

describe("what a bubble and a marked place say in a file", () => {
  const bubbles = mapSpec({
    title: "Revenue",
    sizeLabel: "Revenue (USD m)",
    points: [
      {
        lat: 41.88,
        lon: -87.63,
        label: "Chicago",
        size: 9,
        marker: "star",
        markerColor: "positive",
        meaning: "Opened this year",
      },
      { lat: 51.5, lon: -0.12, label: "London", size: 3 },
    ],
  });

  it("keeps the size of a point and what the sizes are, the meaning of a sign and its tone", () => {
    const [chicago, london] = JSON.parse(toGeoJson(bubbles)).features;
    expect(chicago.properties).toMatchObject({
      size: 9,
      sizeLabel: "Revenue (USD m)",
      marker: "star",
      markerColor: "positive",
      meaning: "Opened this year",
    });
    expect(london.properties.size).toBe(3);
    expect(london.properties).not.toHaveProperty("meaning");
    const kml = toKml(bubbles);
    expect(kml).toContain('<Data name="size"><value>9</value></Data>');
    expect(kml).toContain("Revenue (USD m): 9");
    expect(kml).toContain(
      '<Data name="meaning"><value>Opened this year</value></Data>',
    );
  });

  it("gives the sizes back to a map that reads the file again", () => {
    const again = makeMap({ geojson: JSON.parse(toGeoJson(bubbles)) });
    expect(again.points?.map(({ size }) => size)).toEqual([9, 3]);
  });
});

describe("the rings of an area in a file", () => {
  const open = mapSpec({
    shapes: [
      {
        type: "polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
          ],
          [
            [0.5, 0.2],
            [0.8, 0.2],
            [0.8, 0.5],
            [0.5, 0.2],
          ],
        ],
      },
    ],
  });

  it("end where they start in GeoJSON, as RFC 7946 asks, and a closed ring is not closed twice", () => {
    const [outline, hole] = JSON.parse(toGeoJson(open)).features[0].geometry
      .coordinates;
    expect(outline).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ]);
    expect(hole).toHaveLength(4);
  });

  it("end where they start in KML and KMZ, where a LinearRing is closed", () => {
    for (const kml of [toKml(open), strFromU8(unzipSync(toKmz(open))["doc.kml"])]) {
      expect(kml).toContain(
        "<outerBoundaryIs><LinearRing><coordinates>0,0 1,0 1,1 0,0</coordinates>",
      );
      expect(kml).toContain(
        "<innerBoundaryIs><LinearRing><coordinates>0.5,0.2 0.8,0.5 0.8,0.2 0.5,0.2</coordinates>",
      );
    }
    for (const [, file] of formats(open)) expect(file.features).toHaveLength(1);
  });
});

describe("a map whose points are drawn with the building of the basemap under them", () => {
  const offices = makeMap({
    title: "Offices",
    points: [
      { lat: 40.7527, lon: -73.9772, label: "HQ", highlight: "building" },
      { lat: 40.7, lon: -74.01, label: "Depot" },
    ],
  });

  it("is exported as its points, and the file says that the outlines are not in it", () => {
    const file = JSON.parse(toGeoJson(offices));
    expect(file.features.map((feature: GeoFeature) => feature.geometry.type)).toEqual([
      "Point",
      "Point",
    ]);
    expect(file.description).toBe(
      "The building outlines of this map are drawn from the basemap (OpenStreetMap) and are not in this file: it holds the points.",
    );
    expect(toKml(offices)).toContain("are not in this file: it holds the points.");
    expect(toKml(offices)).not.toContain("<Polygon>");
  });

  it("says nothing of buildings for a map that asks for none", () => {
    const plain = makeMap({ points: [{ lat: 40.7, lon: -74.01, label: "Depot" }] });
    expect(JSON.parse(toGeoJson(plain)).description).toBeUndefined();
  });
});
