# The AgGrid widgets

The AgGrid plugin has six widgets. Show the table in the chat; the others need a backend's widget, which the user adds to a dashboard (the file widget can also be added on its own and opened on a file).

| Widget | Type | Shows | When it fits |
|---|---|---|---|
| `ag-grid/table` | `aggrid-table` | Rows a backend returns, or rows you give | Any list of records the user will want to sort, filter, group, pivot, chart, copy or export. This is the one you show in the chat. |
| `ag-grid/ssrm` | `aggrid-ssrm` | A large table paged, sorted, filtered, grouped and pivoted by the backend | Tables too big to send at once. The backend answers each request of the grid. |
| `ag-grid/infinite` | `aggrid-infinite` | A long table that loads in blocks as the user scrolls | A backend that answers blocks of rows (startRow and endRow, offset and limit, or a grid state), without grouping. |
| `ag-grid/streaming` | `aggrid-streaming` | Rows kept current by a WebSocket that FINOS Workspace opens | A feed that changes while the user watches, such as prices or a trade tape. |
| `ag-grid/file` | `aggrid-file` | A CSV, TSV, JSON or Excel (.xlsx) file as a table | A file the backend sends, or one the user opens on the card. |
| `ag-grid/sql` | `aggrid-sql` | A SQL editor with completion, `{{name}}` parameters, and the result | A question about a backend's database that the user will want to edit and rerun. |

## The table component

Use `ag-grid/table` to show rows in the conversation. The user can add the card to a dashboard as a widget that keeps its rows, so give it a clear name. For a handful of values, a table in your answer is enough.

```json
{
  "columnDefs": [
    { "field": "quarter", "headerName": "Quarter", "chartDataType": "category" },
    { "field": "revenue", "headerName": "Revenue", "type": "numericColumn", "chartDataType": "series" }
  ],
  "rowData": [
    { "quarter": "2026-Q1", "revenue": 124500 },
    { "quarter": "2026-Q2", "revenue": 98700 }
  ],
  "chartView": { "enabled": true, "chartType": "groupedColumn" }
}
```

- `rowData` is the rows: objects of strings, numbers, booleans or nulls. At most 1,000 rows, and a value at most 500 characters.
- `columnDefs` is optional. Leave it out and the columns are the keys of the rows, with numbers right-aligned and formatted. Give it when you want other headers (`headerName`), an order, a `width`, or `type: "numericColumn"` for a number that arrives as text.
- A `field` is the key of the row's value. Keys that are not in `columnDefs` are not shown.
- **A chart**: add `chartView: { enabled: true, chartType }` and mark one column `chartDataType: "category"` (the axis) and the value columns `"series"`. Chart types include `groupedColumn`, `stackedColumn`, `groupedBar`, `line`, `stackedLine`, `area`, `stackedArea`, `pie`, `donut`, `scatter`, `bubble`, `histogram`, `waterfall`, `treemap`, `heatmap`, `funnel` and `columnLineCombo`. The card opens as the chart; the user can switch to the table.

## Writing widgets.json for these widgets

The `type` is the AgGrid type, and the widget's options go in `data["<type>"]`, such as `data["aggrid-table"]`.

- **Table and streaming** (`data["aggrid-table"]`, `data["aggrid-streaming"]`): `columnsDefs` with `field`, `headerName`, `formatterFn` (`int`, `none`, `percent`, `normalized`, `normalizedPercent`, `dateToYear`, `compact` for 45.00B), `decimalPlaces`, `prefix`, `suffix`, `renderFn` (`greenRed`, `columnColor` with `colorRules`, `titleCase`, `hoverCard`, `cellOnClick`, `showCellChange`), `sparkline`, `chartDataType`, `rowGroup`, `aggFunc`, `pivot`, `hide`, `pinned`, `width`. Table keys: `chartView` (`chartType`, `xLabel`, `yLabel`, `dateLabels`: `quarter` or `year`), `columnState` and `filterModel` (the layout a new card opens with), `transpose`, `showAll`, `emptyValue`, `enableFormulas`.
- **Click-through**: `renderFn: "cellOnClick"` with `renderFnParams: { actionType: "groupBy", groupBy: { paramName } }` writes the cell to a param of the widget, which must be declared in its `params`; give it `"show": false` to keep it off the card.
- Prefer a `sparkline` column or `chartView` over a separate chart widget when the numbers belong to the rows.
- **Server-side** (`aggrid-ssrm`): `POST`, with a hidden `gridState` body param; the backend answers `{ rowData, rowCount }` per request.
- **SQL** (`aggrid-sql`): `POST`, with a `sql` (or `query`) body param; `data["aggrid-sql"].serverSide: true` with a `gridState` body param pages the result on the server.
- **Streaming**: `data.streamEndpoint` is the WebSocket; `wsRowIdColumn` or `wsRowIdColumns` identify rows. Messages are `{ op: "snapshot" | "upsert" | "remove" }` or plain rows.
- **File** (`aggrid-file`): the endpoint answers `{ file: { name, base64 } }` for .xlsx, or `{ csv }` / `{ file: { name, text } }` for text.

## Rules

- Rows you loaded in the conversation: do not copy them into the call. Fill `rowData` from the loaded table with `sql` (SELECT only, up to 1,000 rows) or `from_table_id`, with `rows_key` set to `rowData`.
- Numbers as numbers, dates as ISO 8601 strings (`2026-01-31`).
- Name columns for the reader (`headerName`), not for the database.
- Sort the rows the way the question reads (the newest, the largest) before you send them; the user can re-sort, group and pivot.
- The grid follows the workspace's light or dark colours. Do not describe colours.
- Say what the rows show; do not repeat them in your answer.
- A user may paste cells from a grid ("Here are cells from a table on my dashboard"): answer about those cells.
