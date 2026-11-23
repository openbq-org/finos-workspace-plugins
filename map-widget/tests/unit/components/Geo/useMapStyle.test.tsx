import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Scene } from "~/components/Geo/scene/sceneTypes";
import { NOT_LOADED } from "~/components/Geo/sourceLayers";
import { SOURCE_FAILURES, useMapStyle } from "~/components/Geo/useMapStyle";
import type { MapViewState } from "~/lib/geo/mapViewState";
import { expectNoUseAfterRemove, FakeMap } from "./fakeMap";
import { held, scene } from "./scene/support";

afterEach(expectNoUseAfterRemove);

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const corners = [
  [-94, 42.1],
  [-93.5, 42.1],
  [-93.5, 41.9],
  [-94, 41.9],
];
const pictured = (id: string) =>
  scene({
    points: [{ lat: 42, lon: -93.7 }],
    layers: [{ id, kind: "image", image: { mime: "image/png", data: PNG, corners } }],
  });
const plain = () => scene({ points: [{ lat: 42, lon: -93.7 }] });
const withSource = () =>
  scene(
    {
      points: [{ lat: 1, lon: 1 }],
      layers: [{ id: "green", kind: "source", source: "ndvi" }],
    },
    { held: { sources: [held()], ambiguous: [] } },
  );

let made: string[] = [];
let revoked: string[] = [];
beforeEach(() => {
  FakeMap.reset();
  made = [];
  revoked = [];
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => {
      const url = `blob:test/${made.length}`;
      made.push(url);
      return url;
    },
    revokeObjectURL: (url: string) => void revoked.push(url),
  });
  vi.stubGlobal("location", window.location);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const mounted = (first: Scene | null, view: MapViewState = {}) => {
  const map = new FakeMap();
  const hook = renderHook(
    (props: { now: Scene | null; view: MapViewState; frame?: string }) =>
      useMapStyle(map.map, props.now, props.view, props.frame),
    { initialProps: { now: first, view, frame: undefined as string | undefined } },
  );
  return { map, hook };
};

describe("the style of a drawn map", () => {
  it("is set whole for each scene, with the sources and the layers of the scene", () => {
    const first = plain();
    const { map, hook } = mounted(first);
    expect(map.styles).toHaveLength(1);
    expect(map.styles[0].layers).toBe(first.style);
    expect(Object.keys(map.styles[0].sources)).toEqual(Object.keys(first.sources));
    expect(map.setMaxZoom).toHaveBeenLastCalledWith(first.maxZoom);
    hook.rerender({ now: first, view: { hidden: ["points"] }, frame: undefined });
    expect(map.styles).toHaveLength(1);
    const second = plain();
    hook.rerender({ now: second, view: {}, frame: undefined });
    expect(map.styles).toHaveLength(2);
    expect(map.styles[1].layers).toBe(second.style);
    expect(map.styleOptions).toEqual([{ diff: false }, { diff: false }]);
  });

  it("applies what the reader switched to the style of a second scene when that style loads", () => {
    const { map, hook } = mounted(plain(), { hidden: ["points"] });
    act(() => map.loadStyle());
    map.setLayoutProperty.mockClear();
    hook.rerender({ now: plain(), view: { hidden: ["points"] }, frame: undefined });
    expect(map.setLayoutProperty).not.toHaveBeenCalled();
    act(() => map.loadStyle());
    expect(map.setLayoutProperty).toHaveBeenCalledWith("points", "visibility", "none");
  });

  it("asks nothing of a map without a scene", () => {
    const { map, hook } = mounted(null);
    expect(map.styles).toHaveLength(0);
    expect(map.listeners()).toBe(0);
    expect(hook.result.current).toEqual([]);
  });

  it("applies what the reader switched once the style is loaded, and at every change after", () => {
    const built = plain();
    const { map, hook } = mounted(built, { hidden: ["points"] });
    expect(map.setLayoutProperty).not.toHaveBeenCalled();
    act(() => map.loadStyle());
    expect(map.setLayoutProperty).toHaveBeenCalledWith("points", "visibility", "none");
    hook.rerender({ now: built, view: {}, frame: undefined });
    expect(map.setLayoutProperty).toHaveBeenLastCalledWith(
      expect.any(String),
      "visibility",
      "visible",
    );
  });

  it("applies the view of now to a style that loads late, not the view of when it was set", () => {
    const built = plain();
    const { map, hook } = mounted(built, {});
    hook.rerender({ now: built, view: { hidden: ["points"] }, frame: undefined });
    act(() => map.loadStyle());
    expect(map.setLayoutProperty).toHaveBeenCalledWith("points", "visibility", "none");
  });

  it("gives back every handler when the map goes", () => {
    const { map, hook } = mounted(plain());
    expect(map.listeners("style.load")).toBe(1);
    expect(map.listeners("error")).toBe(1);
    expect(map.listeners("sourcedata")).toBe(1);
    hook.unmount();
    expect(map.listeners()).toBe(0);
  });

  it("holds one handler of each kind however often the scene changes", () => {
    const { map, hook } = mounted(plain());
    for (let at = 0; at < 5; at++)
      hook.rerender({ now: plain(), view: {}, frame: undefined });
    expect(map.listeners("style.load")).toBe(1);
    expect(map.listeners("error")).toBe(1);
    expect(map.listeners("sourcedata")).toBe(1);
  });
});

