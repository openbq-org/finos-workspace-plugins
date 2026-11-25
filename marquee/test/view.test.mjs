import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";

import { makeSanitizer } from "../src/markup.js";
import { DEFAULTS } from "../src/model.js";
import { MAX_COPIES, createView, statusText } from "../src/view.js";

const dom = new JSDOM("<!doctype html><body></body>");
const { window } = dom;
const sanitize = makeSanitizer(createDOMPurify(window));
const sizes = { stageWidth: 300, stageHeight: 200, contentWidth: 100, contentHeight: 40 };

Object.defineProperties(window.Element.prototype, {
  clientWidth: { configurable: true, get: function stage() { return this.classList.contains("mq-stage") ? sizes.stageWidth : 0; } },
  clientHeight: { configurable: true, get: function stage() { return this.classList.contains("mq-stage") ? sizes.stageHeight : 0; } },
});
Object.defineProperties(window.HTMLElement.prototype, {
  offsetWidth: { configurable: true, get: function content() { return this.classList.contains("mq-content") ? sizes.contentWidth : 0; } },
  offsetHeight: { configurable: true, get: function content() { return this.classList.contains("mq-content") ? sizes.contentHeight : 0; } },
});

const created = [];

function setup(overrides = {}) {
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const selected = [];
  const opened = [];
  const view = createView(host, { sanitize, onSelect: (entry) => selected.push(entry), onOpen: (url) => opened.push(url) });
  created.push(view);
  const state = (changes = {}) => ({ ...DEFAULTS, items: [], problem: null, ...overrides, ...changes });
  return { host, view, selected, opened, state };
}

const items = (...texts) => texts.map((text) => ({ text }));
const contents = (view) => [...view.track.querySelectorAll(".mq-content")];
const click = (node) => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));

afterEach(() => {
  for (const view of created.splice(0)) view.destroy();
  mock.timers.reset();
  Object.assign(sizes, { stageWidth: 300, stageHeight: 200, contentWidth: 100, contentHeight: 40 });
  window.document.body.replaceChildren();
});

test("a scrolling marquee has two equal groups of copies that fill the stage, and only the first copy is for a reader", () => {
  const { view, state } = setup();
  view.update(state({ items: items("AAPL", "GOOGL"), separator: " • " }));
  const groups = [...view.track.querySelectorAll(".mq-group")];
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.querySelectorAll(".mq-content").length), [3, 3]);
  const all = contents(view);
  assert.equal(all.filter((node) => !node.hasAttribute("aria-hidden")).length, 1);
  assert.equal(all.filter((node) => node.classList.contains("mq-clone") && node.getAttribute("aria-hidden") === "true").length, 5);
  const first = all[0];
  assert.deepEqual([...first.querySelectorAll(".mq-item")].map((node) => node.textContent), ["AAPL", "GOOGL"]);
  assert.deepEqual([...first.querySelectorAll(".mq-sep")].map((node) => [node.textContent, node.getAttribute("aria-hidden")]), [[" • ", "true"], [" • ", "true"]]);
});

test("the copies follow the size of the stage and are capped", () => {
  const { view, state } = setup();
  view.update(state({ items: items("a") }));
  assert.equal(contents(view).length, 6);
  sizes.stageWidth = 1000;
  view.resize();
  assert.equal(contents(view).length, 20);
  sizes.contentWidth = 450;
  view.resize();
  assert.equal(contents(view).length, 6);
  sizes.contentWidth = 1;
  view.resize();
  assert.equal(contents(view).length, MAX_COPIES * 2);
  sizes.stageWidth = 0;
  view.resize();
  assert.equal(contents(view).length, MAX_COPIES * 2);
});

test("a vertical marquee is measured by height", () => {
  const { view, state } = setup();
  view.update(state({ items: items("a"), direction: "up" }));
  assert.equal(view.root.dataset.axis, "y");
  assert.equal(contents(view).length, 2 * Math.ceil(200 / 40));
});

