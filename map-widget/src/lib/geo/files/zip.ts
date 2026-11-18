import { Inflate } from "fflate";
import { GEO_FILE_LIMITS as LIMITS } from "./limits";
import { failFile, GeoFileFailure } from "./types";

const READ = new Set(["kml", "shp", "dbf", "prj", "cpg", "png", "jpg", "jpeg", "webp"]);
const NESTED = new Set([
  "zip",
  "kmz",
  "gz",
  "tgz",
  "tar",
  "7z",
  "rar",
  "bz2",
  "xz",
  "jar",
]);

export interface ArchiveEntry {
  name: string;
  path: string;
  extension: string;
  size: number;
  packed: number;
}

export interface Archive {
  entries: ArchiveEntry[];
  listed: number;
  nested: number;
  outside: number;
  read(names: string[]): Map<string, Uint8Array>;
}

export function safePath(name: string): string | null {
  if (name.includes("\0")) return null;
  const path = name.replace(/\\/g, "/");
  if (path.startsWith("/") || /^[a-zA-Z]:/.test(path)) return null;
  const parts = path.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.length === 0 || parts.includes("..")) return null;
  return parts.join("/");
}

const extensionOf = (path: string) => {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
};

const MB = 1024 * 1024;

const BROKEN =
  "The file is a zip archive that cannot be read: it is cut short, damaged or protected by a password.";
const broken = () => failFile("malformed", BROKEN);

const LIED =
  "An entry of the archive unpacks to more than the archive declares for it. The archive is not read.";

const INFLATE_SLICE = 4096;

interface TableRow {
  name: string;
  flags: number;
  method: number;
  packed: number;
  size: number;
  crc: number;
  at: number;
}

const SIGNATURES = {
  end: 0x06054b50,
  end64: 0x06064b50,
  locator64: 0x07064b50,
  row: 0x02014b50,
  entry: 0x04034b50,
} as const;

function u64(view: DataView, at: number): number {
  if (at + 8 > view.byteLength || view.getUint32(at + 4, true) !== 0) return broken();
  return view.getUint32(at, true);
}

function readTable(bytes: Uint8Array): TableRow[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  const lowest = Math.max(0, end - 0xffff);
  while (end >= lowest && view.getUint32(end, true) !== SIGNATURES.end) end--;
  if (end < lowest) return broken();
  let rows = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  if (rows === 0xffff || at === 0xffffffff) {
    const locator = end - 20;
    if (locator < 0 || view.getUint32(locator, true) !== SIGNATURES.locator64)
      return broken();
    const record = u64(view, locator + 8);
    if (record + 56 > bytes.length || view.getUint32(record, true) !== SIGNATURES.end64)
      return broken();
    rows = u64(view, record + 32);
    at = u64(view, record + 48);
  }
  if (rows > LIMITS.zipEntries)
    return failFile(
      "too-large",
      `The archive has more than ${LIMITS.zipEntries} entries. A map file has a few.`,
    );
  const table: TableRow[] = [];
  const latin1 = new TextDecoder("latin1");
  const utf8 = new TextDecoder("utf-8");
  for (let row = 0; row < rows; row++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== SIGNATURES.row)
      return broken();
    const flags = view.getUint16(at + 8, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const next = at + 46 + nameLength + extraLength + view.getUint16(at + 32, true);
    if (next > bytes.length) return broken();
    const entry: TableRow = {
      name: (flags & 0x800 ? utf8 : latin1).decode(
        bytes.subarray(at + 46, at + 46 + nameLength),
      ),
      flags,
      method: view.getUint16(at + 10, true),
      crc: view.getUint32(at + 16, true),
      packed: view.getUint32(at + 20, true),
      size: view.getUint32(at + 24, true),
      at: view.getUint32(at + 42, true),
    };
    if (
      entry.size === 0xffffffff ||
      entry.packed === 0xffffffff ||
      entry.at === 0xffffffff
    ) {
      let field = at + 46 + nameLength;
      const fieldsEnd = field + extraLength;
      while (field + 4 <= fieldsEnd && view.getUint16(field, true) !== 1)
        field += 4 + view.getUint16(field + 2, true);
      if (field + 4 > fieldsEnd) return broken();
      let value = field + 4;
      for (const key of ["size", "packed", "at"] as const)
        if (entry[key] === 0xffffffff) {
          if (value + 8 > fieldsEnd) return broken();
          entry[key] =
            view.getUint32(value + 4, true) === 0
              ? view.getUint32(value, true)
              : Number.MAX_SAFE_INTEGER;
          value += 8;
        }
    }
    table.push(entry);
    at = next;
  }
  return table;
}

