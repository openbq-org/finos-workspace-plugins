import { afterEach, beforeEach, describe, expect, it, type Mock } from "vitest";
import {
  applyMapView,
  columnsShown,
  failedLayer,
  groupedLayers,
  sceneFrame,
  shownMarks,
  tallBuildingsShown,
} from "~/components/Geo/applyMapView";
import type { Basemap } from "~/components/Geo/basemap";
import { contextLayers } from "~/components/Geo/basemapContext";
import type { Scene } from "~/components/Geo/scene/sceneTypes";
import { expectNoUseAfterRemove, FakeMap } from "./fakeMap";
import { held, scene } from "./scene/support";

afterEach(expectNoUseAfterRemove);
beforeEach(() => FakeMap.reset());

type Call = [string, ...unknown[]];

const fakeMap = (built: Scene, missing: string[] = []) => {
  const made = new FakeMap();
  made.setStyle({
    sources: built.sources,
    layers: built.style.filter((layer) => !missing.includes(layer.id)),
  });
  made.loadStyle();
  const calls: Call[] = [];
  const data: Record<string, unknown> = {};
  const kept = (kind: string, told: Mock<(...given: unknown[]) => void>) => {
    const tell = told.getMockImplementation();
    told.mockImplementation((...given: unknown[]) => {
      if (kind === "data") {
        data[given[0] as string] = given[1];
        calls.push(["data", given[0]]);
      } else calls.push([kind, ...given]);
      tell?.(...given);
    });
  };
  kept("layout", made.setLayoutProperty);
  kept("paint", made.setPaintProperty);
  kept("filter", made.setFilter);
  kept("data", made.setData);
  kept("clusters", made.setClusterOptions);
  return { map: made.map, calls, data };
};
const of = (calls: Call[], kind: string, id: string) =>
  calls
    .filter((call) => call[0] === kind && call[1] === id)
    .map((call) => call.slice(2));

const spec = {
  regions: { set: "us-states", items: [{ code: "CA", value: 5 }] },
  layers: [
    {
      id: "sites",
      kind: "points",
      opacity: 0.5,
      points: [
        { lat: 40, lon: -100, time: "2023", label: "a" },
        { lat: 41, lon: -101, time: "2024", label: "b" },
        { lat: 42, lon: -102, label: "always" },
      ],
    },
    { id: "off", kind: "points", visible: false, points: [{ lat: 30, lon: -90 }] },
  ],
};

describe("sceneFrame", () => {
  const built = scene(spec);
  it("is the step of the reader when the map has it, else the last one", () => {
    expect(sceneFrame(built, {})).toBe("2024");
    expect(sceneFrame(built, { frame: "2023" })).toBe("2023");
    expect(sceneFrame(built, { frame: "1999" })).toBe("2024");
    expect(sceneFrame(scene({ points: [{ lat: 1, lon: 1 }] }), { frame: "2023" })).toBe(
      undefined,
    );
  });

  it("opens on the step the map names, until the reader chooses another", () => {
    const opening = scene({ ...spec, frame: "2023" });
    expect(opening.frame).toBe("2023");
    expect(sceneFrame(opening, {})).toBe("2023");
    expect(sceneFrame(opening, { frame: "2024" })).toBe("2024");
    expect(sceneFrame(opening, { frame: "1999" })).toBe("2023");
    expect(built.frame).toBe("2024");
  });

  it("opens on the latest step that is not nearly empty: a last month with two incidents is no opening", () => {
    const months = ["2025-10", "2025-11", "2025-12"];
    const counts = [12, 9, 2];
    const incidents = scene({
      layers: [
        {
          id: "incidents",
          kind: "heat",
          points: months.flatMap((time, at) =>
            Array.from({ length: counts[at] }, (_, n) => ({ lat: n, lon: at, time })),
          ),
        },
      ],
    });
    expect(incidents.frames).toEqual(months);
    expect(sceneFrame(incidents, {})).toBe("2025-11");
    expect(sceneFrame(incidents, { frame: "2025-12" })).toBe("2025-12");
  });
});

