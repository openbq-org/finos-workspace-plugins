import { ByteReader } from "./bytes";
import type { GeoImageMime } from "./types";

export interface ImageHeader {
  mime: GeoImageMime;
  width: number;
  height: number;
}

const startsWith = (bytes: Uint8Array, at: number, codes: number[]) =>
  bytes.length >= at + codes.length &&
  codes.every((code, index) => bytes[at + index] === code);

const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));

function png(reader: ByteReader): ImageHeader | null {
  if (!startsWith(reader.bytes, 12, ascii("IHDR")) || reader.length < 24) return null;
  return {
    mime: "image/png",
    width: reader.u32(16, false),
    height: reader.u32(20, false),
  };
}

function jpeg(reader: ByteReader): ImageHeader | null {
  let at = 2;
  while (at + 4 <= reader.length) {
    if (reader.u8(at) !== 0xff) return null;
    const marker = reader.u8(at + 1);
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2;
      continue;
    }
    const size = reader.u16(at + 2, false);
    if (size < 2) return null;
    const frame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (frame) {
      if (at + 9 > reader.length) return null;
      return {
        mime: "image/jpeg",
        height: reader.u16(at + 5, false),
        width: reader.u16(at + 7, false),
      };
    }
    if (marker === 0xda || marker === 0xd9) return null;
    at += 2 + size;
  }
  return null;
}

function webp(reader: ByteReader): ImageHeader | null {
  if (reader.length < 30) return null;
  const bytes = reader.bytes;
  const mime = "image/webp" as const;
  if (startsWith(bytes, 12, ascii("VP8X")))
    return {
      mime,
      width: 1 + (reader.u32(24) & 0xffffff),
      height: 1 + (reader.u32(27) & 0xffffff),
    };
  if (startsWith(bytes, 12, ascii("VP8L"))) {
    if (reader.u8(20) !== 0x2f) return null;
    const bits = reader.u32(21);
    return { mime, width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
  }
  if (startsWith(bytes, 12, ascii("VP8 "))) {
    if (!startsWith(bytes, 23, [0x9d, 0x01, 0x2a])) return null;
    return {
      mime,
      width: reader.u16(26) & 0x3fff,
      height: reader.u16(28) & 0x3fff,
    };
  }
  return null;
}

export function imageHeader(bytes: Uint8Array): ImageHeader | null {
  const reader = new ByteReader(bytes, "The image");
  let header: ImageHeader | null = null;
  try {
    if (startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      header = png(reader);
    else if (startsWith(bytes, 0, [0xff, 0xd8, 0xff])) header = jpeg(reader);
    else if (startsWith(bytes, 0, ascii("RIFF")) && startsWith(bytes, 8, ascii("WEBP")))
      header = webp(reader);
  } catch {
    return null;
  }
  return header && header.width > 0 && header.height > 0 ? header : null;
}
