import { MAP_LIMITS } from "~/lib/codemode/limits";
import { bytesOf } from "./base64";
import { imageHeader } from "./files/images";
import { GEO_FILE_LIMITS } from "./files/limits";
import { count, fail, finite, isPlain } from "./mapValues";
import { type MarkBudget, weighImage } from "./markBudget";

export interface MapImage {
  mime: "image/png" | "image/jpeg" | "image/webp";
  data: string;
  corners: [[number, number], [number, number], [number, number], [number, number]];
}

const IMAGE_MIMES: readonly MapImage["mime"][] = [
  "image/png",
  "image/jpeg",
  "image/webp",
];
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function imagePixels(raw: unknown): number {
  const data = isPlain(raw) && typeof raw.data === "string" ? raw.data : "";
  if (!data || data.length > MAP_LIMITS.imageChars || !BASE64.test(data)) return 0;
  const bytes = bytesOf(data);
  const header = bytes && imageHeader(bytes);
  return header ? header.width * header.height : 0;
}

export function image(raw: unknown, what: string, budget: MarkBudget): MapImage {
  const form = `${what} is of the kind "image" and needs { image: { mime, data, corners } }: the bytes of a PNG, JPEG or WebP image as base64, and four corners as [longitude, latitude]. output.map({ file }) makes one from the ground overlay of a KMZ file. A map never takes the address of an image.`;
  if (!isPlain(raw)) return fail(form);
  const { mime, data, corners } = raw;
  if (
    !IMAGE_MIMES.includes(mime as MapImage["mime"]) ||
    typeof data !== "string" ||
    data.length % 4 !== 0
  )
    return fail(form);
  if (data.length > MAP_LIMITS.imageChars)
    return fail(
      `${what} holds an image of ${Math.round(data.length / 1024)} KB as base64. An image of a map has at most ${Math.round(MAP_LIMITS.imageChars / 1024)} KB.`,
    );
  const bytes = BASE64.test(data) ? bytesOf(data) : null;
  const header = bytes && imageHeader(bytes);
  if (!header || header.mime !== mime) return fail(form);
  const { overlaySide, overlayPixels } = GEO_FILE_LIMITS;
  if (
    header.width > overlaySide ||
    header.height > overlaySide ||
    header.width * header.height > overlayPixels
  )
    return fail(
      `${what} holds an image of ${count(header.width)} by ${count(header.height)} pixels. An image of a map has at most ${count(overlaySide)} pixels on a side and ${count(overlayPixels)} pixels: export it smaller.`,
    );
  if (--budget.images < 0)
    return fail(`the map has more than ${MAP_LIMITS.images} images.`);
  budget.pixels -= header.width * header.height;
  if (budget.pixels < 0)
    return fail(
      `the images of the map declare ${count(MAP_LIMITS.imagePixels - budget.pixels)} pixels together. The images of a map have at most ${count(MAP_LIMITS.imagePixels)} pixels together (two of 4,096 by 4,096): export them smaller, or use fewer.`,
    );
  weighImage(budget, data);
  if (
    !Array.isArray(corners) ||
    corners.length !== 4 ||
    !corners.every(
      (corner) =>
        Array.isArray(corner) &&
        finite(corner[0]) &&
        finite(corner[1]) &&
        Math.abs(corner[0]) <= 180 &&
        Math.abs(corner[1]) <= 90,
    )
  )
    return fail(form);
  return {
    mime: mime as MapImage["mime"],
    data,
    corners: corners.map(([lon, lat]) => [lon, lat]) as MapImage["corners"],
  };
}
