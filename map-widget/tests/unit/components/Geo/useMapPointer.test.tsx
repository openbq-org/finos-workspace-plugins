import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Scene } from "~/components/Geo/scene/sceneTypes";
import { cardPlace, useMapPointer } from "~/components/Geo/useMapPointer";
import { mapSpec } from "~/lib/geo/mapSpec";
import {
  type DrawnFeature,
  expectNoUseAfterRemove,
  FakeMap,
  pointerAt,
} from "./fakeMap";
import { scene } from "./scene/support";

afterEach(expectNoUseAfterRemove);

const RAW = {
  points: [
    { lat: 40, lon: -100, label: "Alpha" },
    { lat: 30, lon: -90, label: "Beta" },
  ],
  layers: [
    {
      id: "c",
      kind: "clusters",
      points: [
        { lat: 1, lon: 1 },
        { lat: 2, lon: 2 },
      ],
    },
  ],
};
const spec = mapSpec(RAW);
const mark = (index: number): DrawnFeature => ({
  layer: { id: "points" },
  properties: { i: index },
});

const mounted = (more: { wheelZooms?: boolean; built?: Scene } = {}) => {
  const built = more.built ?? scene(RAW);
  const map = new FakeMap();
  Object.defineProperties(map.container, {
    clientWidth: { value: 900 },
    clientHeight: { value: 500 },
  });
  map.setStyle({ sources: built.sources, layers: built.style });
  map.loadStyle();
  const card = document.createElement("div");
  let renders = 0;
  const hook = renderHook(
    ({ now }) => {
      renders += 1;
      return useMapPointer(map.map, now, spec, more.wheelZooms);
    },
    { initialProps: { now: built as Scene | null } },
  );
  act(() => hook.result.current.cardRef(card));
  return {
    map,
    built,
    card,
    hook,
    renders: () => renders,
    over: (x: number, y: number, drawn: DrawnFeature[]) => {
      map.drawn = drawn;
      act(() => map.fire("mousemove", pointerAt(x, y)));
    },
    click: (x: number, y: number, drawn: DrawnFeature[]) => {
      map.drawn = drawn;
      act(() => map.fire("click", pointerAt(x, y)));
    },
  };
};

beforeEach(() => FakeMap.reset());

describe("where the card of a mark goes", () => {
  it("is beside the pointer, on the side of it that has room", () => {
    expect(cardPlace({ x: 100, y: 100 }, 900, 500)).toEqual({ left: 114, top: 114 });
    expect(cardPlace({ x: 800, y: 450 }, 900, 500)).toEqual({ left: 562, top: 304 });
    expect(cardPlace({ x: 10, y: 10 }, 100, 100)).toEqual({ left: 4, top: 4 });
  });
});

describe("the mark under the pointer", () => {
  it("changes the state only when the pointer comes over another mark", () => {
    const { hook, renders, over, map } = mounted();
    expect(hook.result.current.hover).toBeNull();
    over(100, 100, [mark(0)]);
    expect(hook.result.current.hover).toBe(0);
    const after = renders();
    for (let step = 1; step <= 20; step++) over(100 + step, 100 + step, [mark(0)]);
    expect(renders()).toBe(after);
    expect(hook.result.current.hover).toBe(0);
    over(200, 100, [mark(1)]);
    expect(hook.result.current.hover).toBe(1);
    expect(renders()).toBe(after + 1);
    act(() => map.fire("mouseout"));
    expect(hook.result.current.hover).toBeNull();
  });

  it("moves the card with the pointer without a render", () => {
    const { card, over, renders } = mounted();
    over(100, 100, [mark(0)]);
    expect(card.style.transform).toBe("translate(114px, 114px)");
    const after = renders();
    over(130, 150, [mark(0)]);
    expect(card.style.transform).toBe("translate(144px, 164px)");
    expect(renders()).toBe(after);
  });

  it("asks the map once for each event", () => {
    const { map, over, click } = mounted();
    over(100, 100, [mark(0)]);
    expect(map.queries).toBe(1);
    over(101, 100, []);
    expect(map.queries).toBe(2);
    click(101, 100, [mark(1)]);
    expect(map.queries).toBe(3);
    click(300, 300, []);
    expect(map.queries).toBe(4);
  });

  it("shows a hand over a mark and over a cluster, and nowhere else", () => {
    const { map, over, hook } = mounted();
    over(100, 100, [mark(0)]);
    expect(map.canvas.style.cursor).toBe("pointer");
    over(100, 100, []);
    expect(map.canvas.style.cursor).toBe("");
    over(100, 100, [{ layer: { id: "l:c-clusters" }, properties: { cluster_id: 7 } }]);
    expect(map.canvas.style.cursor).toBe("pointer");
    expect(hook.result.current.hover).toBeNull();
  });

  it("reads no mark the scene does not have", () => {
    const { over, hook } = mounted();
    over(100, 100, [mark(99)]);
    expect(hook.result.current.hover).toBeNull();
    over(100, 100, [{ layer: { id: "points" }, properties: { i: "0" } }]);
    expect(hook.result.current.hover).toBeNull();
  });
});

