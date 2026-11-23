import { describe, expect, it } from "vitest";
import { mapReader } from "~/lib/geo/mapShows";
import { makeMap } from "~/lib/geo/mapSpec";
import { mapViewState } from "~/lib/geo/mapViewState";
import {
  nearWords,
  READER_VIEW,
  readerSwitched,
  readerView,
  readerViewText,
} from "~/lib/geo/readerView";
import { buildCityIndex } from "~/lib/geo/regions/cities";

const cities = buildCityIndex({
  source: "test",
  licence: "test",
  minPopulation: 25_000,
  countries: {
    US: [
      ["San Francisco", -122419, 37775, 873, "CA"],
      ["Los Angeles", -118244, 34052, 3898, "CA"],
      ["Chicago", -87650, 41850, 2696, "IL"],
    ],
  },
} as never);

const network = makeMap({
  layers: [
    {
      id: "income",
      kind: "regions",
      name: "States",
      regions: { set: "us-states", items: [{ code: "CA", value: 92 }] },
    },
    {
      id: "stores",
      kind: "points",
      name: "Stores",
      points: [
        { lat: 37.7793, lon: -122.4193, label: "Civic Center" },
        { lat: 34.0522, lon: -118.2437, label: "Los Angeles" },
        { lat: 41.8781, lon: -87.6298, label: "Chicago" },
      ],
    },
    {
      id: "orders",
      kind: "heat",
      name: "Order density",
      visible: false,
      points: [{ lat: 37.77, lon: -122.42, value: 1 }],
    },
  ],
  context: ["green"],
});

const STREET = mapViewState({
  basemap: { context: ["buildings-3d"] },
  camera: {
    box: [-122.4736, 37.747, -122.3927, 37.7897],
    center: [-122.4331, 37.76124],
    pitch: 45,
    zoom: 13.19,
  },
  opacity: { stores: 0.4 },
});

describe("where a reader looks on a map, in words", () => {
  it("says the place, how near, the tilt, the points in view and where the map opens", () => {
    expect(mapReader(network, { view: STREET, camera: STREET.camera, cities })).toEqual(
      {
        view: {
          looking_at: "San Francisco, CA, US",
          zoom: "street level",
          tilted: "45°",
          in_view: "1 of 3 points",
          opens_on: "all its data",
        },
        switched: { opacity: ["Stores 40%"], context_on: ["3D buildings"] },
      },
    );
  });

  it("is nothing for a map nobody moved and whose reader switched nothing", () => {
    expect(mapReader(network, { view: mapViewState({}), cities })).toEqual({});
    expect(readerViewText(undefined, undefined)).toBe("");
  });

  it("says how near by how wide the view is, and by the zoom for a view kept without its box", () => {
    expect(nearWords({ zoom: 3, box: [-122.48, 37.74, -122.39, 37.79] })).toBe(
      "street level",
    );
    expect(nearWords({ zoom: 3, box: [-122.6, 37.6, -122.2, 37.9] })).toBe(
      "city level",
    );
    expect(nearWords({ zoom: 3, box: [-100, 28.5, -94, 33.5] })).toBe("state level");
    expect(nearWords({ zoom: 3, box: [-125, 24, -66, 49] })).toBe("country level");
    expect(nearWords({ zoom: 3, box: [-180, -80, 180, 80] })).toBe("world level");
    expect(nearWords({ zoom: 14 })).toBe("street level");
    expect(nearWords({ zoom: 1 })).toBe("world level");
  });

  it("names the turn of a map turned from north, and the view its map asks for", () => {
    const opensOnTexas = {
      view: { place: "Texas", bounds: [-106, 25, -93, 36] as const },
    };
    expect(
      readerView(opensOnTexas as never, { zoom: 6, bearing: -30 }, cities),
    ).toEqual({
      zoom: "state level",
      turned: "30° west of north",
      opens_on: "the view its map asks for: Texas",
    });
  });
});

describe("what a reader switched, in words", () => {
  it("names the layers turned off and on, by their names, and not what the map asks for", () => {
    const reader = mapViewState({
      hidden: ["income", "no-such-layer"],
      shown: ["orders"],
      basemap: { names: false, choice: "plain", contextOff: ["green"] },
      boundaries: ["us-counties"],
    });
    expect(readerSwitched(network, reader)).toEqual({
      layers_turned_off: ["States"],
      layers_turned_on: ["Order density"],
      backdrop: ["plain", "place names off"],
      context_off: ["Parks and forest"],
      boundaries_on: ["US counties"],
    });
    expect(readerSwitched(network, mapViewState({}))).toBeUndefined();
  });

  it("is one bounded line, whose names are cut", () => {
    const long = "x".repeat(200);
    const map = makeMap({
      layers: Array.from({ length: 12 }, (_, at) => ({
        id: `l${at}`,
        kind: "points" as const,
        name: `${long}${at}`,
        points: [{ lat: 1, lon: 1 }],
      })),
    });
    const reader = mapViewState({
      hidden: Array.from({ length: 12 }, (_, at) => `l${at}`),
      opacity: Object.fromEntries(
        Array.from({ length: 12 }, (_, at) => [`l${at}`, 0.5]),
      ),
    });
    const switched = readerSwitched(map, reader);
    expect(switched?.layers_turned_off).toHaveLength(READER_VIEW.named);
    expect(switched?.layers_turned_off?.[0].length).toBe(READER_VIEW.nameChars);
    const text = readerViewText(
      readerView(map, { zoom: 13, pitch: 30, box: [-0.01, -0.01, 0.01, 0.01] }, null),
      switched,
    );
    expect(text.length).toBeLessThanOrEqual(READER_VIEW.textChars);
    expect(text).toMatch(
      /^Looking at: .*; street level; tilted 30°\. It opens on all its data\. Switched by the user: layers turned off: x+/,
    );
  });
});
