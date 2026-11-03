export type TextEncoding = "utf-8" | "latin-1" | "windows-1252";

const WINDOWS_1252_HIGH = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f, 0x0090, 0x2018, 0x2019, 0x201c,
  0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d,
  0x017e, 0x0178,
];

const CHUNK = 8192;

function singleByte(bytes: Uint8Array, start: number, end: number, windows: boolean) {
  let text = "";
  const codes: number[] = [];
  for (let at = start; at < end; at++) {
    const byte = bytes[at];
    codes.push(
      windows && byte >= 0x80 && byte <= 0x9f ? WINDOWS_1252_HIGH[byte - 0x80] : byte,
    );
    if (codes.length === CHUNK) {
      text += String.fromCharCode(...codes);
      codes.length = 0;
    }
  }
  return text + String.fromCharCode(...codes);
}

const utf8 = new TextDecoder("utf-8");

export function decodeText(
  bytes: Uint8Array,
  encoding: TextEncoding,
  start = 0,
  end = bytes.length,
): string {
  if (encoding === "utf-8") return utf8.decode(bytes.subarray(start, end));
  return singleByte(bytes, start, end, encoding === "windows-1252");
}

export function encodingNamed(name: string): TextEncoding | null {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  if (key === "utf8" || key === "65001" || key === "cp65001") return "utf-8";
  if (key === "ascii" || key === "usascii" || key === "646") return "latin-1";
  if (/^(?:iso)?88591$|^latin1$|^l1$|^cp819$|^28591$/.test(key)) return "latin-1";
  if (/^(?:cp|windows|win|ansi|ms)?1252$/.test(key)) return "windows-1252";
  return null;
}
