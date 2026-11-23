import { decodeText, encodingNamed } from "./encodings";
import { GEO_FILE_LIMITS as LIMITS } from "./limits";
import { isCalendarTime } from "./time";
import { failFile } from "./types";

export interface XmlNode {
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export function decodeEntities(
  text: string,
  more: Record<string, string> = {},
): string {
  if (!text.includes("&")) return text;
  return text.replace(
    /&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-z]{2,6});/g,
    (whole, name: string) => {
      if (name[0] !== "#")
        return Object.hasOwn(ENTITIES, name)
          ? ENTITIES[name]
          : Object.hasOwn(more, name)
            ? more[name]
            : whole;
      const code =
        name[1] === "x" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
        ? String.fromCodePoint(code)
        : "";
    },
  );
}

const broken = (what: string) => failFile("malformed", `The file is broken: ${what}.`);

const isSpace = (code: number) =>
  code === 32 || code === 9 || code === 10 || code === 13;

const local = (name: string) =>
  name.slice(name.indexOf(":") + 1).slice(0, LIMITS.xmlNameChars);

function attributesOf(tag: string, from: number): Record<string, string> {
  const attributes: Record<string, string> = {};
  let kept = 0;
  let at = from;
  const end = tag.length;
  while (at < end) {
    while (at < end && (isSpace(tag.charCodeAt(at)) || tag[at] === "/")) at++;
    const start = at;
    while (at < end && !isSpace(tag.charCodeAt(at)) && tag[at] !== "=") at++;
    if (at === start) {
      at++;
      continue;
    }
    const name = tag.slice(start, at);
    while (at < end && isSpace(tag.charCodeAt(at))) at++;
    if (tag[at] !== "=") continue;
    at++;
    while (at < end && isSpace(tag.charCodeAt(at))) at++;
    const quote = tag[at];
    if (quote !== '"' && quote !== "'") continue;
    const close = tag.indexOf(quote, at + 1);
    if (close < 0) break;
    const key = local(name);
    if (
      kept < LIMITS.xmlAttributes &&
      key !== "__proto__" &&
      !Object.hasOwn(attributes, key)
    ) {
      attributes[key] = decodeEntities(
        tag.slice(at + 1, Math.min(close, at + 1 + LIMITS.xmlAttributeChars)),
      );
      kept++;
    }
    at = close + 1;
  }
  return attributes;
}

const MARKUP_ELEMENTS = new Set(["description", "desc"]);

const TAG_CHARS =
  LIMITS.xmlAttributes * (LIMITS.xmlNameChars + LIMITS.xmlAttributeChars + 8);

