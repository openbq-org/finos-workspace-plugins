import { MARKER_SIZE } from "./mapSigns";
import type { SceneMark } from "./scene/sceneTypes";

export interface PixelBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface MapPart extends PixelBox {
  line?: boolean;
}

export interface FitPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const FIT_MARGIN_SHARE = 0.06;
const FIT_MARGIN_LEAST = 8;
export const OVERLAY_GAP = 6;
const CLEAR_ZOOM_OUT = 1;
const LINE_ZOOM_OUT = 0.25;
const WORLD = 512;

const mercatorX = (lon: number) => (lon + 180) / 360;
const mercatorY = (lat: number) => {
  const sin = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
};

const over = (part: PixelBox, box: PixelBox) =>
  part.left - OVERLAY_GAP < box.right &&
  part.right + OVERLAY_GAP > box.left &&
  part.top - OVERLAY_GAP < box.bottom &&
  part.bottom + OVERLAY_GAP > box.top;

export function closerFit({
  width,
  height,
  box,
  overlays,
  reach,
  maxZoom,
}: {
  width: number;
  height: number;
  box: readonly [readonly [number, number], readonly [number, number]];
  overlays: readonly MapPart[];
  reach: number;
  maxZoom: number;
}): { padding: FitPadding; maxZoom: number } | null {
  const [[west, south], [east, north]] = box;
  const across = (mercatorX(east) - mercatorX(west)) * WORLD;
  const down = (mercatorY(south) - mercatorY(north)) * WORLD;
  if (!(across > 0) || !(down > 0)) return null;
  const margin = Math.max(
    FIT_MARGIN_LEAST,
    Math.round(FIT_MARGIN_SHARE * Math.min(width, height)),
  );
  const inner = margin + reach;
  const zoomIn = (padding: FitPadding) =>
    Math.min(
      maxZoom,
      Math.log2(
        Math.min(
          (width - padding.left - padding.right) / across,
          (height - padding.top - padding.bottom) / down,
        ),
      ),
    );
  const marksIn = (padding: FitPadding, zoom: number): PixelBox => {
    const x = (padding.left + width - padding.right) / 2;
    const y = (padding.top + height - padding.bottom) / 2;
    const wide = (across * 2 ** zoom) / 2 + reach;
    const high = (down * 2 ** zoom) / 2 + reach;
    return { left: x - wide, right: x + wide, top: y - high, bottom: y + high };
  };
  const padding: FitPadding = { top: inner, right: inner, bottom: inner, left: inner };
  const filled = zoomIn(padding);
  if (!Number.isFinite(filled)) return null;
  const marks = marksIn(padding, filled);
  const opaque = overlays.filter((part) => !part.line);

  for (const part of opaque) {
    if (!over(part, marks)) continue;
    const sides: [keyof FitPadding, number, number][] = [
      ["top", part.bottom, part.bottom - part.top],
      ["bottom", height - part.top, part.bottom - part.top],
      ["left", part.right, part.right - part.left],
      ["right", width - part.left, part.right - part.left],
    ];
    const [side, clear, own] = sides.reduce((best, next) =>
      next[1] < best[1] ? next : best,
    );
    padding[side] = Math.max(
      padding[side],
      Math.min(clear, margin + own) + OVERLAY_GAP + reach,
    );
  }
  const zoom = zoomIn(padding);
  if (zoom < filled - CLEAR_ZOOM_OUT) return null;

  const shown = marksIn(padding, zoom);
  const lowest = Math.max(
    reach + FIT_MARGIN_LEAST,
    ...opaque
      .filter(
        (part) =>
          part.top > height / 2 &&
          part.left - OVERLAY_GAP < shown.right &&
          part.right + OVERLAY_GAP > shown.left,
      )
      .map((part) => height - part.top + OVERLAY_GAP + reach),
  );
  const under = Math.max(
    0,
    ...overlays
      .filter((part) => part.line && over(part, shown))
      .map((part) => part.bottom + OVERLAY_GAP - shown.top),
  );
  const lower = Math.max(0, Math.min(padding.bottom - lowest, under));
  if (lower > 0) {
    padding.top += lower;
    padding.bottom -= lower;
  }
  const rest = under - lower;
  if (rest > 0) {
    const closer = { ...padding, top: padding.top + rest };
    const fitted = zoomIn(closer);
    if (fitted >= zoom - LINE_ZOOM_OUT) return { padding: closer, maxZoom: fitted };
  }
  return { padding, maxZoom: zoom };
}

export function bottomPartsRoom(
  overlays: readonly MapPart[],
  height: number,
  reach: number,
): number {
  return Math.max(
    0,
    ...overlays
      .filter((part) => !part.line && part.top > height / 2)
      .map((part) => height - part.top + OVERLAY_GAP + reach),
  );
}

const OVERLAY_SELECTOR = "[data-map-overlay], [data-map-legend], [data-map-credit]";

export function overlaysOver(container: HTMLElement): MapPart[] | null {
  const frame = container.getBoundingClientRect();
  const parts = container.parentElement?.querySelectorAll(OVERLAY_SELECTOR) ?? [];
  const measured: MapPart[] = [];
  for (const part of parts) {
    const { left, top, right, bottom, width, height } = part.getBoundingClientRect();
    if (!(width > 0 && height > 0)) return null;
    measured.push({
      left: left - frame.left,
      top: top - frame.top,
      right: right - frame.left,
      bottom: bottom - frame.top,
      ...(part.getAttribute("data-map-overlay") === "line" ? { line: true } : {}),
    });
  }
  return measured.length ? measured : null;
}

export const marksReach = (marks: readonly SceneMark[]): number =>
  marks.reduce(
    (most, mark) =>
      Math.max(most, mark.radius ?? 0, mark.reach ?? 0, mark.marker ? MARKER_SIZE : 0),
    0,
  );
