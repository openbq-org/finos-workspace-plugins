import "~/lib/geo/mapFile";
import { describe, expect, it } from "vitest";
import { MAP_LIMITS } from "~/lib/codemode/limits";
import { widgetMap } from "~/lib/geo/mapData";
import { makeMap, mapSpec } from "~/lib/geo/mapSpec";
import { mapSummary } from "~/lib/geo/mapSummary";
import { outsideStorage } from "~/lib/outsideContent";
import { png, zip } from "../../../fixtures/geo/files/builders";
import { cpuBudget, cpuNow } from "../../machinePace";

const MB = 1024 * 1024;
const sizeOf = (value: unknown) => JSON.stringify(value).length;

const heavy = (count: number) =>
  Array.from({ length: count }, (_, at) => ({
    lat: (at % 170) - 85,
    lon: (at % 350) - 175,
    props: Object.fromEntries(
      Array.from({ length: 12 }, (_, key) => [`value ${key}`, "v".repeat(200)]),
    ),
  }));

function image(chars: number): string {
  const bytes = png(64, 64);
  const filled = new Uint8Array(Math.floor((chars * 3) / 4));
  filled.set(bytes);
  for (let at = bytes.length; at < filled.length; at++) filled[at] = (at * 31) & 255;
  return Buffer.from(filled).toString("base64");
}
const CORNERS = [
  [-94, 42.1],
  [-93, 42.1],
  [-93, 41.9],
  [-94, 41.9],
];
const picture = (chars: number) => ({
  kind: "image",
  image: { mime: "image/png", data: image(chars), corners: CORNERS },
});

describe("the size of a map", () => {
  const TOO_LARGE =
    /^output\.map: the map is over 2 MB as data \(its points take .* MB\)\. A map has at most 2 MB, all its layers and images together: draw fewer points \(aggregate the rows first: table\.groupBy\), or give each fewer or shorter values \(`props`\)\./;

  it("holds every map it accepts within the 2 MB, also as it travels in an output", () => {
    const one = sizeOf(heavy(1)[0]) + 1;
    const most = Math.floor((MAP_LIMITS.chars - 512) / one) - 1;
    const spec = makeMap({ title: "T", points: heavy(most) });
    expect(sizeOf({ kind: "map", name: "n".repeat(50), spec })).toBeLessThanOrEqual(
      MAP_LIMITS.chars,
    );
    expect(sizeOf(spec)).toBeGreaterThan(MAP_LIMITS.chars - 8 * 1024);
    expect(mapSpec(spec)).toEqual(spec);
    expect(() => makeMap({ title: "T", points: heavy(most + 3) })).toThrow(TOO_LARGE);
  });

  it("counts every kind of mark and every layer in the one size", () => {
    const value = "v".repeat(200);
    const props = Object.fromEntries(
      Array.from({ length: 12 }, (_, key) => [`value ${key}`, value]),
    );
    const regions = {
      set: "us-counties",
      items: Array.from({ length: 900 }, (_, at) => ({
        code: String(1001 + at),
        props,
      })),
    };
    expect(() => makeMap({ regions })).toThrow(
      /the map is over 2 MB as data \(its regions take .* MB\)\..*give each region fewer or shorter values/,
    );
    const shapes = Array.from({ length: 900 }, () => ({
      type: "line",
      coordinates: [
        [0, 0],
        [1, 1],
      ],
      props,
    }));
    expect(() => makeMap({ shapes })).toThrow(/its lines and areas take .* MB/);
    const flows = shapes.map(({ props }) => ({ from: [0, 0], to: [1, 1], props }));
    expect(() => makeMap({ layers: [{ kind: "flows", flows }] })).toThrow(
      /its flows take .* MB/,
    );
    const half = heavy(450);
    expect(() =>
      makeMap({
        points: half,
        layers: [{ kind: "points", points: half }],
      }),
    ).toThrow(/its points take/);
  });

  it("counts the images inside the size of the map: two that do not fit together are refused by the reducer", () => {
    expect(makeMap({ layers: [picture(1_390_000)] }).layers).toHaveLength(1);
    expect(() => makeMap({ layers: [picture(1_390_000), picture(1_000_000)] })).toThrow(
      "output.map: the map is over 2 MB as data (its images take 2.3 MB). A map has at most 2 MB, all its layers and images together: use fewer or smaller images.",
    );
    expect(() => makeMap({ points: heavy(400), layers: [picture(1_390_000)] })).toThrow(
      /its images take 1\.3 MB, its points take 1 MB/,
    );
  });

  it("draws the images of a file that fit, and says which it left out", () => {
    const overlay = (name: string) =>
      `<GroundOverlay><name>${name}</name><Icon><href>${name}.png</href></Icon><LatLonBox><north>1</north><south>0</south><east>1</east><west>0</west></LatLonBox></GroundOverlay>`;
    const big = Buffer.from(image(1_300_000), "base64");
    const kmz = zip(
      {
        "doc.kml": `<kml><Document>${overlay("a")}${overlay("b")}<Placemark><name>P</name><Point><coordinates>1,2</coordinates></Point></Placemark></Document></kml>`,
        "a.png": Uint8Array.from(big),
        "b.png": Uint8Array.from(big),
      },
      0,
    );
    const spec = makeMap({
      file: { name: "two.kmz", data: Buffer.from(kmz).toString("base64") },
    });
    expect(spec.layers?.filter((layer) => layer.kind === "image")).toHaveLength(1);
    expect(spec.notes).toContain(
      'The image "b" is not drawn: with it the map would be over the 2 MB a map has, its images included.',
    );
    expect(sizeOf(spec)).toBeLessThanOrEqual(MAP_LIMITS.chars);
  });
});

