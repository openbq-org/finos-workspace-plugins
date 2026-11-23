# Plotly charts for Workspace

A Workspace widget plugin that draws the `plotly` widget type with plotly.js 4. Any backend whose
`widgets.json` declares a widget of type `plotly`, and whose endpoint returns a Plotly figure as
JSON, is drawn by this plugin once a Workspace deployment has approved and enabled it. The plugin
has no plugin backend, no proxy and no secret, and its frame reaches no host.

Nothing in the plugin imports Workspace code. It talks to Workspace only through the widget plugin
contract: `plugin.json`, the AFM module in `entry.js`, traits and host commands. The same built
package serves FINOS Workspace and BQ Workspace. It needs a Workspace with card actions.

## The contract

The widget's endpoint returns a Plotly figure:
`{"data": [traces], "layout": {...}, "frames": [...]}`, as plotly.py's `fig.to_json()`
writes it, numpy arrays as typed arrays included. A backend declares the widget with its
type and endpoint; there is nothing else to configure:

```json
{
  "sales": {
    "name": "Sales by region",
    "type": "plotly",
    "endpoint": "/sales"
  }
}
```

The figure is drawn as its author made it: template, colors, fonts and size are the
author's. FINOS Workspace adds `theme=dark` or `theme=light` to the endpoint's query, the
site's mode, and asks again when the user switches it. The endpoint answers with the
look it wants for each:

```python
import plotly.graph_objects as go
from fastapi import FastAPI, Response

app = FastAPI()
TEMPLATES = {"dark": "plotly_dark", "light": "plotly_white"}

@app.get("/sales")
def sales(theme: str = "dark"):
    figure = go.Figure(go.Bar(x=["Jan", "Feb"], y=[100, 114]))
    figure.update_layout(template=TEMPLATES.get(theme, "plotly"))
    return Response(figure.to_json(), media_type="application/json")
```

A response that is not a figure shows "The endpoint did not return a Plotly figure.", and a
figure plotly.js cannot draw shows why on the card.

### The rows: `raw`

A widget can give the rows its chart is made from (Widget rows, in the Workspace reference).
With `"raw": true`, FINOS Workspace asks the endpoint again with the widget's params and
`raw=true`, and reads the rows at `data.rawDataKey`, else the answer's `results`, else the
whole answer. The AI agent and MCP clients get those rows instead of the figure, and the
card's database button shows them: drawn by this plugin as a table, or by the plugin of
`data.rawType` when the user may use that type.

```json
{
  "sales": {
    "name": "Sales by region",
    "type": "plotly",
    "endpoint": "/sales",
    "raw": true
  }
}
```

```python
ROWS = [{"month": "Jan", "sales": 100}, {"month": "Feb", "sales": 114}]

@app.get("/sales")
def sales(theme: str = "dark", raw: bool = False):
    if raw:
        return ROWS
    figure = go.Figure(go.Bar(x=[r["month"] for r in ROWS], y=[r["sales"] for r in ROWS]))
    figure.update_layout(template=TEMPLATES.get(theme, "plotly"))
    return Response(figure.to_json(), media_type="application/json")
```

An endpoint that answers both in one shape, `{"results": {"chart": <figure>, "records":
[...]}}`, sets `"data": {"dataKey": "results.chart", "rawDataKey": "results.records"}`.

## What every card has

- **Exports.** The export dialog lists what the figure holds:
  - *Data (CSV)*, when a trace has x/y, label/value or open/high/low/close values (a
    trace with `z` is a grid, and has none). Traces that share their x values give one
    row per x and a column per trace (per trace and field for open/high/low/close);
    traces that do not give one row per point: trace, x, y. Columns are named by the axis
    titles.
  - *Figure (Plotly JSON)*, the figure as the endpoint returned it.
  - *Chart (PNG)* and *Chart (SVG)*, once the chart is drawn: as drawn, at the card's size (the PNG at twice the pixels).
  - With the rows shown: *Rows (CSV)*, *Rows (JSON)*, *Table (PNG)* and *Table (SVG)*.
- **Agent context.** With `raw`, the AI agent gets the rows. Without it, the figure, and
  the title and, per trace, its name, type, number of points, and minimum and maximum
  (of z for a grid, of low and high for open/high/low/close), the saved zoom of each axis and
  the names of the hidden series.
- **Colours.** A figure with no `template`, `paper_bgcolor` or `plot_bgcolor` is drawn in the
  site's light or dark mode, and again when the mode changes: the paper, the plot, the axes, the
  `geo`, `polar`, `ternary` and `smith` subplots, and the buttons of `updatemenus`, which keep a
  light face with dark text in both modes because Plotly paints the pressed button near white.
  What the author sets in a subplot wins. A figure that sets any of the three is drawn as its
  author made it.
