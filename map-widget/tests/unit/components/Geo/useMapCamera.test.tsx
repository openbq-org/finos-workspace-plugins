import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COLUMN_MAX_PITCH, useMapCamera } from "~/components/Geo/useMapCamera";
import { MAP_LIMITS } from "~/lib/codemode/limits";
import { expectNoUseAfterRemove, FakeMap } from "./fakeMap";

beforeEach(() => FakeMap.reset());
afterEach(expectNoUseAfterRemove);

const fakeMap = (width: number, height: number) => {
  const fake = new FakeMap();
  Object.defineProperties(fake.container, {
    clientWidth: { value: width, configurable: true },
    clientHeight: { value: height, configurable: true },
  });
  return { map: fake.map, fake, fitBounds: fake.fitBounds };
};
const paddingOf = (
  size: [number, number],
  more: { legend: boolean; legendList?: boolean; slider?: "wide" | "compact" | null },
) => {
  const { map, fitBounds } = fakeMap(...size);
  renderHook(() =>
    useMapCamera({
      map,
      bounds: [-125, 24, -66, 50],
      detailZoom: 6,
      heading: true,
      tilted: false,
      ...more,
    }),
  );
  return fitBounds.mock.calls[0][1].padding as { bottom: number; left: number };
};
const bottomOf = (...given: Parameters<typeof paddingOf>) => paddingOf(...given).bottom;

describe("the room a map leaves under its data", () => {
  it("is the room of the legend, and little without one", () => {
    expect(bottomOf([900, 500], { legend: true })).toBe(68);
    expect(bottomOf([900, 500], { legend: false })).toBe(24);
  });

  it("is the room of the time slider on a map without a legend", () => {
    expect(bottomOf([900, 500], { legend: false, slider: "wide" })).toBe(68);
    expect(bottomOf([900, 500], { legend: true, slider: "wide" })).toBe(68);
  });

  it("is the legend and the slider above it on a small map", () => {
    const plain = bottomOf([330, 290], { legend: true });
    expect(bottomOf([330, 290], { legend: true, slider: "compact" })).toBe(plain + 36);
    expect(bottomOf([330, 290], { legend: false, slider: "compact" })).toBeGreaterThan(
      bottomOf([330, 290], { legend: false }),
    );
  });

  it("is beside a legend of several layers on a wide, low map, and under it elsewhere", () => {
    expect(paddingOf([800, 350], { legend: true, legendList: true }).left).toBe(208);
    expect(paddingOf([800, 350], { legend: true }).left).toBe(28);
    expect(paddingOf([700, 600], { legend: true, legendList: true }).left).toBe(28);
    expect(paddingOf([500, 200], { legend: true, legendList: true }).left).toBeLessThan(
      30,
    );
  });
});

