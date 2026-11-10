import { describe, expect, it } from "vitest";
import "~/lib/geo/mapFile";
import { MAP_MEMBER_CHARS, memberOf } from "~/lib/geo/files/convention";
import { conventionMark, fileAsks } from "~/lib/geo/mapFileConvention";
import { makeMap } from "~/lib/geo/mapSpec";

const collection = (properties: object, more: object = {}) => ({
  type: "FeatureCollection",
  ...more,
  features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [2, 1] }, properties },
  ],
});
const asFile = (value: object) =>
  makeMap({ file: { name: "map.geojson", text: JSON.stringify(value) } });

describe("what a feature says of its mark", () => {
  it("is read from any file that has the names: a tag, a sign with its tone and meaning, a highlight, a size, a colour", () => {
    const spec = asFile(
      collection({
        name: "Depot",
        tag: "HQ",
        marker: "star",
        markerColor: "positive",
        meaning: "Head office",
        highlight: "building",
        size: 12,
        color: "#FF00CC",
        value: 7,
        staff: 40,
      }),
    );
    expect(spec.points).toEqual([
      {
        lat: 1,
        lon: 2,
        label: "Depot",
        tag: "HQ",
        value: 7,
        color: "#ff00cc",
        props: { staff: 40 },
        marker: "star",
        markerColor: "positive",
        highlight: "building",
        meaning: "Head office",
        size: 12,
      },
    ]);
  });

  it("leaves a value that is not what its name asks for among the other values, and never fails the file", () => {
    const { mark, rest } = conventionMark({
      tag: { nested: true },
      marker: "banana",
      markerColor: "url(https://attacker.example)",
      highlight: "yes",
      size: -4,
      color: "red; background: url(x)",
      meaning: "A meaning without a sign",
    });
    expect(mark).toEqual({});
    expect(Object.keys(rest).sort()).toEqual([
      "color",
      "highlight",
      "marker",
      "markerColor",
      "meaning",
      "size",
      "tag",
    ]);
    const spec = asFile(collection({ marker: "banana", highlight: "yes", size: -4 }));
    expect(spec.points[0]).toEqual({
      lat: 1,
      lon: 2,
      props: { marker: "banana", highlight: "yes", size: -4 },
    });
  });

  it("takes the tag a reader added by hand (`note`) for the tag of a mark that has none", () => {
    expect(asFile(collection({ note: "visit in May" })).points[0]).toMatchObject({
      tag: "visit in May",
      props: { note: "visit in May" },
    });
    expect(asFile(collection({ note: "visit", tag: "HQ" })).points[0].tag).toBe("HQ");
  });

  it("colours by category and plays by time only in a file that says its marks do", () => {
    const properties = { category: "corn", time: "2024" };
    const plain = asFile(collection(properties)).points[0];
    expect(plain.category).toBeUndefined();
    expect(plain.time).toBeUndefined();
    expect(plain.props).toEqual(properties);
    const said = asFile(
      collection(properties, { map: { category: true, time: true } }),
    );
    expect(said.points[0]).toMatchObject({ category: "corn", time: "2024" });
    expect(said.points[0].props).toBeUndefined();
  });

  it("keeps the limits of a map that plays: a file of more steps than a map has is one map, with a note", () => {
    const spec = asFile({
      type: "FeatureCollection",
      map: { time: true },
      features: Array.from({ length: 61 }, (_, at) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [at, 1] },
        properties: { time: `Step ${at}` },
      })),
    });
    expect(spec.points).toHaveLength(61);
    expect(spec.points.every((point) => point.time === undefined)).toBe(true);
    expect(spec.notes?.[0]).toMatch(/61 steps, and a map plays at most 60/);
  });

  it("puts the tag and the sign of a feature of several parts on its largest part", () => {
    const part = (side: number) => [
      [
        [0, 0],
        [side, 0],
        [side, side],
        [0, side],
        [0, 0],
      ],
    ];
    const spec = asFile({
      type: "Feature",
      properties: { name: "Islands", tag: "3 parts", marker: "pin", value: 5 },
      geometry: { type: "MultiPolygon", coordinates: [part(1), part(3), part(2)] },
    });
    expect(spec.shapes.map(({ tag, marker, value }) => [tag, marker, value])).toEqual([
      [undefined, undefined, 5],
      ["3 parts", "pin", 5],
      [undefined, undefined, 5],
    ]);
  });
});

