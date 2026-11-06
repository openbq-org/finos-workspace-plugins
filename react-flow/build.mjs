import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

function expand(value) {
  if (Array.isArray(value)) return value.map(expand);
  if (!value || typeof value !== "object") return value;
  if (typeof value.$include === "string") {
    if (Object.keys(value).length !== 1) throw new Error(`$include is alone in its object: ${JSON.stringify(value)}`);
    return expand(JSON.parse(readFileSync(join(root, "src", value.$include), "utf8")));
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expand(item)]));
}

const manifest = expand(JSON.parse(readFileSync(join(root, "src/plugin.json"), "utf8")));

const LICENSES = new Set(["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD"]);
const UNDECLARED = {};
const PREBUNDLED = ["@dagrejs/graphlib"];

function licenseNotices(metafiles) {
  const directories = new Set(PREBUNDLED.map((name) => join(root, "node_modules", ...name.split("/"))));
  for (const metafile of metafiles) {
    for (const input of Object.keys(metafile.inputs)) {
      const parts = resolve(input).split(sep);
      const at = parts.lastIndexOf("node_modules");
      if (at < 0) continue;
      const name = parts[at + 1].startsWith("@") ? `${parts[at + 1]}/${parts[at + 2]}` : parts[at + 1];
      directories.add([...parts.slice(0, at + 1), ...name.split("/")].join(sep));
    }
  }
  return [...directories].sort().map((directory) => {
    const about = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    const license = about.license ?? UNDECLARED[about.name];
    if (!LICENSES.has(license)) throw new Error(`${about.name} ${about.version} is under ${license}, which this plugin has not cleared`);
    const files = readdirSync(directory).filter((name) => /^(licen[cs]e|notice|copying)/i.test(name));
    if (!files.length) throw new Error(`${about.name} ${about.version} has no licence file to ship`);
    const text = files.map((name) => readFileSync(join(directory, name), "utf8").trim()).join("\n\n");
    console.log(`bundled ${about.name} ${about.version} (${license})`);
    return `${about.name} ${about.version} (${license})\n\n${text}\n`;
  });
}

const out = join(root, "dist", manifest.id, pkg.version);
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "assets"), { recursive: true });
cpSync(join(root, "src/assets"), join(out, "assets"), { recursive: true });
cpSync(join(root, "src/skills"), join(out, "skills"), { recursive: true });

const common = {
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "none",
  metafile: true,
  logLevel: "warning",
};

const module_ = await build({
  ...common,
  entryPoints: [join(root, "src/entry.tsx")],
  outfile: join(out, "entry.js"),
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
});

const styles = await build({
  ...common,
  entryPoints: [join(root, "src/entry.css")],
  outfile: join(out, "entry.css"),
  loader: { ".svg": "dataurl", ".woff2": "dataurl", ".png": "dataurl" },
});

const code = readFileSync(join(out, "entry.js"), "utf8");
if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(code)) throw new Error("entry.js still has dynamic code after the build");
if (/\bimport\s*\(\s*["'`](?:https?:)?\/\//.test(code)) throw new Error("entry.js imports a remote module");
if (/url\(\s*["']?(?:https?:)?\/\//.test(readFileSync(join(out, "entry.css"), "utf8"))) throw new Error("entry.css loads a remote file");

writeFileSync(join(out, "assets/THIRD-PARTY-LICENSES.txt"), licenseNotices([module_.metafile, styles.metafile]).join(`\n${"-".repeat(78)}\n\n`));

function files(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

function listingDigest(paths) {
  const lines = paths
    .map((path) => relative(out, path).split(sep).join("/"))
    .sort()
    .map((name) => `${name}\0${createHash("sha256").update(readFileSync(join(out, name))).digest("hex")}\n`)
    .join("");
  return `sha256-${createHash("sha256").update(lines).digest("base64url")}`;
}

const checksum = listingDigest(files(out));
writeFileSync(join(out, "plugin.json"), `${JSON.stringify({ ...manifest, version: pkg.version, checksum }, null, 2)}\n`);

console.log(`built ${relative(root, out)}: entry.js ${(statSync(join(out, "entry.js")).size / 1024).toFixed(0)} KiB, entry.css ${(statSync(join(out, "entry.css")).size / 1024).toFixed(0)} KiB`);
console.log(`checksum ${checksum}`);
console.log(`version digest ${listingDigest(files(out))}`);
