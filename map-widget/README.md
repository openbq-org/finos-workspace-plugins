# Map for FINOS Workspace

A FINOS Workspace widget plugin that draws the `map` widget type with MapLibre GL JS. Any backend whose `widgets.json` declares a widget of type `map`, and whose endpoint returns rows, GeoJSON, KML or a map, is drawn by this plugin once a FINOS Workspace deployment has approved and enabled it. It is a package of its own that nothing in FINOS Workspace imports, built and deployed the way any plugin is ([Plugin package and manifest](https://github.com/openbq-org/workspace/blob/develop/docs/reference/plugins/package-and-manifest.mdx)).

The code of the map comes from a Workspace app that has a native map widget, and it is taken out of that app as a plugin, with its basemap, its map sources and its export menu: its readers of rows, GeoJSON, KML, KMZ, GPX and shapefiles, its reducer, its scene of layers, and its view with the layer panel, the legend, the tags, the data table, drawing and measuring. What the app gave it (the widget context, the theme store, the icons, the connections of the viewer) is replaced by what a plugin frame has: the traits of the model and the commands of the host.

## The contract

A backend declares the widget with its type and endpoint, and names the columns of its rows in `data.map`:

```json
{
  "offices": {
    "name": "Offices",
    "type": "map",
    "endpoint": "/offices",
    "data": {
      "map": {
        "lat": "lat",
        "lon": "lon",
        "label": "name",
        "value": "staff",
        "category": "kind",
        "tag": "name",
        "valueLabel": "Staff"
      }
    }
  }
}
```

The endpoint answers with JSON, in one of these forms:

- **Rows**, a list of objects, or `{"results": [...]}`. `data.map` names where each row is: `lat` and `lon`, or `city`, or `zip`, or one of `state`, `county`, `country`, `province`, `metro` and `district` (with `"as": "points"` a state or a country is a point at its centre). It also names `value`, `label`, `tag`, `marker`, `size`, `color`, `category`, `time`, `props` (up to 12 more columns for the card of a mark), `valueLabel` and `title`. `category` colours the rows of one value alike and gives each an entry in the legend (12 at most).
- **GeoJSON**, a FeatureCollection. `data.map.value` names the number property that colours the features, `data.map.category` the text property that colours them by category, `data.map.height` the one that says how high an area stands, in metres, and `data.map.time` the one to play by.
- **A map file**: `{"kml": "<text>"}`, `{"gpx": "<text>"}`, `{"kmz": "<base64>"}` or `{"shapefile": "<base64 of the zip>"}`. Folders are layers, and the images of a KMZ are drawn.
- **A map**, as the reducer of the plugin takes it: `points`, `regions`, `shapes`, `flows` and `layers`.

```python
from fastapi import FastAPI

app = FastAPI()
OFFICES = [
    {"name": "New York", "lat": 40.7128, "lon": -74.006, "staff": 120, "kind": "HQ"},
    {"name": "London", "lat": 51.5072, "lon": -0.1276, "staff": 85, "kind": "Office"},
]

@app.get("/offices")
def offices():
    return OFFICES
```

An endpoint that answers `[]` shows "No locations match this widget's current selection." An answer that is no map shows why on the card. FINOS Workspace adds `theme=dark` or `theme=light` to the endpoint's query; the map follows the mode by itself, so the endpoint needs not.

A map has at most 20,000 points, 4,000 regions, 3,500 lines and areas, and 2 MB of JSON; a map file is read up to 4 MB. A map over a limit says which one it is over.

## What it gives the FINOS Workspace

- **Exports.** The export dialog offers the map as *KML*, *KMZ* and *GeoJSON*, with the tags and the shapes of the user, and the names of the regions it shades.
- **Agent context.** The AI agent gets what the map is (its counts, the range of its values, the categories) and what a reader sees on it (`shows`), with its first 300 rows: the place of each mark, its label, its value and its tag. No row holds the geometry of a shape.
- **State.** What the reader changes stays with the dashboard: the tags they add, the shapes they draw, and the view (the layers turned on or off, the opacity, the boundaries, the camera). It is the `state` of the widget, at most 64 KiB.
- **Boundaries.** A row that names a US state, a county, a country, a first-level region, a metro area, a congressional district, a ZIP code or a city is placed from files the package carries (`assets/geo/`, 10 MB, read when a map needs them): nothing is asked of any server.
- **Basemap.** The map sits on vector tiles of OpenStreetMap data: land, water, borders, roads, buildings and place names. By default they come from the public OpenFreeMap tile service, so the frame is allowed to reach `https://tiles.openfreemap.org` (`csp` in `src/plugin.json`, which a superuser approves). The admin setting *Tile service* can switch that off, and then the map is drawn on a PMTiles file of the world, zoom 0 to 6, that the package carries (`assets/basemap/world.pmtiles`, 43 MB). The setting *PMTiles file* names a file that you host, with more zooms: its host must be added to the frame policy by a superuser. When no tiles can be read, the map is drawn on the boundary files.
- **Map sources.** A map can draw raster tiles, vector tiles, PMTiles files, GeoJSON, images and elevation over the basemap or in place of it, as layers of the layer panel. A source is declared in `data.map.sources` by the backend, or in the admin setting *Map sources* as a JSON list. Each has an `https` address, and its host must be in the frame policy before its data loads. In `data.map.sources`, the colour of a layer of vector data is `{"value": "#rrggbb"}`, or `{"property", "scale", "domain"}` for a scale; the admin setting takes a plain `"#rrggbb"` too.
- **Names.** Place names and the counts of clusters are drawn with the glyphs of Noto Sans in the package (`assets/basemap/fonts/`), which the map library reads through a protocol of its own, `workspace-asset://`, so it makes no request.
- **Chat.** The widget declares an `artifact` (`src/plugin.json`): the AI agent can show a map under its answer, from points at a latitude and a longitude, or from US states or countries with a value. The user adds the card to a dashboard as a widget that keeps the data.
- **Skill.** `maps` (`src/skills/maps.md`) tells the AI agent when a map fits, the data it takes, and its limits.

It asks for `core:data:read`, `core:export:provide`, `core:copilot:context`, `core:state:write` and `core:clipboard:write` (the copy button of the measure of a point). The only host it asks the frame to reach is the tile service above; everything else it draws comes from the widget's own endpoint through FINOS Workspace and from its package.

## What it does not do

The map of the app has parts that need things a plugin frame does not have. This plugin has none of these:

- **The map of the widget library,** which a reader builds from the rows of other widgets on the dashboard and from files kept with the widget. A frame cannot read other widgets, and its `state` holds at most 64 KiB.
- **Tools of the AI agent that move the view** of a map. The agent reads the map through the agent context above.
- **Map sources that carry the user's credentials.** A source of a plugin is an address; the frame sends no header for it.
- **The rows button.** A map does not set `raw`: its data table is the map's own, behind the button of the map.

## Build

Node 20 or later. The dependencies are `maplibre-gl`, the map library; `pmtiles` and `@protomaps/basemaps`, which read and style the world file; `react`, `react-dom`, `react-error-boundary` and `react-resize-detector`, which draw its controls; `fflate`, which reads zip files; and `topojson-client`, which reads the boundary files. `esbuild` and Tailwind CSS build it.

```bash
npm install
```

```bash
npm run build
```

The build writes `dist/map-widget/<version>/`, with the version from `package.json`:

- `entry.js`: `src/entry.tsx` and everything it imports, in one module. A plugin frame loads one module and its styles, nothing else. MapLibre's worker, which prepares tiles and glyphs, is a module of the library; Chromium does not start a module worker from a Blob URL in the frame's opaque origin, so the build takes the one `export` at its end out, replaces the one `globalThis.eval` of its script loader with an error, embeds it in `entry.js`, and the module starts it from a Blob URL as a classic worker. The build stops if the worker does not have them exactly once.
- `entry.css`: the stylesheet of MapLibre and the classes of the controls, from `src/styles.css`. The colours of the controls follow the `theme` trait: the module sets the mode on the root element, and the tokens of the host as custom properties.
- `assets/icon.svg`, `assets/geo/` (the boundary files of `vendor/geo/`), `assets/basemap/world.pmtiles` (the world at low zoom) and `assets/basemap/fonts/` (the glyphs) and `assets/THIRD-PARTY-LICENSES.txt`: the licenses of MapLibre, the boundary files, GeoNames and Noto Sans, which the package redistributes.
- `skills/maps.md`.
- `plugin.json`: `src/plugin.json` with the version and the checksum.

The build fetches `world.pmtiles` first, with `scripts/fetch-basemap.mjs`: zoom 0 to 6 of a pinned Protomaps daily build, cut with a few range requests and checked against its SHA-256. A daily build stays on `build.protomaps.com` for a limited time. When the pinned one is gone, run `node scripts/fetch-basemap.mjs --build <YYYYMMDD>`, which prints the new SHA-256 to pin, or pass `BASEMAP_MIRROR` with a copy you keep. The build goes on without the file when it cannot be fetched, unless `BASEMAP_REQUIRED=1` is set; the map then uses the tile service or the boundary files.

It prints the checksum and the version digest. The package is about 57 MB, and a deployment's `WIDGET_PLUGINS_MAX_UNPACKED_BYTES` (64 MB by default) must be at least that.

```bash
npm run typecheck
```

```bash
npm test
```

The tests are the ones of the map of the app, with those of the parts a plugin does not have taken out: the readers and writers of GeoJSON, KML, KMZ, GPX and shapefiles, with their fixtures and their hostile files; the reducer; the boundary sets, the cities and the ZIP codes, against the files of `vendor/geo/`; the scene and the style of every kind of layer; and the view, its controls, the legend, the layer panel, the drawing tools and the camera, against a fake map library. The tests of the plugin itself are the manifest, the exports, the host commands, the widget (rows to a map, the states of the card, what is kept) and the loading of the library. Drawing needs a browser; check it on a dashboard, below.

`vendor/geo/README.md` says where each boundary file comes from, and `scripts/geo/` rebuilds them from their public sources.

## Deploy

On a FINOS Workspace deployment (`local/LOCAL_SETUP.md`, "Widget plugins", for your own stack):

1. Copy `dist/map-widget/<version>/` into the plugins directory (`WIDGET_PLUGINS_DIR`), as `map-widget/<version>/`.
2. Check it with the server's validator, from `backend-api/backend`: `python -m scripts.plugin_check <plugins directory>/map-widget/<version> --digest`.
3. Where versions must be pinned, add the printed digest to `WIDGET_PLUGINS_PINS` as `"map-widget@<version>": "<digest>"`.
4. Admin, Widgets, Deployment: Rescan, review what the version asks for, approve it, and enable it for the organization. Then, under Roles, grant it to the roles that may use it: a role is the only way to a plugin.

Every change is a new version: raise `version` in `package.json` and build again. FINOS Workspace blocks an approved version whose files change. On your own stack, the plugin's Deployment page starts the next version for you and serves it from its files as you rebuild them (see the documentation site, How to build and try a widget plugin).

## Try it

Run a backend with the widget above (the snippet of the contract, with its `widgets.json`), connect it under Connections, and add *Offices* to a dashboard. Turn on the layer panel to see the boundaries, click a point for its card, and use the pencil and the ruler to draw and measure. The export dialog of the card has the three formats, and the AI agent can say where the offices are.

## Notes

- A dashboard places its cards after their frames start, so the widget can render before it has a size. The map measures its box with a resize observer and draws once it has one.
- `entry.js` is about 2.4 MB and the package about 57 MB, most of it the world file, which a map reads once from its package. The browser caches `entry.js` per version. The boundary files (a county set is 0.8 MB, a continent of first-level regions 1 MB) and the glyphs are read only by a map that needs them.
- The map of a widget is made on the thread of the frame, not in a worker: a file of 4 MB takes 0.3 to 0.6 seconds, and the card shows its loading state meanwhile. Each widget has a frame of its own, so no other card waits for it.