describe("a map that opens on its marks, with its parts measured where they stand", () => {
  const at = (left: number, top: number, right: number, bottom: number) =>
    ({
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
  type Box = [number, number, number, number];
  type Part = { box: Box; line?: true };
  const x = (lon: number) => ((lon + 180) / 360) * 512;
  const y = (lat: number) => {
    const sin = Math.sin((lat * Math.PI) / 180);
    return (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * 512;
  };
  const opened = ([width, height]: [number, number], bounds: Box, parts: Part[]) => {
    const { map, fake, fitBounds } = fakeMap(width, height);
    const frame = document.createElement("div");
    frame.appendChild(fake.container);
    fake.container.getBoundingClientRect = () => at(0, 0, width, height);
    for (const { box, line } of parts) {
      const part = document.createElement("div");
      part.setAttribute("data-map-overlay", line ? "line" : "");
      part.getBoundingClientRect = () => at(...box);
      frame.appendChild(part);
    }
    renderHook(() =>
      useMapCamera({
        map,
        bounds,
        reach: 22,
        detailZoom: 6,
        heading: true,
        noted: true,
        legend: true,
        tilted: false,
      }),
    );
    const options = fitBounds.mock.calls[0][1] as {
      padding: { top: number; bottom: number; left: number; right: number };
      maxZoom: number;
    };
    const { top, bottom, left, right } = options.padding;
    const [west, south, east, north] = bounds;
    const across = x(east) - x(west);
    const down = y(south) - y(north);
    const scale = Math.min(
      2 ** options.maxZoom,
      (width - left - right) / across,
      (height - top - bottom) / down,
    );
    return {
      ...options,
      spans: [(across * scale) / width, (down * scale) / height],
      off: [
        Math.abs(left + (width - left - right) / 2 - width / 2) / width,
        Math.abs(top + (height - top - bottom) / 2 - height / 2) / height,
      ],
    };
  };

  const DOCKED: [number, number] = [750, 330];
  const TITLE: Part = { box: [8, 8, 140, 28] };
  const LONG_LINE: Part = { box: [8, 30, 694, 50], line: true };
  const LEGEND: Part = { box: [8, 270, 200, 300] };
  const CONTROLS: Part = { box: [700, 8, 742, 178] };
  const PARTS = [TITLE, LONG_LINE, LEGEND, CONTROLS];
  const TALL: Box = [129, 30, 142, 45];

  const expectFilled = (
    { spans, off }: ReturnType<typeof opened>,
    binding: "width" | "height",
  ) => {
    expect(spans[binding === "width" ? 0 : 1]).toBeGreaterThanOrEqual(0.6);
    expect(off[0]).toBeLessThanOrEqual(0.15);
    expect(off[1]).toBeLessThanOrEqual(0.15);
  };

  it("fills a docked map with a tall cluster, in its middle, under a line of notes as wide as the map", () => {
    for (const end of [694, 600, 520, 400]) {
      const line: Part = { box: [8, 30, end, 50], line: true };
      expectFilled(opened(DOCKED, TALL, [TITLE, line, LEGEND, CONTROLS]), "height");
    }
  });

  it("never opens aside or to a continent for the line of the notes, and keeps the marks clear of it", () => {
    const without = opened(DOCKED, TALL, [TITLE, LEGEND, CONTROLS]);
    const under = opened(DOCKED, TALL, PARTS);
    expect(under.maxZoom).toBeLessThanOrEqual(without.maxZoom);
    expect(without.maxZoom - under.maxZoom).toBeLessThan(0.25);
    expect(under.padding.left).toBe(without.padding.left);
    expect(under.padding.right).toBe(without.padding.right);
    expect(under.padding.top + under.padding.bottom).toBeLessThanOrEqual(
      without.padding.top +
        without.padding.bottom +
        (50 + 6 - (without.padding.top - 22)),
    );
    expect(under.padding.top).toBeGreaterThan(without.padding.top);
    expect(under.padding.bottom).toBeGreaterThanOrEqual(22 + 8);
    expect(under.padding.top - 22).toBeGreaterThanOrEqual(50 + 6 - 1);
  });

  it("fills a tall map with a wide, flat cluster, in its middle", () => {
    const size: [number, number] = [360, 700];
    const WIDE: Box = [100, 30, 160, 40];
    expectFilled(
      opened(size, WIDE, [
        TITLE,
        { box: [8, 30, 304, 50], line: true },
        { box: [8, 640, 200, 670] },
        { box: [310, 8, 352, 178] },
      ]),
      "width",
    );
  });

  it("gives an opaque title over the top of the marks its own height, at the top only", () => {
    const without = opened(DOCKED, TALL, [LEGEND, CONTROLS]);
    const title: Part = { box: [8, 8, 420, 28] };
    const under = opened(DOCKED, TALL, [title, LEGEND, CONTROLS]);
    const more = under.padding.top - without.padding.top;
    expect(more).toBeGreaterThan(0);
    expect(more).toBeLessThanOrEqual(20 + 6);
    expect(under.padding.bottom).toBe(without.padding.bottom);
    expect(under.padding.left).toBe(without.padding.left);
    expect(under.padding.right).toBe(without.padding.right);
    expectFilled(under, "height");
    expect(opened(DOCKED, TALL, [TITLE, LEGEND, CONTROLS]).padding).toEqual(
      without.padding,
    );
  });

  it("opens at most one zoom further out, and only to keep marks from under a part that hides them", () => {
    const WIDE: Box = [100, 30, 160, 40];
    const clear = opened(DOCKED, WIDE, [TITLE, LEGEND]);
    const hidden = opened(DOCKED, WIDE, [TITLE, LEGEND, CONTROLS]);
    expect(hidden.maxZoom).toBeLessThan(clear.maxZoom);
    expect(clear.maxZoom - hidden.maxZoom).toBeLessThanOrEqual(1);
    expect(hidden.padding.right - clear.padding.right).toBeLessThanOrEqual(42 + 6);
    expect(hidden.padding.left).toBe(clear.padding.left);
    expectFilled(hidden, "width");
  });

  it("keeps the room of each side when a part would take the map more than one zoom out, and the measured room of the legend under the marks", () => {
    const { padding } = opened(DOCKED, TALL, [{ box: [8, 8, 742, 200] }, LEGEND]);
    expect(padding).toEqual({ top: 60, left: 28, right: 56, bottom: 60 + 6 + 22 });
    const low: Part = { box: [8, 310, 200, 324] };
    expect(opened(DOCKED, TALL, [{ box: [8, 8, 742, 200] }, low]).padding.bottom).toBe(
      68,
    );
  });

  it("keeps the room of each side when the parts cannot be measured", () => {
    expect(opened([900, 360], TALL, [...PARTS, { box: [0, 0, 0, 0] }]).padding).toEqual(
      { top: 60, left: 28, right: 56, bottom: 68 },
    );
    expect(opened([900, 360], TALL, []).padding).toEqual({
      top: 60,
      left: 28,
      right: 56,
      bottom: 68,
    });
  });
});

describe("a map with buildings that stand", () => {
  const mounted = (more: {
    tilted: boolean;
    pitchable: boolean;
    pitch?: number;
    bearing?: number;
  }) => {
    const { map, fake, fitBounds } = fakeMap(900, 500);
    const { easeTo } = fake;
    const hook = renderHook(
      (props: {
        tilted: boolean;
        pitchable: boolean;
        pitch?: number;
        bearing?: number;
      }) =>
        useMapCamera({
          map,
          bounds: [-93.7, 41.5, -93.5, 41.7],
          detailZoom: 14,
          heading: false,
          legend: false,
          ...props,
        }),
      { initialProps: more },
    );
    return { hook, fake, fitBounds, easeTo };
  };

  it("can be tilted and turned, and opens flat on its data", () => {
    const { fake, fitBounds } = mounted({ tilted: false, pitchable: true });
    expect(fake.setMaxPitch).toHaveBeenLastCalledWith(60);
    expect(fake.dragRotate.enable).toHaveBeenCalled();
    expect(fitBounds.mock.calls.at(-1)?.[1]).toMatchObject({ pitch: 0, bearing: 0 });
    expect(fake.jumpTo).not.toHaveBeenCalledWith(
      expect.objectContaining({ pitch: 45 }),
    );
  });

  it("leans over when the reader turns them on, and Reset view lays it flat on its data again", () => {
    const { hook, fake, fitBounds, easeTo } = mounted({
      tilted: false,
      pitchable: true,
    });
    hook.result.current.tilt();
    expect(easeTo).toHaveBeenCalledWith(expect.objectContaining({ pitch: 45 }));
    const before = fitBounds.mock.calls.length;
    hook.result.current.reset();
    expect(fitBounds.mock.calls).toHaveLength(before + 1);
    expect(fitBounds.mock.calls.at(-1)?.[1]).toMatchObject({ pitch: 0, bearing: 0 });
    expect(fake.setMaxPitch).toHaveBeenLastCalledWith(60);
  });

  it("lies flat and cannot be tilted once they are off", () => {
    const { hook, fake, easeTo } = mounted({ tilted: false, pitchable: true });
    hook.rerender({ tilted: false, pitchable: false });
    expect(fake.jumpTo).toHaveBeenLastCalledWith({ pitch: 0, bearing: 0 });
    expect(fake.setMaxPitch).toHaveBeenLastCalledWith(0);
    hook.result.current.tilt();
    expect(easeTo).not.toHaveBeenCalled();
  });

  it("opens at the tilt a map asks for, and can be turned like a map with columns", () => {
    const { fake } = mounted({ tilted: true, pitch: 30, bearing: 0, pitchable: false });
    expect(fake.jumpTo).toHaveBeenCalledWith(
      expect.objectContaining({ pitch: 30, bearing: 0 }),
    );
    expect(fake.setMaxPitch).toHaveBeenLastCalledWith(60);
    expect(MAP_LIMITS.pitch).toBe(COLUMN_MAX_PITCH);
  });

  it("stays as a map with columns is while its columns are visible", () => {
    const { hook, fake } = mounted({ tilted: true, pitchable: true });
    expect(fake.jumpTo).toHaveBeenCalledWith(expect.objectContaining({ pitch: 45 }));
    const flat = fake.jumpTo.mock.calls.filter(([to]) => to.pitch === 0).length;
    hook.rerender({ tilted: true, pitchable: false });
    expect(fake.jumpTo.mock.calls.filter(([to]) => to.pitch === 0)).toHaveLength(flat);
    expect(fake.setMaxPitch).toHaveBeenLastCalledWith(60);
  });
});

describe("the room a map leaves over its data", () => {
  const topOf = (more: object) => {
    const { map, fitBounds } = fakeMap(900, 500);
    renderHook(() =>
      useMapCamera({
        map,
        bounds: [-125, 24, -66, 50],
        detailZoom: 6,
        heading: false,
        legend: false,
        tilted: false,
        ...more,
      }),
    );
    return fitBounds.mock.calls[0][1].padding.top as number;
  };

  it("is that of the title, and of the line under it when the map has one", () => {
    expect(topOf({})).toBe(24);
    expect(topOf({ heading: true })).toBe(40);
    expect(topOf({ heading: true, noted: true })).toBe(60);
  });
});

describe("a map that says where it opens", () => {
  const opened = (
    opening: Parameters<typeof useMapCamera>[0]["opening"],
    more = {},
  ) => {
    const { map, fake, fitBounds } = fakeMap(900, 500);
    const hook = renderHook(() =>
      useMapCamera({
        map,
        bounds: [-125, 24, -66, 50],
        detailZoom: 6,
        heading: false,
        legend: false,
        tilted: false,
        opening,
        ...more,
      }),
    );
    return { fitBounds, jumpTo: fake.jumpTo, hook, fake };
  };

  it("opens on the middle of a place, as near as a city is looked at, not on its data", () => {
    const { fitBounds, jumpTo } = opened({ center: [-87.65, 41.85], place: "Chicago" });
    expect(fitBounds).not.toHaveBeenCalled();
    expect(jumpTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [-87.65, 41.85], zoom: 11, bearing: 0 }),
    );
  });

  it("takes the zoom and the bearing the map gives", () => {
    const { jumpTo } = opened({ center: [-87.63, 41.88], zoom: 15.5, bearing: 30 });
    expect(jumpTo).toHaveBeenCalledWith(
      expect.objectContaining({ zoom: 15.5, bearing: 30 }),
    );
  });

  it("opens exactly where a view with a tilt says: the middle, the zoom, the turn and the tilt as given", () => {
    const view = { center: [-87.63, 41.88] as [number, number], zoom: 13.42 };
    const exact = opened({ ...view, bearing: -24.5, pitch: 35.5 }, { tilted: true });
    expect(exact.fitBounds).not.toHaveBeenCalled();
    expect(exact.jumpTo).toHaveBeenLastCalledWith({ pitch: 35.5, bearing: -24.5 });
    expect(
      exact.jumpTo.mock.calls.filter(
        ([to]) => to.zoom !== undefined && to.zoom !== 13.42,
      ),
    ).toEqual([]);
    const flat = opened({ ...view, bearing: 0, pitch: 0 }, { tilted: true });
    expect(flat.jumpTo).toHaveBeenLastCalledWith({ pitch: 0, bearing: 0 });
  });

  it("fits a box the map names as near as it is, and the bottom of the map stays clear", () => {
    const { fitBounds } = opened({ bounds: [-106.6, 25.8, -93.5, 36.5] });
    const [box, options] = fitBounds.mock.calls[0];
    expect(box).toEqual([
      [-106.6, 25.8],
      [-93.5, 36.5],
    ]);
    expect(options.maxZoom).toBe(MAP_LIMITS.viewZoom);
    expect(options.padding.bottom).toBeGreaterThan(0);
  });

  it("returns there with Reset view", () => {
    const { jumpTo, hook } = opened({ center: [-87.65, 41.85] });
    jumpTo.mockClear();
    hook.result.current.reset();
    expect(jumpTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [-87.65, 41.85], zoom: 11 }),
    );
  });

  const zooming = (
    opening: Parameters<typeof useMapCamera>[0]["opening"],
    more = {},
  ) => {
    const { map, fake, fitBounds } = fakeMap(900, 500);
    fake.jumpTo.mockImplementation((to) => {
      if (to.zoom !== undefined) fake.zoom = to.zoom;
    });
    fitBounds.mockImplementation(() => {
      fake.zoom = 10.4;
    });
    const zoom = () => fake.zoom;
    const onBeyond = vi.fn();
    const hook = renderHook(() =>
      useMapCamera({
        map,
        bounds: [-125, 24, -66, 50],
        detailZoom: 6,
        heading: false,
        legend: false,
        tilted: false,
        opening,
        onBeyond,
        ...more,
      }),
    );
    return { fitBounds, jumpTo: fake.jumpTo, onBeyond, hook, zoom };
  };

  it("opens a view no nearer than its backdrop shows the place, and says when the backdrop has no more detail", () => {
    const bundled = { openingLimit: 9, backdropZoom: 9 };
    const street = zooming({ center: [-74.0113, 40.7074], zoom: 16 }, bundled);
    expect(street.zoom()).toBe(9);
    expect(street.onBeyond).toHaveBeenLastCalledWith("held");
    const city = zooming({ bounds: [-87.9, 41.66, -87.4, 42.04] }, bundled);
    expect(city.zoom()).toBe(9);
    expect(city.onBeyond).toHaveBeenLastCalledWith(false);
    const loop = zooming({ bounds: [-87.66, 41.86, -87.6, 41.9] }, bundled);
    expect(loop.zoom()).toBe(9);
    expect(loop.onBeyond).toHaveBeenLastCalledWith("held");
    const state = zooming({ center: [-74, 40.7], zoom: 8 }, bundled);
    expect(state.zoom()).toBe(8);
    expect(state.onBeyond).toHaveBeenLastCalledWith(false);
    const free = zooming({ center: [-74, 40.7], zoom: 16 });
    expect(free.zoom()).toBe(16);
    expect(free.onBeyond).toHaveBeenLastCalledWith(false);
    const block = zooming(
      { center: [-74, 40.7], zoom: 16 },
      { openingLimit: 17, backdropZoom: 9 },
    );
    expect(block.zoom()).toBe(16);
    expect(block.onBeyond).toHaveBeenLastCalledWith("past");
  });

  it("says that a view was held back by what it asked for, on a map that goes no nearer than its limit", () => {
    const limited = (
      opening: Parameters<typeof useMapCamera>[0]["opening"],
      limit: number,
    ) => {
      const { map, fake, fitBounds } = fakeMap(900, 500);
      fake.jumpTo.mockImplementation((to) => {
        if (to.zoom !== undefined) fake.zoom = Math.min(limit, to.zoom);
      });
      fitBounds.mockImplementation(() => {
        fake.zoom = limit;
      });
      const onBeyond = vi.fn();
      renderHook(() =>
        useMapCamera({
          map,
          bounds: null,
          detailZoom: 6,
          heading: false,
          legend: false,
          tilted: false,
          opening,
          openingLimit: limit,
          backdropZoom: limit,
          onBeyond,
        }),
      );
      return { onBeyond, zoom: () => fake.zoom };
    };
    const manhattan = limited({ center: [-73.97, 40.78], zoom: 12 }, 9);
    expect(manhattan.zoom()).toBe(9);
    expect(manhattan.onBeyond).toHaveBeenLastCalledWith("held");
    const county = limited({ bounds: [-74.046, 40.681, -73.906, 40.882] }, 9);
    expect(county.onBeyond).toHaveBeenLastCalledWith("held");
    const outlines = limited({ center: [-73.97, 40.78] }, 7);
    expect(outlines.zoom()).toBe(7);
    expect(outlines.onBeyond).toHaveBeenLastCalledWith("held");
    const state = limited({ bounds: [-79.763, 40.502, -71.856, 45.016] }, 9);
    expect(state.onBeyond).toHaveBeenLastCalledWith(false);
    const close = limited({ center: [-73.97, 40.78], zoom: 9.4 }, 9);
    expect(close.zoom()).toBe(9);
    expect(close.onBeyond).toHaveBeenLastCalledWith(false);
  });

  it("never holds back a map that opens on its data: the limit is of the view the map asks for", () => {
    const data = zooming(null, { openingLimit: 9, backdropZoom: 9 });
    expect(data.zoom()).toBe(10.4);
    expect(data.onBeyond).toHaveBeenLastCalledWith("past");
  });

  it("opens a place with a zoom on the middle of its box, at that zoom", () => {
    const { fitBounds, zoom } = zooming({
      bounds: [-87.9, 41.66, -87.4, 42.04],
      zoom: 14,
      place: "Chicago",
    });
    expect(fitBounds).toHaveBeenCalledTimes(1);
    expect(zoom()).toBe(14);
  });

  it("shows all the data when the reader asks, and returns to the view with Reset view", () => {
    const { fitBounds, hook } = zooming({ bounds: [-106.6, 25.8, -93.5, 36.5] });
    expect(fitBounds.mock.calls[0][0]).toEqual([
      [-106.6, 25.8],
      [-93.5, 36.5],
    ]);
    hook.result.current.fitAll();
    expect(fitBounds.mock.calls[1][0][0][0]).toBeLessThan(-120);
    expect(fitBounds.mock.calls[1][1].maxZoom).toBeLessThan(MAP_LIMITS.viewZoom);
    hook.result.current.reset();
    expect(fitBounds.mock.calls[2][0]).toEqual([
      [-106.6, 25.8],
      [-93.5, 36.5],
    ]);
  });

  it("opens on its data, as every map did, when it says nothing", () => {
    const { fitBounds } = opened(null);
    expect(fitBounds.mock.calls[0][0]).not.toEqual([
      [0, 0],
      [0, 0],
    ]);
    expect(fitBounds.mock.calls[0][1].maxZoom).toBeLessThan(MAP_LIMITS.viewZoom);
  });
});

