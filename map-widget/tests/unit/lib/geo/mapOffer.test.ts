import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAP_CONTEXT_IDS } from "~/lib/geo/mapContext";
import { BACKDROP_ZOOMS, contextFrom, mapOffer, sawBasemap } from "~/lib/geo/mapOffer";
import { getSettings, setSettings } from "~/settings";

beforeEach(() => {
  setSettings({ mapTilesProvider: "none", mapTilesUrl: "" });
});

afterEach(() => {
  setSettings({ ...getSettings(), mapTilesProvider: "none" });
  setSettings({ ...getSettings(), mapTilesUrl: "" });
  sawBasemap(undefined);
});

const drawn = (offer: ReturnType<typeof mapOffer>) =>
  Object.fromEntries(
    MAP_CONTEXT_IDS.flatMap((id) => {
      const from = contextFrom(offer, id);
      return from === null ? [] : [[id, from]];
    }),
  );

describe("what the basemap of a deployment has for a map to ask for", () => {
  it("is the world without streets or buildings by default: a place is shown to zoom 9", () => {
    expect(mapOffer()).toEqual({
      standard: "world",
      buildingsFrom: null,
      viewZoom: 9,
      schema: "protomaps",
      reach: 6,
    });
    expect(BACKDROP_ZOOMS.bundled + BACKDROP_ZOOMS.past).toBe(9);
    expect(drawn(mapOffer())).toEqual({ landuse: 0, green: 2, airports: 6 });
  });

  it("has streets, and buildings from zoom 13, with the tile service turned on", () => {
    setSettings({ ...getSettings(), mapTilesProvider: "openfreemap" });
    expect(mapOffer()).toEqual({
      standard: "streets",
      buildingsFrom: 13,
      viewZoom: null,
      schema: "openmaptiles",
      reach: Number.POSITIVE_INFINITY,
    });
    expect(Object.keys(drawn(mapOffer()))).toEqual([...MAP_CONTEXT_IDS]);
  });

  it("has what a hosted file holds, with buildings from the zoom its schema has them at", () => {
    setSettings({ ...getSettings(), mapTilesUrl: "/basemap/us.pmtiles" });
    expect(mapOffer()).toEqual({
      standard: "file",
      buildingsFrom: 11,
      viewZoom: null,
      schema: "protomaps",
      reach: Number.POSITIVE_INFINITY,
    });

    setSettings({ ...getSettings(), mapTilesProvider: "openfreemap" });
    expect(mapOffer().standard).toBe("streets");
  });

  it("takes a value that is no address for no file", () => {
    setSettings({ ...getSettings(), mapTilesUrl: "javascript:alert(1)" });
    expect(mapOffer()).toEqual({
      standard: "world",
      buildingsFrom: null,
      viewZoom: 9,
      schema: "protomaps",
      reach: 6,
    });
  });
});

describe("what the maps of the page were drawn on, over what the deployment configured", () => {
  it("is land outlines when no basemap could be read: a place is shown to zoom 7, and no context layer is drawn", () => {
    setSettings({ ...getSettings(), mapTilesProvider: "openfreemap" });
    sawBasemap({ tiles: false });
    expect(mapOffer()).toEqual({
      standard: "outlines",
      buildingsFrom: null,
      viewZoom: BACKDROP_ZOOMS.outlines,
      schema: "protomaps",
      reach: -1,
    });
    expect(drawn(mapOffer())).toEqual({});
  });

  it("is the bundled file when the service that was turned on did not answer", () => {
    setSettings({ ...getSettings(), mapTilesProvider: "openfreemap" });
    sawBasemap({ tiles: true, kind: "bundled", maxZoom: 9, detailZoom: 6 });
    expect(mapOffer()).toMatchObject({
      standard: "world",
      viewZoom: 9,
      buildingsFrom: null,
    });
  });

  it("goes as far as a hosted file was cut: an extract to zoom 10 has no buildings and shows a place to 13", () => {
    setSettings({ ...getSettings(), mapTilesUrl: "/basemap/us.pmtiles" });
    sawBasemap({ tiles: true, kind: "hosted", maxZoom: 13, detailZoom: 10 });
    expect(mapOffer()).toMatchObject({
      standard: "file",
      buildingsFrom: null,
      viewZoom: null,
      reach: 10,
    });
    sawBasemap({ tiles: true, kind: "hosted", maxZoom: 11, detailZoom: 8 });
    expect(mapOffer()).toMatchObject({ standard: "file", viewZoom: 11 });
    sawBasemap({ tiles: true, kind: "hosted", maxZoom: 17, detailZoom: 15 });
    expect(mapOffer()).toMatchObject({ buildingsFrom: 11, viewZoom: null });
  });

  it("is what the configuration says again once what was seen is forgotten", () => {
    sawBasemap({ tiles: false });
    sawBasemap(undefined);
    expect(mapOffer().standard).toBe("world");
  });
});
