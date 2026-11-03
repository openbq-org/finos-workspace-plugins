import { act, renderHook } from "@testing-library/react";
import type { MutableRefObject } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Scene } from "~/components/Geo/scene/sceneTypes";
import { type KeptCamera, useMapCamera } from "~/components/Geo/useMapCamera";
import { type KeptCrowd, useMapCrowd } from "~/components/Geo/useMapCrowd";
import { expectNoUseAfterRemove, FakeMap } from "./fakeMap";
import { scene } from "./scene/support";

afterEach(expectNoUseAfterRemove);

const CLOSE = { points: [0, 0.1, 0.2, 0.3].map((lon) => ({ lat: 0, lon })) };
const APART = { points: [0, 10, 20, 30].map((lon) => ({ lat: 0, lon })) };

const wired = (
  props: { now: Scene; frame?: string; of?: unknown },
  map: FakeMap,
  kept: { crowd?: MutableRefObject<KeptCrowd | null>; camera?: Camera } = {},
) => {
  const of = props.of ?? props.now;
  const { crowd, measure } = useMapCrowd(
    map.map,
    props.now,
    props.frame,
    of,
    kept.crowd,
  );
  const camera = useMapCamera({
    map: map.map,
    bounds: props.now.bounds,
    detailZoom: 6,
    heading: false,
    legend: false,
    tilted: false,
    cameraOf: of,
    camera: kept.camera,
    onPlaced: measure,
  });
  return { crowd, camera };
};
type Camera = MutableRefObject<KeptCamera | null>;

const fitting = (width = 900) => {
  const map = new FakeMap();
  let scale = 10;
  const sized = (wide: number) =>
    Object.defineProperty(map.container, "clientWidth", {
      value: wide,
      configurable: true,
    });
  sized(width);
  map.fitBounds.mockImplementation(() => {
    scale = map.container.clientWidth / 90;
  });
  const zoomBy = (factor: number) => {
    scale *= factor;
    map.fire("zoomstart", { originalEvent: {} });
  };
  map.project = (([lon, lat]: [number, number]) => ({
    x: lon * scale,
    y: -lat * scale,
  })) as never;
  return { map, sized, zoomBy };
};

const measured = async (raw: unknown, frame?: string) => {
  const built = scene(raw);
  const map = new FakeMap();
  const hook = renderHook(
    (props: { now: Scene; frame?: string }) => wired(props, map).crowd,
    { initialProps: { now: built, frame } },
  );
  await act(async () => {});
  return { map, hook, built };
};

beforeEach(() => FakeMap.reset());

