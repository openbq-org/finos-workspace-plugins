import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_STATIC_BYTES, modebarOf, staticOf, stateOf, viewFromRelayout, viewed, visibilityFromRestyle } from "../src/figure.js";

const figure = (data, layout = {}) => ({ data, layout });

test("a zoom is read from the relayout events, in both of Plotly's spellings, and double click clears it", () => {
  let axes = viewFromRelayout({ "xaxis.range[0]": 1, "xaxis.range[1]": 5, "yaxis.range": [0, 9], "dragmode": "pan" });
  assert.deepEqual(axes, { xaxis: [1, 5], yaxis: [0, 9] });
  axes = viewFromRelayout({ "xaxis.autorange": true }, axes);
  assert.deepEqual(axes, { yaxis: [0, 9] });
  assert.deepEqual(viewFromRelayout({ "xaxis2.range[0]": "2026-01-01", "xaxis2.range[1]": "2026-02-01" }, axes), { yaxis: [0, 9], xaxis2: ["2026-01-01", "2026-02-01"] });
  assert.deepEqual(viewFromRelayout({ "scene.camera": {}, "xaxis.range": [1] }, axes), axes);
  assert.deepEqual(viewFromRelayout(null, axes), axes);
});

test("a legend click is read from the restyle event, for one or many traces", () => {
  assert.deepEqual(visibilityFromRestyle({ visible: ["legendonly"] }, [2], {}), { 2: false });
  assert.deepEqual(visibilityFromRestyle({ visible: [true] }, [2], { 2: false, 0: false }), { 2: true, 0: false });
  assert.deepEqual(visibilityFromRestyle({ visible: [false, true] }, [0, 1, 2], {}), { 0: false, 1: true, 2: false });
  assert.deepEqual(visibilityFromRestyle({ "marker.color": ["red"] }, [0], { 1: true }), { 1: true });
  assert.deepEqual(visibilityFromRestyle({ visible: ["legendonly"] }, [-1, 1.5, "x"], {}), {});
});

test("the saved view is laid over the figure without changing it", () => {
  const original = figure([{ type: "bar", y: [1] }, { type: "bar", y: [2], visible: "legendonly" }], { xaxis: { title: "t" } });
  const view = viewed(original, { axes: { xaxis: [1, 4], yaxis: [0, 2], xaxis3: [0, 1], yaxis2: [5, 6] }, visible: { 0: false, 1: true } });
  assert.deepEqual(view.layout.xaxis, { title: "t", range: [1, 4], autorange: false });
  assert.deepEqual(view.layout.yaxis, { range: [0, 2], autorange: false });
  assert.equal(view.layout.xaxis3, undefined);
  assert.equal(view.layout.yaxis2, undefined);
  assert.deepEqual(view.data.map((trace) => trace.visible), ["legendonly", true]);
  assert.equal(original.data[0].visible, undefined);
  assert.equal(viewed(original, {}), original);
  assert.equal(viewed(original, { axes: { xaxis: [1] } }).layout.xaxis.range, undefined);
});

test("the state is written only when it differs from the saved one", () => {
  assert.equal(stateOf({}, {}, {}), null);
  assert.equal(stateOf(undefined, {}, {}), null);
  assert.deepEqual(stateOf({}, { xaxis: [1, 2] }, {}), { axes: { xaxis: [1, 2] } });
  assert.equal(stateOf({ axes: { xaxis: [1, 2] }, visible: { 0: false } }, { xaxis: [1, 2] }, { 0: false }), null);
  assert.deepEqual(stateOf({ axes: { xaxis: [1, 2] } }, {}, {}), {});
});

test("a static copy holds the whole figure, with the reader's zoom and hidden series, and none of the endpoint's wrapper", () => {
  const original = {
    data: [{ type: "heatmap", z: [[1, 2], [3, 4]] }, { type: "bar", x: ["a"], y: [1], marker: { color: "red" } }],
    layout: { title: { text: "T" }, template: { layout: { colorway: ["red"] } }, xaxis: { title: "X" } },
    frames: [{ name: "f1", data: [{ y: [1] }] }],
    config: { responsive: true },
  };
  const { data, error } = staticOf(original, { axes: { xaxis: [1, 2] }, visible: { 1: false } });
  assert.equal(error, undefined);
  assert.deepEqual(Object.keys(data).sort(), ["data", "frames", "layout"]);
  assert.deepEqual(data.data[0], original.data[0]);
  assert.equal(data.data[1].visible, "legendonly");
  assert.equal(data.data[1].marker.color, "red");
  assert.deepEqual(data.layout.xaxis, { title: "X", range: [1, 2], autorange: false });
  assert.deepEqual(data.layout.template, original.layout.template);
  assert.deepEqual(data.frames, original.frames);
  assert.equal(original.data[1].visible, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(data)), data);
});

test("a static copy of a figure with no frames has none, and one over the size the host takes says so", () => {
  assert.deepEqual(Object.keys(staticOf({ data: [], layout: {} }, {}).data), ["data", "layout"]);
  assert.deepEqual(staticOf({ data: [], layout: {}, frames: [] }, {}).data, { data: [], layout: {} });
  const big = staticOf({ data: [{ type: "scatter", y: [...Array(60000)].map((_, i) => i * 1.123456789) }], layout: {} }, {});
  assert.equal(big.data, undefined);
  assert.match(big.error, /^The figure is \d+ KiB, and a static chart holds at most 371 KiB\.$/);
  const fits = staticOf({ data: [{ type: "scatter", y: [...Array(1000)].map((_, i) => i) }], layout: {} }, {});
  assert.ok(new TextEncoder().encode(JSON.stringify(fits.data)).byteLength <= MAX_STATIC_BYTES);
});

test("the modebar is off unless the card's setting or the author's declaration turns it on, and the setting wins", () => {
  assert.equal(modebarOf(undefined, undefined), false);
  assert.equal(modebarOf({}, {}), false);
  assert.equal(modebarOf({}, { modebar: false }), false);
  assert.equal(modebarOf({}, { modebar: true }), true);
  assert.equal(modebarOf({ modebar: true }, undefined), true);
  assert.equal(modebarOf({ modebar: false }, { modebar: true }), false);
  assert.equal(modebarOf({ modebar: "yes" }, { modebar: "yes" }), false);
});
