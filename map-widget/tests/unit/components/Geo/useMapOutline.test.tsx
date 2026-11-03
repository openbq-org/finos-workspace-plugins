import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OUTLINE_LAYER,
  OUTLINE_SOURCE,
  useMapOutline,
} from "~/components/Geo/useMapOutline";
import type { PlaceRegion } from "~/lib/geo/mapOpening";
import { loadRegionIndex, loadRegionShapes } from "~/lib/geo/regions/registry";
import { expectNoUseAfterRemove, FakeMap } from "./fakeMap";
import { counties, scene, theme } from "./scene/support";

vi.mock("~/lib/geo/regions/registry", () => ({
  loadRegionIndex: vi.fn(async () => ({})),
  loadRegionShapes: vi.fn(),
}));

const MANHATTAN: PlaceRegion = { set: "us-counties", id: "36061" };
const BROOKLYN: PlaceRegion = { set: "us-counties", id: "36047" };
const shapeOf = (id: string) =>
  counties.shapes.features.find((shape) => shape.properties.code === id);
const files = [{ shapeOf }];

beforeEach(() => {
  FakeMap.reset();
  vi.mocked(loadRegionIndex).mockClear();
  vi.mocked(loadRegionShapes).mockReset();
  vi.mocked(loadRegionShapes).mockImplementation(async () => files as never);
});
afterEach(expectNoUseAfterRemove);

const built = scene({ points: [{ lat: 40.78, lon: -73.97 }] });
const mount = (outline?: PlaceRegion, loaded = true) => {
  const fake = new FakeMap();
  fake.setStyle({ sources: built.sources, layers: built.style }, { diff: false });
  if (loaded) fake.loadStyle();
  const hook = renderHook(
    (props: { outline?: PlaceRegion; of: typeof built }) =>
      useMapOutline(fake.map, props.of, props.outline, theme),
    { initialProps: { outline, of: built } },
  );
  return { fake, ...hook };
};

describe("the outline of the place a view names, on a drawn map", () => {
  it("loads nothing and adds nothing for a map that asks for none", async () => {
    const { fake, result } = mount();
    await act(async () => {});
    expect(loadRegionIndex).not.toHaveBeenCalled();
    expect(loadRegionShapes).not.toHaveBeenCalled();
    expect(fake.addedSources.size).toBe(0);
    expect(result.current).toBe("");
  });

  it("draws the shape of the region as one line, under the names of the basemap", async () => {
    const { fake, result } = mount(MANHATTAN);
    await waitFor(() => expect(result.current).toBe("us-counties:36061"));
    expect(loadRegionShapes).toHaveBeenCalledWith(
      "us-counties",
      ["36061"],
      expect.anything(),
    );
    expect(fake.addedSources.get(OUTLINE_SOURCE)).toEqual({
      type: "geojson",
      data: shapeOf("36061"),
    });
    expect(fake.addedLayers).toEqual([
      {
        layer: expect.objectContaining({
          id: OUTLINE_LAYER,
          type: "line",
          paint: expect.objectContaining({ "line-color": theme.hover }),
        }),
        ...(built.overlayBefore ? { before: built.overlayBefore } : {}),
      },
    ]);
  });

  it("draws it again on a new style, and the region of a map that names another", async () => {
    const { fake, result, rerender } = mount(MANHATTAN);
    await waitFor(() => expect(result.current).toBe("us-counties:36061"));
    const next = scene({ points: [{ lat: 40.78, lon: -73.97 }] });
    fake.setStyle({ sources: next.sources, layers: next.style }, { diff: false });
    rerender({ outline: MANHATTAN, of: next });
    act(() => fake.loadStyle());
    expect(fake.addedSources.get(OUTLINE_SOURCE)).toBeTruthy();
    rerender({ outline: { ...MANHATTAN }, of: next });
    expect(loadRegionShapes).toHaveBeenCalledTimes(1);
    rerender({ outline: BROOKLYN, of: next });
    expect(result.current).toBe("");
    await waitFor(() => expect(result.current).toBe("us-counties:36047"));
    expect(fake.addedSources.get(OUTLINE_SOURCE)).toEqual({
      type: "geojson",
      data: shapeOf("36047"),
    });
  });

  it("draws nothing, and breaks nothing, for a region its set does not have or a file that does not load", async () => {
    const unknown = mount({ set: "us-counties", id: "99999" });
    await act(async () => {});
    expect(unknown.result.current).toBe("");
    expect(unknown.fake.addedLayers).toEqual([]);
    vi.mocked(loadRegionShapes).mockRejectedValue(new Error("no file"));
    const failed = mount(MANHATTAN);
    await act(async () => {});
    expect(failed.result.current).toBe("");
    expect(failed.fake.addedLayers).toEqual([]);
  });

  it("takes the outline away when the map no longer asks for it, and gives its handler back", async () => {
    const { fake, result, rerender, unmount } = mount(MANHATTAN);
    await waitFor(() => expect(result.current).toBe("us-counties:36061"));
    rerender({ outline: undefined, of: built });
    expect(result.current).toBe("");
    expect(fake.getLayer(OUTLINE_LAYER)).toBeFalsy();
    expect(fake.getSource(OUTLINE_SOURCE)).toBeFalsy();
    unmount();
    expect(fake.listeners("style.load")).toBe(0);
  });
});
