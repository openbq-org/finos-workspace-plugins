
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const SOURCE = {
  name: "2025_Gaz_zcta_national",
  url: "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_zcta_national.zip",
  sha256: "51516a4283bab5cd2376eec75609ddc4b363a18297e8adeeaac7b03cf7c84dbe",
  fetched: "2026-10-11",
  vintage: "2025 Gazetteer (2020 Census ZCTAs)",
};
const SCALE = 1000;

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const downloads = option("--downloads");
if (!downloads) {
  console.error("Usage: node scripts/geo/prepare-zips.mjs --downloads <dir> [--out <dir>]");
  process.exit(2);
}
const out = resolve(option("--out") ?? join(here, "../../vendor/geo/places"));

const archive = resolve(downloads, SOURCE.name, `${SOURCE.name}.zip`);
const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
if (digest !== SOURCE.sha256) {
  console.error(
    `${archive} has the SHA-256 ${digest}, not ${SOURCE.sha256}: it is another file than the one this script was written for. Record the new digest here and in vendor/geo/README.md, and review what changed in zips.json.`,
  );
  process.exit(1);
}
const text = execFileSync("unzip", ["-p", archive, `${SOURCE.name}.txt`], {
  maxBuffer: 64 * 1024 * 1024,
}).toString("utf8");

const lines = text.split(/\r?\n/).filter((line) => line.trim());
const separator = lines[0].includes("|") ? "|" : "\t";
const header = lines[0].split(separator).map((cell) => cell.trim());
const column = (name) => {
  const at = header.indexOf(name);
  if (at === -1) throw new Error(`The file has no column ${name}: ${header.join(", ")}`);
  return at;
};
const [code, latitude, longitude] = ["GEOID", "INTPTLAT", "INTPTLONG"].map(column);

const rows = [];
const seen = new Set();
for (const line of lines.slice(1)) {
  const cells = line.split(separator).map((cell) => cell.trim());
  const zip = cells[code];
  const lat = Number(cells[latitude]);
  const lon = Number(cells[longitude]);
  if (!/^\d{5}$/.test(zip)) throw new Error(`A row has the code "${zip}", which is no five digits.`);
  if (seen.has(zip)) throw new Error(`The code ${zip} is in the file twice.`);
  if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180))
    throw new Error(`The code ${zip} has the place ${cells[latitude]}, ${cells[longitude]}.`);
  seen.add(zip);
  rows.push([Number(zip), Math.round(lat * SCALE), Math.round(lon * SCALE)]);
}
rows.sort((a, b) => a[0] - b[0]);

const bytes = [];
const varint = (value) => {
  let left = value;
  while (left > 127) {
    bytes.push((left & 127) | 128);
    left = Math.floor(left / 128);
  }
  bytes.push(left);
};
const signed = (value) => (value < 0 ? -2 * value - 1 : 2 * value);
let before = [0, 0, 0];
for (const row of rows) {
  varint(row[0] - before[0]);
  varint(signed(row[1] - before[1]));
  varint(signed(row[2] - before[2]));
  before = row;
}

const file = `${JSON.stringify({
  source: `US Census Bureau, ZIP Code Tabulation Areas, ${SOURCE.vintage}`,
  vintage: SOURCE.vintage,
  licence: "Public domain (a work of the United States government)",
  scale: SCALE,
  count: rows.length,
  table: Buffer.from(bytes).toString("base64"),
})}\n`;
mkdirSync(out, { recursive: true });
const target = join(out, "zips.json");
writeFileSync(target, file);
console.log(
  `${target}: ${rows.length.toLocaleString("en-US")} ZIP codes, ${file.length.toLocaleString("en-US")} bytes (${gzipSync(file).length.toLocaleString("en-US")} compressed), SHA-256 ${createHash("sha256").update(file).digest("hex")}`,
);
