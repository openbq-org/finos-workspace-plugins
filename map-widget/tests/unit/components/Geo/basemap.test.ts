import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PMTiles, TileType } from "pmtiles";
import type { Topology } from "topojson-specification";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Basemap, BUNDLED_BASEMAP, glyphsUrl } from "~/components/Geo/basemap";
import type { BasemapLayers } from "~/components/Geo/basemapStyle";
import { buildScene } from "~/components/Geo/mapScene";
import { MAP_THEMES } from "~/components/Geo/mapTheme";
import { BASEMAP_URL_CHARS, hostedBasemapUrl } from "~/lib/geo/basemapUrl";
import { MAP_CONTEXT_IDS } from "~/lib/geo/mapContext";
import { BACKDROP_ZOOMS } from "~/lib/geo/mapOffer";
import type { HeldMapSource } from "~/lib/geo/mapSourceTypes";
import { mapSpec } from "~/lib/geo/mapSpec";
import { boundariesOf } from "~/lib/geo/regions/boundaries";
import { getSettings } from "~/settings";

const fixture = readFileSync(join(process.cwd(), "tests/fixtures/geo/tiny.pmtiles"));
const world = boundariesOf(
  "countries",
  JSON.parse(
    readFileSync(
      join(process.cwd(), "vendor/geo/world-atlas-2.0.2/countries-110m.json"),
      "utf8",
    ),
  ) as Topology,
);
const FONTS = join(process.cwd(), "src/assets/basemap/fonts");
const lib = { addProtocol: vi.fn() } as unknown as typeof import("maplibre-gl");

const hostAssets = vi.hoisted(() => ({
  served: new Set<string>(),
  asked: [] as string[],
  fixture: new Uint8Array(),
}));
vi.mock("~/host", () => ({
  readAsset: vi.fn(async (path: string) => {
    hostAssets.asked.push(path);
    if (!hostAssets.served.has(path)) throw new Error("no such asset");
    const bytes = Uint8Array.from(hostAssets.fixture);
    return new DataView(bytes.buffer);
  }),
}));

const serve = (...served: string[]) => {
  const asked: string[] = hostAssets.asked;
  hostAssets.asked.length = 0;
  hostAssets.served = new Set(served.filter((url) => url === BUNDLED_BASEMAP));
  hostAssets.fixture = fixture;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      asked.push(url);
      if (!served.includes(url)) return new Response("no", { status: 404 });
      if (url === SERVICE) return new Response("{}");
      const header = new Headers(
        input instanceof Request ? input.headers : init?.headers,
      ).get("range");
      const [from, to] = (header ?? "bytes=0-").replace("bytes=", "").split("-");
      const end = to ? Number(to) + 1 : fixture.length;
      return new Response(Uint8Array.from(fixture.subarray(Number(from), end)), {
        status: 206,
        headers: { etag: "tiny" },
      });
    }),
  );
  return asked;
};
const SERVICE = "https://tiles.openfreemap.org/planet";
const everyLayer = (basemap: Basemap) => [...basemap.under, ...basemap.labels];
const origin = window.location.origin;