describe("the pictures of a map", () => {
  it("get an address of the page each when the style is set, in a source of the style", () => {
    const { map } = mounted(pictured("field"));
    expect(made).toEqual(["blob:test/0"]);
    expect(map.styles[0].sources["l:field"]).toEqual({
      type: "image",
      url: "blob:test/0",
      coordinates: corners,
    });
    expect(revoked).toEqual([]);
  });

  it("give back the addresses of the style before once the new one is set", () => {
    const { hook } = mounted(pictured("field"));
    hook.rerender({ now: pictured("field"), view: {}, frame: undefined });
    expect(made).toEqual(["blob:test/0", "blob:test/1"]);
    expect(revoked).toEqual(["blob:test/0"]);
    hook.rerender({ now: plain(), view: {}, frame: undefined });
    expect(made).toHaveLength(2);
    expect(revoked).toEqual(["blob:test/0", "blob:test/1"]);
  });

  it("give back every address when the map goes, and none twice", () => {
    const { hook } = mounted(pictured("field"));
    hook.rerender({ now: pictured("field"), view: {}, frame: undefined });
    hook.unmount();
    expect(revoked).toEqual(["blob:test/0", "blob:test/1"]);
    expect(new Set(revoked).size).toBe(made.length);
  });

  it("give back every address when the map of the library goes and the view stays (it shows its still), and make new ones for the next map", () => {
    const built = pictured("field");
    const first = new FakeMap();
    const hook = renderHook(
      ({ map }: { map: FakeMap | null }) =>
        useMapStyle(map?.map ?? null, built, {}, undefined),
      { initialProps: { map: first as FakeMap | null } },
    );
    expect(made).toEqual(["blob:test/0"]);
    hook.rerender({ map: null });
    expect(revoked).toEqual(["blob:test/0"]);
    const second = new FakeMap();
    hook.rerender({ map: second });
    expect(made).toEqual(["blob:test/0", "blob:test/1"]);
    expect(JSON.stringify(second.styles.at(-1)?.sources)).toContain("blob:test/1");
    expect(revoked).toEqual(["blob:test/0"]);
    hook.unmount();
    expect(revoked).toEqual(["blob:test/0", "blob:test/1"]);
  });

  it("make no address for a change of what the reader switched", () => {
    const built = pictured("field");
    const { hook } = mounted(built);
    hook.rerender({ now: built, view: { opacity: { field: 0.5 } }, frame: undefined });
    expect(made).toHaveLength(1);
    expect(revoked).toEqual([]);
  });
});

