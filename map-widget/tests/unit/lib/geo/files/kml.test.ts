import { describe, expect, it } from "vitest";
import { GEO_FILE_LIMITS } from "~/lib/geo/files";
import { boxCorners } from "~/lib/geo/files/kmlGeometry";
import {
  jpegHeader,
  png,
  SAMPLE_KML,
  utf8,
  webpHeader,
  zip,
} from "../../../../fixtures/geo/files/builders";
import { fixture, read, refusal } from "./support";

const kml = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document>${body}</Document></kml>`;
const placemark = (inside: string) => `<Placemark>${inside}</Placemark>`;
const POINT = "<Point><coordinates>-77.04,38.9,0</coordinates></Point>";
const overlay = (
  href: string,
  box = "<north>2</north><south>1</south><east>2</east><west>1</west>",
) =>
  `<GroundOverlay><name>Image</name><Icon><href>${href}</href></Icon><LatLonBox>${box}</LatLonBox></GroundOverlay>`;
const readKml = (body: string) => read(utf8(kml(body)));

describe("kml: what is read", () => {
  const result = read(fixture("sample.kml"));
  const byName = (name: string) =>
    result.features.filter((feature) => feature.name === name);

  it("reads the folders of a file as groups, each with the one it is in", () => {
    expect(result.kind).toBe("kml");
    expect(result.groups).toEqual([
      { name: "Field survey" },
      { name: "Sites", parent: 0 },
      { name: "Routes", parent: 1 },
      { name: "Zones", parent: 0 },
    ]);
    expect(result.features.map((feature) => [feature.name, feature.group])).toEqual([
      ["Depot & yard", 1],
      ["Trail", 2],
      ["Drive", 2],
      ["Zone A", 3],
      ["Mixed", 3],
      ["Mixed", 3],
      ["Mixed", 3],
    ]);
  });

  it("reads a point with its typed values, its time and its description as plain text", () => {
    expect(byName("Depot & yard")).toEqual([
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-77.0459, 38.8929] },
        properties: {
          rate: 4.1,
          postcode: "02134",
          code: "0042",
          visits: 17,
          score: 8.5,
          open: true,
          time: "2024-05-01T09:30:00Z",
        },
        name: "Depot & yard",
        description: "Open daily. See the site",
        group: 1,
        style: { color: "#ff0000" },
      },
    ]);
  });

  it("reads a line with its style and a span of time", () => {
    expect(byName("Trail")).toEqual([
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [-77.05, 38.89],
            [-77.04, 38.9],
            [-77.03, 38.905],
          ],
        },
        properties: { time: "2024-05-01/2024-05-03" },
        name: "Trail",
        group: 2,
        style: { color: "#00aa00", lineWidth: 3 },
      },
    ]);
  });

  it("reads a gx:Track as the line through its positions, with when it starts and ends", () => {
    const [track] = byName("Drive");
    expect(track.geometry).toEqual({
      type: "LineString",
      coordinates: [
        [-77.06, 38.88],
        [-77.055, 38.885],
        [-77.05, 38.89],
      ],
    });
    expect(track.properties).toEqual({
      time: "2024-05-02T10:00:00Z/2024-05-02T10:10:00Z",
    });
  });

  it("reads an area with its hole after its outline, styled by the normal state of a StyleMap", () => {
    const [zone] = byName("Zone A");
    expect(zone.geometry.type).toBe("Polygon");
    expect(
      zone.geometry.type === "Polygon" &&
        zone.geometry.coordinates.map((ring) => ring.length),
    ).toEqual([5, 4]);
    expect(zone.style).toEqual({
      color: "#0000ff",
      lineWidth: 2,
      fillColor: "#ff0000",
      fillOpacity: 0.502,
    });
  });

  it("splits a MultiGeometry of mixed kinds into one feature for each kind", () => {
    expect(byName("Mixed").map((feature) => feature.geometry.type)).toEqual([
      "MultiPoint",
      "LineString",
      "Polygon",
    ]);
    expect(byName("Mixed").map((feature) => feature.style)).toEqual([
      { color: "#332211" },
      { color: "#332211" },
      { color: "#332211" },
    ]);
  });

  it("keeps a MultiGeometry of one kind as one feature", () => {
    const { features } = readKml(
      placemark(
        "<name>Two</name><MultiGeometry><LineString><coordinates>0,0 1,1</coordinates></LineString><LineString><coordinates>2,2 3,3</coordinates></LineString></MultiGeometry>",
      ) +
        placemark(
          "<MultiGeometry><Polygon><outerBoundaryIs><LinearRing><coordinates>0,0 1,0 1,1 0,0</coordinates></LinearRing></outerBoundaryIs></Polygon><Polygon><outerBoundaryIs><LinearRing><coordinates>5,5 6,5 6,6 5,5</coordinates></LinearRing></outerBoundaryIs></Polygon></MultiGeometry>",
        ) +
        placemark(
          "<gx:MultiTrack><gx:Track><gx:coord>0 0 0</gx:coord><gx:coord>1 1 0</gx:coord></gx:Track><gx:Track><gx:coord>2 2 0</gx:coord><gx:coord>3 3 0</gx:coord></gx:Track></gx:MultiTrack>",
        ),
    );
    expect(features.map((feature) => feature.geometry.type)).toEqual([
      "MultiLineString",
      "MultiPolygon",
      "MultiLineString",
    ]);
  });

  it("reads the columns and the bounds of a file", () => {
    expect(result.columns).toEqual([
      { name: "rate", kind: "number" },
      { name: "postcode", kind: "text" },
      { name: "code", kind: "text" },
      { name: "visits", kind: "number" },
      { name: "score", kind: "number" },
      { name: "open", kind: "text" },
      { name: "time", kind: "text" },
    ]);
    expect(result.bounds).toEqual([-77.3, 38.6, -77.02, 38.92]);
  });

  it("reads styles: an area that is not filled, a style inside a StyleMap, a colour that is none", () => {
    const area =
      "<Polygon><outerBoundaryIs><LinearRing><coordinates>0,0 1,0 1,1 0,0</coordinates></LinearRing></outerBoundaryIs></Polygon>";
    const { features } = readKml(`
      <Style id="hollow"><PolyStyle><color>ff00ff00</color><fill>0</fill><outline>0</outline></PolyStyle></Style>
      <StyleMap id="inline"><Pair><key>normal</key><Style><LineStyle><color>FF0000FF</color><width>500</width></LineStyle></Style></Pair></StyleMap>
      <Style id="bad"><LineStyle><color>red</color><width>wide</width></LineStyle></Style>
      ${placemark(`<styleUrl>#hollow</styleUrl>${area}`)}
      ${placemark(`<styleUrl>#inline</styleUrl>${area}`)}
      ${placemark(`<styleUrl>#bad</styleUrl>${area}`)}
      ${placemark(`<styleUrl>#missing</styleUrl>${area}`)}
      ${placemark(`<styleUrl>#hollow</styleUrl><Style><PolyStyle><color>40ff0000</color></PolyStyle></Style>${area}`)}
    `);
    expect(features.map((feature) => feature.style)).toEqual([
      { lineWidth: 0, fillColor: "#00ff00", fillOpacity: 0 },
      { color: "#ff0000", lineWidth: 32 },
      undefined,
      undefined,
      { lineWidth: 0, fillColor: "#0000ff", fillOpacity: 0.251 },
    ]);
  });

  it("reads entities and CDATA as text, and never expands an entity a file could have declared", () => {
    const [feature] = readKml(
      placemark(
        `<name>A &amp; B &#233;&#x1F600; &lol9;&xxe;</name><description><![CDATA[1 < 2 &amp; <i>so</i> on<br>next&nbsp;line]]></description>${POINT}`,
      ),
    ).features;
    expect(feature.name).toBe("A & B é😀 &lol9;&xxe;");
    expect(feature.description).toBe("1 < 2 & so on next line");
  });

  it("reads a description written as html inside the element, with every word and an unclosed <br>", () => {
    const result = read(fixture("raw-markup.kml"));
    expect(
      result.features.map((feature) => [feature.name, feature.description]),
    ).toEqual([
      ["Parcel 12", "Owner: Smith since 1990 Zoned R-2 & taxed a < b"],
      ["Parcel 13", "Owner Jones Vacant"],
    ]);
  });

  it("refuses a DOCTYPE inside a description, and a description that does not end", () => {
    expect(
      refusal(utf8(kml(placemark(`<description>a<!DOCTYPE x></description>${POINT}`))))
        .code,
    ).toBe("refused");
    expect(
      refusal(utf8(kml(placemark(`${POINT}<description>Owner: <b>Smith</b>`)))).code,
    ).toBe("malformed");
  });

  it("reads a file in Latin-1 when its declaration says so", () => {
    const text = `<?xml version="1.0" encoding="ISO-8859-1"?><kml><Placemark><name>Café</name>${POINT}</Placemark></kml>`;
    const bytes = Uint8Array.from(Array.from(text), (char) => char.charCodeAt(0));
    expect(read(bytes).features[0].name).toBe("Café");
  });

  it("reads a document that starts at a Placemark, without kml around it", () => {
    expect(read(utf8(placemark(`<name>Alone</name>${POINT}`))).features[0].name).toBe(
      "Alone",
    );
  });
});

