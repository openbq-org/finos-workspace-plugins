# AgGrid widgets for Workspace

A Workspace widget plugin with five widgets built on [AG Grid](https://www.ag-grid.com/)
Enterprise 34.3 and AG Charts Enterprise 12.3. Each widget handles its own widget type, and
each one gets its rows from its widget's endpoint in `widgets.json`.

| Widget | Type | Row model | What it is for |
|---|---|---|---|
| `table` | `aggrid-table` | Client-side | The rows a backend returns, with OpenBQ's table configuration: formats, render functions, hover cards, sparklines, cell clicks and the table-to-chart view. |
| `ssrm` | `aggrid-ssrm` | Server-side | A large table that the backend pages, sorts, filters, groups, aggregates and pivots. Each request of the grid is a POST to the endpoint. |
| `infinite` | `aggrid-infinite` | Infinite | A long table that loads in blocks as the user scrolls, from a backend that answers `startRow` and `endRow`, `offset` and `limit`, or the grid state. |
| `streaming` | `aggrid-streaming` | Client-side | A table kept current by a WebSocket that Workspace opens, which updates rows, inserts new ones and removes them. |
| `sql` | `aggrid-sql` | Client-side | A SQL editor with completion for the backend's database, with the result in a grid. |

Nothing in the plugin imports Workspace code. It talks to Workspace only through the widget plugin
contract: `plugin.json`, the AFM module in `entry.js`, traits and host commands. The same built
package serves FINOS Workspace and BQ Workspace.

## What every widget has

- **AG Grid Enterprise.** The side bar has the Columns panel and AG Grid 34's Filters tool panel,
  where the user adds a filter per column and reads each filter's summary
  (`enableFilterHandlers: true`, which the panel requires). Cells can be selected
  as ranges, and the status bar shows the row count and the aggregation of the selected cells.
  Integrated charts are on: a selected range is charted from the context menu.
- **Grouping, aggregation and pivot.** Every column can be a row group, a value or a pivot, from
  the Columns panel or the row group and pivot panels above the grid. The table and streaming
  widgets group in the browser. The server-side widget sends the grouping to the backend. The
  infinite widget has no grouping, because AG Grid's infinite row model does not group.
- **The backend's grid options.** An answer's `gridOptions` are passed to AG Grid as they are, and
  they replace the plugin's defaults. That includes `defaultColDef`, `sideBar`, `statusBar`,
  `rowSelection`, `pagination` and any other option of AG Grid 34.
- **Themes.** The grid's base theme is one of AG Grid's four, `balham` (small type and the
  default), `quartz`, `alpine` or `material`, or the plugin's `compact`: Alpine with 12px type,
  30px rows, no column lines and every other row shaded. Its colours come from the site's light or
  dark palette, so the grid follows the site when the user switches. The base theme is chosen in
  this order: the card's `theme` setting, the backend's `gridOptions.theme`, the organization's
  `theme` admin setting, then `balham`. Charts use AG Charts' light or dark theme to match.
- **The organization's look.** An organization admin can set, for every card: `accentColor`,
  `headerBackgroundColor`, `fontFamily`, `fontSize` (9 to 20), `rowHeight` (20 to 60),
  `stripedRows` and `columnBorders`. A value that is not a plain colour, font list or number in
  range is ignored. These replace the base theme's own values, and the site's colours for the
  accent and the font.
- **Saved state.** The grid's state (columns, order, widths, sort, filters, row groups, pivot, open
  groups and the side bar) is saved in the widget's `state` trait and restored when the dashboard
  opens again. On the table and streaming widgets, the table-to-chart view and its chart are saved
  too.
- **Copilot context.** The AI agent can read the columns, the row count, the filter and sort
  models and the grouping.
- **Card actions.** The card's header has a **Floating filters** button, which switches the
  card's `floatingFilters` setting and shows a filter box under each column header while it is on.
  The card's options menu has **Autosize columns**, which sizes every column to its content,
  **Clear filters and sort**, and **Reset columns**, which puts the columns back as the column
  definitions have them (order, widths, visibility, pinning and grouping) and keeps the filters.
  The table and streaming widgets add **Transpose rows and columns**, saved with the card, and
  **Reverse column order**. Workspace draws them from the widget's `actions` in `plugin.json`
  (`core:ui:button`, `core:ui:menu`) and sends the widget an `action` event when the user picks
  one. Until a card's button is used, the backend's `defaultColDef.floatingFilter` decides. The
  autosize item's icon is the package's `assets/autosize.svg`.
