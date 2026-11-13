CATEGORY = "AgGrid widget types"
STATE_PARAM = {"paramName": "gridState", "type": "text", "label": "Grid state", "show": False, "in": "body", "value": ""}
SQL_PARAM = {
    "paramName": "sql",
    "type": "text",
    "label": "SQL",
    "show": False,
    "in": "body",
    "value": "SELECT desk, region, count(*) AS trades, round(sum(notional), 2) AS notional FROM trades GROUP BY desk, region ORDER BY notional DESC",
}

INSTRUMENT_COLUMNS = [
    {"field": "id", "headerName": "ID", "pinned": "left", "width": 80},
    {"field": "name", "headerName": "Name"},
    {"field": "price", "headerName": "Price", "decimalPlaces": 2, "prefix": "$", "renderFn": "showCellChange"},
    {"field": "change", "headerName": "Change", "decimalPlaces": 2, "renderFn": ["greenRed", "showCellChange"]},
    {"field": "ticks", "headerName": "Ticks", "formatterFn": "int"},
]


def widget(name: str, description: str, kind: str, endpoint: str, **extra) -> dict:
    return {
        "name": name,
        "description": description,
        "category": CATEGORY,
        "type": kind,
        "endpoint": endpoint,
        "gridData": {"w": 40, "h": 38},
        **extra,
    }


def hidden(name: str, kind: str = "number", value: object = 0, where: str = "query") -> dict:
    return {"paramName": name, "type": kind, "label": name, "show": False, "in": where, "value": value}


def infinite(name: str, description: str, endpoint: str, params: list, definition: dict | None = None, **extra) -> dict:
    return widget(name, description, "aggrid-infinite", endpoint, params=params, data={"aggrid-infinite": {"blockSize": 50, **(definition or {})}}, gridData={"w": 40, "h": 24}, **extra)


WIDGETS = {
    "aggrid_positions": widget(
        "Positions, recalculated by the backend",
        "aggrid-table with gridEvents: edit a quantity or a price, the backend gets the cellValueChanged event and answers with the book recalculated",
        "aggrid-table",
        "/ag-grid/positions",
        method="POST",
        params=[STATE_PARAM],
        data={"aggrid-table": {"gridEvents": ["cellValueChanged"]}},
        gridData={"w": 40, "h": 10},
    ),
    "aggrid_ssrm": widget(
        "Trades, server-side",
        "aggrid-ssrm: 20,000 trades paged, sorted, filtered, grouped, aggregated and pivoted by the backend; prices change through server-side transactions",
        "aggrid-ssrm",
        "/ag-grid/trades/ssrm",
        method="POST",
        params=[STATE_PARAM],
        data={"aggrid-ssrm": {"pageSize": 20, "wsRowIdColumn": "id"}, "streamEndpoint": "/ag-grid/trades/updates"},
        gridData={"w": 40, "h": 24},
    ),
    "aggrid_infinite_state": infinite(
        "Trades, infinite (grid state)",
        "aggrid-infinite over a POST endpoint: each block is the gridState body param, answered with rowData and rowCount",
        "/ag-grid/trades/infinite/state",
        [STATE_PARAM],
        method="POST",
    ),
    "aggrid_infinite_rest": infinite(
        "Trades, infinite (offset and limit)",
        "aggrid-infinite over GET ?offset&limit&sort&order&filterModel, answered with items and total",
        "/ag-grid/trades/infinite/rest",
        [hidden("offset"), hidden("limit", value=50), hidden("sort", "text", ""), hidden("order", "text", ""), hidden("filterModel", "text", "")],
    ),
    "aggrid_infinite_list": infinite(
        "Trades, infinite (skip and top)",
        "aggrid-infinite over GET ?skip&top, answered with a plain list and no total: a short block ends the table",
        "/ag-grid/trades/infinite/list",
        [hidden("skip"), hidden("top", value=50)],
        {"requestParams": {"offset": "skip", "limit": "top"}},
    ),
    "aggrid_streaming": widget(
        "Live instruments",
        "aggrid-streaming: a WebSocket sends a snapshot, then price updates, new instruments and removals by row id",
        "aggrid-streaming",
        "/ag-grid/instruments",
        data={"aggrid-streaming": {"showAll": False, "columnsDefs": INSTRUMENT_COLUMNS}, "streamEndpoint": "/ag-grid/instruments/stream"},
    ),
    "aggrid_sql": widget(
        "Trades SQL",
        "aggrid-sql: SQLite over the trades and desks, with completion from the backend's schema",
        "aggrid-sql",
        "/ag-grid/sql",
        method="POST",
        params=[SQL_PARAM],
        gridData={"w": 40, "h": 28},
    ),
    "aggrid_sql_pages": widget(
        "Trades SQL, paged on the server",
        "aggrid-sql with serverSide: every page, sort and filter of the result is a request with the query and the grid state",
        "aggrid-sql",
        "/ag-grid/sql-pages",
        method="POST",
        params=[SQL_PARAM, STATE_PARAM],
        data={"aggrid-sql": {"serverSide": True, "pageSize": 100}},
        gridData={"w": 40, "h": 28},
    ),
}