describe("applyMapView", () => {
  const built = scene(spec);

  it("shows each layer as the map says when the reader changed nothing", () => {
    const { map, calls } = fakeMap(built);
    applyMapView(map, built, {}, "2024");
    expect(of(calls, "layout", "regions")).toEqual([["visibility", "visible"]]);
    expect(of(calls, "layout", "regions-hover")).toEqual([["visibility", "visible"]]);
    expect(of(calls, "layout", "l:off")).toEqual([["visibility", "none"]]);
    expect(of(calls, "paint", "regions")).toEqual([["fill-opacity", 1]]);
    expect(of(calls, "paint", "l:sites")).toEqual([
      ["circle-opacity", 0.46],
      ["circle-stroke-opacity", 0.5],
    ]);
  });

  it("applies what the reader switched: a layer off, one on, an opacity", () => {
    const { map, calls } = fakeMap(built);
    applyMapView(
      map,
      built,
      { hidden: ["regions"], shown: ["off"], opacity: { sites: 1, regions: 0.25 } },
      "2024",
    );
    for (const part of built.layers[0].parts)
      expect(of(calls, "layout", part.id)).toEqual([["visibility", "none"]]);
    expect(of(calls, "layout", "l:off")).toEqual([["visibility", "visible"]]);
    expect(of(calls, "paint", "l:sites")[0]).toEqual(["circle-opacity", 0.92]);
    expect(of(calls, "paint", "regions")).toEqual([["fill-opacity", 0.25]]);
  });

  it("shows the marks of one step, and those that are on every step", () => {
    const { map, calls } = fakeMap(built);
    applyMapView(map, built, {}, "2023");
    const step = ["any", ["!", ["has", "t"]], ["==", ["get", "t"], "2023"]];
    expect(of(calls, "filter", "l:sites")).toEqual([
      [["all", ["!", ["has", "point_count"]], step]],
    ]);
    expect(of(calls, "data", "l:sites")).toEqual([]);
    expect(of(calls, "filter", "l:sites-hover")).toEqual([]);
    expect(of(calls, "filter", "regions")).toEqual([]);
  });

  it("keeps the filter a layer of the style has besides its step", () => {
    const timed = scene({
      regions: {
        set: "us-states",
        items: [
          { code: "DC", value: 1, time: "1" },
          { code: "DC", value: 2, time: "2" },
          { code: "CA", value: 3, time: "1" },
        ],
      },
    });
    const { map, calls } = fakeMap(timed);
    applyMapView(map, timed, {}, "2");
    expect(of(calls, "filter", "regions-small")).toEqual([
      [
        [
          "all",
          ["<", ["zoom"], ["get", "z"]],
          ["any", ["!", ["has", "t"]], ["==", ["get", "t"], "2"]],
        ],
      ],
    ]);
  });

  it("gives a source of clusters the points of the step, once for each step", () => {
    const clustered = scene({
      layers: [
        {
          id: "c",
          kind: "clusters",
          points: [
            { lat: 1, lon: 1, time: "1" },
            { lat: 2, lon: 2, time: "2" },
            { lat: 3, lon: 3 },
          ],
        },
      ],
    });
    const { map, calls, data } = fakeMap(clustered);
    applyMapView(map, clustered, {}, "1");
    applyMapView(map, clustered, { legend: "closed" }, "1");
    expect(of(calls, "data", "l:c")).toHaveLength(1);
    expect(
      (data["l:c"] as { features: { properties: { i: number } }[] }).features.map(
        (item) => item.properties.i,
      ),
    ).toEqual([0, 2]);
    applyMapView(map, clustered, {}, "2");
    expect(of(calls, "data", "l:c")).toHaveLength(2);
  });

  it("gives the points of the step again to the same map when it has a new style", () => {
    const points = [
      { lat: 1, lon: 1, time: "1" },
      { lat: 2, lon: 2, time: "2" },
      { lat: 3, lon: 3 },
    ];
    const light = scene({ layers: [{ id: "c", kind: "clusters", points }] });
    const dark = scene({ layers: [{ id: "c", kind: "clusters", points }] });
    const { map, calls, data } = fakeMap(light);
    applyMapView(map, light, {}, "2");
    expect(of(calls, "data", "l:c")).toHaveLength(1);
    applyMapView(map, dark, {}, "2");
    expect(of(calls, "data", "l:c")).toHaveLength(2);
    expect(
      (data["l:c"] as { features: { properties: { i: number } }[] }).features.map(
        (item) => item.properties.i,
      ),
    ).toEqual([1, 2]);
    applyMapView(map, dark, { legend: "closed" }, "2");
    expect(of(calls, "data", "l:c")).toHaveLength(2);
  });

  it("switches the names, the roads and the borders of the backdrop", () => {
    const { map, calls } = fakeMap(built);
    applyMapView(map, built, { basemap: { borders: false } }, "2024");
    expect(of(calls, "layout", "state-borders")).toEqual([["visibility", "none"]]);
    expect(of(calls, "layout", "world-borders")).toEqual([["visibility", "none"]]);
    const shown = fakeMap(built);
    applyMapView(shown.map, built, {}, "2024");
    expect(of(shown.calls, "layout", "state-borders")).toEqual([
      ["visibility", "visible"],
    ]);
  });

  it("asks nothing of a layer the style does not have yet", () => {
    const { map, calls } = fakeMap(
      built,
      built.style.map((layer) => layer.id),
    );
    expect(() =>
      applyMapView(map, built, { hidden: ["regions"] }, "2023"),
    ).not.toThrow();
    expect(calls).toEqual([]);
  });
});