test("the options show on the root as data attributes, classes and variables", () => {
  const { view, state } = setup();
  view.update(state({ items: items("a"), direction: "down", behavior: "alternate", speed: 7.5, gap: 80, paused: true, pauseOnHover: true, clickable: true }));
  const { root, track } = view;
  assert.equal(root.dataset.axis, "y");
  assert.equal(root.dataset.direction, "down");
  assert.equal(root.dataset.behavior, "alternate");
  assert.equal(root.style.getPropertyValue("--mq-gap"), "80px");
  assert.equal(track.style.animationDuration, "7.5s");
  for (const name of ["is-paused", "is-pausable", "is-clickable"]) assert.ok(root.classList.contains(name), name);
  assert.equal(root.classList.contains("is-disabled"), false);
  view.update(state({ items: items("a"), pauseOnHover: false, clickable: false, disabled: true }));
  assert.equal(root.classList.contains("is-pausable"), false);
  assert.equal(root.classList.contains("is-clickable"), false);
  assert.ok(root.classList.contains("is-disabled"));
  assert.ok(root.classList.contains("is-paused"));
});

test("a label, a tooltip and an accessible name", () => {
  const { host, view, state } = setup();
  view.update(state({ items: items("a"), label: "News", description: "Latest headlines" }));
  const label = host.querySelector(".mq-label");
  assert.equal(label.textContent, "News");
  assert.equal(label.hidden, false);
  assert.equal(view.stage.getAttribute("title"), "Latest headlines");
  assert.equal(view.stage.getAttribute("aria-label"), "Latest headlines");
  assert.equal(view.stage.getAttribute("role"), "marquee");
  view.update(state({ items: items("a"), label: "News" }));
  assert.equal(view.stage.hasAttribute("title"), false);
  assert.equal(view.stage.getAttribute("aria-label"), "News");
  view.update(state({ items: items("a") }));
  assert.equal(label.hidden, true);
  assert.equal(view.stage.hasAttribute("aria-label"), false);
});

test("a static marquee shows one item at a time with no repeat and no separator", () => {
  const { view, state } = setup();
  view.update(state({ items: items("one", "two", "three"), behavior: "static", separator: " • " }));
  assert.equal(contents(view).length, 1);
  assert.equal(view.track.querySelector(".mq-sep"), null);
  assert.deepEqual([...view.track.querySelectorAll(".mq-item")].map((node) => node.textContent), ["one"]);
});

test("static items take turns every speed seconds, and wrap around", () => {
  mock.timers.enable({ apis: ["setInterval"] });
  const { view, state } = setup();
  view.update(state({ items: items("one", "two", "three"), behavior: "static", speed: 4 }));
  const shown = () => view.track.querySelector(".mq-item").textContent;
  assert.equal(shown(), "one");
  mock.timers.tick(3999);
  assert.equal(shown(), "one");
  mock.timers.tick(1);
  assert.equal(shown(), "two");
  mock.timers.tick(4000);
  assert.equal(shown(), "three");
  mock.timers.tick(4000);
  assert.equal(shown(), "one");
  assert.equal(view.track.querySelector(".mq-item").dataset.i, "0");
});

test("the pointer over the marquee marks it hovered, and leaving or cancelling clears it", () => {
  const { view, state } = setup();
  view.update(state({ items: items("a") }));
  assert.equal(view.root.classList.contains("is-hovered"), false);
  view.stage.dispatchEvent(new window.Event("pointerenter"));
  assert.equal(view.root.classList.contains("is-hovered"), true);
  view.stage.dispatchEvent(new window.Event("pointerleave"));
  assert.equal(view.root.classList.contains("is-hovered"), false);
  view.stage.dispatchEvent(new window.Event("pointerenter"));
  view.stage.dispatchEvent(new window.Event("pointercancel"));
  assert.equal(view.root.classList.contains("is-hovered"), false);
});

test("static items do not turn while paused, disabled or hovered with pause on hover", () => {
  mock.timers.enable({ apis: ["setInterval"] });
  const { view, state } = setup();
  const shown = () => view.track.querySelector(".mq-item").textContent;
  const base = { items: items("one", "two"), behavior: "static", speed: 2 };
  view.update(state({ ...base, paused: true }));
  mock.timers.tick(10000);
  assert.equal(shown(), "one");
  view.update(state({ ...base, disabled: true }));
  mock.timers.tick(10000);
  assert.equal(shown(), "one");
  view.update(state({ ...base }));
  view.stage.dispatchEvent(new window.Event("pointerenter"));
  mock.timers.tick(10000);
  assert.equal(shown(), "one");
  view.stage.dispatchEvent(new window.Event("pointerleave"));
  mock.timers.tick(2000);
  assert.equal(shown(), "two");
  view.stage.dispatchEvent(new window.Event("pointerenter"));
  view.update(state({ ...base, pauseOnHover: false }));
  mock.timers.tick(2000);
  assert.equal(shown(), "one");
});

