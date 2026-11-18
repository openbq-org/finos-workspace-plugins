import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildRegionIndex } from "~/lib/geo/regions/regionIndex";
import {
  type MatchOptions,
  REGION_SET_IDS,
  type RegionIndex,
  type RegionIndexData,
  type RegionSetId,
} from "~/lib/geo/regions/regionTypes";
import { cpuBudget, cpuNow } from "../../../machinePace";

const data = (set: RegionSetId) =>
  JSON.parse(
    readFileSync(
      join(process.cwd(), "vendor/geo/regions", `${set}.index.json`),
      "utf8",
    ),
  ) as RegionIndexData;

const indexes = Object.fromEntries(
  REGION_SET_IDS.map((set) => [set, buildRegionIndex(data(set))]),
) as Record<RegionSetId, RegionIndex>;

type Row =
  | [value: unknown, id: string]
  | [value: unknown, id: string, options: MatchOptions];
type Missing = [value: unknown] | [value: unknown, options: MatchOptions];

const matches = (set: RegionSetId, rows: Row[]) =>
  it.each(rows)(`${set}: reads %j as %s`, (value, id, options?: MatchOptions) => {
    expect(indexes[set].match(value, options)).toEqual({ id });
  });

const misses = (set: RegionSetId, rows: Missing[]) =>
  it.each(rows)(`${set}: reads %j as no region`, (value, options?: MatchOptions) => {
    expect(indexes[set].match(value, options)).toBeNull();
  });

const ambiguous = (
  set: RegionSetId,
  rows: [value: unknown, ids: string[], options?: MatchOptions][],
) =>
  it.each(rows)(`${set}: reports %j as ambiguous`, (value, ids, options) => {
    const match = indexes[set].match(value, options);
    expect(match).toHaveProperty("ambiguous");
    expect((match as { ambiguous: string[] }).ambiguous).toEqual(
      expect.arrayContaining(ids),
    );
  });

describe("US states", () => {
  matches("us-states", [
    ["CA", "06"],
    [" ca ", "06"],
    ["California", "06"],
    ["CALIFORNIA", "06"],
    ["06", "06"],
    ["6", "06"],
    [6, "06"],
    ["US-CA", "06"],
    ["State of California", "06"],
    ["New-York", "36"],
    ["N.Y.", "36"],
    ["NewYork", "36"],
    ["Washington, D.C.", "11"],
    ["Washington DC", "11"],
    ["District of Columbia", "11"],
    ["Puerto Rico", "72"],
    ["Virgin Islands", "78"],
    ["U.S. Virgin Islands", "78"],
  ]);
  misses("us-states", [
    ["Californa"],
    ["ZZ"],
    ["99"],
    ["006"],
    [""],
    [null],
    [undefined],
    [{}],
    [6.5],
    [-6],
    ["constructor"],
    ["__proto__"],
    ["x".repeat(500)],
  ]);
});