describe("kml: what is not read", () => {
  it("follows no address of a file, and says how many it had", () => {
    const result = read(fixture("sample.kml"));
    expect(result.notes).toEqual([
      "1 value that is an address was left out. Addresses in a file are not kept.",
      "4 links to other servers (icons, images, network links, schemas, models) were not followed.",
      "1 image overlay was left out: an image is read only from inside a KMZ archive.",
      "2 elements the map does not read (network links, screen and photo overlays, models, tours) were left out.",
    ]);
    expect(result.overlays).toEqual([]);
    const json = JSON.stringify(result);
    for (const never of [
      "attacker",
      "http",
      "<img",
      "<script",
      "fetch(",
      "pin.png",
      "more.kml",
    ])
      expect(json).not.toContain(never);
  });

  it("does not read the placemarks of a NetworkLink, a remote schema or a remote style", () => {
    const result = readKml(`
      <NetworkLink>${placemark(`<name>Inside a link</name>${POINT}`)}<Link><href>//attacker.example/a.kml</href></Link></NetworkLink>
      ${placemark(`<name>Kept</name><styleUrl>https://attacker.example/styles.kml#red</styleUrl>
        <ExtendedData><SchemaData schemaUrl="https://attacker.example/schema.kml#S"><SimpleData name="n">7</SimpleData></SchemaData></ExtendedData>${POINT}`)}
    `);
    expect(result.features).toHaveLength(1);
    expect(result.features[0]).toMatchObject({ name: "Kept", properties: { n: 7 } });
    expect(result.features[0].style).toBeUndefined();
    expect(result.notes).toEqual([
      "3 links to other servers (icons, images, network links, schemas, models) were not followed.",
      "1 element the map does not read (network links, screen and photo overlays, models, tours) was left out.",
    ]);
  });

  it("says why a file with nothing to draw has nothing", () => {
    const error = refusal(
      utf8(
        kml(
          "<NetworkLink><Link><href>https://attacker.example/a.kml</href></Link></NetworkLink>",
        ),
      ),
    );
    expect(error.code).toBe("empty");
    expect(error.message).toBe(
      "The file has nothing a map draws. 1 link to other servers (icons, images, network links, schemas, models) was not followed. 1 element the map does not read (network links, screen and photo overlays, models, tours) was left out.",
    );
    expect(refusal(utf8("<html><body>hello</body></html>")).code).toBe(
      "unknown-format",
    );
  });

  it("leaves out a placemark whose position is not on the map", () => {
    const result = readKml(
      placemark("<name>Far</name><Point><coordinates>500,95</coordinates></Point>") +
        placemark(
          "<name>Words</name><Point><coordinates>abc,def</coordinates></Point>",
        ) +
        placemark(
          "<name>Hex</name><Point><coordinates>0x10,1e400</coordinates></Point>",
        ) +
        placemark(
          "<name>Short</name><LineString><coordinates>1,1</coordinates></LineString>",
        ) +
        placemark("<name>Nothing</name>") +
        placemark(`<name>Here</name>${POINT}`),
    );
    expect(result.features.map((feature) => feature.name)).toEqual(["Here"]);
    expect(result.notes).toEqual([
      "3 features were left out: a position is not a longitude from -180 to 180 and a latitude from -90 to 90.",
      "1 feature was left out: a line needs two positions and an area three.",
    ]);
  });

  it("does not keep a name or a folder that is an address", () => {
    const result = readKml(
      `<Folder><name>https://attacker.example/folder</name>${placemark(`<name>javascript:alert(1)</name>${POINT}`)}</Folder>`,
    );
    expect(result.groups).toEqual([
      { name: "Untitled" },
      { name: "Untitled", parent: 0 },
    ]);
    expect(result.features[0].name).toBeUndefined();
  });
});