test("a live update of the items does not restart the turns of a static marquee", () => {
  mock.timers.enable({ apis: ["setInterval"] });
  const { view, state } = setup();
  const shown = () => view.track.querySelector(".mq-item").textContent;
  const base = { behavior: "static", speed: 4 };
  view.update(state({ ...base, items: items("one", "two") }));
  mock.timers.tick(3000);
  view.update(state({ ...base, items: items("one", "two", "three") }));
  mock.timers.tick(1000);
  assert.equal(shown(), "two");
});

test("one static item, or a marquee that is not static, starts no timer", () => {
  mock.timers.enable({ apis: ["setInterval"] });
  const { view, state } = setup();
  view.update(state({ items: items("only"), behavior: "static", speed: 1 }));
  mock.timers.tick(5000);
  assert.equal(view.track.querySelector(".mq-item").textContent, "only");
  view.update(state({ items: items("a", "b"), behavior: "scroll", speed: 1 }));
  mock.timers.tick(5000);
  assert.equal(view.track.querySelector(".mq-item").textContent, "a");
});

test("alternate bounces between the two edges, whichever way it starts", () => {
  const { view, state } = setup();
  const vars = () => [view.track.style.getPropertyValue("--mq-from"), view.track.style.getPropertyValue("--mq-to")];
  sizes.contentWidth = 120;
  view.update(state({ items: items("a"), behavior: "alternate", direction: "left" }));
  assert.deepEqual(vars(), ["180px", "0px"]);
  view.update(state({ items: items("a"), behavior: "alternate", direction: "right" }));
  assert.deepEqual(vars(), ["0px", "180px"]);
  sizes.contentWidth = 500;
  view.resize();
  assert.deepEqual(vars(), ["-200px", "0px"]);
  view.update(state({ items: items("a"), behavior: "alternate", direction: "left" }));
  assert.deepEqual(vars(), ["0px", "-200px"]);
});

test("slide enters from one edge and stops at the other", () => {
  const { view, state } = setup();
  const vars = () => [view.track.style.getPropertyValue("--mq-from"), view.track.style.getPropertyValue("--mq-to")];
  sizes.contentWidth = 120;
  view.update(state({ items: items("a"), behavior: "slide", direction: "left" }));
  assert.deepEqual(vars(), ["300px", "0px"]);
  view.update(state({ items: items("a"), behavior: "slide", direction: "right" }));
  assert.deepEqual(vars(), ["-120px", "180px"]);
  sizes.contentWidth = 500;
  view.resize();
  assert.deepEqual(vars(), ["-500px", "0px"]);
  view.update(state({ items: items("a"), behavior: "slide", direction: "left" }));
  assert.deepEqual(vars(), ["300px", "-200px"]);
  sizes.contentHeight = 90;
  view.update(state({ items: items("a"), behavior: "slide", direction: "up" }));
  assert.deepEqual(vars(), ["200px", "0px"]);
  view.update(state({ items: items("a"), behavior: "slide", direction: "down" }));
  assert.deepEqual(vars(), ["-90px", "110px"]);
});

test("a change of text on the same items is written in place, so the animation does not restart", () => {
  const { view, state } = setup();
  const base = { items: [{ ticker: "AAPL", text: "AAPL 1" }, { ticker: "GOOGL", text: "GOOGL 1" }] };
  view.update(state(base));
  const track = view.track;
  const first = track.querySelector(".mq-content");
  view.update(state({ items: [{ ticker: "AAPL", text: "AAPL 2", tone: "up" }, { ticker: "GOOGL", text: "GOOGL 1" }] }));
  assert.equal(view.track, track);
  assert.equal(track.querySelector(".mq-content"), first);
  const texts = [...track.querySelectorAll('[data-i="0"]')].map((node) => node.textContent);
  assert.equal(texts.length, 6);
  assert.ok(texts.every((text) => text === "AAPL 2"));
  assert.ok([...track.querySelectorAll('[data-i="0"]')].every((node) => node.classList.contains("mq-tone-up")));
  assert.ok([...track.querySelectorAll('[data-i="1"]')].every((node) => node.textContent === "GOOGL 1" && !node.classList.contains("mq-tone-up")));
  sizes.stageWidth = 500;
  view.resize();
  assert.ok([...track.querySelectorAll('[data-i="0"]')].every((node) => node.textContent === "AAPL 2"));
});

