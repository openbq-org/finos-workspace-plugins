import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Feature, Geometry } from "geojson";
import type { Topology } from "topojson-specification";
import { describe, expect, it } from "vitest";
import { boundariesOf } from "~/lib/geo/regions/boundaries";
import { buildRegionIndex } from "~/lib/geo/regions/regionIndex";
import {
  REGION_SET_IDS,
  type RegionIndex,
  type RegionIndexData,
  type RegionSetId,
} from "~/lib/geo/regions/regionTypes";
import {
  type RegionShapes,
  regionShapesOf,
  regionShapesOfBoundaries,
} from "~/lib/geo/regions/shapes";
import {
  crossings,
  inGeometry,
  measure,
} from "../../../../../scripts/geo/geometry.mjs";

const VENDOR = join(process.cwd(), "vendor/geo");
const read = <T>(path: string) =>
  JSON.parse(readFileSync(join(VENDOR, path), "utf8")) as T;

const index = (set: RegionSetId): RegionIndex =>
  buildRegionIndex(read<RegionIndexData>(`regions/${set}.index.json`));

const ADMIN1_PARTS = [
  "africa",
  "asia",
  "europe",
  "north-america",
  "south-america",
  "oceania",
];

const FILES: Record<RegionSetId, Record<string, string>> = {
  "us-states": { all: "us-atlas-3.0.1/states-10m.json" },
  "us-counties": { all: "us-atlas-3.0.1/counties-10m.json" },
  countries: { all: "regions/countries-50m.json" },
  "us-cbsa": { all: "regions/us-cbsa.json" },
  "us-cd119": { all: "regions/us-cd119.json" },
  admin1: Object.fromEntries(
    ADMIN1_PARTS.map((part) => [part, `regions/admin1-${part}.json`]),
  ),
};

const shapesOf = (set: RegionSetId, part: string): RegionShapes => {
  const topology = read<Topology>(FILES[set][part]);
  return set === "us-states" || set === "us-counties"
    ? regionShapesOfBoundaries(boundariesOf(set, topology))
    : regionShapesOf(set, part, topology);
};

const inside = ([lon, lat]: [number, number], shape: Feature<Geometry>) =>
  [0, 360, -360].some((turn) => inGeometry([lon + turn, lat], shape.geometry));

describe.each(REGION_SET_IDS)("the files of %s", (set) => {
  const regions = index(set);
  const parts = Object.keys(FILES[set]).map((part) => shapesOf(set, part));

  it("has a shape file for each part its index lists", () => {
    expect(regions.parts.map((part) => part.id)).toEqual(Object.keys(FILES[set]));
  });

  it("has one shape for each region of the index that has a point, in the part the index says", () => {
    const drawn = new Map<string, string>();
    for (const part of parts)
      for (const shape of part.shapes.features) {
        expect(drawn.has(shape.properties.code), shape.properties.code).toBe(false);
        drawn.set(shape.properties.code, part.part);
      }
    const placed = regions.ids().filter((id) => regions.get(id)?.centroid);
    expect([...drawn.keys()].sort()).toEqual(placed.sort());
    for (const id of placed) expect(drawn.get(id), id).toBe(regions.get(id)?.part);
  });

  it("puts the point of each region inside its shape and inside its box", () => {
    for (const part of parts)
      for (const shape of part.shapes.features) {
        const info = regions.get(shape.properties.code);
        const [lon, lat] = info?.centroid ?? [0, 0];
        const [west, south, east, north] = info?.bounds ?? [0, 0, 0, 0];
        if (shape.properties.code !== "51610")
          expect(inside([lon, lat], shape), shape.properties.code).toBe(true);
        expect(lat).toBeGreaterThanOrEqual(south);
        expect(lat).toBeLessThanOrEqual(north);
        expect(
          [0, 360, -360].some((turn) => lon + turn >= west && lon + turn <= east),
          shape.properties.code,
        ).toBe(true);
        if (shape.properties.code !== "010")
          expect(east - west, shape.properties.code).toBeLessThan(180);
        const view = info?.viewBounds ?? [0, 0, 0, 0];
        expect(view[2] - view[0]).toBeLessThanOrEqual(east - west);
      }
  });

  it("names each shape as the index does, but for two territories of us-atlas", () => {
    const longer: Partial<Record<RegionSetId, Record<string, string>>> = {
      "us-states": {
        "69": "Commonwealth of the Northern Mariana Islands",
        "78": "United States Virgin Islands",
      },
    };
    const named: Record<string, string> = {};
    for (const part of parts)
      for (const { properties } of part.shapes.features)
        if (properties.name !== regions.get(properties.code)?.name)
          named[properties.code] = properties.name;
    expect(named).toEqual(longer[set] ?? {});
  });
});

