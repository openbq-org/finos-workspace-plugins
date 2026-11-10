import { afterEach, describe, expect, it, vi } from "vitest";
import { addWidget, bindHost, copyText, notify, readAsset, readAssetJson } from "~/host";

afterEach(() => bindHost(null));

const answer = (text: string): [unknown, DataView[]] => [
  {},
  [new DataView(new TextEncoder().encode(text).buffer)],
];

describe("the host", () => {
  it("reads a file of the package under assets/", async () => {
    const invoke = vi.fn(async () => answer('{"a":1}'));
    bindHost(invoke);
    expect(await readAssetJson("geo/places/cities.json")).toEqual({ a: 1 });
    expect(invoke).toHaveBeenCalledWith(
      "core:asset:read",
      { path: "assets/geo/places/cities.json" },
      { timeout: 60_000 },
    );
    expect(new TextDecoder().decode(await readAsset("x.txt"))).toBe('{"a":1}');
  });

  it("copies text through the clipboard command", async () => {
    const invoke = vi.fn(async () => answer(""));
    bindHost(invoke);
    await copyText("40.1, -74.2");
    expect(invoke).toHaveBeenCalledWith(
      "core:clipboard:write",
      { text: "40.1, -74.2" },
      undefined,
    );
  });

  it("adds a widget of the plugin to the dashboard with its data", async () => {
    const invoke = vi.fn(async () => answer("{}"));
    bindHost(invoke);
    await addWidget("map", { points: [] });
    expect(invoke).toHaveBeenCalledWith("core:dashboard:add-widget", { widget: "map", data: { points: [] } }, undefined);
  });

  it("shows a notice, and does not fail when the host will not", async () => {
    const invoke = vi.fn(async () => {
      throw new Error("rate limited");
    });
    bindHost(invoke);
    notify("success", "View copied.");
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledWith("core:ui:notify", { level: "success", text: "View copied." }, undefined);
  });

  it("fails clearly when it is not connected", async () => {
    await expect(readAsset("x.txt")).rejects.toThrow("not connected to the host");
  });
});