- **Advanced Filter.** The table, server-side and streaming widgets have an **Advanced filter**
  button, which switches the card's `advancedFilter` setting. While it is on, a bar above the grid
  takes one filter over all the columns, typed as an expression (`[Desk] = "FX" AND [Quantity] >
  40000`) or made in AG Grid's filter builder, and it replaces the column filters and the Filters
  tool panel, as AG Grid requires. The filter is saved with the card. The server-side widget sends
  it to the backend as `filterModel`, a tree of `{ filterType: "join", type: "AND" | "OR",
  conditions }` and `{ filterType, colId, type, filter }` conditions. The infinite widget has no
  Advanced Filter, because AG Grid's infinite row model does not support it.
- **Download chart.** The table widget's **Download chart as image** button saves the chart view,
  or else the chart opened last, as a PNG (`core:download:save`).
- **Active filters bar.** While a filter is on, a bar above the grid names each one, such as
  *TVL > 10* or *Name contains b*, with a button that removes it, and **Clear all** when there are
  several. With the Advanced Filter on, it shows one chip for it. The card's `filterBar` setting
  turns it off. When the filters hide every row, the grid says so instead of *No rows to show*.
- **Column menu and selection.** A column's menu adds **Hide column** and, for a column wider than
  200px, **Narrow column**. Right-clicking a header opens the menu of AG Grid. Double-clicking a
  header selects the column's cells (with Shift, every column from the one picked before), and
  double-clicking a cell selects its row, so the status bar sums them and they can be copied or
  charted.
- **Card settings.** Besides the theme and the filters: `statusBar` (on unless turned off) on
  every grid, `filterBar` on every grid, and on the table and streaming widgets `decimals` (0 to
  8, for numbers without their own `decimalPlaces`; empty follows the site), `abbreviateNumbers`
  (a million or more as M, B or T, with the full number in the tooltip), `pagination` (`auto`, the
  default, pages above 100 rows unless the backend's `gridOptions` say otherwise; `on` and `off`
  decide for the card) and `pageSize` (`auto` fits the rows to the card, or 50 to 1000).
- **Exports.** The table and streaming widgets export the rows as CSV and as an Excel workbook,
  with raw values. The server-side and infinite widgets export the rows loaded so far as CSV.

## Two-way communication with the backend

A widget never calls a backend itself. It writes the widget's params with `core:params:write`, and
Workspace sends the request to the endpoint, as it does when a user changes a param. The grid's
side of the conversation goes in a hidden body param that the backend declares in
`widgets.json`:

```json
{
  "paramName": "gridState",
  "type": "text",
  "label": "Grid state",
  "show": false,
  "in": "body",
  "value": ""
}
```

A body param needs `"method": "POST"` on the widget. The param's value is a JSON text of at most
4,096 characters, which is Workspace's limit for a text param:

```json
{
  "seq": 1762250000001,
  "event": { "type": "cellValueChanged", "rowId": "P3", "colId": "quantity", "oldValue": 100, "newValue": 150 },
  "filterModel": {},
  "sortModel": [{ "colId": "symbol", "sort": "asc" }],
  "rowGroupCols": [],
  "pivotCols": [],
  "valueCols": [],
  "pivotMode": false,
  "selectedRowIds": []
}
```

`seq` grows with every request. A backend that echoes `seq` in its answer lets the widget match
the answer to its request and ignore an older one. When the selection would make the text too
long, `selectedRowIds` is sent empty, with `selectedRowCount` instead.

## The table widget (`aggrid-table`)

The endpoint returns the rows in any of these shapes:

