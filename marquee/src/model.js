import { parseStyle, patchStyle } from "./style.js";

export const DIRECTIONS = Object.freeze(["left", "right", "up", "down"]);
export const BEHAVIORS = Object.freeze(["scroll", "alternate", "slide", "static"]);
export const TONES = Object.freeze(["up", "down", "neutral"]);

export const LIMITS = Object.freeze({
  text: 20000,
  items: 200,
  itemText: 2000,
  ticker: 64,
  url: 500,
  itemClick: 500,
  itemLabel: 80,
  itemValue: 40,
  itemChange: 60,
  spark: 120,
  separator: 40,
  description: 200,
  label: 40,
  clickParam: 64,
  speedMin: 1,
  speedMax: 300,
  gapMin: 0,
  gapMax: 500,
  clickValue: 4000,
  link: 2000,
});

export const DEFAULTS = Object.freeze({
  speed: 15,
  direction: "left",
  behavior: "scroll",
  pauseOnHover: true,
  gap: 50,
  clickable: false,
  disabled: false,
  paused: false,
  separator: "",
  description: "",
  label: "",
  style: Object.freeze({}),
  clickParam: "value",
});

export const NOT_A_MARQUEE = "The endpoint did not return text, a list of items or a marquee object.";

const QUOTE_TEXTS = [
  ["label", LIMITS.itemLabel],
  ["value", LIMITS.itemValue],
  ["change", LIMITS.itemChange],
];
const FLAGS = ["pauseOnHover", "clickable", "disabled", "paused"];
const TEXTS = [
  ["separator", LIMITS.separator],
  ["description", LIMITS.description],
  ["label", LIMITS.label],
  ["clickParam", LIMITS.clickParam],
];

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const isMarkup = (text) => text.includes("<") && text.includes(">");

export function isSafeLink(value) {
  const text = String(value ?? "");
  if (!text || text.length > LIMITS.link || /[\u0000-\u001f\u007f\s]/.test(text)) return false;
  try {
    const { protocol } = new URL(text);
    return protocol === "https:" || protocol === "mailto:";
  } catch {
    return false;
  }
}

export function toneOf(classes) {
  const names = Array.isArray(classes) ? classes : typeof classes === "string" ? classes.split(/\s+/) : [];
  return names.find((name) => TONES.includes(name)) ?? null;
}

export function readSpark(raw) {
  if (!Array.isArray(raw)) return null;
  const points = raw.slice(0, LIMITS.spark).filter((point) => typeof point === "number" && Number.isFinite(point));
  return points.length >= 2 ? points : null;
}

const quoteText = (raw, limit) =>
  typeof raw === "string" ? raw.slice(0, limit) : typeof raw === "number" && Number.isFinite(raw) ? String(raw).slice(0, limit) : "";

export const isQuote = (item) => Boolean(item.label || item.value || item.change || item.spark);

export function partsText(item) {
  return [item.ticker, item.label, item.value, item.change].filter(Boolean).join(" ");
}

export function plainText(item) {
  return isQuote(item) ? partsText(item) : (item.text ?? "");
}

export function readItem(raw, max = LIMITS.itemText) {
  if (typeof raw === "string") {
    const text = raw.slice(0, max);
    return isMarkup(text) ? { html: text } : { text };
  }
  if (!isObject(raw)) return null;
  const item = {};
  if (typeof raw.ticker === "string" && raw.ticker) item.ticker = raw.ticker.slice(0, LIMITS.ticker);
  for (const [key, limit] of QUOTE_TEXTS) {
    const text = quoteText(raw[key], limit);
    if (text) item[key] = text;
  }
  const spark = readSpark(raw.spark);
  if (spark) item.spark = spark;
  if (typeof raw.html === "string" && raw.html) item.html = raw.html.slice(0, max);
  else if (typeof raw.text === "string" || !isQuote(item)) item.text = typeof raw.text === "string" ? raw.text.slice(0, max) : "";
  if (TONES.includes(raw.tone)) item.tone = raw.tone;
  const style = isObject(raw.style) ? patchStyle({}, raw.style) : parseStyle(raw.style);
  if (Object.keys(style).length) item.style = style;
  if (typeof raw.url === "string" && isSafeLink(raw.url)) item.url = raw.url.slice(0, LIMITS.url);
  if (typeof raw.clickValue === "string" && raw.clickValue) item.clickValue = raw.clickValue.slice(0, LIMITS.itemClick);
  return item;
}

export function readItems(list) {
  if (!Array.isArray(list)) return [];
  return list
    .slice(0, LIMITS.items)
    .map((raw) => readItem(raw))
    .filter(Boolean);
}

const textItems = (text) => (text ? [readItem(text, LIMITS.text)] : []);

export function readFields(raw) {
  const fields = {};
  if (typeof raw.speed === "number" && Number.isFinite(raw.speed)) fields.speed = clamp(raw.speed, LIMITS.speedMin, LIMITS.speedMax);
  if (typeof raw.gap === "number" && Number.isFinite(raw.gap)) fields.gap = Math.round(clamp(raw.gap, LIMITS.gapMin, LIMITS.gapMax));
  if (DIRECTIONS.includes(raw.direction)) fields.direction = raw.direction;
  if (BEHAVIORS.includes(raw.behavior)) fields.behavior = raw.behavior;
  for (const key of FLAGS) if (typeof raw[key] === "boolean") fields[key] = raw[key];
  for (const [key, max] of TEXTS) if (typeof raw[key] === "string") fields[key] = raw[key].slice(0, max);
  const style = isObject(raw.style) ? patchStyle({}, raw.style) : typeof raw.style === "string" ? parseStyle(raw.style) : null;
  if (style) fields.style = style;
  return fields;
}

