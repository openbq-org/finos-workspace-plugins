import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCityIndex,
  type CitiesData,
  type City,
  cityLabel,
} from "~/lib/geo/regions/cities";
import { buildRegionIndex } from "~/lib/geo/regions/regionIndex";
import { cpuBudget, cpuNow } from "../../../machinePace";

const data = JSON.parse(
  readFileSync(join(process.cwd(), "vendor/geo/places/cities.json"), "utf8"),
) as CitiesData;
const started = cpuNow();
const cities = buildCityIndex(data);
const buildMs = cpuNow() - started;

const one = (value: unknown, options = {}) => {
  const match = cities.match(value, options);
  return match && "city" in match ? cityLabel(match.city) : match;
};
const several = (value: unknown, options = {}): string[] | null => {
  const match = cities.match(value, options);
  return match && "ambiguous" in match ? match.ambiguous.map(cityLabel) : null;
};

describe("the file of cities", () => {
  it("has every city of 25,000 residents or more, and the capitals, with its source and licence", () => {
    expect(cities.size).toBe(23_162);
    expect(Object.keys(data.countries)).toHaveLength(244);
    expect(data.minPopulation).toBe(25_000);
    expect(cities.source).toContain("GeoNames cities15000");
    expect(cities.licence).toBe("CC BY 4.0, GeoNames (https://www.geonames.org)");
    expect(one("Vaduz")).toBe("Vaduz, LI");
  });

  it("is built in a fraction of a second and matches a column of 20,000 names in less", () => {
    expect(buildMs).toBeLessThan(cpuBudget(1_500));
    const names = ["Chicago", "Zürich", "Springfield, IL", "Hong Kong", "Xanadu Prime"];
    const from = cpuNow();
    let matched = 0;
    for (let at = 0; at < 20_000; at++)
      if (cities.match(names[at % names.length])) matched++;
    expect(matched).toBe(16_000);
    expect(cpuNow() - from).toBeLessThan(cpuBudget(1_000));
  });
});

describe("the city a name means", () => {
  it("is the city of that name, where it is", () => {
    const match = cities.match("Chicago") as { city: City };
    expect(match.city).toMatchObject({ name: "Chicago", country: "US", state: "IL" });
    expect(match.city.lon).toBeCloseTo(-87.65, 1);
    expect(match.city.lat).toBeCloseTo(41.85, 1);
    expect(match.city.population).toBeGreaterThan(2_000_000);
  });

  it.each([
    ["new york", "New York City, NY, US"],
    ["  SAN FRANCISCO ", "San Francisco, CA, US"],
    ["Zurich", "Zürich, CH"],
    ["Geneva", "Geneva, CH"],
    ["Sao Paulo", "São Paulo, BR"],
    ["Frankfurt", "Frankfurt am Main, DE"],
    ["Bangalore", "Bengaluru, IN"],
    ["Bombay", "Mumbai, IN"],
    ["St Louis, MO", "St. Louis, MO, US"],
    ["Saint Louis, Missouri", "St. Louis, MO, US"],
    ["Hong Kong", "Hong Kong, HK"],
    ["Singapore", "Singapore, SG"],
    ["Dubai", "Dubai, AE"],
    ["Tokyo", "Tokyo, JP"],
  ])(
    "reads %s without case, accents and short forms, and by the name people write",
    (written, city) => {
      expect(one(written)).toBe(city);
    },
  );

  it("is the far larger of several cities of one name, and only then", () => {
    expect(one("London")).toBe("London, GB");
    expect(one("Paris")).toBe("Paris, FR");
    expect(one("Washington")).toBe("Washington, DC, US");
    expect(one("Calcutta")).toBe("Kolkata, IN");
  });

  it("is ambiguous, with the cities it could be and the largest first, when none is far larger", () => {
    expect(several("Cambridge")).toEqual([
      "Cambridge, GB",
      "Cambridge, CA",
      "Cambridge, MA, US",
    ]);
    expect(several("Springfield")?.slice(0, 3)).toEqual([
      "Springfield, MO, US",
      "Springfield, MA, US",
      "Springfield, IL, US",
    ]);
    expect(several("Springfield")).toHaveLength(4);
    expect(several("Kansas City")).toEqual([
      "Kansas City, MO, US",
      "Kansas City, KS, US",
    ]);
    expect(several("Hyderabad")).toEqual(["Hyderabad, IN", "Hyderabad, PK"]);
    expect(several("St Louis")?.slice(0, 2)).toEqual([
      "St. Louis, MO, US",
      "Saint-Louis, SN",
    ]);
    expect(several("Portland")).toEqual(["Portland, OR, US", "Portland, ME, US"]);
  });

  it("is matched within the country and the state the data gives", () => {
    expect(one("Cambridge", { country: "United Kingdom" })).toBe("Cambridge, GB");
    expect(one("Cambridge", { country: "US" })).toBe("Cambridge, MA, US");
    expect(one("Cambridge", { state: "Massachusetts" })).toBe("Cambridge, MA, US");
    expect(one("Springfield", { state: "IL" })).toBe("Springfield, IL, US");
    expect(one("Kansas City", { state: "MO", country: "USA" })).toBe(
      "Kansas City, MO, US",
    );
    expect(one("London", { country: "Canada" })).toBe("London, CA");
    expect(one("Hyderabad", { country: "IN" })).toBe("Hyderabad, IN");
    expect(one("Chicago", { country: "France" })).toBeNull();
    expect(one("Chicago", { state: "TX" })).toBeNull();
    expect(one("Chicago", { country: "Narnia" })).toBeNull();
    expect(cities.match("Paris", { state: "IL", country: "FR" })).toEqual({
      notLoaded: "admin1",
    });
    expect(one("Chicago", { country: "", state: undefined })).toBe("Chicago, IL, US");
  });

  it("reads the state or the country after a comma in the value", () => {
    expect(one("Springfield, IL")).toBe("Springfield, IL, US");
    expect(one("Cambridge, UK")).toBe("Cambridge, GB");
    expect(one("Cambridge, Massachusetts")).toBe("Cambridge, MA, US");
    expect(one("Richmond, VA")).toBe("Richmond, VA, US");
    expect(one("Washington, D.C.")).toBe("Washington, DC, US");
    expect(one("Paris, France")).toBe("Paris, FR");
    expect(one("Toronto, CA")).toBe("Toronto, CA");
    expect(one("San Jose, CA")).toBe("San Jose, CA, US");
    expect(cities.match("Springfield, Narnia")).toEqual({ notLoaded: "admin1" });
  });

  it("matches nothing for what is no city of the file", () => {
    expect(one("Xanadu Prime")).toBeNull();
    expect(one("444 W Lake St, Chicago, IL 60606")).toBeNull();
    expect(one("")).toBeNull();
    expect(one(null)).toBeNull();
    expect(one({ name: "Chicago" })).toBeNull();
    expect(one("x".repeat(500))).toBeNull();
  });
});