describe("what a file says of its map", () => {
  it("is read: its credits, its notes, the layers that are off and what it opens with", () => {
    const spec = asFile(
      collection(
        { layer: "Sites" },
        {
          name: "Sites of the north",
          map: {
            version: 1,
            credits: ["geonames"],
            notes: ["Surveyed in May."],
            layers: [{ name: "Sites", hidden: true, opacity: 0.4 }],
            view: { center: [2, 1], zoom: 9 },
            context: ["buildings"],
            boundaries: ["countries"],
            basemap: { choice: "plain", roads: false },
            pitch: 30,
          },
        },
      ),
    );
    expect(spec).toMatchObject({
      title: "Sites of the north",
      credits: ["geonames"],
      notes: ["Surveyed in May."],
      layers: [{ name: "Sites", group: "Sites", visible: false, opacity: 0.4 }],
      view: { center: [2, 1], zoom: 9 },
      context: ["buildings"],
      boundaries: ["countries"],
      basemap: { choice: "plain", roads: false },
      pitch: 30,
    });
  });

  it("keeps only what a map takes, and never fails a file for what it says of itself", () => {
    const hostile = {
      credits: ["geonames", "<script>", { toString: 1 }],
      notes: [
        "https://attacker.example/steal",
        "javascript:alert(1)",
        7,
        "n".repeat(5_000),
      ],
      layers: "all",
      view: { place: "Atlantis", center: ["x", "y"], zoom: 99_999 },
      context: ["buildings", "satellites"],
      boundaries: ["countries", "https://attacker.example/tiles"],
      basemap: { source: "attacker", choice: "https://attacker.example", names: false },
      pitch: 9_000,
      frame: "never",
      time: "yes",
      category: 1,
    };
    const asks = fileAsks(hostile);
    expect(asks).toEqual({
      credits: ["geonames"],
      notes: [expect.stringMatching(/^n+$/)],
      context: ["buildings"],
      boundaries: ["countries"],
      basemap: { names: false },
      frame: "never",
    });
    expect(asks.notes?.[0].length).toBeLessThanOrEqual(240);
    const spec = asFile(collection({ name: "A" }, { map: hostile }));
    expect(spec.points).toHaveLength(1);
    expect(spec.basemap).toEqual({ names: false });
    expect(spec.view).toBeUndefined();
    expect(spec.frame).toBeUndefined();
    expect(JSON.stringify(spec)).not.toContain("attacker");
  });

  it("is not read when it is larger or deeper than a map says of itself, or no object", () => {
    expect(memberOf({ notes: ["a"] })).toEqual({ notes: ["a"] });
    expect(memberOf('{"credits":["geonames"]}')).toEqual({ credits: ["geonames"] });
    expect(memberOf({ notes: ["n".repeat(MAP_MEMBER_CHARS + 1)] })).toBeUndefined();
    expect(memberOf(`{"notes":["${"n".repeat(MAP_MEMBER_CHARS)}"]}`)).toBeUndefined();
    expect(
      memberOf(
        Object.fromEntries(Array.from({ length: 3_000 }, (_, at) => [`k${at}`, at])),
      ),
    ).toBeUndefined();
    let deep: unknown = 1;
    for (let level = 0; level < 12; level++) deep = { deep };
    expect(memberOf(deep)).toBeUndefined();
    for (const none of [null, undefined, 7, "no json", "[1,2]", ["a"]])
      expect(memberOf(none)).toBeUndefined();
  });

  it("is the same in a KML file: the data named map of its document", () => {
    const kml = `<kml><Document><name>Sites</name><ExtendedData><Data name="map"><value>{"credits":["geonames"],"notes":["Surveyed in May."]}</value></Data></ExtendedData><Folder><name>North</name><Placemark><name>A</name><ExtendedData><Data name="tag"><value>HQ</value></Data></ExtendedData><Point><coordinates>2,1</coordinates></Point></Placemark></Folder></Document></kml>`;
    for (const spec of [
      makeMap({ file: { name: "sites.kml", text: kml } }),
      makeMap({ kml }),
    ]) {
      expect(spec.title).toBe("Sites");
      expect(spec.credits).toEqual(["geonames"]);
      expect(spec.notes).toEqual(["Surveyed in May."]);
    }
    expect(makeMap({ file: { name: "sites.kml", text: kml } }).layers).toMatchObject([
      { name: "North", points: [{ label: "A", tag: "HQ" }] },
    ]);
  });
});

describe("a file given under a key that reads it without layers", () => {
  it("says that its layers are drawn together, and how to keep them", () => {
    const two = {
      type: "FeatureCollection",
      features: ["North", "South"].map((layer, at) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [at, 1] },
        properties: { layer },
      })),
    };
    expect(makeMap({ geojson: two }).notes).toEqual([
      "The marks of the 2 layers of the file are drawn together: it was given under a key that reads a file without its layers. Give it as { file: { name, text } } (a KMZ file: { name, data }) to keep them.",
    ]);
    expect(asFile(two).layers?.map((layer) => layer.name)).toEqual(["North", "South"]);
  });
});
