import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULTS,
  LIMITS,
  NOT_A_MARQUEE,
  applyMessage,
  cell,
  createLive,
  isMarkup,
  isQuote,
  isSafeLink,
  itemText,
  partsText,
  plainText,
  readBase,
  readDocument,
  readFields,
  readItem,
  readItems,
  readSpark,
  resolve,
  shownText,
  toneOf,
} from "../src/model.js";

const state = (data, live = createLive()) => resolve(readBase(data), live);
const message = (live, current, body) => applyMessage(live, current, body);

test("a bare string is text, unless it has both < and >, when it is simple HTML", () => {
  assert.deepEqual(readItem("Breaking news"), { text: "Breaking news" });
  assert.deepEqual(readItem("a < b"), { text: "a < b" });
  assert.deepEqual(readItem("<b>Breaking</b> news"), { html: "<b>Breaking</b> news" });
  assert.equal(isMarkup("x > y"), false);
  assert.equal(isMarkup("<i>x</i>"), true);
});

test("an item object reads its ticker, text, tone and safe style, and an empty html gives way to the text", () => {
  const item = readItem({ ticker: "AAPL", text: "AAPL $185.32 +1.2%", html: "", tone: "up", style: "color: #fff; position: fixed" });
  assert.deepEqual(item, { ticker: "AAPL", text: "AAPL $185.32 +1.2%", tone: "up", style: { color: "#fff" } });
  assert.deepEqual(readItem({ ticker: "X", html: "<b>x</b>", text: "ignored" }), { ticker: "X", html: "<b>x</b>" });
  assert.deepEqual(readItem({ ticker: "" }), { text: "" });
});

test("an item keeps a tone, a link that is safe and a click value", () => {
  assert.equal(readItem({ text: "a", tone: "down" }).tone, "down");
  assert.equal(readItem({ text: "a", tone: "loud" }).tone, undefined);
  assert.equal(readItem({ text: "a", url: "https://example.com/a" }).url, "https://example.com/a");
  for (const url of ["javascript:alert(1)", "http://example.com", "data:text/html,x", "//example.com", "/x"]) assert.equal(readItem({ text: "a", url }).url, undefined, url);
  assert.equal(readItem({ text: "a", clickValue: "AAPL" }).clickValue, "AAPL");
});

test("things that are not items are dropped, and the list is capped", () => {
  assert.equal(readItem(5), null);
  assert.equal(readItem(null), null);
  assert.equal(readItem([1]), null);
  assert.deepEqual(readItems("x"), []);
  assert.deepEqual(readItems(["a", 3, { text: "b" }, null]), [{ text: "a" }, { text: "b" }]);
  assert.equal(readItems(Array.from({ length: 500 }, (_, i) => `n${i}`)).length, LIMITS.items);
  assert.equal(readItem("x".repeat(5000)).text.length, LIMITS.itemText);
  assert.equal(readItem({ ticker: "t".repeat(200), text: "a" }).ticker.length, LIMITS.ticker);
});

test("a tone is up, down or neutral, and nothing else", () => {
  assert.equal(toneOf("up"), "up");
  assert.equal(toneOf("down extra"), "down");
  assert.equal(toneOf(["x", "neutral"]), "neutral");
  assert.equal(toneOf("warning"), null);
  assert.equal(toneOf("constructor"), null);
  assert.equal(toneOf("__proto__"), null);
  assert.equal(toneOf(5), null);
  assert.equal(readItem({ text: "a", tone: "loud" }).tone, undefined);
});