describe("a city with its state or province and its country, as lists of offices write it", () => {
  const admin1 = buildRegionIndex(
    JSON.parse(
      readFileSync(join(process.cwd(), "vendor/geo/regions/admin1.index.json"), "utf8"),
    ),
  );
  const regions = () => admin1;
  const placed = (value: unknown, options = {}) => one(value, { ...options, regions });

  it.each([
    ["Portland, Oregon, USA", "Portland, OR, US"],
    ["Austin, TX, USA", "Austin, TX, US"],
    ["Toronto, ON, Canada", "Toronto, CA"],
    ["Munich, Bavaria, Germany", "Munich, DE"],
    ["Austin, USA, TX", "Austin, TX, US"],
    ["Toronto, ON", "Toronto, CA"],
    ["Vancouver, BC", "Vancouver, CA"],
    ["Vancouver, WA", "Vancouver, WA, US"],
    ["Sydney, NSW", "Sydney, AU"],
    ["Munich, Bavaria", "Munich, DE"],
    ["Milan, Lombardy", "Milan, IT"],
    ["London, Ontario", "London, CA"],
    ["Perth, WA, Australia", "Perth, AU"],
  ])("reads %s", (written, city) => {
    expect(placed(written)).toBe(city);
  });

  it("matches no city for a place after the name that is none", () => {
    expect(placed("Springfield, Narnia")).toBeNull();
    expect(placed("Toronto, TX")).toBeNull();
    expect(placed("Toronto, ON, France")).toBeNull();
  });

  it("narrows by a state or province column beside a country that is not the United States", () => {
    expect(placed("Vancouver", { state: "BC", country: "Canada" })).toBe(
      "Vancouver, CA",
    );
    expect(placed("London", { state: "Ontario", country: "CA" })).toBe("London, CA");
    expect(placed("Perth", { state: "WA", country: "Australia" })).toBe("Perth, AU");
    expect(placed("Vancouver", { state: "ON", country: "Canada" })).toBeNull();
    expect(placed("Lyon", { state: "n/a", country: "France" })).toBe("Lyon, FR");
    expect(placed("Lyon", { state: "Rhone Valley", country: "France" })).toBe(
      "Lyon, FR",
    );
    expect(placed("Paris", { state: "IL", country: "FR" })).toBeNull();
    expect(placed("Vancouver", { state: "BC" })).toBe("Vancouver, CA");
  });

  it("draws every row of a list of offices of North America, by city, state and country", () => {
    const offices = [
      ["Toronto", "ON", "Canada"],
      ["Vancouver", "BC", "Canada"],
      ["Montreal", "QC", "Canada"],
      ["Calgary", "AB", "Canada"],
      ["Chicago", "IL", "USA"],
      ["Austin", "TX", "United States"],
      ["Mexico City", "CDMX", "Mexico"],
      ["Monterrey", "NL", "Mexico"],
    ];
    for (const [city, state, country] of offices)
      expect(placed(city, { state, country }), city).toContain(
        city === "Montreal" ? "Montr" : city,
      );
  });

  it("says that it needs the list of states and provinces when it is not loaded, and guesses nothing", () => {
    const without = { regions: () => null };
    expect(cities.match("Toronto, ON", without)).toEqual({ notLoaded: "admin1" });
    expect(cities.match("Vancouver", { state: "BC", ...without })).toEqual({
      notLoaded: "admin1",
    });
    expect(one("Austin, TX, USA", without)).toBe("Austin, TX, US");
    expect(one("Paris, France", without)).toBe("Paris, FR");
    expect(one("Vancouver", { state: "BC", country: "Canada", ...without })).toBe(
      "Vancouver, CA",
    );
  });
});