describe("shownMarks", () => {
  const built = scene(spec);
  const labels = (view: object, frame?: string) =>
    built.marks
      .filter(shownMarks(built, view, frame))
      .map((mark) => `${mark.layer}:${mark.tag ?? mark.label ?? ""}`);

  it("keeps the marks of the visible layers on the step of the map", () => {
    expect(labels({}, "2024")).toEqual([
      "regions:California",
      "sites:b",
      "sites:always",
    ]);
    expect(labels({}, "2023")).toEqual([
      "regions:California",
      "sites:a",
      "sites:always",
    ]);
    expect(labels({ hidden: ["sites"], shown: ["off"] }, "2024")).toEqual([
      "regions:California",
      "off:",
    ]);
  });
});

describe("columnsShown", () => {
  const built = scene({
    points: [{ lat: 1, lon: 1 }],
    layers: [{ id: "bars", kind: "columns", points: [{ lat: 2, lon: 2, value: 1 }] }],
  });
  it("says whether a layer of columns is visible: the map is tilted only then", () => {
    expect(columnsShown(built, {})).toBe(true);
    expect(columnsShown(built, { hidden: ["bars"] })).toBe(false);
    expect(columnsShown(scene({ points: [{ lat: 1, lon: 1 }] }), {})).toBe(false);
  });
});

describe("failedLayer", () => {
  const built = scene(
    {
      points: [{ lat: 1, lon: 1 }],
      layers: [{ id: "green", kind: "source", source: "ndvi" }],
    },
    { held: { sources: [held()], ambiguous: [] } },
  );
  it("names the layer of a source that failed, and no layer for anything else", () => {
    expect(failedLayer(built, { sourceId: "l:green" })).toBe("green");
    expect(failedLayer(built, { sourceId: "points" })).toBeNull();
    expect(failedLayer(built, { sourceId: "constructor" })).toBeNull();
    expect(failedLayer(built, {})).toBeNull();
    expect(failedLayer(built, null)).toBeNull();
  });
});

describe("the context layers of the basemap, as the reader has them", () => {
  const basemap = (dataZoom: number): Basemap => ({
    kind: "hosted",
    source: { type: "vector", url: "pmtiles://https://app.example/us.pmtiles" },
    under: [{ id: "water", type: "fill", source: "basemap", "source-layer": "water" }],
    labels: [],
    maxZoom: 17,
    detailZoom: dataZoom,
    credit: "Protomaps",
    schema: "protomaps",
    context: contextLayers("protomaps", "light", () => true, dataZoom),
  });
  const points = [{ lat: 41.59, lon: -93.62 }];
  const visibility = (calls: Call[], id: string) => of(calls, "layout", id).at(-1)?.[1];

  it("shows what the map asks for and what the reader turned on, and nothing else", () => {
    const built = scene({ points, context: ["green"] }, { basemap: basemap(15) });
    const { map, calls } = fakeMap(built);
    applyMapView(map, built, { basemap: { context: ["buildings"] } }, undefined);
    expect(visibility(calls, "context-green")).toBe("visible");
    expect(visibility(calls, "context-green-cover")).toBe("visible");
    expect(visibility(calls, "context-buildings")).toBe("visible");
    expect(visibility(calls, "context-buildings-3d")).toBe("none");
    expect(visibility(calls, "context-pois")).toBe("none");
    expect(visibility(calls, "context-pois-names")).toBe("none");
    expect(visibility(calls, "context-railways")).toBe("none");
  });

  it("lets the reader turn off what the map asks for", () => {
    const built = scene(
      { points, context: ["green", "pois"] },
      { basemap: basemap(15) },
    );
    const { map, calls } = fakeMap(built);
    applyMapView(map, built, { basemap: { contextOff: ["green"] } }, undefined);
    expect(visibility(calls, "context-green")).toBe("none");
    expect(visibility(calls, "context-pois")).toBe("visible");
    expect(visibility(calls, "context-pois-names")).toBe("visible");
  });

  it("asks nothing for a context layer the tiles do not hold", () => {
    const built = scene(
      { points, context: ["buildings", "pois"] },
      { basemap: basemap(6) },
    );
    const { map, calls } = fakeMap(built);
    applyMapView(map, built, { basemap: { context: ["railways"] } }, undefined);
    expect(calls.filter((call) => String(call[1]).startsWith("context-"))).toEqual(
      built.context.flatMap((layer) =>
        layer.ids.map((id) => ["layout", id, "visibility", "none"]),
      ),
    );
    expect(built.context.flatMap((layer) => layer.ids).length).toBeGreaterThan(0);
  });

  it("says whether buildings that stand are drawn: the map can be tilted only then", () => {
    const deep = scene({ points }, { basemap: basemap(15) });
    expect(tallBuildingsShown(deep, {})).toBe(false);
    expect(tallBuildingsShown(deep, { basemap: { context: ["buildings-3d"] } })).toBe(
      true,
    );
    expect(tallBuildingsShown(deep, { basemap: { context: ["buildings"] } })).toBe(
      false,
    );
    const asked = scene(
      { points, context: ["buildings-3d"] },
      { basemap: basemap(15) },
    );
    expect(tallBuildingsShown(asked, {})).toBe(true);
    expect(
      tallBuildingsShown(asked, { basemap: { contextOff: ["buildings-3d"] } }),
    ).toBe(false);
    const shallow = scene(
      { points, context: ["buildings-3d"] },
      { basemap: basemap(6) },
    );
    expect(tallBuildingsShown(shallow, {})).toBe(false);
    const plain = scene(
      { points, context: ["buildings-3d"] },
      { basemap: basemap(15), choice: "plain" },
    );
    expect(tallBuildingsShown(plain, {})).toBe(false);
  });
});