test("options are read with their ranges", () => {
  assert.deepEqual(readFields({ speed: 0.2 }), { speed: 1 });
  assert.deepEqual(readFields({ speed: 900 }), { speed: 300 });
  assert.deepEqual(readFields({ speed: 7.5 }), { speed: 7.5 });
  assert.deepEqual(readFields({ speed: "5" }), {});
  assert.deepEqual(readFields({ speed: Number.NaN }), {});
  assert.deepEqual(readFields({ gap: -4 }), { gap: 0 });
  assert.deepEqual(readFields({ gap: 5000 }), { gap: 500 });
  assert.deepEqual(readFields({ gap: 12.6 }), { gap: 13 });
  assert.deepEqual(readFields({ direction: "up", behavior: "slide" }), { direction: "up", behavior: "slide" });
  assert.deepEqual(readFields({ direction: "sideways", behavior: "teleport" }), {});
  assert.deepEqual(readFields({ pauseOnHover: false, clickable: true, disabled: false, paused: true }), { pauseOnHover: false, clickable: true, disabled: false, paused: true });
  assert.deepEqual(readFields({ pauseOnHover: "no", paused: 1 }), {});
  assert.deepEqual(readFields({ separator: " • ", description: "d", label: "News", clickParam: "symbol" }), { separator: " • ", description: "d", label: "News", clickParam: "symbol" });
  assert.deepEqual(readFields({ style: "color: red; position: fixed" }), { style: { color: "red" } });
});

test("an option that is empty is kept, so that an endpoint or a stream can clear one", () => {
  assert.deepEqual(readFields({ separator: "", label: "", style: "" }), { separator: "", label: "", style: {} });
});

test("a document is a string, a list or an object", () => {
  assert.deepEqual(readDocument("Hello"), { items: [{ text: "Hello" }], fields: {} });
  assert.deepEqual(readDocument(""), { items: [], fields: {} });
  assert.deepEqual(readDocument(["a", { ticker: "B", text: "b" }]), { items: [{ text: "a" }, { ticker: "B", text: "b" }], fields: {} });
  assert.deepEqual(readDocument({ text: "Hello", speed: 8, direction: "right" }), { items: [{ text: "Hello" }], fields: { speed: 8, direction: "right" } });
  assert.deepEqual(readDocument({ items: ["a", "b"], text: "ignored" }).items, [{ text: "a" }, { text: "b" }]);
  assert.deepEqual(readDocument({ items: [], text: "kept" }).items, [{ text: "kept" }]);
  assert.deepEqual(readDocument({ speed: 5 }), { items: [], fields: { speed: 5 } });
  for (const bad of [5, true, undefined, null]) assert.equal(readDocument(bad), null);
});

test("the options of the layers apply in the order live, endpoint, built-in", () => {
  const data = { text: "from endpoint", speed: 40, direction: "up", gap: 10 };
  const live = createLive();
  assert.equal(state(data, live).speed, 40);
  live.fields.speed = 8;
  const resolved = state(data, live);
  assert.equal(resolved.speed, 8);
  assert.equal(resolved.direction, "up");
  assert.equal(resolved.gap, 10);
  assert.equal(resolved.behavior, DEFAULTS.behavior);
  assert.equal(resolved.pauseOnHover, true);
  assert.equal(resolved.clickParam, "value");
  assert.equal(state("x").gap, DEFAULTS.gap);
  assert.equal(state("x", Object.assign(createLive(), { fields: { direction: "down" } })).gap, 0);
});

test("the content of the layers applies in the order live, endpoint", () => {
  const data = ["from endpoint"];
  const live = createLive();
  assert.deepEqual(state(data, live).items, [{ text: "from endpoint" }]);
  live.items = [{ text: "live" }];
  assert.deepEqual(state(data, live).items, [{ text: "live" }]);
  assert.deepEqual(state(undefined).items, []);
});

test("an endpoint that sends neither text, items nor an object is reported", () => {
  assert.equal(state(42).problem, NOT_A_MARQUEE);
  assert.equal(state(true).problem, NOT_A_MARQUEE);
  for (const empty of [undefined, null, "", {}]) assert.equal(state(empty).problem, null);
  const live = createLive();
  live.items = [{ text: "live" }];
  assert.equal(state(42, live).problem, null);
});

test("set-content replaces the content with text, html or items, and sets options", () => {
  const live = createLive();
  assert.equal(message(live, [], { op: "set-content", text: "Updated <b>content</b>" }), true);
  assert.deepEqual(live.items, [{ text: "Updated <b>content</b>" }]);
  assert.equal(message(live, [], { op: "set-content", html: "<b>Rich</b>" }), true);
  assert.deepEqual(live.items, [{ html: "<b>Rich</b>" }]);
  assert.equal(message(live, [], { op: "set-content", items: ["a", { ticker: "B", text: "b" }] }), true);
  assert.deepEqual(live.items, [{ text: "a" }, { ticker: "B", text: "b" }]);
  assert.equal(message(live, [], { op: "set-content", text: "" }), true);
  assert.deepEqual(live.items, []);
});

