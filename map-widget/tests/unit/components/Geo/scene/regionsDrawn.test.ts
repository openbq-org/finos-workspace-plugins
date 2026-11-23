import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Topology } from "topojson-specification";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RegionShapeSource } from "~/components/Geo/scene/draft";
import { pictureSources } from "~/components/Geo/scene/image";
import { regionSetsOf, registrySource } from "~/components/Geo/useMapData";
import { mapSpec } from "~/lib/geo/mapSpec";
import type { RegionIndexData } from "~/lib/geo/regions/regionTypes";
import { registerRegionIndex } from "~/lib/geo/regions/registry";
import { regionShapesOf } from "~/lib/geo/regions/shapes";
import { featuresOf, ids, scene, sets, states, styleOf } from "./support";

const file = <T>(name: string) =>
  JSON.parse(
    readFileSync(join(process.cwd(), "vendor/geo/regions", name), "utf8"),
  ) as T;

describe("regions of a set that is matched when the map is drawn", () => {
  const provinces: RegionShapeSource = {
    fine: true,
    shapeOf: (id) =>
      id === "X-1"
        ? states.shapeOf("06")
        : id === "X-2"
          ? states.shapeOf("48")
          : undefined,
    resolve: (code, within) =>
      code === "Georgia" && !within?.country
        ? { ambiguous: ["X-1", "X-2"] }
        : code === "Georgia" || code === "One"
          ? { id: "X-1" }
          : code === "Nowhere"
            ? { id: "X-9" }
            : null,
    info: (id) => ({ name: `Province ${id}`, short: id, centre: [1, 2] }),
  };
  const layer = (items: object[], within?: object) => ({
    id: "p",
    kind: "regions",
    regions: { set: "admin1", items, ...(within ? { within } : {}) },
  });
  const draw = (items: object[], within?: object) =>
    scene({ layers: [layer(items, within)] }, { sets: { ...sets, admin1: provinces } });

  it("draws the region a code means, at the place the set has of it", () => {
    const built = draw([{ code: "One", value: 3 }]);
    expect(featuresOf(built, "l:p")).toHaveLength(1);
    expect(built.marks[0]).toMatchObject({
      label: "California",
      at: [1, 2],
      value: 3,
    });
    expect(built.unshaped).toEqual([]);
    expect(built.ambiguous).toEqual([]);
  });

  it("never guesses between two regions: it draws neither and says which they are", () => {
    const built = draw([
      { code: "Georgia", value: 1, time: "1" },
      { code: "Georgia", value: 2, time: "2" },
      { code: "One", value: 3 },
    ]);
    expect(built.ambiguous).toEqual([
      {
        set: "admin1",
        code: "Georgia",
        candidates: ["Province X-1 (X-1)", "Province X-2 (X-2)"],
      },
    ]);
    expect(built.layers[0].count).toBe(1);
    expect(draw([{ code: "Georgia" }], { country: "US" }).ambiguous).toEqual([]);
  });

  it("names a code that matches nothing, and one whose region has no shape", () => {
    const built = draw([{ code: "Atlantis" }, { code: "Nowhere" }, { code: "One" }]);
    expect(built.unshaped).toEqual(["Atlantis", "Province X-9"]);
    expect(built.layers[0].count).toBe(1);
  });

  it("leaves out the lines of the coarse file beside shapes of another scale", () => {
    const built = draw([{ code: "One" }]);
    expect(ids(built)).not.toContain("world-borders");
    expect(ids(built)).toContain("l:p-outline");
    expect(ids(scene({ points: [{ lat: 1, lon: 1 }] }))).toContain("world-borders");
  });

  it("raises columns of such a set the same way", () => {
    const built = scene(
      {
        layers: [
          {
            id: "c",
            kind: "columns",
            regions: {
              set: "admin1",
              items: [{ code: "One", value: 1 }, { code: "Georgia" }],
            },
          },
        ],
      },
      { sets: { admin1: provinces } },
    );
    expect(featuresOf(built, "l:c")).toHaveLength(1);
    expect(built.ambiguous).toHaveLength(1);
  });
});

