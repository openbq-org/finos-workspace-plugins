import { ByteReader } from "./bytes";
import { decodeText, type TextEncoding } from "./encodings";

interface DbfField {
  name: string;
  type: string;
  offset: number;
  length: number;
}

export interface DbfTable {
  fields: DbfField[];
  records: number;
  languageDriver: number;
  row(index: number, encoding: TextEncoding): [string, unknown][] | null;
  readonly beyondAscii: boolean;
}

const TRUE = new Set(["Y", "y", "T", "t"]);
const FALSE = new Set(["N", "n", "F", "f"]);

export function readDbf(bytes: Uint8Array, what: string): DbfTable {
  const reader = new ByteReader(bytes, what);
  reader.need(0, 32);
  const records = reader.u32(4);
  const headerLength = reader.u16(8);
  const recordLength = reader.u16(10);
  if (headerLength < 33) reader.fail("its header is shorter than a header");
  reader.need(0, headerLength);
  if (recordLength < 1) reader.fail("its rows have no length");
  const fields: DbfField[] = [];
  let offset = 1;
  for (let at = 32; at + 32 <= headerLength && reader.u8(at) !== 0x0d; at += 32) {
    if (fields.length >= 255) reader.fail("it has more than 255 columns");
    let end = at;
    while (end < at + 11 && bytes[end] !== 0) end++;
    const length = reader.u8(at + 16);
    fields.push({
      name: decodeText(bytes, "latin-1", at, end).trim(),
      type: String.fromCharCode(reader.u8(at + 11)).toUpperCase(),
      offset,
      length,
    });
    offset += length;
  }
  if (offset > recordLength) reader.fail("its columns are longer than its rows");
  const available = Math.floor((reader.length - headerLength) / recordLength);
  if (records > available)
    reader.fail(
      `its header says ${records.toLocaleString("en-US")} rows and it has the bytes of ${available.toLocaleString("en-US")}`,
    );
  let beyondAscii = false;
  return {
    fields,
    records,
    languageDriver: reader.u8(29),
    get beyondAscii() {
      return beyondAscii;
    },
    row(index, encoding) {
      if (!(index >= 0 && index < records)) return null;
      const start = headerLength + index * recordLength;
      if (bytes[start] === 0x2a) return null;
      const values: [string, unknown][] = [];
      for (const field of fields) {
        if (!field.name) continue;
        const from = start + field.offset;
        const to = from + field.length;
        if (field.type === "C") {
          if (!beyondAscii)
            for (let at = from; at < to; at++)
              if (bytes[at] >= 0x80) {
                beyondAscii = true;
                break;
              }
          const text = decodeText(bytes, encoding, from, to)
            .replaceAll("\0", " ")
            .trim();
          values.push([field.name, text === "" ? null : text]);
          continue;
        }
        const text = decodeText(bytes, "latin-1", from, to).trim();
        if (field.type === "N" || field.type === "F") {
          const number = text === "" ? Number.NaN : Number(text);
          values.push([field.name, Number.isFinite(number) ? number : null]);
        } else if (field.type === "L")
          values.push([
            field.name,
            TRUE.has(text) ? true : FALSE.has(text) ? false : null,
          ]);
        else if (field.type === "D") {
          const date = /^(\d{4})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.exec(text);
          values.push([field.name, date ? `${date[1]}-${date[2]}-${date[3]}` : null]);
        }
      }
      return values;
    },
  };
}
