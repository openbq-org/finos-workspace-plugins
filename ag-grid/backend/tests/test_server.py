import json
import sys
from pathlib import Path

import pytest
from starlette.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

import instruments  # noqa: E402
import positions  # noqa: E402
import server  # noqa: E402
import trades  # noqa: E402

MANIFEST = BACKEND.parent / "src" / "plugin.json"


@pytest.fixture
def client():
    return TestClient(server.app)


def params(widget: dict) -> dict:
    return {p["paramName"]: p["value"] for p in widget.get("params", [])}


def handles() -> dict:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    return {h["type"]: h for w in manifest["contributes"]["widgets"] for h in w.get("handles", [])}


def call(client, widget: dict, **body) -> dict:
    if widget.get("method") == "POST":
        sent = {k: v for k, v in {**params(widget), **body}.items() if v != ""}
        answer = client.post(widget["endpoint"], json=sent) if sent else client.post(widget["endpoint"])
    else:
        answer = client.get(widget["endpoint"], params=params(widget))
    assert answer.status_code == 200, widget["endpoint"]
    return answer.json()


def request(**extra) -> dict:
    base = {
        "seq": 7,
        "event": {"type": "getRows"},
        "startRow": 0,
        "endRow": 100,
        "rowGroupCols": [],
        "valueCols": [],
        "pivotCols": [],
        "pivotMode": False,
        "groupKeys": [],
        "filterModel": {},
        "sortModel": [],
    }
    return {"gridState": json.dumps({**base, **extra})}


def test_every_widget_answers_and_follows_the_plugins_definition(client):
    jsonschema = pytest.importorskip("jsonschema")
    known = handles()
    widgets = client.get("/widgets.json").json()
    assert len(widgets) == 19
    assert {w["type"] for w in widgets.values()} == set(known)
    for key, widget in widgets.items():
        handle = known[widget["type"]]
        definition = (widget.get("data") or {}).get(widget["type"])
        if definition is not None:
            jsonschema.validate(definition, handle["definition"])
        assert call(client, widget), key


def test_widgets_that_post_their_state_declare_it_as_a_hidden_body_param(client):
    widgets = client.get("/widgets.json").json()
    for key in ("aggrid_positions", "aggrid_ssrm"):
        widget = widgets[key]
        assert widget["method"] == "POST"
        assert {"paramName": "gridState", "in": "body", "show": False}.items() <= widget["params"][0].items()
    assert widgets["aggrid_sql"]["params"][0]["paramName"] == "sql"


def test_the_cell_click_pair_shares_the_symbol(client):
    widgets = client.get("/widgets.json").json()
    clicks = widgets["ag_table_chart_cell_click"]["data"]["aggrid-table"]["columnsDefs"][0]["renderFnParams"]["groupBy"]["paramName"]
    assert clicks in params(widgets["ag_table_chart_company_detail"])
    assert client.get("/ag-table-chart/company", params={"symbol": "msft"}).json()[0]["company"] == "Microsoft"


def test_the_live_prices_move(client, monkeypatch):
    monkeypatch.setattr(server.time, "time", lambda: 0)
    before = client.get("/ag-table-chart/live").json()
    monkeypatch.setattr(server.time, "time", lambda: server.LIVE_SECONDS)
    after = client.get("/ag-table-chart/live").json()
    assert [r["symbol"] for r in before] == [r["symbol"] for r in after]
    assert [r["price"] for r in before] != [r["price"] for r in after]


def test_the_web_app_may_call_it(client):
    answer = client.get("/widgets.json", headers={"Origin": "http://localhost:3000"})
    assert answer.headers["access-control-allow-origin"] == "http://localhost:3000"