describe("the simplified boundary files", () => {
  const files = [
    "countries-50m",
    "us-cbsa",
    "us-cd119",
    ...ADMIN1_PARTS.map((part) => `admin1-${part}`),
  ];

  it.each(files)(
    "%s: no line crosses another, and neighbours share their border",
    (file) => {
      const topology = read<Topology>(`regions/${file}.json`);
      expect(crossings(topology)).toBe(0);
      const counts = measure(topology, "regions");
      expect(counts.sharedArcs).toBeGreaterThan(counts.regions / 4);
      expect(topology.transform).toEqual({
        scale: [expect.any(Number), expect.any(Number)],
        translate: [-180, -90],
      });
    },
  );

  it("keeps the detail it was built for", () => {
    const positions = (file: string) =>
      measure(read<Topology>(`regions/${file}.json`), "regions").positions;
    expect(positions("countries-50m")).toBeGreaterThan(50_000);
    expect(positions("us-cbsa")).toBeGreaterThan(40_000);
    expect(positions("us-cd119")).toBeGreaterThan(50_000);
    const world = ADMIN1_PARTS.reduce(
      (total, part) => total + positions(`admin1-${part}`),
      0,
    );
    expect(world).toBeGreaterThan(300_000);
    expect(world).toBeLessThan(500_000);
  });

  const segments = (file: string) => {
    const topology = read<Topology>(`regions/${file}.json`);
    const found = new Set<string>();
    for (const arc of topology.arcs) {
      let x = 0;
      let y = 0;
      let before = "";
      for (const [dx, dy] of arc) {
        x += dx;
        y += dy;
        const here = `${x},${y}`;
        if (before)
          found.add(before < here ? `${before} ${here}` : `${here} ${before}`);
        before = here;
      }
    }
    return found;
  };

  it.each([
    ["europe", "asia"],
    ["africa", "asia"],
    ["north-america", "south-america"],
  ])(
    "draws the border between %s and %s with the same positions in both files",
    (a, b) => {
      const other = segments(`admin1-${b}`);
      let same = 0;
      for (const segment of segments(`admin1-${a}`)) if (other.has(segment)) same++;
      expect(same).toBeGreaterThan(a === "europe" ? 200 : 10);
    },
  );

  it("draws a first-level region that is made of smaller ones", () => {
    const europe = shapesOf("admin1", "europe");
    for (const id of ["GB-ENG", "FR-IDF", "IT-25", "ES-CT", "BE-VLG", "FR-75", "IT-MI"])
      expect(europe.shapeOf(id)?.properties.code, id).toBe(id);
    expect(europe.borders.geometry.coordinates.length).toBeGreaterThan(1000);
    expect(europe.shapeOf("US-CA")).toBeUndefined();
  });
});

describe("the United States outside the contiguous states", () => {
  it("lists Alaska, Hawaii and the territories of each US set", () => {
    const states = index("us-states");
    expect(states.ids().filter(states.outsideContiguous).sort()).toEqual([
      "02",
      "15",
      "60",
      "66",
      "69",
      "72",
      "78",
    ]);
    const counties = index("us-counties");
    expect(counties.outsideContiguous("02020")).toBe(true);
    expect(counties.outsideContiguous("15003")).toBe(true);
    expect(counties.outsideContiguous("72127")).toBe(true);
    expect(counties.outsideContiguous("06037")).toBe(false);
    const districts = index("us-cd119");
    expect(districts.ids().filter(districts.outsideContiguous).sort()).toEqual([
      "AK-AL",
      "AS-AL",
      "GU-AL",
      "HI-01",
      "HI-02",
      "MP-AL",
      "PR-AL",
      "VI-AL",
    ]);
    const metros = index("us-cbsa");
    expect(metros.outsideContiguous("11260")).toBe(true);
    expect(metros.outsideContiguous("46520")).toBe(true);
    expect(metros.outsideContiguous("41980")).toBe(true);
    expect(metros.outsideContiguous("35620")).toBe(false);
  });

  it.each(["us-states", "us-counties", "us-cbsa", "us-cd119"] as const)(
    "%s: has the box of the contiguous states, and Alaska as one box west of them",
    (set) => {
      const regions = index(set);
      const [west, south, east, north] = regions.contiguousBounds ?? [0, 0, 0, 0];
      expect(west).toBeGreaterThan(-125);
      expect(east).toBeLessThan(-66);
      expect(south).toBeGreaterThan(24);
      expect(north).toBeLessThan(50);
      const alaska = {
        "us-states": "02",
        "us-counties": "02016",
        "us-cbsa": "11260",
        "us-cd119": "AK-AL",
      }[set];
      const box = regions.get(alaska)?.bounds ?? [0, 0, 0, 0];
      expect(box[2]).toBeLessThan(-129);
      expect(box[2] - box[0]).toBeLessThan(60);
    },
  );

  it("counts the 119th Congress: 435 districts, the delegates and the commissioner", () => {
    const districts = index("us-cd119");
    const large = districts.ids().filter((id) => id.endsWith("-AL"));
    expect(districts.size).toBe(441);
    expect(large.sort()).toEqual(
      ["AK", "AS", "DC", "DE", "GU", "MP", "ND", "PR", "SD", "VI", "VT", "WY"].map(
        (state) => `${state}-AL`,
      ),
    );
    expect(districts.get("CA-12")?.short).toBe("0612");
  });
});
