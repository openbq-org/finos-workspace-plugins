import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "src/plugin.json"), "utf8"));

const require = createRequire(import.meta.url);
const packageDir = (name) => dirname(require.resolve(`${name}/package.json`));
const maplibre = join(packageDir("maplibre-gl"), "dist");

const WORKER_EXPORT = /export\{[\w$]+ as default\};/g;
const workerFile = readFileSync(join(maplibre, "maplibre-gl-worker.mjs"), "utf8");
if ((workerFile.match(WORKER_EXPORT) ?? []).length !== 1)
  throw new Error("expected MapLibre's worker export once");
const DYNAMIC_CODE = ["globalThis.eval(n)", 'throw Error("a worker source must be a module")'];
if (workerFile.split(DYNAMIC_CODE[0]).length !== 2)
  throw new Error(`expected ${DYNAMIC_CODE[0]} once in MapLibre's worker`);
const workerSource = workerFile
  .replace(WORKER_EXPORT, "")
  .replace(DYNAMIC_CODE[0], DYNAMIC_CODE[1])
  .replace(/\/\/# sourceMappingURL=.*$/m, "");
if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(workerSource))
  throw new Error("MapLibre's worker has dynamic code");

const out = join(root, "dist", manifest.id, pkg.version);
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "assets"), { recursive: true });

const result = await build({
  entryPoints: [join(root, "src/entry.tsx")],
  outfile: join(out, "entry.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "none",
  jsx: "automatic",
  alias: { "~": join(root, "src") },
  define: {
    MAPLIBRE_WORKER_SOURCE: JSON.stringify(workerSource),
    "process.env.NODE_ENV": '"production"',
  },
  write: true,
  metafile: true,
  logLevel: "warning",
});

execFileSync(
  join(root, "node_modules/.bin/tailwindcss"),
  ["-i", join(root, "src/styles.css"), "-o", join(out, "tailwind.css"), "--minify"],
  { stdio: ["ignore", "inherit", "inherit"], cwd: root },
);
writeFileSync(
  join(out, "entry.css"),
  `${readFileSync(join(maplibre, "maplibre-gl.css"), "utf8")}\n${readFileSync(join(out, "tailwind.css"), "utf8")}`,
);
rmSync(join(out, "tailwind.css"));

execFileSync(process.execPath, [join(root, "scripts/fetch-basemap.mjs"), "--optional"], {
  stdio: "inherit",
  cwd: root,
});
cpSync(join(root, "src/assets"), join(out, "assets"), { recursive: true });
cpSync(join(root, "src/skills"), join(out, "skills"), { recursive: true });
const geo = join(root, "vendor/geo");
const geoOut = join(out, "assets/geo");
function copyData(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) copyData(path);
    else if (entry.name.endsWith(".json")) {
      const target = join(geoOut, relative(geo, path));
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(path, target);
    }
  }
}
copyData(geo);

const notices = [
  ["MapLibre GL JS", join(packageDir("maplibre-gl"), "LICENSE.txt")],
  ["Natural Earth, US Census Bureau and world-atlas and us-atlas boundary files", join(root, "vendor/geo/LICENSE.world-atlas")],
  ["us-atlas", join(root, "vendor/geo/LICENSE.us-atlas")],
  ["GeoNames", join(root, "vendor/geo/LICENSE.geonames")],
  ["Noto Sans glyphs", join(root, "src/assets/basemap/fonts/OFL.txt")],
].map(([what, file]) => `${what}\n\n${readFileSync(file, "utf8").trim()}\n`);
writeFileSync(join(out, "assets/THIRD-PARTY-LICENSES.txt"), notices.join(`\n${"-".repeat(78)}\n\n`));

function files(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

function listingDigest(paths) {
  const lines = paths
    .map((path) => relative(out, path).split("\\").join("/"))
    .sort()
    .map((name) => `${name}\0${createHash("sha256").update(readFileSync(join(out, name))).digest("hex")}\n`)
    .join("");
  return `sha256-${createHash("sha256").update(lines).digest("base64url")}`;
}

const checksum = listingDigest(files(out));
writeFileSync(join(out, "plugin.json"), `${JSON.stringify({ ...manifest, version: pkg.version, checksum }, null, 2)}\n`);

console.log(`built ${relative(root, out)}`);
console.log(`checksum ${checksum}`);
console.log(`version digest ${listingDigest(files(out))}`);
