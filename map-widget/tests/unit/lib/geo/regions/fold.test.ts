import { describe, expect, it } from "vitest";
import { codeKey, nameKey, nameWords, written } from "~/lib/geo/regions/fold";

describe("nameKey", () => {
  it.each([
    ["  Côte-d'Ivoire ", "cotedivoire"],
    ["St. Louis", "saintlouis"],
    ["Saint Louis", "saintlouis"],
    ["Ste. Genevieve", "saintegenevieve"],
    ["Mt. Vernon", "mountvernon"],
    ["Ft. Worth", "fortworth"],
    ["Prince George's", "princegeorges"],
    ["De Kalb", "dekalb"],
    ["DeKalb", "dekalb"],
    ["Trinidad & Tobago", "trinidadandtobago"],
    ["Łódź", "lodz"],
    ["Straße", "strasse"],
    ["Ærø", "aero"],
    ["Đồng Nai", "dongnai"],
    ["São Paulo", "saopaulo"],
    ["İstanbul", "istanbul"],
    ["Москва", "москва"],
    ["北京", "北京"],
    ["", ""],
    ["---", ""],
  ])("reads %j as %j", (text, key) => {
    expect(nameKey(text)).toBe(key);
  });

  it("keeps the words apart and the short forms as written when asked", () => {
    expect(nameWords("St. Paul-Minneapolis")).toEqual(["saint", "paul", "minneapolis"]);
    expect(nameWords("MT-01", false)).toEqual(["mt", "01"]);
  });
});

describe("codeKey and written", () => {
  it("reads a code without its case and its separators", () => {
    expect(codeKey(" ca-on ")).toBe("CAON");
    expect(codeKey("CA.ON")).toBe("CAON");
    expect(codeKey("0612")).toBe("0612");
  });

  it("reads text and whole numbers, and nothing else", () => {
    expect(written(" CA ")).toBe("CA");
    expect(written(6)).toBe("6");
    expect(written(35620)).toBe("35620");
    for (const value of [6.5, -1, Number.NaN, "", "   ", null, undefined, {}, [], true])
      expect(written(value), String(value)).toBeNull();
    expect(written("x".repeat(81))).toBeNull();
  });
});

describe("a cell that says it has no value", () => {
  it("is no region: N/A is not the code of Namibia", async () => {
    const { written } = await import("~/lib/geo/regions/fold");
    for (const empty of ["N/A", "n/a", " N/A ", "#N/A", "n.a.", "N / A", ""])
      expect(written(empty), empty).toBeNull();
    for (const empty of [
      "<NA>",
      "(n/a)",
      "NA.",
      "N\\A",
      "[NA]",
      "-NA-",
      "N.A.",
      "n-a",
      "#NA",
      "NA?",
    ])
      expect(written(empty), empty).toBeNull();
    for (const code of ["NA", "na", "Namibia", "Nauru", "N.A.F.T.A."])
      expect(written(code), code).toBe(code);
  });
});
