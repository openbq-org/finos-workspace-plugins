import { describe, expect, it } from "vitest";
import { humanLabel } from "~/lib/geo/mapValues";

describe("what a legend calls a value", () => {
  it.each([
    ["teu", "teu"],
    ["port_calls", "port calls"],
    ["yield_t_per_ha", "yield t per ha"],
    ["lane_id", "lane id"],
    ["GDP_growth", "GDP growth"],
    ["TEU", "TEU"],
    ["Volume_2024", "Volume 2024"],
    ["share__pct", "share pct"],
    ["_rank_", "rank"],
  ])("writes the column name %s as %s", (given, shown) => {
    expect(humanLabel(given)).toBe(shown);
  });

  it.each([
    "Yield (tonnes per hectare)",
    "Cocoa production (tonnes)",
    "GDP per capita",
    "Unemployment rate, %",
    "revenue (USD m)",
    "a label_with spaces",
    "2024",
    "_",
    "",
  ])("leaves a label somebody wrote as it is: %s", (given) => {
    expect(humanLabel(given)).toBe(given);
  });

  it("gives the same label when it is given its own result, and nothing for nothing", () => {
    expect(humanLabel(humanLabel("port_calls"))).toBe("port calls");
    expect(humanLabel(undefined)).toBeUndefined();
  });
});