export function parseXmlDocument(source: string): XmlNode {
  if (source.length > LIMITS.xmlBytes)
    return failFile(
      "too-large",
      `The document is over ${LIMITS.xmlBytes / 1024 / 1024} MB. Simplify it or split it.`,
    );
  const outside: XmlNode = {
    name: "#document",
    attributes: {},
    children: [],
    text: "",
  };
  const stack: XmlNode[] = [outside];
  const refused = () =>
    failFile(
      "refused",
      "The file has a DOCTYPE or another declaration. A file that can declare entities is not read.",
    );
  let nodes = 0;
  let at = 0;
  const addText = (node: XmlNode, more: string) => {
    if (node.text.length + more.length > LIMITS.xmlTextChars)
      failFile(
        "too-large",
        `One element of the document has more than ${LIMITS.xmlTextChars / 1024 / 1024} MB of text.`,
      );
    node.text += more;
  };
  const endTagOf = (node: XmlNode, open: number) => {
    if (source[open + 1] !== "/") return -1;
    const tag = source.slice(open + 2, open + 2 + LIMITS.xmlNameChars * 2 + 8);
    const close = tag.indexOf(">");
    return close >= 0 && local(tag.slice(0, close).trim()) === node.name
      ? open + 3 + close
      : -1;
  };
  const readMarkup = (node: XmlNode, from: number): number => {
    let at = from;
    for (;;) {
      const open = source.indexOf("<", at);
      if (open < 0) return broken(`it ends inside "${node.name}"`);
      if (open > at) addText(node, decodeEntities(source.slice(at, open)));
      if (source.startsWith("<![CDATA[", open)) {
        const end = source.indexOf("]]>", open + 9);
        if (end < 0) return broken("a CDATA section does not end");
        addText(node, source.slice(open + 9, end));
        at = end + 3;
      } else if (source.startsWith("<!--", open)) {
        const end = source.indexOf("-->", open + 4);
        if (end < 0) return broken("a comment does not end");
        at = end + 3;
      } else if (source[open + 1] === "!") return refused();
      else {
        const end = endTagOf(node, open);
        if (end >= 0) return end;
        addText(node, "<");
        at = open + 1;
      }
    }
  };
  while (at < source.length) {
    const open = source.indexOf("<", at);
    const upTo = open < 0 ? source.length : open;
    if (upTo > at && stack.length > 1) {
      const between = source.slice(at, upTo);
      if (between.trim()) addText(stack[stack.length - 1], decodeEntities(between));
    }
    if (open < 0) break;
    if (source.startsWith("<!--", open)) {
      const end = source.indexOf("-->", open + 4);
      if (end < 0) return broken("a comment does not end");
      at = end + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", open)) {
      const end = source.indexOf("]]>", open + 9);
      if (end < 0) return broken("a CDATA section does not end");
      if (stack.length > 1)
        addText(stack[stack.length - 1], source.slice(open + 9, end));
      at = end + 3;
      continue;
    }
    if (source.startsWith("<?", open)) {
      const end = source.indexOf("?>", open + 2);
      if (end < 0) return broken("a processing instruction does not end");
      at = end + 2;
      continue;
    }
    if (source[open + 1] === "!") return refused();
    let close = open + 1;
    let quote = 0;
    const limit = Math.min(source.length, open + 1 + TAG_CHARS);
    for (; close < limit; close++) {
      const code = source.charCodeAt(close);
      if (quote) {
        if (code === quote) quote = 0;
      } else if (code === 34 || code === 39) quote = code;
      else if (code === 62) break;
    }
    if (close >= source.length) return broken("a tag does not end");
    if (close >= limit)
      return failFile("too-large", "The document has a tag that is too long to read.");
    at = close + 1;
    if (source[open + 1] === "/") {
      const name = local(source.slice(open + 2, close).trim());
      const top = stack[stack.length - 1];
      if (stack.length < 2 || top.name !== name)
        return broken(`"${name.slice(0, 40)}" is closed where it is not open`);
      stack.pop();
      continue;
    }
    const tag = source.slice(open + 1, close);
    let nameEnd = 0;
    while (
      nameEnd < tag.length &&
      !isSpace(tag.charCodeAt(nameEnd)) &&
      tag[nameEnd] !== "/"
    )
      nameEnd++;
    if (nameEnd === 0) return broken("a tag has no name");
    if (++nodes > LIMITS.xmlNodes)
      return failFile(
        "too-large",
        `The document has more than ${LIMITS.xmlNodes.toLocaleString("en-US")} elements. Simplify it or split it.`,
      );
    const node: XmlNode = {
      name: local(tag.slice(0, nameEnd)),
      attributes: attributesOf(tag, nameEnd),
      children: [],
      text: "",
    };
    stack[stack.length - 1].children.push(node);
    if (!tag.endsWith("/")) {
      if (stack.length > LIMITS.xmlDepth)
        return failFile(
          "too-large",
          `The document is nested more than ${LIMITS.xmlDepth} levels deep.`,
        );
      if (MARKUP_ELEMENTS.has(node.name)) at = readMarkup(node, at);
      else stack.push(node);
    }
  }
  if (stack.length > 1)
    return broken(`it ends inside "${stack[stack.length - 1].name.slice(0, 40)}"`);
  const [root] = outside.children;
  if (!root) return broken("it has no element");
  return root;
}