- **Maps.** Geo traces (`scattergeo`, `choropleth`) are drawn with the outlines of
  [sane-topojson](https://github.com/plotly/sane-topojson), which plotly.js would fetch
  and which come with the package instead: the world, the USA, Europe, Asia, Africa,
  North and South America, at 1:110m and 1:50m. A figure's outlines are read the first
  time it needs them. Tile maps (`scattermap`, `densitymap`, `choroplethmap`) are drawn
  with the figure's own base map when the frame can reach it: the hosts its style names
  (by default `basemaps.cartocdn.com`), which a superuser allows in the plugin's CSP
  override (Plugin frame policy, in the Workspace reference); the plugin's Blocked
  requests list names them. Otherwise they are drawn over a base map made from the same
  outlines, at 1:50m: water, land, lakes, country borders and coastlines, in the site's
  light or dark mode. Labels on it are drawn with the browser's own fonts, so nothing is
  fetched; `"white-bg"` is drawn the same way.
- **LaTeX.** Text plotly.js reads as LaTeX, `$...$`, is typeset with MathJax 4, read
  from the package the first time a figure has some.

- **Chat.** The widget declares an `artifact` (`src/plugin.json`) that takes any Plotly figure,
  `{data, layout, frames}`: the AI agent can show a chart of any kind under its answer, and
  the user adds the card to a dashboard as a full-width widget that keeps the figure. The schema
  is recursive, because Workspace takes only a closed and bounded schema for what a widget is
  given: a `$defs/value` that is any JSON value, with every array bounded, written out seven levels
  deep before each `$ref` so that a figure nested about twelve levels fits Workspace's depth cap. A
  plotly.py figure with its template, about ten levels, is within it. The figure may be at most
  384 KiB when a user adds it from a card, 256 KiB when an agent gives it. A figure with no
  `template`, `paper_bgcolor` or `plot_bgcolor`, as an agent writes it, is drawn in the site's light or dark mode, and again when the mode changes; a figure
  that sets any of them is drawn as its author made it.

- **Skill.** `plotly-charts` (`src/skills/plotly-charts.md`) tells the AI agent which trace fits
  which question, the shape of the data, and the limits above, so that it shows a chart
  instead of drawing one as HTML.

## Card actions

The card's header and options menu carry the plugin's own actions. Workspace draws them from the
widget's `actions` in `plugin.json` and sends the module an `action` event when the user picks one.

| Action | Where | What it does |
|---|---|---|
| Data table | Header, toggles `dataTable` | Shows the plotted points as a table, the rows of *Data (CSV)*, instead of the chart. A figure with no x/y, label/value or open/high/low/close values stays a chart. |
| Modebar | Header, toggles `modebar` | Shows or hides Plotly's toolbar. It is off unless the author turns it on (below). |
| Create static chart | Header | Adds a chart widget of its own to the dashboard, with no endpoint: the whole figure as the card shows it, any trace type, with the reader's zoom and hidden series applied and the endpoint's wrapper left out. A figure over 380,000 bytes says so and adds nothing; so does a card that shows rows instead of a figure. |
| Reset view | Menu | Forgets the saved zoom and the hidden series. |
| Show all series | Menu | Shows every series, those the author hid included. |
| Copy figure JSON | Menu | Puts the figure as the endpoint returned it on the clipboard. |

### The modebar

Plotly's toolbar is off. An author turns it on for a widget in `widgets.json`:

```json
{
  "sales": {
    "name": "Sales by region",
    "type": "plotly",
    "endpoint": "/sales",
    "data": { "plotly": { "modebar": true } }
  }
}
```

A new card of that widget starts with the modebar on and the button pressed. The reader can turn it
off, and the choice is saved with the dashboard: the card's `modebar` setting wins over the
author's. The setting is also in the card's Settings and in presets, and the AI agent reads and
sets it with the other settings.

### The saved view

The module saves what the reader did to the chart in the card's `state`: the range of every
axis they zoomed or panned, and the series they hid or showed by clicking the legend. The view
survives a reload and a change of mode, goes into presets, and is applied again to the figure the
endpoint returns, whatever the figure's own ranges. Double click on the chart, or Reset view,
clears it. Maps and 3D scenes keep no view.

## Permissions

| Permission | Used for |
|---|---|
| `core:data:read` | The figure or the rows. |
| `core:export:provide` | The export dialog. |
| `core:copilot:context` | What the AI agent reads about the card. |
| `core:state:write` | The saved view. |
| `core:config:write` | Writing the `modebar` setting when the author turns it on. |
| `core:clipboard:write` | Copy figure JSON. |
| `core:ui:notify` | Saying that the figure was copied, or why a static chart cannot be made. |
| `core:ui:button`, `core:ui:menu` | The card's header buttons and menu items. |
| `core:dashboard:add-widget` | Create static chart. |

## Model traits

`data`, `definition` (the widget's `data.plotly`), `theme` and `config` (the settings
`dataTable` and `modebar`, written for `modebar`), and `state` (written).

## Build

Node 20 or later (CI runs 26.12.1). The dependencies are `plotly.js-strict-dist-min`, plotly.js's strict bundle:
every trace type, built without function constructors, which a plugin frame's policy refuses;
`sane-topojson`, the map outlines; and `mathjax`, for LaTeX. `esbuild` bundles the module's own files.

```bash
npm ci --ignore-scripts
npm run build
npm run verify
```

The build writes `dist/plotly-charts/<version>/`, with the version from `package.json`:

- `entry.js`: `src/entry.js` and `src/figure.js` bundled, with the plotly.js bundle inlined. A
  plugin frame loads one module and its styles, nothing else. plotly.js is loaded as a classic
  script from a Blob URL, because its bundle expects a sloppy-mode script. The build edits that
  bundle in three places and stops if one is not there exactly as expected: MapLibre's worker, which
  draws tile maps, ends with an `export` that makes it a module, and Chromium does not start a module
  worker from a Blob URL in the frame's opaque origin, so the build takes that `export` out; two
  dynamic-code calls that the frame's policy refuses are replaced; and MapLibre's `"file://"` origin
  literal is written as `"file:"+"//"` so that the package does not look like it embeds a local path.
- `entry.css`, `assets/icon.svg`, and the icons of the actions, `assets/static-chart.svg` and
  `assets/show-all.svg`.
- `assets/topojson-<scope>_<resolution>m.json`, the outlines, and `assets/mathjax-tex-svg.js`,
  MathJax with its font: files the module reads from the host (`core:asset:read`) when a figure
  needs them.
- `assets/THIRD-PARTY-LICENSES.txt`: the licence of plotly.js, MathJax and sane-topojson, which the
  package redistributes.
- `skills/plotly-charts.md` and `plugin.json`, the manifest with the version and the checksum.

`npm run verify` checks the package as Workspace's discovery does and prints the version digest.
`PLOTLY_BUNDLE=<path>` builds from another copy of `plotly-strict.min.js`. `entry.js` is about 5 MB,
which the browser caches per version. The outlines (3.7 MB) and MathJax (1.8 MB) are read only by a
figure that needs them.

## Test

```bash
npm test
```

The unit tests run the exports, the agent context, the rows, the saved view, the static copy, the
theming and the manifest in Node, typed arrays included, over a catalogue of 72 figures
(`e2e/figures.mjs`): every trace type plotly.js draws, and the layout features cards rely on. Drawing
needs a browser, so two Playwright suites run against a running Workspace stack, with a small
backend of their own that serves the figures:

- `npm run e2e` adds cards to a dashboard and uses the card's buttons and menu, the legend, the
  export dialog, the light and dark modes and the policy of the frame.
- `npm run e2e:figures` draws each of the 72 figures on one card, switches the data table on and
  off, and checks that nothing broke the page or asked the network for anything. It takes a minute
  and a half for 18 figures, so run it in parts: `E2E_PART=1/4`, then `2/4`, `3/4` and `4/4`.

`E2E_SCREENSHOTS=1` also writes a PNG of each card into `.screenshots/`, which is not tracked, and
`E2E_SCALE=2` makes them twice as sharp.

```bash
E2E_USER_EMAIL=<administrator> E2E_USER_PASSWORD=<password> npm run e2e
```

The plugin must be approved and enabled on that stack, as below. `E2E_BASE_URL` (default
`http://localhost:1420`), `E2E_API_URL` (`http://localhost:8000`), `E2E_BACKEND_PORT`,
`E2E_BACKEND_HOST` and `E2E_CHROMIUM` (a Chromium executable) name the stack and the browser. The
suite creates a role, a backend and a dashboard and removes them again.

## Deploy

The package Workspace consumes is the folder `dist/plotly-charts/<version>/`.

1. Copy it into the plugins directory as `plotly-charts/<version>/`, or run
   `WORKSPACE_PLUGINS_DIR=<plugins directory> npm run install:workspace`.
2. Where versions must be pinned, add the digest that `npm run verify` prints to
   `WIDGET_PLUGINS_PINS` as `"plotly-charts@<version>": "<digest>"`.
3. Admin, Widgets, Deployment: Rescan, review what the version asks for, approve it, and enable it for
   the organization. Then, under Roles, grant it to the roles that may use it: a role is the only way
   to a plugin.

Every change is a new version: raise `version` in `package.json` and build again. Workspace blocks an
approved version whose files change. On a local stack, **Patch** on the plugin's Deployment page
starts the next version as a development version, and
`WORKSPACE_PLUGINS_DIR=<plugins directory> WORKSPACE_PLUGIN_DEV_VERSION=<x.y.z> npm run dev:workspace`
overwrites its files with the build, so a reload of the dashboard shows the change.

## Try it

The examples backend of the Workspace repository (`docs/examples/backend`) has five `plotly` widgets
made with plotly.py: stacked bars, lines, a sampled signal from numpy arrays, a heatmap, and the bars
of any SQL query. It answers `theme=dark` with plotly.py's `plotly_dark` template and `theme=light`
with `plotly_white`. Connect it as a backend under Connections, then add *Sales by region*, *Sales
trend*, *Signal and noise*, *Correlation* and *SQL chart* to a dashboard. *Sales by region* has `raw`:
its database button shows its rows, drawn by the AgGrid plugin, and the AI agent reads them.

## Notes

- A dashboard places its cards after their frames start, so the widget can render before it has a
  size. Plotly measures text when it draws and keeps the measurements, so the widget draws once it
  has a size and redraws when it gets one.
