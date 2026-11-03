import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useMapCard } from "~/components/Geo/useMapCard";
import { mapSpec } from "~/lib/geo/mapSpec";

describe("the card of a mark of a map", () => {
  it("is one object from render to render while nothing of it changed", () => {
    const props = {
      map: null,
      scene: null,
      spec: mapSpec({ points: [{ lat: 1, lon: 2, label: "A" }] }),
      expanded: false,
      shown: () => true,
      layers: [],
      notes: {},
    };
    const { result, rerender } = renderHook(() => useMapCard(props));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    expect(first).toMatchObject({ openMark: undefined, openIndex: -1, pinned: null });
  });
});
