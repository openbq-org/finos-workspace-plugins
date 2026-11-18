import { describe, expect, it } from "vitest";
import {
  buildCityIndex,
  type CitiesData,
  type CityMatch,
  cityLabel,
} from "~/lib/geo/regions/cities";

const data: CitiesData = {
  source: "fixture",
  licence: "fixture",
  minPopulation: 1_000,
  countries: {
    NO: [
      ["Aldervik", 10_500, 60_100, 300, ""],
      ["Brennholm", 11_200, 61_400, 120, ""],
      ["Port Kelso", 12_000, 62_000, 80, ""],
    ],
    SE: [["Aldervik", 15_000, 58_000, 40, ""]],
  },
};
const cities = buildCityIndex(data);

const placed = (match: CityMatch) =>
  match && "city" in match
    ? { city: cityLabel(match.city), by: match.by ?? "own" }
    : match;

describe("a name of a facility at a city", () => {
  it.each([
    ["Brennholm Port"],
    ["Brennholm Harbour"],
    ["Brennholm harbor"],
    ["Port of Brennholm"],
    ["Brennholm Container Terminal"],
    ["Brennholm Port Authority"],
    ["Brennholm Ny Gang"],
    ["Puerto de Brennholm"],
  ])("places %s at the city, and says it took the name for it", (name) => {
    expect(placed(cities.match(name))).toEqual({ city: "Brennholm, NO", by: "other" });
  });

  it("reads the country after the name, as a full name gives it", () => {
    expect(placed(cities.match("Aldervik Port, Norway"))).toEqual({
      city: "Aldervik, NO",
      by: "other",
    });
    expect(placed(cities.match("Aldervik Port", { country: "SE" }))).toEqual({
      city: "Aldervik, SE",
      by: "other",
    });
  });

  it("keeps a city whose own name has the word, and a city found by its own name", () => {
    expect(placed(cities.match("Port Kelso"))).toEqual({
      city: "Port Kelso, NO",
      by: "own",
    });
    expect(placed(cities.match("Brennholm"))).toEqual({
      city: "Brennholm, NO",
      by: "own",
    });
  });

  it("is still ambiguous where the place is", () => {
    const match = cities.match("Aldervik Terminal");
    expect(match && "ambiguous" in match).toBe(true);
  });

  it.each(["Kestrel Point", "Kestrel Terminal", "Port of Kestrel", "Terminal", "Port"])(
    "places nothing for %s: no city has the place",
    (name) => {
      expect(cities.match(name)).toBeNull();
    },
  );
});