test("a new ticker, a removed one or a changed layout builds the content again", () => {
  const { view, state } = setup();
  view.update(state({ items: [{ ticker: "A", text: "a" }] }));
  const first = view.track.querySelector(".mq-content");
  view.update(state({ items: [{ ticker: "A", text: "a" }, { ticker: "B", text: "b" }] }));
  const second = view.track.querySelector(".mq-content");
  assert.notEqual(second, first);
  assert.equal(second.querySelectorAll(".mq-item").length, 2);
  view.update(state({ items: [{ ticker: "A", text: "a" }, { ticker: "B", text: "b" }], separator: " | " }));
  assert.equal(view.track.querySelectorAll(".mq-sep").length > 0, true);
  view.update(state({ items: [{ ticker: "A", text: "a" }, { ticker: "B", text: "b" }], separator: " | ", behavior: "slide" }));
  assert.equal(view.track.querySelectorAll(".mq-group").length, 0);
  assert.equal(contents(view).length, 1);
});

test("an item with HTML is drawn from sanitized markup", () => {
  const { view, state } = setup();
  view.update(state({ items: [{ html: '<b>Rich</b> <a href="javascript:alert(1)">x</a><img src=x onerror="alert(1)"><script>alert(1)</script>' }] }));
  const item = view.track.querySelector(".mq-item");
  assert.equal(item.innerHTML, "<b>Rich</b> <a>x</a>");
  assert.equal(view.track.querySelector("script, img"), null);
});

test("an item draws its tone and its safe styles", () => {
  const { view, state } = setup();
  view.update(state({ items: [{ text: "a", tone: "down", style: { color: "#fff", "font-weight": "bold" } }] }));
  const item = view.track.querySelector(".mq-item");
  assert.ok(item.classList.contains("mq-tone-down"));
  assert.equal(item.style.getPropertyValue("color"), "rgb(255, 255, 255)");
  assert.equal(item.style.getPropertyValue("font-weight"), "bold");
  view.update(state({ items: [{ text: "a" }] }));
  assert.equal(view.track.querySelector(".mq-item").hasAttribute("style"), false);
  assert.equal(view.track.querySelector(".mq-item").classList.contains("mq-tone-down"), false);
});

test("the style of the marquee is applied, and taken back when it goes", () => {
  const { view, state } = setup();
  view.update(state({ items: items("a"), style: { padding: "4px 8px", "background-color": "#123456" } }));
  assert.equal(view.root.style.getPropertyValue("padding"), "4px 8px");
  assert.ok(view.root.style.getPropertyValue("background-color"));
  view.update(state({ items: items("a"), style: { padding: "2px" } }));
  assert.equal(view.root.style.getPropertyValue("padding"), "2px");
  assert.equal(view.root.style.getPropertyValue("background-color"), "");
  view.update(state({ items: items("a") }));
  assert.equal(view.root.style.getPropertyValue("padding"), "");
  assert.equal(view.root.style.getPropertyValue("--mq-gap"), "50px");
});

test("a problem replaces the content with a message, and the content comes back after it", () => {
  const { host, view, state } = setup();
  view.update(state({ items: items("a") }));
  view.update(state({ problem: "The Items setting is not a JSON list of items." }));
  assert.equal(host.querySelector(".mq-message").textContent, "The Items setting is not a JSON list of items.");
  assert.equal(host.querySelector(".mq-message").hidden, false);
  assert.equal(view.stage.hidden, true);
  assert.equal(view.track.children.length, 0);
  view.update(state({ items: items("b") }));
  assert.equal(host.querySelector(".mq-message").hidden, true);
  assert.equal(view.stage.hidden, false);
  assert.equal(view.track.querySelector(".mq-item").textContent, "b");
});

test("a clickable marquee reports the item that was clicked, or all the text from a gap", () => {
  const { view, selected, state } = setup();
  const list = [{ ticker: "A", text: "AAPL up", clickValue: "AAPL" }, { ticker: "B", text: "GOOGL down" }];
  view.update(state({ items: list, clickable: true, separator: " | " }));
  click(view.track.querySelectorAll('[data-i="1"]')[2]);
  click(view.track.querySelector('[data-i="0"]'));
  click(view.track.querySelector(".mq-sep"));
  assert.deepEqual(selected, [
    { item: list[1], text: "GOOGL down" },
    { item: list[0], text: "AAPL up" },
    { item: null, text: "AAPL up GOOGL down" },
  ]);
});

