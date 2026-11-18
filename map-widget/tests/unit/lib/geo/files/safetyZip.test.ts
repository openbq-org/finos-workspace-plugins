import { describe, expect, it } from "vitest";
import { GEO_FILE_LIMITS } from "~/lib/geo/files";
import { GeoFileFailure } from "~/lib/geo/files/types";
import { openArchive, safePath } from "~/lib/geo/files/zip";
import {
  dbf,
  deflatedZeros,
  lyingArchive,
  PRJ,
  shp,
  zip,
} from "../../../../fixtures/geo/files/builders";
import { cpuBudget } from "../../../machinePace";
import { fixture, kml, POINT, read, refusal, timed } from "./support";

function declare(archive: Uint8Array, unpacked: number, packed?: number): Uint8Array {
  const out = Uint8Array.from(archive);
  const view = new DataView(out.buffer);
  for (let at = 0; at < out.length - 4; at++) {
    const signature = view.getUint32(at, true);
    if (signature === 0x04034b50) {
      if (packed !== undefined) view.setUint32(at + 18, packed, true);
      view.setUint32(at + 22, unpacked, true);
    }
    if (signature === 0x02014b50) {
      if (packed !== undefined) view.setUint32(at + 20, packed, true);
      view.setUint32(at + 24, unpacked, true);
    }
  }
  return out;
}