- An object with `columnDefs`, `rowData` and optionally `gridOptions`, passed to AG Grid as they are.
- A list of records, which is pandas `to_dict("records")`.
- A dict of columns, which is pandas `to_dict("list")`.
- The pandas split format: `{ "columns": [...], "index": [...], "data": [[...], ...] }`.
- `{ "transaction": { "add": [...], "update": [...], "remove": [...] } }`, which changes the rows
  the grid already has instead of replacing them.

Without `columnDefs`, the columns are the keys of the rows. Numbers are right-aligned and
formatted, ISO dates filter as dates, and booleans show as Yes or No. Pagination switches on above
100 rows. Rows keep their identity across refreshes by `wsRowIdColumn` (default `id`), so a refresh
applies only the rows that changed.

### Grid events

`gridEvents` in the widget's `data["aggrid-table"]` lists the grid events that send the grid state
to the endpoint: `cellClicked`, `cellDoubleClicked`, `cellValueChanged`, `selectionChanged`,
`filterChanged`, `sortChanged`, `columnRowGroupChanged`, `columnPivotChanged`,
`columnValueChanged`, `columnPivotModeChanged` and `rowGroupOpened`. It is empty by default, so a
widget sends nothing until its backend asks for an event. The backend's answer replaces the rows,
or changes some of them with a `transaction`.

```json
{
  "positions": {
    "name": "Positions",
    "type": "aggrid-table",
    "endpoint": "/positions",
    "method": "POST",
    "params": [{ "paramName": "gridState", "type": "text", "label": "Grid state", "show": false, "in": "body", "value": "" }],
    "data": { "aggrid-table": { "gridEvents": ["cellValueChanged"] } }
  }
}
```

### Expressions

A column with `calculatedExpression` gets its value from the other columns of its row, such as
`[revenue] - [cost]`. With `enableCellExpressions` (in the definition or the answer's
`gridOptions`), a cell value that starts with `=` is an expression too, such as
`=[quantity] * [price]`. Expressions take literals, `[column]`, `+ - * / %`, comparisons,
`&& || ??`, `?:` and `Math.abs`, `min`, `max`, `round`, `floor`, `ceil` and `sign`. A calculated
column can name another one. The plugin evaluates expressions itself and never runs them as code.
An expression that fails, divides by zero or refers to itself shows `#ERROR`.

### OpenBQ's table configuration

An OpenBQ backend's table widget moves over with two changes: `"type": "table"` becomes
`"type": "aggrid-table"`, and `data.table` becomes `data["aggrid-table"]`. The endpoint returns the
same rows. The plugin declares the object's schema (`definition` in `plugin.json`), so a backend
whose keys or values do not fit sees the problem, with its JSON pointer, when it connects.

```json
{
  "assets": {
    "name": "Assets",
    "description": "TVL by asset",
    "type": "aggrid-table",
    "endpoint": "/assets",
    "data": {
      "aggrid-table": {
        "enableCharts": true,
        "chartView": { "enabled": false, "chartType": "column" },
        "columnsDefs": [
          { "field": "name", "headerName": "Asset", "renderFn": "titleCase", "pinned": "left", "chartDataType": "category" },
          { "field": "tvl", "headerName": "TVL (USD)", "formatterFn": "int", "chartDataType": "series" },
          { "field": "change_1d", "headerName": "24h Change", "formatterFn": "percent", "renderFn": "greenRed" }
        ]
      }
    }
  }
}
```