describe("the close points of a layer, drawn as one counted circle", () => {
  const crowd = {
    layers: [
      {
        id: "sites",
        kind: "points",
        points: [
          { lat: 1, lon: 1, time: "2023" },
          { lat: 1, lon: 1, time: "2024" },
          { lat: 2, lon: 2 },
        ],
      },
    ],
  };
  const on = { cluster: true, clusterRadius: 30, clusterMaxZoom: 12 };

  it("are grouped where the map is crowded, and the source holds the points of the step", () => {
    const built = scene(crowd);
    const { map, calls, data } = fakeMap(built);
    applyMapView(map, built, {}, "2024", new Set(["sites"]));
    expect(of(calls, "clusters", "l:sites")).toEqual([[on]]);
    const given = data["l:sites"] as { features: { properties: { t?: string } }[] };
    expect(given.features.map((item) => item.properties.t)).toEqual([
      "2024",
      undefined,
    ]);
    applyMapView(map, built, {}, "2024", new Set(["sites"]));
    expect(of(calls, "clusters", "l:sites")).toHaveLength(1);
    expect(of(calls, "data", "l:sites")).toHaveLength(1);
  });

  it("are left apart on a map that is not crowded: nothing is asked of the source", () => {
    const built = scene(crowd);
    const { map, calls } = fakeMap(built);
    applyMapView(map, built, {}, "2024");
    expect(of(calls, "clusters", "l:sites")).toEqual([]);
    expect(of(calls, "data", "l:sites")).toEqual([]);
  });

  it("follow the reader: apart on a crowded map, grouped on one that is not", () => {
    const built = scene(crowd);
    const apart = fakeMap(built);
    applyMapView(
      apart.map,
      built,
      { ungrouped: ["sites"] },
      "2024",
      new Set(["sites"]),
    );
    expect(of(apart.calls, "clusters", "l:sites")).toEqual([]);
    const grouped = fakeMap(built);
    applyMapView(grouped.map, built, { grouped: ["sites"] }, "2024");
    expect(of(grouped.calls, "clusters", "l:sites")).toEqual([[on]]);
    applyMapView(grouped.map, built, {}, "2024");
    expect(of(grouped.calls, "clusters", "l:sites").at(-1)).toEqual([
      { ...on, cluster: false },
    ]);
    expect((grouped.data["l:sites"] as { features: unknown[] }).features).toHaveLength(
      3,
    );
  });

  it("says which layers are grouped: a layer of clusters always, a layer of points as above", () => {
    const built = scene({
      layers: [
        ...crowd.layers,
        { id: "c", kind: "clusters", points: [{ lat: 1, lon: 1 }] },
      ],
    });
    expect([...groupedLayers(built, {}, new Set())]).toEqual(["c"]);
    expect([...groupedLayers(built, {}, new Set(["sites"]))].sort()).toEqual([
      "c",
      "sites",
    ]);
    expect([
      ...groupedLayers(built, { ungrouped: ["sites"] }, new Set(["sites"])),
    ]).toEqual(["c"]);
  });
});