const loadBasemap: typeof import("~/components/Geo/basemap").loadBasemap = async (
  ...args
) => (await import("~/components/Geo/basemap")).loadBasemap(...args);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("the basemap", () => {
  it("has no operator address and no tile service by default", () => {
    expect(getSettings().mapTilesUrl).toBe("");
    expect(hostedBasemapUrl(getSettings().mapTilesUrl)).toBeNull();
  });

  it.each([
    ["https://maps.example/world.pmtiles"],
    ["http://127.0.0.1:8080/us.pmtiles"],
    ["/maps/world.pmtiles"],
  ])("takes the address %s", (url) => {
    expect(hostedBasemapUrl(url)).toBe(url);
  });

  it.each([
    [""],
    ["  "],
    ["//evil.example/world.pmtiles"],
    ["javascript:alert(1)"],
    ["data:application/octet-stream;base64,AAAA"],
    ["file:///etc/passwd"],
    ["pmtiles://x"],
    ["world.pmtiles"],
    [null],
    [undefined],
    [42],
    [`https://x.example/${"a".repeat(3000)}`],
  ])("takes no address from %j", (value) => {
    expect(hostedBasemapUrl(value)).toBeNull();
  });

  it.each([
    ["https://maps.example/"],
    ["/maps/"],
  ])("takes an address under %s of exactly the longest length, and none of one character more", (start) => {
    const long = (chars: number) => start.padEnd(chars, "a");
    const longest = long(BASEMAP_URL_CHARS);
    expect(longest).toHaveLength(BASEMAP_URL_CHARS);
    expect(hostedBasemapUrl(longest)).toBe(longest);
    expect(hostedBasemapUrl(long(BASEMAP_URL_CHARS + 1))).toBeNull();

    expect(hostedBasemapUrl(`  ${longest}  `)).toBe(longest);
  });

  it("is the file the app serves itself by default, and asks no other address", async () => {
    const asked = serve(BUNDLED_BASEMAP);
    const basemap = await loadBasemap(
      lib,
      { tilesUrl: null, provider: "none" },
      "light",
    );
    expect(basemap?.kind).toBe("bundled");
    expect(basemap?.source).toEqual({
      type: "vector",
      url: `pmtiles://${BUNDLED_BASEMAP}`,
    });
    expect(basemap?.credit).toBe("Protomaps © OpenStreetMap");
    expect(new Set(asked)).toEqual(new Set([BUNDLED_BASEMAP]));
  });

  it("draws only the layers the archive has, none with an icon, and names as text over the data", async () => {
    serve(BUNDLED_BASEMAP);
    const basemap = (await loadBasemap(
      lib,
      { tilesUrl: null, provider: "none" },
      "dark",
    )) as Basemap;
    const sourceLayers = new Set(
      everyLayer(basemap).flatMap((layer) =>
        "source-layer" in layer && layer["source-layer"] ? [layer["source-layer"]] : [],
      ),
    );

    expect(sourceLayers).toEqual(new Set(["earth", "water", "boundaries"]));
    expect(basemap.labels.every((layer) => layer.type === "symbol")).toBe(true);
    expect(basemap.under.some((layer) => layer.type === "symbol")).toBe(false);
    expect(JSON.stringify(everyLayer(basemap))).not.toMatch(
      /icon-image|-pattern|https?:/,
    );
  });

  it("is no basemap when the file is not there: the map draws the boundary files", async () => {
    serve();
    expect(
      await loadBasemap(
        lib,
        { tilesUrl: "/maps/absent.pmtiles", provider: "none" },
        "light",
      ),
    ).toBeNull();
  });

  it("prefers the file the operator hosts", async () => {
    serve("https://maps.example/planet.pmtiles", BUNDLED_BASEMAP);
    const basemap = await loadBasemap(
      lib,
      { tilesUrl: "https://maps.example/planet.pmtiles", provider: "none" },
      "light",
    );
    expect(basemap?.kind).toBe("hosted");
    expect(basemap?.source).toEqual({
      type: "vector",
      url: "pmtiles://https://maps.example/planet.pmtiles",
    });
  });

  it.each([
    ["light"],
    ["dark"],
  ] as const)("with the provider on, takes tiles from that one host and nothing else of it (%s)", async (theme) => {
    const asked = serve(SERVICE);
    const basemap = (await loadBasemap(
      lib,
      { tilesUrl: null, provider: "openfreemap" },
      theme,
    )) as Basemap;
    expect(basemap.kind).toBe("openfreemap");
    expect(basemap.source).toEqual({
      type: "vector",
      url: "https://tiles.openfreemap.org/planet",
    });
    expect(basemap.credit).toContain("OpenStreetMap");
    expect(basemap.labels.length).toBeGreaterThan(3);

    const text = JSON.stringify(everyLayer(basemap));
    expect(text).not.toMatch(/https?:|icon-image|-pattern/);
    expect(
      everyLayer(basemap).every(
        (layer) =>
          layer.type === "background" ||
          ("source" in layer && layer.source === "basemap"),
      ),
    ).toBe(true);

    expect(asked).toEqual([SERVICE]);
  });

  it("draws the bundled basemap when the tile service does not answer", async () => {
    const asked = serve(BUNDLED_BASEMAP);
    const basemap = await loadBasemap(
      lib,
      { tilesUrl: null, provider: "openfreemap" },
      "light",
    );
    expect(basemap?.kind).toBe("bundled");
    expect(new Set(asked)).toEqual(new Set([SERVICE, BUNDLED_BASEMAP]));
  });

  it("names a place in English or in Latin letters, in a font the app has", async () => {
    serve(SERVICE);
    const { protomapsLayers } = await import("~/components/Geo/basemapStyle");
    for (const theme of ["light", "dark"] as const) {
      const { under, labels } = await protomapsLayers(theme, () => true);
      const text = JSON.stringify(labels);
      expect(text).not.toMatch(/Devanagari|script2|pgf:name|icon-image/);
      expect(labels.map((layer) => layer.id)).toEqual(
        expect.arrayContaining(["places_country", "places_region", "places_locality"]),
      );

      const region = labels.find((layer) => layer.id === "places_region");
      expect(JSON.stringify(region?.layout)).toContain('["get","ref"]');

      const width = (id: string) =>
        (under.find((layer) => layer.id === id)?.paint as Record<string, number>)[
          "line-width"
        ];
      expect(width("boundaries_country")).toBeGreaterThan(width("boundaries"));
      const tiles = await loadBasemap(
        lib,
        { tilesUrl: null, provider: "openfreemap" },
        theme,
      );
      expect(JSON.stringify(tiles?.labels)).not.toMatch(/nonlatin|icon-image/);
    }
  });

  it("gives the tile service the land, water and names of the theme", async () => {
    serve(SERVICE);
    const { protomapsLayers } = await import("~/components/Geo/basemapStyle");
    const paintOf = (layers: Basemap["under"], id: string) =>
      layers.find((layer) => layer.id === id)?.paint as Record<string, unknown>;
    for (const theme of ["light", "dark"] as const) {
      const own = await protomapsLayers(theme, () => true);
      const tiles = (await loadBasemap(
        lib,
        { tilesUrl: null, provider: "openfreemap" },
        theme,
      )) as Basemap;
      expect(paintOf(tiles.under, "water")["fill-color"]).toBe(
        paintOf(own.under, "water")["fill-color"],
      );
      expect(paintOf(tiles.under, "background")["background-color"]).toBe(
        paintOf(own.under, "earth")["fill-color"],
      );
    }

    const dark = (await loadBasemap(
      lib,
      { tilesUrl: null, provider: "openfreemap" },
      "dark",
    )) as Basemap;
    const colors = dark.under.flatMap((layer) =>
      Object.entries(layer.paint ?? {}).flatMap(([key, value]) =>
        key.endsWith("-color") && typeof value === "string" ? [value] : [],
      ),
    );

    expect(colors.length).toBeGreaterThan(15);
    expect(colors.filter((color) => !/^(hsla\(221, 30%|#)/.test(color))).toEqual([]);
  });

  it("holds every context layer on the tile service, and leaves its buildings, railways and runways to them", async () => {
    for (const theme of ["light", "dark"] as const) {
      const asked = serve(SERVICE);
      const basemap = (await loadBasemap(
        lib,
        { tilesUrl: null, provider: "openfreemap" },
        theme,
      )) as Basemap;
      expect(basemap.schema).toBe("openmaptiles");
      expect(basemap.context.map(({ id }) => id)).toEqual(MAP_CONTEXT_IDS);
      const stock = basemap.under.map((layer) => layer.id);
      expect(stock.filter((id) => /building|railway|aeroway/.test(id))).toEqual([]);
      expect(stock).toEqual(expect.arrayContaining(["water", "highway_minor"]));

      expect(asked).toEqual([SERVICE]);
      vi.resetModules();
    }
  });

  it("holds on a file only the context layers its tiles have", async () => {
    serve(BUNDLED_BASEMAP);
    const basemap = (await loadBasemap(
      lib,
      { tilesUrl: null, provider: "none" },
      "light",
    )) as Basemap;
    expect(basemap.schema).toBe("protomaps");
    expect(basemap.context).toEqual([]);
  });

  it("has a local glyph file for every font a label asks for", async () => {
    serve(BUNDLED_BASEMAP, SERVICE);
    const fonts = new Set<string>();
    const collect = (value: unknown) => {
      if (typeof value === "string" && value.startsWith("Noto Sans")) fonts.add(value);
      else if (Array.isArray(value)) value.forEach(collect);
    };
    for (const provider of ["none", "openfreemap"] as const)
      for (const theme of ["light", "dark"] as const) {
        const basemap = await loadBasemap(lib, { tilesUrl: null, provider }, theme);
        for (const layer of basemap?.labels ?? [])
          collect((layer.layout as Record<string, unknown>)["text-font"]);
      }
    const { layers, namedFlavor } = await import("@protomaps/basemaps");
    for (const layer of layers("basemap", namedFlavor("light"), { lang: "en" }))
      collect((layer.layout as Record<string, unknown> | undefined)?.["text-font"]);
    expect(fonts.size).toBeGreaterThan(1);
    for (const font of fonts)
      expect(existsSync(join(FONTS, font.replaceAll(" ", "-"), "0-255.pbf")), font).toBe(true);
    expect(glyphsUrl()).toBe("workspace-asset://basemap/fonts/{fontstack}/{range}.pbf");
  });

  it("matches the recorded checksum of every glyph file", () => {
    const lines = readFileSync(join(FONTS, "SHA256SUMS"), "utf8")
      .split("\n")
      .filter(Boolean);
    expect(lines.length).toBe(21);
    for (const line of lines) {
      const digest = line.slice(0, 64);
      const path = line.slice(66);
      expect(
        createHash("sha256")
          .update(readFileSync(join(FONTS, path)))
          .digest("hex"),
        path,
      ).toBe(digest);
    }
  });

  it("is the one source of a map with an address, and it is the deployment's", async () => {
    serve("https://maps.example/world.pmtiles");
    const basemap = await loadBasemap(
      lib,
      { tilesUrl: "https://maps.example/world.pmtiles", provider: "none" },
      "light",
    );
    const scene = buildScene({
      spec: mapSpec({
        points: [{ lat: 1, lon: 2 }],
        basemap: "https://attacker.example/x.pmtiles",
        glyphs: "https://attacker.example/{fontstack}/{range}.pbf",
      }),
      world,
      states: null,
      theme: MAP_THEMES.light,
      sea: "#ffffff",
      basemap,
    });
    const addressed = Object.entries(scene.sources).filter(
      ([, source]) => source.type !== "geojson",
    );
    expect(addressed).toEqual([
      [
        "basemap",
        { type: "vector", url: "pmtiles://https://maps.example/world.pmtiles" },
      ],
    ]);

    const ids = scene.style.map((layer) => layer.id);
    expect(ids).not.toContain("world-land");

    expect(ids.indexOf("points")).toBeGreaterThan(ids.indexOf("boundaries_country"));
    expect(JSON.stringify(scene)).not.toContain("attacker");
  });

  it("reads the fixture archive: vector tiles with the layers of the style", async () => {
    const archive = new PMTiles({
      getKey: () => "tiny",
      getBytes: async (offset: number, length: number) => ({
        data: fixture.buffer.slice(
          fixture.byteOffset + offset,
          fixture.byteOffset + offset + length,
        ) as ArrayBuffer,
      }),
    });
    const header = await archive.getHeader();
    expect([header.tileType, header.minZoom, header.maxZoom]).toEqual([
      TileType.Mvt,
      0,
      0,
    ]);
    const metadata = (await archive.getMetadata()) as {
      vector_layers: { id: string }[];
    };
    expect(metadata.vector_layers.map((layer) => layer.id)).toEqual([
      "earth",
      "water",
      "boundaries",
    ]);
    expect((await archive.getZxy(0, 0, 0))?.data.byteLength).toBeGreaterThan(1000);
  });
});

describe("a source of the basemap that failed", () => {
  const page = () => import("~/components/Geo/basemap");

  let clock = 0;
  const later = (ms: number) => {
    clock = ms;
  };
  beforeEach(() => {
    clock = 0;
    vi.spyOn(Date, "now").mockImplementation(() => 1_000_000 + clock);
  });
  afterEach(() => vi.restoreAllMocks());

  it("is read again by a later map: a file that was not there is drawn once it is", async () => {
    const { loadBasemap, BASEMAP_RETRY_MS } = await page();
    const choice = { tilesUrl: null, provider: "none" } as const;
    const failed = serve();
    expect(await loadBasemap(lib, choice, "light")).toBeNull();
    expect(failed).toEqual([BUNDLED_BASEMAP]);

    expect(await loadBasemap(lib, choice, "dark")).toBeNull();
    expect(failed).toHaveLength(1);

    const asked = serve(BUNDLED_BASEMAP);
    later(BASEMAP_RETRY_MS - 1);
    expect(await loadBasemap(lib, choice, "light")).toBeNull();
    expect(asked).toEqual([]);
    later(BASEMAP_RETRY_MS + 1);
    expect((await loadBasemap(lib, choice, "light"))?.kind).toBe("bundled");

    const before = asked.length;
    expect((await loadBasemap(lib, choice, "dark"))?.kind).toBe("bundled");
    expect(asked).toHaveLength(before);
  });

  it("is asked again by a later map: a tile service that did not answer is used once it does", async () => {
    const { loadBasemap, BASEMAP_RETRY_MS } = await page();
    const choice = { tilesUrl: null, provider: "openfreemap" } as const;
    const down = serve(BUNDLED_BASEMAP);
    expect((await loadBasemap(lib, choice, "light"))?.kind).toBe("bundled");
    expect((await loadBasemap(lib, choice, "light"))?.kind).toBe("bundled");
    expect(down.filter((url) => url === SERVICE)).toHaveLength(1);
    const up = serve(SERVICE, BUNDLED_BASEMAP);
    later(BASEMAP_RETRY_MS + 1);
    expect((await loadBasemap(lib, choice, "light"))?.kind).toBe("openfreemap");

    later(BASEMAP_RETRY_MS * 3);
    expect((await loadBasemap(lib, choice, "dark"))?.kind).toBe("openfreemap");
    expect(up.filter((url) => url === SERVICE)).toHaveLength(1);
  });

  it("is asked again when the request itself failed: no network", async () => {
    const { loadBasemap, BASEMAP_RETRY_MS } = await page();
    const choice = { tilesUrl: null, provider: "openfreemap" } as const;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    hostAssets.served.clear();
    expect(await loadBasemap(lib, choice, "light")).toBeNull();
    serve(SERVICE);
    later(BASEMAP_RETRY_MS + 1);
    expect((await loadBasemap(lib, choice, "light"))?.kind).toBe("openfreemap");
  });
});

describe("the dark basemap", () => {
  const luminance = (color: string) => {
    let rgb: number[];
    const hsl = /^hsla?\((\d+), (\d+)%, (\d+)%/.exec(color);
    if (hsl) {
      const [h, s, l] = [
        Number(hsl[1]) / 360,
        Number(hsl[2]) / 100,
        Number(hsl[3]) / 100,
      ];
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      const channel = (t: number) => {
        const x = (t + 1) % 1;
        if (x < 1 / 6) return p + (q - p) * 6 * x;
        if (x < 1 / 2) return q;
        if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
        return p;
      };
      rgb = [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
    } else {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
      rgb = [1, 3, 5].map((at) => Number.parseInt(color.slice(at, at + 2), 16) / 255);
    }
    const [r, g, b] = rgb.map((c) =>
      c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
  };
  const colorOf = (basemap: BasemapLayers, [id, key]: readonly [string, string]) => {
    const layer = [...basemap.under, ...basemap.labels].find((item) => item.id === id);
    const value = (layer?.paint as Record<string, unknown> | undefined)?.[key];
    expect(typeof value, `${id} ${key}`).toBe("string");
    return value as string;
  };

  it.each([
    [
      "bundled",
      {
        land: ["earth", "fill-color"],
        water: ["water", "fill-color"],
        roads: [
          ["roads_highway", "line-color"],
          ["roads_major", "line-color"],
        ],
        border: ["boundaries_country", "line-color"],
        names: ["places_locality", "places_country", "places_region"],
      },
    ],
    [
      "openfreemap",
      {
        land: ["background", "background-color"],
        water: ["water", "fill-color"],
        roads: [
          ["highway_minor", "line-color"],
          ["highway_major_inner", "line-color"],
          ["highway_major_casing", "line-color"],
          ["highway_motorway_casing", "line-color"],
        ],
        border: ["boundary_country_z5-", "line-color"],
        names: ["label_city", "label_town", "label_state", "label_country_1"],
      },
    ],
  ] as const)("keeps land, water, roads and names apart (%s)", async (kind, ids) => {
    serve(SERVICE);
    const { protomapsLayers } = await import("~/components/Geo/basemapStyle");
    const basemap =
      kind === "bundled"
        ? await protomapsLayers("dark", () => true)
        : ((await loadBasemap(
            lib,
            { tilesUrl: null, provider: "openfreemap" },
            "dark",
          )) as Basemap);
    const land = colorOf(basemap, ids.land);
    expect(contrast(land, colorOf(basemap, ids.water))).toBeGreaterThan(1.3);
    for (const road of ids.roads)
      expect(contrast(land, colorOf(basemap, road)), road[0]).toBeGreaterThan(1.3);
    expect(contrast(land, colorOf(basemap, ids.border))).toBeGreaterThan(2);
    for (const name of ids.names)
      expect(
        contrast(land, colorOf(basemap, [name, "text-color"])),
        name,
      ).toBeGreaterThan(4.5);
  });

  it("writes the place names of the tile service as the bundled style does: no capitals for a city, sizes by zoom", async () => {
    serve(SERVICE);
    for (const theme of ["light", "dark"] as const) {
      const basemap = (await loadBasemap(
        lib,
        { tilesUrl: null, provider: "openfreemap" },
        theme,
      )) as Basemap;
      const layout = (id: string) =>
        basemap.labels.find((layer) => layer.id === id)?.layout as Record<
          string,
          unknown
        >;
      for (const id of [
        "label_city",
        "label_city_capital",
        "label_town",
        "label_village",
      ]) {
        expect(layout(id)["text-transform"], id).toBeUndefined();
        expect(Array.isArray(layout(id)["text-size"]), id).toBe(true);
      }
    }
  });
});

describe("the script that fetches the basemap", () => {
  type Entry = { id: number; run: number; length: number; offset: number };
  const script = () =>
    import(
       join(process.cwd(), "scripts/fetch-basemap.mjs")
    ) as Promise<{
      PINNED: { build: string; maxZoom: number; sha256: string };
      readDirectory: (bytes: Uint8Array) => Entry[];
      writeDirectory: (entries: Entry[]) => Uint8Array;
      existingFile: (given: {
        digest: string | null;
        pinned: boolean;
        sha256: string;
      }) => "none" | "pinned" | "other";
      afterFailure: (given: {
        optional: boolean;
        required: boolean;
        existing: "none" | "pinned" | "other";
      }) => { exitCode: number; removeOutput: boolean };
      basemapRequired: (value: string | undefined) => boolean;
      mirrorUrl: (mirror: string, build: string, maxZoom: number) => string;
    }>;

  it("pins a build, its zooms and the SHA-256 of the file", async () => {
    const { PINNED } = await script();
    expect(PINNED.build).toMatch(/^\d{8}$/);

    expect(PINNED.maxZoom).toBe(BACKDROP_ZOOMS.bundled);
    expect(PINNED.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("finds the file of a build on a mirror at a path that names the build and its zooms", async () => {
    const { mirrorUrl } = await script();
    for (const mirror of [
      "https://mirror.test/basemap",
      "https://mirror.test/basemap/",
    ])
      expect(mirrorUrl(mirror, "20261009", 6)).toBe(
        "https://mirror.test/basemap/protomaps-20261009-z6/world.pmtiles",
      );
  });

  it("writes a directory that reads back the same, with shared and far offsets", async () => {
    const { readDirectory, writeDirectory } = await script();
    const entries: Entry[] = [
      { id: 0, run: 1, length: 93230, offset: 0 },
      { id: 1, run: 3, length: 500, offset: 93230 },

      { id: 5, run: 2000, length: 500, offset: 93230 },
      { id: 5461, run: 1, length: 7, offset: 5_000_000_000 },
    ];
    const { gunzipSync } = await import("fflate");
    const written = Uint8Array.from(writeDirectory(entries));
    expect(readDirectory(gunzipSync(written))).toEqual(entries);
  });
});

describe("what the fetch of the basemap does with the file that is there, and with a failure", () => {
  const script = () =>
    import( join(process.cwd(), "scripts/fetch-basemap.mjs"));
  const SHA = "c".repeat(64);

  it("knows the pinned file from any other one by its SHA-256", async () => {
    const { existingFile } = await script();
    expect(existingFile({ digest: null, pinned: true, sha256: SHA })).toBe("none");
    expect(existingFile({ digest: SHA, pinned: true, sha256: SHA })).toBe("pinned");
    expect(existingFile({ digest: "d".repeat(64), pinned: true, sha256: SHA })).toBe(
      "other",
    );

    expect(existingFile({ digest: SHA, pinned: false, sha256: SHA })).toBe("other");
  });

  it("fails the run when the fetch fails, unless the run is optional", async () => {
    const { afterFailure } = await script();
    expect(
      afterFailure({ optional: false, required: false, existing: "none" }),
    ).toEqual({ exitCode: 1, removeOutput: false });
    expect(afterFailure({ optional: true, required: false, existing: "none" })).toEqual(
      {
        exitCode: 0,
        removeOutput: false,
      },
    );
  });

  it("removes a file that is not the pinned one when an optional run could not replace it", async () => {
    const { afterFailure } = await script();

    expect(
      afterFailure({ optional: true, required: false, existing: "other" }),
    ).toEqual({ exitCode: 0, removeOutput: true });

    expect(
      afterFailure({ optional: false, required: false, existing: "other" }),
    ).toEqual({ exitCode: 1, removeOutput: false });
  });

  it("fails a build that requires the basemap, also when the run is optional", async () => {
    const { afterFailure } = await script();
    for (const existing of ["none", "other"] as const)
      expect(afterFailure({ optional: true, required: true, existing }).exitCode).toBe(
        1,
      );
    expect(
      afterFailure({ optional: true, required: true, existing: "other" }).removeOutput,
    ).toBe(true);
  });

  it("reads BASEMAP_REQUIRED as on only when it says so", async () => {
    const { basemapRequired } = await script();
    for (const on of ["1", "true", "TRUE", " yes "])
      expect(basemapRequired(on)).toBe(true);
    for (const off of [undefined, "", "0", "false", "no", "maybe"])
      expect(basemapRequired(off)).toBe(false);
  });

  it("keeps the fetched file out of git: the build fetches and checks it", () => {
    const ignored = readFileSync(join(process.cwd(), ".gitignore"), "utf8").split("\n");
    expect(ignored).toContain("src/assets/basemap/world.pmtiles");
    expect(readFileSync(join(process.cwd(), "build.mjs"), "utf8")).toMatch(
      /scripts\/fetch-basemap\.mjs/,
    );
  });
});

describe("the PMTiles files of the map sources", () => {
  const readHeldArchives: typeof import("~/components/Geo/basemap").readHeldArchives =
    async (...args) =>
      (await import("~/components/Geo/basemap")).readHeldArchives(...args);
  const file = (more: Partial<HeldMapSource> = {}): HeldMapSource => ({
    id: "soil",
    name: "Soil",
    kind: "pmtiles",
    attribution: "Reference",
    role: "overlay",
    url: "https://data.example/soil.pmtiles",
    origin: "https://data.example",
    backend: "https://data.example",
    headers: {},
    ...more,
  });

  it("registers the reader of PMTiles files once, and reads each file once", async () => {
    const addProtocol = vi.fn();
    const library = { addProtocol } as unknown as typeof import("maplibre-gl");
    await readHeldArchives(library, [file(), file()]);
    await readHeldArchives(library, [file()]);
    expect(addProtocol).toHaveBeenCalledTimes(1);
    expect(addProtocol.mock.calls[0][0]).toBe("pmtiles");
  });

  it("registers nothing when no source is a PMTiles file", async () => {
    const addProtocol = vi.fn();
    await readHeldArchives({ addProtocol } as unknown as typeof import("maplibre-gl"), [
      file({ kind: "raster-tiles", id: "x" }),
    ]);
    expect(addProtocol).not.toHaveBeenCalled();
  });
});
