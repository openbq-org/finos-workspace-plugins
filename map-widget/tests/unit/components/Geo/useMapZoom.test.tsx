import { act, renderHook } from "@testing-library/react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useMapZoom, useZoomEnd } from "~/components/Geo/useMapZoom";
import { expectNoUseAfterRemove, FakeMap } from "./fakeMap";

afterEach(expectNoUseAfterRemove);

beforeEach(() => FakeMap.reset());

describe("the zoom of a drawn map, as a whole number", () => {
  const mounted = (zoom: number) => {
    const map = new FakeMap();
    map.zoom = zoom;
    let renders = 0;
    const hook = renderHook(
      ({ now }: { now: MapLibreMap | null }) => {
        renders += 1;
        return useMapZoom(now);
      },
      { initialProps: { now: map.map as MapLibreMap | null } },
    );
    const to = (next: number) => {
      map.zoom = next;
      act(() => map.fire("zoom"));
    };
    return { map, hook, to, renders: () => renders };
  };

  it("is the zoom of the map when the map is there, and zero before", () => {
    expect(mounted(12.7).hook.result.current).toBe(12);
    expect(renderHook(() => useMapZoom(null)).result.current).toBe(0);
  });

  it("changes when the map crosses a zoom, not at every frame of a gesture", () => {
    const { hook, to, renders } = mounted(12.1);
    const before = renders();
    for (let frame = 0; frame < 60; frame++) to(12.2 + frame / 100);
    expect(hook.result.current).toBe(12);
    expect(renders() - before).toBeLessThanOrEqual(1);
    to(13.01);
    expect(hook.result.current).toBe(13);
    to(11.5);
    expect(hook.result.current).toBe(11);
  });

  it("gives its handler back when the map goes, and to a map that is replaced", () => {
    const { map, hook } = mounted(3);
    expect(map.listeners("zoom")).toBe(1);
    const next = new FakeMap();
    next.zoom = 8.2;
    hook.rerender({ now: next.map });
    expect(map.listeners()).toBe(0);
    expect(hook.result.current).toBe(8);
    hook.unmount();
    expect(next.listeners()).toBe(0);
  });
});

describe("whether a drawn map is as near as it goes", () => {
  const mounted = (zoom: number, maxZoom: number | undefined) => {
    const map = new FakeMap();
    map.zoom = zoom;
    const hook = renderHook(
      ({ limit }: { limit: number | undefined }) =>
        useZoomEnd(map.map as MapLibreMap, limit),
      { initialProps: { limit: maxZoom } },
    );
    const to = (next: number) => {
      map.zoom = next;
      act(() => map.fire("zoom"));
    };
    return { map, hook, to };
  };

  it("is true at the limit of the map, also a fraction short of it, and false further out", () => {
    const { hook, to } = mounted(7, 9);
    expect(hook.result.current).toBe(false);
    to(8.995);
    expect(hook.result.current).toBe(true);
    to(8.5);
    expect(hook.result.current).toBe(false);
  });

  it("follows a limit that changes under a map that did not move: another backdrop, other marks", () => {
    const { hook } = mounted(9, 9);
    expect(hook.result.current).toBe(true);
    hook.rerender({ limit: 14 });
    expect(hook.result.current).toBe(false);
    hook.rerender({ limit: 7 });
    expect(hook.result.current).toBe(true);
  });

  it("says nothing before the map has a scene, and gives its handler back", () => {
    const { map, hook } = mounted(9, undefined);
    expect(hook.result.current).toBe(false);
    expect(map.listeners("zoom")).toBe(0);
    hook.rerender({ limit: 9 });
    expect(map.listeners("zoom")).toBe(1);
    hook.unmount();
    expect(map.listeners()).toBe(0);
  });
});
