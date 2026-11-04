# AgGrid data backend

The data backend of the `ag-grid` plugin: the examples of OpenBB Workspace's AgGrid table page as
widgets of type `ag-grid`. It is a Starlette app that a Workspace admin or user adds under
**Connections**. It is not a plugin backend (a package's `backend/` that Workspace runs through
`WIDGET_PLUGIN_BACKENDS`): the plugin package is built from `../src/` only, and Workspace's API
calls this backend for the browser, as it calls any connection.

It came from FINOS Workspace's `docs/examples/ag-grid/examples/`, unchanged, so dashboards that
use those widgets keep working when the connection points here.

| Route | Answers |
|---|---|
| `GET /widgets.json` | The 12 widgets, each with its table configuration in `data["ag-grid"]` ([ag_table_chart.py](ag_table_chart.py)). |
| `GET /ag-table-chart/assets`, `projects`, `time-series`, `regions`, `sparklines`, `profit-loss`, `companies` | The rows of one example each. |
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
| Companies (cell clicks) | `cellOnClick`: `groupBy` a symbol, `sendToAgent`, `openUrl` |
| Company detail | `transpose`: the company *Companies* names, one row per field |
| Live prices | `showCellChange`, by row id (`wsRowIdColumn`), refetched every five seconds |

## Run it

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn server:app --host 127.0.0.1 --port 7800
```

Add `http://localhost:7800` under Connections (`MODE=local` accepts `http://localhost:<port>`)
and put the widgets of the category *AgGrid table chart examples* on a dashboard. On macOS,
Workspace's API container reaches it through `host.docker.internal`; on Linux, listen on
`0.0.0.0`.

## Test

```bash
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q tests
```

The tests check every widget's `data["ag-grid"]` against the plugin's `definition` in
`../src/plugin.json`, so a change to the definition that breaks an example fails here.