| Key (as in OpenBQ) | What the plugin does |
|---|---|
| `columnsDefs[]`: `field`, `headerName`, `headerTooltip`, `width`, `minWidth`, `maxWidth`, `hide`, `pinned`, `align` | The AG Grid column options of the same names. A column with `width` keeps it instead of sharing the card's width. |
| `field` | Taken as the key it is: `eps.ttm` reads the row's `"eps.ttm"`, not a nested `eps.ttm`. A backend whose raw `columnDefs` read nested objects sets `gridOptions.suppressFieldDotNotation: false`. |
| `cellDataType` (`text`, `number`, `boolean`, `date`, `dateString`, `object`) | The column's filter, alignment and formatting, and the operators of the Advanced Filter. Without it, the type is inferred from the rows; a column whose name says it is a date or a time (`date`, `trade_date`, `createdAt`, `timestamp`) and holds Unix times, in seconds or milliseconds, is a date column. Date strings sort, filter and chart as dates and show as they came, except that a time of midnight shows as its date. |
| `rowGroup`, `rowGroupIndex`, `pivot`, `aggFunc` (`sum`, `min`, `max`, `count`, `avg`, `first`, `last`) | The rows are grouped, pivoted and aggregated by these columns when a card opens. The user can change it in the Columns panel. |
| `formatterFn` (`int`, `none`, `percent`, `normalized`, `normalizedPercent`, `dateToYear`, `compact`), on a column or the whole table; `decimalPlaces`; `prefix`, `suffix` | Formatted cell text. `compact` shows a million or more as M, B or T (`45.00B`), with the full number in the tooltip. Sorting, filtering, charts and the exports keep the raw values. Numbers follow the site's locale and decimals, or the card's `decimals`. A text longer than 200 characters is cut with `…` and shows in full in its tooltip; so does any text cut by its column's width. A text column whose values are mostly `http(s)://` links shows them as links, which open after the user confirms (`core:ui:open-link`; only `https:` and `mailto:`). |
| `renderFn` (one or a list) and `renderFnParams` | `greenRed`, `titleCase`, `columnColor` (`colorRules` with every condition, `fill`, `colorValueKey`; when several rules match, the last one wins, and `contains` and `notContains` ignore case), `hoverCard` (`cellField`, `title`, `markdown` with `{field}` placeholders, or `hoverCardData`), `cellOnClick` and `showCellChange`, both described below. A cell with a hover card shows a help pointer and a dotted underline. |
| `sparkline` (`line`, `area`, `bar`; `dataField`; `options`) | AG Charts sparklines: stroke, fill, opacity, markers (with `shape`), padding, bar `direction`, `min` and `max`, every point of interest, `customFormatter`, `tooltip` and `crosshair` (`enabled`), `axis` (`visible`, `stroke`, `strokeWidth`) and, on bars, `label` (`enabled`, `placement`, `color`, `fontSize`, `fontWeight`). Points are numbers, or objects read with `xKey` and `yKey`. |
| `chartDataType` (`category`, `series`, `time`, `excluded`) | The column's role in charts. |
| `calculatedExpression` | The column's value as an expression over its row, as under [Expressions](#expressions). |
| `showAll` | Default `true`: fields the rows have and `columnsDefs` does not are shown after the declared ones. `false` shows only `columnsDefs`. |
| `transpose` | One row per column and one column per row, headed by the first column's values. Each cell keeps its column's format and colours. |
| `enableCharts`, `chartView` (`enabled`, `chartType`, `cellRangeCols`, `ignoreCellRange`, `chartNavigatorEnabled`, `chartMiniChartEnabled`) | A *Table / Chart* toolbar and an integrated chart linked to the rows, with every chart type of OpenBQ's list. The chart a user arranges is saved with the dashboard and restored, unless `ignoreCellRange`. `enableCharts: false` turns charting off. |
| `enableAdvanced` | `true` opens the Columns panel; `false` hides the side bar. |
| `emptyValue` | The text of an empty cell, such as `-`. Empty by default. |
| `columnState`, `filterModel` | The layout and the filters a new card opens with. `columnState` holds parts of an AG Grid grid state (`sort`, `rowGroup`, `pivot`, `aggregation`, `columnOrder`, `columnVisibility`, `columnPinning`, `columnSizing`, `columnGroup`, `filter`, `sideBar`), directly or under `default`; `filterModel` is an AG Grid filter model keyed by column. Only the parts named change: a column's own `rowGroup` stays unless `columnState` sets the row groups. Once a user changes the card, its own saved layout is used instead. |
| `wsRowIdColumn` | The field that identifies a row across refreshes (default `id`), so changed rows are applied as transactions and `showCellChange` knows which cell moved. |
| `gridEvents`, `enableCellExpressions` | As above. |
| `enableFormulas` | The Formulas panel, below. On unless `false`. |

**Cell clicks** (`renderFn: "cellOnClick"`):