describe("safety: a zip archive", () => {
  it("refuses an archive of more entries than a map file has", () => {
    const files: Record<string, string> = { "doc.kml": kml(POINT) };
    for (let at = 0; at < GEO_FILE_LIMITS.zipEntries; at++) files[`f${at}.txt`] = "x";
    const error = refusal(zip(files));
    expect(error.code).toBe("too-large");
    expect(error.message).toMatch(/more than 256 entries/);
  });

  it("refuses an entry that unpacks to many times its size, before it is unpacked", () => {
    const [outcome, took] = timed(fixture("hostile-bomb.kmz"));
    expect(outcome).toEqual({
      ok: false,
      error: {
        code: "refused",
        message:
          "An entry of the archive unpacks to more than 200 times its size, which no map file does. The archive is not read.",
      },
    });
    expect(took).toBeLessThan(cpuBudget(500));
  });

  it("reads a small table of blanks that packs well: it is no bomb", () => {
    const blanks = dbf(
      [{ name: "NOTE", type: "C", length: 250 }],
      Array.from({ length: 2000 }, () => [""]),
    );
    const archive = zip({
      "a.shp": shp([{ kind: "point", at: [1, 2] }]),
      "a.dbf": blanks,
      "a.prj": PRJ.wgs84,
    });
    expect(blanks.length / archive.length).toBeGreaterThan(GEO_FILE_LIMITS.zipRatio);
    expect(read(archive).features).toHaveLength(1);
  });

  it("refuses an entry over the size of one entry by the size it declares, and makes no buffer for it", () => {
    const huge = declare(zip({ "doc.kml": kml(POINT) }, 0), 0xfffffff0, 0xfffffff0);
    const [outcome, took] = timed(huge);
    expect(outcome.ok).toBe(false);
    expect(outcome.error?.code).toBe("too-large");
    expect(took).toBeLessThan(cpuBudget(500));
  });

  it("refuses an archive whose entries are together over the size of an archive", () => {
    const names = ["a.shp", "b.shp", "c.shp"];
    const archive = openArchive(
      declare(
        zip(Object.fromEntries(names.map((name) => [name, "x"])), 0),
        30 * 1024 * 1024,
        30 * 1024 * 1024,
      ),
    );
    expect(() => archive.read(names)).toThrowError(
      expect.objectContaining({
        code: "too-large",
        message: "The archive unpacks to more than 64 MB.",
      }),
    );
  });

  it("unpacks no more than an entry declares, also when the archive lies", () => {
    const lying = declare(zip({ "doc.kml": new Uint8Array(1_500_000).fill(60) }), 1000);
    const archive = openArchive(lying);
    let unpacked = 0;
    try {
      unpacked = archive.read(["doc.kml"]).get("doc.kml")?.length ?? 0;
    } catch (cause) {
      expect(cause).toBeInstanceOf(GeoFileFailure);
    }
    expect(unpacked).toBeLessThanOrEqual(1000);
    expect(refusal(lying)).toEqual({
      code: "refused",
      message:
        "An entry of the archive unpacks to more than the archive declares for it. The archive is not read.",
    });
    const stored = declare(zip({ "doc.kml": kml(POINT.repeat(100)) }, 0), 10);
    expect(refusal(stored).code).toBe("malformed");
  });

  it("stops unpacking an entry that says 1 MB and holds a gigabyte as soon as it is over what it declares", () => {
    const MB = 1024 * 1024;
    const lying = lyingArchive("doc.kml", deflatedZeros(1024), MB);
    const [outcome, took] = timed(lying);
    expect(outcome.error?.code).toBe("refused");
    expect(took).toBeLessThan(cpuBudget(400));
    const archive = openArchive(lying);
    const thrown = () => {
      try {
        archive.read(["doc.kml"]);
      } catch (cause) {
        return cause;
      }
      return undefined;
    };
    const first = thrown();
    expect(first).toMatchObject({ code: "refused" });
    expect(thrown()).toBe(first);
  });

  it("reads an entry that unpacks to exactly what it declares, and refuses one that unpacks to less", () => {
    const body = kml(POINT.repeat(2000));
    const honest = zip({ "doc.kml": body });
    expect(read(honest).features).toHaveLength(2000);
    expect(refusal(declare(honest, body.length + 1)).code).toBe("malformed");
  });

  it("refuses an entry whose bytes are not those the archive has the checksum of", () => {
    const body = kml(POINT.repeat(20));
    for (const level of [0, 9] as const) {
      const honest = zip({ "doc.kml": body }, level);
      expect(read(honest).features).toHaveLength(20);
      const changed = honest.slice();
      const at = level === 0 ? 30 + "doc.kml".length + 40 : -1;
      if (at > 0) changed[at] ^= 0x20;
      const view = new DataView(changed.buffer);
      let row = changed.length - 22;
      while (view.getUint32(row, true) !== 0x02014b50) row--;
      if (at < 0) view.setUint32(row + 16, view.getUint32(row + 16, true) ^ 1, true);
      expect(refusal(changed), `level ${level}`).toEqual({
        code: "malformed",
        message:
          "An entry of the archive does not have the checksum the archive declares for it: the file is damaged.",
      });
    }
  });

  it("says of a stored entry that is not as long as the archive declares that it is not, shorter or longer", () => {
    const body = kml(POINT.repeat(100));
    const stored = zip({ "doc.kml": body }, 0);
    for (const declared of [10, body.length + 10])
      expect(refusal(declare(stored, declared)).message).toBe(
        "An entry of the archive is not as long as the archive declares for it.",
      );
  });

  it("says an entry protected by a password and a table that points past the file in our words", () => {
    const archive = zip({ "doc.kml": kml(POINT) });
    const view = new DataView(archive.buffer);
    const locked = Uint8Array.from(archive);
    for (let at = 0; at < locked.length - 4; at++)
      if (view.getUint32(at, true) === 0x02014b50) locked[at + 8] |= 1;
    expect(refusal(locked)).toEqual({
      code: "malformed",
      message:
        "The file is a zip archive that cannot be read: it is cut short, damaged or protected by a password.",
    });
    const past = Uint8Array.from(archive);
    new DataView(past.buffer).setUint32(past.length - 6, past.length + 10, true);
    expect(refusal(past).code).toBe("malformed");
  });

  it("reads an archive in the Zip64 form, whose table has its numbers in records of their own", () => {
    const archive = zip({ "doc.kml": kml(POINT) });
    const view = new DataView(archive.buffer);
    const tableAt = view.getUint32(archive.length - 6, true);
    const row = archive.subarray(tableAt, archive.length - 22);
    const wide = new Uint8Array(row.length + 20);
    wide.set(row);
    const wideView = new DataView(wide.buffer);
    wideView.setUint16(row.length, 1, true);
    wideView.setUint16(row.length + 2, 16, true);
    wideView.setUint32(row.length + 4, view.getUint32(tableAt + 24, true), true);
    wideView.setUint32(row.length + 12, view.getUint32(tableAt + 20, true), true);
    wideView.setUint32(20, 0xffffffff, true);
    wideView.setUint32(24, 0xffffffff, true);
    wideView.setUint16(30, 20, true);
    const record = new Uint8Array(56);
    const recordView = new DataView(record.buffer);
    recordView.setUint32(0, 0x06064b50, true);
    recordView.setUint32(32, 1, true);
    recordView.setUint32(48, tableAt, true);
    const locator = new Uint8Array(20);
    const locatorView = new DataView(locator.buffer);
    locatorView.setUint32(0, 0x07064b50, true);
    locatorView.setUint32(8, tableAt + wide.length, true);
    const end = Uint8Array.from(archive.subarray(archive.length - 22));
    new DataView(end.buffer).setUint16(10, 0xffff, true);
    new DataView(end.buffer).setUint32(16, 0xffffffff, true);
    const parts = [archive.subarray(0, tableAt), wide, record, locator, end];
    const zip64 = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of parts) {
      zip64.set(part, at);
      at += part.length;
    }
    expect(read(zip64).features).toHaveLength(1);
    const huge = Uint8Array.from(zip64);
    new DataView(huge.buffer).setUint32(tableAt + row.length + 8, 1, true);
    expect(refusal(huge).code).toBe("too-large");
  });

  it("unpacks only the entry whose sizes it checked when two have one name", () => {
    const first = zip({ "doc.kml": kml(POINT) }, 0);
    const bomb = zip({ "doc.kml": new Uint8Array(3_000_000) });
    const view = (bytes: Uint8Array) =>
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const directoryAt = (bytes: Uint8Array) =>
      view(bytes).getUint32(bytes.length - 6, true);
    const directory = (bytes: Uint8Array) =>
      bytes.subarray(directoryAt(bytes), bytes.length - 22);
    const bombDirectory = Uint8Array.from(directory(bomb));
    const body = [
      first.subarray(0, directoryAt(first)),
      bomb.subarray(0, directoryAt(bomb)),
    ];
    view(bombDirectory).setUint32(42, body[0].length, true);
    const directories = [directory(first), bombDirectory];
    const end = Uint8Array.from(first.subarray(first.length - 22));
    view(end).setUint16(8, 2, true);
    view(end).setUint16(10, 2, true);
    view(end).setUint32(12, directories[0].length + directories[1].length, true);
    view(end).setUint32(16, body[0].length + body[1].length, true);
    const both = new Uint8Array(
      [...body, ...directories, end].reduce((sum, part) => sum + part.length, 0),
    );
    let at = 0;
    for (const part of [...body, ...directories, end]) {
      both.set(part, at);
      at += part.length;
    }
    const archive = openArchive(both);
    expect(archive.entries).toHaveLength(1);
    expect(archive.read(["doc.kml"]).get("doc.kml")?.length).toBe(kml(POINT).length);
    expect(read(both).features).toHaveLength(1);
  });

  it("never opens an archive inside an archive", () => {
    const error = refusal(fixture("hostile-nested.zip"));
    expect(error.code).toBe("refused");
    expect(error.message).toMatch(/an archive inside an archive is not opened/);
    const beside = read(
      zip({
        "doc.kml": kml(POINT),
        "more.kmz": zip({ "doc.kml": kml(POINT.repeat(5)) }),
        "old.ZIP": "PK",
      }),
    );
    expect(beside.features).toHaveLength(1);
    expect(beside.notes).toEqual(["2 archives inside the archive were not opened."]);
  });

  it("ignores an entry whose path leaves the archive", () => {
    expect(safePath("a/b.kml")).toBe("a/b.kml");
    expect(safePath("./a//b.kml")).toBe("a/b.kml");
    expect(safePath("a\\b.kml")).toBe("a/b.kml");
    for (const path of [
      "../a.kml",
      "a/../../b.kml",
      "/etc/a.kml",
      "\\a.kml",
      "C:\\a.kml",
      "c:/a.kml",
      "a\0.kml",
      "",
      "./",
      "a/..\\..\\b",
    ])
      expect(safePath(path)).toBeNull();
    const result = read(
      zip({
        "../evil.kml": kml(POINT.repeat(9)),
        "/abs/evil.shp": "x",
        "doc.kml": kml(POINT),
      }),
    );
    expect(result.features).toHaveLength(1);
    expect(result.notes).toEqual([
      "2 entries with a path that leaves the archive were ignored.",
    ]);
    expect(refusal(zip({ "../doc.kml": kml(POINT) })).code).toBe("unknown-format");
  });

  it("reads only the kinds of entry a map file has", () => {
    const archive = openArchive(
      zip({
        "doc.kml": kml(POINT),
        "a.shp": "x",
        "a.dbf": "x",
        "a.prj": "x",
        "a.cpg": "x",
        "a.PNG": "x",
        "a.jpeg": "x",
        "a.webp": "x",
        "a.shx": "x",
        "run.exe": "x",
        "page.html": "x",
        "image.svg": "x",
        noextension: "x",
        ".kml": "x",
        "__MACOSX/._doc.kml": "x",
        "folder/": "",
      }),
    );
    expect(archive.entries.map((entry) => entry.path)).toEqual([
      "doc.kml",
      "a.shp",
      "a.dbf",
      "a.prj",
      "a.cpg",
      "a.PNG",
      "a.jpeg",
      "a.webp",
    ]);
    expect(archive.read(["run.exe", "image.svg", "nothing"]).size).toBe(0);
  });

  it("says what is wrong with an archive that is cut short, empty or has no map file", () => {
    const whole = fixture("sample.kmz");
    expect(refusal(whole.subarray(0, whole.length - 30)).code).toBe("malformed");
    expect(refusal(Uint8Array.of(0x50, 0x4b, 0x03, 0x04)).code).toBe("malformed");
    expect(refusal(zip({ "readme.txt": "hello" })).code).toBe("unknown-format");
    expect(refusal(zip({})).code).toBe("unknown-format");
  });
});
