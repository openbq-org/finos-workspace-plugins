import { failFile } from "./types";

export class ByteReader {
  private readonly view: DataView;
  readonly length: number;

  constructor(
    readonly bytes: Uint8Array,
    private readonly what: string,
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.length = bytes.byteLength;
  }

  need(at: number, size: number): void {
    if (!(at >= 0 && size >= 0 && at + size <= this.length))
      failFile(
        "malformed",
        `${this.what} is cut short or its header is wrong: it needs ${size.toLocaleString("en-US")} bytes at ${at.toLocaleString("en-US")} and has ${this.length.toLocaleString("en-US")}.`,
      );
  }

  fail(reason: string): never {
    return failFile("malformed", `${this.what} is broken: ${reason}.`);
  }

  u8(at: number): number {
    this.need(at, 1);
    return this.view.getUint8(at);
  }

  u16(at: number, little = true): number {
    this.need(at, 2);
    return this.view.getUint16(at, little);
  }

  u32(at: number, little = true): number {
    this.need(at, 4);
    return this.view.getUint32(at, little);
  }

  i32(at: number, little = true): number {
    this.need(at, 4);
    return this.view.getInt32(at, little);
  }

  f64(at: number, little = true): number {
    this.need(at, 8);
    return this.view.getFloat64(at, little);
  }

  f64Checked(at: number): number {
    return this.view.getFloat64(at, true);
  }

  i32Checked(at: number): number {
    return this.view.getInt32(at, true);
  }
}
