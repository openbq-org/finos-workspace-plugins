# The AgGrid widgets

The AgGrid plugin has five widgets. Show the table in the chat; the other four need a backend's widget, which the user adds to a dashboard.

| Widget | Type | Shows | When it fits |
|---|---|---|---|
| `ag-grid/table` | `aggrid-table` | Rows a backend returns, or rows you give | Any list of records the user will want to sort, filter, group, pivot, chart, copy or export. This is the one you show in the chat. |
| `ag-grid/ssrm` | `aggrid-ssrm` | A large table paged, sorted, filtered, grouped and pivoted by the backend | Tables too big to send at once. The backend answers each request of the grid. |
| `ag-grid/infinite` | `aggrid-infinite` | A long table that loads in blocks as the user scrolls | A backend that answers blocks of rows (startRow and endRow, offset and limit, or a grid state), without grouping. |
| `ag-grid/streaming` | `aggrid-streaming` | Rows kept current by a WebSocket that FINOS Workspace opens | A feed that changes while the user watches, such as prices. |
| `ag-grid/sql` | `aggrid-sql` | A SQL editor with completion, and the result | A question about a backend's database that the user will want to edit and rerun. |

## The table component

Use `ag-grid/table` to show rows in the conversation. The user can add the card to a dashboard as a widget that keeps its rows, so give it a clear name. For a handful of values, a table in your answer is enough.

```json
{
  "columnDefs": [
    { "field": "region", "headerName": "Region" },
    { "field": "sales", "headerName": "Sales", "type": "numericColumn" }
  ],
  "rowData": [
    { "region": "EMEA", "sales": 124500 },
    { "region": "APAC", "sales": 98700 }
  ]
}
```

- `rowData` is the rows: objects of strings, numbers, booleans or nulls. At most 1,000 rows, and a value at most 500 characters.
- `columnDefs` is optional. Leave it out and the columns are the keys of the rows, with numbers right-aligned and formatted. Give it when you want other headers (`headerName`), an order, a `width`, or `type: "numericColumn"` for a number that arrives as text.
- A `field` is the key of the row's value. Keys that are not in `columnDefs` are not shown.

## Rules

- Rows you loaded in the conversation: do not copy them into the call. Fill `rowData` from the loaded table with `sql` (SELECT only, up to 1,000 rows) or `from_table_id`, with `rows_key` set to `rowData`.
- Dates as ISO 8601 strings (`2026-01-31`).
- Name columns for the reader (`headerName`), not for the database.
- Sort the rows the way the question reads (the newest, the largest) before you send them; the user can re-sort, group and pivot.
- The grid follows the workspace's light or dark colours. Do not describe colours.
- Say what the rows show; do not repeat them in your answer.
