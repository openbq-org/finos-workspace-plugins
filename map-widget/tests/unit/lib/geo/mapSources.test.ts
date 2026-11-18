import { describe, expect, it } from "vitest";
import { MAP_LIMITS } from "~/lib/codemode/limits";
import { declaredSourceIds, mapSourceDeclarations } from "~/lib/geo/mapSources";

const ndvi = {
  id: "ndvi",
  name: "NDVI (synthetic)",
  kind: "raster-tiles",
  endpoint: "tiles/ndvi/{z}/{x}/{y}.png",
  attribution: "Synthetic NDVI, reference backend",
  role: "overlay",
  opacity: 0.7,
  minzoom: 3,
  maxzoom: 9,
  bounds: [-104.1, 36.0, -80.5, 49.4],
  tileSize: 256,
};
const vector = {
  id: "zcta",
  kind: "vector-tiles",
  endpoint: "tiles/zcta/{z}/{x}/{y}.pbf",
  attribution: "Census",
  layers: [
    {
      sourceLayer: "zcta",
      type: "fill",
      color: { property: "value", scale: "sequential", domain: [0, 10] },
      opacity: 0.8,
      label: "name",
    },
    { sourceLayer: "zcta", type: "line", color: "#ABC", width: 1 },
  ],
};
const image = {
  id: "scan",
  kind: "image",
  endpoint: "images/scan.png",
  attribution: "Survey",
  coordinates: [
    [-100, 45],
    [-90, 45],
    [-90, 40],
    [-100, 40],
  ],
};

const terrain = {
  id: "terrain",
  name: "Terrain (synthetic)",
  kind: "raster-dem",
  endpoint: "tiles/terrain/{z}/{x}/{y}.png",
  attribution: "Synthetic elevation, reference backend",
  encoding: "terrarium",
  opacity: 0.8,
  minzoom: 3,
  maxzoom: 10,
  bounds: [-104.1, 36.0, -80.5, 49.4],
  tileSize: 256,
};

const one = (source: unknown) => mapSourceDeclarations([source]);
const taken = (source: unknown) => one(source).sources[0];
const reason = (source: unknown) => one(source).refused[0]?.reason ?? "";
const with_ = (patch: Record<string, unknown>, base: object = ndvi) => ({
  ...base,
  ...patch,
});