export function xmlText(bytes: Uint8Array): string {
  if (bytes.length > LIMITS.xmlBytes)
    return failFile(
      "too-large",
      `The document is over ${LIMITS.xmlBytes / 1024 / 1024} MB. Simplify it or split it.`,
    );
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  const head = decodeText(bytes, "latin-1", start, Math.min(bytes.length, start + 200));
  const declared =
    /^\s*<\?xml[^>]*\sencoding\s*=\s*["']([A-Za-z0-9._-]{1,40})["']/.exec(head);
  const named = declared ? encodingNamed(declared[1]) : null;
  return decodeText(bytes, named ?? "utf-8", start);
}

export const childOf = (node: XmlNode | undefined, name: string) =>
  node?.children.find((item) => item.name === name);

export const childrenOf = (node: XmlNode | undefined, name: string) =>
  node?.children.filter((item) => item.name === name) ?? [];

export const textOf = (node: XmlNode | undefined) => node?.text.trim() ?? "";

const HTML_ENTITIES: Record<string, string> = { nbsp: " " };

const INLINE_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "code",
  "em",
  "font",
  "i",
  "s",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "u",
]);

export function plainText(html: string, max = LIMITS.descriptionChars): string {
  const source = html.length > max * 8 + 1024 ? html.slice(0, max * 8 + 1024) : html;
  const lower = source.toLowerCase();
  let shown = "";
  let at = 0;
  while (at < source.length) {
    const open = source.indexOf("<", at);
    if (open < 0) {
      shown += source.slice(at);
      break;
    }
    shown += source.slice(at, open);
    const name = /^<[/!?]?([a-z][a-z0-9]*)?/.exec(lower.slice(open, open + 16));
    if (!name || (name[0] === "<" && !name[1])) {
      shown += "<";
      at = open + 1;
      continue;
    }
    const close = source.indexOf(">", open);
    if (close < 0) break;
    if (!INLINE_TAGS.has(name[1] ?? "")) shown += " ";
    at = close + 1;
    if ((name[1] === "script" || name[1] === "style") && lower[open + 1] !== "/") {
      const end = lower.indexOf(`</${name[1]}`, at);
      if (end < 0) break;
      at = end;
    }
  }
  return decodeEntities(shown, HTML_ENTITIES).replace(/\s+/g, " ").trim();
}

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d{1,3})?$/;

export const numberOf = (text: string): number =>
  NUMBER.test(text) ? Number(text) : Number.NaN;

export function untyped(text: string): string | number {
  if (
    text.length > 0 &&
    text.length <= 17 &&
    /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)
  ) {
    const digits = text.replace(/[-.]/g, "").length;
    if (digits <= 15) return Number(text);
  }
  return text;
}

const ISO_TIME =
  /^\d{4}(?:-\d{2}(?:-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?)?)?)?$/;

export const isoTime = (text: string): string | undefined =>
  ISO_TIME.test(text) && isCalendarTime(text) ? text : undefined;

export const isRemote = (reference: string) =>
  /^\s*(?:[a-z][a-z0-9+.-]+:|\/\/)/i.test(reference);

const REFERENCE_ELEMENTS = new Set(["href", "styleUrl", "targetHref", "sourceHref"]);
const REFERENCE_ATTRIBUTES = ["href", "schemaUrl", "src"];

export function remoteReferences(root: XmlNode): number {
  let count = 0;
  const stack: XmlNode[] = [root];
  for (let node = stack.pop(); node; node = stack.pop()) {
    if (REFERENCE_ELEMENTS.has(node.name) && isRemote(node.text)) count++;
    for (const name of REFERENCE_ATTRIBUTES) {
      const value = node.attributes[name];
      if (value !== undefined && isRemote(value)) count++;
    }
    for (const item of node.children) stack.push(item);
  }
  return count;
}
