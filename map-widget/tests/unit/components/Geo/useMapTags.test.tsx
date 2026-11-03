import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { groupedLayers, shownMarks } from "~/components/Geo/applyMapView";
import * as mapSigns from "~/components/Geo/mapSigns";
import * as mapTags from "~/components/Geo/mapTags";
import type { Scene } from "~/components/Geo/scene/sceneTypes";
import { FADE_ZOOM, SETTLE_MS, useMapTags } from "~/components/Geo/useMapTags";
import type { MapNotes } from "~/lib/geo/mapNotes";
import { expectNoUseAfterRemove, FakeMap } from "./fakeMap";
import { scene } from "./scene/support";

afterEach(expectNoUseAfterRemove);

vi.mock("~/components/Geo/mapSigns", async (original) => {
  const real = await original<typeof import("~/components/Geo/mapSigns")>();
  return { ...real, emphasisFirst: vi.fn(real.emphasisFirst) };
});

const PLAIN = {
  points: [
    { lat: -10, lon: 20, tag: "north" },
    { lat: -30, lon: 40, tag: "south", marker: "star" },
    { lat: -20, lon: 60 },
  ],
};
const CLUSTERED = {
  layers: [
    {
      id: "c",
      kind: "clusters",
      points: [
        { lat: -10, lon: 20, tag: "one" },
        { lat: -30, lon: 40, tag: "two" },
      ],
    },
  ],
};

const layers = new WeakMap<object, HTMLElement>();
const tagLayerOf = (map: object) => layers.get(map) as HTMLElement;

const mounted = (raw: unknown, notes: MapNotes = {}, crowded: string[] = []) => {
  const built = scene(raw);
  const map = new FakeMap();
  Object.defineProperties(map.container, {
    clientWidth: { value: 900 },
    clientHeight: { value: 500 },
  });
  map.setStyle({ sources: built.sources, layers: built.style });
  map.loadStyle();
  const tagLayer = { current: document.createElement("div") };
  const markerLayer = { current: document.createElement("div") };
  const shown = shownMarks(built, {}, undefined);
  const grouped = groupedLayers(built, {}, new Set(crowded));
  const hidden = vi.fn();
  const hook = renderHook(
    (props: { now: Scene | null; notes: MapNotes }) =>
      useMapTags({
        map: map.map,
        scene: props.now,
        notes: props.notes,
        heading: false,
        shown,
        grouped,
        legends: 0,
        controls: 5,
        tagLayer,
        markerLayer,
        onHidden: hidden,
      }),
    { initialProps: { now: built as Scene | null, notes } },
  );
  layers.set(map, tagLayer.current);
  const tags = () => [...tagLayer.current.children].map((chip) => chip.textContent);
  const places = () =>
    [...tagLayer.current.children].map((chip) => (chip as HTMLElement).style.transform);
  return { map, built, hook, tags, places, hidden, signs: markerLayer.current };
};

beforeEach(() => {
  FakeMap.reset();
  vi.mocked(mapSigns.emphasisFirst).mockClear();
});

