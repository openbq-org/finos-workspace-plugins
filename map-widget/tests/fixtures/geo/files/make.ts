import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtures, packedFixtures } from "./builders";

const here = dirname(fileURLToPath(import.meta.url));
const above = join(here, "..");
let total = 0;
const write = (folder: string, files: Record<string, Uint8Array>) => {
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(join(folder, name), bytes);
    total += bytes.length;
    console.log(`${String(bytes.length).padStart(7)}  ${name}`);
  }
};
write(here, fixtures());
write(
  above,
  packedFixtures((name) => new Uint8Array(readFileSync(join(above, name)))),
);
console.log(`${String(total).padStart(7)}  total`);
