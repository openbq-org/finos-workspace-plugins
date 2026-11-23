import { describe, expect, it } from "vitest";
import type { Basemap } from "~/components/Geo/basemap";
import { LOCAL_MAX_ZOOM, SHAPE_MAX_ZOOM } from "~/components/Geo/mapGeometry";
import { STREET_ZOOM } from "~/components/Geo/mapOpeningScene";
import { BOUNDARY_MAX_ZOOM, BOUNDARY_VIEW_ZOOM } from "~/components/Geo/scene/base";
import { scene } from "./support";

const tiles = (
  kind: Basemap["kind"],
  maxZoom: number,
  detailZoom: number,
): Basemap => ({
  kind,
  source: {
    type: "vector",
    url: "pmtiles://https://app.example/basemap/world.pmtiles",
  },
  under: [{ id: "earth", type: "fill", source: "basemap", "source-layer": "earth" }],
  labels: [],
  maxZoom,
  detailZoom,
  credit: "Protomaps © OpenStreetMap",
  schema: kind === "openfreemap" ? "openmaptiles" : "protomaps",
  context: [],
});
const bundled = tiles("bundled", 9, 6);
const hosted = tiles("hosted", 13, 10);
const service = tiles("openfreemap", 17, 14);

const MANHATTAN = { lat: 40.783, lon: -73.966, label: "Manhattan" };
const looking = (view: object, basemap: Basemap | null) =>
  scene({ points: [MANHATTAN], view }, { basemap });

describe("the deepest view each backdrop draws", () => {
  it("is the last zoom its tiles are drawn at, and where the boundary files end without tiles", () => {
    const none = scene({ points: [MANHATTAN] });
    expect(none.viewZoom).toBe(BOUNDARY_VIEW_ZOOM);
    expect(scene({ points: [MANHATTAN] }, { basemap: bundled }).viewZoom).toBe(9);
    expect(scene({ points: [MANHATTAN] }, { basemap: hosted }).viewZoom).toBe(13);
    expect(scene({ points: [MANHATTAN] }, { basemap: service }).viewZoom).toBe(17);
    const plain = scene(
      { points: [MANHATTAN], basemap: { choice: "plain" } },
      { basemap: service },
    );
    expect(plain.viewZoom).toBe(BOUNDARY_VIEW_ZOOM);
    expect(plain.backdrop).toBe("plain");
  });

  it("holds a view of a city to it, by a middle and a zoom and by the box of a place", () => {
    for (const view of [
      { center: [-73.97, 40.78], zoom: 12 },
      { center: [-73.97, 40.78] },
      { bounds: [-74.046, 40.681, -73.906, 40.882], place: "Manhattan" },
    ]) {
      expect(looking(view, bundled).openingLimit).toBe(9);
      expect(looking(view, null).openingLimit).toBe(BOUNDARY_VIEW_ZOOM);
      expect(looking(view, service).openingLimit).toBeUndefined();
      expect(looking(view, hosted).streets).toBe(STREET_ZOOM <= 13);
    }
  });

  it("lets a reader zoom no nearer than the view opens: the plus button and the wheel end where the map does", () => {
    for (const view of [
      { center: [-73.97, 40.78], zoom: 12 },
      { center: [-73.97, 40.78], zoom: 19 },
      { bounds: [-74.046, 40.681, -73.906, 40.882], place: "Manhattan" },
    ]) {
      const onTiles = looking(view, bundled);
      expect(onTiles.maxZoom).toBe(onTiles.openingLimit);
      const onOutlines = looking(view, null);
      expect(onOutlines.maxZoom).toBe(BOUNDARY_VIEW_ZOOM);
    }
    expect(looking({ center: [-73.97, 40.78], zoom: 12 }, service).maxZoom).toBe(17);
    expect(looking({ center: [-73.97, 40.78], zoom: 5 }, bundled).maxZoom).toBe(9);
  });

  it("goes nearer where the marks have detail of their own, whatever the backdrop", () => {
    const view = { center: [-73.97, 40.78], zoom: 15 };
    const several = scene(
      {
        points: Array.from({ length: 40 }, (_, at) => ({
          lat: 40.7 + at * 0.004,
          lon: -74 + at * 0.002,
        })),
        view,
      },
      { basemap: bundled },
    );
    expect(several.maxZoom).toBe(LOCAL_MAX_ZOOM);
    expect(several.openingLimit).toBeGreaterThan(9);
    const shaped = scene(
      {
        shapes: [
          {
            type: "polygon",
            coordinates: [
              [
                [-73.98, 40.77],
                [-73.95, 40.77],
                [-73.95, 40.8],
                [-73.98, 40.77],
              ],
            ],
          },
        ],
        view,
      },
      { basemap: null },
    );
    expect(shaped.openingLimit).toBeUndefined();
    expect(shaped.maxZoom).toBe(SHAPE_MAX_ZOOM);
    const counties = scene({
      regions: { set: "us-counties", items: [{ code: "36061", value: 1 }] },
    });
    expect(counties.maxZoom).toBe(BOUNDARY_MAX_ZOOM);
  });
});
