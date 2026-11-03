import type { MapMarker, MapSign } from "~/lib/geo/mapMarkTypes";
import { inkOn } from "./mapTheme";

export interface PlacedMarker {
  marker: MapMarker;
  x: number;
  y: number;
  radius?: number;
  anchored?: boolean;
  color?: string;
}

export interface SignBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const MARKER_SIZE = 20;
const WIDE_RANK = 26;
const RING_GAP = 5;
const RING_LEAST = 12;
const OVERLAP = 2;

const widthOf = (marker: MapMarker) =>
  typeof marker === "number" && marker > 9 ? WIDE_RANK : MARKER_SIZE;

const ringRadius = (sign: PlacedMarker) =>
  Math.max(RING_LEAST, sign.anchored ? (sign.radius ?? 0) + RING_GAP : RING_LEAST + 1);

export function signBox(sign: PlacedMarker): SignBox {
  if (sign.marker === "ring") {
    const r = ringRadius(sign);
    return { left: sign.x - r, top: sign.y - r, right: sign.x + r, bottom: sign.y + r };
  }
  const half = widthOf(sign.marker) / 2;
  const bottom = sign.anchored
    ? sign.y - (sign.radius ?? 0) + OVERLAP
    : sign.y + MARKER_SIZE / 2;
  return {
    left: sign.x - half,
    top: bottom - MARKER_SIZE,
    right: sign.x + half,
    bottom,
  };
}

export const dotBox = (x: number, y: number, radius: number): SignBox => ({
  left: x - radius,
  top: y - radius,
  right: x + radius,
  bottom: y + radius,
});

export const signReach = (sign: PlacedMarker): number =>
  sign.marker === "ring"
    ? ringRadius(sign)
    : Math.max(sign.radius ?? 0, widthOf(sign.marker) / 2);

export const signWord = (marker: MapMarker): string =>
  typeof marker === "number" ? `rank ${marker}` : marker;

export function emphasisFirst(
  marks: readonly { marker?: MapMarker; highlight?: boolean }[],
  noted: (at: number) => boolean,
): number[] {
  const first: number[] = [];
  const rest: number[] = [];
  marks.forEach((mark, at) => {
    (mark.marker !== undefined || mark.highlight || noted(at) ? first : rest).push(at);
  });
  return [...first, ...rest];
}

export const MARKER_PATHS: Record<Exclude<MapSign, "ring">, string> = {
  pin: "M8 14.2s4.2-3.9 4.2-7.4A4.2 4.2 0 0 0 3.8 6.8c0 3.5 4.2 7.4 4.2 7.4zm0-5.6a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4z",
  check: "M6.6 11.6 3.4 8.4l1.2-1.2 2 2 4.8-4.8 1.2 1.2z",
  star: "M8 2.2l1.75 3.7 4.05.5-3 2.8.8 4L8 11.2l-3.6 2 .8-4-3-2.8 4.05-.5z",
  flag: "M4.2 2.4h1.4v.8h6.6l-1.7 2.6 1.7 2.6H5.6v5.2H4.2z",
};

const SIGN_CLASS =
  "pointer-events-none absolute left-0 top-0 box-border flex items-center justify-center rounded-full will-change-transform";
const BADGE_CLASS =
  "border-2 border-general-bg-primary text-[11px] font-bold leading-none tabular-nums shadow-light-3";
const ACCENT_BADGE = "bg-brand-main text-general-bg-primary";
const RING_CLASS =
  "border-[2.5px] shadow-[0_0_0_1.5px_var(--general-bg-primary),inset_0_0_0_1.5px_var(--general-bg-primary)]";
const ACCENT_RING = "border-brand-main";

const SVG = "http://www.w3.org/2000/svg";

function fill(badge: HTMLElement, marker: MapMarker): void {
  badge.replaceChildren();
  if (marker === "ring") return;
  if (typeof marker === "number") {
    badge.appendChild(badge.ownerDocument.createTextNode(String(marker)));
    return;
  }
  const icon = badge.ownerDocument.createElementNS(SVG, "svg");
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.setAttribute("width", "14");
  icon.setAttribute("height", "14");
  icon.setAttribute("fill", "currentColor");
  icon.setAttribute("fill-rule", "evenodd");
  const path = badge.ownerDocument.createElementNS(SVG, "path");
  path.setAttribute("d", MARKER_PATHS[marker]);
  icon.appendChild(path);
  badge.appendChild(icon);
}

export function drawMarkers(
  layer: HTMLElement,
  markers: readonly PlacedMarker[],
): void {
  while (layer.childElementCount > markers.length) layer.lastElementChild?.remove();
  while (layer.childElementCount < markers.length)
    layer.appendChild(layer.ownerDocument.createElement("span"));
  markers.forEach((placed, at) => {
    const badge = layer.children[at] as HTMLElement;
    const ring = placed.marker === "ring";
    const look = `${placed.marker}|${placed.color ?? ""}`;
    if (badge.dataset.look !== look) {
      badge.dataset.look = look;
      badge.dataset.marker = String(placed.marker);
      fill(badge, placed.marker);
      badge.className = [
        SIGN_CLASS,
        ring ? RING_CLASS : BADGE_CLASS,
        placed.color ? "" : ring ? ACCENT_RING : ACCENT_BADGE,
      ]
        .filter(Boolean)
        .join(" ");
      badge.style.backgroundColor = !ring && placed.color ? placed.color : "";
      badge.style.color = !ring && placed.color ? inkOn(placed.color) : "";
      badge.style.borderColor = ring && placed.color ? placed.color : "";
    }
    const box = signBox(placed);
    badge.style.width = `${box.right - box.left}px`;
    badge.style.height = `${box.bottom - box.top}px`;
    badge.style.transform = `translate(${Math.round(box.left)}px, ${Math.round(box.top)}px)`;
  });
}

export function moveMarkers(
  layer: HTMLElement,
  markers: readonly PlacedMarker[],
): void {
  const count = Math.min(layer.childElementCount, markers.length);
  for (let at = 0; at < count; at++) {
    const box = signBox(markers[at]);
    (layer.children[at] as HTMLElement).style.transform =
      `translate(${Math.round(box.left)}px, ${Math.round(box.top)}px)`;
  }
}
