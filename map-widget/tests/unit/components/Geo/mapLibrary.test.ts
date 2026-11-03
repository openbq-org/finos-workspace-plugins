import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const probe = (context: (kind: string) => unknown) => {
  const getContext = vi.fn(context);
  const create = vi.spyOn(document, "createElement").mockImplementation(((
    tag: string,
  ) => {
    if (tag !== "canvas") throw new Error(`The probe made a <${tag}>.`);
    return { getContext } as unknown as HTMLCanvasElement;
  }) as typeof document.createElement);
  return { getContext, create };
};
const load = () => import("~/components/Geo/mapLibrary");

describe("whether this browser can draw a map", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  it("asks for a WebGL context and gives it back at once", async () => {
    const loseContext = vi.fn();
    const getExtension = vi.fn((name: string) =>
      name === "WEBGL_lose_context" ? { loseContext } : null,
    );
    const { getContext } = probe((kind) =>
      kind === "webgl2" ? { getExtension } : null,
    );
    const { canDrawMaps } = await load();
    expect(canDrawMaps()).toBe(true);
    expect(getContext).toHaveBeenCalledWith("webgl2");
    expect(getExtension).toHaveBeenCalledWith("WEBGL_lose_context");
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it("asks once for the page, however many maps ask", async () => {
    const { create } = probe(() => ({ getExtension: () => null }));
    const { canDrawMaps } = await load();
    for (let map = 0; map < 25; map++) expect(canDrawMaps()).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("takes the first version of WebGL when the second is not there", async () => {
    const { getContext } = probe((kind) =>
      kind === "webgl" ? { getExtension: () => null } : null,
    );
    const { canDrawMaps } = await load();
    expect(canDrawMaps()).toBe(true);
    expect(getContext.mock.calls.map(([kind]) => kind)).toEqual(["webgl2", "webgl"]);
  });

  it("says no where WebGL is off, and where asking for it throws", async () => {
    const off = probe(() => null);
    expect((await load()).canDrawMaps()).toBe(false);
    off.create.mockRestore();
    vi.resetModules();
    probe(() => {
      throw new Error("no GPU process");
    });
    const { canDrawMaps } = await load();
    expect(canDrawMaps()).toBe(false);
    expect(canDrawMaps()).toBe(false);
  });
});
