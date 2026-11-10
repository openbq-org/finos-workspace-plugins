import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const VENDOR = join(process.cwd(), "vendor/geo");

const recorded = () =>
  readFileSync(join(VENDOR, "SHA256SUMS"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [digest, path] = line.split(/\s+/);
      return { digest, path };
    });

const boundaryFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return boundaryFiles(path);
    return entry.name.endsWith(".json") ? [relative(VENDOR, path)] : [];
  });

describe("vendored boundary files", () => {
  it("matches the recorded checksum of every file", () => {
    for (const { digest, path } of recorded()) {
      const actual = createHash("sha256")
        .update(readFileSync(join(VENDOR, path)))
        .digest("hex");
      expect(actual, path).toBe(digest);
    }
  });

  it("records a checksum for every boundary file in the folder", () => {
    expect(
      recorded()
        .map(({ path }) => path)
        .sort(),
    ).toEqual(boundaryFiles(VENDOR).sort());
  });

  it("keeps every file under 1.5 MB and the folder under 8.5 MB", () => {
    const sizes = boundaryFiles(VENDOR).map(
      (path) => [path, readFileSync(join(VENDOR, path)).length] as const,
    );
    for (const [path, bytes] of sizes)
      expect(bytes, path).toBeLessThan(1.5 * 1024 * 1024);
    expect(sizes.reduce((total, [, bytes]) => total + bytes, 0)).toBeLessThan(
      8.5 * 1024 * 1024,
    );
  });
});