describe("mapSourceDeclarations", () => {
  it("copies the listed fields of the declaration of the brief", () => {
    expect(one(ndvi)).toEqual({ sources: [ndvi], refused: [] });
  });

  it("gives defaults: the id as the name, and the role overlay", () => {
    const { name: _name, role: _role, ...rest } = ndvi;
    expect(taken(rest)).toMatchObject({ name: "ndvi", role: "overlay" });
  });

  it("reads nothing as no source, and something that is no list as a refusal", () => {
    expect(mapSourceDeclarations(undefined)).toEqual({ sources: [], refused: [] });
    expect(mapSourceDeclarations(null)).toEqual({ sources: [], refused: [] });
    expect(mapSourceDeclarations({ 0: ndvi }).refused).toHaveLength(1);
    expect(mapSourceDeclarations("ndvi").sources).toEqual([]);
  });

  it("is idempotent, and returns copies", () => {
    const raw = [ndvi, vector, image];
    const first = mapSourceDeclarations(raw);
    expect(first.refused).toEqual([]);
    expect(mapSourceDeclarations(first.sources)).toEqual(first);
    expect(first.sources[0]).not.toBe(raw[0]);
    expect(first.sources[0].bounds).not.toBe(ndvi.bounds);
    expect(first.sources[1].layers).not.toBe(vector.layers);
    expect(first.sources[1].layers?.[1].color).toBe("#abc");
  });

  it("does not copy a key that is not listed", () => {
    const source = taken(
      with_({
        headers: { Authorization: "x" },
        tiles: ["https://evil.example/{z}/{x}/{y}.png"],
        glyphs: "https://evil.example/{fontstack}/{range}.pbf",
        sprite: "https://evil.example/sprite",
        paint: { "raster-opacity": ["get", "x"] },
        origin: "https://evil.example",
        backend: "evil",
      }),
    );
    expect(Object.keys(source).sort()).toEqual(Object.keys(ndvi).sort());
    expect(JSON.stringify(source)).not.toContain("evil");
  });

  it("refuses an id outside the grammar and a second use of an id", () => {
    for (const id of [undefined, "", "NDVI", "a b", "-a", "a".repeat(41), 7, ["a"]])
      expect(reason(with_({ id }))).toContain('"id"');
    const twice = mapSourceDeclarations([ndvi, with_({ name: "again" })]);
    expect(twice.sources).toHaveLength(1);
    expect(twice.refused).toEqual([
      { id: "ndvi", reason: "another source of this widget has the same id." },
    ]);
  });

  it("refuses an unknown kind, and cog with what to serve", () => {
    expect(reason(with_({ kind: "wms" }))).toContain('"kind" must be one of');
    expect(reason(with_({ kind: ["raster-tiles"] }))).toContain('"kind"');
    expect(reason(with_({ kind: "cog", endpoint: "a.tif" }))).toContain(
      '"cog" is not supported yet',
    );
  });

  it("requires an attribution, as plain text on one line", () => {
    for (const attribution of [
      undefined,
      null,
      "",
      "   ",
      "\u0000\u0007",
      5,
      ["a"],
      {},
    ])
      expect(reason(with_({ attribution }))).toContain('"attribution" is required');
    expect(
      taken(with_({ attribution: " <b>USGS</b>\n\u202e\u0007 2024 " })).attribution,
    ).toBe("<b>USGS</b> 2024");
    expect(taken(with_({ attribution: "a".repeat(500) })).attribution).toHaveLength(
      MAP_LIMITS.attributionChars,
    );
    expect(taken(with_({ name: "n".repeat(500) })).name).toHaveLength(
      MAP_LIMITS.sourceNameChars,
    );
  });

  it("takes exactly one of endpoint and url", () => {
    expect(reason(with_({ endpoint: undefined }))).toContain("exactly one");
    expect(reason(with_({ url: "http://localhost:7791/t/{z}/{x}/{y}.png" }))).toContain(
      "exactly one",
    );
    const { endpoint: _endpoint, ...rest } = ndvi;
    expect(taken({ ...rest, url: "http://localhost:7791/t/{z}/{x}/{y}.png" }).url).toBe(
      "http://localhost:7791/t/{z}/{x}/{y}.png",
    );
  });

  it("wants the placeholders of tiles, those and no other", () => {
    for (const endpoint of [
      "tiles/ndvi.png",
      "tiles/{z}/{x}.png",
      "tiles/{z}/{x}/{y}/{r}.png",
      "tiles/{z}/{x}/{y}/{bbox-epsg-3857}",
      "tiles/{z}/{x}/{y}/{",
      "tiles/{z}/{x}/{y}}",
      "tiles/{Z}/{x}/{y}",
      "tiles/{z}/{x}/{y}/%7Bq%7D",
    ])
      expect(reason(with_({ endpoint })), endpoint).toContain("endpoint is not taken");
    expect(taken(with_({ endpoint: "wmts?l=a&z={z}&x={x}&y={y}" }))).toBeDefined();
    for (const kind of ["pmtiles", "geojson"])
      expect(reason(with_({ kind, endpoint: "data/{z}/{x}/{y}" })), kind).toContain(
        "placeholder",
      );
    expect(reason(with_({ endpoint: "images/{z}.png" }, image))).toContain(
      "placeholder",
    );
  });

  it("takes the role imagery for pictures only", () => {
    expect(taken(with_({ role: "imagery" })).role).toBe("imagery");
    expect(taken(with_({ role: "imagery" }, image)).role).toBe("imagery");
    expect(
      taken(with_({ kind: "pmtiles", endpoint: "a.pmtiles", role: "imagery" })).role,
    ).toBe("imagery");
    expect(reason(with_({ role: "imagery" }, vector))).toContain('role "imagery"');
    expect(
      reason(
        with_({
          kind: "pmtiles",
          endpoint: "a.pmtiles",
          role: "imagery",
          layers: vector.layers,
        }),
      ),
    ).toContain('role "imagery"');
    expect(reason(with_({ role: "basemap" }))).toContain('"role"');
  });

  it("checks opacity, zooms, bounds and the size of a tile", () => {
    for (const patch of [
      { opacity: -0.1 },
      { opacity: 1.1 },
      { opacity: "0.5" },
      { opacity: Number.NaN },
      { minzoom: -1 },
      { maxzoom: 23 },
      { minzoom: 2.5 },
      { minzoom: 9, maxzoom: 3 },
      { minzoom: 9, maxzoom: undefined, bounds: undefined, tileSize: 300 },
      { tileSize: "256" },
      { bounds: [-104, 36, -80] },
      { bounds: [-80, 36, -104, 49] },
      { bounds: [-104, 49, -80, 36] },
      { bounds: [-181, 36, -80, 49] },
      { bounds: [-104, 36, -80, 91] },
      { bounds: [-104, 36, -80, Number.POSITIVE_INFINITY] },
      { bounds: "-104,36,-80,49" },
    ])
      expect(one(with_(patch)).sources, JSON.stringify(patch)).toEqual([]);
    expect(taken(with_({ tileSize: 512 })).tileSize).toBe(512);
    expect(taken(with_({ tileSize: 512 }, image)).tileSize).toBeUndefined();
  });

  it.each([
    { opacity: 0 },
    { opacity: 1 },
    { minzoom: 0 },
    { maxzoom: 22 },
    { minzoom: 0, maxzoom: 22 },
    { minzoom: 9, maxzoom: 9 },
    { bounds: [-180, -90, 180, 90] },
    { tileSize: 256 },
    { tileSize: 512 },
  ])("takes %j, which is on a bound", (patch) => {
    expect(one(with_(patch))).toEqual({
      sources: [{ ...ndvi, ...patch }],
      refused: [],
    });
  });

  it.each([
    [{ opacity: -0.01 }, '"opacity" must be a number from 0 to 1.'],
    [{ opacity: 1.01 }, '"opacity" must be a number from 0 to 1.'],
    [{ maxzoom: 23 }, '"maxzoom" must be a number from 0 to 22.'],
    [{ minzoom: 10, maxzoom: 9 }, '"minzoom" must not be over "maxzoom".'],
    [{ bounds: [-180.01, -90, 180, 90] }, '"bounds" must be'],
    [{ bounds: [-180, -90, 180, 90.01] }, '"bounds" must be'],
  ])("refuses %j, which is past one", (patch, why) => {
    expect(reason(with_(patch))).toContain(why);
  });

  it("requires the four corners of an image, and keeps them for an image only", () => {
    expect(taken(image).coordinates).toEqual(image.coordinates);
    for (const coordinates of [
      undefined,
      [],
      image.coordinates.slice(0, 3),
      [...image.coordinates.slice(0, 3), [-100, 95]],
      [...image.coordinates.slice(0, 3), [-100, "40"]],
      [...image.coordinates.slice(0, 3), [-100, 40, 0]],
    ])
      expect(reason(with_({ coordinates }, image))).toContain('"coordinates"');
    expect(
      taken(with_({ coordinates: image.coordinates })).coordinates,
    ).toBeUndefined();
  });

  it("reads the style layers of vector data as a short declarative list", () => {
    expect(taken(vector).layers).toEqual([
      vector.layers[0],
      { ...vector.layers[1], color: "#abc" },
    ]);
    const styled = (layer: unknown, base: object = vector) =>
      one(with_({ layers: [layer] }, base));
    const good = vector.layers[0];
    for (const patch of [
      { type: "symbol" },
      { type: "raster" },
      { sourceLayer: undefined },
      { sourceLayer: "x".repeat(81) },
      { sourceLayer: "a\nb" },
      { color: "red" },
      { color: "rgb(1,2,3)" },
      { color: ["get", "value"] },
      { color: { property: "value", scale: "log", domain: [0, 1] } },
      { color: { property: "value", scale: "diverging", domain: [1, 1] } },
      { color: { property: "value", scale: "diverging", domain: [0] } },
      { color: { property: ["get", "v"], scale: "diverging", domain: [0, 1] } },
      { color: { property: "p".repeat(81), scale: "diverging", domain: [0, 1] } },
      { opacity: 2 },
      { opacity: ["interpolate"] },
      { width: 21 },
      { radius: 41 },
      { radius: -1 },
      { label: 5 },
      { label: "l".repeat(81) },
    ])
      expect(styled({ ...good, ...patch }).sources, JSON.stringify(patch)).toEqual([]);
    expect(styled("fill").sources).toEqual([]);
    expect(one(with_({ layers: [] }, vector)).sources).toEqual([]);
    expect(one(with_({ layers: undefined }, vector)).refused[0].reason).toContain(
      "vector tiles need",
    );
    expect(
      one(with_({ layers: Array.from({ length: 9 }, () => good) }, vector)).sources,
    ).toEqual([]);

    const extra = styled({
      ...good,
      filter: ["==", "a", "b"],
      paint: { "fill-color": ["get", "c"] },
      layout: { "icon-image": "x" },
    }).sources[0].layers?.[0];
    expect(extra).toEqual(good);
  });

  it.each([
    { opacity: 0 },
    { opacity: 1 },
    { width: 0 },
    { width: 20 },
    { radius: 0 },
    { radius: 40 },
  ])("takes a style layer with %j, which is on a bound", (patch) => {
    const layer = { ...vector.layers[0], ...patch };
    expect(one(with_({ layers: [layer] }, vector))).toEqual({
      sources: [{ ...vector, name: vector.id, role: "overlay", layers: [layer] }],
      refused: [],
    });
  });

  it("takes as many style layers as a source has at most, and refuses one more", () => {
    const most = MAP_LIMITS.sourceStyleLayers;
    const styled = (count: number) =>
      one(
        with_(
          { layers: Array.from({ length: count }, () => vector.layers[0]) },
          vector,
        ),
      );
    expect(styled(most).refused).toEqual([]);
    expect(styled(most).sources[0].layers).toHaveLength(most);
    expect(styled(most + 1)).toEqual({
      sources: [],
      refused: [
        { id: vector.id, reason: `"layers" must be a list of 1 to ${most} layers.` },
      ],
    });
  });

  it("keeps layers for vector data only, and no layer name for GeoJSON", () => {
    expect(taken(with_({ layers: vector.layers })).layers).toBeUndefined();
    const geojson = taken({
      id: "fields",
      kind: "geojson",
      endpoint: "fields.geojson",
      attribution: "Farm",
      layers: [{ sourceLayer: "ignored", type: "circle", color: "#112233", radius: 4 }],
    });
    expect(geojson.layers).toEqual([{ type: "circle", color: "#112233", radius: 4 }]);
    expect(
      taken({ id: "f", kind: "geojson", endpoint: "f.geojson", attribution: "Farm" }),
    ).toBeDefined();
    expect(
      taken({
        id: "p",
        kind: "pmtiles",
        endpoint: "p.pmtiles",
        attribution: "A",
        layers: [{ sourceLayer: "roads", type: "line", color: "#000" }],
      }).layers,
    ).toHaveLength(1);
  });
});