describe("a map nobody moved, and a map the reader moved", () => {
  const BOX = [-125, 24, -66, 50] as [number, number, number, number];
  const mounted = () => {
    const { map, fake, fitBounds } = fakeMap(900, 500);
    const hook = renderHook(() =>
      useMapCamera({
        map,
        bounds: BOX,
        detailZoom: 6,
        heading: false,
        legend: false,
        tilted: false,
      }),
    );
    return { fake, fitBounds, hook };
  };

  it("fits its data again when its box changes size", () => {
    const { fake, fitBounds } = mounted();
    expect(fitBounds).toHaveBeenCalledTimes(1);
    fake.fire("resize");
    expect(fitBounds).toHaveBeenCalledTimes(2);
    expect(fitBounds.mock.calls[1][0]).toEqual(fitBounds.mock.calls[0][0]);
  });

  it.each(["dragstart", "zoomstart", "rotatestart", "pitchstart"])(
    "stays where the reader put it after a %s of the reader, and is fitted again after Reset view",
    (gesture) => {
      const { fake, fitBounds, hook } = mounted();
      fake.fire(gesture, {});
      fake.fire("resize");
      expect(fitBounds).toHaveBeenCalledTimes(2);
      fake.fire(gesture, { originalEvent: new Event("pointerdown") });
      fake.fire("resize");
      expect(fitBounds).toHaveBeenCalledTimes(2);
      hook.result.current.reset();
      expect(fitBounds).toHaveBeenCalledTimes(3);
      fake.fire("resize");
      expect(fitBounds).toHaveBeenCalledTimes(4);
    },
  );

  it("stays where a button of the view put it: Zoom in is a move of the reader", () => {
    const { fake, fitBounds, hook } = mounted();
    fake.zoom = 6;
    hook.result.current.zoom(1);
    expect(fake.easeTo).toHaveBeenLastCalledWith({ zoom: 7, duration: 200 });
    hook.result.current.zoom(-1);
    expect(fake.easeTo).toHaveBeenLastCalledWith({ zoom: 5, duration: 200 });
    fake.fire("resize");
    expect(fitBounds).toHaveBeenCalledTimes(1);
  });

  it("gives back every handler it gave the map", () => {
    const { fake, hook } = mounted();
    expect(fake.listeners()).toBeGreaterThan(0);
    hook.unmount();
    expect(fake.listeners()).toBe(0);
  });
});