test("set-content with only options leaves the content alone", () => {
  const live = createLive();
  assert.equal(message(live, [], { op: "set-content", speed: 8, paused: true, separator: " | " }), true);
  assert.equal(live.items, null);
  assert.deepEqual(live.fields, { speed: 8, paused: true, separator: " | " });
  assert.equal(message(live, [], { op: "set-content", paused: false }), true);
  assert.equal(live.fields.paused, false);
  assert.equal(message(live, [], { op: "set-content" }), false);
  assert.equal(message(live, [], { op: "set-content", speed: "fast" }), false);
});

test("set-content and set-item read their fields from the message itself", () => {
  const live = createLive();
  assert.equal(message(live, [], { op: "set-content", id: "ignored", text: "AAPL up", speed: 20 }), true);
  assert.deepEqual(live.items, [{ text: "AAPL up" }]);
  assert.equal(live.fields.speed, 20);
  const current = [{ ticker: "AAPL", text: "AAPL $185.50", tone: "down" }];
  const item = createLive();
  assert.equal(message(item, current, { op: "set-item", ticker: "AAPL", text: "AAPL $186.25", tone: "up", style: { color: "#22c55e", fontWeight: "bold" } }), true);
  assert.deepEqual(item.items, [{ ticker: "AAPL", text: "AAPL $186.25", tone: "up", style: { color: "#22c55e", "font-weight": "bold" } }]);
  assert.equal(message(createLive(), current, { event: "set-item", data: { ticker: "AAPL", text: "x" } }), false);
});

test("set-item changes one ticker and leaves the others, and the current list is not touched", () => {
  const live = createLive();
  const current = [
    { ticker: "AAPL", text: "AAPL 1", tone: "up" },
    { ticker: "GOOGL", text: "GOOGL 1" },
  ];
  assert.equal(message(live, current, { op: "set-item", ticker: "GOOGL", text: "GOOGL 2", tone: "down" }), true);
  assert.deepEqual(live.items, [
    { ticker: "AAPL", text: "AAPL 1", tone: "up" },
    { ticker: "GOOGL", text: "GOOGL 2", tone: "down" },
  ]);
  assert.deepEqual(current[1], { ticker: "GOOGL", text: "GOOGL 1" });
  assert.equal(message(live, [], { op: "set-item", ticker: "AAPL", tone: null }), true);
  assert.equal(live.items[0].tone, undefined);
});

test("set-item with html replaces the text, and with text replaces the html", () => {
  const live = createLive();
  message(live, [{ ticker: "A", text: "plain" }], { op: "set-item", ticker: "A", html: "<b>rich</b>" });
  assert.deepEqual(live.items[0], { ticker: "A", html: "<b>rich</b>" });
  message(live, [], { op: "set-item", ticker: "A", text: "plain again" });
  assert.deepEqual(live.items[0], { ticker: "A", text: "plain again" });
});

test("set-item adds a ticker the list does not have yet, up to the cap", () => {
  const live = createLive();
  assert.equal(message(live, [{ ticker: "A", text: "a" }], { op: "set-item", ticker: "B", text: "b" }), true);
  assert.deepEqual(live.items, [
    { ticker: "A", text: "a" },
    { ticker: "B", text: "b" },
  ]);
  const full = Array.from({ length: LIMITS.items }, (_, i) => ({ ticker: `t${i}`, text: "x" }));
  const other = createLive();
  assert.equal(message(other, full, { op: "set-item", ticker: "new", text: "n" }), false);
  assert.equal(other.items, null);
});

test("set-item styles are filtered, merged and removed, and a tone can be cleared", () => {
  const live = createLive();
  const current = [{ ticker: "A", text: "a", tone: "up", style: { color: "red" } }];
  message(live, current, { op: "set-item", ticker: "A", style: { color: "url(https://evil.example)", position: "fixed", opacity: "0.5" } });
  assert.deepEqual(live.items[0], { ticker: "A", text: "a", tone: "up", style: { color: "red", opacity: "0.5" } });
  message(live, [], { op: "set-item", ticker: "A", style: "font-weight: bold; position: fixed" });
  assert.deepEqual(live.items[0].style, { color: "red", opacity: "0.5", "font-weight": "bold" });
  message(live, [], { op: "set-item", ticker: "A", tone: "" });
  assert.equal(live.items[0].tone, undefined);
  message(live, [], { op: "set-item", ticker: "A", style: { color: null, opacity: "", fontWeight: null } });
  assert.equal(live.items[0].style, undefined);
});