describe("mapSourceDeclarations: elevation (raster-dem)", () => {
  it("copies the listed fields, with the role overlay", () => {
    expect(one(terrain)).toEqual({
      sources: [{ ...terrain, role: "overlay" }],
      refused: [],
    });
    expect(taken(with_({ role: "overlay" }, terrain)).role).toBe("overlay");
    expect(taken(with_({ encoding: "mapbox", tileSize: 512 }, terrain))).toMatchObject({
      encoding: "mapbox",
      tileSize: 512,
    });
  });

  it("is idempotent", () => {
    const first = one(terrain).sources;
    expect(mapSourceDeclarations(first).sources).toEqual(first);
  });

  it.each([
    [undefined],
    [null],
    ["Terrarium"],
    ["custom"],
    ["https://attacker.example/decode"],
    [7],
    [["terrarium"]],
    [{ redFactor: 256 }],
  ])("requires the encoding terrarium or mapbox, and refuses %j", (encoding) => {
    const read = one(with_({ encoding }, terrain));
    expect(read.sources).toEqual([]);
    expect(read.refused[0].reason).toContain('"encoding"');
    expect(read.refused[0].reason).not.toContain("attacker");
  });

  it("is never a backdrop: elevation is shaded relief over the basemap", () => {
    expect(reason(with_({ role: "imagery" }, terrain))).toContain('"role"');
    expect(reason(with_({ role: "terrain" }, terrain))).toContain('"role"');
  });

  it("requires an attribution, and an address of tiles under the rules of raster tiles", () => {
    expect(reason(with_({ attribution: undefined }, terrain))).toContain("attribution");
    for (const patch of [
      { endpoint: "tiles/terrain.png" },
      { endpoint: "tiles/terrain/{z}/{x}.png" },
      { endpoint: "tiles/terrain/{z}/{x}/{y}/{s}.png" },
      { endpoint: "../tiles/terrain/{z}/{x}/{y}.png" },
      { endpoint: "tiles//terrain/{z}/{x}/{y}.png" },
      { endpoint: "//attacker.example/{z}/{x}/{y}.png" },
      { endpoint: undefined },
      { endpoint: undefined, url: "https://{z}.attacker.example/{x}/{y}.png" },
      { endpoint: undefined, url: "https://user:pw@data.example/{z}/{x}/{y}.png" },
      { endpoint: undefined, url: "javascript:alert(1)//{z}/{x}/{y}" },
      { url: "https://data.example/{z}/{x}/{y}.png" },
    ])
      expect(one(with_(patch, terrain)).sources, JSON.stringify(patch)).toEqual([]);
    expect(
      taken(
        with_(
          { endpoint: undefined, url: "https://data.example/dem/{z}/{x}/{y}.png" },
          terrain,
        ),
      ).url,
    ).toBe("https://data.example/dem/{z}/{x}/{y}.png");
  });

  it("checks zooms, bounds, opacity and the size of a tile as for raster tiles", () => {
    for (const patch of [
      { opacity: 2 },
      { minzoom: 11, maxzoom: 3 },
      { maxzoom: 30 },
      { tileSize: 1024 },
      { bounds: [0, 0, 0, 0] },
    ])
      expect(one(with_(patch, terrain)).sources, JSON.stringify(patch)).toEqual([]);
  });

  it("copies nothing of the map library, and keeps the encoding for elevation only", () => {
    const read = taken({
      ...terrain,
      redFactor: 256,
      greenFactor: 1,
      blueFactor: 1 / 256,
      baseShift: 32768,
      tiles: ["https://attacker.example/{z}/{x}/{y}.png"],
      headers: { Authorization: "x" },
      terrain: { exaggeration: 9 },
      paint: { "hillshade-shadow-color": "url(https://attacker.example)" },
      layers: [{ type: "hillshade" }],
      coordinates: [[0, 0]],
    });
    expect(read).toEqual({ ...terrain, role: "overlay" });
    expect(JSON.stringify(read)).not.toContain("attacker");
    expect(taken(with_({ encoding: "terrarium" })).encoding).toBeUndefined();
  });
});

