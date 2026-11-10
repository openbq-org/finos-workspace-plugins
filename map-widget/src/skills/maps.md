# Maps with the Map component

Use the Map component (`map-widget/map`) to show where things are: places at a latitude and longitude, or US states and countries shaded by a number. The user can add the card to a dashboard as a widget, so give it a clear title.

## Choose what to draw

| The question | Field | How |
|---|---|---|
| Where are these places | `points` | Each point has `lat` and `lon`, and a `label`. Give a `value` to colour the points by a number, and say what it is in `valueLabel`. |
| How does a number differ across US states or countries | `regions` | `set` is `us-states` or `countries`. Each item has a `code` (a state's postal code or name, a country's name or ISO code) and a `value`. |

## The data

```json
{
  "title": "Offices",
  "valueLabel": "Staff",
  "points": [
    { "lat": 40.7128, "lon": -74.006, "label": "New York", "value": 120 },
    { "lat": 51.5072, "lon": -0.1276, "label": "London", "value": 85 }
  ]
}
```

```json
{
  "title": "Population",
  "valueLabel": "Millions",
  "regions": { "set": "us-states", "items": [{ "code": "CA", "value": 39 }, { "code": "TX", "value": 30 }] }
}
```

## Zoom and place

Set `view` to open the map where the question is. `view.center` is `{ "lat", "lon" }` with `view.zoom` (0 to 19: 4 a country, 10 a city, 15 streets), or `view.bounds` is `[west, south, east, north]`, or `view.place` names a place. Without `view` the map fits its marks.

```json
{ "title": "Offices in Paris", "points": [{ "lat": 48.8566, "lon": 2.3522, "label": "Paris" }], "view": { "center": { "lat": 48.8566, "lon": 2.3522 }, "zoom": 12 } }
```

## Move a map that is on the dashboard

A map widget on the dashboard keeps its view in the settings `latitude`, `longitude`, `zoom`, `bearing` and `pitch`, and they follow the map as the user moves it. `read_widget` gives them as `ui_args.config`. To move the map, call `update_widget` with `ui_args_json` such as `{"config": {"latitude": 48.8566, "longitude": 2.3522, "zoom": 12}}`; zoom is 0 (the world) to 24, 4 a country, 10 a city, 15 streets. Set `latitude` and `longitude` together; `zoom` alone zooms where the map is.

To show the marks of a map on the dashboard as a table, call `update_widget` with `{"config": {"dataTable": true}}`; `false` shows the map again.

## Rules

- A map has at most 200 points, or 250 regions. When there are more rows, aggregate them first (by state, country or city) instead of sending every row.
- Use the latitude and longitude the data gives. Never guess a place's coordinates.
- Give the title and, with `value`, the `valueLabel`: the legend says what the colours mean.
- Do not set colours or basemaps. The map is drawn in the workspace's light or dark mode.
- Lines, areas, flows, GeoJSON files and counties need a backend that answers with them.
- Say what the map shows and what stands out; do not repeat the numbers it draws.
