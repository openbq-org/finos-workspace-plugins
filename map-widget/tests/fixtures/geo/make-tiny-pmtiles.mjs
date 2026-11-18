import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { GeoJSONVT } from "@maplibre/geojson-vt";
import { fromGeojsonVt } from "@maplibre/vt-pbf";
import { feature, mesh } from "topojson-client";

const here = dirname(fileURLToPath(import.meta.url));

export function tinyPmtiles() {
  const world = JSON.parse(
    readFileSync(
      join(here, "../../../vendor/geo/world-atlas-2.0.2/countries-110m.json"),
      "utf8",
    ),
  );
  const tileOf = (data) =>
    new GeoJSONVT(data, { maxZoom: 0, tolerance: 6 }).getTile(0, 0, 0);
  const layers = {
    earth: tileOf(feature(world, world.objects.land)),
    water: tileOf({
      type: "Feature",
      properties: { kind: "ocean" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-50, 20],
            [-30, 20],
            [-30, 40],
            [-50, 40],
            [-50, 20],
          ],
        ],
      },
    }),
    boundaries: tileOf({
      type: "Feature",
      properties: { kind: "country" },
      geometry: mesh(world, world.objects.countries, (a, b) => a !== b),
    }),
  };
  const tile = fromGeojsonVt(layers, { version: 2 });

  const varint = (value) => {
    const bytes = [];
    let rest = value;
    while (rest > 127) {
      bytes.push((rest & 127) | 128);
      rest = Math.floor(rest / 128);
    }
    bytes.push(rest);
    return bytes;
  };

  const directory = Uint8Array.from([
    ...varint(1),
    ...varint(0),
    ...varint(1),
    ...varint(tile.length),
    ...varint(1),
  ]);
  const metadata = new TextEncoder().encode(
    JSON.stringify({
      name: "tiny",
      description: "Test fixture: one tile of land, water and borders.",
      vector_layers: Object.keys(layers).map((id) => ({
        id,
        fields: {},
        minzoom: 0,
        maxzoom: 0,
      })),
    }),
  );

  const HEADER = 127;
  const header = new DataView(new ArrayBuffer(HEADER));
  new Uint8Array(header.buffer).set(new TextEncoder().encode("PMTiles"));
  header.setUint8(7, 3);
  const u64 = (at, value) => header.setBigUint64(at, BigInt(value), true);
  const rootAt = HEADER;
  const metadataAt = rootAt + directory.length;
  const tilesAt = metadataAt + metadata.length;
  u64(8, rootAt);
  u64(16, directory.length);
  u64(24, metadataAt);
  u64(32, metadata.length);
  u64(40, tilesAt);
  u64(48, 0);
  u64(56, tilesAt);
  u64(64, tile.length);
  u64(72, 1);
  u64(80, 1);
  u64(88, 1);
  header.setUint8(96, 1);
  header.setUint8(97, 1);
  header.setUint8(98, 1);
  header.setUint8(99, 1);
  header.setUint8(100, 0);
  header.setUint8(101, 0);
  header.setInt32(102, -180e7, true);
  header.setInt32(106, -85e7, true);
  header.setInt32(110, 180e7, true);
  header.setInt32(114, 85e7, true);
  header.setUint8(118, 0);
  header.setInt32(119, 0, true);
  header.setInt32(123, 0, true);

  const archive = new Uint8Array(tilesAt + tile.length);
  archive.set(new Uint8Array(header.buffer), 0);
  archive.set(directory, rootAt);
  archive.set(metadata, metadataAt);
  archive.set(tile, tilesAt);
  return archive;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const archive = tinyPmtiles();
  writeFileSync(join(here, "tiny.pmtiles"), archive);
  console.log(`tiny.pmtiles: ${archive.length} bytes`);
}
