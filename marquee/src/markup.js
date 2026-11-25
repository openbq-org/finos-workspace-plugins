import { isSafeLink, toneOf } from "./model.js";
import { parseStyle, styleText } from "./style.js";

export const TAGS = ["a", "abbr", "b", "bdi", "br", "cite", "code", "del", "em", "i", "ins", "kbd", "mark", "q", "s", "small", "span", "strong", "sub", "sup", "time", "u", "wbr"];
export const ATTRIBUTES = ["class", "title", "href", "style", "lang", "dir", "datetime"];

export function makeSanitizer(purify) {
  purify.addHook("afterSanitizeAttributes", (node) => {
    if (!node.hasAttribute) return;
    if (node.hasAttribute("href")) {
      if (isSafeLink(node.getAttribute("href"))) node.setAttribute("rel", "noopener noreferrer");
      else node.removeAttribute("href");
    }
    if (node.hasAttribute("class")) {
      const tone = toneOf(node.getAttribute("class"));
      if (tone) node.setAttribute("class", `mq-tone-${tone}`);
      else node.removeAttribute("class");
    }
    if (node.hasAttribute("style")) {
      const text = styleText(parseStyle(node.getAttribute("style")));
      if (text) node.setAttribute("style", text);
      else node.removeAttribute("style");
    }
  });

  return function sanitize(markup) {
    return purify.sanitize(String(markup), {
      ALLOWED_TAGS: TAGS,
      ALLOWED_ATTR: ATTRIBUTES,
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      RETURN_DOM_FRAGMENT: true,
    });
  };
}

export function plainOf(sanitize, markup) {
  return (sanitize(markup).textContent ?? "").replace(/\s+/g, " ").trim();
}