describe("the name a city has in its own language", () => {
  it.each([
    ["München", "Munich, DE"],
    ["Muenchen", "Munich, DE"],
    ["Genève", "Geneva, CH"],
    ["Roma", "Rome, IT"],
    ["Firenze", "Florence, IT"],
    ["Bruxelles", "Brussels, BE"],
    ["Den Haag", "The Hague, NL"],
    ["Lisboa", "Lisbon, PT"],
    ["Warszawa", "Warsaw, PL"],
    ["Milano", "Milan, IT"],
    ["Wien", "Vienna, AT"],
    ["Praha", "Prague, CZ"],
  ])("places %s", (written, city) => {
    const match = cities.match(written);
    expect(match && "city" in match ? cityLabel(match.city) : match).toBe(city);
  });

  it("says that a city was found by another name, so a map can say so", () => {
    expect(cities.match("München")).toMatchObject({ by: "other" });
    expect(cities.match("Munich")).not.toHaveProperty("by");
    expect(one("Monaco")).toBe("Monaco, MC");
    expect(one("Bethlehem", { country: "PS" })).toBe("Bethlehem, PS");
  });
});

describe("a lone small town is not taken without doubt", () => {
  it("is not the town when the name is a country it is not in", () => {
    const match = cities.match("Mexico");
    expect(match).toMatchObject({ because: expect.stringContaining("is a country") });
    expect(several("Mexico")).toEqual(["Mexico, PH"]);
    expect(one("Mexico", { country: "Philippines" })).toBe("Mexico, PH");
    expect(one("Mexico, PH")).toBe("Mexico, PH");
    expect(one("Monaco")).toBe("Monaco, MC");
    expect(one("Luxembourg")).toBe("Luxembourg, LU");
    expect(one("Singapore")).toBe("Singapore, SG");
  });

  it("is not the town when a much larger city has the name as a part of its own", () => {
    expect(several("Halle")).toEqual(["Halle (Saale), DE", "Halle, BE"]);
    expect(several("Hull")).toEqual(["Kingston upon Hull, GB", "Hull, CA"]);
    expect(one("Halle", { country: "Belgium" })).toBe("Halle, BE");
    expect(one("Halle, Germany")).toBe("Halle (Saale), DE");
    expect(one("Hull, UK")).toBe("Kingston upon Hull, GB");
    expect(several("Salem")?.join()).not.toContain("Jerusalem");
  });
});

describe("the largest cities of the list", () => {
  it("are as many as are asked for, the largest first", () => {
    const top = cities.largest(5);
    expect(top).toHaveLength(5);
    expect(top.map((city) => city.population)).toEqual(
      [...top].map((city) => city.population).sort((a, b) => b - a),
    );
    expect(top[0].population).toBeGreaterThan(10_000_000);
    expect(cities.largest(0)).toEqual([]);
    expect(cities.largest(-3)).toEqual([]);
    expect(cities.largest(1_000_000)).toHaveLength(cities.size);
  });

  it("are the same cities a name is matched to", () => {
    const match = cities.match("Tokyo");
    expect(match && "city" in match ? match.city : null).toBe(
      cities.largest(40).find((city) => city.name === "Tokyo"),
    );
  });
});
