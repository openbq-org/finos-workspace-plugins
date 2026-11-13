# Charts with the Plotly charts component

Use the Plotly charts component (`plotly-charts/chart`) to show a chart in the conversation. Give it a Plotly figure as plotly.js takes it: `{ "data": [traces], "layout": {...}, "frames": [...] }`. Any chart plotly.js draws works. The user can add the card to a dashboard as a widget, so give it a clear title.

## Choose the trace

| The question | `type` | How |
|---|---|---|
| Compare a number across categories | `bar` | `x` holds the category labels and `y` the values. Several series side by side, or `layout.barmode: "stack"` to stack them. |
| A number over time, or over any ordered `x` | `scatter` with `mode: "lines"` (or `"lines+markers"`) | `x` holds dates as ISO strings (`"2026-01-01"`) or numbers. |
| Two numbers against each other | `scatter` with `mode: "markers"` | `x` and `y` are both numbers. `marker.size` and `marker.color` add a third and a fourth. |
| The shares of a whole | `pie` (`hole: 0.5` for a donut), or `treemap` and `sunburst` for a hierarchy | `labels` and `values`; `parents` for a hierarchy. |
| The spread of a number | `histogram`, `box`, `violin` | `x` or `y` holds the raw values. |
| A number over two categories or two numbers | `heatmap`, `contour` | `z` is a list of rows; `x` and `y` name the columns and rows. |
| Prices | `candlestick`, `ohlc` | `x`, `open`, `high`, `low`, `close`. |
| Flows between nodes | `sankey` | `node.label`, and `link.source`, `link.target`, `link.value` as indexes. |
| Places | `scattergeo`, `choropleth`, `scattermap` | `lat` and `lon`, or `locations` as ISO-3 codes with `z`. |
| Three numbers at once | `scatter3d`, `surface` | `x`, `y`, `z`. |

For long category labels use `orientation: "h"`, with the numbers in `x` and the labels in `y`.

## The data

```json
{
  "data": [{ "type": "bar", "name": "Units", "x": ["Jan", "Feb", "Mar"], "y": [3, 8, 5] }],
  "layout": { "title": "Sales by month", "xaxis": { "title": "Month" }, "yaxis": { "title": "Units" } }
}
```

## Rules

- Name each series (`name`) when there are several: the names make the legend.
- Give titles to the chart and to the axes when the numbers need a unit.
- Keep the figure small. The whole figure may be at most 256 KiB, at most 64 traces, and nested no deeper than about twelve levels. When you have more rows than a few thousand, aggregate them first (by day, week or month) instead of sending every row.
- Do not set colours, templates or backgrounds. The chart is drawn in the workspace's light or dark mode, and again when the mode changes; setting a colour of the figure turns that off.
- Send numbers as numbers, with no `NaN` or infinite values, and no JavaScript. Images and map tiles are not fetched: a tile map is drawn over a built-in world map.
- Say what the chart shows and what stands out; do not repeat the numbers it draws.
