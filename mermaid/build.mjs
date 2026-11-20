import { createHash } from "node:crypto";
import { copyFileSync, cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "src/plugin.json"), "utf8"));

const OBJECT_CONVERTER_START = 'return new Function("d"';
const OBJECT_CONVERTER_END = '"}");';
const OBJECT_CONVERTER = 'return (d) => Object.fromEntries(columns.map((name, i) => [name, d[i] || ""]));';

const ELK_UNAVAILABLE = 'export const render = async () => { throw new Error("The ELK layout is not part of this plugin. Remove the layout setting to draw the diagram with dagre."); };';

const bundlePolicy = {
  name: "bundle-policy",
  setup(plugin) {
    plugin.onLoad({ filter: /[\\/]mermaid[\\/]dist[\\/]chunks[\\/]mermaid\.core[\\/]elk-[A-Z0-9]+\.mjs$/ }, () => ({ contents: ELK_UNAVAILABLE, loader: "js" }));
    plugin.onLoad({ filter: /[\\/]d3-dsv[\\/]dist[\\/]d3-dsv\.mjs$/ }, (args) => {
      const source = readFileSync(args.path, "utf8");
      const start = source.indexOf(OBJECT_CONVERTER_START);
      const end = source.indexOf(OBJECT_CONVERTER_END, start) + OBJECT_CONVERTER_END.length;
      if (start < 0 || end < OBJECT_CONVERTER_END.length || source.indexOf(OBJECT_CONVERTER_START, start + 1) >= 0)
        throw new Error("expected d3-dsv to build its row objects with new Function exactly once");
      return { contents: source.slice(0, start) + OBJECT_CONVERTER + source.slice(end), loader: "js" };
    });
  },
};

const UNDECLARED = { khroma: "MIT" };
const LICENSES = new Set(["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "(MPL-2.0 OR Apache-2.0)"]);

function licenseNotices(metafile) {
  const directories = new Set();
  for (const input of Object.keys(metafile.inputs)) {
    const parts = resolve(input).split(sep);
    const at = parts.lastIndexOf("node_modules");
    if (at < 0) continue;
    const name = parts[at + 1].startsWith("@") ? `${parts[at + 1]}/${parts[at + 2]}` : parts[at + 1];
    directories.add([...parts.slice(0, at + 1), ...name.split("/")].join(sep));
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
copyFileSync(join(root, "src/assets/icon.svg"), join(out, "assets/icon.svg"));
copyFileSync(join(root, "src/entry.css"), join(out, "entry.css"));
cpSync(join(root, "src/skills"), join(out, "skills"), { recursive: true });

const bundled = await build({
  entryPoints: [join(root, "src/entry.js")],
  outfile: join(out, "entry.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "none",
  metafile: true,
  plugins: [bundlePolicy],
  logLevel: "warning",
});

const code = readFileSync(join(out, "entry.js"), "utf8");
if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(code)) throw new Error("entry.js still has dynamic code after the build");
if (/\bimport\s*\(\s*["'`](?:https?:)?\/\//.test(code)) throw new Error("entry.js imports a remote module");

writeFileSync(join(out, "assets/THIRD-PARTY-LICENSES.txt"), licenseNotices(bundled.metafile).join(`\n${"-".repeat(78)}\n\n`));

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

console.log(`built ${relative(root, out)}: entry.js ${(statSync(join(out, "entry.js")).size / 1024).toFixed(0)} KiB`);
console.log(`checksum ${checksum}`);
console.log(`version digest ${listingDigest(files(out))}`);
