START = [
    {"id": "P01", "symbol": "AAPL", "quantity": 1200, "price": 227.5},
    {"id": "P02", "symbol": "MSFT", "quantity": 800, "price": 415.2},
    {"id": "P03", "symbol": "NVDA", "quantity": 2500, "price": 131.8},
    {"id": "P04", "symbol": "AMZN", "quantity": 900, "price": 186.4},
    {"id": "P05", "symbol": "JPM", "quantity": 1500, "price": 211.3},
]
EDITABLE = {"quantity", "price"}

COLUMN_DEFS = [
    {"field": "id", "headerName": "ID", "width": 70, "flex": 0},
    {"field": "symbol", "headerName": "Symbol"},
    {"field": "quantity", "headerName": "Quantity", "type": "numericColumn", "editable": True, "cellEditor": "agNumberCellEditor"},
    {"field": "price", "headerName": "Price", "type": "numericColumn", "editable": True, "cellEditor": "agNumberCellEditor"},
    {"field": "notional", "headerName": "Notional", "type": "numericColumn", "enableCellChangeFlash": True},
    {"field": "weight", "headerName": "Weight %", "type": "numericColumn", "enableCellChangeFlash": True},
    {"field": "stressed", "headerName": "Notional at -20%", "calculatedExpression": "[quantity] * [price] * 0.8"},
    {"field": "target", "headerName": "Target price"},
]


class Book:
    def __init__(self) -> None:
        self.rows = {row["id"]: dict(row) for row in START}

    def apply(self, event: dict) -> None:
        if not isinstance(event, dict) or event.get("type") != "cellValueChanged":
            return
        row = self.rows.get(event.get("rowId"))
        column = event.get("colId")
        value = event.get("newValue")
        if row is None or column not in EDITABLE:
            return
        try:
            number = float(value)
        except (TypeError, ValueError):
            return
        if number < 0:
            return
        row[column] = int(number) if column == "quantity" else round(number, 2)

    def answer(self) -> dict:
        rows = [{**row, "notional": round(row["quantity"] * row["price"], 2)} for row in self.rows.values()]
        total = sum(row["notional"] for row in rows) or 1
        return {
            "columnDefs": COLUMN_DEFS,
            "rowData": [{**row, "weight": round(row["notional"] / total * 100, 2), "target": "=Math.round([price] * 1.15 * 100) / 100"} for row in rows],
            "gridOptions": {"enableCellExpressions": True},
        }


BOOK = Book()