def test_the_positions_table_answers_an_edit_with_the_book_recalculated(client, monkeypatch):
    monkeypatch.setattr(positions, "BOOK", positions.Book())
    first = client.post("/ag-grid/positions").json()
    before = {r["id"]: r for r in first["rowData"]}
    assert round(sum(r["weight"] for r in first["rowData"])) == 100
    assert [c["field"] for c in first["columnDefs"] if c.get("editable")] == ["quantity", "price"]
    assert first["gridOptions"]["enableCellExpressions"] is True
    assert all(r["target"].startswith("=") for r in first["rowData"])

    edit = {"seq": 5, "event": {"type": "cellValueChanged", "rowId": "P01", "colId": "quantity", "oldValue": 1200, "newValue": 2400}}
    after = {r["id"]: r for r in client.post("/ag-grid/positions", json={"gridState": json.dumps(edit)}).json()["rowData"]}
    assert after["P01"]["quantity"] == 2400
    assert after["P01"]["notional"] == round(2400 * before["P01"]["price"], 2)
    assert after["P02"]["weight"] < before["P02"]["weight"]
    assert client.post("/ag-grid/positions", json={"gridState": json.dumps(edit)}).json()["rowData"][0]["quantity"] == 2400

    for refused in ({"type": "cellValueChanged", "rowId": "P01", "colId": "symbol", "newValue": "X"}, {"type": "cellValueChanged", "rowId": "P01", "colId": "price", "newValue": -1}, {"type": "cellClicked", "rowId": "P01"}):
        rows = client.post("/ag-grid/positions", json={"gridState": json.dumps({"seq": 6, "event": refused})}).json()["rowData"]
        assert rows[0]["symbol"] == "AAPL" and rows[0]["price"] == before["P01"]["price"]


def test_ssrm_answers_columns_then_blocks_with_the_request_applied(client):
    first = client.post("/ag-grid/trades/ssrm").json()
    assert "rowData" not in first
    assert [c["field"] for c in first["columnDefs"]][:3] == ["id", "traded", "region"]

    page = client.post("/ag-grid/trades/ssrm", json=request(startRow=100, endRow=200, sortModel=[{"colId": "price", "sort": "asc"}])).json()
    assert page["seq"] == 7
    assert page["rowCount"] == trades.TRADE_COUNT
    assert len(page["rowData"]) == 100
    prices = [r["price"] for r in page["rowData"]]
    assert prices == sorted(prices)

    filtered = client.post("/ag-grid/trades/ssrm", json=request(filterModel={"quantity": {"filterType": "number", "type": "greaterThan", "filter": 49000}})).json()
    assert filtered["rowCount"] < trades.TRADE_COUNT
    assert all(r["quantity"] > 49000 for r in filtered["rowData"])


def test_ssrm_groups_aggregates_and_pivots(client):
    desk = {"id": "desk", "field": "desk", "displayName": "Desk"}
    region = {"id": "region", "field": "region", "displayName": "Region"}
    notional = {"id": "notional", "field": "notional", "displayName": "Notional", "aggFunc": "sum"}

    groups = client.post("/ag-grid/trades/ssrm", json=request(rowGroupCols=[desk], valueCols=[notional])).json()
    assert {r["desk"] for r in groups["rowData"]} == set(trades.DESKS)
    assert groups["rowCount"] == len(trades.DESKS)
    assert round(sum(r["notional"] for r in groups["rowData"]), 0) == round(sum(t["notional"] for t in trades.TRADES), 0)

    children = client.post("/ag-grid/trades/ssrm", json=request(rowGroupCols=[desk], groupKeys=["FX"])).json()
    assert {r["desk"] for r in children["rowData"]} == {"FX"}
    assert "id" in children["rowData"][0]

    pivot = client.post("/ag-grid/trades/ssrm", json=request(rowGroupCols=[desk], valueCols=[notional], pivotCols=[region], pivotMode=True)).json()
    assert sorted(pivot["pivotResultFields"]) == sorted(f"{r}|notional" for r in trades.REGIONS)
    assert all("EMEA|notional" in r for r in pivot["rowData"])


