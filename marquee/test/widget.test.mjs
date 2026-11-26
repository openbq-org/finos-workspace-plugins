import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><body></body>");
const { window } = dom;
globalThis.window = window;

Object.defineProperties(window.Element.prototype, {
  clientWidth: { configurable: true, get: function stage() { return this.classList.contains("mq-stage") ? 300 : 0; } },
  clientHeight: { configurable: true, get: function stage() { return this.classList.contains("mq-stage") ? 200 : 0; } },
});
Object.defineProperties(window.HTMLElement.prototype, {
  offsetWidth: { configurable: true, get: function content() { return this.classList.contains("mq-content") ? 100 : 0; } },
  offsetHeight: { configurable: true, get: function content() { return this.classList.contains("mq-content") ? 40 : 0; } },
});

const observers = [];
globalThis.ResizeObserver = class {
  constructor(callback) {
    this.callback = callback;
    this.live = true;
    observers.push(this);
  }
  observe() {}
  disconnect() {
    this.live = false;
  }
};

const { default: widget } = await import("../src/entry.js");

function makeModel(values) {
  const handlers = new Map();
  return {
    values,
    saved: [],
    get: (name) => structuredClone(values[name]),
    set(name, value) {
      values[name] = value;
    },
    save_changes() {
      this.saved.push(structuredClone(values.params));
    },
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(handler);
    },
    off(event, handler) {
      handlers.get(event)?.delete(handler);
    },
    handlers,
    emit(event, payload) {
      for (const handler of [...(handlers.get(event) ?? [])]) handler(payload);
    },
    change(name, value) {
      values[name] = value;
      this.emit(`change:${name}`);
    },
    stream(...messages) {
      this.emit("msg:custom", { kind: "workspace-event", name: "stream", messages });
    },
    status(state, retryIn) {
      this.emit("msg:custom", { kind: "workspace-event", name: "stream-status", state, retryIn });
    },
    action(id) {
      this.emit("msg:custom", { kind: "workspace-event", name: "action", id });
    },
  };
}

const running = [];

async function mount(values = {}) {
  const model = makeModel({ data: undefined, params: {}, theme: { mode: "dark", tokens: {} }, ...values });
  const el = window.document.createElement("div");
  window.document.body.append(el);
  const invoked = [];
  const controller = new AbortController();
  const experimental = {
    invoke: async (name, message) => {
      invoked.push([name, message]);
      return [{}, []];
    },
  };
  const exports = widget.initialize({ model });
  await widget.render({ model, el, signal: controller.signal, experimental });
  running.push(controller);
  const items = () => [...el.querySelectorAll(".mq-content")[0]?.querySelectorAll(".mq-item") ?? []].map((node) => node.textContent);
  return { model, el, invoked, controller, exports, items };
}

const click = (node) => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));

afterEach(() => {
  for (const controller of running.splice(0)) controller.abort();
  window.document.body.replaceChildren();
});

test("before anything is drawn there is nothing to export, and a list gives three exports", async () => {
  const empty = widget.initialize({ model: makeModel({ data: undefined }) });
  assert.deepEqual(await empty.exportOptions(), []);
  assert.equal(await empty.exportData("items"), null);
  const { exports } = await mount({ data: [{ ticker: "AAPL", text: "AAPL 1", tone: "up" }, "plain"] });
  assert.deepEqual(
    (await exports.exportOptions()).map((option) => [option.id, option.extension, option.mime]),
    [
      ["items", "json", "application/json"],
      ["csv", "csv", "text/csv"],
      ["text", "txt", "text/plain"],
    ],
  );
  assert.deepEqual(JSON.parse(await exports.exportData("items")), [
    { ticker: "AAPL", text: "AAPL 1", tone: "up" },
    { ticker: "", text: "plain", tone: "" },
  ]);
  assert.equal(await exports.exportData("csv"), "ticker,text,tone\nAAPL,AAPL 1,up\n,plain,\n");
  assert.equal(await exports.exportData("text"), "AAPL 1\nplain");
  assert.equal(await exports.exportData("nope"), null);
});

