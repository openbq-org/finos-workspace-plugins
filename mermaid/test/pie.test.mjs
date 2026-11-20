import assert from "node:assert/strict";
import { test } from "node:test";

import { parsePie, pieSvg } from "../src/pie.js";

const COLORS = { series: ["#111111", "#222222", "#333333"], text: "#eeeeee", muted: "#999999", background: "#123244", gap: "#123244", font: "system-ui, sans-serif" };
const SOURCE = 'pie showData title Image sizes\n  "web" : 42\n  "api" : 263\n  "agent" : 465';

test("a pie is read from its header, title and slices, largest first", () => {
  const pie = parsePie(SOURCE);
  assert.equal(pie.title, "Image sizes");
  assert.equal(pie.showData, true);
  assert.deepEqual(pie.slices.map((s) => [s.label, s.value]), [["agent", 465], ["api", 263], ["web", 42]]);
});

test("the title can be on its own line, and comments and blank lines are ignored", () => {
  const pie = parsePie('%% comment\npie\n  title Shares\n\n  "a" : 1.5 %% half\n  \'b\' : 3');
  assert.equal(pie.title, "Shares");
  assert.equal(pie.showData, false);
  assert.deepEqual(pie.slices.map((s) => s.label), ["b", "a"]);
});

test("front matter before the header is skipped", () => {
  assert.equal(parsePie('---\ntitle: x\n---\npie\n  "a" : 1').slices.length, 1);
});

test("anything that is not a pie with a positive slice is left to Mermaid", () => {
  for (const text of ["flowchart TD\n A --> B", "pie\n", 'pie\n  "a" : 0', 'pie\n  "a" : -3', "pieChart\n"]) assert.equal(parsePie(text), null, text);
});

test("the svg has a slice and a legend row for each slice, in the stylesheet's colours", () => {
  const svg = pieSvg(parsePie(SOURCE), { width: 800, height: 400, colors: COLORS });
  assert.equal((svg.match(/class="pie-slice"/g) ?? []).length, 3);
  assert.equal((svg.match(/class="pie-row"/g) ?? []).length, 3);
  assert.match(svg, /fill="#111111"/);
  assert.match(svg, /fill="#123244"/);
  assert.match(svg, /Image sizes/);
  assert.match(svg, /770/);
});

test("labels are escaped", () => {
  const svg = pieSvg(parsePie('pie\n  "<img onerror=x> & co" : 1'), { width: 800, height: 400, colors: COLORS });
  assert.ok(!svg.includes("<img"));
  assert.match(svg, /&lt;img onerror=x&gt; &amp; co/);
});

test("a single slice is a full ring, and too many slices end in a count of the rest", () => {
  assert.match(pieSvg(parsePie('pie\n  "a" : 1'), { width: 800, height: 400, colors: COLORS }), /100%/);
  const many = parsePie(`pie\n${Array.from({ length: 40 }, (_, i) => `  "s${i}" : ${i + 1}`).join("\n")}`);
  const svg = pieSvg(many, { width: 800, height: 300, colors: COLORS });
  assert.match(svg, /\+\d+ more/);
  assert.equal((svg.match(/class="pie-slice"/g) ?? []).length, 40);
});

test("an export has no hover data", () => {
  assert.ok(!pieSvg(parsePie(SOURCE), { width: 900, height: 540, colors: COLORS, interactive: false }).includes("data-slices"));
});

test("a pie with too many slices, an absurd value or a very long label is refused or clipped", () => {
  const many = "pie\n" + Array.from({ length: 201 }, (_, i) => `  "s${i}" : 1`).join("\n");
  assert.throws(() => parsePie(many), /at most 200 slices/);
  assert.throws(() => parsePie('pie\n  "a" : 1000000000000000000'), /slice is at most/);
  const long = parsePie(`pie\n  "${"x".repeat(500)}" : 1`);
  assert.ok(long.slices[0].label.length <= 80);
});
