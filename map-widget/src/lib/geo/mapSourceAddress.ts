import { MAP_LIMITS } from "~/lib/codemode/limits";

const PRINTABLE = /^[\x21-\x7e]+$/;
const TILE_PLACEHOLDER = /\{[zxy]\}/g;
const TILE_PLACEHOLDERS = ["{z}", "{x}", "{y}"] as const;

const ABSOLUTE = /^https?:\/\/([^/?#]*)(.*)$/;
const HOST = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?$/;

const ENCODED_IN_PATH = /%(?:2e|2f|5c|25|7b|7d)/i;

const ENCODED_CONTROL = /%(?:[01][0-9a-f]|7f)/i;

export const tileSample = (address: string): string =>
  address.replace(TILE_PLACEHOLDER, "0");

function restProblem(rest: string, tiles: boolean): string | null {
  if (rest.includes("#")) return "it has a fragment (#)";
  if (rest.includes("\\")) return "it has a backslash";
  if (rest.includes("@")) return 'it has an "@"';
  if (/%(?![0-9a-f]{2})/i.test(rest))
    return "it has a percent sign that encodes nothing";
  if (ENCODED_CONTROL.test(rest)) return "it has an encoded control character";
  const path = rest.split("?")[0];
  if (path.includes(":")) return "its path has a colon";
  if (path.includes("//")) return "its path has an empty segment (//)";
  if (ENCODED_IN_PATH.test(path))
    return "its path has an encoded dot, slash, backslash, percent sign or brace";
  if (path.split("/").some((segment) => segment === "." || segment === ".."))
    return "its path has a dot segment";
  const fixed = tiles ? rest.replace(TILE_PLACEHOLDER, "") : rest;
  if (fixed.includes("{") || fixed.includes("}"))
    return tiles
      ? "it has a placeholder other than {z}, {x} and {y}"
      : "it has a placeholder, which only tiles have";
  if (tiles && !TILE_PLACEHOLDERS.every((placeholder) => rest.includes(placeholder)))
    return "the address of tiles must have {z}, {x} and {y}";
  return null;
}

function textProblem(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return "it is not text";
  if (value.length > MAP_LIMITS.sourceUrlChars)
    return `it is longer than ${MAP_LIMITS.sourceUrlChars} characters`;
  if (!PRINTABLE.test(value))
    return "it has a space, a control character or a character outside ASCII (write it percent-encoded)";
  return null;
}

export function endpointProblem(endpoint: unknown, tiles: boolean): string | null {
  const unread = textProblem(endpoint);
  if (unread) return unread;
  const written = endpoint as string;
  if (!written.split("?")[0].replace(/^\//, "")) return "it has no path";
  return restProblem(written, tiles);
}

export function urlProblem(url: unknown, tiles: boolean): string | null {
  const unread = textProblem(url);
  if (unread) return unread;
  const parts = ABSOLUTE.exec(url as string);
  if (!parts) return "it does not start with http:// or https://";
  const [, host, rest] = parts;
  if (!HOST.test(host))
    return "its host must be plain lower-case text with an optional port: no credentials, no placeholder, no trailing dot";
  if (!rest.startsWith("/") || rest.split("?")[0] === "/") return "it has no path";
  return restProblem(rest, tiles);
}