describe("countries", () => {
  matches("countries", [
    ["US", "840"],
    ["USA", "840"],
    ["U.S.A.", "840"],
    ["United States of America", "840"],
    [840, "840"],
    ["UK", "826"],
    ["Great Britain", "826"],
    ["DEU", "276"],
    [4, "004"],
    ["Côte d'Ivoire", "384"],
    ["Cote d Ivoire", "384"],
    ["Ivory Coast", "384"],
    ["Korea, Republic of", "410"],
    ["Türkiye", "792"],
    ["Russian Federation", "643"],
    ["Viet Nam", "704"],
    ["Georgia", "268"],
    ["Singapore", "702"],
    ["Malta", "470"],
    ["Bahrain", "048"],
    ["Liechtenstein", "438"],
    ["France", "250"],
    ["FR", "250"],
    ["FRA", "250"],
    ["Norway", "578"],
    ["NO", "578"],
    ["NOR", "578"],
    ["Kosovo", "XKX"],
    ["XK", "XKX"],
    ["XKX", "XKX"],
    ["Republic of Kosovo", "XKX"],
    ["Northern Cyprus", "CYN"],
    ["N. Cyprus", "CYN"],
    ["Somaliland", "SOL"],
    ["Western Sahara", "732"],
    ["EH", "732"],
    ["Taiwan", "158"],
    ["Taiwan, Province of China", "158"],
    ["TWN", "158"],
    ["Palestine", "275"],
    ["State of Palestine", "275"],
    ["West Bank and Gaza", "275"],
    ["Puerto Rico", "630"],
    ["PRI", "630"],
    ["Greenland", "304"],
    ["Hong Kong", "344"],
    ["Hong Kong SAR, China", "344"],
    ["Macau", "446"],
    ["Cyprus", "196"],
    ["Somalia", "706"],
    ["Serbia", "688"],
    ["Morocco", "504"],
    ["China", "156"],
    ["Australia", "036"],
  ]);
  misses("countries", [
    ["Atlantis"],
    ["XX"],
    ["999"],
    ["8400"],
    [""],
    [null],
    ["constructor"],
  ]);

  it("has a shape for the small countries and none for the Siachen Glacier", () => {
    const countries = indexes.countries;
    for (const id of ["702", "470", "048", "438", "492", "674", "XKX", "CYN", "SOL"])
      expect(countries.get(id)?.centroid, id).not.toBeNull();
    expect(countries.match("Siachen Glacier")).toBeNull();
    expect(countries.match("-99")).toBeNull();
    expect(countries.get("292")).toMatchObject({ name: "Gibraltar", centroid: null });
  });

  it("opens a spread-out country on its largest part", () => {
    const france = indexes.countries.get("250");
    expect(france?.bounds?.[0]).toBeLessThan(-60);
    expect(france?.viewBounds?.[0]).toBeGreaterThan(-6);
    expect(france?.viewBounds?.[2]).toBeLessThan(10);
    const germany = indexes.countries.get("276");
    expect(germany?.viewBounds).toEqual(germany?.bounds);
  });
});

describe("US counties", () => {
  matches("us-counties", [
    ["06037", "06037"],
    ["6037", "06037"],
    [6037, "06037"],
    ["Cook County, IL", "17031"],
    ["Cook, Illinois", "17031"],
    ["cook county , il", "17031"],
    ["Cook County Illinois", "17031"],
    ["Cook", "17031", { state: "IL" }],
    ["Cook County", "17031", { state: "Illinois" }],
    ["Cook County", "17031", { state: 17 }],
    ["Orleans Parish, LA", "22071"],
    ["Anchorage Municipality, AK", "02020"],
    ["Juneau City and Borough, Alaska", "02110"],
    ["St. Louis County, MO", "29189"],
    ["Saint Louis County, MO", "29189"],
    ["St. Louis city, MO", "29510"],
    ["Baltimore County, MD", "24005"],
    ["Baltimore city, MD", "24510"],
    ["Carson City, NV", "32510"],
    ["James City County, VA", "51095"],
    ["Prince George's County, MD", "24033"],
    ["Prince Georges, MD", "24033"],
    ["DeKalb County, GA", "13089"],
    ["De Kalb County, GA", "13089"],
    ["Doña Ana County, NM", "35013"],
    ["Dona Ana, NM", "35013"],
    ["Ste. Genevieve County, MO", "29186"],
    ["Kings County, New York", "36047"],
    ["District of Columbia, DC", "11001"],
    ["San Juan Municipio, PR", "72127"],
  ]);
  misses("us-counties", [
    ["99001"],
    ["123"],
    ["123456"],
    ["Cook County, Atlantis"],
    ["Cook County, TX"],
    ["Cook County, IL", { state: "TX" }],
    ["Cook County", { state: "Atlantis" }],
    [", IL"],
    [null],
    [12.5],
  ]);
  ambiguous("us-counties", [
    ["Cook County", ["17031", "13075", "27031"]],
    ["Washington", ["01129", "05143"]],
    ["St. Louis, MO", ["29189", "29510"]],
    ["Baltimore, MD", ["24005", "24510"]],
  ]);
});

