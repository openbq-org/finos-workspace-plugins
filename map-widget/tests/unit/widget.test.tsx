import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MapWidget from "~/MapWidget";
import { getShown, type Model } from "~/widget";

const seen = vi.hoisted(() => ({ props: null as Record<string, any> | null }));
vi.mock("~/components/Geo/MapView", () => ({
  default: (props: Record<string, any>) => {
    seen.props = props;
    return <div data-testid="map" />;
  },
}));

function fakeModel(traits: Record<string, unknown>) {
  const listeners = new Map<string, Set<() => void>>();
  const saved: unknown[] = [];
  const model: Model = {
    get: (name) => structuredClone(traits[name]),
    set: (name, value) => {
      traits[name] = value;
      for (const listener of listeners.get(`change:${name}`) ?? []) listener();
    },
    on: (event, callback) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)?.add(callback);
    },
    off: (event, callback) => {
      if (event && callback) listeners.get(event)?.delete(callback);
    },
    save_changes: () => saved.push(structuredClone(traits.state)),
  };
  return { model, traits, saved };
}

const ROWS = [
  { name: "New York", lat: 40.7128, lon: -74.006, staff: 120 },
  { name: "London", lat: 51.5072, lon: -0.1276, staff: 85 },
];
const MAPPING = {
  lat: "lat",
  lon: "lon",
  label: "name",
  value: "staff",
  valueLabel: "Staff",
};

afterEach(() => {
  seen.props = null;
});

describe("the map widget", () => {
  it("draws the rows of the endpoint as the map its definition describes", async () => {
    const { model } = fakeModel({
      data: ROWS,
      definition: MAPPING,
      theme: { mode: "dark" },
      state: {},
    });
    render(<MapWidget model={model} />);
    await screen.findByTestId("map");
    expect(
      seen.props?.spec.points.map((point: { label: string }) => point.label),
    ).toEqual(["New York", "London"]);
    expect(seen.props?.spec.valueLabel).toBe("Staff");
    await waitFor(() => expect(getShown()?.spec.points).toHaveLength(2));
    expect(document.documentElement.dataset.mode).toBe("dark");
  });

  it("reads the rows of an answer that holds them under results", async () => {
    const { model } = fakeModel({
      data: { results: ROWS },
      definition: MAPPING,
      state: {},
    });
    render(<MapWidget model={model} />);
    await screen.findByTestId("map");
    expect(seen.props?.spec.points).toHaveLength(2);
  });

  it("draws a GeoJSON answer", async () => {
    const geojson = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name: "A" },
          geometry: { type: "Point", coordinates: [-0.1, 51.5] },
        },
      ],
    };
    const { model } = fakeModel({ data: geojson, state: {} });
    render(<MapWidget model={model} />);
    await screen.findByTestId("map");
    expect(seen.props?.spec.points).toHaveLength(1);
  });

  it("says so when no row matches the selection", async () => {
    const { model } = fakeModel({ data: [], definition: MAPPING, state: {} });
    render(<MapWidget model={model} />);
    expect(await screen.findByRole("status")).toHaveTextContent("No locations match");
    expect(getShown()).toBeNull();
  });

  it("says why when the answer is no map", async () => {
    const { model } = fakeModel({ data: [{ a: 1 }], definition: MAPPING, state: {} });
    render(<MapWidget model={model} />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByTestId("map")).toBeNull();
  });

  it("keeps the tags, the shapes and the view of the reader in its state", async () => {
    const { model, saved, traits } = fakeModel({
      data: ROWS,
      definition: MAPPING,
      state: {},
    });
    render(<MapWidget model={model} />);
    await screen.findByTestId("map");
    act(() => seen.props?.onViewChange({ boundaries: ["us-states"] }));
    expect(traits.state).toEqual({ mapView: { boundaries: ["us-states"] } });
    act(() => seen.props?.onNotesChange({ "p:0": "Head office" }));
    expect(saved).toHaveLength(2);
    expect(traits.state).toMatchObject({
      mapNotes: { "p:0": "Head office" },
      mapView: { boundaries: ["us-states"] },
    });
    act(() => seen.props?.onNotesChange({}));
    expect(traits.state).not.toHaveProperty("mapNotes");
  });

  describe("the view it shares with the settings", () => {
    const PARIS = { center: [2.3522, 48.8566] as [number, number], zoom: 12, bearing: 0, pitch: 0 };
    const start = async (view: Record<string, unknown> = {}) => {
      const fake = fakeModel({ data: ROWS, definition: MAPPING, state: {}, ...view });
      render(<MapWidget model={fake.model} />);
      await screen.findByTestId("map");
      return fake;
    };

    it("does not move a map to the settings it opens with", async () => {
      await start({ viewLatitude: 10, viewLongitude: 20, viewZoom: 5 });
      expect(seen.props?.target).toBeNull();
    });

    it("moves the map when a setting changes", async () => {
      const { model } = await start({ viewLatitude: 10, viewLongitude: 20, viewZoom: 5 });
      act(() => {
        model.set("viewLatitude", 48.8566);
        model.set("viewLongitude", 2.3522);
        model.set("viewZoom", 12);
      });
      expect(seen.props?.target).toEqual({ center: [2.3522, 48.8566], zoom: 12 });
    });

    it("writes where the reader moved the map, and does not move it there again", async () => {
      const { traits } = await start();
      act(() => seen.props?.onViewChange({ camera: PARIS }));
      expect(traits).toMatchObject({
        viewLatitude: 48.8566,
        viewLongitude: 2.3522,
        viewZoom: 12,
        viewBearing: 0,
        viewPitch: 0,
      });
      expect(seen.props?.target).toBeNull();
    });

    it("does not move the map back when the host refuses the write", async () => {
      const { model } = await start({ viewLatitude: 10, viewLongitude: 20, viewZoom: 5 });
      act(() => seen.props?.onViewChange({ camera: PARIS }));
      act(() => {
        model.set("viewLatitude", 10);
        model.set("viewLongitude", 20);
        model.set("viewZoom", 5);
        model.set("viewBearing", undefined);
        model.set("viewPitch", undefined);
      });
      expect(seen.props?.target).toBeNull();
    });
  });
});