- `actionType: "groupBy"` writes `groupBy.paramName` (the cell's value, or the row's `valueField`)
  to the widget's params. Workspace then updates every widget grouped with that param. The param
  must be one the widget declares in `widgets.json`; a param with `"show": false` does this without
  showing a control on the card. The widget always refetches, as with `forceUpdate: true`.
- `actionType: "openUrl"` opens the cell's value, or `renderFnParams.url` with `{field}`
  placeholders, after the user confirms. Only `https:` and `mailto:` links open.
- `actionType: "sendToAgent"` fills `sendToAgent.markdown` from the row, copies it to the clipboard
  and keeps it in the widget's Copilot context. FINOS Workspace has no host command that sends a
  message to the AI agent, so the user pastes it.

**`showCellChange`**: when a refresh, a `refetchInterval` or a stream brings new values, a changed
cell flashes green when it rose and red when it fell (by `colorValueKey`'s field when set), and a
number shows for a moment how far it moved, such as *▲ 0.25*. `enableCellChangeWs: false` turns
it off for a column.

**The current row**: a `cellOnClick` column with `actionType: "groupBy"` marks the row whose
value is the widget's current value of that param, with an accent bar, so the row the dashboard
follows stays visible.

**`customFormatter`** is a JavaScript function in a string. The frame forbids `eval`, and a
backend's string should not run as code, so the plugin evaluates the subset formatters use, over
the formatter's params only: `(params) => ({ ... })`, `params => { return {...} }` or
`function (params) { return {...} }`, with literals, `params.x` and `params["x"]`,
`! - + * / %`, comparisons, `&& || ??`, `?:` and `Math.abs/min/max/round/floor/ceil/sign`.
Anything else is ignored with a console warning.

**Formulas** (`enableFormulas`, on unless `false`): the side bar's **Formulas** panel adds columns
that a user computes from the others, such as `[Revenue] - [Cost]` or
`ROUND(AVG([Q1], [Q2], [Q3], [Q4]), 2)`. A formula names a column by its header or its field, in
brackets, in any case, and may name another formula. It takes `+ - * / %`, comparisons and the
functions `SUM`, `AVG`, `MIN`, `MAX` and `COUNT` (of their numeric arguments), `ABS`,
`ROUND(x, places)` and `IF(test, then, else)`. The panel checks a formula as it is typed and names
an unknown column. The columns sort, filter, group, aggregate, pivot, chart and export like the
others, and they are saved with the card (in its `state`, at most 20) and shown to the AI agent. A
formula whose column is gone shows `#ERROR`. The plugin evaluates formulas with its own expression
engine, never as code. A backend whose `gridOptions.sideBar` replaces the side bar has no Formulas
panel.

**Not supported:** the clickable links inside a hover card, which show as text.

## The server-side widget (`aggrid-ssrm`)

The widget uses AG Grid's server-side row model. Its endpoint is `POST`, and the widget declares
the `gridState` body param. The first answer, to an empty `gridState`, gives the columns:

```json
{ "columnDefs": [{ "field": "desk" }, { "field": "notional", "aggFunc": "sum" }], "gridOptions": {} }
```

After that, every block the grid needs is a request in `gridState`: AG Grid's
`IServerSideGetRowsRequest`, which is `startRow`, `endRow`, `rowGroupCols`, `valueCols`,
`pivotCols`, `pivotMode`, `groupKeys`, `filterModel` and `sortModel`, with `seq` and
`event: { "type": "getRows" }`. The backend answers with the block:

```json
{ "seq": 1762250000002, "rowData": [{ "desk": "FX", "notional": 1250000 }], "rowCount": 4, "pivotResultFields": [] }
```

`rowCount` is the number of rows at that level, when the backend knows it. `pivotResultFields` are
the pivot columns, joined with `|`. An answer `{ "error": "..." }` shows the message on the card.
The widget sends one request at a time and gives up on one after 35 seconds.

`definition.pageSize` (default 100) is the page and block size. With `wsRowIdColumn` and a
`data.streamEndpoint`, a WebSocket can change the rows the grid already has, with messages
`{ "op": "transaction", "route": [...], "add": [...], "update": [...], "remove": [...] }` and
`{ "op": "refresh", "route": [...], "purge": true }`.

## The infinite widget (`aggrid-infinite`)

The widget uses AG Grid's infinite row model. The table has no pages: the grid asks for the next
block of rows as the user scrolls, and asks again from the top when the sort or a filter changes.
It works with the way the backend already pages its rows. The widget declares the params its
endpoint takes, as hidden params, and the widget fills the ones it finds:

| Param | Value |
|---|---|
| `gridState` | The block request as JSON: `startRow`, `endRow`, `sortModel` and `filterModel`, with `seq`. |
| `startRow`, `endRow` | The first row and the row after the last. |
| `offset`, `limit` | The first row and the number of rows. |
| `sort`, `order` | The first sorted column and `asc` or `desc`. |
| `sortModel`, `filterModel` | AG Grid's sort and filter models as JSON. |

`definition.requestParams` maps one of these to the endpoint's own name, for example
`{ "offset": "skip", "limit": "top" }`. `blockSize` (default 100) is the number of rows each
request asks for, and `maxBlocksInCache` (default 20) is the number of blocks the grid keeps.

The grid offers only what reaches the endpoint. Without `gridState` or `filterModel` among the
declared params, the columns have no filters and the side bar has no Filters panel. Without
`gridState`, `sortModel` or `sort`, the columns do not sort. A filter or a sort the endpoint is
never told would leave the rows unchanged.

The answer is a list of records, or an object with its rows under `rowData`, `rows`, `items`,
`results`, `records`, `value` or `data`, or in a pandas format. The total number of rows is read
from `rowCount`, `lastRow`, `total`, `totalCount`, `total_count`, `count`, `totalRecords` or
`@odata.count`. Without a total, the table ends at a block shorter than the request, or when the
answer says `hasMore: false`, `has_more: false` or `next: null`. For any other shape,
`definition.rowsKey` and `definition.totalKey` are dot paths to the rows and the total.

The first block is the answer Workspace already has for the widget's params, so the first screen
needs no second request. The columns come from that answer's `columnDefs`, from
`definition.columnsDefs`, or from the keys of its rows.

## The streaming widget (`aggrid-streaming`)

The widget is the table widget with a live feed. Its endpoint returns the first rows, as for
`aggrid-table`, and every row has an id (`wsRowIdColumn`, default `id`). `data.streamEndpoint` in
`widgets.json` is a WebSocket on the backend, which Workspace opens and relays to the widget. Its
messages are JSON:

- `{ "op": "snapshot", "rows": [...] }` replaces every row.
- `{ "op": "upsert", "rows": [...] }` merges each row into the row with its id, or adds it as a new
  row.
- `{ "op": "remove", "ids": [...] }` removes rows by id.

Changes are applied every 150 ms. Changed cells flash with `showCellChange`. The strip above the
grid shows whether the feed is live, retrying or closed. The widget takes the same configuration
as the table widget.

## The SQL widget (`aggrid-sql`)

The widget shows a SQL editor above a grid. The query is the widget's `sql` body param, so the
endpoint is `POST`. The backend answers:

```json
{
  "schema": { "engine": "SQLite", "tables": [{ "name": "trades", "columns": [{ "name": "desk", "type": "TEXT" }] }] },
  "columns": ["desk", "trades"],
  "rows": [["FX", 5012]],
  "truncated": false,
  "elapsedMs": 4
}
```

or `{ "schema": ..., "error": "..." }`. An empty query is answered with the schema alone. The editor completes keywords, functions, tables and
columns from `schema`, with DuckDB-WASM's completion running inside the frame on the package's own
WebAssembly. The tables and their columns are listed beside the editor. Running a query sends it
to the backend, which decides what may run: the example backend opens SQLite read-only, with an
authorizer and a time limit.

The card's **Create static widget** button copies the current result into an AgGrid table widget
of its own, with no parameters and no query: the first 60 columns and the first 1,000 rows, as the
table's artifact holds them, with each text cut to 500 characters, and fewer rows when they would
pass 380,000 bytes, which keeps the copy under Workspace's limit. The button is the widget's
`freeze` action (`core:ui:button`), and the copy is made with the command
`core:dashboard:add-widget`, which Workspace takes only right after the click. A static copy is an
AgGrid table, so it has the table's buttons and menu items.

## The table component in the chat

The `table` widget is also an agent component: the AI agent shows rows in the chat with
`columnDefs` and `rowData` (at most 1,000 rows), and the user can add the card to a dashboard.
The plugin's skill, `skills/ag-grid-widgets.md`, tells the agent when each widget fits.

## Model traits

| Trait | Writable | Purpose |
|---|---|---|
| `data` | No | The endpoint's answer, at the widget's `dataKey`. |
| `definition` | No | The widget's `data["<type>"]` object, checked against the definition in `plugin.json`. |
| `params` | Yes | The widget's params. The widgets write `gridState`, the block params, the `sql` param and `groupBy` params. |
| `config` | No | The card's settings: `licenseKey`, `theme` and, on the grid widgets, `floatingFilters`. |
| `theme` | No | The site's mode and colour tokens. |
| `adminSettings` | No | The organization's settings: `licenseKey` and `theme`. |
| `state` | Yes | The saved grid state, the selection, the last event, the chart view and the editor's query. |
| `meta` | No | The widget id, which selects the widget's module. |

## Licence key

The package bundles AG Grid Enterprise and AG Charts Enterprise. Without a key they run in trial
mode, with a watermark. The plugin reads the key from the card's `licenseKey` setting, or else
from the organization's `licenseKey` under Admin, Widgets, AgGrid, Settings. A key works only for
AG Grid releases its licence covers.

## Build

```bash
npm ci          # exact versions from package-lock.json
npm run build   # writes dist/ag-grid/<version>/
npm run verify  # checks the package as Workspace's discovery does, prints its digest
```

The build bundles the plugin and its dependencies into the one module `entry.js`, because a
plugin frame loads a single module. It copies `entry.css`, the icons, the skill, DuckDB-WASM's
WebAssembly and worker, and DuckDB's `autocomplete` and `json` extensions. The extensions are
downloaded from `extensions.duckdb.org` once, checked against their pinned SHA-256 and kept in
`.cache/`. The build writes every bundled package's licence under `licenses/`, takes DuckDB's
licence texts from `third-party/`, computes the checksum, and writes `plugin.json` with `version`
and `checksum`.

The package Workspace consumes is the folder `dist/ag-grid/<version>/`:

```
dist/ag-grid/3.1.0/
  plugin.json                                manifest; version and checksum written by the build
  entry.js                                   the AFM module (entry.module)
  entry.css                                  the styles (entry.styles)
  assets/icon.svg                            the icon
  assets/autosize.svg                        the icon of Autosize columns
  assets/duckdb-eh.wasm                      DuckDB-WASM, for the SQL editor's completion
  assets/duckdb-browser-eh.worker.js         its worker
  assets/autocomplete.duckdb_extension.wasm  DuckDB's completion extension
  assets/json.duckdb_extension.wasm          DuckDB's JSON extension
  skills/ag-grid-widgets.md                  the agent's skill
  licenses/<package>/                        the licence of every bundled package
```

The manifest's CSP adds `'wasm-unsafe-eval'` to `script-src`, to compile DuckDB's WebAssembly, and
`blob:` to `connect-src`, where DuckDB reads that file from. The frame reaches no host.

## Checksum and digest

```
src/ + package-lock.json
  ↓ npm ci && npm run build
dist/ag-grid/<version>/            the package: every file's SHA-256
  ↓ checksum = all files but plugin.json, written into plugin.json
  ↓ version digest = all files, plugin.json included
Workspace: rescan → approve that digest → serve /<id>/<digest>/files/… → the browser re-hashes each file
```

Both values are `sha256-` and the unpadded base64url SHA-256 of the sorted lines
`<path>\0<sha256 hex>\n`, the formula of Workspace's
`backend-api/backend/api/widget_plugins/discovery.py` (`listing_digest`). Only paths and bytes
count, so the same folder has the same digest on every deployment. It changes if anything
changes a byte: a rebuild with other dependency or esbuild versions (both are pinned), a
line-ending conversion, or a stray file such as `.DS_Store` (`npm run verify` refuses one). Ship
the built folder; don't rebuild it per deployment.

`npm run verify` prints the version digest a deployer pins in `WIDGET_PLUGINS_PINS`. Workspace's
own validator stays the authority, from a Workspace checkout's `backend-api/backend`:

```bash
python -m scripts.plugin_check <path>/dist/ag-grid/<version>          # full check
python -m scripts.plugin_check --digest <path>/dist/ag-grid/<version> # checksum and digest
```

Every change is a new version: raise `version` in `package.json` and build again. Workspace
blocks a version whose files change after it was discovered, and keeps it blocked.

## Test

```bash
npm test
```

The tests run in Node, with real grids rendered in jsdom. They cover the shared grid code
(themes, options, expressions, saved state and the grid state channel) in `grid.test.mjs`; each
widget in `table.test.mjs`, `ssrm.test.mjs`, `infinite.test.mjs`, `streaming.test.mjs` and
`sql.test.mjs`; the SQL completion in `completion.test.mjs`; OpenBQ's table configuration in
`ag-table-chart.test.mjs`; and the manifest in `manifest.test.mjs`. Drawing charts needs a browser;
check them on a dashboard.

## The data backend

The plugin has no plugin backend and no backend URL. The rows come from a data backend that runs
on its own server, outside Workspace, which a Workspace admin or user adds under **Connections**:

- The backend serves `GET /widgets.json`, declaring widgets of the five types with their
  `endpoint`, `method`, `params`, `dataKey` and configuration in `data["<type>"]`. Its endpoints
  are on the same origin as the Connection's URL.
- Workspace's API calls it for the browser (`/api-source/<id>/request`), with the keys stored on
  the Connection and an `X-Workspace-Identity` token, and opens its WebSockets. The frame never
  calls it, so the plugin needs no proxy and no secret, and the backend needs no CORS for the
  frame.
- Each Workspace sets the URL on its own Connection, so one package serves every deployment.

[`backend/`](backend/README.md) is such a data backend, with an example of every widget type on
port 7800. It is not part of the package, which the build makes from `src/` only.

## Deploy

1. Copy `dist/ag-grid/<version>/` into the plugins directory (`WIDGET_PLUGINS_DIR`), as
   `ag-grid/<version>/`.
2. Where versions must be pinned, add the digest to `WIDGET_PLUGINS_PINS` as
   `"ag-grid@<version>": "<digest>"`.
3. Admin, Widgets, Deployment: Rescan, review, approve, and enable the plugin. Grant it to the
   roles that may use it. Enter the AG Grid licence key and choose the theme under the plugin's
   settings.
4. Add the data backend under Connections, and put its widgets on a dashboard.

## Try it on a local Workspace

A local Workspace stack (`local/` in the Workspace repository, `make up`) mounts the folder named by
`WORKSPACE_PLUGINS_DIR` (set in `workspace/local/.env`, default `widget-plugins/` at the Workspace
repository's root) as its plugins directory. Fetching the plugin into it needs no change to
Workspace:

```bash
npm ci && npm run build
WORKSPACE_PLUGINS_DIR=<plugins directory> npm run install:workspace
```

`install:workspace` runs `verify`, then copies `dist/ag-grid/<version>/` to
`<plugins directory>/ag-grid/<version>/`, next to the versions already there. It does nothing when
that version is already there with the same files, and refuses when its files differ: raise the
version instead.

Then rescan and approve, in Admin, Widgets, Deployment, or from the backend container:

```bash
docker exec workspace-local-backend-1 python -m scripts.workspace_admin plugin rescan
docker exec workspace-local-backend-1 python -m scripts.workspace_admin plugin show ag-grid
docker exec workspace-local-backend-1 python -m scripts.workspace_admin plugin approve ag-grid <version> --digest <version digest> --acknowledge
```

The approved version replaces the active one for every organization that enabled the plugin.
A first install also needs `plugin enable` and `plugin grant` (or the Admin pages). Add the data
backend under Connections (`MODE=local` accepts `http://localhost:<port>`) and put its widgets on a
dashboard.
