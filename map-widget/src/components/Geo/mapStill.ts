import type { Map as MapLibreMap } from "maplibre-gl";
import type { MapSpec } from "~/lib/geo/mapSpecTypes";
import type { KeptCamera } from "./useMapCamera";

export const STILL_WAIT_MS = 8_000;

export const STILL_LIMITS = { count: 60, bytes: 120 * 1024 * 1024 };

export interface StillOf {
  width: number;
  height: number;
  dark: boolean;
  spec: MapSpec;

  notes: unknown;

  view: string;

  camera: KeptCamera | null;

  at: string | null;
}

export function cameraAt(map: MapLibreMap): string {
  const { lng, lat } = map.getCenter();
  const round = (value: number, digits: number) =>
    Math.round(value * 10 ** digits) / 10 ** digits;
  return [
    round(lng, 6),
    round(lat, 6),
    round(map.getZoom(), 3),
    round(map.getPitch(), 1),
    round(map.getBearing(), 1),
  ].join(",");
}

export interface MapStill extends StillOf {
  url: string;
  bytes: number;

  shown: { width: number; height: number };

  tags: Node[];
  signs: Node[];
}

export const stillShows = (still: StillOf | null, now: StillOf): boolean =>
  still !== null &&
  still.width === now.width &&
  still.height === now.height &&
  still.dark === now.dark &&
  still.spec === now.spec &&
  still.notes === now.notes &&
  still.view === now.view &&
  still.camera === now.camera &&
  still.at === now.at;

function contextLost(canvas: HTMLCanvasElement): boolean {
  const context = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as {
    isContextLost?: () => boolean;
  } | null;
  return context?.isContextLost?.() === true;
}

export function canvasPicture(canvas: HTMLCanvasElement): Promise<Blob | null> {
  try {
    if (contextLost(canvas)) return Promise.resolve(null);
    const copy = document.createElement("canvas");
    copy.width = canvas.width;
    copy.height = canvas.height;
    const pen = copy.getContext("2d");
    if (!pen || !canvas.width || !canvas.height) return Promise.resolve(null);
    pen.drawImage(canvas, 0, 0);

    if (contextLost(canvas)) return Promise.resolve(null);
    return new Promise((resolve) => copy.toBlob(resolve, "image/png"));
  } catch {
    return Promise.resolve(null);
  }
}

export function mapPicture(
  map: MapLibreMap,
  signal: AbortSignal,
  picture: typeof canvasPicture = canvasPicture,

  onFrame?: () => void,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    let done = false;
    const canvas = map.getCanvas();
    const finish = (blob: Blob | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      canvas.removeEventListener("webglcontextlost", stop);
      map.off("idle", copy);
      map.off("render", drawn);
      resolve(signal.aborted ? null : blob);
    };
    const stop = () => finish(null);

    const drawn = () => {
      map.off("render", drawn);

      canvas.removeEventListener("webglcontextlost", stop);
      onFrame?.();
      picture(canvas).then(finish, stop);
    };
    const copy = () => {
      map.off("idle", copy);
      map.on("render", drawn);
      map.triggerRepaint();
    };
    const timer = setTimeout(stop, STILL_WAIT_MS);
    signal.addEventListener("abort", stop, { once: true });
    canvas.addEventListener("webglcontextlost", stop, { once: true });
    if (signal.aborted) return stop();
    if (map.loaded()) copy();
    else map.on("idle", copy);
  });
}

interface Kept {
  bytes: number;
  used: number;
  drop: () => void;
}

export class StillPool {
  private readonly kept = new Map<unknown, Kept>();
  private clock = 0;

  constructor(private readonly limits = STILL_LIMITS) {}

  keep(owner: unknown, bytes: number, drop: () => void): void {
    this.kept.delete(owner);
    this.clock += 1;
    this.kept.set(owner, { bytes, used: this.clock, drop });
    this.trim(owner);
  }

  use(owner: unknown): void {
    const still = this.kept.get(owner);
    if (!still) return;
    this.clock += 1;
    still.used = this.clock;
  }

  forget(owner: unknown): void {
    this.kept.delete(owner);
  }

  get count(): number {
    return this.kept.size;
  }

  get bytes(): number {
    let total = 0;
    for (const still of this.kept.values()) total += still.bytes;
    return total;
  }

  private trim(newest: unknown): void {
    while (this.kept.size > this.limits.count || this.bytes > this.limits.bytes) {
      let oldest: unknown;
      let used = Number.POSITIVE_INFINITY;
      for (const [owner, still] of this.kept)
        if (owner !== newest && still.used < used) {
          oldest = owner;
          used = still.used;
        }
      const dropped = this.kept.get(oldest);
      if (!dropped) return;
      this.kept.delete(oldest);
      dropped.drop();
    }
  }
}

export const stillPool = new StillPool();
