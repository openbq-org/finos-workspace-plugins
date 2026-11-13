# AgGrid data backend

The data backend of the `ag-grid` plugin: an example of every widget type the plugin handles. It
is a Starlette app that a Workspace admin or user adds under **Connections**. It is not a plugin
backend (a package's `backend/` that Workspace runs through `WIDGET_PLUGIN_BACKENDS`): the plugin
package is built from `../src/` only, and Workspace's API calls this backend for the browser, as
it calls any connection.

## OpenBQ's table examples

The examples of OpenBQ Workspace's AgGrid table page, as widgets of type `aggrid-table` with their
configuration in `data["aggrid-table"]` ([ag_table_chart.py](ag_table_chart.py)), in the category
*AgGrid table chart examples*.

| Route | Answers |
|---|---|
| `GET /ag-table-chart/assets`, `projects`, `time-series`, `regions`, `sparklines`, `profit-loss`, `companies`, `trades-by-desk`, `directory`, `quarterly` | The rows of one example each. |
| `GET /ag-table-chart/company?symbol=MSFT` | One company, for *Company detail*, which *Companies* sets through its `symbol` param. |
| `GET /ag-table-chart/live` | Prices that move every five seconds, for *Live prices* (`refetchInterval: 5000`, `showCellChange`). |

| Widget | Shows |
|---|---|
| Table widget | Rows only: columns, types and formats inferred |
| Table with column definitions | Header names and tooltips, data types, formats, widths, pinning, a hidden column |
| Table with render functions | `columnColor` rules, `greenRed`, `titleCase` |
| Table with hover card | A Markdown card filled from the cell's object |
| Table to chart | `chartView`: a column chart of TVL by asset |
| Table to time series | A line chart over dates, with the navigator and its mini chart |
| Chart with default ranges | `cellRangeCols`: a stacked area of two regions |
| Table with sparklines | Line and bar sparklines with their minimum and maximum points |
| Sparklines with custom formatters | `customFormatter` colours each bar by its value |
| Companies (cell clicks) | `cellOnClick`: `groupBy` a symbol through a hidden `symbol` param, `sendToAgent`, `openUrl` |
| Company detail | `transpose`: the company *Companies* names, one row per field |
| Live prices | `showCellChange`, by row id (`wsRowIdColumn`), refetched every five seconds |
| Quarterly revenue chart | `chartView` with a stacked line, `xLabel` and `yLabel`, `dateLabels: "quarter"` (Q1 2023), and a series column of money texts (`$83.4B`) charted as numbers |
| Company directory | `formatterFn: "compact"`, `emptyValue`, link cells, a long text in its tooltip, and bar sparklines of object points (`xKey`, `yKey`) with labels and tooltips |
| Grouped trades with a starting layout | `rowGroup` and `aggFunc` per column, a field with a dot (`eps.ttm`), Unix times read as dates, and `columnState` and `filterModel`: sorted by notional, notionals over 100,000 |

## The widget type examples

One example of each widget type ([grids.py](grids.py)), in the category *AgGrid widget types*.

| Widget | Type | Route | Shows |
|---|---|---|---|
| Positions, recalculated by the backend | `aggrid-table` | `POST /ag-grid/positions` | `gridEvents: ["cellValueChanged"]`: an edited quantity or price goes to the backend in `gridState`, which answers with the book recalculated ([positions.py](positions.py)). A calculated column, *Notional at -20%*, and target prices written as `=` expressions. |
| Trades, server-side | `aggrid-ssrm` | `POST /ag-grid/trades/ssrm` | 20,000 generated trades, paged, sorted, filtered (column filters or the Advanced Filter), grouped, aggregated and pivoted by the backend ([trades.py](trades.py)). The WebSocket `/ag-grid/trades/updates` sends server-side transactions that move prices. |
| Trades, infinite (grid state) | `aggrid-infinite` | `POST /ag-grid/trades/infinite/state` | Each block is the `gridState` body param, answered with `rowData` and `rowCount`. |
| Trades, infinite (offset and limit) | `aggrid-infinite` | `GET /ag-grid/trades/infinite/rest` | Hidden `offset`, `limit`, `sort`, `order` and `filterModel` (the grid's filters as JSON) query params, answered with `items` and `total`. |
| Trades, infinite (skip and top) | `aggrid-infinite` | `GET /ag-grid/trades/infinite/list` | Hidden `skip` and `top` params, mapped with `requestParams`, answered with a plain list and no total: a short block ends the table. It takes no filter or sort, so the grid offers neither. |
| Live instruments | `aggrid-streaming` | `GET /ag-grid/instruments` | The first rows; the WebSocket `/ag-grid/instruments/stream` sends a snapshot, then price updates, new instruments and removals by row id ([instruments.py](instruments.py)). |
| Trades SQL | `aggrid-sql` | `POST /ag-grid/sql` | SQLite over the trades and desks ([sqldb.py](sqldb.py)), opened read-only, with an authorizer that allows one read, and a time limit. |

## Run it

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn server:app --host 127.0.0.1 --port 7800
```

Add `http://localhost:7800` under Connections (`MODE=local` accepts `http://localhost:<port>`)
and put the widgets of the two categories on a dashboard. On macOS, Workspace's API container
reaches it through `host.docker.internal`; on Linux, listen on `0.0.0.0`.

## Test

```bash
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q tests
```

The tests check every widget's configuration against the plugin's `definition` in
`../src/plugin.json`, so a change to the definition that breaks an example fails here. They also
check that the widgets that post their state declare it as a hidden body param, and they exercise
the edit event, the server-side requests with grouping, aggregation and pivot, the infinite
answers in their three shapes, the streams and the SQL guard.
