import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Basemap } from "~/components/Geo/basemap";
import { useMapData } from "~/components/Geo/useMapData";
import type { HeldMapSource } from "~/lib/geo/mapSourceTypes";
import { mapSpec } from "~/lib/geo/mapSpec";
import type { MapSpec } from "~/lib/geo/mapSpecTypes";

interface Asked {
  what: string;
  signal?: AbortSignal;
  answer: (value?: unknown) => void;
  fail: (cause: Error) => void;
}
const asked = vi.hoisted(() => [] as Asked[]);
const ask = vi.hoisted(
  () => (what: string, value: unknown, signal?: AbortSignal) =>
    new Promise((resolve, reject) => {
      asked.push({
        what,
        signal,
        answer: (given = value) => resolve(given),
        fail: reject,
      });
    }),
);
const LIB = vi.hoisted(() => ({ name: "maplibre" }));
vi.mock("~/components/Geo/mapLibrary", () => ({
  loadMapLibrary: () => ask("library", LIB),
}));
vi.mock("~/lib/geo/regions/boundaries", () => ({
  loadBoundaries: (set: string, signal?: AbortSignal) =>
    ask(
      set,
      { set, ...(set === "us-counties" ? { land: {}, outer: {} } : {}) },
      signal,
    ),
}));
vi.mock("~/lib/geo/regions/registry", () => ({
  loadRegionIndex: (set: string, signal?: AbortSignal) =>
    ask(`index:${set}`, null, signal),
  loadRegionShapes: (set: string, ids: Set<string>, signal?: AbortSignal) =>
    ask(`shapes:${set}:${[...ids].sort().join("+")}`, [], signal),
  matchRegion: (_set: string, code: string) => ({ id: `id-${code}` }),
  regionInfo: () => null,
}));
const basemaps = vi.hoisted(
  () => [] as { theme: string; answer: (b: unknown) => void }[],
);
const archives = vi.hoisted(() => ({
  read: [] as { sources: unknown; done: () => void; fail: () => void }[],
}));
vi.mock("~/components/Geo/basemap", () => ({
  loadBasemap: (_lib: unknown, _choice: unknown, theme: string) =>
    new Promise((resolve) => basemaps.push({ theme, answer: resolve })),
  readHeldArchives: (_lib: unknown, sources: unknown) =>
    new Promise<void>((resolve, reject) =>
      archives.read.push({
        sources,
        done: resolve,
        fail: () => reject(new Error("x")),
      }),
    ),
}));

const what = () => asked.map((item) => item.what).sort();
const answerAll = async () => {
  for (let round = 0; round < 3; round++)
    await act(async () => {
      for (const item of asked) item.answer();
    });
};
const mounted = (first: MapSpec) => {
  const onFail = vi.fn();
  const hook = renderHook(({ spec }) => useMapData(spec, onFail), {
    initialProps: { spec: first },
  });
  return { hook, onFail, data: () => hook.result.current };
};

const POINTS_US = mapSpec({ points: [{ lat: 40, lon: -100 }] });
const STATES = mapSpec({
  regions: { set: "us-states", items: [{ code: "CA", value: 1 }] },
});
const COUNTIES = mapSpec({
  regions: { set: "us-counties", items: [{ code: "06037", value: 1 }] },
});
const WORLD = mapSpec({ points: [{ lat: 48.8, lon: 2.3 }] });
const countries = (...codes: string[]) =>
  mapSpec({
    regions: { set: "countries", items: codes.map((code) => ({ code, value: 1 })) },
  });

beforeEach(() => {
  asked.length = 0;
  basemaps.length = 0;
  archives.read.length = 0;
});

