import { readAssetJson } from "~/host";

export interface ZipsData {
  source: string;
  vintage: string;
  licence: string;
  scale: number;
  count: number;
  table: string;
}

export interface ZipIndex {
  size: number;
  source: string;
  vintage: string;
  place: (code: string) => [number, number] | null;
}

const MOST = 100_000;

export function buildZipIndex(data: ZipsData): ZipIndex {
  if (
    typeof data?.table !== "string" ||
    !(data.scale > 0) ||
    !(data.count >= 0 && data.count <= MOST)
  )
    throw new Error("The table of ZIP codes is not in the form the app reads.");
  const packed = atob(data.table);
  const codes = new Int32Array(data.count);
  const lats = new Int32Array(data.count);
  const lons = new Int32Array(data.count);
  let at = 0;
  const next = (): number => {
    let value = 0;
    let scale = 1;
    for (;;) {
      if (at >= packed.length)
        throw new Error("The table of ZIP codes ends before its last code.");
      const byte = packed.charCodeAt(at++);
      value += (byte & 127) * scale;
      if (byte < 128) return value;
      scale *= 128;
    }
  };
  const signed = () => {
    const value = next();
    return value % 2 ? -(value + 1) / 2 : value / 2;
  };
  let [code, lat, lon] = [0, 0, 0];
  for (let row = 0; row < data.count; row++) {
    code += next();
    lat += signed();
    lon += signed();
    codes[row] = code;
    lats[row] = lat;
    lons[row] = lon;
  }
  return {
    size: data.count,
    source: data.source,
    vintage: data.vintage,
    place: (written) => {
      if (!/^\d{5}$/.test(written)) return null;
      const wanted = Number(written);
      let [low, high] = [0, codes.length - 1];
      while (low <= high) {
        const middle = (low + high) >> 1;
        if (codes[middle] === wanted)
          return [lons[middle] / data.scale, lats[middle] / data.scale];
        if (codes[middle] < wanted) low = middle + 1;
        else high = middle - 1;
      }
      return null;
    },
  };
}

export function zipCode(
  value: unknown,
  named: boolean,
): { code: string } | { short: string } | null {
  const written =
    typeof value === "number"
      ? Number.isInteger(value) && value >= 0 && value <= 99_999
        ? String(value)
        : null
      : typeof value === "string"
        ? value.trim()
        : null;
  if (written === null || written === "") return null;
  if (/^\d{5}$/.test(written)) return { code: written };
  if (typeof value === "string" && /^\d{5}-\d{4}$|^\d{9}$/.test(written))
    return { code: written.slice(0, 5) };
  if (/^[1-9]\d{2,3}$/.test(written))
    return named ? { code: written.padStart(5, "0") } : { short: written };
  return null;
}

let index: ZipIndex | null = null;
let loading: Promise<ZipIndex> | null = null;

export function registerZips(data: ZipsData): ZipIndex {
  index = buildZipIndex(data);
  return index;
}

export const loadedZips = (): ZipIndex | null => index;

export function loadZips(): Promise<ZipIndex> {
  if (index) return Promise.resolve(index);
  loading ??= (async () => {
    return registerZips(await readAssetJson<ZipsData>("geo/places/zips.json"));
  })();
  const shared = loading;
  shared.catch(() => {
    if (loading === shared) loading = null;
  });
  return shared;
}
