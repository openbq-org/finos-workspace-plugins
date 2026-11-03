import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useMapSources } from "~/components/Geo/useMapSources";
import { getSettings, setSettings } from "~/settings";

const source = (id: string, url = `https://tiles.example.org/${id}/{z}/{x}/{y}.png`) => ({
  id,
  kind: "raster-tiles",
  url,
  attribution: "Reference",
});
const declare = (declaredSources: unknown, mapSources = "") =>
  act(() => setSettings({ ...getSettings(), declaredSources, mapSources }));

beforeEach(() => declare(undefined));

describe("useMapSources", () => {
  it("has no source while nothing declares one", () => {
    const { result } = renderHook(() => useMapSources());
    expect(result.current).toEqual({ sources: [], ambiguous: [], refused: [] });
  });

  it("follows the sources of the widget and of the admin settings", () => {
    const { result } = renderHook(() => useMapSources());
    declare([source("ndvi")]);
    expect(result.current.sources.map(({ id, url }) => [id, url])).toEqual([
      ["ndvi", "https://tiles.example.org/ndvi/{z}/{x}/{y}.png"],
    ]);
    declare([source("ndvi")], JSON.stringify([source("ndvi")]));
    expect(result.current).toMatchObject({ sources: [], ambiguous: ["ndvi"] });
    declare(undefined, JSON.stringify([source("clouds")]));
    expect(result.current.sources.map(({ id }) => id)).toEqual(["clouds"]);
    declare(undefined);
    expect(result.current.sources).toEqual([]);
  });

  it("takes no address that is not https, and says why", () => {
    const { result } = renderHook(() => useMapSources());
    declare([source("plain", "http://tiles.example.org/{z}/{x}/{y}.png")]);
    expect(result.current.sources).toEqual([]);
    expect(result.current.refused).toHaveLength(1);
  });

  it("refuses admin settings that are not JSON", () => {
    const { result } = renderHook(() => useMapSources());
    declare(undefined, "{not json");
    expect(result.current.sources).toEqual([]);
    expect(result.current.refused[0].reason).toMatch(/not JSON/);
  });

  it("is the same object while the sources say the same", () => {
    const { result, rerender } = renderHook(() => useMapSources());
    declare([source("ndvi")]);
    const first = result.current;
    declare([source("ndvi")]);
    rerender();
    expect(result.current).toBe(first);
  });
});
