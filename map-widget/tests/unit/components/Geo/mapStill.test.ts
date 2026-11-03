import type { Map as MapLibreMap } from "maplibre-gl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cameraAt,
  canvasPicture,
  mapPicture,
  STILL_WAIT_MS,
  StillPool,
  stillShows,
} from "~/components/Geo/mapStill";
import { mapSpec } from "~/lib/geo/mapSpec";
import { expectNoUseAfterRemove, FakeMap } from "./fakeMap";

afterEach(expectNoUseAfterRemove);

const spec = mapSpec({ points: [{ lat: 1, lon: 1 }] });
const of = {
  width: 300,
  height: 200,
  dark: false,
  spec,
  notes: undefined,
  view: "{}",
  camera: null,
  at: "0,0,3,0,0",
};

describe("whether a still shows the map as it is", () => {
  it("does for the same size, theme, map, tags, view and camera, and for nothing else", () => {
    expect(stillShows(null, of)).toBe(false);
    expect(stillShows({ ...of }, of)).toBe(true);
    for (const other of [
      { width: 301 },
      { height: 199 },
      { dark: true },
      { spec: mapSpec({ points: [{ lat: 1, lon: 1 }] }) },
      { notes: {} },
      { view: '{"hidden":["points"]}' },

      { at: "0,0,5,0,0" },

      {
        camera: {
          of: spec,
          center: [1, 1] as [number, number],
          zoom: 4,
          bearing: 0,
          pitch: 0,
        },
      },
    ])
      expect(
        stillShows({ ...of, ...other }, of),
        JSON.stringify(Object.keys(other)),
      ).toBe(false);
  });
});

