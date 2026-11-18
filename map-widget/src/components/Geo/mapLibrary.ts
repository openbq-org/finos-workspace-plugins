import { readAsset } from "~/host";
import { ASSET_PROTOCOL } from "./basemap";

type MapLibrary = typeof import("maplibre-gl");

declare const MAPLIBRE_WORKER_SOURCE: string;

const asClassicWorker = () => {
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(url: string | URL, options?: WorkerOptions) {
      const blobModule = options?.type === "module" && String(url).startsWith("blob:");
      super(url, blobModule ? { ...options, type: "classic" } : options);
    }
  };
};

const assetPath = (url: string): string =>
  decodeURIComponent(url.slice(`${ASSET_PROTOCOL}://`.length)).replaceAll(" ", "-");

let library: Promise<MapLibrary> | undefined;

export function loadMapLibrary(): Promise<MapLibrary> {
  if (library) return library;
  const loading = import("maplibre-gl").then((lib) => {
    asClassicWorker();
    lib.setWorkerUrl(
      URL.createObjectURL(
        new Blob([MAPLIBRE_WORKER_SOURCE], { type: "text/javascript" }),
      ),
    );
    lib.addProtocol(ASSET_PROTOCOL, async ({ url }) => {
      try {
        const bytes = await readAsset(assetPath(url));
        return {
          data: bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ),
        };
      } catch {
        return { data: new ArrayBuffer(0) };
      }
    });
    return lib;
  });
  library = loading;
  loading.catch(() => {
    if (library === loading) library = undefined;
  });
  return loading;
}

let drawable: boolean | undefined;

export function canDrawMaps(): boolean {
  drawable ??= probeWebGl();
  return drawable;
}

function probeWebGl(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const context = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as
      | WebGLRenderingContext
      | WebGL2RenderingContext
      | null;
    if (!context) return false;
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}