describe("the tags and the signs of a drawn map", () => {
  it("are drawn where their marks are, the marked ones first", () => {
    const { tags, signs } = mounted(PLAIN);
    expect(tags()).toEqual(["south", "north"]);
    expect(signs.childElementCount).toBe(1);
  });

  it("follow the map at every move", () => {
    const { map, places } = mounted(PLAIN);
    const before = places();
    map.origin = { x: 50, y: 20 };
    map.fire("move");
    expect(places()).not.toEqual(before);
    expect(places()).toHaveLength(2);
  });

  it("moves what is drawn at a move and places nothing: the tags are placed when the map has rested", () => {
    vi.useFakeTimers();
    const place = vi.spyOn(mapTags, "placeTags");
    const { map, places, tags, signs, hidden } = mounted(PLAIN);
    const [before, chips, badges] = [
      places(),
      [...tags()],
      [...signs.children].map((badge) => (badge as HTMLElement).style.transform),
    ];
    place.mockClear();
    hidden.mockClear();
    for (let frame = 1; frame <= 30; frame++) {
      map.origin = { x: frame * 3, y: frame };
      map.fire("move");
    }
    expect(place).not.toHaveBeenCalled();
    expect(hidden).not.toHaveBeenCalled();
    expect(tags()).toEqual(chips);
    expect(places()).not.toEqual(before);
    expect(
      [...signs.children].map((badge) => (badge as HTMLElement).style.transform),
    ).not.toEqual(badges);
    vi.advanceTimersByTime(SETTLE_MS - 1);
    expect(place).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(place).toHaveBeenCalledTimes(1);
    expect(hidden).toHaveBeenCalledTimes(1);
    place.mockRestore();
    vi.useRealTimers();
  });

  it("keeps a tag at the same distance from its mark while the map moves", () => {
    const { map, places } = mounted(PLAIN);
    const at = (transform: string) =>
      transform.match(/-?\d+/g)?.map(Number) as [number, number];
    const before = places().map(at);
    map.origin = { x: 40, y: -25 };
    map.fire("move");
    expect(places().map(at)).toEqual(before.map(([x, y]) => [x + 40, y - 25]));
  });

  it("fades the tags while the zoom is far from the zoom they were placed at, until they are placed again", () => {
    vi.useFakeTimers();
    const { map, hook } = mounted(PLAIN);
    const layer = () => tagLayerOf(map);
    expect(hook.result.current).toBeUndefined();
    expect(layer().style.opacity).toBe("");
    map.zoom += FADE_ZOOM / 2;
    map.fire("move");
    expect(layer().style.opacity).toBe("");
    map.zoom += FADE_ZOOM;
    map.fire("move");
    expect(layer().style.opacity).toBe("0.45");
    vi.advanceTimersByTime(SETTLE_MS);
    expect(layer().style.opacity).toBe("");
    vi.useRealTimers();
  });

  it("places nothing after the map went: the wait for its rest ends with it", () => {
    vi.useFakeTimers();
    const place = vi.spyOn(mapTags, "placeTags");
    const { map, hook } = mounted(PLAIN);
    map.fire("move");
    place.mockClear();
    hook.unmount();
    vi.advanceTimersByTime(SETTLE_MS * 2);
    expect(place).not.toHaveBeenCalled();
    place.mockRestore();
    vi.useRealTimers();
  });

  it("show the tag of the user beside the tag of the data", () => {
    const { built, tags } = mounted(PLAIN, {});
    const key = built.marks[2].key as string;
    const noted = mounted(PLAIN, { [key]: "mine" });
    expect(tags()).toEqual(["south", "north"]);
    expect(noted.tags()).toEqual(["mine", "south", "north"]);
  });

  it("orders the marks once for a map and its tags, not at every move", () => {
    const { map, hook, built } = mounted(PLAIN);
    expect(mapSigns.emphasisFirst).toHaveBeenCalledTimes(1);
    for (let frame = 0; frame < 30; frame++) map.fire("move");
    map.fire("resize");
    expect(mapSigns.emphasisFirst).toHaveBeenCalledTimes(1);
    hook.rerender({ now: built, notes: { [built.marks[0].key as string]: "x" } });
    expect(mapSigns.emphasisFirst).toHaveBeenCalledTimes(2);
  });

  it("gives back every handler when the map goes", () => {
    const plain = mounted(PLAIN);
    expect(plain.map.listeners()).toBe(2);
    plain.hook.unmount();
    expect(plain.map.listeners()).toBe(0);
    const clustered = mounted(CLUSTERED);
    expect(clustered.map.listeners("idle")).toBe(1);
    clustered.hook.unmount();
    expect(clustered.map.listeners()).toBe(0);
  });
});

describe("the tags of a layer of clusters", () => {
  const single = (index: number) => ({
    layer: { id: "l:c" },
    properties: { i: index },
  });

  it("are those of the points that are drawn as points, read when the map has drawn them", () => {
    const { map, tags } = mounted(CLUSTERED);
    expect(tags()).toEqual([]);
    map.drawn = [single(1)];
    map.fire("idle");
    expect(tags()).toEqual(["two"]);
    map.drawn = [single(0), single(1)];
    map.fire("idle");
    expect(tags()).toEqual(["one", "two"]);
  });

  it("asks the map which points are single when it is idle, not at every move", () => {
    const { map, tags } = mounted(CLUSTERED);
    map.drawn = [single(1)];
    map.fire("idle");
    const asked = map.queries;
    map.drawn = [single(0), single(1)];
    for (let frame = 0; frame < 30; frame++) map.fire("move");
    expect(map.queries).toBe(asked);
    expect(tags()).toEqual(["two"]);
    map.fire("idle");
    expect(map.queries).toBe(asked + 1);
    expect(tags()).toEqual(["one", "two"]);
  });

  it("asks the map nothing on a map without clusters", () => {
    const { map } = mounted(PLAIN);
    for (let frame = 0; frame < 5; frame++) map.fire("move");
    expect(map.queries).toBe(0);
    expect(map.listeners("idle")).toBe(0);
  });
});