test("an export has the text of HTML items and defuses a formula", async () => {
  const { exports } = await mount({ data: [{ html: "<b>Bold</b> <i>move</i>" }, "=HYPERLINK(1)"] });
  assert.equal(await exports.exportData("text"), "Bold move\n=HYPERLINK(1)");
  assert.match(await exports.exportData("csv"), /,'=HYPERLINK\(1\),/);
});

test("the agent gets the text, the items and the options, and the stream state", async () => {
  const { exports, model } = await mount({ data: { items: ["a", { ticker: "B", text: "b", tone: "down" }], speed: 9, direction: "right" } });
  assert.deepEqual(await exports.copilotContext(), {
    text: "a b",
    items: [
      { ticker: "", text: "a", tone: "" },
      { ticker: "B", text: "b", tone: "down" },
    ],
    count: 2,
    behavior: "scroll",
    direction: "right",
    speed: 9,
    gap: 50,
    paused: false,
    clickable: false,
    disabled: false,
  });
  model.status("live");
  assert.equal((await exports.copilotContext()).stream, "live");
});

test("the agent is told when the answer is not a marquee", async () => {
  const { exports } = await mount({ data: 42 });
  assert.deepEqual(await exports.copilotContext(), { error: "The endpoint did not return text, a list of items or a marquee object." });
});

test("the data of the endpoint is drawn, and drawn again when it changes", async () => {
  const { model, items, el } = await mount({ data: ["AAPL up", "GOOGL down"] });
  assert.deepEqual(items(), ["AAPL up", "GOOGL down"]);
  model.change("data", { text: "Replaced", direction: "up" });
  assert.deepEqual(items(), ["Replaced"]);
  assert.equal(el.querySelector(".mq").dataset.direction, "up");
  model.change("data", 42);
  assert.match(el.querySelector(".mq-message").textContent, /did not return/);
});

test("a stream replaces the content, changes one ticker, adds one and removes one", async () => {
  const { model, items } = await mount({ data: [{ ticker: "AAPL", text: "AAPL 1" }, { ticker: "GOOGL", text: "GOOGL 1" }] });
  model.stream({ op: "set-item", ticker: "AAPL", text: "AAPL 2", tone: "up" });
  assert.deepEqual(items(), ["AAPL 2", "GOOGL 1"]);
  model.stream({ op: "set-item", ticker: "MSFT", text: "MSFT 1" }, { op: "remove-item", ticker: "GOOGL" });
  assert.deepEqual(items(), ["AAPL 2", "MSFT 1"]);
  model.stream({ op: "set-content", text: "Breaking <b>news</b>" });
  assert.deepEqual(items(), ["Breaking <b>news</b>"]);
  model.stream({ op: "set-content", items: ["x", "y"], speed: 5, paused: true });
  assert.deepEqual(items(), ["x", "y"]);
});

test("a stream message that is hostile or not understood changes nothing and breaks nothing", async () => {
  const { model, items, el } = await mount({ data: ["steady"] });
  model.stream(null, 7, "x", [], { op: "explode" }, { op: "set-item" }, { op: "set-item", ticker: "A", html: "<img src=x onerror=alert(1)><script>alert(1)</script>ok", style: { color: "url(https://evil.example)" } });
  assert.equal(el.querySelector("script, img"), null);
  assert.ok(items().includes("steady"));
  model.emit("msg:custom", null);
  model.emit("msg:custom", { kind: "other", name: "stream", messages: [{ op: "set-content", text: "no" }] });
  model.emit("msg:custom", { kind: "workspace-event", name: "stream", messages: "nope" });
  assert.ok(items().includes("steady"));
});

test("a stream can set the speed and the pause, and a pause holds the movement and the content as they were", async () => {
  const { model, el, items } = await mount({ data: { items: ["x"], speed: 20 } });
  const track = () => el.querySelector(".mq-track");
  const root = () => el.querySelector(".mq");
  assert.equal(track().style.animationDuration, "20s");
  model.stream({ op: "set-content", paused: true, speed: 8 });
  assert.ok(root().classList.contains("is-paused"));
  assert.equal(track().style.animationDuration, "8s");
  model.stream({ op: "set-content", items: ["y"], speed: 3 });
  assert.equal(track().style.animationDuration, "8s");
  assert.deepEqual(items(), ["x"]);
  model.stream({ op: "set-content", paused: false });
  assert.equal(root().classList.contains("is-paused"), false);
  assert.equal(track().style.animationDuration, "3s");
  assert.deepEqual(items(), ["y"]);
});

test("the Pause button freezes the movement and the updates, and the next press shows the current content", async () => {
  const { model, el, items } = await mount({ data: [{ ticker: "A", text: "A 1" }, { ticker: "B", text: "B 1" }] });
  const root = () => el.querySelector(".mq");
  const tag = () => el.querySelector(".mq-paused");
  assert.equal(tag().hidden, true);
  model.action("pause");
  assert.ok(root().classList.contains("is-paused"));
  assert.equal(tag().hidden, false);
  model.stream({ op: "set-item", ticker: "A", text: "A 2", tone: "up" });
  model.stream({ op: "set-item", ticker: "C", text: "C 1" });
  assert.deepEqual(items(), ["A 1", "B 1"]);
  model.change("data", [{ ticker: "A", text: "A 3" }, { ticker: "B", text: "B 3" }]);
  assert.deepEqual(items(), ["A 1", "B 1"]);
  model.action("pause");
  assert.equal(root().classList.contains("is-paused"), false);
  assert.equal(tag().hidden, true);
  assert.deepEqual(items(), ["A 3", "B 3"]);
});

test("while it is paused the exports and the agent see what the card shows", async () => {
  const { model, exports } = await mount({ data: ["one"] });
  model.action("pause");
  model.stream({ op: "set-content", items: ["two"] });
  assert.equal(await exports.exportData("text"), "one");
  const held = await exports.copilotContext();
  assert.equal(held.text, "one");
  assert.equal(held.paused, true);
  model.action("pause");
  assert.equal(await exports.exportData("text"), "two");
  assert.equal((await exports.copilotContext()).paused, false);
});

test("a message that sets the pause, and a refresh, end a pause of the button", async () => {
  const { model, el, items } = await mount({ data: ["base"] });
  const root = () => el.querySelector(".mq");
  model.action("pause");
  model.stream({ op: "set-content", items: ["live"] });
  assert.deepEqual(items(), ["base"]);
  model.stream({ op: "set-content", paused: false });
  assert.deepEqual(items(), ["live"]);
  assert.equal(root().classList.contains("is-paused"), false);
  model.action("pause");
  model.stream({ op: "set-content", items: ["again"] });
  model.emit("msg:custom", { kind: "workspace-event", name: "refresh" });
  assert.equal(root().classList.contains("is-paused"), false);
  assert.deepEqual(items(), ["base"]);
});

test("a marquee that is paused when it is drawn shows its content, held", async () => {
  const { el, items } = await mount({ data: { items: ["held"], paused: true } });
  assert.deepEqual(items(), ["held"]);
  assert.ok(el.querySelector(".mq").classList.contains("is-paused"));
  assert.equal(el.querySelector(".mq-paused").hidden, false);
});

test("an action that is not Pause changes nothing", async () => {
  const { model, el, items } = await mount({ data: ["a"] });
  model.action("other");
  model.emit("msg:custom", { kind: "workspace-event", name: "action" });
  assert.equal(el.querySelector(".mq").classList.contains("is-paused"), false);
  assert.deepEqual(items(), ["a"]);
});

test("a new answer from the endpoint replaces what the stream put there, and refresh drops the live options", async () => {
  const { model, items } = await mount({ data: ["first"] });
  model.stream({ op: "set-content", text: "live", speed: 3 });
  model.change("data", ["second"]);
  assert.deepEqual(items(), ["second"]);
  model.stream({ op: "set-content", text: "live again", speed: 3 });
  model.emit("msg:custom", { kind: "workspace-event", name: "refresh" });
  assert.deepEqual(items(), ["second"]);
  assert.equal(window.document.querySelector(".mq-track").style.animationDuration, "15s");
});

test("the status of the stream shows as a dot", async () => {
  const { model, el } = await mount({ data: "x" });
  const dot = el.querySelector(".mq-dot");
  assert.equal(dot.hidden, true);
  model.status("connecting");
  assert.equal(dot.hidden, false);
  assert.equal(dot.dataset.state, "connecting");
  model.status("retrying", 2);
  assert.equal(dot.getAttribute("title"), "Disconnected, retrying in 2 s");
});

test("the colors of the site and its mode are taken from the theme", async () => {
  const { model, el } = await mount({ data: "x", theme: { mode: "light", tokens: { foreground: "#111111", "alert-success": "#00aa00", "font-family": "Montserrat" } } });
  assert.equal(el.dataset.mode, "light");
  assert.equal(el.style.getPropertyValue("--ws-foreground"), "#111111");
  assert.equal(el.style.getPropertyValue("--ws-font-family"), "Montserrat");
  model.change("theme", { mode: "dark", tokens: {} });
  assert.equal(el.dataset.mode, "dark");
  assert.equal(el.style.getPropertyValue("--ws-foreground"), "");
  assert.equal(el.style.getPropertyValue("--ws-font-family"), "");
});

test("a click writes the clicked text to the parameter the widget declares", async () => {
  const { model, el, invoked } = await mount({ data: { items: [{ ticker: "A", text: "AAPL up" }, { ticker: "B", text: "GOOGL down", clickValue: "GOOGL" }], clickable: true }, params: { value: null, other: "x" } });
  click(el.querySelectorAll('[data-i="0"]')[0]);
  assert.deepEqual(model.values.params, { value: "AAPL up", other: "x" });
  click(el.querySelectorAll('[data-i="1"]')[0]);
  assert.deepEqual(model.values.params, { value: "GOOGL", other: "x" });
  assert.equal(model.saved.length, 2);
  assert.deepEqual(invoked, []);
});

test("the parameter is the one the marquee names, and nothing is written for one that is not declared", async () => {
  const named = await mount({ data: { items: ["AAPL"], clickable: true, clickParam: "symbol" }, params: { symbol: null, value: null } });
  click(named.el.querySelector(".mq-item"));
  assert.deepEqual(named.model.values.params, { symbol: "AAPL", value: null });
  const missing = await mount({ data: { items: ["AAPL"], clickable: true, clickParam: "nothing" }, params: { value: null } });
  click(missing.el.querySelector(".mq-item"));
  assert.deepEqual(missing.model.values.params, { value: null });
  assert.equal(missing.model.saved.length, 0);
  const none = await mount({ data: { items: ["AAPL"], clickable: true }, params: undefined });
  click(none.el.querySelector(".mq-item"));
  assert.equal(none.model.saved.length, 0);
});

test("a click does nothing when the marquee is not clickable", async () => {
  const { model, el } = await mount({ data: ["AAPL"], params: { value: null } });
  click(el.querySelector(".mq-item"));
  assert.equal(model.saved.length, 0);
});

test("a click on an item with a link asks the host to open it, and a link in HTML does too", async () => {
  const { el, invoked } = await mount({ data: { items: [{ text: "Read", url: "https://example.com/read" }, { html: '<a href="https://example.com/in-text">in text</a>' }, { text: "Bad", url: "javascript:alert(1)" }], clickable: true } });
  click(el.querySelectorAll('[data-i="0"]')[0]);
  click(el.querySelectorAll("a")[0]);
  click(el.querySelectorAll('[data-i="2"]')[0]);
  assert.deepEqual(invoked, [
    ["core:ui:open-link", { url: "https://example.com/read" }],
    ["core:ui:open-link", { url: "https://example.com/in-text" }],
  ]);
});

test("when the widget stops, the listeners go and the marquee is removed", async () => {
  const { model, el, controller } = await mount({ data: ["x"] });
  assert.ok(el.querySelector(".mq"));
  controller.abort();
  assert.equal(el.querySelector(".mq"), null);
  for (const handlers of model.handlers.values()) assert.equal(handlers.size, 0);
  assert.ok(observers.every((observer) => !observer.live || observer !== observers.at(-1)));
});

test("a marquee drawn after another starts with nothing the other was sent", async () => {
  const first = await mount({ data: ["a"] });
  first.model.stream({ op: "set-content", text: "live", speed: 3 });
  first.controller.abort();
  const second = await mount({ data: ["b"] });
  assert.deepEqual(second.items(), ["b"]);
  assert.equal(second.el.querySelector(".mq-track").style.animationDuration, "15s");
});

test("a quote is exported and given to the agent by its parts", async () => {
  const { exports } = await mount({ data: { items: [{ ticker: "AAPL", label: "Apple Inc.", value: "185.32", change: "+1.2%", tone: "up", spark: [1, 2] }, { ticker: "B", text: "plain" }] } });
  assert.deepEqual(JSON.parse(await exports.exportData("items")), [
    { ticker: "AAPL", text: "AAPL Apple Inc. 185.32 +1.2%", tone: "up" },
    { ticker: "B", text: "plain", tone: "" },
  ]);
  assert.equal((await exports.copilotContext()).text, "AAPL Apple Inc. 185.32 +1.2% plain");
});

test("a stream updates a quote's price, change and chart in place, and the card shows them", async () => {
  const { model, el } = await mount({ data: { items: [{ ticker: "AAPL", label: "Apple Inc.", value: "185.32", change: "+1.2%", tone: "up", spark: [1, 2] }] } });
  const read = () => [...el.querySelector(".mq-content").querySelectorAll(".mq-info > span")].map((part) => part.textContent);
  assert.deepEqual(read(), ["AAPL", "Apple Inc.", "185.32", "+1.2%"]);
  model.stream({ op: "set-item", ticker: "AAPL", value: "186.25", change: "-0.4%", tone: "down", spark: [3, 2, 1] });
  assert.deepEqual(read(), ["AAPL", "Apple Inc.", "186.25", "-0.4%"]);
  assert.ok(el.querySelector(".mq-item").classList.contains("mq-tone-down"));
  model.stream({ op: "set-item", ticker: "AAPL", text: "Halted" });
  assert.deepEqual([...el.querySelector(".mq-content").querySelectorAll(".mq-item")].map((node) => node.textContent), ["Halted"]);
});

test("a click on a quote with a click value writes that value, and without one its parts", async () => {
  const { model, el } = await mount({ data: { items: [{ ticker: "A", label: "Alpha", value: "1", change: "+1%", clickValue: "ALPHA" }, { ticker: "B", label: "Beta", value: "2", change: "-1%" }], clickable: true }, params: { value: null } });
  click(el.querySelectorAll('[data-i="0"]')[0].querySelector(".mq-price"));
  assert.equal(model.values.params.value, "ALPHA");
  click(el.querySelectorAll('[data-i="1"]')[0].querySelector(".mq-price"));
  assert.equal(model.values.params.value, "B Beta 2 -1%");
});
