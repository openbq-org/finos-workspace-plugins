import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MapWidget from "~/MapWidget";
import { ACTION, setDriver } from "~/cardActions";
import { bindHost } from "~/host";
import { getShown, MAX_STATE_BYTES, type Model } from "~/widget";

const seen = vi.hoisted(() => ({ props: null as Record<string, any> | null }));
vi.mock("~/components/Geo/MapView", () => ({
  default: (props: Record<string, any>) => {
    seen.props = props;
    return <div data-testid="map" />;
  },
}));

function fakeModel(traits: Record<string, unknown>) {
  const listeners = new Map<string, Set<(...args: any[]) => void>>();
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
  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of [...(listeners.get(event) ?? [])]) listener(...args);
  };
  const listening = (event: string) => listeners.get(event)?.size ?? 0;
  return { model, traits, saved, emit, listening };
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
  bindHost(null);
  setDriver(null);
  vi.useRealTimers();
});

const notices = (invoke: ReturnType<typeof vi.fn>) =>
  invoke.mock.calls.filter(([name]) => name === "core:ui:notify").map(([, message]) => message);

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

    it("writes where the map is after the reader resets the view, so the settings do not keep the view that was left", async () => {
      const { traits } = await start({ viewLatitude: 10, viewLongitude: 20, viewZoom: 5 });
      setDriver({ fit: vi.fn(), reset: vi.fn(), camera: () => ({ latitude: 39.09761, longitude: -98.2127, zoom: 2.79, bearing: 0, pitch: 0 }) });
      act(() => seen.props?.onViewChange({}));
      expect(traits).toMatchObject({ viewLatitude: 39.09761, viewLongitude: -98.2127, viewZoom: 2.79, viewBearing: 0, viewPitch: 0 });
      expect(seen.props?.target).toBeNull();
    });

    it("leaves the settings alone when the view is reset before any map is drawn", async () => {
      const { traits } = await start({ viewLatitude: 10, viewLongitude: 20, viewZoom: 5 });
      act(() => seen.props?.onViewChange({}));
      expect(traits).toMatchObject({ viewLatitude: 10, viewLongitude: 20, viewZoom: 5 });
    });

    it("moves the map to the view it left when a preset or the agent asks for it a while after the reader moved it", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const { model } = await start({ viewLatitude: 10, viewLongitude: 20, viewZoom: 5 });
      act(() => seen.props?.onViewChange({ camera: PARIS }));
      vi.setSystemTime(Date.now() + 3_000);
      act(() => {
        model.set("viewLatitude", 10);
        model.set("viewLongitude", 20);
        model.set("viewZoom", 5);
        model.set("viewBearing", undefined);
        model.set("viewPitch", undefined);
      });
      expect(seen.props?.target).toEqual({ center: [20, 10], zoom: 5 });
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

  describe("the actions of the card", () => {
    const act1 = (id: string, extra: Record<string, unknown> = {}) => ({ kind: "workspace-event", name: "action", id, ...extra });

    it("reach the map that is drawn, and nothing else does", async () => {
      const { model, emit } = fakeModel({ data: ROWS, definition: MAPPING, state: {} });
      render(<MapWidget model={model} />);
      await screen.findByTestId("map");
      const map = { fit: vi.fn(), reset: vi.fn(), camera: () => ({ latitude: 1, longitude: 2, zoom: 3, bearing: 0, pitch: 0 }) };
      setDriver(map);
      emit("msg:custom", act1(ACTION.fit));
      emit("msg:custom", act1(ACTION.reset));
      emit("msg:custom", { kind: "workspace-event", name: "refresh" });
      emit("msg:custom", { kind: "workspace-event", name: "visibility", visible: false });
      emit("msg:custom", { kind: "anything-else", name: "action", id: ACTION.fit });
      emit("msg:custom", { kind: "workspace-event", name: "action", id: 7 });
      emit("msg:custom", null);
      emit("msg:custom", "action");
      expect(map.fit).toHaveBeenCalledTimes(1);
      expect(map.reset).toHaveBeenCalledTimes(1);
    });

    it("stop listening when the map goes", async () => {
      const { model, listening } = fakeModel({ data: ROWS, definition: MAPPING, state: {} });
      const { unmount } = render(<MapWidget model={model} />);
      await screen.findByTestId("map");
      expect(listening("msg:custom")).toBe(1);
      unmount();
      expect(listening("msg:custom")).toBe(0);
    });

    it("copy the view and add a static map through the host", async () => {
      const invoke = vi.fn(async (): Promise<[unknown, DataView[]]> => [{}, []]);
      bindHost(invoke);
      const { model, emit } = fakeModel({ data: ROWS, definition: MAPPING, state: {} });
      render(<MapWidget model={model} />);
      await screen.findByTestId("map");
      await waitFor(() => expect(getShown()).not.toBeNull());
      setDriver({ fit: vi.fn(), reset: vi.fn(), camera: () => ({ latitude: 51.5, longitude: -0.1, zoom: 9, bearing: 0, pitch: 0 }) });
      emit("msg:custom", act1(ACTION.copyView));
      await waitFor(() => expect(invoke).toHaveBeenCalledWith("core:clipboard:write", { text: "51.5, -0.1, zoom 9" }, undefined));
      emit("msg:custom", act1(ACTION.static));
      await waitFor(() => expect(invoke.mock.calls.some(([name]) => name === "core:dashboard:add-widget")).toBe(true));
      const added = invoke.mock.calls.find(([name]) => name === "core:dashboard:add-widget") as unknown as [string, { widget: string; data: { points: unknown[]; title: string } }];
      expect(added[1].widget).toBe("map");
      expect(added[1].data.points).toHaveLength(2);
    });
  });

  describe("the data table it shares with the settings", () => {
    const start = async (setting?: boolean) => {
      const fake = fakeModel({ data: ROWS, definition: MAPPING, state: {}, ...(setting === undefined ? {} : { dataTable: setting }) });
      render(<MapWidget model={fake.model} />);
      await screen.findByTestId("map");
      return fake;
    };

    it("opens as the setting says, and follows it when the card's button or the agent changes it", async () => {
      const { model } = await start(true);
      expect(seen.props?.dataOpen).toBe(true);
      act(() => model.set("dataTable", false));
      expect(seen.props?.dataOpen).toBe(false);
      act(() => model.set("dataTable", true));
      expect(seen.props?.dataOpen).toBe(true);
    });

    it("is closed when the setting is not set", async () => {
      await start();
      expect(seen.props?.dataOpen).toBe(false);
    });

    it("writes the setting when the reader opens or closes it in the map", async () => {
      const { traits, saved } = await start();
      act(() => seen.props?.onDataOpenChange(true));
      expect(traits.dataTable).toBe(true);
      expect(seen.props?.dataOpen).toBe(true);
      expect(saved).toHaveLength(1);
      act(() => seen.props?.onDataOpenChange(false));
      expect(traits.dataTable).toBe(false);
      expect(seen.props?.dataOpen).toBe(false);
    });

    it("stays open when the host refuses the write, as it does on a shared dashboard", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const { model } = await start(false);
      act(() => seen.props?.onDataOpenChange(true));
      act(() => model.set("dataTable", false));
      expect(seen.props?.dataOpen).toBe(true);
      vi.setSystemTime(Date.now() + 60_000);
      act(() => seen.props?.onDataOpenChange(false));
      expect(seen.props?.dataOpen).toBe(false);
    });

    it("closes when the card's button is pressed a moment after the reader opened it", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const { model } = await start(false);
      act(() => seen.props?.onDataOpenChange(true));
      vi.setSystemTime(Date.now() + 2_000);
      act(() => model.set("dataTable", false));
      expect(seen.props?.dataOpen).toBe(false);
    });
  });

  describe("the state it keeps in the dashboard", () => {
    const BIG = Object.fromEntries([...Array(200)].map((_, index) => [`p:${String(index % 90).padStart(2, "0")}.0000,${String(Math.floor(index / 90)).padStart(2, "0")}.${String(index).padStart(4, "0")}`, "n".repeat(80)]));

    it("is never sent over what the host takes, and tells the reader once", async () => {
      const invoke = vi.fn(async (): Promise<[unknown, DataView[]]> => [{}, []]);
      bindHost(invoke);
      const shapes = [...Array(160)].map((_, index) => ({ id: `s${index}`, type: "line", name: "n".repeat(60), note: "m".repeat(240), coordinates: [[0, 0], [1, 1]] }));
      const { model, traits, saved } = fakeModel({ data: ROWS, definition: MAPPING, state: { mapShapes: shapes } });
      render(<MapWidget model={model} />);
      await screen.findByTestId("map");
      const before = JSON.stringify(traits.state);
      expect(before.length).toBeLessThan(MAX_STATE_BYTES);
      expect(before.length + JSON.stringify(BIG).length).toBeGreaterThan(MAX_STATE_BYTES);
      act(() => seen.props?.onNotesChange(BIG));
      expect(JSON.stringify(traits.state)).toBe(before);
      expect(saved).toHaveLength(0);
      await waitFor(() => expect(notices(invoke)).toHaveLength(1));
      expect(notices(invoke)[0]).toMatchObject({ level: "warning", text: expect.stringContaining("64 KiB") });
    });

    describe("when the host answers a write", () => {
      const refusing = (traits: Record<string, unknown>, refuse: boolean) => {
        const fake = fakeModel(traits);
        const keep = fake.model.save_changes;
        fake.model.save_changes = () => {
          keep();
          if (refuse) fake.model.set("state", {});
        };
        return fake;
      };

      it("says so once when it refuses the change of a tag, as it does on a shared dashboard", async () => {
        const invoke = vi.fn(async (): Promise<[unknown, DataView[]]> => [{}, []]);
        bindHost(invoke);
        const { model, traits } = refusing({ data: ROWS, definition: MAPPING, state: {} }, true);
        render(<MapWidget model={model} />);
        await screen.findByTestId("map");
        act(() => seen.props?.onNotesChange({ "p:40.7128,-74.0060": "HQ" }));
        expect(traits.state).toEqual({});
        await waitFor(() => expect(notices(invoke)).toHaveLength(1));
        expect(notices(invoke)[0]).toMatchObject({ level: "warning", text: expect.stringContaining("did not keep") });
      });

      it("says nothing when it keeps the change, or when only the camera was refused", async () => {
        const invoke = vi.fn(async (): Promise<[unknown, DataView[]]> => [{}, []]);
        bindHost(invoke);
        const kept = refusing({ data: ROWS, definition: MAPPING, state: {} }, false);
        render(<MapWidget model={kept.model} />);
        await screen.findByTestId("map");
        act(() => seen.props?.onNotesChange({ "p:40.7128,-74.0060": "HQ" }));
        await Promise.resolve();
        expect(kept.traits.state).toEqual({ mapNotes: { "p:40.7128,-74.0060": "HQ" } });
        expect(notices(invoke)).toHaveLength(0);
        const camera = refusing({ data: ROWS, definition: MAPPING, state: {} }, true);
        render(<MapWidget model={camera.model} />);
        await waitFor(() => expect(screen.getAllByTestId("map")).toHaveLength(2));
        act(() => seen.props?.onViewChange({ boundaries: ["us-states"] }));
        await Promise.resolve();
        expect(notices(invoke)).toHaveLength(0);
      });

      it("does not blame a change that arrives after the answer was due", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        const invoke = vi.fn(async (): Promise<[unknown, DataView[]]> => [{}, []]);
        bindHost(invoke);
        const { model } = refusing({ data: ROWS, definition: MAPPING, state: {} }, false);
        render(<MapWidget model={model} />);
        await screen.findByTestId("map");
        act(() => seen.props?.onNotesChange({ "p:40.7128,-74.0060": "HQ" }));
        vi.setSystemTime(Date.now() + 5_000);
        act(() => model.set("state", {}));
        await Promise.resolve();
        expect(notices(invoke)).toHaveLength(0);
      });
    });

    it("keeps a small change when the state is nearly full, without a word about the camera", async () => {
      const invoke = vi.fn(async (): Promise<[unknown, DataView[]]> => [{}, []]);
      bindHost(invoke);
      const shapes = [...Array(100)].map((_, index) => ({ id: `s${index}`, type: "line", name: "n".repeat(60), note: "m".repeat(240), coordinates: [[0, 0], [1, 1]] }));
      const { model, traits } = fakeModel({ data: ROWS, definition: MAPPING, state: { mapShapes: shapes, mapNotes: BIG } });
      render(<MapWidget model={model} />);
      await screen.findByTestId("map");
      const size = new TextEncoder().encode(JSON.stringify(traits.state)).byteLength;
      expect(size).toBeLessThanOrEqual(MAX_STATE_BYTES);
      act(() => seen.props?.onViewChange({ boundaries: ["us-states"], camera: { center: [0, 0], zoom: 3, held: true, of: [0, 0, 1, 1], box: [0, 0, 1, 1] } }));
      await Promise.resolve();
      expect(notices(invoke).filter((message) => String((message as { text: string }).text).includes("64 KiB"))).toHaveLength(0);
    });
  });
});
