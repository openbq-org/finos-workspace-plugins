import assert from "node:assert/strict";
import { test } from "node:test";
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";

import { cleanCss, isSafeLink, makeSanitizer } from "../src/sanitize.js";

const sanitize = makeSanitizer(createDOMPurify(new JSDOM("").window));
const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${inner}</svg>`;
const clean = (inner) => sanitize(svg(inner)).outerHTML;

test("scripts, event handlers and script URLs are removed", () => {
  const out = clean(
    `<script>alert(1)</script><rect onclick="alert(1)" onload="alert(2)" width="1" height="1"/><a href="javascript:alert(1)"><text>x</text></a><a xlink:href="JaVaScRiPt:alert(1)"><text>y</text></a>`,
  );
  assert.doesNotMatch(out, /<script|onclick|onload|javascript/i);
  assert.match(out, /<text>x<\/text>/);
});

test("foreignObject and the HTML in it are removed, so a switch falls back to its text", () => {
  const out = clean(`<switch><foreignObject width="5" height="5"><div>html label</div></foreignObject><text>fallback</text></switch>`);
  assert.doesNotMatch(out, /foreignObject|<div|html label/i);
  assert.match(out, /<switch><text>fallback<\/text><\/switch>/);
});

test("embedded documents, media, forms and animation are removed", () => {
  const out = clean(
    `<foreignObject width="5" height="5"><iframe src="https://evil.example"></iframe><img src="x" onerror="alert(1)"><form action="https://evil.example"><input name="a"></form><object data="x"></object><embed src="x"></foreignObject><image href="https://evil.example/a.png"/><animate attributeName="href" values="javascript:alert(1)"/><set attributeName="href" to="javascript:alert(1)"/>`,
  );
  assert.doesNotMatch(out, /iframe|<img|<form|<input|<object|<embed|<image|<animate|<set|evil\.example|onerror/i);
});

test("a link keeps only https, mailto and fragments", () => {
  const out = clean(
    `<a href="https://example.com/a"><text>1</text></a><a href="mailto:a@example.com"><text>2</text></a><a href="#node"><text>3</text></a><a href="data:text/html,<script>alert(1)</script>"><text>4</text></a><a href="http://example.com"><text>5</text></a><a href="//example.com"><text>6</text></a><a href="vbscript:x"><text>7</text></a><a href=" java&#9;script:alert(1)"><text>8</text></a>`,
  );
  const doc = new JSDOM(out).window.document;
  const kept = [...doc.querySelectorAll("a")].map((a) => a.getAttribute("href"));
  assert.deepEqual(kept, ["https://example.com/a", "mailto:a@example.com", "#node", null, null, null, null, null]);
});

test("use and image references to other documents are removed", () => {
  const out = clean(`<defs><g id="a"/></defs><use href="https://evil.example/x.svg#a"/><use xlink:href="data:image/svg+xml,x"/>`);
  assert.doesNotMatch(out, /evil\.example|data:/);
});

test("style rules lose imports, external urls and legacy script hooks", () => {
  const out = clean(
    `<style>@import url(https://evil.example/a.css); .a{fill:url(https://evil.example/x);stroke:url(#grad);behavior:url(x.htc);width:expression(alert(1))}</style><rect style="fill:url('https://evil.example/y');stroke:url(#grad)" width="1" height="1"/>`,
  );
  assert.doesNotMatch(out, /@import|evil\.example|behavior|expression\(/i);
  assert.match(out, /url\(#grad\)/);
});

test("cleanCss on its own", () => {
  assert.equal(cleanCss("a{b:url(http://x)}"), "a{b:none}");
  assert.equal(cleanCss("a{b:url(#ok)}"), "a{b:url(#ok)}");
  assert.equal(cleanCss("@import 'x.css'; a{}"), " a{}");
});

test("an ordinary diagram survives with its text, shapes, classes and marker references", () => {
  const out = clean(
    `<defs><marker id="m" markerWidth="4" markerHeight="4"><path d="M0,0L4,2L0,4z"/></marker></defs><g class="node" id="n1" transform="translate(5,5)"><rect width="4" height="2" rx="1"/><text x="1" y="1" text-anchor="middle">Request &amp; reply</text></g><path d="M0 0L5 5" marker-end="url(#m)" style="stroke:#fff;fill:none"/>`,
  );
  assert.match(out, /Request &amp; reply/);
  assert.match(out, /class="node"/);
  assert.match(out, /marker-end="url\(#m\)"/);
  assert.match(out, /<marker id="m"/);
  assert.match(out, /stroke:#fff/);
});

test("input that is not exactly one SVG is refused", () => {
  assert.throws(() => sanitize("<div>hello</div>"), /one SVG/);
  assert.throws(() => sanitize("<script>alert(1)</script>"), /one SVG/);
  assert.throws(() => sanitize(svg("") + svg("")), /one SVG/);
});

test("isSafeLink", () => {
  for (const ok of ["https://example.com", "mailto:a@example.com", "#a"]) assert.equal(isSafeLink(ok), true, ok);
  for (const bad of ["", "  ", null, undefined, "http://example.com", "javascript:alert(1)", "data:text/html,x", "//example.com", "/relative", "https://exa mple.com", "https://x.example/\n", `https://example.com/${"a".repeat(2000)}`]) {
    assert.equal(isSafeLink(bad), false, String(bad));
  }
});
