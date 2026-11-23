import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMapView, VIEW_STORE_MS } from "~/components/Geo/useMapView";

const HOSTILE = {
  hidden: ["points", "https://attacker.example/x", 4],
  opacity: { regions: 0.5, "bad id": 0.2 },
  basemap: { names: false, choice: "https://attacker.example" },
  style: "https://attacker.example/style.json",
};

describe("the view state of a mounted map", () => {
  afterEach(() => vi.useRealTimers());

  it("is local to the view when nothing keeps it, and starts from what was stored", () => {
    const { result, rerender } = renderHook(({ stored }) => useMapView(stored), {
      initialProps: { stored: HOSTILE as unknown },
    });
    expect(result.current[0]).toEqual({
      hidden: ["points"],
      opacity: { regions: 0.5 },
      basemap: { names: false },
    });
    act(() => result.current[1](() => ({ hidden: ["regions"], panel: "open" })));
    expect(result.current[0]).toEqual({ hidden: ["regions"], panel: "open" });
    rerender({ stored: { hidden: ["lines"] } });
    expect(result.current[0]).toEqual({ hidden: ["regions"], panel: "open" });
  });

  it("hands the keeper a reduced state once the changes settle, and follows a stored state from outside", () => {
    vi.useFakeTimers();
    const keep = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ stored }) => useMapView(stored, keep),
      { initialProps: { stored: { hidden: ["points"] } as unknown } },
    );
    expect(result.current[0]).toEqual({ hidden: ["points"] });
    for (const frame of ["2021", "2022", "2023"]) {
      act(() => result.current[1](() => ({ hidden: ["regions", "not an id"], frame })));
      act(() => void vi.advanceTimersByTime(900));
    }
    expect(result.current[0]).toEqual({ hidden: ["regions"], frame: "2023" });
    expect(keep).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(VIEW_STORE_MS));
    expect(keep).toHaveBeenCalledTimes(1);
    expect(keep).toHaveBeenCalledWith({ hidden: ["regions"], frame: "2023" });
    rerender({ stored: { hidden: ["regions"], frame: "2023" } });
    expect(result.current[0]).toEqual({ hidden: ["regions"], frame: "2023" });
    rerender({ stored: { legend: "closed" } });
    expect(result.current[0]).toEqual({ legend: "closed" });
    act(() => result.current[1](() => ({ hidden: ["lines"] })));
    unmount();
    expect(keep).toHaveBeenLastCalledWith({ hidden: ["lines"] });
  });

  it("says at once what waits for the keeper, until the stored state comes back", () => {
    vi.useFakeTimers();
    const keep = vi.fn();
    const waits = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ stored }) => useMapView(stored, keep, waits),
      { initialProps: { stored: { hidden: ["points"] } as unknown } },
    );
    expect(waits).not.toHaveBeenCalled();
    act(() => result.current[1]((now) => ({ ...now, panel: "open" })));
    expect(waits).not.toHaveBeenCalled();
    act(() => result.current[1]((now) => ({ ...now, boundaries: ["us-states"] })));
    expect(waits).toHaveBeenLastCalledWith({
      hidden: ["points"],
      boundaries: ["us-states"],
    });
    expect(keep).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(VIEW_STORE_MS));
    expect(keep).toHaveBeenCalledTimes(1);
    expect(waits).toHaveBeenCalledTimes(1);
    rerender({ stored: { hidden: ["points"], boundaries: ["us-states"] } });
    expect(waits).toHaveBeenLastCalledWith(null);
    expect(waits).toHaveBeenCalledTimes(2);
    act(() => result.current[1](({ boundaries: _on, ...rest }) => rest));
    expect(waits).toHaveBeenLastCalledWith({ hidden: ["points"] });
    act(() =>
      result.current[1]((now) => ({ ...now, boundaries: ["us-states"] as const })),
    );
    expect(waits).toHaveBeenLastCalledWith(null);
    act(() => result.current[1]((now) => ({ ...now, legend: "closed" })));
    rerender({ stored: { hidden: ["lines"] } });
    expect(waits).toHaveBeenLastCalledWith({
      hidden: ["points"],
      boundaries: ["us-states"],
      legend: "closed",
    });
    unmount();
    expect(waits).toHaveBeenLastCalledWith(null);
  });

  it("ends the wait when it hands the keeper the state that is stored already", () => {
    vi.useFakeTimers();
    const keep = vi.fn();
    const waits = vi.fn();
    const { result, rerender } = renderHook(
      ({ stored }) => useMapView(stored, keep, waits),
      { initialProps: { stored: {} as unknown } },
    );
    act(() => result.current[1](() => ({ legend: "closed" })));
    rerender({ stored: { legend: "closed" } });
    expect(waits).toHaveBeenLastCalledWith({ legend: "closed" });
    act(() => void vi.advanceTimersByTime(VIEW_STORE_MS));
    expect(waits).toHaveBeenLastCalledWith(null);
  });

  it("keeps the open panel in the view and never hands it to the keeper", () => {
    vi.useFakeTimers();
    const keep = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ stored }) => useMapView(stored, keep),
      { initialProps: { stored: { hidden: ["points"], panel: "open" } as unknown } },
    );
    expect(result.current[0]).toEqual({ hidden: ["points"] });
    act(() => result.current[1]((now) => ({ ...now, panel: "open" })));
    expect(result.current[0]).toEqual({ hidden: ["points"], panel: "open" });
    act(() => void vi.advanceTimersByTime(VIEW_STORE_MS * 2));
    expect(keep).not.toHaveBeenCalled();
    act(() => result.current[1]((now) => ({ ...now, hidden: ["points", "regions"] })));
    act(() => void vi.advanceTimersByTime(VIEW_STORE_MS));
    expect(keep).toHaveBeenCalledTimes(1);
    expect(keep).toHaveBeenLastCalledWith({ hidden: ["points", "regions"] });
    rerender({ stored: { hidden: ["points", "regions"] } });
    rerender({ stored: { legend: "closed" } });
    expect(result.current[0]).toEqual({ legend: "closed", panel: "open" });
    act(() => result.current[1](({ panel: _open, ...rest }) => rest));
    unmount();
    expect(keep).toHaveBeenCalledTimes(1);
  });

  it("stores nothing for a change that was taken back before it was stored", () => {
    vi.useFakeTimers();
    const keep = vi.fn();
    const { result } = renderHook(() => useMapView({ hidden: ["points"] }, keep));
    act(() => result.current[1](() => ({})));
    act(() => result.current[1](() => ({ hidden: ["points"] })));
    act(() => void vi.advanceTimersByTime(VIEW_STORE_MS * 2));
    expect(keep).not.toHaveBeenCalled();
  });

  it("keeps one state and one setter while nothing changes", () => {
    const stored = { hidden: ["points"] };
    const keep = vi.fn();
    const { result, rerender } = renderHook(() => useMapView(stored, keep));
    const [state, set] = result.current;
    rerender();
    expect(result.current[0]).toBe(state);
    expect(result.current[1]).toBe(set);
  });

  it("keeps two changes that meet before the next render: each starts from the state of now", () => {
    vi.useFakeTimers();
    const keep = vi.fn();
    const { result } = renderHook(() => useMapView({ hidden: ["points"] }, keep));
    const [, set] = result.current;
    act(() => {
      set((now) => ({ ...now, frame: "2024" }));
      set((now) => ({ ...now, hidden: [...(now.hidden ?? []), "regions"] }));
    });
    expect(result.current[0]).toEqual({ hidden: ["points", "regions"], frame: "2024" });
    expect(result.current[1]).toBe(set);
    act(() => void vi.advanceTimersByTime(VIEW_STORE_MS));
    expect(keep).toHaveBeenCalledTimes(1);
    expect(keep).toHaveBeenCalledWith({ hidden: ["points", "regions"], frame: "2024" });
  });

  it("starts a change from a state that was stored from outside", () => {
    const keep = vi.fn();
    const { result, rerender } = renderHook(({ stored }) => useMapView(stored, keep), {
      initialProps: { stored: {} as unknown },
    });
    rerender({ stored: { legend: "closed" } });
    act(() => result.current[1]((now) => ({ ...now, panel: "open" })));
    expect(result.current[0]).toEqual({ legend: "closed", panel: "open" });
  });

  it.each([null, undefined, 4, "x", [], { hidden: "x", opacity: [] }])(
    "never throws for a stored value that is no view state: %j",
    (stored) => {
      const { result } = renderHook(() => useMapView(stored));
      expect(result.current[0]).toEqual({});
      act(() => result.current[1](() => stored as never));
      expect(result.current[0]).toEqual({});
    },
  );
});
