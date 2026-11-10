import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  boundaryLayers,
  boundarySource,
  boundaryStyle,
  useMapBoundaries,
} from "~/components/Geo/useMapBoundaries";
import { boundaryKey, loadBoundaryShapes } from "~/lib/geo/boundaryShapes";
import type { MapBoundaryId } from "~/lib/geo/mapBoundaries";
import { expectNoUseAfterRemove, FakeMap } from "./fakeMap";
import { scene, theme } from "./scene/support";

vi.mock("~/lib/geo/boundaryShapes", () => ({
  boundaryKey: vi.fn(async (id: string) => id),
  loadBoundaryShapes: vi.fn(),
}));

const OUTLINES = { type: "FeatureCollection", features: [] };
const CITIES = { type: "FeatureCollection", features: [] };
const shapesOf = (id: MapBoundaryId, key: string = id) =>
  id === "cities" ? { id, key, points: CITIES } : { id, key, outlines: OUTLINES };

beforeEach(() => {
  FakeMap.reset();
  vi.mocked(boundaryKey).mockClear();
  vi.mocked(loadBoundaryShapes).mockClear();
  vi.mocked(boundaryKey).mockImplementation(async (id) => id);
  vi.mocked(loadBoundaryShapes).mockImplementation(async (id) => shapesOf(id) as never);
});
afterEach(expectNoUseAfterRemove);

const built = scene({ points: [{ lat: 42, lon: -93.7 }] });
const mount = (on: MapBoundaryId[] = [], loaded = true) => {
  const fake = new FakeMap();
  fake.setStyle({ sources: built.sources, layers: built.style }, { diff: false });
  if (loaded) fake.loadStyle();
  const hook = renderHook(
    (props: { on: MapBoundaryId[]; of: typeof built }) =>
      useMapBoundaries(fake.map, props.of, props.on, theme),
    { initialProps: { on, of: built } },
  );
  return { fake, ...hook };
};
const drawn = (fake: FakeMap) => fake.addedLayers.map(({ layer }) => layer.id);

describe("the boundary layers of a drawn map", () => {
  it("loads nothing and adds nothing for a map nobody asked boundaries of", async () => {
    const { fake, result } = mount();
    await act(async () => {});
    expect(loadBoundaryShapes).not.toHaveBeenCalled();
    expect(fake.addedSources.size).toBe(0);
    expect(fake.listeners("moveend")).toBe(0);
    expect(result.current).toEqual({ states: {}, drawn: "" });
  });

  it("loads the files of a layer when it is turned on, and draws its outlines under the names of the basemap", async () => {
    const { fake, result, rerender } = mount();
    rerender({ on: ["us-states"], of: built });
    expect(result.current.states).toEqual({ "us-states": "loading" });
    await waitFor(() => expect(result.current.states).toEqual({}));
    expect(loadBoundaryShapes).toHaveBeenCalledTimes(1);
    expect(fake.addedSources.get(boundarySource("us-states"))).toEqual({
      type: "geojson",
      data: OUTLINES,
    });
    expect(fake.addedLayers).toEqual([
      {
        layer: expect.objectContaining({ id: "boundary:us-states:line", type: "line" }),
        ...(built.overlayBefore ? { before: built.overlayBefore } : {}),
      },
    ]);
    expect(result.current.drawn).toBe("us-states");
  });

  it("draws the cities as dots with their names, in a font the package carries", async () => {
    const { fake, result } = mount(["cities"]);
    await waitFor(() => expect(result.current.drawn).toBe("cities"));
    expect(drawn(fake)).toEqual(boundaryLayers("cities"));
    expect(fake.glyphs).toBe("workspace-asset://basemap/fonts/{fontstack}/{range}.pbf");
    const [dot, name] = boundaryStyle("cities", theme);
    expect(dot.type).toBe("circle");
    expect(name).toMatchObject({
      type: "symbol",
      layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Medium"] },
    });
  });

  it("takes a layer out with its source when it is turned off", async () => {
    const { fake, result, rerender } = mount(["us-states", "countries"]);
    await waitFor(() => expect(result.current.states).toEqual({}));
    expect(drawn(fake).sort()).toEqual([
      "boundary:countries:line",
      "boundary:us-states:line",
    ]);
    rerender({ on: ["countries"], of: built });
    expect(drawn(fake)).toEqual(["boundary:countries:line"]);
    expect(fake.addedSources.has(boundarySource("us-states"))).toBe(false);
    expect(result.current.drawn).toBe("countries");
  });

  it("adds its layers again to a new style, which has none of them", async () => {
    const { fake, result, rerender } = mount(["us-states"]);
    await waitFor(() => expect(result.current.states).toEqual({}));
    const next = scene({ points: [{ lat: 1, lon: 2 }] });
    fake.setStyle({ sources: next.sources, layers: next.style }, { diff: false });
    rerender({ on: ["us-states"], of: next });
    expect(drawn(fake)).toEqual([]);
    act(() => fake.loadStyle());
    expect(drawn(fake)).toEqual(["boundary:us-states:line"]);
    expect(loadBoundaryShapes).toHaveBeenCalledTimes(1);
  });

  it("waits for a style that is not loaded when the layer is turned on", async () => {
    const { fake, result } = mount(["us-states"], false);
    await waitFor(() => expect(result.current.states).toEqual({}));
    expect(drawn(fake)).toEqual([]);
    act(() => fake.loadStyle());
    expect(drawn(fake)).toEqual(["boundary:us-states:line"]);
  });

  it("asks which files a layer needs when the map rests, and loads them only when they change", async () => {
    const { fake, result } = mount(["admin1"]);
    await waitFor(() => expect(result.current.drawn).toBe("admin1"));
    act(() => fake.fire("moveend"));
    await act(async () => {});
    expect(loadBoundaryShapes).toHaveBeenCalledTimes(1);
    vi.mocked(boundaryKey).mockImplementation(async (id) => `${id}:asia`);
    vi.mocked(loadBoundaryShapes).mockImplementation(
      async (id) => shapesOf(id, `${id}:asia`) as never,
    );
    act(() => fake.fire("moveend"));
    await waitFor(() => expect(result.current.drawn).toBe("admin1:asia"));
    expect(loadBoundaryShapes).toHaveBeenCalledTimes(2);
    expect(fake.setData).toHaveBeenCalledWith(boundarySource("admin1"), OUTLINES);
  });

  it("says that a layer did not load, and draws the others", async () => {
    vi.mocked(loadBoundaryShapes).mockImplementation(async (id) => {
      if (id === "us-counties") throw new Error("404");
      return shapesOf(id) as never;
    });
    const { fake, result } = mount(["us-states", "us-counties"]);
    await waitFor(() =>
      expect(result.current.states).toEqual({ "us-counties": "failed" }),
    );
    expect(drawn(fake)).toEqual(["boundary:us-states:line"]);
  });

  it("gives every handler back when the map goes", async () => {
    const { fake, result, unmount } = mount(["us-states"]);
    await waitFor(() => expect(result.current.states).toEqual({}));
    expect(fake.listeners("moveend")).toBe(1);
    unmount();
    expect(fake.listeners()).toBe(0);
  });
});
