import type { MapMarkerTone } from "~/lib/geo/mapMarkTypes";

export interface MapTheme {
  land: string;
  focus: string;
  border: string;
  innerBorder: string;
  mark: string;
  markStroke: string;
  hover: string;
  shaded: string;
  sequential: readonly string[];
  diverging: readonly string[];
  ramps: readonly (readonly string[])[];
  series: readonly string[];
  categories: readonly string[];
  heat: readonly string[];
  tones: Record<MapMarkerTone, string>;
  relief: { shadow: string; highlight: string; accent: string };
}

export const MAP_THEMES: { light: MapTheme; dark: MapTheme } = {
  light: {
    land: "#eef1f5",
    focus: "#e4e8ee",
    border: "#b3bbc8",
    innerBorder: "#cfd5de",
    mark: "#ed9b44",
    markStroke: "#ffffff",
    hover: "#0b1f3f",
    shaded: "#3f6fb5",
    sequential: ["#a9c8f2", "#86b0ea", "#6397e0", "#407dd3", "#1f62bd", "#0b3f8a"],
    diverging: ["#b3541e", "#e9a26b", "#eef1f5", "#82aee6", "#0b3f8a"],
    ramps: [
      ["#fbd9a5", "#f7bd74", "#f09a48", "#e0782a", "#c25a17", "#8f3d0c"],
      ["#bfe3cf", "#93d0b0", "#63b98e", "#3a9f70", "#1f8257", "#0d5c3c"],
      ["#d9cdf3", "#c0aeea", "#a38cdd", "#8569cc", "#6748b3", "#452b85"],
    ],
    series: ["#ed9b44", "#1f9d8a", "#8a5cd0", "#d1477a", "#5b7a1e", "#2a84c9"],
    categories: [
      "#ed9b44",
      "#1f9d8a",
      "#8a5cd0",
      "#d1477a",
      "#5b7a1e",
      "#2a84c9",
      "#c0392b",
      "#6b7280",
      "#0e7490",
      "#8a5a12",
      "#4d5bd1",
      "#2e9e4f",
    ],
    heat: ["#fff1b8", "#fdc56a", "#f58a3c", "#dd4a2f", "#9c1f45", "#5a1040"],
    tones: {
      accent: "#ed9b44",
      positive: "#157a4e",
      negative: "#c8332a",
      neutral: "#4a5568",
    },
    relief: {
      shadow: "#4f5b73",
      highlight: "rgba(255,255,255,0.7)",
      accent: "#7f8a9e",
    },
  },
  dark: {
    land: "#14233f",
    focus: "#1a2c4e",
    border: "#3d4f73",
    innerBorder: "#2a3b5c",
    mark: "#f5b96f",
    markStroke: "#06122f",
    hover: "#ffffff",
    shaded: "#9cc3f5",
    sequential: ["#2c5596", "#2f66b3", "#377bd0", "#5697e6", "#89baf2", "#c5ddfa"],
    diverging: ["#f0a25e", "#a8672f", "#1a2c4e", "#2a6dbd", "#c5ddfa"],
    ramps: [
      ["#7a4a17", "#9a5f1e", "#bd7a2c", "#dc9a48", "#f0bb78", "#fbdcb0"],
      ["#17573f", "#1f7252", "#2c8f68", "#4bad84", "#7fcaa6", "#b9e6cf"],
      ["#4a3382", "#5f43a3", "#7a5cc4", "#9a80db", "#bba8ea", "#ddd3f6"],
    ],
    series: ["#f5b96f", "#4fc9b4", "#b295ea", "#ee7fa6", "#a9c95a", "#62b0ea"],
    categories: [
      "#f5b96f",
      "#4fc9b4",
      "#b295ea",
      "#ee7fa6",
      "#a9c95a",
      "#62b0ea",
      "#f08a7b",
      "#a8b0bd",
      "#4cc3dc",
      "#d6a44a",
      "#8f9af0",
      "#6fd08c",
    ],
    heat: ["#43307f", "#7b2f8e", "#bd3d77", "#ee6a4c", "#fbab4a", "#fdeb9c"],
    tones: {
      accent: "#f5b96f",
      positive: "#5fd09c",
      negative: "#ff8a7a",
      neutral: "#c9d1de",
    },
    relief: {
      shadow: "#020814",
      highlight: "rgba(150,172,216,0.55)",
      accent: "#081428",
    },
  },
};

type Rgb = [number, number, number];

const rgbOf = (hex: string): Rgb => {
  const full =
    hex.length === 4
      ? [...hex.slice(1)].map((digit) => digit + digit).join("")
      : hex.slice(1);
  return [0, 2, 4].map((at) => Number.parseInt(full.slice(at, at + 2), 16)) as Rgb;
};

const hexOf = ([r, g, b]: Rgb) =>
  `#${[r, g, b].map((part) => Math.round(part).toString(16).padStart(2, "0")).join("")}`;

export function colorAt(stops: readonly string[], t: number): string {
  const at = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (stops.length - 1);
  const from = Math.floor(at);
  const to = Math.min(stops.length - 1, from + 1);
  const a = rgbOf(stops[from]);
  const b = rgbOf(stops[to]);
  return hexOf(a.map((part, index) => part + (b[index] - part) * (at - from)) as Rgb);
}

export function isLight(hex: string): boolean {
  const [r, g, b] = rgbOf(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}

export const toneColor = (theme: Pick<MapTheme, "tones">, tone: string | undefined) =>
  tone === undefined
    ? theme.tones.accent
    : Object.hasOwn(theme.tones, tone)
      ? theme.tones[tone as MapMarkerTone]
      : tone;

const SIGN_INK = { onLight: "#0b1f3f", onDark: "#ffffff" };

const luminance = (hex: string) => {
  const [r, g, b] = rgbOf(hex).map((part) => {
    const level = part / 255;
    return level <= 0.03928 ? level / 12.92 : ((level + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export function inkOn(hex: string): string {
  const light = luminance(hex);
  const dark = (light + 0.05) / (luminance(SIGN_INK.onLight) + 0.05);
  const white = 1.05 / (light + 0.05);
  return dark >= white ? SIGN_INK.onLight : SIGN_INK.onDark;
}

export interface MapScale {
  min: number;
  max: number;
  diverging: boolean;
  color: (value: number) => string;
  stops: readonly string[];
}

export function mapScale(
  min: number,
  max: number,
  theme: Pick<MapTheme, "sequential" | "diverging">,
): MapScale {
  const diverging = min < 0 && max > 0;
  if (diverging) {
    const reach = Math.max(-min, max);
    return {
      min: -reach,
      max: reach,
      diverging,
      stops: theme.diverging,
      color: (value) => colorAt(theme.diverging, (value + reach) / (2 * reach)),
    };
  }
  const span = max - min;
  return {
    min,
    max,
    diverging,
    stops: theme.sequential,
    color: (value) => colorAt(theme.sequential, span > 0 ? (value - min) / span : 0.6),
  };
}

export function shortNumber(value: number): string {
  const size = Math.abs(value);
  const digits = size >= 1000 ? 0 : size >= 100 ? 1 : size >= 1 ? 2 : 3;
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}