test("a marquee that is not clickable, or is disabled, reports nothing", () => {
  const { view, selected, state } = setup();
  view.update(state({ items: items("a") }));
  click(view.track.querySelector(".mq-item"));
  view.update(state({ items: items("a"), clickable: true, disabled: true }));
  click(view.track.querySelector(".mq-item"));
  view.stage.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.deepEqual(selected, []);
});

test("Enter and Space select the whole text of a clickable marquee, and it can be focused", () => {
  const { view, selected, state } = setup();
  view.update(state({ items: items("one", "two"), clickable: true }));
  assert.equal(view.stage.getAttribute("tabindex"), "0");
  view.stage.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  view.stage.dispatchEvent(new window.KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
  view.stage.dispatchEvent(new window.KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true }));
  assert.deepEqual(selected, [{ item: null, text: "one two" }, { item: null, text: "one two" }]);
  view.update(state({ items: items("one", "two") }));
  assert.equal(view.stage.hasAttribute("tabindex"), false);
});

test("a link in the content is opened by the host, never by the frame, with or without clickable", () => {
  const { view, opened, selected, state } = setup();
  view.update(state({ items: [{ html: '<a href="https://example.com/a">read</a>' }] }));
  const link = view.track.querySelector("a");
  const event = new window.MouseEvent("click", { bubbles: true, cancelable: true });
  link.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(opened, ["https://example.com/a"]);
  view.update(state({ items: [{ html: '<a href="https://example.com/a">read</a>' }], clickable: true }));
  click(view.track.querySelector("a"));
  assert.deepEqual(opened, ["https://example.com/a", "https://example.com/a"]);
  assert.deepEqual(selected, []);
});

test("the stream shows as a dot with its state, and goes when there is none", () => {
  const { host, view } = setup();
  const dot = host.querySelector(".mq-dot");
  assert.equal(dot.hidden, true);
  view.setStream({ state: "live" });
  assert.equal(dot.hidden, false);
  assert.equal(dot.dataset.state, "live");
  assert.equal(dot.getAttribute("title"), "Live");
  view.setStream({ state: "retrying", retryIn: 4 });
  assert.equal(dot.dataset.state, "retrying");
  assert.equal(dot.getAttribute("aria-label"), "Disconnected, retrying in 4 s");
  view.setStream(null);
  assert.equal(dot.hidden, true);
  assert.equal(statusText({ state: "connecting" }), "Connecting…");
  assert.equal(statusText({ state: "closed" }), "Closed");
});

test("destroy stops the timer and removes the marquee", () => {
  mock.timers.enable({ apis: ["setInterval"] });
  const { host, view, state } = setup();
  view.update(state({ items: items("one", "two"), behavior: "static", speed: 1 }));
  view.destroy();
  assert.equal(host.querySelector(".mq"), null);
  mock.timers.tick(5000);
});

test("an empty marquee has an empty track and a changed speed keeps working", () => {
  const { view, state } = setup();
  view.update(state({ items: [] }));
  assert.equal(view.track.querySelector(".mq-item"), null);
  view.update(state({ items: [], speed: 40 }));
  assert.equal(view.track.style.animationDuration, "40s");
});

const quoteItem = { ticker: "AAPL", label: "Apple Inc.", value: "185.32", change: "+1.2%", tone: "up", spark: [1, 3, 2, 4] };

test("a quote is drawn as a name, a price and a change, with a chart", () => {
  const { view, state } = setup();
  view.update(state({ items: [quoteItem] }));
  const node = view.track.querySelector(".mq-item");
  assert.ok(node.classList.contains("mq-quote"));
  assert.ok(node.classList.contains("has-name"));
  assert.ok(node.classList.contains("mq-tone-up"));
  assert.deepEqual([...node.querySelectorAll(".mq-info > span")].map((part) => [part.className, part.textContent]), [
    ["mq-tick", "AAPL"],
    ["mq-name", "Apple Inc."],
    ["mq-price", "185.32"],
    ["mq-change", "+1.2%"],
  ]);
  const chart = node.querySelector("svg.mq-spark");
  assert.equal(chart.getAttribute("aria-hidden"), "true");
  assert.equal(chart.getAttribute("viewBox"), "0 0 100 30");
  const points = chart.querySelector("polyline").getAttribute("points").split(" ").map((pair) => pair.split(",").map(Number));
  assert.equal(points.length, 4);
  assert.deepEqual(points.map(([x]) => x), [0, 100 / 3, 200 / 3, 100].map((x) => Number(x.toFixed(2))));
  assert.ok(points[3][1] < points[0][1]);
  assert.ok(points[1][1] < points[2][1]);
});