describe("a file that holds more than a map has room for", () => {
  const noteOf = (spec: { notes?: string[] }) =>
    spec.notes?.find((note) => note.startsWith("The file is larger than a map")) ?? "";
  const collection = (count: number, properties: (at: number) => object) =>
    JSON.stringify({
      type: "FeatureCollection",
      features: Array.from({ length: count }, (_, at) => ({
        type: "Feature",
        properties: { name: `Site ${at}`, ...properties(at) },
        geometry: {
          type: "Point",
          coordinates: [-100 + (at % 500) / 10, 30 + (at % 170) / 10],
        },
      })),
    });

  it("draws the placemarks of a small KMZ that fit, and says how many: 66,000 placemarks in 0.7 MB", () => {
    const placemark = (at: number) =>
      `<Placemark><name>Station ${at} of the northern survey network, section ${at % 97}, line ${at % 13}, as it was recorded in the field book</name><Point><coordinates>${-100 + (at % 500) / 10},${30 + (at % 170) / 10}</coordinates></Point></Placemark>`;
    const kml = `<kml><Document>${Array.from({ length: 66_000 }, (_, at) => placemark(at)).join("")}</Document></kml>`;
    const kmz = Buffer.from(zip({ "doc.kml": kml })).toString("base64");
    expect(kmz.length).toBeLessThan(1.1 * MB);
    const spec = makeMap({ file: { name: "stations.kmz", data: kmz } });
    const drawn = mapSummary(spec).points;
    expect(drawn).toBeGreaterThan(10_000);
    expect(drawn).toBeLessThan(20_000);
    expect(sizeOf({ kind: "map", name: "n".repeat(50), spec })).toBeLessThanOrEqual(
      MAP_LIMITS.chars,
    );
    expect(sizeOf(spec)).toBeGreaterThan(MAP_LIMITS.chars - 32 * 1024);
    expect(noteOf(spec)).toBe(
      `The file is larger than a map: ${drawn.toLocaleString("en-US")} of its 20,000 marks are drawn. Simplify or split the file, or serve it from the backend as vector tiles.`,
    );
    expect(spec.notes?.join(" ")).toMatch(/20,000/);
    expect(mapSpec(spec)).toEqual(spec);
  });

  it("leaves out the longest values before any mark: 20,000 points of a GeoJSON file of 4 MB", () => {
    const text = collection(20_000, (at) => ({
      name: `S${at}`,
      survey: `Survey of ${1900 + (at % 120)}: nothing of note was found at this site, as before`,
      county: `C${at % 300}`,
      yield: at % 250,
    }));
    expect(text.length).toBeGreaterThan(3.7 * MB);
    expect(text.length).toBeLessThanOrEqual(MAP_LIMITS.fileChars);
    const spec = makeMap({ file: { name: "sites.geojson", text } });
    expect(spec.points).toHaveLength(20_000);
    expect(spec.points[19_999]).toMatchObject({
      label: "S19999",
      props: { county: "C199", yield: 249 },
    });
    expect(spec.points.some((point) => point.props && "survey" in point.props)).toBe(
      false,
    );
    expect(noteOf(spec)).toBe(
      'The file is larger than a map: its marks are drawn without their values of "survey". Simplify or split the file, or serve it from the backend as vector tiles.',
    );
    expect(sizeOf({ kind: "map", name: "n".repeat(50), spec })).toBeLessThanOrEqual(
      MAP_LIMITS.chars,
    );
    expect(mapSpec(spec)).toEqual(spec);
  });

  it("keeps the marks of the code whole and gives the file the room that is left", () => {
    const own = heavy(600);
    const spec = makeMap({
      points: own,
      file: {
        name: "sites.geojson",
        text: collection(20_000, () => ({ county: "Story" })),
      },
    });
    expect(spec.points.slice(0, 600)).toEqual(makeMap({ points: own }).points);
    const drawn = spec.points.length - 600;
    expect(drawn).toBeGreaterThan(1_000);
    expect(drawn).toBeLessThan(20_000);
    expect(noteOf(spec)).toBe(
      `The file is larger than a map: ${drawn.toLocaleString("en-US")} of its 20,000 marks are drawn, without their values of "county". Simplify or split the file, or serve it from the backend as vector tiles.`,
    );
    expect(sizeOf({ kind: "map", name: "n".repeat(50), spec })).toBeLessThanOrEqual(
      MAP_LIMITS.chars,
    );
  });

  it("still refuses marks of the code that are too large, with the advice for code", () => {
    expect(() =>
      makeMap({
        points: heavy(900),
        file: { name: "a.geojson", text: collection(10, () => ({})) },
      }),
    ).toThrow(/draw fewer points \(aggregate the rows first: table\.groupBy\)/);
  });

  it("says what to do with a file when none of its marks fits a map", () => {
    const ring = Array.from({ length: 99_000 }, (_, at) => [
      -100.123456 + (at % 1000) / 100,
      30.123456 + (at % 700) / 100,
    ]);
    ring.push(ring[0]);
    const text = JSON.stringify({ type: "Polygon", coordinates: [ring] });
    expect(text.length).toBeLessThanOrEqual(MAP_LIMITS.fileChars);
    expect(() => makeMap({ file: { name: "coast.geojson", text } })).toThrow(
      /^output\.map: the file cannot be drawn: its 1 mark is larger than a map has room for \(2 MB as data\)\. Simplify or split the file, or serve it from the backend as vector tiles\.$/,
    );
  });

  it("leaves out an image that does not fit beside the marks of the code, and draws the map", () => {
    const overlay =
      "<GroundOverlay><name>scan</name><Icon><href>a.png</href></Icon><LatLonBox><north>1</north><south>0</south><east>1</east><west>0</west></LatLonBox></GroundOverlay>";
    const kmz = zip(
      {
        "doc.kml": `<kml><Document>${overlay}<Placemark><name>P</name><Point><coordinates>1,2</coordinates></Point></Placemark></Document></kml>`,
        "a.png": Uint8Array.from(Buffer.from(image(1_300_000), "base64")),
      },
      0,
    );
    const file = { name: "scan.kmz", data: Buffer.from(kmz).toString("base64") };
    expect(makeMap({ file }).layers?.map((layer) => layer.kind)).toEqual(["image"]);
    expect(makeMap({ file }).points).toHaveLength(1);
    const spec = makeMap({ points: heavy(400), file });
    expect(spec.layers).toBeUndefined();
    expect(mapSummary(spec).points).toBe(401);
    expect(spec.notes).toContain(
      'The image "scan" is not drawn: with it the map would be over the 2 MB a map has, its images included.',
    );
  });
});