describe("a set of the registry", () => {
  registerRegionIndex(file<RegionIndexData>("us-cbsa.index.json"));
  registerRegionIndex(file<RegionIndexData>("countries.index.json"));
  const metros = registrySource(
    "us-cbsa",
    [regionShapesOf("us-cbsa", "all", file<Topology>("us-cbsa.json"))],
    true,
  );

  it("matches what the data wrote against the index of the set", () => {
    const match = metros.resolve?.("35620");
    expect(match).toEqual({ id: "35620" });
    expect(metros.shapeOf("35620")?.properties.name).toMatch(/New York/);
    expect(metros.info?.("35620")?.centre?.[0]).toBeLessThan(-70);
    expect(metros.resolve?.("no such metro area")).toBeNull();
  });

  it("draws metro areas by code and by name in a scene", () => {
    const built = scene(
      {
        layers: [
          {
            id: "m",
            kind: "regions",
            regions: {
              set: "us-cbsa",
              items: [
                { code: "35620", value: 1 },
                { code: "Chicago-Naperville-Elgin, IL-IN", value: 2 },
                { code: "not a metro", value: 3 },
              ],
            },
          },
        ],
      },
      { sets: { "us-cbsa": metros } },
    );
    expect(built.layers[0].count).toBe(2);
    expect(built.unshaped).toEqual(["not a metro"]);
  });

  it("reads the countries by the id the reducer gave, at the finer scale", () => {
    const countries = registrySource(
      "countries",
      [regionShapesOf("countries", "all", file<Topology>("countries-50m.json"))],
      false,
    );
    expect(countries.resolve).toBeUndefined();
    const built = scene(
      {
        regions: {
          set: "countries",
          items: [
            { code: "Singapore", value: 1 },
            { code: "FR", value: 2 },
          ],
        },
      },
      { sets: { countries } },
    );
    expect(built.unshaped).toEqual([]);
    expect(built.marks.map((mark) => mark.label)).toEqual(["Singapore", "France"]);
  });

  it("lists the regions of each set of a map, with the place its codes are in", () => {
    const wanted = regionSetsOf(
      mapSpec({
        regions: { set: "us-states", items: [{ code: "CA" }] },
        layers: [
          {
            kind: "regions",
            regions: {
              set: "admin1",
              within: { country: "CA" },
              items: [{ code: "Ontario" }],
            },
          },
          {
            kind: "columns",
            regions: { set: "admin1", items: [{ code: "DE-BY" }] },
          },
          { kind: "points", points: [{ lat: 1, lon: 1 }] },
        ],
      }),
    );
    expect([...wanted.keys()]).toEqual(["us-states", "admin1"]);
    expect(wanted.get("admin1")?.map((block) => block.within)).toEqual([
      { country: "CA" },
      undefined,
    ]);
  });
});

describe("a layer of a picture", () => {
  const data =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const corners = [
    [-94, 42.1],
    [-93.5, 42.1],
    [-93.5, 41.9],
    [-94, 41.9],
  ];
  const built = scene({
    points: [{ lat: 42, lon: -93.7 }],
    regions: { set: "us-states", items: [{ code: "IA", value: 1 }] },
    layers: [
      {
        id: "field",
        name: "Field",
        kind: "image",
        image: { mime: "image/png", data, corners },
      },
    ],
  });
  const own = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  beforeEach(() => {
    if (!own)
      Object.defineProperty(URL, "createObjectURL", {
        value: () => "",
        configurable: true,
        writable: true,
      });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (!own) Reflect.deleteProperty(URL, "createObjectURL");
  });

  it("keeps the ground image under shaded data and points, with no address in the scene", () => {
    const order = ids(built);
    expect(order.indexOf("l:field")).toBeLessThan(order.indexOf("regions"));
    expect(order.indexOf("l:field")).toBeLessThan(order.indexOf("points"));
    expect(styleOf(built, "l:field")).toMatchObject({
      type: "raster",
      source: "l:field",
    });
    expect(built.layers.at(-1)).toMatchObject({
      kind: "image",
      name: "Field",
      count: 0,
      swatch: "raster",
      parts: [{ id: "l:field", opacity: { "raster-opacity": 1 } }],
    });
    expect(Object.keys(built.sources)).not.toContain("l:field");
    expect(built.pictures).toHaveLength(1);
    expect(built.pictures[0].source).toBe("l:field");
    expect(built.bounds?.[0]).toBeLessThanOrEqual(-94);
  });

  it("makes one address of the page for each picture, which the caller gives back", () => {
    const made: Blob[] = [];
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation((blob: Blob | MediaSource) => {
        made.push(blob as Blob);
        return `blob:page/${made.length}`;
      });
    const { sources, urls } = pictureSources([...built.pictures, ...built.pictures]);
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(made[0].type).toBe("image/png");
    expect(made[0].size).toBe(atob(data).length);
    expect(urls).toEqual(["blob:page/1", "blob:page/2"]);
    expect(sources["l:field"]).toEqual({
      type: "image",
      url: "blob:page/2",
      coordinates: corners,
    });
    expect(JSON.stringify([sources, built.style, built.sources])).not.toMatch(
      /https?:/,
    );
  });

  it("leaves out a picture whose bytes cannot be read", () => {
    const { sources, urls } = pictureSources([
      {
        source: "x",
        image: { mime: "image/png", data: "not base64 !", corners } as never,
      },
    ]);
    expect(sources).toEqual({});
    expect(urls).toEqual([]);
  });
});