function packedBytes(bytes: Uint8Array, row: TableRow): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (row.at + 30 > bytes.length || view.getUint32(row.at, true) !== SIGNATURES.entry)
    return broken();
  const from =
    row.at + 30 + view.getUint16(row.at + 26, true) + view.getUint16(row.at + 28, true);
  if (from + row.packed > bytes.length) return broken();
  return bytes.subarray(from, from + row.packed);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let byte = 0; byte < 256; byte++) {
    let value = byte;
    for (let bit = 0; bit < 8; bit++)
      value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    table[byte] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let at = 0; at < bytes.length; at++)
    crc = CRC_TABLE[(crc ^ bytes[at]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function checked(data: Uint8Array, row: TableRow): Uint8Array {
  return crc32(data) === row.crc
    ? data
    : failFile(
        "malformed",
        "An entry of the archive does not have the checksum the archive declares for it: the file is damaged.",
      );
}

function unpack(bytes: Uint8Array, row: TableRow): Uint8Array {
  if (row.flags & 1 || (row.method !== 0 && row.method !== 8)) return broken();
  const packed = packedBytes(bytes, row);
  if (row.method === 0) {
    if (packed.length !== row.size)
      return failFile(
        "malformed",
        "An entry of the archive is not as long as the archive declares for it.",
      );
    return checked(packed.slice(), row);
  }
  const out = new Uint8Array(row.size);
  let filled = 0;
  const stream = new Inflate((chunk) => {
    if (filled + chunk.length > out.length) failFile("refused", LIED);
    out.set(chunk, filled);
    filled += chunk.length;
  });
  try {
    for (let from = 0; from < packed.length; from += INFLATE_SLICE)
      stream.push(
        packed.subarray(from, from + INFLATE_SLICE),
        from + INFLATE_SLICE >= packed.length,
      );
  } catch (cause) {
    if (cause instanceof GeoFileFailure) throw cause;
    return broken();
  }
  if (filled !== out.length) return broken();
  return checked(out, row);
}

export function openArchive(bytes: Uint8Array): Archive {
  const entries: ArchiveEntry[] = [];
  const declared = new Map<string, TableRow>();
  let nested = 0;
  let outside = 0;
  const table = readTable(bytes);
  for (const row of table) {
    if (row.name.endsWith("/") || row.name.endsWith("\\")) continue;
    const path = safePath(row.name);
    if (!path) {
      outside++;
      continue;
    }
    if (path.startsWith("__MACOSX/") || /(^|\/)\._/.test(path)) continue;
    const extension = extensionOf(path);
    if (NESTED.has(extension)) nested++;
    if (!READ.has(extension) || declared.has(row.name)) continue;
    declared.set(row.name, row);
    entries.push({
      name: row.name,
      path,
      extension,
      size: row.size,
      packed: row.packed,
    });
  }
  let total = 0;
  const unpackedBefore = new Map<string, Uint8Array>();
  let refused: GeoFileFailure | null = null;
  return {
    entries,
    listed: table.length,
    nested,
    outside,
    read(names) {
      if (refused) throw refused;
      const found = new Map<string, Uint8Array>();
      const wanted = new Set<string>();
      for (const name of names) {
        const entry = declared.get(name);
        const before = unpackedBefore.get(name);
        if (before) found.set(name, before);
        if (!entry || before || wanted.has(name)) continue;
        if (!(entry.size >= 0 && entry.size <= LIMITS.zipEntryBytes))
          failFile(
            "too-large",
            `An entry of the archive unpacks to more than ${LIMITS.zipEntryBytes / MB} MB.`,
          );
        if (
          entry.size > LIMITS.zipRatioFloorBytes &&
          entry.size > Math.max(entry.packed, 1) * LIMITS.zipRatio
        )
          failFile(
            "refused",
            `An entry of the archive unpacks to more than ${LIMITS.zipRatio} times its size, which no map file does. The archive is not read.`,
          );
        total += entry.size;
        if (total > LIMITS.zipTotalBytes)
          failFile(
            "too-large",
            `The archive unpacks to more than ${LIMITS.zipTotalBytes / MB} MB.`,
          );
        wanted.add(name);
      }
      for (const name of wanted) {
        const row = declared.get(name);
        if (!row) continue;
        try {
          const data = unpack(bytes, row);
          unpackedBefore.set(name, data);
          found.set(name, data);
        } catch (cause) {
          if (cause instanceof GeoFileFailure && cause.code === "refused")
            refused = cause;
          throw cause;
        }
      }
      return found;
    },
  };
}

export const isZip = (bytes: Uint8Array) =>
  bytes.length >= 4 &&
  bytes[0] === 0x50 &&
  bytes[1] === 0x4b &&
  ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
    (bytes[2] === 0x05 && bytes[3] === 0x06));