test("set-item takes a link and a click value, and refuses an unsafe link", () => {
  const live = createLive();
  message(live, [{ ticker: "A", text: "a" }], { op: "set-item", ticker: "A", url: "https://example.com/a", clickValue: "AAPL" });
  assert.equal(live.items[0].url, "https://example.com/a");
  assert.equal(live.items[0].clickValue, "AAPL");
  message(live, [], { op: "set-item", ticker: "A", url: "javascript:alert(1)", clickValue: "" });
  assert.equal(live.items[0].url, undefined);
  assert.equal(live.items[0].clickValue, undefined);
});

test("set-item without a ticker does nothing", () => {
  const live = createLive();
  for (const body of [{ op: "set-item" }, { op: "set-item", ticker: "" }, { op: "set-item", ticker: 4 }, { op: "set-item", text: "x" }]) assert.equal(message(live, [], body), false);
  assert.equal(live.items, null);
});

test("remove-item drops a ticker", () => {
  const live = createLive();
  const current = [
    { ticker: "A", text: "a" },
    { ticker: "B", text: "b" },
  ];
  assert.equal(message(live, current, { op: "remove-item", ticker: "A" }), true);
  assert.deepEqual(live.items, [{ ticker: "B", text: "b" }]);
  assert.equal(message(live, current, { op: "remove-item", ticker: "Z" }), false);
  assert.equal(message(live, current, { op: "remove-item" }), false);
});

test("messages that are not understood change nothing", () => {
  const live = createLive();
  for (const body of [null, undefined, 7, "set-content", [], {}, { op: "explode" }, { op: "__proto__" }, { op: "constructor", text: "x" }, { op: 4 }, { event: "set-content", text: "x" }]) {
    assert.equal(message(live, [], body), false, JSON.stringify(body));
  }
  assert.equal(live.items, null);
  assert.deepEqual(live.fields, {});
});

test("the text of an item is its text, or the text of its HTML", () => {
  assert.equal(itemText({ text: "a" }, () => "x"), "a");
  assert.equal(itemText({ html: "<b>b</b>" }, (html) => `plain(${html})`), "plain(<b>b</b>)");
  assert.equal(itemText({}, () => "x"), "");
});

test("a CSV cell is quoted, and a formula is defused", () => {
  assert.equal(cell("plain"), "plain");
  assert.equal(cell('a,"b"'), '"a,""b"""');
  assert.equal(cell("two\nlines"), '"two\nlines"');
  assert.equal(cell("=SUM(A1:A9)"), "'=SUM(A1:A9)");
  assert.equal(cell("+1"), "'+1");
  assert.equal(cell("-1"), "'-1");
  assert.equal(cell("@x"), "'@x");
  assert.equal(cell(null), "");
});

test("links are https and mailto only", () => {
  for (const ok of ["https://example.com", "https://example.com/a?b=c#d", "mailto:a@example.com"]) assert.equal(isSafeLink(ok), true, ok);
  for (const bad of ["", null, undefined, "#a", "http://example.com", "javascript:alert(1)", "data:text/html,x", "//example.com", "/relative", "https://exa mple.com", "https://x.example/\n", `https://example.com/${"a".repeat(2000)}`]) {
    assert.equal(isSafeLink(bad), false, String(bad));
  }
});

