import type { LayerSpecification, SourceSpecification } from "maplibre-gl";
import type { ContextSchema } from "~/lib/geo/mapContext";
import { BACKDROP_ZOOMS, sawBasemap } from "~/lib/geo/mapOffer";
import type { HeldMapSource } from "~/lib/geo/mapSourceTypes";
import { readAsset } from "~/host";
import type { MapSettings } from "~/settings";
import { type ContextStyle, contextLayers, stockContext } from "./basemapContext";
import { type BasemapLayers, openFreeMapLayers, protomapsLayers } from "./basemapStyle";

export type BasemapKind = "bundled" | "hosted" | "openfreemap";

export interface Basemap extends BasemapLayers {
  kind: BasemapKind;
  source: SourceSpecification;

  maxZoom: number;

  detailZoom: number;

  credit: string;

  schema: ContextSchema;

  context: ContextStyle[];
}

const withoutContext = ({ under, labels }: BasemapLayers): BasemapLayers => ({
  under: under.filter((layer) => stockContext(layer) === null),
  labels,
});

export const ASSET_PROTOCOL = "workspace-asset";
export const BUNDLED_BASEMAP = "basemap/world.pmtiles";

const OPENFREEMAP_TILES = "https://tiles.openfreemap.org/planet";

const OPENFREEMAP_DETAIL = 14;

export type BasemapProvider = MapSettings["mapTilesProvider"];

export const glyphsUrl = (): string =>
  `${ASSET_PROTOCOL}://basemap/fonts/{fontstack}/{range}.pbf`;

export const BASEMAP_RETRY_MS = 30_000;

interface Archive {
  url: string;
  layers: Set<string>;
  maxZoom: number;
}
const assetBytes = new Map<string, Promise<DataView>>();

function assetSource(path: string): import("pmtiles").Source {
  let bytes = assetBytes.get(path);
  if (!bytes) {
    bytes = readAsset(path);
    assetBytes.set(path, bytes);
    bytes.catch(() => assetBytes.delete(path));
  }
  const whole = bytes;
  return {
    getKey: () => path,
    getBytes: async (offset, length) => {
      const view = await whole;
      const start = view.byteOffset + offset;
      return { data: view.buffer.slice(start, start + length) as ArrayBuffer };
    },
  };
}

const archives = new Map<string, Promise<Archive | null> | { failedAt: number }>();
type PmtilesProtocol = import("pmtiles").Protocol;
let protocol: Promise<PmtilesProtocol> | undefined;

function pmtilesProtocol(lib: typeof import("maplibre-gl")): Promise<PmtilesProtocol> {
  if (protocol) return protocol;
  const loading = import("pmtiles").then(({ Protocol }) => {
    const reader = new Protocol();
    lib.addProtocol("pmtiles", reader.tile);
    return reader;
  });
  protocol = loading;

  loading.catch(() => {
    if (protocol === loading) protocol = undefined;
  });
  return loading;
}

function readArchive(
  lib: typeof import("maplibre-gl"),
  url: string,
): Promise<Archive | null> {
  const known = archives.get(url);
  if (known) {
    if (!("failedAt" in known)) return known;
    if (Date.now() - known.failedAt < BASEMAP_RETRY_MS) return Promise.resolve(null);
  }
  const loading: Promise<Archive | null> = import("pmtiles")
    .then(async ({ PMTiles, TileType }) => {
      const bundled = url === BUNDLED_BASEMAP;
      const absolute = bundled ? url : new URL(url).href;
      const archive = new PMTiles(
        bundled ? assetSource(absolute) : absolute,
      );
      const [header, metadata] = await Promise.all([
        archive.getHeader(),
        archive.getMetadata(),
      ]);
      if (header.tileType !== TileType.Mvt) return null;
      (await pmtilesProtocol(lib)).add(archive);
      const listed = (metadata as { vector_layers?: unknown } | null)?.vector_layers;
      const layers = new Set(
        (Array.isArray(listed) ? listed : []).flatMap((layer) =>
          layer && typeof layer.id === "string" ? [layer.id as string] : [],
        ),
      );
      return { url: absolute, layers, maxZoom: header.maxZoom };
    })
    .catch(() => {
      if (archives.get(url) === loading) archives.set(url, { failedAt: Date.now() });
      return null;
    });
  archives.set(url, loading);
  return loading;
}

