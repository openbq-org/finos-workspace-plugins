# Map widget

FINOS Workspace widget plugin for the `map` widget type, drawn with MapLibre GL JS. Package and manifest format: [Plugin package and manifest](https://github.com/finos-labs/finos-workspace/blob/develop/docs/reference/plugins/package-and-manifest.mdx).

## Widget

`widgets.json`:

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

Endpoint:

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

## Endpoint response

| Form | Shape | `data.map` keys |
| --- | --- | --- |
| Rows | a list of objects, or `{"results": [...]}` | place: `lat` + `lon`, `city`, `zip`, `state`, `county`, `country`, `province`, `metro` or `district` (`"as": "points"` draws a state or country as a point at its centre); `value`, `label`, `tag`, `marker`, `size`, `color`, `category` (12 legend entries at most), `time`, `props` (12 card columns at most), `valueLabel`, `title` |
| GeoJSON | a FeatureCollection | `value` (number property), `category` (text property), `height` (metres), `time` |
| Map file | `{"kml": "<text>"}`, `{"gpx": "<text>"}`, `{"kmz": "<base64>"}`, `{"shapefile": "<base64 of the zip>"}` | folders become layers; KMZ images are drawn |
| Prepared map | `points`, `regions`, `shapes`, `flows`, `layers` | |

- `[]` shows "No locations match this widget's current selection."
- Any other response that is not a map shows the error on the card.
- The `theme` query parameter can be ignored; the map follows the theme itself.

Limits: 20,000 points, 4,000 regions, 3,500 lines and areas, 2 MB of JSON, 4 MB per map file. A map over a limit names the limit.

## Features

- **Layers:** points, shaded regions, lines, areas, flows, heat, clusters, columns.
- **Controls:** layer panel, legend, data table, tags, drawing and measuring.
- **Export:** KML, KMZ and GeoJSON, with the user's tags, drawn shapes and region names.
- **Agent context:** counts, value range, categories, what is in view (`shows`) and the first 300 rows (place, label, value, tag). No shape geometry.
- **State:** tags, drawn shapes, layer visibility, opacity, boundaries and camera, kept in the widget `state` (64 KiB at most).
- **View settings:** `latitude`, `longitude`, `zoom`, `bearing`, `pitch`, bound as `config` traits. A change from the settings form or from the agent (`update_widget`) moves the map.
- **Chat:** an `artifact` for points by latitude and longitude, or US states or countries with a value. `view` sets where it opens. The card can be added to a dashboard as a widget.
- **Skill:** `maps` (`src/skills/maps.md`).
- **Boundaries:** US states, counties, countries, first-level regions, metro areas, congressional districts, ZIP codes and cities, carried in `assets/geo/` (10 MB) and loaded on demand. Sources: [`vendor/geo/README.md`](vendor/geo/README.md).
- **Labels:** Noto Sans glyphs from `assets/basemap/fonts/`, read through the `workspace-asset://` protocol.

## Basemap and map sources

| Admin setting | Basemap |
| --- | --- |
| default | OpenFreeMap vector tiles from `https://tiles.openfreemap.org`, allowed by `csp` in `src/plugin.json` and approved by a superuser |
| *Tile service* = none | `assets/basemap/world.pmtiles`, zoom 0 to 6, 43 MB |
| *PMTiles file* | a hosted PMTiles file; its host must be added to the frame policy |

With no readable tiles the map is drawn on the boundary files.

Map sources are extra layers: raster tiles, vector tiles, PMTiles, GeoJSON, images and elevation.
- Declared in `data.map.sources` or in the admin setting *Map sources* (a JSON list).
- `https` only; the host must be in the frame policy. No headers or credentials are sent.
- Vector layer colour: `{"value": "#rrggbb"}` or `{"property", "scale", "domain"}`. The admin setting also takes `"#rrggbb"`.

## Permissions

`core:data:read`, `core:export:provide`, `core:copilot:context`, `core:state:write`, `core:clipboard:write`, `core:download:save`, `core:ui:notify`.

The frame reaches only the tile service.

## Build

Node 20 or later.

```bash
npm install
```

```bash
npm run build
```

```bash
npm run typecheck
```

```bash
npm test
```

Output in `dist/map-widget/<version>/`:

| File | Content |
| --- | --- |
| `entry.js` | `src/entry.tsx` as one module, with the MapLibre worker embedded and started from a Blob URL as a classic worker |
| `entry.css` | MapLibre styles and `src/styles.css` |
| `assets/icon.svg` | icon |
| `assets/geo/` | boundary files from `vendor/geo/` |
| `assets/basemap/world.pmtiles` | world basemap, zoom 0 to 6 |
| `assets/basemap/fonts/` | glyphs |
| `assets/THIRD-PARTY-LICENSES.txt` | MapLibre, boundary files, GeoNames, Noto Sans |
| `skills/maps.md` | skill |
| `plugin.json` | `src/plugin.json` with the version and checksum |

The build prints the checksum and the version digest. The package is about 57 MB; `WIDGET_PLUGINS_MAX_UNPACKED_BYTES` (64 MB by default) must be at least that.

`scripts/fetch-basemap.mjs` fetches `world.pmtiles` from a pinned Protomaps daily build and checks its SHA-256.
- Pinned build gone: `node scripts/fetch-basemap.mjs --build <YYYYMMDD>` prints the new SHA-256 to pin, or set `BASEMAP_MIRROR` to a copy.
- Fetch failure skips the file unless `BASEMAP_REQUIRED=1`.

`scripts/geo/` rebuilds the boundary files.

## Deploy

1. Copy `dist/map-widget/<version>/` to `WIDGET_PLUGINS_DIR` as `map-widget/<version>/`.
2. From `backend-api/backend`: `python -m scripts.plugin_check <plugins directory>/map-widget/<version> --digest`.
3. To pin versions, add the digest to `WIDGET_PLUGINS_PINS` as `"map-widget@<version>": "<digest>"`.
4. Admin, Widgets, Deployment: Rescan, approve, enable. Admin, Roles: grant it to roles.

A changed package needs a new `version` in `package.json`; FINOS Workspace blocks an approved version whose files change.