def test_ssrm_says_what_it_refuses(client):
    answer = client.post("/ag-grid/trades/ssrm", json=request(endRow=5000)).json()
    assert answer["seq"] == 7
    assert "1 to 1000 rows" in answer["error"]
    unknown = client.post("/ag-grid/trades/ssrm", json=request(rowGroupCols=[{"field": "nope"}])).json()
    assert "nope" in unknown["error"]


def test_sql_runs_one_read_and_refuses_the_rest(client):
    schema = client.post("/ag-grid/sql").json()["schema"]
    assert {t["name"] for t in schema["tables"]} == {"desks", "trades"}
    answer = client.post("/ag-grid/sql", json={"sql": "SELECT desk, count(*) AS n FROM trades GROUP BY desk ORDER BY desk"}).json()
    assert [c["name"] for c in answer["columns"]] == ["desk", "n"]
    assert [r[0] for r in answer["rows"]] == sorted(trades.DESKS)
    assert answer["truncated"] is False
    assert client.post("/ag-grid/sql", json={"sql": "SELECT * FROM trades"}).json()["truncated"] is True
    for refused in ("DELETE FROM trades", "ATTACH 'x.db' AS x", "SELECT 1; SELECT 2", "CREATE TABLE t (a)"):
        assert "error" in client.post("/ag-grid/sql", json={"sql": refused}).json(), refused
    assert client.post("/ag-grid/sql", json={"sql": "SELECT count(*) FROM trades"}).json()["rows"] == [[trades.TRADE_COUNT]]


def test_the_streams_send_snapshots_upserts_removals_and_transactions(client, monkeypatch):
    monkeypatch.setattr(instruments, "TICK_SECONDS", 0)
    monkeypatch.setattr(instruments, "TRANSACTION_SECONDS", 0)
    with client.websocket_connect("/ag-grid/instruments/stream") as socket:
        snapshot = json.loads(socket.receive_text())
        assert snapshot["op"] == "snapshot" and len(snapshot["rows"]) == instruments.START_COUNT
        ops = {json.loads(socket.receive_text())["op"] for _ in range(40)}
    assert {"upsert", "remove"} <= ops
    with client.websocket_connect("/ag-grid/trades/updates") as socket:
        message = json.loads(socket.receive_text())
    assert message["op"] == "transaction" and message["route"] == [] and len(message["update"]) == 20


def test_a_step_lists_and_delists_instruments():
    import random

    rows = instruments.start()
    messages, next_id = instruments.step(rows, random.Random(1), instruments.LIST_EVERY * instruments.DELIST_EVERY, instruments.START_COUNT)
    assert [m["op"] for m in messages] == ["upsert", "upsert", "remove"]
    assert next_id == instruments.START_COUNT + 1
    assert len(rows) == instruments.START_COUNT


def test_the_infinite_backends_answer_blocks_in_their_own_shapes(client):
    state = {"seq": 3, "event": {"type": "getRows"}, "startRow": 50, "endRow": 100, "sortModel": [{"colId": "price", "sort": "desc"}], "filterModel": {}}
    answer = client.post("/ag-grid/trades/infinite/state", json={"gridState": json.dumps(state)}).json()
    assert answer["seq"] == 3 and answer["rowCount"] == trades.TRADE_COUNT and len(answer["rowData"]) == 50
    prices = [r["price"] for r in answer["rowData"]]
    assert prices == sorted(prices, reverse=True)

    rest = client.get("/ag-grid/trades/infinite/rest", params={"offset": 0, "limit": 25, "sort": "quantity", "order": "asc"}).json()
    assert rest["total"] == trades.TRADE_COUNT and len(rest["items"]) == 25
    assert [r["quantity"] for r in rest["items"]] == sorted(r["quantity"] for r in rest["items"])

    listed = client.get("/ag-grid/trades/infinite/list", params={"skip": trades.TRADE_COUNT - 10, "top": 50}).json()
    assert isinstance(listed, list) and len(listed) == 10

    assert "whole number" in client.get("/ag-grid/trades/infinite/rest", params={"offset": "x"}).json()["error"]
