import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = join(process.cwd(), "src");
const FORBIDDEN: [string, RegExp][] = [
  ["innerHTML", /\binnerHTML\b/],
  ["outerHTML", /\bouterHTML\b/],
  ["insertAdjacentHTML", /\binsertAdjacentHTML\b/],
  ["dangerouslySetInnerHTML", /\bdangerouslySetInnerHTML\b/],
  ["setHTML", /\bsetHTML\b/],
  ["document.write", /\bdocument\s*\.\s*write(ln)?\s*\(/],
  ["createContextualFragment", /\bcreateContextualFragment\b/],
  ["eval", /(^|[^.\w])eval\s*\(/],
  ["new Function", /\bnew\s+Function\s*\(/],
  ["srcdoc", /\bsrcdoc\b/],
  ["a javascript: address", /["'`]javascript:/i],
  ["localStorage", /\blocalStorage\b/],
  ["sessionStorage", /\bsessionStorage\b/],
  ["document.cookie", /\bdocument\s*\.\s*cookie\b/],
  ["window.open", /\bwindow\s*\.\s*open\s*\(/],
  ["postMessage", /\bpostMessage\s*\(/],
];

const files = (directory: string): string[] =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx|js|mjs)$/.test(name) ? [path] : [];
  });

describe("the code of the plugin", () => {
  const sources = files(SOURCE);

  it("has files to look at", () => {
    expect(sources.length).toBeGreaterThan(100);
  });

  for (const [what, pattern] of FORBIDDEN)
    it(`never uses ${what}, which a label or a file of a backend could turn into markup or code`, () => {
      const found = sources.filter((path) => pattern.test(readFileSync(path, "utf8")));
      expect(found.map((path) => path.slice(SOURCE.length + 1))).toEqual([]);
    });
});