test("a quote with only a label, only a price, or no chart is drawn without the rest", () => {
  const { view, state } = setup();
  view.update(state({ items: [{ label: "CAD/USD", value: "0.6975" }, { ticker: "X", value: "1", spark: [3, 3, 3] }] }));
  const [first, second] = [...view.track.querySelector(".mq-content").querySelectorAll(".mq-item")];
  assert.deepEqual([...first.querySelectorAll(".mq-info > span")].map((part) => part.className), ["mq-tick", "mq-price"]);
  assert.equal(first.querySelector("svg"), null);
  assert.equal(first.classList.contains("has-name"), false);
  assert.ok(second.querySelector("svg polyline"));
  const flat = second.querySelector("polyline").getAttribute("points").split(" ").map((pair) => pair.split(",")[1]);
  assert.equal(new Set(flat).size, 1);
});

test("a quote is drawn the same way in a column", () => {
  const { view, state } = setup();
  view.update(state({ items: [quoteItem], direction: "up" }));
  assert.equal(view.root.dataset.axis, "y");
  assert.ok(view.track.querySelector(".mq-item.mq-quote .mq-tick"));
  assert.ok(view.track.querySelector(".mq-item.mq-quote svg.mq-spark"));
});

test("a quote's price changing is written in place and flashes, and a new chart alone does not flash", () => {
  const { view, state } = setup();
  view.update(state({ items: [quoteItem, { ticker: "B", label: "B", value: "1", change: "0%" }] }));
  const content = view.track.querySelector(".mq-content");
  view.update(state({ items: [{ ...quoteItem, value: "186.00", change: "+1.6%" }, { ticker: "B", label: "B", value: "1", change: "0%" }] }));
  assert.equal(view.track.querySelector(".mq-content"), content);
  const nodes = [...view.track.querySelectorAll('[data-i="0"]')];
  assert.ok(nodes.length > 1);
  for (const node of nodes) {
    assert.equal(node.querySelector(".mq-price").textContent, "186.00");
    assert.ok(node.classList.contains("mq-flash-a") || node.classList.contains("mq-flash-b"));
  }
  assert.ok([...view.track.querySelectorAll('[data-i="1"]')].every((node) => !node.className.includes("mq-flash")));
  view.update(state({ items: [{ ...quoteItem, value: "186.00", change: "+1.6%", spark: [1, 2, 3] }, { ticker: "B", label: "B", value: "1", change: "0%" }] }));
  assert.ok([...view.track.querySelectorAll('[data-i="0"]')].every((node) => !node.className.includes("mq-flash")));
  assert.equal(view.track.querySelector('[data-i="0"] polyline').getAttribute("points").split(" ").length, 3);
});

test("two updates in a row flash again, with the other name so that the animation restarts", () => {
  const { view, state } = setup();
  const at = (value) => state({ items: [{ ticker: "A", label: "A", value, change: "0%" }] });
  view.update(at("1"));
  view.update(at("2"));
  const first = view.track.querySelector('[data-i="0"]').className;
  view.update(at("3"));
  const second = view.track.querySelector('[data-i="0"]').className;
  assert.match(first, /mq-flash-[ab]/);
  assert.match(second, /mq-flash-[ab]/);
  assert.notEqual(first.match(/mq-flash-[ab]/)[0], second.match(/mq-flash-[ab]/)[0]);
});

test("clicking a quote reports its parts as text, and a click on a gap reports every quote", () => {
  const { view, selected, state } = setup();
  view.update(state({ items: [quoteItem, { ticker: "B", label: "B Inc.", value: "2", change: "-1%" }], clickable: true, separator: " | " }));
  click(view.track.querySelector('[data-i="0"] .mq-price'));
  click(view.track.querySelector(".mq-sep"));
  assert.equal(selected[0].text, "AAPL Apple Inc. 185.32 +1.2%");
  assert.equal(selected[0].item.ticker, "AAPL");
  assert.equal(selected[1].text, "AAPL Apple Inc. 185.32 +1.2% B B Inc. 2 -1%");
});
