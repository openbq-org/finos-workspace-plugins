import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "fflate";

export const PINNED = {
  build: "20261101",
  maxZoom: 6,
  sha256: "442b285095dac0674249c2bddf43384d98db4d13e751267f25a8e58a7a14425a",
};

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "../src/assets/basemap/world.pmtiles");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const build = option("build", PINNED.build);
const maxZoom = Number(option("maxzoom", PINNED.maxZoom));
const pinned = build === PINNED.build && maxZoom === PINNED.maxZoom && PINNED.sha256 !== "";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export const mirrorUrl = (mirror, build, maxZoom) =>
  `${mirror.replace(/\/+$/, "")}/protomaps-${build}-z${maxZoom}/world.pmtiles`;

export function existingFile({ digest, pinned, sha256: expected }) {
  if (digest === null) return "none";
  return pinned && digest === expected ? "pinned" : "other";
}

export const basemapRequired = (value) =>
  ["1", "true", "yes"].includes(String(value ?? "").trim().toLowerCase());

export function afterFailure({ optional, required, existing }) {
  return {
    exitCode: optional && !required ? 0 : 1,
    removeOutput: optional && existing === "other",
  };
}

const HEADER = 127;
const CHUNK = 8 * 1024 * 1024;

async function range(url, from, length) {
  const response = await fetch(url, { headers: { Range: `bytes=${from}-${from + length - 1}` } });
  if (response.status !== 206) throw new Error(`${url}: expected a range answer, got ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function readHeader(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, HEADER);
  if (new TextDecoder().decode(bytes.subarray(0, 7)) !== "PMTiles" || bytes[7] !== 3)
    throw new Error("Not a PMTiles version 3 archive.");
  const u64 = (at) => Number(view.getBigUint64(at, true));
  return {
    rootOffset: u64(8),
    rootLength: u64(16),
    metadataOffset: u64(24),
    metadataLength: u64(32),
    leafOffset: u64(40),
    tileOffset: u64(56),
    internalCompression: bytes[97],
    tileCompression: bytes[98],
    tileType: bytes[99],
  };
}

const unpacked = (bytes, compression) => {
  if (compression === 1) return bytes;
  if (compression === 2) return gunzipSync(bytes);
  throw new Error(`The archive uses a compression this script does not read (${compression}).`);
};

export function readDirectory(bytes) {
  let at = 0;
  const varint = () => {
    let value = 0;
    let shift = 1;
    for (;;) {
      const byte = bytes[at++];
      value += (byte & 127) * shift;
      if (byte < 128) return value;
      shift *= 128;
    }
  };
  const count = varint();
  const entries = Array.from({ length: count }, () => ({ id: 0, run: 0, length: 0, offset: 0 }));
  let id = 0;
  for (const entry of entries) {
    id += varint();
    entry.id = id;
  }
  for (const entry of entries) entry.run = varint();
  for (const entry of entries) entry.length = varint();
  entries.forEach((entry, index) => {
    const value = varint();
    entry.offset = value === 0 && index > 0 ? entries[index - 1].offset + entries[index - 1].length : value - 1;
  });
  return entries;
}

export function writeDirectory(entries) {
  const bytes = [];
  const varint = (value) => {
    let rest = value;
    while (rest > 127) {
      bytes.push((rest % 128) | 128);
      rest = Math.floor(rest / 128);
    }
    bytes.push(rest);
  };
  varint(entries.length);
  let before = 0;
  for (const entry of entries) {
    varint(entry.id - before);
    before = entry.id;
  }
  for (const entry of entries) varint(entry.run);
  for (const entry of entries) varint(entry.length);
  entries.forEach((entry, index) => {
    const follows = index > 0 && entry.offset === entries[index - 1].offset + entries[index - 1].length;
    varint(follows ? 0 : entry.offset + 1);
  });
  return gzipSync(Uint8Array.from(bytes), { level: 9, mtime: 0 });
}

async function extract(url) {
  const head = await range(url, 0, 16384);
  const header = readHeader(head);

  const ids = (4 ** (maxZoom + 1) - 1) / 3;
  const tiles = [];
  const visit = async (directory) => {
    for (const entry of directory) {
      if (entry.id >= ids) break;
      if (entry.run === 0) {
        const leaf = await range(url, header.leafOffset + entry.offset, entry.length);
        await visit(readDirectory(unpacked(leaf, header.internalCompression)));
      } else tiles.push({ ...entry, run: Math.min(entry.run, ids - entry.id) });
    }
  };
  await visit(
    readDirectory(
      unpacked(head.subarray(header.rootOffset, header.rootOffset + header.rootLength), header.internalCompression),
    ),
  );
  const end = Math.max(...tiles.map((tile) => tile.offset + tile.length));
  console.log(`${tiles.length} tile entries of zoom 0 to ${maxZoom}, ${(end / 1048576).toFixed(1)} MB of tile data`);
  const data = new Uint8Array(end);
  for (let from = 0; from < end; from += CHUNK) {
    data.set(await range(url, header.tileOffset + from, Math.min(CHUNK, end - from)), from);
    process.stdout.write(`\r${Math.round((Math.min(end, from + CHUNK) / end) * 100)}%`);
  }
  process.stdout.write("\n");
  const metadata = JSON.parse(
    new TextDecoder().decode(
      unpacked(await range(url, header.metadataOffset, header.metadataLength), header.internalCompression),
    ),
  );
  const kept = gzipSync(
    new TextEncoder().encode(
      JSON.stringify({ ...metadata, maxzoom: maxZoom, description: `Protomaps basemap, build ${build}, zoom 0 to ${maxZoom}.` }),
    ),
    { level: 9, mtime: 0 },
  );

  let root = writeDirectory(tiles);
  let leaves = new Uint8Array(0);
  if (HEADER + root.length > 16384) {
    const parts = [];
    const pointers = [];
    let offset = 0;
    for (let from = 0; from < tiles.length; from += 4096) {
      const leaf = writeDirectory(tiles.slice(from, from + 4096));
      pointers.push({ id: tiles[from].id, run: 0, length: leaf.length, offset });
      parts.push(leaf);
      offset += leaf.length;
    }
    leaves = new Uint8Array(offset);
    let at = 0;
    for (const part of parts) {
      leaves.set(part, at);
      at += part.length;
    }
    root = writeDirectory(pointers);
  }
  const out = new Uint8Array(HEADER + root.length + kept.length + leaves.length + data.length);
  out.set(head.subarray(0, HEADER));
  const view = new DataView(out.buffer);
  const u64 = (at, value) => view.setBigUint64(at, BigInt(value), true);
  const metadataAt = HEADER + root.length;
  const leavesAt = metadataAt + kept.length;
  const tilesAt = leavesAt + leaves.length;
  u64(8, HEADER);
  u64(16, root.length);
  u64(24, metadataAt);
  u64(32, kept.length);
  u64(40, leavesAt);
  u64(48, leaves.length);
  u64(56, tilesAt);
  u64(64, data.length);
  u64(72, ids);
  u64(80, tiles.length);
  u64(88, new Set(tiles.map((tile) => tile.offset)).size);
  out[96] = 1;
  out[97] = 2;
  out[101] = maxZoom;
  out[118] = Math.min(out[118], maxZoom);
  out.set(root, HEADER);
  out.set(kept, metadataAt);
  out.set(leaves, leavesAt);
  out.set(data, tilesAt);
  return out;
}

const existing = () =>
  existingFile({
    digest: existsSync(OUT) ? sha256(readFileSync(OUT)) : null,
    pinned,
    sha256: PINNED.sha256,
  });

async function main() {
  if (existing() === "pinned") {
    console.log(`src/assets/basemap/world.pmtiles is the pinned file (build ${build}).`);
    return;
  }
  const mirror = process.env.BASEMAP_MIRROR;
  let file;
  if (mirror) {
    const url = mirrorUrl(mirror, build, maxZoom);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    file = new Uint8Array(await response.arrayBuffer());
  } else file = await extract(`https://build.protomaps.com/${build}.pmtiles`);
  const digest = sha256(file);
  if (pinned && digest !== PINNED.sha256)
    throw new Error(`The file has the SHA-256 ${digest}, and the pinned one is ${PINNED.sha256}. Nothing was written.`);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, file);
  console.log(`src/assets/basemap/world.pmtiles: ${(file.length / 1048576).toFixed(1)} MB, sha256 ${digest}${pinned ? " (as pinned)" : " (not checked: pin it in scripts/fetch-basemap.mjs)"}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((cause) => {
    console.error(String(cause?.message ?? cause));
    const required = basemapRequired(process.env.BASEMAP_REQUIRED);
    const { exitCode, removeOutput } = afterFailure({
      optional: args.includes("--optional"),
      required,
      existing: existing(),
    });
    if (removeOutput) {
      rmSync(OUT, { force: true });
      console.error(
        "src/assets/basemap/world.pmtiles was not the pinned file and could not be replaced: it was removed.",
      );
    }
    if (exitCode !== 0) {
      if (required)
        console.error(
          "BASEMAP_REQUIRED is set: the build stops without the basemap. Pass BASEMAP_MIRROR with a copy of the pinned file, or pin a newer build.",
        );
      process.exit(exitCode);
    }
    console.error(
      "The basemap was not fetched: maps are drawn on the boundary files. Run scripts/fetch-basemap.mjs again, or pass BASEMAP_MIRROR.",
    );
  });