describe("a click on the map", () => {
  it("pins the mark under it, and a click beside every mark lets it go", () => {
    const { hook, click, card } = mounted();
    click(100, 100, [mark(1)]);
    expect(hook.result.current.pinned).toBe(1);
    expect(card.style.transform).toBe("translate(114px, 114px)");
    click(400, 300, []);
    expect(hook.result.current.pinned).toBeNull();
  });

  it("keeps the card of a pinned mark where it is while the pointer is over another", () => {
    const { hook, click, over, card } = mounted();
    click(100, 100, [mark(1)]);
    over(300, 200, [mark(0)]);
    expect(hook.result.current.pinned).toBe(1);
    expect(hook.result.current.hover).toBe(0);
    expect(card.style.transform).toBe("translate(114px, 114px)");
  });

  it("moves the card of a pinned mark with the map, without a render", () => {
    const { map, click, card, renders, hook } = mounted();
    click(100, 100, [mark(1)]);
    const after = renders();
    map.origin = { x: 1000, y: 600 };
    for (let frame = 0; frame < 10; frame++) act(() => map.fire("move"));
    expect(card.style.transform).toBe("translate(114px, 314px)");
    expect(renders()).toBe(after);
    expect(hook.result.current.pinned).toBe(1);
  });

  it("says that the wheel is meant for the map, until the pointer leaves it", () => {
    const { map, click } = mounted();
    click(100, 100, []);
    expect(map.cooperativeGestures.disable).toHaveBeenCalledTimes(1);
    expect(map.cooperativeGestures.enable).not.toHaveBeenCalled();
    map.container.dispatchEvent(new MouseEvent("mouseleave"));
    expect(map.cooperativeGestures.enable).toHaveBeenCalledTimes(1);
  });

  it("leaves the wheel to a map that was opened large when the pointer leaves", () => {
    const { map, click } = mounted({ wheelZooms: true });
    click(100, 100, []);
    map.container.dispatchEvent(new MouseEvent("mouseleave"));
    expect(map.cooperativeGestures.enable).not.toHaveBeenCalled();
  });

  it("zooms to where a cluster splits, no further than the map goes, and pins nothing", async () => {
    const { map, click, hook } = mounted();
    click(100, 100, [mark(0)]);
    map.maxZoom = 8;
    click(200, 200, [
      {
        layer: { id: "l:c-clusters" },
        properties: { cluster_id: 7 },
        geometry: { type: "Point", coordinates: [-95, 35] },
      },
    ]);
    expect(hook.result.current.pinned).toBeNull();
    expect(map.expansionZoom).toHaveBeenCalledWith(7);
    await act(async () => {});
    expect(map.easeTo).toHaveBeenCalledWith({ center: [-95, 35], zoom: 8 });
  });

  it("stays as it is when the cluster is gone before the map answers", async () => {
    const { map, click } = mounted();
    map.expansionZoom.mockRejectedValueOnce(new Error("no cluster"));
    click(200, 200, [
      {
        layer: { id: "l:c-clusters" },
        properties: { cluster_id: 7 },
        geometry: { type: "Point", coordinates: [-95, 35] },
      },
    ]);
    expect(map.expansionZoom).toHaveBeenCalledWith(7);
    await act(async () => {});
    expect(map.easeTo).not.toHaveBeenCalled();
  });
});

describe("the life of the handlers of the pointer", () => {
  it("closes the cards of a scene that is replaced", () => {
    const { hook, click, over } = mounted();
    click(100, 100, [mark(1)]);
    over(100, 100, [mark(0)]);
    hook.rerender({ now: scene(RAW) });
    expect(hook.result.current.pinned).toBeNull();
    expect(hook.result.current.hover).toBeNull();
  });

  it("gives back every handler when the map goes, also the one of its box", () => {
    const { map, hook, click } = mounted();
    expect(map.listeners()).toBe(4);
    hook.unmount();
    expect(map.listeners()).toBe(0);
    map.container.dispatchEvent(new MouseEvent("mouseleave"));
    expect(map.cooperativeGestures.enable).not.toHaveBeenCalled();
    const empty = mounted({ built: undefined });
    empty.hook.rerender({ now: null });
    expect(empty.map.listeners()).toBe(0);
    expect(click).toBeTypeOf("function");
  });
});

describe("a circle of grouped points under the pointer", () => {
  const stores = Array.from({ length: 12 }, (_, at) => ({
    lat: 40 + at * 0.01,
    lon: -100,
    size: at + 1,
  }));
  const group = (properties: Record<string, unknown>): DrawnFeature => ({
    layer: { id: "points-groups" },
    properties,
  });

  it("says how many places it holds and, of bubbles, the sum of what they are sized by", () => {
    const { hook, over } = mounted({ built: scene({ points: stores }) });
    over(100, 100, [group({ cluster_id: 3, point_count: 7, total: 28 })]);
    expect(hook.result.current.hover).toBeNull();
    expect(hook.result.current.group).toMatchObject({
      layer: "points",
      count: 7,
      total: 28,
    });
    over(300, 300, []);
    expect(hook.result.current.group).toBeNull();
  });

  it("has no sum for points that are not sized, and is nothing while a mark is under the pointer", () => {
    const plain = stores.map(({ lat, lon }) => ({ lat, lon }));
    const { hook, over } = mounted({ built: scene({ points: plain }) });
    over(100, 100, [group({ cluster_id: 3, point_count: 7 })]);
    expect(hook.result.current.group).toEqual({
      layer: "points",
      count: 7,
      at: expect.any(Array),
    });
    over(100, 100, [mark(0), group({ cluster_id: 3, point_count: 7 })]);
    expect(hook.result.current.hover).toBe(0);
    expect(hook.result.current.group).toBeNull();
  });

  it("is not said of a layer of clusters: that layer is always in circles, and its count is on them", () => {
    const { hook, over } = mounted();
    over(100, 100, [
      { layer: { id: "l:c-clusters" }, properties: { cluster_id: 7, point_count: 2 } },
    ]);
    expect(hook.result.current.group).toBeNull();
  });
});
