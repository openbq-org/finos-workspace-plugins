import assert from "node:assert/strict";
import { test } from "node:test";
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";

import { ATTRIBUTES, TAGS, makeSanitizer, plainOf } from "../src/markup.js";
import { isSafeLink } from "../src/model.js";

const { window } = new JSDOM("");
const sanitize = makeSanitizer(createDOMPurify(window));

function clean(markup) {
  const box = window.document.createElement("div");
  box.append(sanitize(markup));
  return box;
}

function audit(box) {
  const problems = [];
  for (const node of box.querySelectorAll("*")) {
    const tag = node.localName;
    if (!TAGS.includes(tag)) problems.push(`tag ${tag}`);
    for (const { name, value } of node.attributes) {
      if (!ATTRIBUTES.includes(name) && name !== "rel") problems.push(`attribute ${name}`);
      if (name === "href" && !isSafeLink(value)) problems.push(`href ${value}`);
      if (/^on/i.test(name)) problems.push(`handler ${name}`);
      if (/javascript:|expression\(|url\(/i.test(value)) problems.push(`value ${value}`);
    }
  }
  return problems;
}

test("simple inline HTML survives with its text", () => {
  const box = clean('<b>AAPL</b> <i>up</i> <span title="why">+1.2%</span> <code>x</code> <small>s</small> a<br>b');
  assert.equal(box.innerHTML, '<b>AAPL</b> <i>up</i> <span title="why">+1.2%</span> <code>x</code> <small>s</small> a<br>b');
  assert.deepEqual(audit(box), []);
});

test("scripts, handlers, script URLs and embedded documents are removed", () => {
  const box = clean(
    '<script>alert(1)</script><b onclick="alert(1)" onmouseover="alert(2)">x</b><a href="javascript:alert(1)">y</a><img src=x onerror="alert(3)"><iframe src="https://evil.example"></iframe><object data="x"></object><embed src="x"><form action="https://evil.example"><input name="a"></form><svg onload="alert(4)"><circle/></svg><math><mi>z</mi></math><video src="x"></video><link rel="stylesheet" href="https://evil.example/a.css"><meta http-equiv="refresh" content="0;url=https://evil.example"><base href="https://evil.example/">',
  );
  assert.doesNotMatch(box.innerHTML, /script|onclick|onmouseover|onerror|onload|javascript|iframe|<img|object|embed|<form|<input|<svg|<math|video|<link|<meta|<base|evil\.example/i);
  assert.match(box.textContent, /x/);
  assert.deepEqual(audit(box), []);
});

test("style elements are removed, and a style attribute keeps only safe declarations", () => {
  const box = clean('<style>@import url(https://evil.example/a.css); b{color:red}</style><span style="color: #22c55e; position: fixed; background: url(https://evil.example/x); font-weight: bold">x</span>');
  assert.doesNotMatch(box.innerHTML, /<style|@import|evil\.example|position|url\(/i);
  assert.equal(box.querySelector("span").getAttribute("style"), "color:#22c55e;font-weight:bold");
  assert.deepEqual(audit(box), []);
});

test("a style attribute with nothing safe in it is dropped", () => {
  const box = clean('<span style="position: fixed; behavior: url(x)">x</span>');
  assert.equal(box.querySelector("span").hasAttribute("style"), false);
});

test("a class becomes the tone it names, and any other class goes", () => {
  const box = clean('<span class="up">a</span><span class="down">b</span><span class="evil neutral">c</span><span class="warning">d</span><span class="nonsense">e</span><span class="constructor">f</span>');
  assert.deepEqual([...box.querySelectorAll("span")].map((span) => span.getAttribute("class")), ["mq-tone-up", "mq-tone-down", "mq-tone-neutral", null, null, null]);
});

test("data attributes, ids and ARIA attributes go", () => {
  const box = clean('<span data-ticker="AAPL" id="a" aria-label="x" role="button" tabindex="0" name="n">x</span>');
  assert.equal(box.innerHTML, "<span>x</span>");
});

test("a link keeps only https and mailto, and gets rel", () => {
  const box = clean(
    '<a href="https://example.com/a">1</a><a href="mailto:a@example.com">2</a><a href="http://example.com">3</a><a href="javascript:alert(1)">4</a><a href="data:text/html,<script>alert(1)</script>">5</a><a href="//example.com">6</a><a href="#x">7</a><a href=" java&#9;script:alert(1)">8</a><a href="vbscript:x">9</a>',
  );
  assert.deepEqual([...box.querySelectorAll("a")].map((a) => a.getAttribute("href")), ["https://example.com/a", "mailto:a@example.com", null, null, null, null, null, null, null]);
  assert.equal(box.querySelector("a").getAttribute("rel"), "noopener noreferrer");
  assert.deepEqual(audit(box), []);
});

test("known mutation payloads come out as safe markup", () => {
  const payloads = [
    "<svg><p><style><img src=x onerror=alert(1)></style>",
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
    '<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=alert(1)&gt;">',
    "<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>",
    '<a href="&#106;avascript:alert(1)">x</a>',
    '<b style="background:url(javascript:alert(1))">x</b>',
    '<span class="up" onanimationstart="alert(1)" style="animation-name:x">x</span>',
    "<<script>alert(1)//<</script>",
    '<div><details open ontoggle="alert(1)">x</details></div>',
    '<a href="https://example.com" target="_blank" onfocus="alert(1)" autofocus>x</a>',
  ];
  for (const payload of payloads) assert.deepEqual(audit(clean(payload)), [], payload);
});

test("the text of markup is what a reader sees", () => {
  assert.equal(plainOf(sanitize, "<b>AAPL</b>   <i>up</i>\n<script>x</script>"), "AAPL up");
  assert.equal(plainOf(sanitize, "a &amp; b"), "a & b");
  assert.equal(plainOf(sanitize, ""), "");
});
