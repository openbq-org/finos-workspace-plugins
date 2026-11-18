import type { GeoFileOutcome } from "./files";
import type { FileAsks } from "./mapFileConvention";
import { fail } from "./mapValues";

export interface FileInput {
  points: unknown[];
  shapes: unknown[];
  layers: unknown[];
  notes: string[];
  title?: string;
  categoryLabel?: string;
  asks?: FileAsks;
}

export interface FileRoom {
  layers: number;
  as?: "kml" | "kmz";
}

export type ParsedFiles = Map<
  string,
  { name: string | undefined; base64: boolean; outcome: GeoFileOutcome }
>;

type FileReader = (raw: unknown, room: FileRoom, parsed?: ParsedFiles) => FileInput;

let fileReader: FileReader | null = null;

export function provideFileReader(reader: FileReader) {
  fileReader = reader;
}

export const readMapFile = (
  raw: unknown,
  room: FileRoom,
  parsed?: ParsedFiles,
): FileInput =>
  fileReader
    ? fileReader(raw, room, parsed)
    : fail(
        "a map file is read where a map is made: in the code of a run and in a Map widget. Here the map must already be reduced.",
      );
