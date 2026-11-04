// Checks a built package the way Workspace's discovery does, offline:
//
//   node scripts/verify.mjs [dist/<plugin id>/<version>]
//
// It mirrors the rules in Workspace's backend-api/backend/api/widget_plugins/discovery.py and
// manifest.py that a build can break (folder names, file names, caps, served files, checksum),
// and prints the version digest a deployer pins in WIDGET_PLUGINS_PINS. Workspace's own
// `python -m scripts.plugin_check <dir>` stays the authority; this needs no Workspace checkout.

import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const source = JSON.parse(readFileSync(join(root, "src/plugin.json"), "utf8"));
const dir = resolve(process.argv[2] ?? join(root, "dist", source.id, pkg.version));

const PLUGIN_ID = /^[a-z][a-z0-9-]{1,47}$/;
const VERSION = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const FILE_NAME = /^[A-Za-z0-9._-]{1,128}$/;
const VIZ_TYPE = /^[a-z][a-z0-9_-]{1,31}$/;
const BUILT_IN_TYPES = new Set(["markdown", "html", "iframe", "newsfeed", "pdf"]);
const MAX_FILES = 200;
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;
const REMOTE_IMPORT = /(?:\bimport\s*\(\s*|\bfrom\s*|\bimport\s+)["'](?:https?:)?\/\//i;
const DYNAMIC_CODE = /\beval\s*\(|\bnew\s+Function\s*\(/;
const LOCAL_PATHS = /\/Users\/|\/home\/[a-z]|file:\/\/|[A-Z]:\\\\/;

const errors = [];
const warnings = [];

const id = basename(dirname(dir));
const version = basename(dir);
if (!PLUGIN_ID.test(id)) errors.push(`plugin folder "${id}" is not a plugin id`);
if (!VERSION.test(version)) errors.push(`version folder "${version}" is not X.Y.Z`);

/* ---- Walk: names, symlinks, caps (discovery._walk) ---- */
const hashes = {};
let total = 0;
function walk(directory) {
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    const rel = relative(dir, path).split("\\").join("/");
    const info = lstatSync(path);
    if (!FILE_NAME.test(name)) errors.push(`${rel}: name not allowed`);
    if (name.startsWith(".")) errors.push(`${rel}: dotfile in the package changes its digest`);
    if (info.isSymbolicLink()) errors.push(`${rel}: symbolic link`);
    else if (info.isDirectory()) walk(path);
    else if (!info.isFile()) errors.push(`${rel}: not a regular file`);
    else {
      total += info.size;
      hashes[rel] = createHash("sha256").update(readFileSync(path)).digest("hex");
    }
  }
}
walk(dir);
if (Object.keys(hashes).length > MAX_FILES) errors.push(`more than ${MAX_FILES} files`);
if (total > MAX_BYTES) errors.push(`more than ${MAX_BYTES} bytes`);

function listingDigest(files) {
  const lines = Object.keys(files)
    .sort()
    .map((path) => `${path}\0${files[path]}\n`)
    .join("");
  return `sha256-${createHash("sha256").update(lines).digest("base64url")}`;
}

/* ---- Manifest (manifest.Manifest, the parts a build writes) ---- */
let manifest = null;
if (!hashes["plugin.json"]) errors.push("plugin.json is missing");
else if (lstatSync(join(dir, "plugin.json")).size > MAX_MANIFEST_BYTES) errors.push("plugin.json is over 256 KiB");
else manifest = JSON.parse(readFileSync(join(dir, "plugin.json"), "utf8"));

const { "plugin.json": _, ...packaged } = hashes;
const checksum = listingDigest(packaged);
const digest = listingDigest(hashes);

if (manifest) {
  if (manifest.manifestVersion !== 1) errors.push("manifestVersion is not 1");
  if (manifest.id !== id) errors.push(`manifest id "${manifest.id}" differs from its directory "${id}"`);
  if (manifest.version !== version) errors.push(`manifest version "${manifest.version}" differs from its directory "${version}"`);
  if (manifest.host?.api !== 1 || manifest.host?.afm !== "0.11") errors.push("host must be { api: 1, afm: \"0.11\" }");
  if (manifest.checksum !== checksum) errors.push(`checksum ${manifest.checksum} does not match the files (${checksum})`);

  /* Served files (discovery.served_files): entry, styles, icon, assets/ */
  const served = [manifest.entry?.module, ...(manifest.entry?.styles ?? []), manifest.icon].filter(Boolean);
  for (const path of served) if (!hashes[path]) errors.push(`${path} is declared but missing`);
  if (!manifest.entry?.module?.endsWith(".js")) errors.push("entry.module must be a .js file");
  if (manifest.icon && !manifest.icon.startsWith("assets/")) errors.push("icon must be under assets/");
  const unserved = Object.keys(hashes).filter((p) => p !== "plugin.json" && !served.includes(p) && !p.startsWith("assets/"));
  for (const path of unserved) warnings.push(`${path} is packaged but never served`);

  /* Widgets and the types they handle */
  const seen = new Set();
  for (const widget of manifest.contributes?.widgets ?? []) {
    const types = (widget.handles ?? []).map((h) => h.type);
    for (const type of types) {
      if (!VIZ_TYPE.test(type) || BUILT_IN_TYPES.has(type)) errors.push(`widget ${widget.id}: type "${type}" is not allowed`);
      if (seen.has(type)) errors.push(`type "${type}" is handled by two widgets`);
      seen.add(type);
    }
    console.log(`widget ${widget.id} handles ${types.join(", ") || "(standalone)"}`);
  }

  /* Lint the entry as discovery does (warnings there too), plus local paths */
  if (hashes[manifest.entry?.module]) {
    const code = readFileSync(join(dir, manifest.entry.module), "utf8");
    if (REMOTE_IMPORT.test(code)) warnings.push("entry imports a remote module");
    const evalAllowed = (manifest.csp?.["script-src"] ?? []).includes("'unsafe-eval'");
    if (DYNAMIC_CODE.test(code) && !evalAllowed) warnings.push("entry contains eval or new Function, which the frame's CSP blocks");
  }
  for (const path of served) {
    if (hashes[path] && LOCAL_PATHS.test(readFileSync(join(dir, path), "utf8"))) errors.push(`${path} embeds a local absolute path`);
  }
}

console.log(`package ${id}@${version}, ${Object.keys(hashes).length} files, ${total} bytes`);
console.log(`checksum ${checksum}`);
console.log(`version digest ${digest}`);
for (const warning of warnings) console.log(`warning: ${warning}`);
for (const error of errors) console.log(`error: ${error}`);
if (errors.length) {
  console.log("blocked");
  process.exit(1);
}
console.log(`ok: pin with WIDGET_PLUGINS_PINS={"${id}@${version}": "${digest}"}`);
