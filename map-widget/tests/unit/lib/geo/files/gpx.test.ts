import { describe, expect, it } from "vitest";
import { utf8 } from "../../../../fixtures/geo/files/builders";
import { fixture, read, refusal } from "./support";

const gpx = (body: string) =>
  utf8(
    `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">${body}</gpx>`,
  );

describe("gpx: what is read", () => {
  it("reads waypoints as points, a route as a line and a track as a line for each segment", () => {
    const result = read(fixture("sample.gpx"));
    expect(result.kind).toBe("gpx");
    expect(result.groups).toEqual([
      { name: "Waypoints" },
      { name: "Routes" },
      { name: "Tracks" },
    ]);
    expect(result.features).toEqual([
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [6.6323, 46.5197] },
        properties: { sym: "Flag", ele: 495.5, time: "2024-06-01T07:00:00Z" },
        name: "Start",
        description: "Meet here",
        group: 0,
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [6.9107, 46.4312] },
        properties: {},
        name: "Finish",
        group: 0,
      },
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [6.6323, 46.5197],
            [6.8419, 46.4628],
            [6.9107, 46.4312],
          ],
        },
        properties: {},
        name: "Plan",
        group: 1,
      },
      {
        type: "Feature",
        geometry: {
          type: "MultiLineString",
          coordinates: [
            [
              [6.6323, 46.5197],
              [6.7, 46.5],
            ],
            [
              [6.8419, 46.4628],
              [6.9107, 46.4312],
            ],
          ],
        },
        properties: {
          type: "cycling",
          time: "2024-06-01T07:00:00Z/2024-06-01T08:30:00Z",
          ele_min: 372,
          ele_max: 520,
        },
        name: "Recorded",
        group: 2,
      },
    ]);
    expect(result.columns).toEqual([
      { name: "sym", kind: "text" },
      { name: "ele", kind: "number" },
      { name: "time", kind: "text" },
      { name: "type", kind: "text" },
      { name: "ele_min", kind: "number" },
      { name: "ele_max", kind: "number" },
    ]);
    expect(result.bounds).toEqual([6.6323, 46.4312, 6.9107, 46.5197]);
    expect(result.notes).toEqual([
      "1 link to other servers (icons, images, network links, schemas, models) was not followed.",
    ]);
    expect(JSON.stringify(result)).not.toContain("attacker");
  });

  it("makes a group only for the kinds a file has", () => {
    const result = read(
      gpx(
        '<trk><trkseg><trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/></trkseg></trk>',
      ),
    );
    expect(result.groups).toEqual([{ name: "Tracks" }]);
    expect(result.features[0].geometry.type).toBe("LineString");
    expect(result.features[0].group).toBe(0);
  });
});

describe("gpx: what is left out", () => {
  it("leaves out a mark without a position on the map, and a line of one point", () => {
    const result = read(
      gpx(`
        <wpt lat="95" lon="0"><name>North of north</name></wpt>
        <wpt lon="0"><name>No latitude</name></wpt>
        <wpt lat="1e2x" lon="0"><name>Not a number</name></wpt>
        <rte><name>One point</name><rtept lat="1" lon="1"/></rte>
        <trk><name>Empty</name><trkseg/></trk>
        <trk><name>Part</name><trkseg><trkpt lat="1" lon="1"/></trkseg><trkseg><trkpt lat="1" lon="1"/><trkpt lat="2" lon="2"/></trkseg></trk>
        <wpt lat="1" lon="2"><name>Here</name></wpt>
      `),
    );
    expect(result.features.map((feature) => feature.name)).toEqual(["Part", "Here"]);
    expect(result.features[0].geometry.type).toBe("LineString");
    expect(result.notes).toEqual([
      "3 features were left out: a position is not a longitude from -180 to 180 and a latitude from -90 to 90.",
      "2 features were left out: a line needs two positions and an area three.",
    ]);
  });

  it("is an error when a file has no mark", () => {
    expect(refusal(gpx("<metadata><name>Empty</name></metadata>")).code).toBe("empty");
  });
});
