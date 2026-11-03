import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setBasemapPart, setBoundaryLayer } from "~/components/Geo/layerPanelState";
import { useAskedView, useMapView, VIEW_STORE_MS } from "~/components/Geo/useMapView";
import { mapSpec } from "~/lib/geo/mapSpec";
import type { MapViewState } from "~/lib/geo/mapViewState";

const asking = mapSpec({
  points: [{ lat: 41.6, lon: -93.6 }],
  shapes: [],
  boundaries: ["us-counties"],
  basemap: { choice: "plain", roads: false },
});
const plain = mapSpec({ points: [{ lat: 41.6, lon: -93.6 }], shapes: [] });

const mount = (
  spec: typeof asking,
  stored: unknown,
  keep?: (view: MapViewState) => void,
) =>
  renderHook(
    (props: { stored: unknown }) => {
      const [reader, setReader] = useMapView(props.stored, keep);
      const [view, setView] = useAskedView(spec, reader, setReader);
      return { reader, view, setView, setReader };
    },
    { initialProps: { stored } },
  );

describe("the view a map is looked at with", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens with what the map asks for, and stores nothing for an untouched map", () => {
    vi.useFakeTimers();
    const keep = vi.fn();
    const { result } = mount(asking, undefined, keep);
    expect(result.current.view).toEqual({
      boundaries: ["us-counties"],
      basemap: { roads: false },
    });
    expect(result.current.reader).toEqual({});
    act(() => {
      vi.advanceTimersByTime(VIEW_STORE_MS * 2);
    });
    expect(keep).not.toHaveBeenCalled();
  });

  it("keeps what the reader switched over what the map asks, also after it was stored and read again", () => {
    vi.useFakeTimers();
    const keep = vi.fn();
    const { result, rerender } = mount(asking, undefined, keep);
    act(() =>
      result.current.setView((view) => setBoundaryLayer(view, "us-counties", false)),
    );
    act(() => result.current.setView((view) => setBasemapPart(view, "roads", true)));
    act(() => result.current.setView((view) => setBoundaryLayer(view, "cities", true)));
    expect(result.current.view).toEqual({ boundaries: ["cities"] });
    act(() => {
      vi.advanceTimersByTime(VIEW_STORE_MS);
    });
    const stored = keep.mock.calls.at(-1)?.[0];
    expect(stored).toEqual({
      boundaries: ["cities"],
      boundariesOff: ["us-counties"],
      basemap: { roads: true },
    });
    rerender({ stored: JSON.parse(JSON.stringify(stored)) });
    expect(result.current.view).toEqual({ boundaries: ["cities"] });
    act(() =>
      result.current.setView((view) => setBoundaryLayer(view, "us-counties", true)),
    );
    act(() => result.current.setView((view) => setBasemapPart(view, "roads", false)));
    expect(result.current.reader).toEqual({ boundaries: ["cities"] });
  });

  it("is the state of the reader itself for a map that asks for nothing, and changes it as before", () => {
    const { result } = mount(plain, { boundaries: ["cities"] });
    expect(result.current.view).toBe(result.current.reader);
    act(() =>
      result.current.setView((view) => setBoundaryLayer(view, "us-states", true)),
    );
    expect(result.current.reader).toEqual({ boundaries: ["us-states", "cities"] });
  });

  it("applies what the map asks once: a later render changes neither the view nor its function", () => {
    const { result, rerender } = mount(asking, undefined);
    const first = result.current;
    rerender({ stored: undefined });
    expect(result.current.view).toBe(first.view);
    expect(result.current.setView).toBe(first.setView);
  });
});