describe("which layers of points are crowded where the map opens", () => {
  const built = scene(APART);

  it("are those whose points lie on each other on the canvas", async () => {
    expect([...(await measured(CLOSE)).hook.result.current]).toEqual(["points"]);
    expect([...(await measured(APART)).hook.result.current]).toEqual([]);
  });

  it("listens to no event of the map itself: the camera says when the map is placed", async () => {
    const built = scene(APART);
    const map = new FakeMap();
    const hook = renderHook(() => useMapCrowd(map.map, built, undefined, built));
    await act(async () => {});
    expect(map.listeners()).toBe(0);
    expect(hook.result.current.crowd.size).toBe(0);
  });

  it("counts the new size of a box: the camera fits the map first, and the crowd is measured after it", async () => {
    const { map, sized } = fitting();
    const hook = renderHook(() => wired({ now: built }, map).crowd);
    await act(async () => {});
    expect([...hook.result.current]).toEqual([]);
    sized(27);
    act(() => map.fire("resize"));
    expect([...hook.result.current]).toEqual(["points"]);
    sized(900);
    act(() => map.fire("resize"));
    expect([...hook.result.current]).toEqual([]);
  });
  it("decides nothing anew while the reader has moved the map, until the view is reset", async () => {
    const { map, sized, zoomBy } = fitting(27);
    let reset = () => {};
    const hook = renderHook(() => {
      const all = wired({ now: built }, map);
      reset = all.camera.reset;
      return all.crowd;
    });
    await act(async () => {});
    expect([...hook.result.current]).toEqual(["points"]);
    act(() => zoomBy(64));
    sized(40);
    act(() => map.fire("resize"));
    expect([...hook.result.current]).toEqual(["points"]);
    sized(900);
    act(() => map.fire("resize"));
    expect([...hook.result.current]).toEqual(["points"]);
    act(() => reset());
    expect([...hook.result.current]).toEqual([]);
  });

  it("comes back as it was with the camera a reader left: the still of the map shows the same circles", async () => {
    const crowd = { current: null } as MutableRefObject<KeptCrowd | null>;
    const camera = { current: null } as Camera;
    const first = fitting(27);
    const hook = renderHook(
      () => wired({ now: built }, first.map, { crowd, camera }).crowd,
    );
    await act(async () => {});
    expect([...hook.result.current]).toEqual(["points"]);
    act(() => first.zoomBy(64));
    act(() => first.map.fire("moveend"));
    expect(camera.current).not.toBeNull();
    hook.unmount();
    const second = fitting(27);
    second.zoomBy(64);
    const again = renderHook(
      () => wired({ now: built }, second.map, { crowd, camera }).crowd,
    );
    expect([...again.result.current]).toEqual(["points"]);
    await act(async () => {});
    expect([...again.result.current]).toEqual(["points"]);
    expect(second.map.fitBounds).not.toHaveBeenCalled();
  });

  it("keeps what it found through a new scene of the same map: a theme measures nothing", async () => {
    const { map } = fitting(27);
    const hook = renderHook(
      (props: { now: Scene; of: unknown }) => wired(props, map).crowd,
      { initialProps: { now: built, of: APART } },
    );
    await act(async () => {});
    const before = hook.result.current;
    expect([...before]).toEqual(["points"]);
    hook.rerender({ now: scene(APART), of: APART });
    expect(hook.result.current).toBe(before);
  });

  it("measures the points of the step a map that plays is on: one place on ten steps is one point", async () => {
    const steps = {
      points: ["2020", "2021", "2022", "2023"].flatMap((time) => [
        { lat: 0, lon: 0, time },
        { lat: 0, lon: 30, time },
      ]),
    };
    expect([...(await measured(steps, "2023")).hook.result.current]).toEqual([]);
  });

  it("says nothing of a map without a layer of points to group", async () => {
    const { hook } = await measured({
      regions: { set: "us-states", items: [{ code: "CA", value: 1 }] },
    });
    expect(hook.result.current.size).toBe(0);
  });
});

describe("layers the map never groups by itself", () => {
  const places = [0, 0.1, 0.2, 0.3, 0.4].map((lon) => ({ lat: 0, lon }));
  const line = { type: "line", coordinates: places.map(({ lon, lat }) => [lon, lat]) };

  it("are the points of a track: a line of the map goes through them", async () => {
    const track = {
      layers: [
        { kind: "lines", shapes: [line] },
        { id: "positions", kind: "points", points: places },
      ],
    };
    const { hook, built } = await measured(track);
    expect(built.clustered[0]).toMatchObject({ layer: "positions", track: true });
    expect([...hook.result.current]).toEqual([]);
    const alone = await measured({
      layers: [{ id: "positions", kind: "points", points: places }],
    });
    expect([...alone.hook.result.current]).toEqual(["positions"]);
  });

  it("are the ends of the flows of a map, as an agent draws a track in segments", async () => {
    const flows = places.slice(1).map((to, at) => ({
      from: [places[at].lon, places[at].lat],
      to: [to.lon, to.lat],
    }));
    const { hook, built } = await measured({
      layers: [
        { kind: "flows", flows },
        { id: "positions", kind: "points", points: places },
      ],
    });
    expect(built.clustered[0].track).toBe(true);
    expect([...hook.result.current]).toEqual([]);
  });

  it("are bubbles sized by a value that only overlap: their sizes are what the map says", async () => {
    const row = [
      ...Array.from({ length: 12 }, (_, at) => ({ lat: 0, lon: at * 0.55, size: 16 })),
      { lat: 40, lon: 60, size: 100 },
    ];
    const { hook, built } = await measured({ points: row });
    expect(built.clustered[0]).toMatchObject({ layer: "points", sized: true });
    expect([...hook.result.current]).toEqual([]);
    const plain = await measured({ points: row.map(({ lat, lon }) => ({ lat, lon })) });
    expect([...plain.hook.result.current]).toEqual(["points"]);
  });

  it("groups bubbles that lie on each other middle on middle, half of them and ten at least", async () => {
    const pile = Array.from({ length: 12 }, (_, at) => ({
      lat: 0,
      lon: (at % 3) * 0.01,
      size: 5 + at,
    }));
    expect([...(await measured({ points: pile })).hook.result.current]).toEqual([
      "points",
    ]);
  });
});
