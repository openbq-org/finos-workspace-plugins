import { afterEach, describe, expect, it, vi } from "vitest";
import { runAction, viewText } from "~/actions";
import { ACTION, type CardDriver, setDriver } from "~/cardActions";
import { bindHost } from "~/host";
import { widgetMap } from "~/lib/geo/mapData";
import { setShown } from "~/widget";

const CAMERA = { latitude: 48.85661234, longitude: 2.35224567, zoom: 12.3456, bearing: 0, pitch: 0 };

const driver = (): CardDriver & { fit: ReturnType<typeof vi.fn>; reset: ReturnType<typeof vi.fn> } => ({
  fit: vi.fn(),
  reset: vi.fn(),
  camera: () => CAMERA,
});

const invoker = (fail?: (name: string) => Error | undefined) =>
  vi.fn(async (name: string): Promise<[unknown, DataView[]]> => {
    const error = fail?.(name);
    if (error) throw error;
    return [{}, []];
  });

const calls = (invoke: ReturnType<typeof invoker>, name: string) =>
  invoke.mock.calls.filter(([called]) => called === name).map(([, message]) => message);

const show = (rows: unknown[], mapping: unknown) => {
  const made = widgetMap(rows, mapping, []);
  if (!made?.spec) throw new Error("no map");
  setShown({ spec: made.spec, name: "Offices", notes: {}, shapes: [], view: undefined });
};

const OFFICES = [{ name: "London", lat: 51.5072, lon: -0.1276, staff: 85 }];
const MAPPING = { lat: "lat", lon: "lon", label: "name", value: "staff", title: "Offices" };

afterEach(() => {
  bindHost(null);
  setDriver(null);
  setShown(null);
});

describe("the actions of the card", () => {
  it("show all the data, or go back to the opening view, as the toolbar of the map does", async () => {
    const map = driver();
    setDriver(map);
    await runAction(ACTION.fit);
    expect(map.fit).toHaveBeenCalledTimes(1);
    expect(map.reset).not.toHaveBeenCalled();
    await runAction(ACTION.reset);
    expect(map.reset).toHaveBeenCalledTimes(1);
  });

  it("do nothing when no map is drawn, and ignore an id they do not know", async () => {
    const invoke = invoker();
    bindHost(invoke);
    await runAction(ACTION.fit);
    await runAction(ACTION.reset);
    await runAction("somewhere-else");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("copy where the map is looking as the latitude, the longitude and the zoom", async () => {
    const invoke = invoker();
    bindHost(invoke);
    setDriver(driver());
    await runAction(ACTION.copyView);
    expect(calls(invoke, "core:clipboard:write")).toEqual([{ text: "48.85661, 2.35225, zoom 12.35" }]);
    expect(calls(invoke, "core:ui:notify")).toEqual([{ level: "success", text: "View copied." }]);
    expect(viewText({ ...CAMERA, latitude: 10, longitude: -20, zoom: 4 })).toBe("10, -20, zoom 4");
  });

  it("say so when the browser refuses the copy, or the map is not drawn", async () => {
    const invoke = invoker((name) => (name === "core:clipboard:write" ? new Error("the browser refused the write") : undefined));
    bindHost(invoke);
    await runAction(ACTION.copyView);
    expect(calls(invoke, "core:ui:notify")).toEqual([{ level: "warning", text: "The map is not drawn yet." }]);
    setDriver(driver());
    await runAction(ACTION.copyView);
    expect(calls(invoke, "core:ui:notify").at(-1)).toEqual({ level: "error", text: "the browser refused the write" });
  });

  it("add a static copy of the map to the dashboard, where the reader is looking", async () => {
    const invoke = invoker();
    bindHost(invoke);
    setDriver(driver());
    show(OFFICES, MAPPING);
    await runAction(ACTION.static);
    expect(calls(invoke, "core:dashboard:add-widget")).toEqual([
      {
        widget: "map",
        data: {
          title: "Offices",
          points: [{ lat: 51.5072, lon: -0.1276, label: "London", value: 85 }],
          view: { center: { lat: 48.85661, lon: 2.35225 }, zoom: 12.35, bearing: 0, pitch: 0 },
        },
      },
    ]);
    expect(calls(invoke, "core:ui:notify")).toEqual([{ level: "success", text: "Static map created." }]);
  });

  it("add it without a view when the map is not drawn", async () => {
    const invoke = invoker();
    bindHost(invoke);
    show(OFFICES, MAPPING);
    await runAction(ACTION.static);
    expect(calls(invoke, "core:dashboard:add-widget")[0]).not.toHaveProperty("data.view");
  });

  it("say why nothing was added: a map of lines, or a dashboard that refuses", async () => {
    const invoke = invoker((name) => (name === "core:dashboard:add-widget" ? new Error("a shared dashboard is read-only") : undefined));
    bindHost(invoke);
    await runAction(ACTION.static);
    expect(calls(invoke, "core:ui:notify")).toEqual([{ level: "warning", text: "This map has no points, US states or countries to copy." }]);
    expect(calls(invoke, "core:dashboard:add-widget")).toEqual([]);
    show(OFFICES, MAPPING);
    await runAction(ACTION.static);
    expect(calls(invoke, "core:ui:notify").at(-1)).toEqual({ level: "error", text: "a shared dashboard is read-only" });
  });
});