test("a quote has a name, a price, a change and a chart, and needs no text", () => {
  const item = readItem({ ticker: "AAPL", label: "Apple Inc.", value: 185.32, change: "+1.2%", spark: [1, 2, 3, "x", Number.NaN, 4], tone: "up" });
  assert.deepEqual(item, { ticker: "AAPL", label: "Apple Inc.", value: "185.32", change: "+1.2%", spark: [1, 2, 3, 4], tone: "up" });
  assert.equal(isQuote(item), true);
  assert.equal(isQuote({ text: "a" }), false);
  assert.equal(isQuote({ ticker: "A", text: "" }), false);
  assert.equal(partsText(item), "AAPL Apple Inc. 185.32 +1.2%");
  assert.equal(plainText(item), "AAPL Apple Inc. 185.32 +1.2%");
  assert.equal(plainText({ text: "plain" }), "plain");
  assert.equal(itemText(item, () => "x"), "AAPL Apple Inc. 185.32 +1.2%");
  assert.deepEqual(readItem({ value: "7" }), { value: "7" });
  assert.deepEqual(readItem({ text: "kept", value: "7" }), { text: "kept", value: "7" });
});

test("a chart needs two numbers, and has at most a hundred and twenty", () => {
  assert.equal(readSpark([1]), null);
  assert.equal(readSpark(["a", "b"]), null);
  assert.equal(readSpark("1,2"), null);
  assert.equal(readSpark(null), null);
  assert.deepEqual(readSpark([1, 2]), [1, 2]);
  assert.equal(readSpark(Array.from({ length: 500 }, (_, i) => i)).length, LIMITS.spark);
  assert.equal(readItem({ ticker: "A", value: "1", spark: [5] }).spark, undefined);
});

test("quote fields are bounded", () => {
  const item = readItem({ label: "l".repeat(500), value: "v".repeat(500), change: "c".repeat(500) });
  assert.equal(item.label.length, LIMITS.itemLabel);
  assert.equal(item.value.length, LIMITS.itemValue);
  assert.equal(item.change.length, LIMITS.itemChange);
});

test("shown text tells a changed quote from an unchanged one, and a chart alone changes nothing shown", () => {
  const a = { ticker: "A", value: "1", change: "+1%", spark: [1, 2] };
  assert.equal(shownText(a), shownText({ ...a, spark: [1, 2, 3] }));
  assert.notEqual(shownText(a), shownText({ ...a, value: "2" }));
  assert.notEqual(shownText({ html: "<b>a</b>" }), shownText({ text: "<b>a</b>" }));
});

test("set-item changes the price, the change and the chart of a quote, and leaves the rest", () => {
  const live = createLive();
  const current = [{ ticker: "AAPL", label: "Apple Inc.", value: "185.32", change: "+1.2%", tone: "up", spark: [1, 2] }];
  assert.equal(message(live, current, { op: "set-item", ticker: "AAPL", value: 186.25, change: "-0.4%", tone: "down", spark: [1, 2, 3] }), true);
  assert.deepEqual(live.items, [{ ticker: "AAPL", label: "Apple Inc.", value: "186.25", change: "-0.4%", tone: "down", spark: [1, 2, 3] }]);
  message(live, [], { op: "set-item", ticker: "AAPL", spark: null, change: "" });
  assert.deepEqual(live.items, [{ ticker: "AAPL", label: "Apple Inc.", value: "186.25", tone: "down" }]);
});

test("set-item with text turns a quote into text, and with a price turns text into a quote", () => {
  const live = createLive();
  message(live, [{ ticker: "A", label: "Name", value: "1", change: "+1%", spark: [1, 2] }], { op: "set-item", ticker: "A", text: "Halted" });
  assert.deepEqual(live.items, [{ ticker: "A", text: "Halted" }]);
  message(live, [], { op: "set-item", ticker: "A", value: "5", change: "+2%" });
  assert.equal(isQuote(live.items[0]), true);
  assert.equal(partsText(live.items[0]), "A 5 +2%");
  message(live, [], { op: "set-item", ticker: "A", html: "<b>Rich</b>" });
  assert.deepEqual(live.items, [{ ticker: "A", html: "<b>Rich</b>" }]);
});

test("set-item adds a quote the list does not have yet", () => {
  const live = createLive();
  message(live, [{ ticker: "A", text: "a" }], { op: "set-item", ticker: "NVDA", label: "NVIDIA", value: "480.00", change: "+3.0%", tone: "up", spark: [1, 2, 3] });
  assert.deepEqual(live.items[1], { ticker: "NVDA", label: "NVIDIA", value: "480.00", change: "+3.0%", tone: "up", spark: [1, 2, 3] });
});