describe("the files a map is drawn from", () => {
  it("asks for the library, the countries and the states of a map of the United States together", () => {
    mounted(POINTS_US);
    expect(what()).toEqual(["countries", "library", "us-states"]);
  });

  it("asks for no states file for a map elsewhere, and for a county map", () => {
    mounted(WORLD);
    expect(what()).toEqual(["countries", "library"]);
    asked.length = 0;
    mounted(COUNTIES);
    expect(what()).toEqual(["countries", "library", "us-counties"]);
  });

  it("is nothing until every file is there, then the files with the map they are for", async () => {
    const { data } = mounted(STATES);
    expect(data()).toBeNull();
    await act(async () => asked[0].answer());
    expect(data()).toBeNull();
    await answerAll();
    expect(data()).toMatchObject({
      lib: LIB,
      world: { set: "countries" },
      states: { set: "us-states" },
      sets: { "us-states": { set: "us-states" } },
    });
    expect(data()?.spec).toBe(STATES);
  });

  it("gives the states of a county map as the file of the counties has them", async () => {
    const { data } = mounted(COUNTIES);
    await answerAll();
    expect(data()?.states).toBeNull();
    expect(data()?.sets["us-counties"]).toMatchObject({ land: {}, outer: {} });
  });

  it("reads only the files that hold the regions of the map, by their index", async () => {
    mounted(countries("FR", "DE"));
    expect(what()).toEqual(["countries", "index:countries", "library"]);
    await act(async () => {
      for (const item of asked) item.answer();
    });
    expect(what()).toContain("shapes:countries:250+276");
  });

  it("takes a new map of the same files at once, and asks for nothing", async () => {
    const { hook, data } = mounted(STATES);
    await answerAll();
    const files = data();
    const before = asked.length;
    const next = mapSpec({
      regions: { set: "us-states", items: [{ code: "TX", value: 9 }] },
    });
    hook.rerender({ spec: next });
    expect(asked).toHaveLength(before);
    expect(data()?.spec).toBe(next);
    expect(data()?.sets).toBe(files?.sets);
    expect(data()?.lib).toBe(LIB);
  });

  it("keeps the map before, whole, while the files of a new map are on their way", async () => {
    const { hook, data } = mounted(countries("FR"));
    await answerAll();
    const france = data();
    const next = countries("JP");
    hook.rerender({ spec: next });
    expect(data()?.spec).toBe(france?.spec);
    expect(data()?.sets).toBe(france?.sets);
    await answerAll();
    expect(data()?.spec).toBe(next);
    expect(data()?.sets).not.toBe(france?.sets);
    expect(data()?.lib).toBe(france?.lib);
  });

  it("says that the countries did not load, once, and not for a map that is gone", async () => {
    const countriesFile = () => asked.find((item) => item.what === "countries");
    const first = mounted(STATES);
    await act(async () => countriesFile()?.fail(new Error("offline")));
    expect(first.onFail).toHaveBeenCalledTimes(1);
    expect(first.data()).toBeNull();
    asked.length = 0;
    const second = mounted(STATES);
    const signals = asked.flatMap((item) => (item.signal ? [item.signal] : []));
    expect(signals.length).toBeGreaterThan(0);
    second.hook.unmount();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    await act(async () => countriesFile()?.fail(new Error("offline")));
    expect(second.onFail).not.toHaveBeenCalled();
  });

  it("gives the files that loaded when the file of one set did not, and names that set", async () => {
    const { data, onFail } = mounted(
      mapSpec({
        layers: [
          {
            id: "a",
            kind: "regions",
            regions: { set: "us-states", items: [{ code: "CA" }] },
          },
          {
            id: "b",
            kind: "regions",
            regions: { set: "countries", items: [{ code: "250" }] },
          },
        ],
      }),
    );
    await act(async () => {
      for (const item of asked)
        if (item.what === "us-states") item.fail(new Error("offline"));
    });
    await answerAll();
    expect(onFail).not.toHaveBeenCalled();
    expect(data()).toMatchObject({
      lib: LIB,
      world: { set: "countries" },
      unloaded: ["us-states"],
    });
    expect(Object.keys(data()?.sets ?? {})).toEqual(["countries"]);
  });

  it("draws a map of the United States without the lines of the states when their file did not load", async () => {
    const { data, onFail } = mounted(POINTS_US);
    await act(async () =>
      asked.find((item) => item.what === "us-states")?.fail(new Error("offline")),
    );
    await answerAll();
    expect(onFail).not.toHaveBeenCalled();
    expect(data()).toMatchObject({
      world: { set: "countries" },
      states: null,
      unloaded: [],
    });
  });

  it("drops the answer for a map that was replaced before it came", async () => {
    const { hook, data } = mounted(countries("FR"));
    const old = [...asked];
    hook.rerender({ spec: STATES });
    expect(old.some((item) => item.signal?.aborted)).toBe(true);
    await answerAll();
    expect(data()?.spec).toBe(STATES);
    expect(Object.keys(data()?.sets ?? {})).toEqual(["us-states"]);
  });
});