describe("the picture of a drawn map", () => {
  const blob = new Blob(["png"], { type: "image/png" });
  beforeEach(() => {
    FakeMap.reset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  const taken = (map: FakeMap, signal = new AbortController().signal) => {
    const picture = vi.fn(async (_canvas: HTMLCanvasElement) => blob);
    const result = mapPicture(map.map as MapLibreMap, signal, picture);
    return { picture, result };
  };

  it("waits until the map is idle, then copies the frame of a render it asks for", async () => {
    const map = new FakeMap();
    map.setStyle({});
    const { picture, result } = taken(map);
    expect(map.repaints).toBe(0);
    expect(picture).not.toHaveBeenCalled();
    map.settle();

    expect(map.repaints).toBe(1);
    expect(picture).toHaveBeenCalledWith(map.canvas);
    expect(await result).toBe(blob);

    expect(map.listeners()).toBe(0);
    map.fire("render");
    expect(picture).toHaveBeenCalledTimes(1);
  });

  it("copies at once from a map that is idle already", async () => {
    const map = new FakeMap();
    map.settle();
    const { picture, result } = taken(map);
    expect(picture).toHaveBeenCalledTimes(1);
    expect(await result).toBe(blob);
  });

  it("gives up on a map that is not idle in time, and holds nothing of it", async () => {
    const map = new FakeMap();
    map.setStyle({});
    const { picture, result } = taken(map);
    const answer = vi.fn();
    void result.then(answer);

    await vi.advanceTimersByTimeAsync(STILL_WAIT_MS - 1);
    expect(answer).not.toHaveBeenCalled();
    expect(map.listeners()).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(answer).toHaveBeenCalledWith(null);
    expect(await result).toBeNull();
    expect(map.listeners()).toBe(0);
    map.settle();
    expect(picture).not.toHaveBeenCalled();
  });

  it("stops when it is told to: a map that goes is not copied", async () => {
    const map = new FakeMap();
    map.setStyle({});
    const controller = new AbortController();
    const { picture, result } = taken(map, controller.signal);
    controller.abort();
    expect(await result).toBeNull();
    expect(map.listeners()).toBe(0);
    expect(picture).not.toHaveBeenCalled();
    const gone = new AbortController();
    gone.abort();
    expect(await taken(map, gone.signal).result).toBeNull();
  });

  it("is no picture of a map whose graphics context the browser took: its buffer is blank", async () => {
    const waiting = new FakeMap();
    waiting.setStyle({});
    const first = taken(waiting);
    waiting.canvas.dispatchEvent(new Event("webglcontextlost"));
    expect(await first.result).toBeNull();
    expect(waiting.listeners()).toBe(0);
    waiting.settle();
    expect(first.picture).not.toHaveBeenCalled();

    const context = (lost: boolean) => ({
      value: () => ({ isContextLost: () => lost }),
      configurable: true,
    });
    const gone = new FakeMap();
    Object.defineProperty(gone.canvas, "getContext", context(true));
    expect(await canvasPicture(gone.canvas)).toBeNull();

    const held = new FakeMap();
    Object.defineProperty(held.canvas, "getContext", context(false));
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((done) =>
      done(blob),
    );
    expect(await canvasPicture(held.canvas)).toBe(blob);
  });

  it("is no picture when the canvas cannot be copied", async () => {
    const map = new FakeMap();
    map.settle();
    const failing = vi.fn(async () => {
      throw new Error("tainted");
    });
    expect(
      await mapPicture(map.map as MapLibreMap, new AbortController().signal, failing),
    ).toBeNull();
  });
});

describe("the stills a page keeps", () => {
  it("drops the one that was used longest ago when there is one too many", () => {
    const pool = new StillPool({ count: 2, bytes: 1000 });
    const dropped: string[] = [];
    for (const owner of ["a", "b"]) pool.keep(owner, 10, () => dropped.push(owner));
    pool.use("a");
    pool.keep("c", 10, () => dropped.push("c"));
    expect(dropped).toEqual(["b"]);
    expect(pool.count).toBe(2);
  });

  it("keeps the bytes of all of them under the limit, and never drops the newest for it", () => {
    const pool = new StillPool({ count: 10, bytes: 100 });
    const dropped: string[] = [];
    pool.keep("a", 60, () => dropped.push("a"));
    pool.keep("b", 30, () => dropped.push("b"));
    pool.keep("c", 50, () => dropped.push("c"));
    expect(dropped).toEqual(["a"]);
    expect(pool.bytes).toBe(80);

    pool.keep("large", 500, () => dropped.push("large"));
    expect(dropped).toEqual(["a", "b", "c"]);
    expect(pool.count).toBe(1);
  });

  it("counts a new still of an owner in the place of its old one, and forgets one that was given back", () => {
    const pool = new StillPool({ count: 2, bytes: 1000 });
    const drop = vi.fn();
    pool.keep("a", 10, drop);
    pool.keep("a", 20, drop);
    expect(pool.count).toBe(1);
    expect(pool.bytes).toBe(20);
    pool.forget("a");
    expect(pool.count).toBe(0);
    pool.use("a");
    expect(drop).not.toHaveBeenCalled();
  });
});

describe("the moment a picture is of", () => {
  it("is told when the frame is copied, before the picture is written: what lies over the canvas is copied then", async () => {
    FakeMap.reset();
    const map = new FakeMap();
    map.settle();
    const order: string[] = [];
    let written: (blob: Blob) => void = () => {};
    const picture = vi.fn(() => {
      order.push("copied");
      return new Promise<Blob>((resolve) => {
        written = resolve;
      });
    });
    const taken = mapPicture(
      map.map as MapLibreMap,
      new AbortController().signal,
      picture,
      () => order.push("frame"),
    );

    order.push("placed again");
    written(new Blob(["png"]));
    await taken;
    expect(order).toEqual(["frame", "copied", "placed again"]);
  });

  it("names where a map looks, so a still knows the view it is a picture of", () => {
    const map = new FakeMap();
    map.center = [-87.63, 41.88];
    map.zoom = 13.4567;
    map.pitch = 52;
    map.bearing = -24;
    expect(cameraAt(map.map as MapLibreMap)).toBe("-87.63,41.88,13.457,52,-24");
    map.zoom = 15;
    expect(cameraAt(map.map as MapLibreMap)).not.toBe("-87.63,41.88,13.457,52,-24");
  });
});
