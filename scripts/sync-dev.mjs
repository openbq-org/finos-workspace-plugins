import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const { id } = JSON.parse(readFileSync(join(root, "src/plugin.json"), "utf8"));
const [target, version] = [process.argv[2] ?? process.env.WORKSPACE_PLUGINS_DIR, process.argv[3] ?? process.env.WORKSPACE_PLUGIN_DEV_VERSION];
if (!target || !version) {
  console.error("name the plugins directory and the development version: WORKSPACE_PLUGINS_DIR=<dir> WORKSPACE_PLUGIN_DEV_VERSION=<x.y.z> npm run dev:workspace");
  process.exit(2);
}

const source = join(root, "dist", id, pkg.version);
const destination = join(resolve(target), id, version);
if (!existsSync(source)) {
  console.error(`dist/${id}/${pkg.version} does not exist: run npm run build first`);
  process.exit(1);
}
if (!existsSync(destination)) {
  console.error(`${destination} does not exist: start the development version with Patch, Minor or Major on the plugin's Deployment page`);
  process.exit(1);
}

for (const name of readdirSync(destination)) rmSync(join(destination, name), { recursive: true, force: true });
cpSync(source, destination, { recursive: true });
const manifest = JSON.parse(readFileSync(join(destination, "plugin.json"), "utf8"));
writeFileSync(join(destination, "plugin.json"), `${JSON.stringify({ ...manifest, version }, null, 2)}\n`);
console.log(`synced dist/${id}/${pkg.version} into ${destination} as ${version}`);
