import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_DECLARATIONS, MAX_VALUE, parseStyle, patchStyle, propertyOf, safeValue, styleText } from "../src/style.js";

test("colors, lengths, gradients and theme variables are accepted", () => {
  for (const value of ["#fff", "red", "bold", "4px 8px", "rgb(0 0 0 / 50%)", "rgba(10, 20, 30, .5)", "linear-gradient(to right, #1a1a2e, #16213e)", "var(--ws-brand-main)", "calc(100% - 4px)", "clamp(1px, 2vw, 9px)"]) {
    assert.equal(safeValue(value), value, value);
  }
});

test("anything that can load, run or break out is refused", () => {
  const bad = [
    "url(https://evil.example/x)",
    "url(#a)",
    "URL (x)",
    "expression(alert(1))",
    "red; background: url(x)",
    "red}",
    "{red",
    "javascript:alert(1)",
    "var(--other)",
    "var(--ws-x",
    ")(",
    "attr(x)",
    "env(x)",
    "image-set(x)",
    '"quoted"',
    "back\\slash",
    "red /* c */",
    "<b>",
    "red !important",
    "",
    "   ",
    "a".repeat(MAX_VALUE + 1),
  ];
  for (const value of bad) assert.equal(safeValue(value), null, JSON.stringify(value));
  for (const value of [null, undefined, 4, {}, []]) assert.equal(safeValue(value), null);
});

test("property names are read in kebab and camel case, and only the listed ones", () => {
  assert.equal(propertyOf("font-weight"), "font-weight");
  assert.equal(propertyOf("fontWeight"), "font-weight");
  assert.equal(propertyOf(" BackgroundColor "), "background-color");
  for (const name of ["position", "--ws-x", "behavior", "-moz-binding", "content", "z-index", "", null, 4]) assert.equal(propertyOf(name), null, String(name));
});

test("a style string keeps its safe declarations and drops the rest", () => {
  const style = parseStyle("color: #22c55e; fontWeight: bold; position: fixed; background: url(x); --x: 1; padding: 4px 8px; nonsense; behavior: url(a)");
  assert.deepEqual(style, { color: "#22c55e", "font-weight": "bold", padding: "4px 8px" });
  assert.deepEqual(parseStyle(undefined), {});
  assert.deepEqual(parseStyle(7), {});
});

test("a style string is capped at a dozen declarations", () => {
  const text = Array.from({ length: 40 }, (_, i) => `padding-${["top", "right", "bottom", "left"][i % 4]}: ${i}px; color: red; opacity: 0.${i % 9}`).join(";");
  assert.ok(Object.keys(parseStyle(text)).length <= MAX_DECLARATIONS);
});

test("a patch sets, replaces and removes declarations", () => {
  const base = { color: "red", opacity: "0.5" };
  assert.deepEqual(patchStyle(base, { color: "#fff", fontWeight: "bold" }), { color: "#fff", opacity: "0.5", "font-weight": "bold" });
  assert.deepEqual(patchStyle(base, { color: null, opacity: "" }), {});
  assert.deepEqual(patchStyle(base, { color: "url(x)", position: "fixed" }), base);
  assert.deepEqual(patchStyle(base, null), base);
  assert.deepEqual(patchStyle(base, [1]), base);
  assert.deepEqual(base, { color: "red", opacity: "0.5" });
});

test("styleText writes the declarations back", () => {
  assert.equal(styleText({ color: "red", "font-weight": "bold" }), "color:red;font-weight:bold");
  assert.equal(styleText({}), "");
});
