import assert from "node:assert/strict";
import { test } from "node:test";

import { forecastRows, holt, nextLabels } from "../src/forecast.js";

test("a straight line forecasts as its continuation, with a narrow band", () => {
  const result = holt([10, 12, 14, 16, 18, 20], 3);
  result.forecast.forEach((v, i) => assert.ok(Math.abs(v - (22 + 2 * i)) < 0.5, `${v}`));
  assert.ok(result.sigma < 0.5);
  assert.ok(result.lower[2] <= result.forecast[2] && result.upper[2] >= result.forecast[2], "a perfect fit has a band of no width");
});

test("a noisy series gets a band that widens with the horizon", () => {
  const result = holt([100, 108, 97, 115, 104, 121, 110, 128], 4);
  const widths = result.upper.map((u, i) => u - result.lower[i]);
  assert.ok(widths[3] > widths[0]);
  assert.equal(holt([1, 2, 3], 2), null, "too few points");
});

test("the next periods: daily, monthly, quarterly, numbers and text", () => {
  assert.deepEqual(nextLabels(["2024-01-01", "2024-01-02", "2024-01-03"], 2), ["2024-01-04", "2024-01-05"]);
  assert.deepEqual(nextLabels(["2024-01-31", "2024-02-29", "2024-03-31"], 2), ["2024-04-30", "2024-05-31"]);
  assert.deepEqual(nextLabels(["2023-12-31", "2024-03-31", "2024-06-30"], 2), ["2024-09-30", "2024-12-31"]);
  assert.deepEqual(nextLabels([2020, 2021, 2022], 2), [2023, 2024]);
  assert.deepEqual(nextLabels(["Q1", "Q2"], 2), ["+1", "+2"]);
});

test("the chart rows: history, then the forecast joined to the last actual point", () => {
  const { rows } = forecastRows([{ x: 2020, y: 1 }, { x: 2021, y: 2 }, { x: 2022, y: 3 }, { x: 2023, y: 4 }], 2);
  assert.equal(rows.length, 6);
  assert.deepEqual(rows[3], { x: "2023", actual: 4, forecast: 4 });
  assert.equal(rows[4].x, "2024");
  assert.ok(rows[5].upper >= rows[5].forecast && rows[5].lower <= rows[5].forecast);
});