describe("first-level regions of the world", () => {
  matches("admin1", [
    ["CA-ON", "CA-ON"],
    ["ca-on", "CA-ON"],
    ["CA.ON", "CA-ON"],
    ["CA_ON", "CA-ON"],
    ["CAON", "CA-ON"],
    ["Ontario", "CA-ON"],
    ["ON", "CA-ON", { country: "CA" }],
    ["ON", "CA-ON", { country: "Canada" }],
    ["Ont.", "CA-ON", { country: "CAN" }],
    ["Québec", "CA-QC"],
    ["Quebec", "CA-QC"],
    ["DE-BY", "DE-BY"],
    ["Bayern", "DE-BY"],
    ["Bavaria", "DE-BY"],
    ["Freistaat Bayern", "DE-BY"],
    ["BY", "DE-BY", { country: "Germany" }],
    ["Nordrhein-Westfalen", "DE-NW"],
    ["North Rhine-Westphalia", "DE-NW"],
    ["IN-MH", "IN-MH"],
    ["Maharashtra", "IN-MH"],
    ["MH", "IN-MH", { country: "IN" }],
    ["Odisha", "IN-OD"],
    ["IN-OR", "IN-OD"],
    ["Telangana", "IN-TS"],
    ["BR-SP", "BR-SP"],
    ["São Paulo", "BR-SP"],
    ["Sao Paulo", "BR-SP"],
    ["SP", "BR-SP", { country: "Brazil" }],
    ["California", "US-CA"],
    ["CA", "US-CA", { country: "US" }],
    ["US-CA", "US-CA"],
    ["New South Wales", "AU-NSW"],
    ["NSW", "AU-NSW", { country: "Australia" }],
    ["Tokyo", "JP-13"],
    [13, "JP-13", { country: "JP" }],
    ["13", "JP-13", { country: "Japan" }],
    ["Guangdong", "CN-GD"],
    ["Gauteng", "ZA-GP"],
    ["ZA-GT", "ZA-GP"],
    ["Ciudad de México", "MX-CMX"],
    ["Mexico City", "MX-CMX"],
    ["MX-DIF", "MX-CMX"],
    ["Jalisco", "MX-JAL"],
    ["England", "GB-ENG"],
    ["Scotland", "GB-SCT"],
    ["GB-WLS", "GB-WLS"],
    ["Northern Ireland", "GB-NIR"],
    ["Île-de-France", "FR-IDF"],
    ["Ile de France", "FR-IDF"],
    ["Bretagne", "FR-BRE"],
    ["Brittany", "FR-BRE"],
    ["Corse", "FR-20R"],
    ["Paris", "FR-75"],
    [75, "FR-75", { country: "FR" }],
    [1, "FR-01", { country: "France" }],
    ["01", "FR-01", { country: "FR" }],
    ["FR-971", "FR-GP"],
    ["Lombardia", "IT-25"],
    ["Lombardy", "IT-25"],
    ["Toscana", "IT-52"],
    ["Milano", "IT-MI"],
    ["Cataluña", "ES-CT"],
    ["Catalonia", "ES-CT"],
    ["Catalunya", "ES-CT"],
    ["Madrid", "ES-MD"],
    ["ES-M", "ES-M"],
    ["Andalucía", "ES-AN"],
    ["Barcelona", "ES-B"],
    ["Flanders", "BE-VLG"],
    ["Wallonie", "BE-WAL"],
    ["Limburg", "NL-LI", { country: "NL" }],
    ["Limburg", "BE-VLI", { country: "Belgium" }],
    ["Punjab", "PK-PB", { country: "Pakistan" }],
    ["Amazonas", "BR-AM", { country: "BR" }],
    ["Georgia", "US-GA"],
    ["Republika Srpska", "BA-SRP"],
    ["Zürich", "CH-ZH"],
    ["Zurich", "CH-ZH"],
    ["St. Gallen", "CH-SG"],
    ["Sankt Gallen", "CH-SG"],
  ]);
  misses("admin1", [
    ["Atlantis"],
    ["CA-ZZ"],
    ["Ontario", { country: "US" }],
    ["Ontario", { country: "Atlantis" }],
    ["CA-ON", { country: "US" }],
    ["ON", { country: "DE" }],
    [""],
    [null],
    [1.5],
    ["Priština"],
  ]);
  ambiguous("admin1", [
    ["Limburg", ["NL-LI", "BE-VLI"]],
    ["Punjab", ["IN-PB", "PK-PB"]],
    ["Amazonas", ["BR-AM", "CO-AMA", "VE-Z"]],
    ["ON", ["CA-ON"]],
    ["CA", ["US-CA"]],
    [13, ["JP-13", "FR-13"]],
  ]);
});

