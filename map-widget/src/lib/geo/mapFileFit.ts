import { MAP_LIMITS, megabytes } from "~/lib/codemode/limits";
import {
  fittedLayer,
  imagePixels,
  type LayerHead,
  layerOf,
  type MapLayer,
} from "./mapLayers";
import { readPoint, readShape } from "./mapMarks";
import type { MapPoint, MapShape } from "./mapMarkTypes";
import { count, fail, isPlain } from "./mapValues";
import { charge, MAP_ROOM_CHARS, type MarkBudget, sizeTaken } from "./markBudget";

export const FILE_RESERVE_CHARS = 16 * 1024;

export const fileRoom = (budget: MarkBudget) =>
  MAP_ROOM_CHARS - FILE_RESERVE_CHARS - sizeTaken(budget);

export interface FileMarks {
  points?: readonly unknown[];
  shapes?: readonly unknown[];
}

export interface FittedMarks {
  points: MapPoint[];
  shapes: MapShape[];
}

export interface FileFit {
  lists: FittedMarks[];
  given: number;
  kept: number;
  note?: string;
}

const ADVICE =
  "Simplify or split the file, or serve it from the backend as vector tiles.";

function extent(raw: unknown): { positions: number; rings: number } {
  const coordinates =
    isPlain(raw) && Array.isArray(raw.coordinates) ? raw.coordinates : [];
  if (isPlain(raw) && raw.type === "polygon")
    return {
      positions: coordinates.reduce(
        (sum: number, ring) => sum + (Array.isArray(ring) ? ring.length : 0),
        0,
      ),
      rings: coordinates.length,
    };
  return { positions: coordinates.length, rings: 0 };
}

interface Read {
  list: number;
  kind: "points" | "shapes";
  mark: MapPoint | MapShape;
  chars: number;
}

const sizeOf = (mark: unknown) => JSON.stringify(mark).length + 1;

const quoted = (name: string) => JSON.stringify(name.slice(0, 24));

export function fitFileMarks(lists: readonly FileMarks[], budget: MarkBudget): FileFit {
  const read: Read[] = [];
  let given = 0;
  lists.forEach((marks, list) => {
    (marks.points ?? []).forEach((raw, at) => {
      given++;
      if (budget.points <= 0) return;
      const mark = readPoint(raw, at, budget);
      if (!mark) return void given--;
      budget.points--;
      read.push({ list, kind: "points", mark, chars: sizeOf(mark) });
    });
    (marks.shapes ?? []).forEach((raw, at) => {
      given++;
      const { positions, rings } = extent(raw);
      if (budget.shapes <= 0 || positions > budget.vertices || rings > MAP_LIMITS.rings)
        return;
      budget.shapes--;
      const mark = readShape(raw, at, budget);
      read.push({ list, kind: "shapes", mark, chars: sizeOf(mark) });
    });
  });
  const room = fileRoom(budget);
  let total = read.reduce((sum, item) => sum + item.chars, 0);

  const without: string[] = [];
  if (total > room) {
    const weight = new Map<string, number>();
    for (const { mark } of read)
      for (const [name, value] of Object.entries(mark.props ?? {}))
        weight.set(
          name,
          (weight.get(name) ?? 0) +
            JSON.stringify(name).length +
            JSON.stringify(value).length +
            2,
        );
    const heaviest = [...weight].sort((a, b) => b[1] - a[1]);
    let estimate = total;
    while (heaviest.length && (estimate > room || total > room)) {
      const dropped = new Set<string>();
      do {
        const [name, chars] = heaviest.shift() as [string, number];
        dropped.add(name);
        without.push(name);
        estimate -= chars;
      } while (heaviest.length && estimate > room);
      total = 0;
      for (const item of read) {
        const props = item.mark.props;
        if (props && Object.keys(props).some((name) => dropped.has(name))) {
          const { props: _props, ...rest } = item.mark;
          const left = Object.entries(props).filter(([name]) => !dropped.has(name));
          item.mark = (
            left.length ? { ...item.mark, props: Object.fromEntries(left) } : rest
          ) as MapPoint | MapShape;
          item.chars = sizeOf(item.mark);
        }
        total += item.chars;
      }
      estimate = total;
    }
  }

  const fitted: FittedMarks[] = lists.map(() => ({ points: [], shapes: [] }));
  let kept = 0;
  let used = 0;
  for (const item of read) {
    if (used + item.chars > room) continue;
    used += item.chars;
    kept++;
    charge(budget, item.kind, item.chars);
    if (item.kind === "points") fitted[item.list].points.push(item.mark as MapPoint);
    else fitted[item.list].shapes.push(item.mark as MapShape);
  }
  if (kept === given && without.length === 0) return { lists: fitted, given, kept };
  const values = without.length
    ? `without their values of ${without.slice(0, 2).map(quoted).join(", ")}${without.length > 2 ? ` and ${without.length - 2} more` : ""}`
    : "";
  const drawn =
    kept === given
      ? `its marks are drawn ${values}`
      : `${count(kept)} of its ${count(given)} marks are drawn${values ? `, ${values}` : ""}`;
  return {
    lists: fitted,
    given,
    kept,
    note: `The file is larger than a map: ${drawn}. ${ADVICE}`,
  };
}

export const noMarkFits = (fit: FileFit): never =>
  fail(
    `the file cannot be drawn: its ${count(fit.given)} ${fit.given === 1 ? "mark is" : "marks are"} larger than a map has room for (${megabytes(MAP_LIMITS.chars)} as data). ${ADVICE}`,
  );

export const imageLeftOut = (name: unknown, over: "size" | "pixels"): string =>
  `The image "${String(name ?? "").slice(0, 60)}" is not drawn: ${
    over === "size"
      ? `with it the map would be over the ${megabytes(MAP_LIMITS.chars)} a map has, its images included.`
      : `with it the images of the map would declare more than the ${count(MAP_LIMITS.imagePixels)} pixels a map decodes.`
  }`;

export interface FittedFiles {
  points: MapPoint[];
  shapes: MapShape[];
  layers: (MapLayer | null)[];
  fit: FileFit;
  notes: string[];
}

export function fitFiles(
  files: readonly FileMarks[],
  heads: readonly LayerHead[],
  budget: MarkBudget,
): FittedFiles {
  const fit = fitFileMarks(
    [...files, ...heads.map(({ kind, raw }) => (kind === "image" ? {} : raw))],
    budget,
  );
  const points: MapPoint[] = [];
  const shapes: MapShape[] = [];
  for (const fitted of fit.lists.slice(0, files.length)) {
    points.push(...fitted.points);
    shapes.push(...fitted.shapes);
  }
  const notes: string[] = [];
  const layers = heads.map((head, at) => {
    if (head.kind !== "image") return fittedLayer(head, fit.lists[files.length + at]);
    const picture = isPlain(head.raw.image) ? head.raw.image : {};
    const size = typeof picture.data === "string" ? picture.data.length : 0;
    const over =
      size > fileRoom(budget)
        ? "size"
        : imagePixels(picture) > budget.pixels
          ? "pixels"
          : null;
    if (over === null) return layerOf(head, budget);
    notes.push(imageLeftOut(head.raw.name, over));
    return null;
  });
  return { points, shapes, layers, fit, notes };
}