const heldArchives = new Set<string>();

export async function readHeldArchives(
  lib: typeof import("maplibre-gl"),
  sources: readonly HeldMapSource[],
): Promise<void> {
  const files = sources.filter((source) => source.kind === "pmtiles");
  if (!files.length) return;
  const [reader, { PMTiles }] = await Promise.all([
    pmtilesProtocol(lib),
    import("pmtiles"),
  ]);
  for (const { url } of files) {
    if (heldArchives.has(url)) continue;
    heldArchives.add(url);
    reader.add(new PMTiles(url));
  }
}

let answers: Promise<boolean> | { failedAt: number } | undefined;

function serviceAnswers(): Promise<boolean> {
  if (answers) {
    if (!("failedAt" in answers)) return answers;
    if (Date.now() - answers.failedAt < BASEMAP_RETRY_MS) return Promise.resolve(false);
  }
  const asking = fetch(OPENFREEMAP_TILES, { signal: AbortSignal.timeout(5000) })
    .then(
      (response) => response.ok,
      () => false,
    )
    .then((ok) => {
      if (!ok && answers === asking) answers = { failedAt: Date.now() };
      return ok;
    });
  answers = asking;
  return asking;
}

export interface BasemapChoice {
  tilesUrl: string | null;

  provider: BasemapProvider;
}

const OSM = "© OpenStreetMap";

async function readBasemap(
  lib: typeof import("maplibre-gl"),
  choice: BasemapChoice,
  theme: "light" | "dark",
): Promise<Basemap | null> {
  try {
    if (choice.provider === "openfreemap" && (await serviceAnswers())) {
      const [light, dark] = await Promise.all([
        import("./styles/openfreemap-positron.json"),
        theme === "dark" ? import("./styles/openfreemap-dark.json") : null,
      ]);
      const names = light.default as LayerSpecification[];
      return {
        kind: "openfreemap",
        source: { type: "vector", url: OPENFREEMAP_TILES },
        ...withoutContext(
          openFreeMapLayers(
            dark ? (dark.default as LayerSpecification[]) : names,
            names,
            theme,
          ),
        ),
        schema: "openmaptiles",
        context: contextLayers("openmaptiles", theme, () => true, OPENFREEMAP_DETAIL),
        detailZoom: OPENFREEMAP_DETAIL,
        maxZoom: BACKDROP_ZOOMS.most,
        credit: `OpenFreeMap © OpenMapTiles, data ${OSM}`,
      };
    }
    const hosted = choice.tilesUrl ? await readArchive(lib, choice.tilesUrl) : null;
    const archive = hosted ?? (await readArchive(lib, BUNDLED_BASEMAP));
    if (!archive) return null;
    return {
      kind: hosted ? "hosted" : "bundled",
      source: { type: "vector", url: `pmtiles://${archive.url}` },
      ...withoutContext(
        await protomapsLayers(theme, (layer) => archive.layers.has(layer)),
      ),
      schema: "protomaps",
      context: contextLayers(
        "protomaps",
        theme,
        (layer) => archive.layers.has(layer),
        archive.maxZoom,
      ),

      maxZoom: Math.min(BACKDROP_ZOOMS.most, archive.maxZoom + BACKDROP_ZOOMS.past),
      detailZoom: archive.maxZoom,
      credit: `Protomaps ${OSM}`,
    };
  } catch {
    return null;
  }
}

export async function loadBasemap(
  lib: typeof import("maplibre-gl"),
  choice: BasemapChoice,
  theme: "light" | "dark",
): Promise<Basemap | null> {
  const basemap = await readBasemap(lib, choice, theme);
  sawBasemap(
    basemap
      ? {
          tiles: true,
          kind: basemap.kind,
          maxZoom: basemap.maxZoom,
          detailZoom: basemap.detailZoom,
        }
      : { tiles: false },
  );
  return basemap;
}