describe("US metro and micro areas", () => {
  matches("us-cbsa", [
    ["35620", "35620"],
    [35620, "35620"],
    ["New York-Newark-Jersey City, NY-NJ", "35620"],
    ["New York-Newark-Jersey City, NY-NJ Metro Area", "35620"],
    ["New York-Newark-Jersey City", "35620"],
    ["New York", "35620"],
    ["new york, ny", "35620"],
    ["New York MSA", "35620"],
    ["Jersey City, NJ", "35620"],
    ["Los Angeles", "31080"],
    ["Los Angeles-Long Beach-Anaheim, CA", "31080"],
    ["Chicago", "16980"],
    ["Chicago, IL", "16980"],
    ["Chicago, Illinois", "16980"],
    ["Dallas-Fort Worth-Arlington, TX", "19100"],
    ["Dallas", "19100"],
    ["Ft. Worth", "19100"],
    ["Minneapolis-St. Paul-Bloomington, MN-WI", "33460"],
    ["Saint Paul", "33460"],
    ["Washington-Arlington-Alexandria, DC-VA-MD-WV", "47900"],
    ["Washington, DC", "47900"],
    ["Portland, OR", "38900"],
    ["Portland, ME", "38860"],
    ["Kansas City", "28140"],
    ["Kansas City, KS", "28140"],
    ["Winston-Salem, NC", "49180"],
    ["Winston-Salem", "49180"],
    ["Honolulu", "46520"],
    ["Urban Honolulu, HI", "46520"],
    ["Louisville", "31140"],
    ["Nashville", "34980"],
    ["Scranton--Wilkes-Barre, PA", "42540"],
    ["Wilkes-Barre", "42540"],
    ["San Juan-Bayamón-Caguas, PR", "41980"],
    ["Aberdeen, SD", "10100"],
    ["Aberdeen, WA Micro Area", "10140"],
  ]);
  misses("us-cbsa", [
    ["Atlantis"],
    ["99999"],
    ["3562"],
    ["New York, CA"],
    [null],
    [""],
  ]);
  ambiguous("us-cbsa", [
    ["Portland", ["38900", "38860"]],
    ["Aberdeen", ["10100", "10140"]],
    ["Columbus", ["18140", "17980"]],
    ["Springfield", ["44140", "44180"]],
  ]);
});

describe("US congressional districts", () => {
  matches("us-cd119", [
    ["CA-12", "CA-12"],
    ["ca-12", "CA-12"],
    ["CA12", "CA-12"],
    ["CA 12", "CA-12"],
    ["CA-012", "CA-12"],
    ["California 12", "CA-12"],
    ["California's 12th congressional district", "CA-12"],
    ["California 12th District", "CA-12"],
    ["Congressional District 12, California", "CA-12"],
    ["0612", "CA-12"],
    ["612", "CA-12"],
    [612, "CA-12"],
    ["CA-1", "CA-01"],
    ["California 1st", "CA-01"],
    ["NY-14", "NY-14"],
    ["New York 14", "NY-14"],
    ["N.Y. 3rd", "NY-03"],
    ["TX-02", "TX-02"],
    ["Texas 22nd", "TX-22"],
    ["AL-01", "AL-01"],
    ["Alabama 1", "AL-01"],
    ["AK-AL", "AK-AL"],
    ["AK-00", "AK-AL"],
    ["AK-01", "AK-AL"],
    ["Alaska at large", "AK-AL"],
    ["Alaska At-Large", "AK-AL"],
    ["Alaska", "AK-AL"],
    ["0200", "AK-AL"],
    [200, "AK-AL"],
    ["WY-AL", "WY-AL"],
    ["DC-AL", "DC-AL"],
    ["DC-98", "DC-AL"],
    ["District of Columbia", "DC-AL"],
    ["1198", "DC-AL"],
    ["PR-AL", "PR-AL"],
    ["Puerto Rico at large", "PR-AL"],
  ]);
  misses("us-cd119", [
    ["CA-99"],
    ["CA-0"],
    ["California at large"],
    ["ZZ-01"],
    ["9999"],
    ["12"],
    ["CA-12-3"],
    ["Atlantis 3"],
    [null],
    [""],
  ]);
  ambiguous("us-cd119", [
    ["California", ["CA-01", "CA-12", "CA-52"]],
    ["TX", ["TX-01", "TX-38"]],
  ]);
});