describe("mapSourceDeclarations with hostile input", () => {
  const endpoints = [
    "javascript:alert(1)//{z}/{x}/{y}",
    "data:image/png;base64,AAAA/{z}/{x}/{y}",
    "blob:http://localhost/{z}/{x}/{y}",
    "file:///etc/passwd/{z}/{x}/{y}",
    "http://evil.example/{z}/{x}/{y}.png",
    "https://evil.example/{z}/{x}/{y}.png",
    "//evil.example/{z}/{x}/{y}.png",
    "/\\evil.example/{z}/{x}/{y}.png",
    "\\\\evil.example\\{z}\\{x}\\{y}.png",
    "tiles/../../admin/{z}/{x}/{y}",
    "../{z}/{x}/{y}",
    "tiles/./{z}/{x}/{y}",
    "tiles/%2e%2e/{z}/{x}/{y}",
    "tiles/%2E%2e/{z}/{x}/{y}",
    "tiles/.%2e/{z}/{x}/{y}",
    "tiles/%252e%252e/{z}/{x}/{y}",
    "tiles%2f..%2f{z}/{x}/{y}",
    "tiles%5c..%5c{z}/{x}/{y}",
    "tiles/{z}/{x}/{y}%00.png",
    "tiles/{z}/{x}/{y}%",
    "user@evil.example/{z}/{x}/{y}",
    "tiles/{z}/{x}/{y}.png#@evil.example",
    "tiles/ {z}/{x}/{y}.png",
    "tiles/\t{z}/{x}/{y}.png",
    "tiles/\n{z}/{x}/{y}.png",
    "tiles/\u0000{z}/{x}/{y}.png",
    "tiles/\u202e{z}/{x}/{y}.png",
    "tiles/ {z}/{x}/{y}.png",
    "tiles/‥/{z}/{x}/{y}.png",
    "tiles/．．/{z}/{x}/{y}.png",
    "?z={z}&x={x}&y={y}",
    `tiles/{z}/{x}/{y}${"a".repeat(MAP_LIMITS.sourceUrlChars)}`,
  ];
  it.each(endpoints)("refuses the endpoint %j", (endpoint) => {
    expect(one(with_({ endpoint }))).toEqual({
      sources: [],
      refused: [
        { id: "ndvi", reason: expect.stringContaining("endpoint is not taken") },
      ],
    });
  });

  const urls = [
    "javascript:alert(1)//{z}/{x}/{y}",
    "data:image/png;base64,AAAA/{z}/{x}/{y}",
    "blob:http://localhost:7791/{z}/{x}/{y}",
    "file:///tiles/{z}/{x}/{y}",
    "ftp://localhost:7791/{z}/{x}/{y}",
    "//localhost:7791/{z}/{x}/{y}",
    "HTTP://localhost:7791/{z}/{x}/{y}",
    "http：//localhost:7791/{z}/{x}/{y}",
    "https∶//localhost:7791/{z}/{x}/{y}",
    "http:/localhost:7791/{z}/{x}/{y}",
    "http:\\\\localhost:7791\\{z}\\{x}\\{y}",
    "http://user:pass@localhost:7791/{z}/{x}/{y}",
    "http://user@localhost:7791/{z}/{x}/{y}",
    "http://localhost:7791@evil.example/{z}/{x}/{y}",
    "http://{z}.evil.example/{x}/{y}",
    "http://tiles-{z}.localhost:7791/{z}/{x}/{y}",
    "http://{z}/{x}/{y}",
    "http://LOCALHOST:7791/{z}/{x}/{y}",
    "http://localhost.:7791/{z}/{x}/{y}",
    "http://bücher.example/{z}/{x}/{y}",
    "http://localhost:7791\\@evil.example/{z}/{x}/{y}",
    "http://localhost:7791#@evil.example/{z}/{x}/{y}",
    "http://localhost:7791?@evil.example/{z}/{x}/{y}",
    "http://[::1]:7791/{z}/{x}/{y}",
    "http://localhost:7791/a/../{z}/{x}/{y}",
    "http://localhost:7791/a/%2e%2e/{z}/{x}/{y}",
    "http://localhost:7791//evil.example/{z}/{x}/{y}",
    "http://localhost:7791",
    "http://localhost:7791/",
    " http://localhost:7791/{z}/{x}/{y}",
  ];
  it.each(urls)("refuses the url %j", (url) => {
    const { endpoint: _endpoint, ...rest } = ndvi;
    expect(one({ ...rest, url })).toEqual({
      sources: [],
      refused: [{ id: "ndvi", reason: expect.stringContaining("url is not taken") }],
    });
  });

  it("does not take an address that is no text", () => {
    for (const endpoint of [5, true, ["tiles/{z}/{x}/{y}"], { url: "x" }, ""])
      expect(one(with_({ endpoint })).sources).toEqual([]);
  });

  it("reads own values only", () => {
    const inherited = Object.create(ndvi);
    expect(one(inherited).sources).toEqual([]);
    const polluted = JSON.parse(
      JSON.stringify(ndvi).replace(
        "{",
        '{"__proto__":{"url":"http://evil.example/{z}/{x}/{y}","role":"imagery"},"constructor":{"prototype":{"x":1}},',
      ),
    );
    const source = taken(polluted);
    expect(source).toEqual(ndvi);
    expect(Object.keys(source)).not.toContain("__proto__");
    expect(({} as { url?: string }).url).toBeUndefined();
  });

  it("never throws, whatever a declaration is", () => {
    const thrower = new Proxy(
      {},
      {
        get: () => {
          throw new Error("no");
        },
        getOwnPropertyDescriptor: () => {
          throw new Error("no");
        },
      },
    );
    const loop: Record<string, unknown> = { ...ndvi };
    loop.layers = [loop];
    for (const item of [null, 5, "ndvi", [], [ndvi], thrower, loop, () => ndvi])
      expect(() => mapSourceDeclarations([item])).not.toThrow();
    expect(mapSourceDeclarations([thrower])).toEqual({
      sources: [],
      refused: [{ reason: "it could not be read." }],
    });
  });

  it("reads the first declarations only, of 10,000", () => {
    const many = Array.from({ length: 10_000 }, (_, index) =>
      with_({ id: `s${index}` }),
    );
    const { sources, refused } = mapSourceDeclarations(many);
    expect(sources).toHaveLength(MAP_LIMITS.sources);
    expect(refused).toEqual([
      { reason: expect.stringContaining("at most 16 sources") },
    ]);
  });

  it("reads as many declarations as a widget has at most, and says that one more is not read", () => {
    const most = MAP_LIMITS.sources;
    const declared = (count: number) =>
      Array.from({ length: count }, (_, index) => with_({ id: `s${index}` }));
    expect(mapSourceDeclarations(declared(most))).toEqual({
      sources: declared(most),
      refused: [],
    });
    expect(mapSourceDeclarations(declared(most + 1))).toEqual({
      sources: declared(most),
      refused: [
        {
          reason: `a widget declares at most ${most} sources: the others are not read.`,
        },
      ],
    });
  });

  it("takes an address of as many characters as an address has at most, and refuses one more", () => {
    const most = MAP_LIMITS.sourceUrlChars;
    const tiles = "tiles/{z}/{x}/{y}";
    const endpoint = (chars: number) => `${tiles}${"a".repeat(chars - tiles.length)}`;
    expect(endpoint(most)).toHaveLength(most);
    expect(taken(with_({ endpoint: endpoint(most) })).endpoint).toBe(endpoint(most));
    expect(one(with_({ endpoint: endpoint(most + 1) })).sources).toEqual([]);
    expect(reason(with_({ endpoint: endpoint(most + 1) }))).toContain(
      `it is longer than ${most} characters`,
    );
  });

  it("cuts huge texts and refuses a huge address", () => {
    const huge = "x".repeat(2_000_000);
    expect(taken(with_({ name: huge, attribution: huge })).name).toHaveLength(60);
    expect(one(with_({ endpoint: `${huge}/{z}/{x}/{y}` })).sources).toEqual([]);
    expect(one(with_({ id: huge })).refused[0].id).toBeUndefined();
  });
});

describe("declaredSourceIds", () => {
  it("gives the ids of the sources a mapping declares, and nothing else", () => {
    expect(
      declaredSourceIds({
        county: "fips",
        sources: [ndvi, with_({ id: "BAD" }), image],
      }),
    ).toEqual(["ndvi", "scan"]);
    for (const mapping of [undefined, null, "x", [], {}, { sources: "ndvi" }])
      expect(declaredSourceIds(mapping)).toEqual([]);
  });
});
