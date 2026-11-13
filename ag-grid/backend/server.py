"""The data backend of the `ag-grid` plugin: its example widgets of every widget type.

    .venv/bin/uvicorn server:app --host 127.0.0.1 --port 7800

Then add http://localhost:7800 under Connections in FINOS Workspace (README.md).
"""

import json
import time

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route, WebSocketRoute

import ag_table_chart
import grids
import files
import instruments
import positions
import sqldb
import trades

ORIGINS = ["http://localhost:3000", "http://localhost:1420"]
LIVE_SECONDS = 5

TABLES = {
    "assets": ag_table_chart.assets,
    "projects": ag_table_chart.projects,
    "time-series": ag_table_chart.time_series,
    "regions": ag_table_chart.regions,
    "sparklines": ag_table_chart.sparklines,
    "profit-loss": ag_table_chart.profit_loss,
    "companies": ag_table_chart.companies,
    "trades-by-desk": ag_table_chart.trades_by_desk,
    "directory": ag_table_chart.directory,
    "quarterly": ag_table_chart.quarterly,
}


def table(build):
    async def handler(_request: Request) -> JSONResponse:
        return JSONResponse(build())

    return handler


async def body_of(request: Request) -> dict:
    raw = await request.body()
    if not raw:
        return {}
    try:
        body = json.loads(raw)
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


async def widgets(_request: Request) -> JSONResponse:
    return JSONResponse({**ag_table_chart.WIDGETS, **grids.WIDGETS})


async def company(request: Request) -> JSONResponse:
    return JSONResponse(ag_table_chart.company(request.query_params.get("symbol", "")))


async def live(_request: Request) -> JSONResponse:
    return JSONResponse(ag_table_chart.live(int(time.time() // LIVE_SECONDS)))


async def positions_book(request: Request) -> JSONResponse:
    try:
        state = trades.state_of(await body_of(request))
    except trades.RequestError as error:
        return JSONResponse({"error": str(error)})
    positions.BOOK.apply(state.get("event"))
    return JSONResponse(positions.BOOK.answer())


async def trades_ssrm(request: Request) -> JSONResponse:
    state: dict = {}
    try:
        state = trades.state_of(await body_of(request))
        return JSONResponse(trades.ssrm(state))
    except trades.RequestError as error:
        return JSONResponse({"error": str(error), **({"seq": state["seq"]} if "seq" in state else {})})


def number(request: Request, name: str, default: int) -> int:
    try:
        return int(request.query_params.get(name, default))
    except ValueError as error:
        raise trades.RequestError(f"{name} is not a whole number.") from error


async def infinite_state(request: Request) -> JSONResponse:
    state: dict = {}
    try:
        state = trades.state_of(await body_of(request))
        rows, total = trades.block(state.get("startRow", 0), state.get("endRow", 50), state.get("sortModel"), state.get("filterModel"))
        return JSONResponse({"rowData": rows, "rowCount": total, **({"seq": state["seq"]} if "seq" in state else {})})
    except trades.RequestError as error:
        return JSONResponse({"error": str(error), **({"seq": state["seq"]} if "seq" in state else {})})


def filter_model_of(request: Request) -> dict:
    text = request.query_params.get("filterModel")
    if not text:
        return {}
    try:
        model = json.loads(text)
    except ValueError as error:
        raise trades.RequestError("filterModel is not JSON.") from error
    if not isinstance(model, dict):
        raise trades.RequestError("filterModel is not an object.")
    return model


async def infinite_rest(request: Request) -> JSONResponse:
    try:
        offset, limit = number(request, "offset", 0), number(request, "limit", 50)
        sort = request.query_params.get("sort")
        order = "desc" if request.query_params.get("order") == "desc" else "asc"
        rows, total = trades.block(offset, offset + limit, [{"colId": sort, "sort": order}] if sort else [], filter_model_of(request))
        return JSONResponse({"items": rows, "total": total})
    except trades.RequestError as error:
        return JSONResponse({"error": str(error)})


async def infinite_list(request: Request) -> JSONResponse:
    try:
        skip, top = number(request, "skip", 0), number(request, "top", 50)
        rows, _total = trades.block(skip, skip + top)
        return JSONResponse(rows)
    except trades.RequestError as error:
        return JSONResponse({"error": str(error)})


async def tape_rows(_request: Request) -> JSONResponse:
    return JSONResponse(instruments.tape_rows())


async def instrument_rows(_request: Request) -> JSONResponse:
    return JSONResponse(instruments.snapshot_rows())


async def sql_pages(request: Request) -> JSONResponse:
    body = await body_of(request)
    try:
        state = json.loads(body.get("gridState") or "{}")
    except ValueError:
        state = {}
    try:
        return JSONResponse(sqldb.page(body.get("sql", ""), state if isinstance(state, dict) else {}))
    except sqldb.QueryError as error:
        return JSONResponse({"schema": sqldb.schema(), "seq": state.get("seq") if isinstance(state, dict) else None, "error": str(error)})


async def sql(request: Request) -> JSONResponse:
    body = await body_of(request)
    try:
        return JSONResponse(sqldb.run(body.get("sql", "")))
    except sqldb.QueryError as error:
        return JSONResponse({"schema": sqldb.schema(), "error": str(error)})


app = Starlette(
    routes=[
        Route("/widgets.json", widgets, methods=["GET"]),
        *[Route(f"/ag-table-chart/{name}", table(build), methods=["GET"]) for name, build in TABLES.items()],
        Route("/ag-table-chart/company", company, methods=["GET"]),
        Route("/ag-table-chart/live", live, methods=["GET"]),
        Route("/ag-grid/positions", positions_book, methods=["POST"]),
        Route("/ag-grid/trades/ssrm", trades_ssrm, methods=["POST"]),
        Route("/ag-grid/trades/infinite/state", infinite_state, methods=["POST"]),
        Route("/ag-grid/trades/infinite/rest", infinite_rest, methods=["GET"]),
        Route("/ag-grid/trades/infinite/list", infinite_list, methods=["GET"]),
        WebSocketRoute("/ag-grid/trades/updates", instruments.trade_updates),
        Route("/ag-grid/instruments", instrument_rows, methods=["GET"]),
        Route("/ag-grid/tape", tape_rows, methods=["GET"]),
        Route("/ag-grid/files/positions", table(files.positions_workbook), methods=["GET"]),
        Route("/ag-grid/files/trades-csv", table(files.trades_csv), methods=["GET"]),
        WebSocketRoute("/ag-grid/tape/stream", instruments.tape),
        WebSocketRoute("/ag-grid/instruments/stream", instruments.stream),
        Route("/ag-grid/sql", sql, methods=["POST"]),
        Route("/ag-grid/sql-pages", sql_pages, methods=["POST"]),
    ],
    middleware=[Middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["*"])],
)
