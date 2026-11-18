import { describe, expect, it } from "vitest";
import { parseGeoFile } from "~/lib/geo/files";
import { toKml } from "~/lib/geo/files/exportKml";
import { isCalendarTime } from "~/lib/geo/files/time";
import { isoTime } from "~/lib/geo/files/xml";
import { mapSpec } from "~/lib/geo/mapSpec";

describe("a time of a map file", () => {
  it.each([
    "2024",
    "2024-01",
    "2024-12",
    "2024-02-29",
    "2023-12-31",
    "2024-03-05T23:59:59Z",
    "2024-03-05T00:00",
    "2024-03-05T12:30:00.250+14:00",
    "2024-03-05T12:30:00-05:30",
  ])("takes %s", (text) => {
    expect(isCalendarTime(text)).toBe(true);
    expect(isoTime(text)).toBe(text);
  });

  it.each([
    "2024-13",
    "2024-00",
    "2024-01-32",
    "2024-01-00",
    "2023-02-29",
    "2024-04-31",
    "2024-03-05T24:00:00Z",
    "2024-03-05T12:60:00Z",
    "2024-03-05T12:30:60Z",
    "2024-03-05T12:30:00+15:00",
    "2024-03-05T12:30:00+05:60",
    "March 2024",
    "",
  ])("refuses %s, which no calendar or clock has", (text) => {
    expect(isCalendarTime(text)).toBe(false);
    expect(isoTime(text)).toBeUndefined();
  });

  it("reads a KML when of month 13 as no time of its placemark", () => {
    const kml = (when: string) =>
      new TextEncoder().encode(
        `<kml><Document><Placemark><name>A</name><TimeStamp><when>${when}</when></TimeStamp><Point><coordinates>-93.6,42.0</coordinates></Point></Placemark></Document></kml>`,
      );
    const read = (when: string) => {
      const outcome = parseGeoFile(kml(when), { name: "a.kml" });
      return outcome.ok ? outcome.file.features[0].properties.time : "not read";
    };
    expect(read("2024-12")).toBe("2024-12");
    expect(read("2024-13")).toBeUndefined();
  });

  it("writes a step of month 13 as a value of the placemark, never as a when", () => {
    const of = (time: string) =>
      toKml(mapSpec({ points: [{ lat: 42, lon: -93.6, label: "A", time }] }));
    expect(of("2024-12")).toContain("<when>2024-12</when>");
    const wrong = of("2024-13");
    expect(wrong).not.toContain("<when>");
    expect(wrong).toContain('<Data name="time"><value>2024-13</value></Data>');
  });
});
