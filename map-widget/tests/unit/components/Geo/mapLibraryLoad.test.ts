import { beforeEach, describe, expect, it, vi } from "vitest";

const lib = vi.hoisted(() => ({
  setWorkerUrl: vi.fn(),
  addProtocol: vi.fn(),
}));
vi.mock("maplibre-gl", () => lib);

const readAsset = vi.hoisted(() => vi.fn());
vi.mock("~/host", () => ({ readAsset }));

const started = vi.hoisted(() => [] as unknown[][]);

beforeEach(() => {
  started.length = 0;
  vi.stubGlobal(
    "Worker",
    class {
      constructor(...args: unknown[]) {
        started.push(args);
      }
    },
  );
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal("MAPLIBRE_WORKER_SOURCE", "self.worker = 1;");
  URL.createObjectURL = vi.fn(() => "blob:worker");
});

describe("loading the map library", () => {
  it("starts its worker from the source the build embedded, as a classic worker", async () => {
    const { loadMapLibrary } = await import("~/components/Geo/mapLibrary");
    await loadMapLibrary();
    expect(lib.setWorkerUrl).toHaveBeenCalledWith("blob:worker");
    new window.Worker("blob:worker", { type: "module" });
    new window.Worker("blob:worker");
    new window.Worker("https://example.org/w.js", { type: "module" });
    expect(started).toEqual([
      ["blob:worker", { type: "classic" }],
      ["blob:worker", undefined],
      ["https://example.org/w.js", { type: "module" }],
    ]);
  });

  it("is loaded once for the page", async () => {
    const { loadMapLibrary } = await import("~/components/Geo/mapLibrary");
    expect(loadMapLibrary()).toBe(loadMapLibrary());
    await loadMapLibrary();
    expect(lib.setWorkerUrl).toHaveBeenCalledTimes(1);
  });

  it("reads the glyphs of a name from the files of the package", async () => {
    const { loadMapLibrary } = await import("~/components/Geo/mapLibrary");
    await loadMapLibrary();
    const [protocol, load] = lib.addProtocol.mock.calls[0];
    expect(protocol).toBe("workspace-asset");
    const bytes = new Uint8Array([1, 2, 3]);
    readAsset.mockResolvedValueOnce(new DataView(bytes.buffer));
    const { data } = await load({
      url: "workspace-asset://basemap/fonts/Noto%20Sans%20Regular/0-255.pbf",
    });
    expect(readAsset).toHaveBeenCalledWith("basemap/fonts/Noto-Sans-Regular/0-255.pbf");
    expect([...new Uint8Array(data)]).toEqual([1, 2, 3]);
  });

  it("answers a glyph range the package lacks with no glyphs", async () => {
    const { loadMapLibrary } = await import("~/components/Geo/mapLibrary");
    await loadMapLibrary();
    const load = lib.addProtocol.mock.calls[0][1];
    readAsset.mockRejectedValueOnce(new Error("out_of_scope"));
    const { data } = await load({
      url: "workspace-asset://basemap/fonts/Noto%20Sans%20Regular/9216-9471.pbf",
    });
    expect(data.byteLength).toBe(0);
  });
});