describe("a source of a backend that does not load", () => {
  const noted = (layers: { id: string; note?: string }[]) =>
    Object.fromEntries(layers.map((layer) => [layer.id, layer.note]));

  const fails = (map: FakeMap, times = 1, whole = false) => {
    for (let at = 0; at < times; at++)
      act(() =>
        map.fire("error", { sourceId: "l:green", ...(whole ? {} : { tile: {} }) }),
      );
  };
  const withFile = () =>
    scene(
      {
        points: [{ lat: 1, lon: 1 }],
        layers: [{ id: "green", kind: "source", source: "fields" }],
      },
      {
        held: {
          sources: [
            held({
              id: "fields",
              kind: "geojson",
              url: "https://data.example/fields.geojson",
              layers: [{ type: "fill", color: "#aabbcc" }],
            }),
          ],
          ambiguous: [],
        },
      },
    );

  it("is said on its layer after three tiles in a row failed, once, and the other layers stay as they are", () => {
    const built = withSource();
    const { map, hook } = mounted(built);
    expect(noted(hook.result.current)).toEqual({ points: undefined, green: undefined });
    const before = hook.result.current;
    fails(map, SOURCE_FAILURES - 1);
    expect(hook.result.current).toBe(before);
    fails(map);
    expect(noted(hook.result.current)).toEqual({
      points: undefined,
      green: NOT_LOADED,
    });
    expect(hook.result.current[0]).toBe(before[0]);
    const said = hook.result.current;
    fails(map);
    expect(hook.result.current).toBe(said);
  });

  it("is not said while tiles of the source still load between the failures", () => {
    const { map, hook } = mounted(withSource());
    const before = hook.result.current;
    for (let round = 0; round < 4; round++) {
      fails(map, SOURCE_FAILURES - 1);
      act(() => map.fire("sourcedata", { sourceId: "l:green", tile: {} }));
    }
    expect(hook.result.current).toBe(before);
  });

  it("is no longer said once the source loads a tile again", () => {
    const { map, hook } = mounted(withSource());
    fails(map, SOURCE_FAILURES);
    expect(noted(hook.result.current).green).toBe(NOT_LOADED);
    act(() =>
      map.fire("sourcedata", { sourceId: "l:green", sourceDataType: "metadata" }),
    );
    act(() =>
      map.fire("sourcedata", { sourceId: "l:green", sourceDataType: "content" }),
    );
    act(() => map.fire("sourcedata", { sourceId: "basemap", tile: {} }));
    expect(noted(hook.result.current).green).toBe(NOT_LOADED);
    act(() => map.fire("sourcedata", { sourceId: "l:green", tile: {} }));
    expect(noted(hook.result.current).green).toBeUndefined();
    fails(map, SOURCE_FAILURES - 1);
    expect(noted(hook.result.current).green).toBeUndefined();
  });

  it("is said of a file at its one request, and no longer once the file is read", () => {
    const { map, hook } = mounted(withFile());
    fails(map, 1, true);
    expect(noted(hook.result.current).green).toBe(NOT_LOADED);
    act(() =>
      map.fire("sourcedata", { sourceId: "l:green", sourceDataType: "metadata" }),
    );
    expect(noted(hook.result.current).green).toBe(NOT_LOADED);
    act(() =>
      map.fire("sourcedata", { sourceId: "l:green", sourceDataType: "content" }),
    );
    expect(noted(hook.result.current).green).toBeUndefined();
  });

  it("is not said of a new scene: the source is tried again with its style", () => {
    const { map, hook } = mounted(withSource());
    fails(map, SOURCE_FAILURES);
    hook.rerender({ now: withSource(), view: {}, frame: undefined });
    expect(noted(hook.result.current).green).toBeUndefined();
    fails(map, SOURCE_FAILURES - 1);
    expect(noted(hook.result.current).green).toBeUndefined();
  });
});
