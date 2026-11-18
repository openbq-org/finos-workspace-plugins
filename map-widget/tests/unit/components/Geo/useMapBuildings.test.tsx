import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUILDINGS_NOTE, mapNote } from "~/components/Geo/mapWords";
import {
  BUILDING_LAYERS,
  BUILDING_MARKS,
  BUILDING_PROBE,
  buildingMarks,
  onFootprint,
  useMapBuildings,
} from "~/components/Geo/useMapBuildings";
import { mapSpec } from "~/lib/geo/mapSpec";
import { expectNoUseAfterRemove, FakeMap } from "./fakeMap";
import { scene, theme } from "./scene/support";

beforeEach(() => FakeMap.reset());
afterEach(expectNoUseAfterRemove);

const OFFICE = { lat: 40.7527, lon: -73.9772, label: "Office", highlight: "building" };
const ELSEWHERE = { lat: 40.7, lon: -74.02, label: "Pier", highlight: "building" };
const square = (lon: number, lat: number, half = 0.0005) => ({
  type: "Polygon",
  coordinates: [
    [
      [lon - half, lat - half],
      [lon + half, lat - half],
      [lon + half, lat + half],
      [lon - half, lat + half],
      [lon - half, lat - half],
    ],
  ],
});
const footprint = (lon: number, lat: number, properties = {}, half?: number) => ({
  layer: { id: BUILDING_PROBE },
  properties,
  geometry: square(lon, lat, half),
});

const spec = mapSpec({ points: [OFFICE, ELSEWHERE], shapes: [] });
const plain = scene(spec);
const detailed = {
  ...plain,
  context: [
    {
      id: "buildings" as const,
      label: "Buildings",
      from: 13,
      ids: ["context-buildings"],
    },
  ],
  style: [
    ...plain.style,
    {
      id: "context-buildings",
      type: "fill",
      source: "basemap",
      "source-layer": "building",
    },
  ],
} as typeof plain;

const mount = (of = detailed, map = spec) => {
  const fake = new FakeMap();
  fake.setStyle({ sources: of.sources, layers: of.style }, { diff: false });
  fake.loadStyle();
  fake.zoom = 15;
  fake.bounds = [-74.05, 40.68, -73.9, 40.8];
  const hook = renderHook(
    (props: { of: typeof plain | null }) =>
      useMapBuildings(fake.map, props.of, map, theme),
    { initialProps: { of: of as typeof plain | null } },
  );
  return { fake, ...hook };
};
const given = (fake: FakeMap) =>
  (fake.setData.mock.calls.at(-1)?.[1] as { features: { properties: object }[] })
    ?.features;

