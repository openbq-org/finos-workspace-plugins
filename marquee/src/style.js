export const PROPERTIES = new Set([
  "color",
  "background",
  "background-color",
  "font-size",
  "font-weight",
  "font-style",
  "letter-spacing",
  "line-height",
  "text-transform",
  "text-decoration",
  "opacity",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
  "border-color",
  "border-width",
  "border-style",
  "border-radius",
  "height",
  "min-height",
  "max-height",
]);

const FUNCTIONS = new Set(["rgb", "rgba", "hsl", "hsla", "linear-gradient", "radial-gradient", "calc", "var", "clamp", "min", "max"]);

export const MAX_VALUE = 200;
export const MAX_DECLARATIONS = 12;

const kebab = (name) => name.replace(/(?<=[a-z0-9])[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

export function propertyOf(name) {
  if (typeof name !== "string") return null;
  const property = kebab(name.trim()).toLowerCase();
  return PROPERTIES.has(property) ? property : null;
}

export function safeValue(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > MAX_VALUE || !/^[A-Za-z0-9 #.,%()+\-*/]+$/.test(text)) return null;
  if (text.includes("/*") || text.includes("*/")) return null;
  let depth = 0;
  for (const char of text) {
    if (char === "(") depth += 1;
    else if (char === ")" && --depth < 0) return null;
  }
  if (depth !== 0) return null;
  for (const match of text.matchAll(/([A-Za-z-]+)\s*\(/g)) if (!FUNCTIONS.has(match[1].toLowerCase())) return null;
  for (const match of text.matchAll(/var\s*\(([^)]*)\)/gi)) if (!/^\s*--ws-[a-z0-9-]+\s*$/.test(match[1])) return null;
  return text;
}

export function parseStyle(text) {
  const style = {};
  if (typeof text !== "string") return style;
  for (const part of text.split(";").slice(0, MAX_DECLARATIONS * 3)) {
    const at = part.indexOf(":");
    if (at < 0) continue;
    const property = propertyOf(part.slice(0, at));
    const value = property ? safeValue(part.slice(at + 1)) : null;
    if (value) style[property] = value;
    if (Object.keys(style).length >= MAX_DECLARATIONS) break;
  }
  return style;
}

export function patchStyle(style, changes) {
  const next = { ...style };
  if (changes === null || typeof changes !== "object" || Array.isArray(changes)) return next;
  for (const [name, value] of Object.entries(changes).slice(0, MAX_DECLARATIONS * 2)) {
    const property = propertyOf(name);
    if (!property) continue;
    if (value === null || value === "") {
      delete next[property];
      continue;
    }
    const safe = safeValue(value);
    if (safe && (property in next || Object.keys(next).length < MAX_DECLARATIONS)) next[property] = safe;
  }
  return next;
}

export function styleText(style) {
  return Object.entries(style)
    .map(([property, value]) => `${property}:${value}`)
    .join(";");
}