describe("the tags of a layer of points whose close points are grouped", () => {
  const CROWD = {
    points: [
      { lat: -10, lon: 20 },
      { lat: -10.01, lon: 20 },
      { lat: -30, lon: 40, tag: "top", marker: 1 },
    ],
  };
  const NOTES = { "p:-10.0000,20.0000": "one", "p:-10.0100,20.0000": "two" };
  const drawn = (layer: string, index: number) => ({
    layer: { id: layer },
    properties: { i: index },
  });

  it("are all there while the layer is apart, and nothing is asked of the map", () => {
    const { map, tags } = mounted(CROWD, NOTES);
    expect(tags()).toEqual(["one", "two", "top"]);
    expect(map.queries).toBe(0);
    expect(map.listeners("idle")).toBe(0);
  });

  it("are those of the points no circle holds, and of the points the answer singles out", () => {
    const { map, tags, signs } = mounted(CROWD, NOTES, ["points"]);
    map.drawn = [drawn("points-apart", 2)];
    map.fire("idle");
    expect(tags()).toEqual(["top"]);
    expect(signs.childElementCount).toBe(1);
    map.drawn = [drawn("points-apart", 2), drawn("points", 0), drawn("points", 1)];
    map.fire("idle");
    expect(tags()).toEqual(["one", "two", "top"]);
  });

  it("are all there for a few points the map tags itself: none of them is in a circle", () => {
    const tagged = {
      points: [
        { lat: -10, lon: 20, tag: "one" },
        { lat: -10.01, lon: 20, tag: "two" },
        { lat: -30, lon: 40 },
        { lat: -30.01, lon: 40 },
      ],
    };
    const { map, built, tags } = mounted(tagged, {}, ["points"]);
    expect(built.clustered[0].kept).toBe("points-apart");
    map.drawn = [drawn("points-apart", 0), drawn("points-apart", 1)];
    map.fire("idle");
    expect(tags()).toEqual(["one", "two"]);
  });
});

describe("the tags that are not shown", () => {
  it("are counted: those with no free place, and those of points inside a circle", () => {
    const pile = {
      points: Array.from({ length: 40 }, (_, at) => ({
        lat: -10,
        lon: 20,
        tag: `Plantation ${at}`,
        marker: "star",
      })),
    };
    const piled = mounted(pile);
    expect(piled.tags().length).toBeLessThan(10);
    expect(piled.hidden).toHaveBeenLastCalledWith(40 - piled.tags().length);
    expect(mounted(PLAIN).hidden).toHaveBeenLastCalledWith(0);
  });

  it("counts the tag of a point that is inside a circle of grouped points", () => {
    const crowd = {
      points: [
        { lat: -10, lon: 20 },
        { lat: -10.01, lon: 20 },
        { lat: -30, lon: 40 },
      ],
    };
    const { map, tags, hidden } = mounted(
      crowd,
      {
        "p:-10.0000,20.0000": "one",
        "p:-10.0100,20.0000": "two",
        "p:-30.0000,40.0000": "apart",
      },
      ["points"],
    );
    map.drawn = [{ layer: { id: "points" }, properties: { i: 2 } }];
    map.fire("idle");
    expect(tags()).toEqual(["apart"]);
    expect(hidden).toHaveBeenLastCalledWith(2);
  });

  it("does not count the tags inside the circles of a layer of clusters: that is what the layer is", () => {
    const { map, hidden } = mounted(CLUSTERED);
    map.drawn = [];
    map.fire("idle");
    expect(hidden).toHaveBeenLastCalledWith(0);
  });
});

describe("the boxes of the legend, the slider and the credit that no tag covers", () => {
  afterEach(() => vi.mocked(Element.prototype.getBoundingClientRect).mockRestore());
  const withLegend = () => {
    const measured = vi.spyOn(Element.prototype, "getBoundingClientRect");
    const made = mounted(PLAIN);
    const box = document.createElement("div");
    box.append(made.map.container);
    const legend = document.createElement("div");
    legend.setAttribute("data-map-legend", "");
    box.append(legend);
    return { ...made, measured, legend };
  };

  it("are not measured at a move: a measure after the tags were moved lays the page out again", () => {
    const { map, measured, places } = withLegend();
    map.fire("resize");
    const read = measured.mock.calls.length;
    expect(read).toBeGreaterThan(0);
    const before = places();
    for (let frame = 0; frame < 60; frame++) {
      map.origin = { x: frame, y: 0 };
      map.fire("move");
    }
    expect(measured.mock.calls.length).toBe(read);
    expect(places()).not.toEqual(before);
  });

  it("are measured again when the box of the map changes its size, and keep a tag off the legend", () => {
    const { map, measured, legend, tags } = withLegend();
    measured.mockImplementation(function (this: Element) {
      return (
        this === legend
          ? { left: 0, top: 0, right: 900, bottom: 500 }
          : { left: 0, top: 0, right: 0, bottom: 0 }
      ) as DOMRect;
    });
    map.fire("move");
    expect(tags()).toEqual(["south", "north"]);
    map.fire("resize");
    expect(tags()).toEqual([]);
  });
});
