import { MAP_LIMITS } from "~/lib/codemode/limits";

export interface TagCandidate {
  mark: number;
  text: string;
  note: boolean;
  marked?: boolean;
  x: number;
  y: number;
  offset: number;
  centred: boolean;
  track?: string;
  width?: number;
  size?: number;
}

export interface Dot extends Box {
  size?: number;
}

export interface PlacedTag {
  mark: number;
  text: string;
  note: boolean;
  left: number;
  top: number;
}

const TAG_HEIGHT = 18;
const TAG_CHROME = 14;
export const tagWidth = (text: string) => Math.ceil(text.length * 6.4) + TAG_CHROME;

let measuring: CanvasRenderingContext2D | null | undefined;

export function tagMeasure(layer: HTMLElement): (text: string) => number {
  measuring ??= layer.ownerDocument.createElement("canvas").getContext("2d");
  const context = measuring;
  if (!context) return tagWidth;
  context.font = `500 11px ${getComputedStyle(layer).fontFamily}`;
  return (text) =>
    Math.ceil(context.measureText(text.replace(/\d/g, "0")).width) + TAG_CHROME;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const overlaps = (a: Box, b: Box) =>
  a.left < b.right + 2 &&
  b.left < a.right + 2 &&
  a.top < b.bottom + 2 &&
  b.top < a.bottom + 2;

const covers = (box: Box, point: TagCandidate) =>
  point.x + point.offset > box.left &&
  point.x - point.offset < box.right &&
  point.y + point.offset > box.top &&
  point.y - point.offset < box.bottom;

export const TRACK_AIR = { x: 8, y: TAG_HEIGHT };
const crowds = (a: Box, b: Box) =>
  a.left < b.right + TRACK_AIR.x &&
  b.left < a.right + TRACK_AIR.x &&
  a.top < b.bottom + TRACK_AIR.y &&
  b.top < a.bottom + TRACK_AIR.y;

export function trackOrder(count: number): number[] {
  if (count <= 2) return Array.from({ length: count }, (_, at) => at);
  const order = [0, count - 1];
  const stretches: [number, number][] = [[0, count - 1]];
  while (order.length < count) {
    let longest = 0;
    for (let at = 1; at < stretches.length; at++)
      if (
        stretches[at][1] - stretches[at][0] >
        stretches[longest][1] - stretches[longest][0]
      )
        longest = at;
    const [from, to] = stretches[longest];
    const middle = Math.floor((from + to) / 2);
    order.push(middle);
    const halves = (
      [
        [from, middle],
        [middle, to],
      ] as [number, number][]
    ).filter(([a, b]) => b - a > 1);
    stretches.splice(longest, 1, ...halves);
  }
  return order;
}

function thinnedFirst(ordered: readonly TagCandidate[]): TagCandidate[] {
  const plain = (tag: TagCandidate) =>
    tag.track !== undefined && !tag.note && !tag.marked;
  const tracks = new Map<string, TagCandidate[]>();
  for (const tag of ordered)
    if (plain(tag))
      tracks.set(tag.track as string, [
        ...(tracks.get(tag.track as string) ?? []),
        tag,
      ]);
  if (tracks.size === 0) return [...ordered];
  const next = new Map(
    [...tracks].map(([track, tags]) => [
      track,
      trackOrder(tags.length).map((at) => tags[at]),
    ]),
  );
  return ordered.map((tag) =>
    plain(tag)
      ? ((next.get(tag.track as string) as TagCandidate[]).shift() as TagCandidate)
      : tag,
  );
}

const SLIDE_STEP = 10;
const POINTS_AVOIDED = 400;

export function placeTags(
  candidates: readonly TagCandidate[],
  width: number,
  height: number,
  taken: readonly Box[] = [],
  dots: readonly Dot[] = [],
  busy?: (box: Box) => boolean,
): PlacedTag[] {
  const rank = (tag: TagCandidate) => (tag.note ? 2 : 0) + (tag.marked ? 1 : 0);
  const ordered = thinnedFirst(
    [...candidates].sort((a, b) => rank(b) - rank(a) || (b.size ?? 0) - (a.size ?? 0)),
  );
  const smaller = (dot: Dot | TagCandidate, tag: TagCandidate) =>
    (dot.size ?? 0) < (tag.size ?? 0);
  const boxes: Box[] = [...taken];
  const onTrack = new Map<string, Box[]>();
  const points =
    candidates.length <= POINTS_AVOIDED ? candidates.filter((tag) => !tag.centred) : [];
  const placed: PlacedTag[] = [];
  for (const tag of ordered) {
    if (placed.length >= MAP_LIMITS.tagsShown) break;
    if (tag.x < 0 || tag.y < 0 || tag.x > width || tag.y > height) continue;
    const w = tag.width ?? tagWidth(tag.text);
    const gap = tag.offset + 4;
    const half = TAG_HEIGHT / 2;
    const over = Math.min(Math.max(tag.x - w / 2, 2), Math.max(width - 2 - w, 2));
    const up = tag.y - gap - TAG_HEIGHT;
    const down = tag.y + gap;
    const sides: [number, number][] = [
      ...(tag.centred ? [[tag.x - w / 2, tag.y - half] as [number, number]] : []),
      [tag.x + gap, tag.y - half],
      [tag.x - gap - w, tag.y - half],
      [over, up],
      [over, down],
      [tag.x + gap, up],
      [tag.x + gap, down],
      [tag.x - gap - w, up],
      [tag.x - gap - w, down],
    ];
    const first = [...sides];
    const fits = (strict: boolean) => {
      let onText: Box | undefined;
      for (const [left, top] of sides) {
        const box = { left, top, right: left + w, bottom: top + TAG_HEIGHT };
        if (
          box.left < 2 ||
          box.top < 2 ||
          box.right > width - 2 ||
          box.bottom > height - 2
        )
          continue;
        if (boxes.some((other) => overlaps(box, other))) continue;
        if (
          tag.track !== undefined &&
          onTrack.get(tag.track)?.some((other) => crowds(box, other))
        )
          continue;
        if (strict) {
          if (dots.some((other) => !smaller(other, tag) && overlaps(box, other)))
            continue;
          if (
            points.some(
              (other) => other !== tag && !smaller(other, tag) && covers(box, other),
            )
          )
            continue;
        }
        if (busy?.(box)) {
          onText ??= box;
          continue;
        }
        return take(box);
      }
      return onText ? take(onText) : false;
    };
    const take = (box: Box) => {
      boxes.push(box);
      if (tag.track !== undefined)
        onTrack.set(tag.track, [...(onTrack.get(tag.track) ?? []), box]);
      placed.push({
        mark: tag.mark,
        text: tag.text,
        note: tag.note,
        left: box.left,
        top: box.top,
      });
      return true;
    };
    if (fits(true) || !(tag.marked || tag.note)) continue;
    const from = Math.max(2, tag.x - w);
    const to = Math.min(width - 2 - w, tag.x);
    sides.length = 0;
    for (const top of [up, down, up - TAG_HEIGHT - 2, down + TAG_HEIGHT + 2])
      for (let left = from; left <= to; left += SLIDE_STEP) sides.push([left, top]);
    if (fits(true)) continue;
    sides.length = 0;
    sides.push(...first);
    fits(false);
  }
  return placed;
}

const TAG_CLASS =
  "pointer-events-none absolute left-0 top-0 whitespace-nowrap rounded border px-1.5 text-[11px] font-medium leading-4 shadow-light-1 tabular-nums will-change-transform";
const DATA_TAG =
  "border-general-border-primary bg-general-bg-primary text-ds-text-heading";
const NOTE_TAG = "border-brand-main bg-general-bg-primary text-ds-text-heading";

export function drawTags(layer: HTMLElement, tags: readonly PlacedTag[]): void {
  while (layer.childElementCount > tags.length) layer.lastElementChild?.remove();
  while (layer.childElementCount < tags.length)
    layer.appendChild(layer.ownerDocument.createElement("span"));
  tags.forEach((tag, at) => {
    const chip = layer.children[at] as HTMLElement;
    if (chip.textContent !== tag.text) chip.textContent = tag.text;
    const note = tag.note ? "true" : "false";
    if (chip.dataset.note !== note) {
      chip.className = `${TAG_CLASS} ${tag.note ? NOTE_TAG : DATA_TAG}`;
      chip.dataset.note = note;
    }
    chip.style.transform = `translate(${Math.round(tag.left)}px, ${Math.round(tag.top)}px)`;
  });
}

export function moveTags(
  layer: HTMLElement,
  places: readonly { left: number; top: number }[],
): void {
  const count = Math.min(layer.childElementCount, places.length);
  for (let at = 0; at < count; at++)
    (layer.children[at] as HTMLElement).style.transform =
      `translate(${Math.round(places[at].left)}px, ${Math.round(places[at].top)}px)`;
}

export const tagText = (tag: string | undefined, note: string | undefined) =>
  [tag, note].filter(Boolean).join(" · ");

export const NAMED_POINTS_TAGGED = 30;

export function namesAsTags(
  marks: readonly { kind: string; label?: string; tag?: string }[],
): boolean {
  let points = 0;
  let named = false;
  for (const mark of marks) {
    if (mark.tag) return false;
    if (mark.kind !== "point") continue;
    if (++points > NAMED_POINTS_TAGGED) return false;
    if (mark.label) named = true;
  }
  return named;
}
