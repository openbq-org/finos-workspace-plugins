export const MAX_LINK = 2000;

const FORBIDDEN_TAGS = [
  "script",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "foreignObject",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "link",
  "meta",
  "base",
  "audio",
  "video",
  "source",
  "track",
  "img",
  "image",
  "picture",
  "animate",
  "animateMotion",
  "animateTransform",
  "set",
  "feImage",
  "mpath",
  "handler",
  "listener",
];

const FORBIDDEN_ATTRIBUTES = ["srcdoc", "formaction", "ping", "action", "background", "poster", "srcset", "src", "data"];

export function isSafeLink(value) {
  const text = String(value ?? "");
  if (!text || text.length > MAX_LINK || /[\u0000-\u001f\u007f\s]/.test(text)) return false;
  if (text.startsWith("#")) return true;
  try {
    const { protocol } = new URL(text);
    return protocol === "https:" || protocol === "mailto:";
  } catch {
    return false;
  }
}

export function cleanCss(text) {
  return String(text)
    .replace(/@import[^;{}]*;?/gi, "")
    .replace(/url\(\s*(["']?)(?!#)[^)]*\1\s*\)/gi, "none")
    .replace(/expression\s*\(/gi, "(")
    .replace(/(?:behavior|-moz-binding)\s*:/gi, "x:");
}

export function makeSanitizer(purify) {
  purify.addHook("afterSanitizeAttributes", (node) => {
    if (!node.hasAttribute) return;
    for (const name of ["href", "xlink:href"]) {
      if (!node.hasAttribute(name)) continue;
      const value = node.getAttribute(name);
      if (!isSafeLink(value)) node.removeAttribute(name);
    }
    if (node.hasAttribute("style")) node.setAttribute("style", cleanCss(node.getAttribute("style")));
  });

  return function sanitize(markup) {
    const body = purify.sanitize(String(markup), {
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: FORBIDDEN_TAGS,
      FORBID_ATTR: FORBIDDEN_ATTRIBUTES,
      RETURN_DOM: true,
    });
    for (const style of body.querySelectorAll("style")) style.textContent = cleanCss(style.textContent);
    const root = body.firstElementChild;
    if (!root || root.localName !== "svg" || body.childElementCount !== 1) throw new Error("the diagram did not come out as one SVG");
    return root;
  };
}