describe("the gestures that turn and tilt a map", () => {
  const gestures = (fake: FakeMap) => ({
    on: [
      fake.dragRotate.enable,
      fake.touchPitch.enable,
      fake.touchZoomRotate.enableRotation,
      fake.keyboard.enableRotation,
    ],
    off: [
      fake.dragRotate.disable,
      fake.touchPitch.disable,
      fake.touchZoomRotate.disableRotation,
      fake.keyboard.disableRotation,
    ],
  });
  const mounted = (pitchable: boolean) => {
    const { map, fake } = fakeMap(900, 500);
    const hook = renderHook(
      (props: { pitchable: boolean }) =>
        useMapCamera({
          map,
          bounds: [-93.7, 41.5, -93.5, 41.7],
          detailZoom: 14,
          heading: false,
          legend: false,
          tilted: false,
          ...props,
        }),
      { initialProps: { pitchable } },
    );
    return { fake, hook };
  };

  it("are all four on for a map with something that stands: the drag, the two touches and the keys", () => {
    const { fake } = mounted(true);
    for (const turnOn of gestures(fake).on) expect(turnOn).toHaveBeenCalledTimes(1);
    for (const turnOff of gestures(fake).off) expect(turnOff).not.toHaveBeenCalled();
    expect(fake.setMaxPitch).toHaveBeenLastCalledWith(COLUMN_MAX_PITCH);
  });

  it("are all four off for a flat map, and go off when what stands is turned off", () => {
    const flat = mounted(false);
    for (const turnOff of gestures(flat.fake).off)
      expect(turnOff).toHaveBeenCalledTimes(1);
    for (const turnOn of gestures(flat.fake).on) expect(turnOn).not.toHaveBeenCalled();
    expect(flat.fake.setMaxPitch).toHaveBeenLastCalledWith(0);

    const stood = mounted(true);
    stood.hook.rerender({ pitchable: false });
    for (const turnOff of gestures(stood.fake).off)
      expect(turnOff).toHaveBeenCalledTimes(1);
    for (const turnOn of gestures(stood.fake).on)
      expect(turnOn).toHaveBeenCalledTimes(1);
  });
});