export function readDocument(raw) {
  if (typeof raw === "string") return { items: textItems(raw), fields: {} };
  if (Array.isArray(raw)) return { items: readItems(raw), fields: {} };
  if (!isObject(raw)) return null;
  const items =
    Array.isArray(raw.items) && raw.items.length ? readItems(raw.items) : typeof raw.text === "string" ? textItems(raw.text) : [];
  return { items, fields: readFields(raw) };
}

export function readBase(data) {
  const doc = readDocument(data);
  const unreadable = data !== undefined && data !== null && doc === null;
  return { doc, problem: unreadable ? NOT_A_MARQUEE : null };
}

export function createLive() {
  return { items: null, fields: {} };
}

export function resolve(base, live) {
  const fields = { ...base.doc?.fields, ...live.fields };
  const vertical = (fields.direction ?? DEFAULTS.direction) === "up" || fields.direction === "down";
  return {
    ...DEFAULTS,
    gap: vertical ? 0 : DEFAULTS.gap,
    ...fields,
    items: live.items ?? base.doc?.items ?? [],
    problem: live.items ? null : base.problem,
  };
}

const MESSAGES = Object.freeze({
  "set-content": "content",
  "set-item": "item",
  "remove-item": "remove",
});

function setContent(live, body) {
  let changed = false;
  if (Array.isArray(body.items)) {
    live.items = readItems(body.items);
    changed = true;
  } else if (typeof body.html === "string") {
    live.items = body.html ? [{ html: body.html.slice(0, LIMITS.text) }] : [];
    changed = true;
  } else if (typeof body.text === "string") {
    live.items = body.text ? [{ text: body.text.slice(0, LIMITS.text) }] : [];
    changed = true;
  }
  const fields = readFields(body);
  if (Object.keys(fields).length) {
    Object.assign(live.fields, fields);
    changed = true;
  }
  return changed;
}

function patchItem(item, body) {
  const retext = (typeof body.html === "string" && body.html) || typeof body.text === "string";
  if (retext) {
    delete item.label;
    delete item.value;
    delete item.change;
    delete item.spark;
  }
  if (typeof body.html === "string" && body.html) {
    item.html = body.html.slice(0, LIMITS.itemText);
    delete item.text;
  } else if (typeof body.text === "string") {
    item.text = body.text.slice(0, LIMITS.itemText);
    delete item.html;
  }
  for (const [key, limit] of QUOTE_TEXTS) {
    if (!(key in body)) continue;
    const text = quoteText(body[key], limit);
    if (text) {
      item[key] = text;
      delete item.html;
    } else delete item[key];
  }
  if ("spark" in body) {
    const spark = readSpark(body.spark);
    if (spark) item.spark = spark;
    else delete item.spark;
  }
  if (isQuote(item) && item.text === "") delete item.text;
  if (TONES.includes(body.tone)) item.tone = body.tone;
  else if (body.tone === null || body.tone === "") delete item.tone;
  let style = item.style ?? {};
  if (typeof body.style === "string") style = patchStyle(style, parseStyle(body.style));
  else if (isObject(body.style)) style = patchStyle(style, body.style);
  if (Object.keys(style).length) item.style = style;
  else delete item.style;
  if (typeof body.url === "string") {
    if (isSafeLink(body.url)) item.url = body.url.slice(0, LIMITS.url);
    else delete item.url;
  }
  if (typeof body.clickValue === "string") {
    if (body.clickValue) item.clickValue = body.clickValue.slice(0, LIMITS.itemClick);
    else delete item.clickValue;
  }
}

function setItem(live, current, body) {
  if (typeof body.ticker !== "string" || !body.ticker) return false;
  const ticker = body.ticker.slice(0, LIMITS.ticker);
  const items = (live.items ?? current).map((item) => ({ ...item }));
  let item = items.find((candidate) => candidate.ticker === ticker);
  if (!item) {
    if (items.length >= LIMITS.items) return false;
    item = { ticker, text: "" };
    items.push(item);
  }
  patchItem(item, body);
  live.items = items;
  return true;
}

function removeItem(live, current, body) {
  if (typeof body.ticker !== "string") return false;
  const items = live.items ?? current;
  if (!items.some((item) => item.ticker === body.ticker)) return false;
  live.items = items.filter((item) => item.ticker !== body.ticker);
  return true;
}

export function applyMessage(live, current, message) {
  if (!isObject(message)) return false;
  const name = message.op;
  if (typeof name !== "string" || !Object.hasOwn(MESSAGES, name)) return false;
  switch (MESSAGES[name]) {
    case "content":
      return setContent(live, message);
    case "item":
      return setItem(live, current, message);
    default:
      return removeItem(live, current, message);
  }
}

export function itemText(item, plain) {
  return item.html ? plain(item.html) : plainText(item);
}

export function shownText(item) {
  return item.html ? `html:${item.html}` : plainText(item);
}

export function cell(value) {
  const text = String(value ?? "");
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}