describe("every boundary set", () => {
  it.each(REGION_SET_IDS)(
    "%s: every region matches itself by its id and by its name",
    (set) => {
      const index = indexes[set];
      const shared: string[] = [];
      const contained: string[] = [];
      for (const id of index.ids()) {
        expect(index.match(id), id).toEqual({ id });
        const info = index.get(id);
        const scope =
          set === "admin1"
            ? { country: id.slice(0, 2) }
            : set === "us-counties"
              ? { state: id.slice(0, 2) }
              : {};
        const match = index.match(info?.name, scope);
        if (match && "ambiguous" in match) {
          expect(match.ambiguous, `${id} ${info?.name}`).toContain(id);
          shared.push(id);
        } else if (info?.level === 2 && match && "id" in match && match.id !== id) {
          expect(index.get(match.id)?.level, `${id} ${info?.name}`).toBe(1);
          contained.push(id);
        } else expect(match, `${id} ${info?.name}`).toEqual({ id });
      }
      expect(shared.sort()).toEqual(SHARED_NAMES[set] ?? []);
      expect(contained.sort()).toEqual(set === "admin1" ? CONTAINED_NAMES : []);
    },
  );

  it("matches 100,000 values of each set in well under a second", () => {
    for (const set of REGION_SET_IDS) {
      const index = indexes[set];
      const ids = index.ids();
      const values: unknown[] = [];
      for (let i = 0; values.length < 100_000; i++) {
        const info = index.get(ids[i % ids.length]);
        values.push(i % 3 === 0 ? info?.id : i % 3 === 1 ? info?.name : `no such ${i}`);
      }
      const started = cpuNow();
      let matched = 0;
      for (const value of values) if (index.match(value)) matched++;
      const elapsed = cpuNow() - started;
      expect(matched, set).toBeGreaterThan(60_000);
      expect(elapsed, set).toBeLessThan(cpuBudget(700));
    }
  });

  it("does not read a name of Object as a region", () => {
    for (const set of REGION_SET_IDS)
      for (const value of ["constructor", "__proto__", "toString", "hasOwnProperty"])
        expect(indexes[set].match(value), `${set} ${value}`).toBeNull();
  });
});

const SHARED_NAMES: Partial<Record<RegionSetId, string[]>> = {
  "us-counties": [
    "24005",
    "24510",
    "29189",
    "29510",
    "51059",
    "51067",
    "51159",
    "51161",
    "51600",
    "51620",
    "51760",
    "51770",
  ],
  admin1: ["AZ-LA", "AZ-LAN", "HU-VE", "HU-VM", "MT-65", "MT-66", "UZ-TK", "UZ-TO"],
};

const CONTAINED_NAMES = ["ES-LO", "ES-M", "ES-MU", "ES-NA", "ES-O", "ES-S"];

describe("explain", () => {
  it("lists the regions an ambiguous value could be", () => {
    expect(indexes.admin1.explain("Limburg")).toEqual({
      reason: "ambiguous",
      candidates: [
        { id: "BE-VLI", name: "Limburg" },
        { id: "NL-LI", name: "Limburg" },
      ],
    });
  });

  it("lists the closest names of a value that is no region", () => {
    expect(indexes["us-states"].explain("Californa").candidates[0]).toEqual({
      id: "06",
      name: "California",
    });
    expect(indexes.countries.explain("Germny").candidates[0].id).toBe("276");
    expect(indexes.admin1.explain("Ontaro", { country: "CA" }).candidates).toEqual([
      { id: "CA-ON", name: "Ontario" },
    ]);
    expect(
      indexes["us-cbsa"].explain("San Fransisco").candidates.map(({ id }) => id),
    ).toContain("41860");
    expect(indexes["us-counties"].explain("Cok County", { state: "IL" }).reason).toBe(
      "unmatched",
    );
  });

  it("has nothing to offer for a value that is far from every name", () => {
    expect(indexes.countries.explain("zzzzqqqq")).toEqual({
      reason: "unmatched",
      candidates: [],
    });
    expect(indexes.countries.explain(null).candidates).toEqual([]);
    expect(indexes.countries.explain("France").reason).toBe("matched");
  });
});