describe("where a widget keeps that its reader left the map", () => {
  const DATA: [number, number, number, number] = [-125, 24, -66, 50];
  const mount = (more: Partial<Parameters<typeof useMapCamera>[0]> = {}) => {
    const { map, fake } = fakeMap(900, 500);
    const onStore = vi.fn();
    const hook = renderHook(
      (props: Partial<Parameters<typeof useMapCamera>[0]>) =>
        useMapCamera({
          map,
          bounds: DATA,
          detailZoom: 6,
          heading: false,
          legend: false,
          tilted: false,
          onStore,
          ...props,
        }),
      { initialProps: more },
    );
    return { fake, onStore, ...hook };
  };

  it("opens a map there when the camera is of the data the map has", () => {
    const { fake } = mount({
      stored: { center: [-98, 39], zoom: 5, of: [-125, 24, -66, 50] },
    });
    expect(fake.fitBounds).not.toHaveBeenCalled();
    expect(fake.jumpTo).toHaveBeenLastCalledWith({
      center: [-98, 39],
      zoom: 5,
      bearing: 0,
      pitch: 0,
    });
  });

  it("says when the map was left nearer than its backdrop goes now: held where the map ends, or past its detail", () => {
    const onBeyond = vi.fn();
    const stored = { center: [-73.97, 40.78] as [number, number], zoom: 12 };
    const { fake } = fakeMap(900, 500);
    fake.jumpTo.mockImplementation((to) => {
      if (to.zoom !== undefined) fake.zoom = Math.min(9, to.zoom);
    });
    renderHook(() =>
      useMapCamera({
        map: fake.map,
        bounds: null,
        detailZoom: 6,
        heading: false,
        legend: false,
        tilted: false,
        stored,
        backdropZoom: 9,
        onBeyond,
      }),
    );
    expect(fake.zoom).toBe(9);
    expect(onBeyond).toHaveBeenLastCalledWith("held");
    const near = mount({ bounds: null, stored, backdropZoom: 9, onBeyond });
    near.fake.zoom = 12;
    near.rerender({ bounds: null, stored, backdropZoom: 9, onBeyond, cameraOf: 1 });
    expect(onBeyond).toHaveBeenLastCalledWith("past");
    mount({ bounds: null, stored, onBeyond });
    expect(onBeyond).toHaveBeenLastCalledWith(false);
  });

  it("opens a map on its data when the camera is of other data, or of none", () => {
    for (const of of [[2, 48, 3, 49] as [number, number, number, number], undefined]) {
      const { fake } = mount({ stored: { center: [2.3, 48.8], zoom: 11, of } });
      expect(fake.fitBounds).toHaveBeenCalledTimes(1);
    }
  });

  it("opens a map without data where it was left, and on the world when it was left nowhere", () => {
    const left = mount({ bounds: null, stored: { center: [10, 20], zoom: 3 } });
    expect(left.fake.fitBounds).not.toHaveBeenCalled();
    expect(left.fake.jumpTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ center: [10, 20], zoom: 3 }),
    );
    expect(mount({ bounds: null }).fake.fitBounds).toHaveBeenCalledTimes(1);
  });

  it("keeps where the reader put the map, with the box of its data, and nothing for a map nobody moved", () => {
    const { fake, onStore } = mount();
    fake.fire("moveend");
    expect(onStore).not.toHaveBeenCalled();
    fake.center = [-460, 39];
    fake.zoom = 6;
    fake.fire("dragstart", { originalEvent: {} });
    fake.fire("moveend");
    expect(onStore).toHaveBeenLastCalledWith({
      center: [-100, 39],
      zoom: 6,
      bearing: 0,
      pitch: 0,
      of: [-125, 24, -66, 50],
      box: [-180, -85, 180, 85],
    });
  });

  it("keeps the box the reader sees, which is what 'the area on the map' means to an agent", () => {
    const { fake, onStore } = mount();
    fake.center = [-87.63, 41.88];
    fake.zoom = 13;
    fake.bounds = [-87.7, 41.84, -87.56, 41.92];
    fake.fire("dragstart", { originalEvent: {} });
    fake.fire("moveend");
    expect(onStore).toHaveBeenLastCalledWith(
      expect.objectContaining({ box: [-87.7, 41.84, -87.56, 41.92] }),
    );
  });

  it("keeps a zoom of the buttons, and forgets the camera at Reset view", () => {
    const { fake, onStore, result } = mount();
    result.current.zoom(1);
    fake.fire("moveend");
    expect(onStore).toHaveBeenCalledTimes(1);
    result.current.reset();
    expect(onStore).toHaveBeenLastCalledWith(null);
    expect(fake.fitBounds).toHaveBeenCalledTimes(2);
  });

  it("opens fitted to a box an agent asked for while the map was not drawn, and keeps the camera it opens with", () => {
    const paris: [number, number, number, number] = [2.25, 48.81, 2.42, 48.9];
    const { fake, onStore } = mount({
      stored: { center: [2.3, 48.8], zoom: 9, box: paris, fit: true, held: true },
    });
    expect(fake.cameraForBounds).toHaveBeenCalledWith(paris, { padding: 32 });
    expect(fake.fitBounds).not.toHaveBeenCalled();
    expect(fake.jumpTo).toHaveBeenLastCalledWith({
      center: [expect.closeTo(2.335, 6), expect.closeTo(48.855, 6)],
      zoom: 10,
      bearing: 0,
      pitch: 0,
    });
    const [kept] = onStore.mock.lastCall ?? [];
    expect(kept).toMatchObject({ of: [-125, 24, -66, 50], held: true });
    expect(kept).not.toHaveProperty("fit");
    fake.fire("dragstart", { originalEvent: {} });
    fake.fire("moveend");
    expect(onStore.mock.lastCall?.[0]).not.toHaveProperty("held");
  });

  it("does not move a map that is looked at when what is stored changes", () => {
    const { fake, rerender } = mount();
    const before = fake.jumpTo.mock.calls.length;
    rerender({ stored: { center: [-98, 39], zoom: 5, of: [-125, 24, -66, 50] } });
    expect(fake.jumpTo.mock.calls.length).toBe(before);
    expect(fake.fitBounds).toHaveBeenCalledTimes(1);
  });
});

describe("a view the widget settings name", () => {
  const camera = (target: Parameters<typeof useMapCamera>[0]["target"], map: ReturnType<typeof fakeMap>["map"]) =>
    useMapCamera({
      map,
      bounds: [-125, 24, -66, 50],
      detailZoom: 6,
      heading: true,
      legend: false,
      tilted: false,
      target,
    });

  it("is not moved to on the first render, so a saved view stays", () => {
    const { map, fake } = fakeMap(800, 500);
    renderHook(() => camera({ center: [2.35, 48.85], zoom: 12 }, map));
    expect(fake.easeTo).not.toHaveBeenCalled();
  });

  it("is moved to when it changes", () => {
    const { map, fake } = fakeMap(800, 500);
    const { rerender } = renderHook(({ target }) => camera(target, map), {
      initialProps: { target: null as Parameters<typeof useMapCamera>[0]["target"] },
    });
    rerender({ target: { center: [2.35, 48.85], zoom: 12 } });
    expect(fake.easeTo).toHaveBeenCalledTimes(1);
    expect(fake.easeTo.mock.calls[0][0]).toMatchObject({ center: [2.35, 48.85], zoom: 12 });
  });
});
