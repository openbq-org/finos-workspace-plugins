import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Basemap } from "~/components/Geo/basemap";
import { contextLayers } from "~/components/Geo/basemapContext";
import { useContextTilt } from "~/components/Geo/useContextTilt";
import type { MapViewState } from "~/lib/geo/mapViewState";
import { scene } from "./scene/support";

const basemap: Basemap = {
  kind: "openfreemap",
  source: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
  under: [],
  labels: [],
  maxZoom: 17,
  detailZoom: 14,
  credit: "OpenFreeMap",
  schema: "openmaptiles",
  context: contextLayers("openmaptiles", "light", () => true, 14),
};
const points = [{ lat: 41.59, lon: -93.62 }];
const TALL: MapViewState = { basemap: { context: ["buildings-3d"] } };

const mounted = (more: {
  zoom: number;
  tilted?: boolean;
  asked?: boolean;
  start?: MapViewState;
}) => {
  const built = scene(
    { points, ...(more.asked ? { context: ["buildings-3d"] } : {}) },
    { basemap },
  );
  const tilt = vi.fn();
  let view = more.start ?? {};
  const isTall = (state: MapViewState) =>
    (more.asked && !state.basemap?.contextOff?.length) ||
    Boolean(state.basemap?.context?.includes("buildings-3d"));
  const hook = renderHook(() =>
    useContextTilt({
      scene: built,
      setView: (make) => {
        view = make(view);
      },
      tall: isTall(view),
      tilted: more.tilted ?? false,
      zoom: more.zoom,
      tilt,
    }),
  );
  const change = (next: MapViewState) => {
    hook.result.current(() => next);
    hook.rerender();
  };
  return { tilt, change, view: () => view };
};

describe("the lean of a map when the reader turns on buildings that stand", () => {
  it("leans once, when the reader turns them on close enough to see them", () => {
    const { tilt, change, view } = mounted({ zoom: 15 });
    expect(tilt).not.toHaveBeenCalled();
    change(TALL);
    expect(view()).toEqual(TALL);
    expect(tilt).toHaveBeenCalledTimes(1);
    change({ ...TALL, hidden: ["points"] });
    expect(tilt).toHaveBeenCalledTimes(1);
  });

  it("does not lean a map that opens with them on: by the map, or by a stored view", () => {
    expect(mounted({ zoom: 15, asked: true }).tilt).not.toHaveBeenCalled();
    expect(mounted({ zoom: 15, start: TALL }).tilt).not.toHaveBeenCalled();
  });

  it("does not lean a map that is too far out to draw them, or that columns already tilt", () => {
    const far = mounted({ zoom: 13 });
    far.change(TALL);
    expect(far.tilt).not.toHaveBeenCalled();
    const columns = mounted({ zoom: 15, tilted: true });
    columns.change(TALL);
    expect(columns.tilt).not.toHaveBeenCalled();
  });

  it("does not lean for any other switch", () => {
    const { tilt, change } = mounted({ zoom: 15 });
    change({ basemap: { context: ["buildings"] } });
    change({ basemap: { context: ["buildings"], names: false } });
    expect(tilt).not.toHaveBeenCalled();
  });
});