describe("kmz: image overlays", () => {
  it("returns the image of a ground overlay that is inside the archive, with its turned corners", () => {
    const result = read(fixture("sample.kmz"));
    expect(result.kind).toBe("kmz");
    expect(result.features).toEqual(read(fixture("sample.kml")).features);
    expect(result.overlays).toHaveLength(1);
    const [image] = result.overlays;
    expect(image.name).toBe("Survey photo");
    expect(image.group).toBe(0);
    expect(image.image.mime).toBe("image/png");
    expect([image.image.width, image.image.height]).toEqual([64, 64]);
    expect(Array.from(image.image.bytes)).toEqual(Array.from(png(64, 64)));
    const squeeze = Math.cos((38.9 * Math.PI) / 180);
    const turned = (x: number, y: number) => {
      const [dx, dy] = [x * 0.02 * squeeze, y * 0.02];
      const [cos, sin] = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)];
      return [-77.04 + (dx * cos - dy * sin) / squeeze, 38.9 + dx * sin + dy * cos];
    };
    const expected = [turned(-1, 1), turned(1, 1), turned(1, -1), turned(-1, -1)];
    image.corners.forEach((corner, at) => {
      expect(corner[0]).toBeCloseTo(expected[at][0], 9);
      expect(corner[1]).toBeCloseTo(expected[at][1], 9);
    });
    expect(image.corners[0][0]).toBeLessThan(-77.06);
    expect(image.corners[0][1]).toBeLessThan(38.92);
    expect(result.bounds?.[2]).toBeCloseTo(image.corners[2][0], 9);
    expect(result.notes).toEqual([
      "1 value that is an address was left out. Addresses in a file are not kept.",
      "4 links to other servers (icons, images, network links, schemas, models) were not followed.",
      "2 elements the map does not read (network links, screen and photo overlays, models, tours) were left out.",
    ]);
  });

  it("gives the corners of a box that is not turned, and of one turned a quarter", () => {
    expect(boxCorners(2, 1, 4, 3, 0)).toEqual([
      [3, 2],
      [4, 2],
      [4, 1],
      [3, 1],
    ]);
    const quarter = boxCorners(1, -1, 2, -2, 90);
    const expected = [
      [-1, -2],
      [-1, 2],
      [1, 2],
      [1, -2],
    ];
    quarter.forEach((corner, at) => {
      expect(corner[0]).toBeCloseTo(expected[at][0], 9);
      expect(corner[1]).toBeCloseTo(expected[at][1], 9);
    });
  });

  it("reads a LatLonQuad, a JPEG and a WebP, by what the bytes say and not by the name", () => {
    const quad =
      "<GroundOverlay><Icon><href>a.png</href></Icon><gx:LatLonQuad><coordinates>0,0 2,0 2,1 0,1</coordinates></gx:LatLonQuad></GroundOverlay>";
    const result = read(
      zip({
        "doc.kml": kml(quad + overlay("b.jpg") + overlay("c.webp")),
        "a.png": jpegHeader(300, 200),
        "b.jpg": webpHeader(640, 480),
        "c.webp": png(4, 2),
      }),
    );
    expect(
      result.overlays.map(({ name, image }) => [
        name,
        image.mime,
        image.width,
        image.height,
      ]),
    ).toEqual([
      ["Overlay", "image/jpeg", 300, 200],
      ["Image", "image/webp", 640, 480],
      ["Image", "image/png", 4, 2],
    ]);
    expect(result.overlays[0].corners).toEqual([
      [0, 1],
      [2, 1],
      [2, 0],
      [0, 0],
    ]);
    expect(result.features).toEqual([]);
  });

  it("finds an image beside a document in a folder, by a path written as an address, and whatever its case", () => {
    const result = read(
      zip({
        "data/doc.kml": kml(
          overlay("images/my%20map.png") +
            overlay("./Images/TOP.PNG") +
            overlay("images/top.png"),
        ),
        "data/images/my map.png": png(2, 2),
        "images/top.png": png(3, 3),
      }),
    );
    expect(result.overlays.map((image) => image.image.width)).toEqual([2, 3, 3]);
  });

  it.each([
    [
      "an image on another server",
      "https://attacker.example/a.png",
      "1 link to other servers (icons, images, network links, schemas, models) was not followed.",
    ],
    [
      "an image on another server, without a scheme",
      "//attacker.example/a.png",
      "1 link to other servers (icons, images, network links, schemas, models) was not followed.",
    ],
    [
      "an image outside the archive",
      "../secret.png",
      "1 image overlay was left out: the image is not in the archive.",
    ],
    [
      "an image at an absolute path",
      "/etc/secret.png",
      "1 image overlay was left out: the image is not in the archive.",
    ],
    [
      "an image that is not there",
      "nowhere.png",
      "1 image overlay was left out: the image is not in the archive.",
    ],
    [
      "an entry that is no image file",
      "notes.txt",
      "1 image overlay was left out: the image is not in the archive.",
    ],
    [
      "bytes that are no image",
      "fake.png",
      "1 image overlay was left out: the image is not a PNG, a JPEG or a WebP that can be read.",
    ],
    [
      "an image whose header says it is huge",
      "huge.png",
      "1 image overlay was left out: an image has at most 4 MB and 8,192 pixels a side.",
    ],
    [
      "an image of more bytes than the limit",
      "heavy.png",
      "1 image overlay was left out: an image has at most 4 MB and 8,192 pixels a side.",
    ],
  ])("leaves out %s", (_what, href, note) => {
    const heavy = new Uint8Array(GEO_FILE_LIMITS.overlayBytes + 1);
    heavy.set(png(2, 2));
    const result = read(
      zip(
        {
          "doc.kml": kml(overlay(href) + placemark(POINT)),
          "secret.png": png(2, 2),
          "notes.txt": png(2, 2),
          "fake.png": "<svg onload='alert(1)'/>",
          "huge.png": png(20_000, 20_000, 1),
          "heavy.png": heavy,
        },
        0,
      ),
    );
    expect(result.overlays).toEqual([]);
    expect(result.notes).toEqual([note]);
  });

  it("leaves out an overlay whose box is not on the map", () => {
    const boxes = [
      "<north>1</north><south>2</south><east>2</east><west>1</west>",
      "<north>95</north><south>1</south><east>2</east><west>1</west>",
      "<north>2</north><south>1</south><east>x</east><west>1</west>",
      "",
    ];
    const result = read(
      zip({
        "doc.kml": kml(
          boxes.map((box) => overlay("a.png", box)).join("") + placemark(POINT),
        ),
        "a.png": png(2, 2),
      }),
    );
    expect(result.overlays).toEqual([]);
    expect(result.notes).toEqual([
      "An image overlay was left out: its box is not four positions on the map.",
    ]);
  });

  it("keeps at most eight overlays", () => {
    const result = read(
      zip({
        "doc.kml": kml(Array.from({ length: 11 }, () => overlay("a.png")).join("")),
        "a.png": png(2, 2),
      }),
    );
    expect(result.overlays).toHaveLength(GEO_FILE_LIMITS.overlays);
    expect(result.notes).toEqual([
      "The file has more than 8 image overlays. Only the first 8 are shown.",
    ]);
  });

  it("opens the first .kml of an archive, and no other", () => {
    const result = read(
      zip({
        "images/pin.png": png(2, 2),
        "doc.kml": kml(placemark(`<name>First</name>${POINT}`)),
        "other.kml": "<kml>broken",
      }),
    );
    expect(result.features.map((feature) => feature.name)).toEqual(["First"]);
  });

  it("reads a file as what its bytes are, whatever its name says", () => {
    expect(
      read(fixture("sample.kmz"), { name: "data.geojson", mime: "application/json" })
        .kind,
    ).toBe("kmz");
    expect(read(utf8(SAMPLE_KML), { name: "sample.zip" }).kind).toBe("kml");
  });
});

