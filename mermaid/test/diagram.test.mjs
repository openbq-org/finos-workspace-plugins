import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_EDGES, MAX_SCALE, MAX_SOURCE, MIN_SCALE, SECURE_KEYS, TOKENS, boxOf, configFor, exportSize, fit, modeOf, sourceOf, zoomAt } from "../src/diagram.js";

test("the diagram is a string or the diagram key of an object", () => {
  assert.equal(sourceOf("flowchart TD\n  A --> B"), "flowchart TD\n  A --> B");
  assert.equal(sourceOf({ diagram: "pie\n  \"a\" : 1" }), 'pie\n  "a" : 1');
});

test("a code fence around the diagram is taken off, with or without the language", () => {
  assert.equal(sourceOf("```mermaid\nflowchart LR\n  A --> B\n```"), "flowchart LR\n  A --> B");
  assert.equal(sourceOf({ diagram: "```\nerDiagram\n  A ||--o{ B : has\n```\n" }), "erDiagram\n  A ||--o{ B : has");
});

test("backticks inside a label are not a fence", () => {
  assert.equal(sourceOf("flowchart TD\n  A[\"```\"] --> B"), 'flowchart TD\n  A["```"] --> B');
});

test("anything that is not diagram text has no source", () => {
  for (const response of [null, undefined, 42, [], {}, { diagram: 7 }, { diagram: "  \n " }, "", "```mermaid\n```"]) {
    assert.equal(sourceOf(response), null, JSON.stringify(response));
  }
});

test("the mode is light only when the host says so", () => {
  assert.equal(modeOf({ mode: "light" }), "light");
  assert.equal(modeOf({ mode: "dark" }), "dark");
  assert.equal(modeOf(undefined), "dark");
});

const stylesheet = (extra = {}) => {
  const values = {
    "--mm-font-family": "Montserrat, sans-serif",
    "--mm-primary-color": " #1a4154 ",
    "--mm-section-bkg-color2": "#0f2b3b",
    "--mm-series-label": "#0b2432",
    "--mm-xy-title-color": "#e7f2f8",
    ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`--mm-series-${i + 1}`, `#00000${(i + 10).toString(16)}`])),
    ...extra,
  };
  return (name) => values[name] ?? "";
};

test("mermaid is configured strict, with no HTML and the dagre layout, on the base theme", () => {
  const config = configFor({ mode: "dark" }, stylesheet());
  assert.deepEqual(
    { ...config, themeVariables: undefined },
    {
      startOnLoad: false,
      securityLevel: "strict",
      secure: SECURE_KEYS,
      maxTextSize: MAX_SOURCE,
      maxEdges: MAX_EDGES,
      suppressErrorRendering: true,
      htmlLabels: false,
      layout: "dagre",
      theme: "base",
      fontFamily: "Montserrat, sans-serif",
      themeVariables: undefined,
    },
  );
  assert.equal(configFor({ mode: "dark" }, stylesheet()).themeVariables.darkMode, true);
  assert.equal(configFor({ mode: "light" }, stylesheet()).themeVariables.darkMode, false);
  assert.equal(configFor(undefined, stylesheet()).themeVariables.darkMode, true);
});

test("every colour comes from the stylesheet: custom properties named after the Mermaid variable", () => {
  const { themeVariables } = configFor({ mode: "dark" }, stylesheet());
  assert.equal(themeVariables.primaryColor, "#1a4154");
  assert.equal(themeVariables.sectionBkgColor2, "#0f2b3b");
  assert.equal(themeVariables.fontFamily, "Montserrat, sans-serif");
  assert.equal(themeVariables.lineColor, undefined);
  assert.deepEqual(themeVariables.xyChart.titleColor, "#e7f2f8");
});

test("the twelve series colours colour the scale diagrams, the git branches and the journey actors", () => {
  const { themeVariables } = configFor({ mode: "dark" }, stylesheet());
  for (let i = 0; i < 12; i++) {
    assert.equal(themeVariables[`cScale${i}`], `#00000${(i + 10).toString(16)}`);
    assert.equal(themeVariables[`cScaleLabel${i}`], "#0b2432");
  }
  assert.equal(themeVariables.git7, themeVariables.cScale7);
  assert.equal(themeVariables.git8, undefined);
  assert.equal(themeVariables.actor5, themeVariables.cScale5);
  assert.equal(themeVariables.actor6, undefined);
  assert.equal(themeVariables.xyChart.plotColorPalette.split(",").length, 12);
});

test("a stylesheet that says nothing gives Mermaid nothing to override", () => {
  const { themeVariables, fontFamily } = configFor({ mode: "light" }, () => "");
  assert.deepEqual(themeVariables, { darkMode: false });
  assert.equal(fontFamily, undefined);
});

test("the host's tokens are the ones the stylesheet names", () => {
  assert.ok(TOKENS.includes("card") && TOKENS.includes("brand-main") && !TOKENS.includes("font-family"));
});

test("fit scales a large diagram down to the card and centres a small one at its own size", () => {
  assert.deepEqual(fit({ w: 1000, h: 500 }, { w: 500, h: 500 }), { k: 0.5, x: 0, y: 125 });
  assert.deepEqual(fit({ w: 200, h: 100 }, { w: 500, h: 500 }), { k: 1, x: 150, y: 200 });
});

test("zooming keeps the point under the pointer where it is", () => {
  const view = { k: 1, x: 10, y: 20 };
  const next = zoomAt(view, 2, 110, 120);
  assert.equal(next.k, 2);
  assert.equal((110 - view.x) / view.k, (110 - next.x) / next.k);
  assert.equal((120 - view.y) / view.k, (120 - next.y) / next.k);
});

test("zoom stays between the smallest and the largest scale", () => {
  assert.equal(zoomAt({ k: 1, x: 0, y: 0 }, 1e9, 0, 0).k, MAX_SCALE);
  assert.equal(zoomAt({ k: 1, x: 0, y: 0 }, 1e-9, 0, 0).k, MIN_SCALE);
});

test("the size of a diagram is read from its view box", () => {
  assert.deepEqual(boxOf("-8 0 420.5 300"), { x: -8, y: 0, w: 420.5, h: 300 });
  assert.deepEqual(boxOf("0,0,10,20"), { x: 0, y: 0, w: 10, h: 20 });
  for (const bad of [null, "", "0 0 0 10", "0 0 10", "a b c d", "0 0 -5 5"]) assert.equal(boxOf(bad), null, String(bad));
});

test("an image is twice the diagram, and never more than 8192 pixels on a side", () => {
  assert.deepEqual(exportSize({ w: 400, h: 300 }), { width: 800, height: 600 });
  assert.deepEqual(exportSize({ w: 10000, h: 500 }), { width: 8192, height: 410 });
});

test("a diagram's own directives cannot change the keys that decide what it may do", () => {
  for (const key of ["securityLevel", "secure", "htmlLabels", "themeCSS", "themeVariables", "fontFamily", "layout", "maxTextSize", "maxEdges", "startOnLoad"]) {
    assert.ok(SECURE_KEYS.includes(key), key);
  }
});
