import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8 as encoded, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import "~/lib/geo/mapFile";
import { GEO_FILE_LIMITS } from "~/lib/geo/files/limits";
import { FLAT_LIMITS } from "~/lib/geo/mapFileFlat";
import { makeMap } from "~/lib/geo/mapSpec";
import { cpuBudget, cpuNow } from "../../machinePace";
import { random } from "./files/support";

const strToU8 = (text: string) => Uint8Array.from(encoded(text));

const ATTACKER = "https://attacker.example";
const fixture = (name: string) =>
  readFileSync(join(process.cwd(), "tests/fixtures/geo", name));
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const kml = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${body}</Document></kml>`;
const placemark = (inside: string) => `<Placemark>${inside}</Placemark>`;
const POINT = "<Point><coordinates>-77.04,38.9,0</coordinates></Point>";
const kmz = (bytes: Uint8Array) => makeMap({ kmz: base64(bytes) });
const said = (n: number) => n.toLocaleString("en-US");
const MEGABYTES = `${FLAT_LIMITS.chars / (1024 * 1024)} MB`;

const documentOf = (chars: number, fill: (length: number) => string) => {
  const empty = kml(`${placemark(`<name>P</name>${POINT}`)}<!---->`);
  return empty.replace("<!---->", `<!--${fill(chars - empty.length)}-->`);
};
const blanks = (length: number) => " ".repeat(length);
const letters = (length: number) => {
  const next = random(20261011);
  const codes = new Uint8Array(length);
  for (let at = 0; at < length; at++) codes[at] = 97 + Math.floor(next() * 16);
  return new TextDecoder().decode(codes);
};
const declared = (archive: Uint8Array) => {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  for (let at = 0; at < archive.length - 4; at++)
    if (view.getUint32(at, true) === 0x02014b50)
      return {
        packed: view.getUint32(at + 20, true),
        size: view.getUint32(at + 24, true),
      };
  throw new Error("the archive has no table");
};

describe("output.map({ kml }): what is read", () => {
  it("reads the fixture: points, a line and an area with their names, values and colours", () => {
    const spec = makeMap({ kml: fixture("fed-districts.kml").toString("utf8") });
    expect(spec.title).toBe("Federal Reserve sample");
    expect(spec.points).toEqual([
      {
        lat: 38.8929,
        lon: -77.0459,
        label: "Board of Governors",
        color: "#1f77b4",
        props: {
          description: "Washington, D.C. The Board sets policy.",
          district: "Board",
          rate: 4.1,
        },
      },
      {
        lat: 40.7084,
        lon: -74.0087,
        label: "Federal Reserve Bank of New York",
        color: "#d62728",
        props: { district: 2 },
      },
      { lat: 41.8786, lon: -87.6321, label: "Federal Reserve Bank of Chicago" },
      { lat: 37.7933, lon: -122.3959, label: "Federal Reserve Bank of San Francisco" },
    ]);
    expect(spec.shapes.map((shape) => [shape.type, shape.label, shape.color])).toEqual([
      ["line", "Washington to New York", "#2ca02c"],
      ["polygon", "Second District (sketch)", "#d62728"],
    ]);
    const area = spec.shapes[1];
    expect(
      area.type === "polygon" && area.coordinates.map((ring) => ring.length),
    ).toEqual([5, 4]);
  });

  it("reads a KMZ file through the same reader", () => {
    const fromKml = makeMap({ kml: fixture("fed-districts.kml").toString("utf8") });
    expect(makeMap({ kmz: base64(fixture("fed-districts.kmz")) })).toEqual(fromKml);
  });

  it("splits a MultiGeometry into marks that share the placemark", () => {
    const spec = makeMap({
      kml: kml(
        placemark(
          `<name>Both</name><MultiGeometry>${POINT}<LineString><coordinates>0,0 1,1</coordinates></LineString></MultiGeometry>`,
        ),
      ),
    });
    expect(spec.points).toEqual([{ label: "Both", lon: -77.04, lat: 38.9 }]);
    expect(spec.shapes).toMatchObject([{ type: "line", label: "Both" }]);
    expect(spec.layers).toBeUndefined();
  });
});

describe("output.map({ kml }): what is not read", () => {
  it("ignores network links, overlays, icons and the html of a description", () => {
    const hostile = kml(`
      <NetworkLink><name>Remote</name><Link><href>${ATTACKER}/more.kml</href></Link></NetworkLink>
      <GroundOverlay><Icon><href>${ATTACKER}/overlay.png</href></Icon></GroundOverlay>
      <ScreenOverlay><Icon><href>${ATTACKER}/logo.png</href></Icon></ScreenOverlay>
      <Style id="pin"><IconStyle><color>ff0000ff</color><Icon><href>${ATTACKER}/pin.png</href></Icon></IconStyle></Style>
      <NetworkLink>${placemark(`<name>Inside a link</name>${POINT}`)}</NetworkLink>
      ${placemark(`
        <name>HQ</name>
        <styleUrl>#pin</styleUrl>
        <description><![CDATA[<img src="${ATTACKER}/beacon.png"><a href="${ATTACKER}/go">Open</a><script>fetch("${ATTACKER}")</script> text]]></description>
        <ExtendedData><Data name="site"><value>${ATTACKER}/data</value></Data></ExtendedData>
        ${POINT}`)}
    `);
    const spec = makeMap({ kml: hostile });
    expect(spec.points).toEqual([
      {
        lat: 38.9,
        lon: -77.04,
        label: "HQ",
        color: "#ff0000",
        props: { description: "Open text" },
      },
    ]);
    expect(spec.notes?.join(" ")).toMatch(
      /1 value that is an address was left out\. Addresses in a file are not kept\./,
    );
    const json = JSON.stringify(spec);
    for (const loaded of [
      "more.kml",
      "overlay.png",
      "logo.png",
      "pin.png",
      "beacon.png",
      "/go",
      "<img",
      "<a ",
      "<script",
    ])
      expect(json).not.toContain(loaded);
  });

  it("says so when a file has nothing to draw", () => {
    expect(() =>
      makeMap({
        kml: kml(
          `<NetworkLink><Link><href>${ATTACKER}/a.kml</href></Link></NetworkLink>`,
        ),
      }),
    ).toThrow(
      "output.map: the KML has no placemark with a Point, a LineString or a Polygon. A file that only links to other files (NetworkLink) or shows an image (an overlay) has nothing the map reads.",
    );
    expect(() => makeMap({ kml: "not xml at all" })).toThrow(
      /^output\.map: the KML is not a KML document: /,
    );
    expect(() => makeMap({ kml: 12 })).toThrow(/"kml" must be the text of a KML file/);
    expect(() =>
      makeMap({ kml: '<gpx version="1.1"><wpt lat="1" lon="2"/></gpx>' }),
    ).toThrow(
      'output.map: "kml" must be the text of a KML file: this is GPX. Give it as { file: { name, text } }.',
    );
    expect(() => makeMap({ kml: '{"type":"Point","coordinates":[1,2]}' })).toThrow(
      /this is GeoJSON/,
    );
  });

  it("leaves out a placemark whose position is not a number, and draws the others", () => {
    const bad = placemark(
      "<name>Bad</name><Point><coordinates>abc,def</coordinates></Point>",
    );
    expect(() => makeMap({ kml: kml(bad) })).toThrow(/has no placemark with a Point/);
    const spec = makeMap({
      kml: kml(`${bad}${placemark(`<name>Good</name>${POINT}`)}`),
    });
    expect(spec.points.map((point) => point.label)).toEqual(["Good"]);
  });
});

describe("output.map({ kml }): bounds", () => {
  it("reads a text of exactly the size of a KML file, and refuses one character more before it reads it", () => {
    const most = FLAT_LIMITS.chars;
    const largest = documentOf(most, blanks);
    expect(largest).toHaveLength(most);
    expect(makeMap({ kml: largest }).points).toHaveLength(1);
    expect(() => makeMap({ kml: documentOf(most + 1, blanks) })).toThrow(
      `output.map: the KML is ${said(most + 1)} characters. A KML file has at most ${said(most)}.`,
    );
  });

  it("refuses more elements than a map file has, and a document nested too deeply", () => {
    const many = "<a/>".repeat(GEO_FILE_LIMITS.xmlNodes + 1);
    expect(many.length).toBeLessThanOrEqual(FLAT_LIMITS.chars);
    expect(() => makeMap({ kml: `<kml>${many}</kml>` })).toThrow(
      /^output\.map: the KML cannot be read: .*400,000/,
    );
    expect(() =>
      makeMap({ kml: `<kml>${"<a>".repeat(GEO_FILE_LIMITS.xmlDepth + 2)}` }),
    ).toThrow(/^output\.map: the KML cannot be read: .*64 levels/);
  });

  it("refuses a tag, a comment or a CDATA section that does not end, and a closing tag that closes nothing", () => {
    for (const broken of [
      "<kml><Document",
      "<kml><!-- x",
      "<kml><![CDATA[ x",
      `<kml><Document>${placemark(POINT)}</Folder></kml>`,
    ])
      expect(() => makeMap({ kml: broken }), broken).toThrow(
        /^output\.map: the KML cannot be read: /,
      );
  });

  it("reads the largest file in linear time, and says what it left out", () => {
    const one = placemark(`<name>P</name>${POINT}`);
    const body = one.repeat(Math.floor((FLAT_LIMITS.chars - 300) / one.length));
    const started = cpuNow();
    const spec = makeMap({ kml: kml(body) });
    expect(cpuNow() - started).toBeLessThan(cpuBudget(3000));
    expect(spec.points).toHaveLength(GEO_FILE_LIMITS.features);
    expect(spec.notes?.join(" ")).toMatch(/20,000/);
    const quoted = `<a b="${">".repeat(500_000)}">${"<".repeat(1000)}`;
    const again = cpuNow();
    expect(() => makeMap({ kml: quoted })).toThrow();
    expect(cpuNow() - again).toBeLessThan(cpuBudget(1000));
  });
});

describe("output.map({ kmz }): bounds", () => {
  const doc = kml(placemark(`<name>P</name>${POINT}`));

  it("reads an archive of exactly the size of a KMZ file, and refuses one byte more", () => {
    const most = FLAT_LIMITS.chars;
    const archive = (bytes: number) => {
      const stored = (pad: number) =>
        zipSync(
          { "doc.kml": strToU8(doc), "pad.bin": new Uint8Array(pad) },
          { level: 0 },
        );
      return stored(bytes - stored(0).length);
    };
    expect(archive(most)).toHaveLength(most);
    expect(kmz(archive(most)).points).toHaveLength(1);
    const refusal = `output.map: the KMZ file is over ${MEGABYTES}. A KMZ file with images is large: keep the KML document only, or give the file as { file: { name, data } }.`;
    expect(() => kmz(archive(most + 1))).toThrow(refusal);
    expect(() => makeMap({ kmz: "A".repeat(most * 2) })).toThrow(refusal);
  });

  it("reads a document that unpacks to exactly the size of a KML file, and refuses one byte more by the size the archive declares", () => {
    const most = FLAT_LIMITS.chars;
    const packed = (chars: number) =>
      zipSync({ "doc.kml": strToU8(documentOf(chars, letters)) }, { level: 9 });
    const largest = packed(most);
    expect(declared(largest).size).toBe(most);
    expect(largest.length).toBeLessThan(most);
    expect(kmz(largest).points).toHaveLength(1);
    expect(() => kmz(packed(most + 1))).toThrow(
      `output.map: the KML document of the KMZ file is ${said(most + 1)} bytes unpacked. A KML file has at most ${said(most)}.`,
    );
  });

  it("reads a document that unpacks to exactly as many times its packed size as a file may, and refuses one byte more before unpacking", () => {
    const most = FLAT_LIMITS.ratio;
    const packed = (chars: number, few: number) =>
      zipSync(
        {
          "doc.kml": strToU8(
            documentOf(chars, (length) => letters(few) + blanks(length - few)),
          ),
        },
        { level: 9 },
      );
    const exact = () => {
      for (let bytes = Math.ceil(doc.length / most) + 1; bytes < 1000; bytes++) {
        if (declared(packed(bytes * most, 0)).packed > bytes) continue;
        for (let few = 0; few < 64; few++)
          if (declared(packed(bytes * most, few)).packed === bytes)
            return { chars: bytes * most, few };
      }
      throw new Error("no document packs to exactly the ratio");
    };
    const { chars, few } = exact();
    const atMost = packed(chars, few);
    expect(declared(atMost)).toEqual({ packed: chars / most, size: chars });
    expect(kmz(atMost).points).toHaveLength(1);
    const over = packed(chars + 1, few);
    expect(declared(over)).toEqual({ packed: chars / most, size: chars + 1 });
    expect(() => kmz(over)).toThrow(
      `output.map: the KML document of the KMZ file unpacks to more than ${most} times its size, which no map does. The file is not read.`,
    );
  });

  it("says in its own words that a document unpacks to more than the archive declares", () => {
    const lying = zipSync(
      { "doc.kml": new Uint8Array(1_500_000).fill(60) },
      { level: 9 },
    );
    const view = new DataView(lying.buffer);
    for (let at = 0; at < lying.length - 4; at++) {
      const signature = view.getUint32(at, true);
      if (signature === 0x04034b50) view.setUint32(at + 22, 1000, true);
      if (signature === 0x02014b50) view.setUint32(at + 24, 1000, true);
    }
    expect(() => kmz(lying)).toThrow(
      "output.map: the KML document of the KMZ file unpacks to more than the archive declares for it. The file is not read.",
    );
  });

  it("reads an archive of as many entries as a KMZ file has at most, and refuses one more", () => {
    const most = FLAT_LIMITS.entries;
    const archive = (entries: number) =>
      zipSync({
        "doc.kml": strToU8(doc),
        ...Object.fromEntries(
          Array.from({ length: entries - 1 }, (_, at) => [`f${at}.txt`, strToU8("x")]),
        ),
      });
    expect(kmz(archive(most)).points).toHaveLength(1);
    expect(() => kmz(archive(most + 1))).toThrow(
      `output.map: the KMZ file has more than ${most} entries.`,
    );
    expect(() => kmz(archive(GEO_FILE_LIMITS.zipEntries + 1))).toThrow(
      `output.map: the KMZ file has more than ${most} entries.`,
    );
  });

  it("refuses an archive without a document, what is no archive and what is no text", () => {
    expect(() => makeMap({ kmz: base64(zipSync({ "a.txt": strToU8("x") })) })).toThrow(
      /has no \.kml document/,
    );
    expect(() => makeMap({ kmz: base64(strToU8("not a zip")) })).toThrow(
      /not a zip archive that can be read/,
    );
    expect(() => makeMap({ kmz: "%%%" })).toThrow(/must be a KMZ file as base64 text/);
  });
});