describe("kml: limits", () => {
  it("keeps the first 20,000 placemarks and says the file has more", () => {
    const result = readKml(placemark(POINT).repeat(GEO_FILE_LIMITS.features + 10));
    expect(result.features).toHaveLength(GEO_FILE_LIMITS.features);
    expect(result.notes).toEqual([
      "The file has more than 20,000 features. Only the first 20,000 are shown.",
    ]);
  });

  it("counts the positions of every shape together, and leaves out the one that does not fit", () => {
    const line = (count: number) =>
      placemark(
        `<name>${count}</name><LineString><coordinates>${"1,2 ".repeat(count)}</coordinates></LineString>`,
      );
    const result = readKml(
      line(60_000) + line(40_001) + line(40_000) + placemark(POINT),
    );
    expect(result.features.map((feature) => feature.name)).toEqual(["60000", "40000"]);
    expect(result.notes).toEqual([
      "2 shapes were left out: the lines and areas of one file have at most 100,000 positions together. Simplify the file to see all of it.",
    ]);
  });

  it("keeps the first 500 folders; what is in the others is in the folder around them", () => {
    const folders = Array.from(
      { length: GEO_FILE_LIMITS.groups + 20 },
      (_, at) => `<Folder><name>F${at}</name>${placemark(POINT)}</Folder>`,
    ).join("");
    const result = readKml(folders);
    expect(result.groups).toHaveLength(GEO_FILE_LIMITS.groups);
    expect(result.features).toHaveLength(GEO_FILE_LIMITS.groups + 20);
    expect(result.features.at(498)?.group).toBe(499);
    expect(result.features.at(-1)?.group).toBe(0);
    expect(result.notes).toEqual([
      "The file has more than 500 folders. What is in the others is shown in the folder around them.",
    ]);
  });

  it("lists at most 64 columns", () => {
    const marks = Array.from({ length: 100 }, (_, at) =>
      placemark(
        `<ExtendedData><Data name="c${at}"><value>${at}</value></Data></ExtendedData>${POINT}`,
      ),
    ).join("");
    const result = readKml(marks);
    expect(result.columns).toHaveLength(GEO_FILE_LIMITS.columns);
    expect(result.columns[0]).toEqual({ name: "c0", kind: "number" });
  });

  type Read = ReturnType<typeof read>;
  it.each([
    {
      limit: "features" as const,
      of: (count: number) => utf8(kml(placemark(POINT).repeat(count))),
      held: (result: Read) => result.features.length,
      notes: (most: string) => [
        `The file has more than ${most} features. Only the first ${most} are shown.`,
      ],
    },
    {
      limit: "groups" as const,
      of: (count: number) =>
        utf8(
          kml(
            Array.from(
              { length: count - 1 },
              (_, at) => `<Folder><name>F${at}</name>${placemark(POINT)}</Folder>`,
            ).join(""),
          ),
        ),
      held: (result: Read) => result.groups.length,
      notes: (most: string) => [
        `The file has more than ${most} folders. What is in the others is shown in the folder around them.`,
      ],
    },
    {
      limit: "columns" as const,
      of: (count: number) =>
        utf8(
          kml(
            Array.from({ length: count }, (_, at) =>
              placemark(
                `<ExtendedData><Data name="c${at}"><value>${at}</value></Data></ExtendedData>${POINT}`,
              ),
            ).join(""),
          ),
        ),
      held: (result: Read) => result.columns.length,
      notes: () => [],
    },
    {
      limit: "overlays" as const,
      of: (count: number) =>
        zip({
          "doc.kml": kml(
            Array.from({ length: count }, () => overlay("a.png")).join(""),
          ),
          "a.png": png(2, 2),
        }),
      held: (result: Read) => result.overlays.length,
      notes: (most: string) => [
        `The file has more than ${most} image overlays. Only the first ${most} are shown.`,
      ],
    },
  ])(
    "keeps exactly the limit of $limit, and no more of one more",
    ({ limit, of, held, notes }) => {
      const most = GEO_FILE_LIMITS[limit];
      const at = read(of(most));
      expect(held(at)).toBe(most);
      expect(at.notes).toEqual([]);
      const over = read(of(most + 1));
      expect(held(over)).toBe(most);
      expect(over.notes).toEqual(notes(most.toLocaleString("en-US")));
    },
  );

  it("reads the type of a field from its own list: a name every object has is no type", () => {
    const schema = (type: string) =>
      `<kml><Document><Schema id="s"><SimpleField name="n" type="${type}"/></Schema><Placemark><ExtendedData><SchemaData schemaUrl="#s"><SimpleData name="n">42</SimpleData></SchemaData></ExtendedData><Point><coordinates>1,2</coordinates></Point></Placemark></Document></kml>`;
    for (const type of ["constructor", "toString", "__proto__", "hasOwnProperty"])
      expect(read(utf8(schema(type))).features[0].properties, type).toEqual({
        n: "42",
      });
    expect(read(utf8(schema("int"))).features[0].properties).toEqual({ n: 42 });
  });
});