describe("the buildings under the points of a map", () => {
  it("asks nothing of a map no point of which asks for a building", () => {
    const none = mapSpec({ points: [{ lat: 40.75, lon: -73.98 }], shapes: [] });
    const { fake, result } = mount(detailed, none);
    act(() => fake.fire("idle"));
    expect(result.current).toEqual({ state: "none", drawn: "" });
    expect(fake.addedLayers).toEqual([]);
    expect(fake.queries).toBe(0);
    expect(fake.listeners("idle")).toBe(0);
  });

  it("draws nothing on a backdrop without buildings, and the map says so over its pins", () => {
    const { fake, result } = mount(plain);
    act(() => fake.fire("idle"));
    expect(result.current.state).toBe("missing");
    expect(fake.addedLayers).toEqual([]);
    expect(fake.queries).toBe(0);
    expect(mapNote(spec, plain, false, true)).toContain(BUILDINGS_NOTE);
    expect(mapNote(spec, plain)).toBeNull();
  });

  it("outlines the footprint the tiles hold under a point, in the tone of the mark, once the map is idle", () => {
    const { fake, result } = mount();
    expect(fake.addedLayers.map(({ layer }) => layer.id)).toEqual([...BUILDING_LAYERS]);
    expect(fake.queries).toBe(0);
    fake.drawn = [
      footprint(ELSEWHERE.lon + 0.01, ELSEWHERE.lat),
      footprint(OFFICE.lon, OFFICE.lat, { render_height: 180 }),
    ];
    act(() => fake.fire("idle"));
    expect(fake.queries).toBe(2);
    expect(given(fake)).toEqual([
      {
        type: "Feature",
        geometry: square(OFFICE.lon, OFFICE.lat),
        properties: { key: "points:0", color: theme.tones.accent, height: 180 },
      },
    ]);
    expect(result.current).toEqual({ state: "drawn", drawn: "points:0|flat" });
  });

  it("outlines the whole building where the tiles also hold its parts: the largest footprint under the point", () => {
    const { fake } = mount();
    fake.drawn = [
      footprint(OFFICE.lon, OFFICE.lat, { render_height: 300 }, 0.0001),
      footprint(OFFICE.lon, OFFICE.lat, { render_height: 60 }, 0.0006),
      footprint(OFFICE.lon, OFFICE.lat, { render_height: 120 }, 0.0003),
    ];
    act(() => fake.fire("idle"));
    expect(given(fake)).toHaveLength(1);
    expect(given(fake)[0]).toMatchObject({
      geometry: square(OFFICE.lon, OFFICE.lat, 0.0006),
      properties: { key: "points:0", height: 300 },
    });
  });

  it("outlines only the building under the point where the tiles hold several buildings as one feature", () => {
    const { fake } = mount();
    fake.drawn = [
      {
        layer: { id: BUILDING_PROBE },
        properties: { render_height: 20 },
        geometry: {
          type: "MultiPolygon",
          coordinates: [
            square(OFFICE.lon + 0.01, OFFICE.lat).coordinates,
            square(OFFICE.lon, OFFICE.lat).coordinates,
            square(OFFICE.lon - 0.01, OFFICE.lat).coordinates,
          ],
        },
      },
    ];
    act(() => fake.fire("idle"));
    expect(given(fake)).toHaveLength(1);
    expect(given(fake)[0]).toMatchObject({ geometry: square(OFFICE.lon, OFFICE.lat) });
  });

  it("asks once for a camera: a map that rests again where it was is not asked again", () => {
    const { fake } = mount();
    fake.drawn = [footprint(OFFICE.lon, OFFICE.lat)];
    act(() => fake.fire("idle"));
    act(() => fake.fire("idle"));
    expect(fake.queries).toBe(2);
    fake.zoom = 16;
    act(() => fake.fire("idle"));
    expect(fake.queries).toBe(4);
  });

  it("asks nothing further out than the buildings start, and says so", () => {
    const { fake, result } = mount();
    fake.zoom = 11;
    act(() => fake.fire("idle"));
    expect(fake.queries).toBe(0);
    expect(result.current.state).toBe("far");
  });

  it("asks only for the points in view, and for a bounded number of them", () => {
    const many = mapSpec({
      points: Array.from({ length: BUILDING_MARKS + 150 }, (_, at) => ({
        lat: 40.7 + (at % 10) * 0.001,
        lon: -74 + Math.floor(at / 10) * 0.0005,
        highlight: "building",
      })),
      shapes: [],
    });
    const { fake } = mount(detailed, many);
    act(() => fake.fire("idle"));
    expect(fake.queries).toBe(BUILDING_MARKS);
    fake.bounds = [10, 10, 11, 11];
    fake.zoom = 14;
    act(() => fake.fire("idle"));
    expect(fake.queries).toBe(BUILDING_MARKS);
  });

  it("stands the footprint as tall as the tiles say on a tilted map", () => {
    const { fake, result } = mount();
    fake.drawn = [footprint(OFFICE.lon, OFFICE.lat, { height: 42 })];
    fake.pitch = 45;
    act(() => fake.fire("idle"));
    expect(given(fake)[0].properties).toMatchObject({ height: 42 });
    expect(result.current.drawn).toBe("points:0|raised");
    expect(fake.setLayoutProperty).toHaveBeenCalledWith(
      "building-marks-raised",
      "visibility",
      "visible",
    );
  });

  it("adds its layers again to a new style, and asks again", () => {
    const { fake } = mount();
    fake.drawn = [footprint(OFFICE.lon, OFFICE.lat)];
    act(() => fake.fire("idle"));
    fake.setStyle(
      { sources: detailed.sources, layers: detailed.style },
      { diff: false },
    );
    act(() => fake.loadStyle());
    expect(fake.addedLayers.map(({ layer }) => layer.id)).toEqual([...BUILDING_LAYERS]);
    act(() => fake.fire("idle"));
    expect(fake.queries).toBe(4);
  });

  it("stops asking and takes its layers out when the view goes or the scene changes", () => {
    const { fake, rerender, unmount } = mount();
    rerender({ of: plain });
    expect(fake.addedLayers).toEqual([]);
    expect(fake.listeners("idle")).toBe(0);
    rerender({ of: detailed });
    expect(fake.listeners("idle")).toBe(1);
    unmount();
    expect(fake.listeners()).toBe(0);
    act(() => fake.fire("idle"));
    expect(fake.queries).toBe(0);
  });

  it("reads the points of every layer, each in the colour of its mark", () => {
    const layered = mapSpec({
      points: [],
      shapes: [],
      layers: [
        {
          id: "offices",
          kind: "points",
          points: [
            { ...OFFICE, markerColor: "positive" },
            { lat: 1, lon: 2 },
            { ...ELSEWHERE, color: "#aa3300" },
          ],
        },
      ],
    });
    expect(buildingMarks(layered, theme)).toEqual([
      {
        key: "offices:0",
        lon: OFFICE.lon,
        lat: OFFICE.lat,
        color: theme.tones.positive,
      },
      { key: "offices:2", lon: ELSEWHERE.lon, lat: ELSEWHERE.lat, color: "#aa3300" },
    ]);
  });

  it("takes a place for on a footprint only inside its outline and outside its holes", () => {
    const yard = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
        [
          [4, 4],
          [6, 4],
          [6, 6],
          [4, 6],
          [4, 4],
        ],
      ],
    };
    expect(onFootprint(2, 2, yard)).toBe(true);
    expect(onFootprint(5, 5, yard)).toBe(false);
    expect(onFootprint(12, 2, yard)).toBe(false);
    expect(
      onFootprint(2, 2, { type: "MultiPolygon", coordinates: [yard.coordinates] }),
    ).toBe(true);
    for (const hostile of [null, "Polygon", { type: "Point", coordinates: [2, 2] }, {}])
      expect(onFootprint(2, 2, hostile)).toBe(false);
  });
});
