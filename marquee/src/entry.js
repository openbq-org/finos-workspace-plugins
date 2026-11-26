import DOMPurify from "dompurify";
import { makeSanitizer, plainOf } from "./markup.js";
import { LIMITS, applyMessage, cell, createLive, isSafeLink, itemText, readBase, resolve } from "./model.js";
import { createView } from "./view.js";

const TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "border",
  "accent",
  "brand-main",
  "brand-lighter",
  "brand-darker",
  "alert-error",
  "alert-success",
  "alert-warning",
  "alert-informative",
];
const CONTEXT_ITEMS = 100;

let sanitizer;
const sanitize = (markup) => (sanitizer ??= makeSanitizer(DOMPurify))(markup);
const plain = (markup) => plainOf(sanitize, markup);

const live = createLive();
let stream = null;
let shown = null;

const modeOf = (theme) => (theme?.mode === "light" ? "light" : "dark");

function current(model) {
  return shown ?? resolve(readBase(model.get("data")), live);
}

function rowsOf(model) {
  return current(model).items.map((item) => ({ ticker: item.ticker ?? "", text: itemText(item, plain), tone: item.tone ?? "" }));
}

function csv(rows) {
  return `${["ticker", "text", "tone"].join(",")}\n${rows.map((row) => [row.ticker, row.text, row.tone].map(cell).join(",")).join("\n")}\n`;
}

export default {
  initialize({ model }) {
    return {
      async exportOptions() {
        if (!rowsOf(model).length) return [];
        return [
          { id: "items", label: "Items (JSON)", extension: "json", mime: "application/json" },
          { id: "csv", label: "Items (CSV)", extension: "csv", mime: "text/csv" },
          { id: "text", label: "Text (TXT)", extension: "txt", mime: "text/plain" },
        ];
      },
      async exportData(id) {
        const rows = rowsOf(model);
        if (!rows.length) return null;
        if (id === "items") return JSON.stringify(rows, null, 2);
        if (id === "csv") return csv(rows);
        return id === "text" ? rows.map((row) => row.text).join("\n") : null;
      },
      async copilotContext() {
        const state = current(model);
        if (state.problem) return { error: state.problem };
        const rows = rowsOf(model);
        return {
          text: rows.map((row) => row.text).join(" "),
          items: rows.slice(0, CONTEXT_ITEMS),
          count: rows.length,
          behavior: state.behavior,
          direction: state.direction,
          speed: state.speed,
          gap: state.gap,
          paused: state.paused,
          clickable: state.clickable,
          disabled: state.disabled,
          ...(stream ? { stream } : {}),
        };
      },
    };
  },

  async render({ model, el, signal, experimental }) {
    live.items = null;
    live.fields = {};
    stream = null;
    shown = null;
    el.classList.add("mq-host");

    const open = (url) => {
      if (isSafeLink(url)) experimental.invoke("core:ui:open-link", { url }).catch(() => {});
    };

    const read = () => readBase(model.get("data"));
    let base = read();
    let state = resolve(base, live);
    const view = createView(el, {
      sanitize,
      onOpen: open,
      onSelect({ item, text }) {
        const value = (item?.clickValue ?? text).slice(0, LIMITS.clickValue);
        const params = model.get("params");
        const name = state.clickParam;
        if (name && params && typeof params === "object" && Object.hasOwn(params, name)) {
          model.set("params", { ...params, [name]: value });
          model.save_changes();
        }
        if (item?.url) open(item.url);
      },
    });

    const applyTheme = () => {
      const theme = model.get("theme");
      const tokens = theme?.tokens ?? {};
      el.dataset.mode = modeOf(theme);
      for (const token of TOKENS) {
        if (tokens[token]) el.style.setProperty(`--ws-${token}`, tokens[token]);
        else el.style.removeProperty(`--ws-${token}`);
      }
      if (tokens["font-family"]) el.style.setProperty("--ws-font-family", tokens["font-family"]);
      else el.style.removeProperty("--ws-font-family");
    };

    let wasPaused = false;
    const paint = () => {
      state = resolve(base, live);
      shown = state.paused && wasPaused && shown ? { ...shown, paused: true } : state;
      wasPaused = state.paused;
      view.update(shown);
    };

    const onData = () => {
      base = read();
      live.items = null;
      paint();
    };
    const onTheme = () => applyTheme();
    const onEvent = (event) => {
      if (event?.kind !== "workspace-event") return;
      if (event.name === "stream-status") {
        stream = event.state ?? null;
        view.setStream(event);
      } else if (event.name === "stream" && Array.isArray(event.messages)) {
        let changed = false;
        for (const message of event.messages) {
          if (applyMessage(live, state.items, message)) changed = true;
        }
        if (changed) paint();
      } else if (event.name === "refresh") {
        live.items = null;
        live.fields = {};
        paint();
      } else if (event.name === "action" && event.id === "pause") {
        live.fields.paused = !state.paused;
        paint();
      }
    };

    applyTheme();
    paint();
    model.on("change:data", onData);
    model.on("change:theme", onTheme);
    model.on("msg:custom", onEvent);

    const resize = new ResizeObserver(() => view.resize());
    resize.observe(el);

    signal.addEventListener("abort", () => {
      resize.disconnect();
      model.off("change:data", onData);
      model.off("change:theme", onTheme);
      model.off("msg:custom", onEvent);
      view.destroy();
      live.items = null;
      live.fields = {};
      stream = null;
      shown = null;
    });
  },
};
