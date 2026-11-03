import { describe, expect, it } from "vitest";
import { describedBy } from "~/lib/geo/files/convention";

class Searched extends Array<readonly [string, string]> {
  searches = 0;
  override find(...args: Parameters<Array<readonly [string, string]>["find"]>) {
    this.searches++;
    return super.find(...args);
  }
}

describe("describedBy", () => {
  it("writes a value under what the values are, and leaves the labels and empty data out", () => {
    expect(
      describedBy(
        "Stores",
        [
          ["valueLabel", "Revenue"],
          ["value", "12"],
          ["sizeLabel", "Staff"],
          ["size", "3"],
          ["city", "Lyon"],
          ["note", ""],
        ],
        "2024",
      ),
    ).toBe("layer: Stores\nRevenue: 12\nStaff: 3\ncity: Lyon\ntime: 2024");
    expect(describedBy(undefined, [["value", "12"]], undefined)).toBe("value: 12");
  });

  it("searches the data of a placemark for its labels once, however many values it repeats", () => {
    const data = new Searched();
    for (let at = 0; at < 20_000; at++) data.push(["value", String(at)]);
    const text = describedBy(undefined, data, undefined);
    expect(text.split("\n")).toHaveLength(20_000);
    expect(data.searches).toBeLessThanOrEqual(2);
  });
});
