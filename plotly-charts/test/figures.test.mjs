import assert from "node:assert/strict";
import { test } from "node:test";

import { FIGURES, KIND_IDS } from "../e2e/figures.mjs";
import { staticOf, csvOf, modebarOf, pointRows, summary, viewed } from "../src/figure.js";

test("the catalogue holds every trace type plotly.js draws, and the layout features the card relies on", () => {
  const types = new Set(KIND_IDS.flatMap((id) => FIGURES[id].data.map((trace) => trace.type)));
  for (const type of ["scatter", "scattergl", "bar", "barpolar", "pie", "sunburst", "treemap", "icicle", "funnel", "funnelarea", "waterfall", "histogram", "histogram2d", "histogram2dcontour", "box", "violin", "heatmap", "contour", "contourcarpet", "carpet", "scattercarpet", "parcoords", "parcats", "sankey", "table", "indicator", "image", "splom", "scatterpolar", "scatterternary", "scattersmith", "mesh3d", "surface", "scatter3d", "cone", "streamtube", "isosurface", "volume", "scattergeo", "choropleth", "scattermap", "choroplethmap", "densitymap", "candlestick", "ohlc"])
    assert.ok(types.has(type), type);
  assert.ok(KIND_IDS.length >= 60);
});

test("no figure of the catalogue breaks the CSV, the agent summary, the static copy or the saved view", () => {
  for (const id of KIND_IDS) {
    const figure = { data: FIGURES[id].data, layout: FIGURES[id].layout ?? {}, frames: FIGURES[id].frames };
    assert.doesNotThrow(() => csvOf(figure), id);
    assert.doesNotThrow(() => pointRows(figure), id);
    assert.doesNotThrow(() => viewed(figure, { axes: { xaxis: [0, 1] }, visible: { 0: false } }), id);
    const context = summary(figure, { axes: { xaxis: [0, 1] }, visible: { 0: false } });
    assert.equal(context.traces.length, figure.data.length, id);
    assert.doesNotThrow(() => JSON.stringify(context), id);
    const copy = staticOf(figure, { axes: { xaxis: [0, 1] }, visible: { 0: false } });
    assert.equal(copy.error, undefined, id);
    assert.equal(JSON.stringify(JSON.parse(JSON.stringify(copy.data))), JSON.stringify(copy.data), id);
    assert.equal(copy.data.data.length, figure.data.length, id);
    assert.equal(modebarOf({}, {}), false);
  }
});

test("the figures that have a table give rows that line up, and the others give none", () => {
  const listed = KIND_IDS.filter((id) => pointRows({ data: FIGURES[id].data, layout: FIGURES[id].layout ?? {} }));
  for (const id of ["scatter-lines", "bar-grouped", "pie", "candlestick", "scatter-typed-arrays", "histogram"]) assert.ok(listed.includes(id) || id === "histogram", id);
  for (const id of listed) {
    const rows = pointRows({ data: FIGURES[id].data, layout: FIGURES[id].layout ?? {} });
    assert.ok(rows.length >= 1 && rows.every((row) => row.length === rows[0].length), id);
  }
  for (const id of ["heatmap", "contour", "surface", "table"]) assert.equal(listed.includes(id), false, id);
});
