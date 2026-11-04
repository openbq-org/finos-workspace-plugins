// Copies the built package into a Workspace plugins directory:
//
//   WORKSPACE_PLUGINS_DIR=<plugins directory> node scripts/install.mjs
//   node scripts/install.mjs <plugins directory>
//
// The directory is the one a Workspace deployment mounts as WIDGET_PLUGINS_DIR (a local stack:
// WORKSPACE_PLUGINS_DIR in workspace/local/.env, default workspace/widget-plugins). The package
// lands at <plugins directory>/<plugin id>/<version>/, next to the versions already there, and
// Workspace picks it up at its next rescan. A version folder that exists is left alone when its
// files are the same and refused when they differ: Workspace blocks a version whose files change.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const { id } = JSON.parse(readFileSync(join(root, "src/plugin.json"), "utf8"));
const target = process.argv[2] ?? process.env.WORKSPACE_PLUGINS_DIR;
if (!target) {
  console.error("name the plugins directory: WORKSPACE_PLUGINS_DIR=<dir> npm run install:workspace");
  process.exit(2);
}

const source = join(root, "dist", id, pkg.version);
const destination = join(resolve(target), id, pkg.version);
if (!existsSync(source)) {
  console.error(`${relative(root, source)} does not exist: run npm run build first`);
  process.exit(1);
}

/* The same checks Workspace's discovery makes, before anything is copied */
execFileSync(process.execPath, [join(root, "scripts/verify.mjs"), source], { stdio: "inherit" });

function listing(directory) {
  const files = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else files[relative(directory, path)] = createHash("sha256").update(readFileSync(path)).digest("hex");
    }
  };
  walk(directory);
  return JSON.stringify(files);
}

if (existsSync(destination)) {
  if (listing(destination) === listing(source)) {
    console.log(`${destination} already holds this package: nothing to copy`);
    process.exit(0);
  }
  console.error(`${destination} exists with other files. Raise "version" in package.json and build again.`);
  process.exit(1);
}

mkdirSync(dirname(destination), { recursive: true });
cpSync(source, destination, { recursive: true });
console.log(`installed ${id}@${pkg.version} into ${destination}`);
console.log("next: rescan in Workspace (Admin, Widgets, Deployment), then review and approve the version");
