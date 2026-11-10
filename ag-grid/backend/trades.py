import json
import random
from datetime import date, timedelta

SEPARATOR = "|"
AUTO_GROUP = "ag-Grid-AutoColumn"
TRADE_COUNT = 20_000
MAX_PAGE = 1_000
MAX_PIVOT_VALUES = 100
REGIONS = ["EMEA", "APAC", "Americas"]
DESKS = ["Rates", "Credit", "Equities", "Commodities", "FX"]
CURRENCIES = ["USD", "EUR", "GBP", "JPY"]
PRODUCTS = ["Swap", "Bond", "Option", "Future", "Spot"]
TRADERS = ["Ana", "Ben", "Chen", "Dara", "Eli", "Femi", "Gus", "Hana"]
NUMBERS = {"quantity", "price", "notional"}
AGGREGATES = {"sum", "avg", "min", "max", "count", "first", "last"}


def build(count: int = TRADE_COUNT) -> list[dict]:
    rng = random.Random(7)
    start = date(2026, 1, 2)
    rows = []
    for i in range(count):
        quantity = rng.randint(1, 500) * 100
        price = round(rng.uniform(5, 250), 2)
        rows.append(
            {
                "id": f"T{i:06d}",
                "traded": (start + timedelta(days=rng.randint(0, 300))).isoformat(),
                "region": rng.choice(REGIONS),
                "desk": rng.choice(DESKS),
                "trader": rng.choice(TRADERS),
                "product": rng.choice(PRODUCTS),
                "currency": rng.choice(CURRENCIES),
                "quantity": quantity,
                "price": price,
                "notional": round(quantity * price, 2),
            }
        )
    return rows


TRADES = build()


def column_defs() -> list[dict]:
    def text(field: str, header: str) -> dict:
        return {"field": field, "headerName": header, "filter": "agTextColumnFilter"}

    def number(field: str, header: str) -> dict:
        return {"field": field, "headerName": header, "filter": "agNumberColumnFilter", "type": "numericColumn", "aggFunc": None}

    return [
        {**text("id", "Trade"), "enableRowGroup": False, "enablePivot": False, "enableValue": False},
        {"field": "traded", "headerName": "Traded", "filter": "agDateColumnFilter"},
        text("region", "Region"),
        text("desk", "Desk"),
        text("trader", "Trader"),
        text("product", "Product"),
        text("currency", "Currency"),
        number("quantity", "Quantity"),
        number("price", "Price"),
        number("notional", "Notional"),
    ]


class RequestError(ValueError):
    pass


def state_of(body: dict) -> dict:
    text = body.get("gridState") if isinstance(body, dict) else None
    if not text:
        return {}
    try:
        state = json.loads(text)
    except ValueError as error:
        raise RequestError("gridState is not JSON.") from error
    if not isinstance(state, dict):
        raise RequestError("gridState is not an object.")
    return state


def _text_passes(value: object, op: str, wanted: object) -> bool:
    cell = "" if value is None else str(value).lower()
    if op == "blank":
        return cell == ""
    if op == "notBlank":
        return cell != ""
    target = str(wanted or "").lower()
    return {
        "contains": target in cell,
        "notContains": target not in cell,
        "equals": cell == target,
        "notEqual": cell != target,
        "startsWith": cell.startswith(target),
        "endsWith": cell.endswith(target),
    }.get(op, True)


def _ordered_passes(value: object, op: str, low: object, high: object) -> bool:
    if op == "blank":
        return value is None
    if op == "notBlank":
        return value is not None
    if value is None or low is None:
        return False
    return {
        "equals": value == low,
        "notEqual": value != low,
        "lessThan": value < low,
        "lessThanOrEqual": value <= low,
        "greaterThan": value > low,
        "greaterThanOrEqual": value >= low,
        "inRange": high is not None and low <= value <= high,
    }.get(op, True)


def _day(text: object) -> str | None:
    return str(text)[:10] if text else None


def _condition_passes(row: dict, field: str, model: dict) -> bool:
    kind = model.get("filterType")
    op = model.get("type", "")
    value = row.get(field)
    if kind == "text":
        return _text_passes(value, op, model.get("filter"))
    if kind == "number":
        return _ordered_passes(value, op, model.get("filter"), model.get("filterTo"))
    if kind == "date":
        return _ordered_passes(_day(value), op, _day(model.get("dateFrom")), _day(model.get("dateTo")))
    if kind == "set" and isinstance(model.get("values"), list):
        return (None if value is None else str(value)) in {None if v is None else str(v) for v in model["values"]}
    raise RequestError(f"The filter on {field} is not one this backend reads.")


MAX_ADVANCED_DEPTH = 8
MAX_ADVANCED_CONDITIONS = 50
FIELDS = frozenset(TRADES[0]) if TRADES else frozenset()


def _advanced_passes(row: dict, model: object, depth: int = 0) -> bool:
    """One node of the Advanced Filter's model: a join of conditions, or one column's condition."""
    if not isinstance(model, dict):
        raise RequestError("The advanced filter holds a condition that is not an object.")
    if depth > MAX_ADVANCED_DEPTH:
        raise RequestError(f"The advanced filter is nested deeper than {MAX_ADVANCED_DEPTH} levels.")
    kind = model.get("filterType")
    if kind == "join":
        conditions = model.get("conditions")
        if not isinstance(conditions, list) or len(conditions) > MAX_ADVANCED_CONDITIONS:
            raise RequestError(f"An advanced filter join holds a list of at most {MAX_ADVANCED_CONDITIONS} conditions.")
        results = [_advanced_passes(row, condition, depth + 1) for condition in conditions]
        return any(results) if model.get("type") == "OR" else all(results)
    field = model.get("colId")
    if field not in FIELDS:
        raise RequestError(f"The advanced filter names a column this backend does not have: {field}.")
    if kind in ("date", "dateString"):
        return _ordered_passes(_day(row.get(field)), model.get("type", ""), _day(model.get("filter")), None)
    if kind in ("text", "number"):
        return _condition_passes(row, field, model)
    raise RequestError(f"The advanced filter on {field} is not one this backend reads.")


def passes(row: dict, filter_model: dict) -> bool:
    if filter_model.get("filterType") == "join" or "colId" in filter_model:
        return _advanced_passes(row, filter_model)
    for field, model in filter_model.items():
        if not isinstance(model, dict):
            raise RequestError(f"The filter on {field} is not an object.")
        if isinstance(model.get("conditions"), list):
            results = [_condition_passes(row, field, m) for m in model["conditions"][:8]]
            if not (any(results) if model.get("operator") == "OR" else all(results)):
                return False
        elif not _condition_passes(row, field, model):
            return False
    return True


def _sorted(rows: list[dict], sort_model: list, group_field: str | None = None) -> list[dict]:
    for item in reversed(sort_model or []):
        if not isinstance(item, dict):
            continue
        field = group_field if item.get("colId") == AUTO_GROUP else item.get("colId")
        if not field:
            continue
        rows = sorted(rows, key=lambda r: (r.get(field) is None, r.get(field) if r.get(field) is not None else 0), reverse=item.get("sort") == "desc")
    return rows


def _aggregate(func: str, values: list) -> object:
    numbers = [v for v in values if isinstance(v, (int, float))]
    if func == "count":
        return len(values)
    if func == "first":
        return values[0] if values else None
    if func == "last":
        return values[-1] if values else None
    if not numbers:
        return None
    if func == "sum":
        return round(sum(numbers), 2)
    if func == "avg":
        return round(sum(numbers) / len(numbers), 4)
    if func == "min":
        return min(numbers)
    return max(numbers)


def _fields(columns: list, known: set[str]) -> list[dict]:
    if not isinstance(columns, list) or len(columns) > 32:
        raise RequestError("A column list is not a short list.")
    out = []
    for column in columns:
        field = column.get("field") or column.get("id") if isinstance(column, dict) else None
        if field not in known:
            raise RequestError(f"There is no column {field!r}.")
        out.append({**column, "field": field})
    return out


def block(start: object, end: object, sort_model: object = None, filter_model: object = None) -> tuple[list[dict], int]:
    if not (isinstance(start, int) and isinstance(end, int) and 0 <= start < end <= start + MAX_PAGE):
        raise RequestError(f"A request covers 1 to {MAX_PAGE} rows.")
    rows = [r for r in TRADES if passes(r, filter_model if isinstance(filter_model, dict) else {})]
    rows = _sorted(rows, sort_model if isinstance(sort_model, list) else [])
    return rows[start:end], len(rows)


def ssrm(state: dict) -> dict:
    answer: dict = {"columnDefs": column_defs()}
    if "seq" in state:
        answer["seq"] = state["seq"]
    if state.get("event", {}).get("type") != "getRows":
        return answer
    known = {c["field"] for c in column_defs()}
    start, end = state.get("startRow", 0), state.get("endRow", 0)
    if not (isinstance(start, int) and isinstance(end, int) and 0 <= start < end <= start + MAX_PAGE):
        raise RequestError(f"A request covers 1 to {MAX_PAGE} rows.")
    levels = [c["field"] for c in _fields(state.get("rowGroupCols") or [], known)]
    keys = state.get("groupKeys") or []
    values = _fields(state.get("valueCols") or [], known)
    pivots = [c["field"] for c in _fields(state.get("pivotCols") or [], known)] if state.get("pivotMode") else []
    for column in values:
        if (column.get("aggFunc") or "sum") not in AGGREGATES:
            raise RequestError(f"The aggregation {column.get('aggFunc')!r} is not supported.")

    rows = [r for r in TRADES if passes(r, state.get("filterModel") or {})]
    rows = [r for r in rows if all(str(r.get(levels[i])) == str(key) for i, key in enumerate(keys[: len(levels)]))]
    here = levels[len(keys)] if len(keys) < len(levels) else None

    if here is None and not (pivots and values):
        out = _sorted(rows, state.get("sortModel") or [])
        return {**answer, "rowData": out[start:end], "rowCount": len(out)}

    combos: list[tuple] = []
    if pivots and values:
        combos = sorted({tuple(str(r.get(p)) for p in pivots) for r in rows})
        if len(combos) > MAX_PIVOT_VALUES:
            raise RequestError(f"Pivoting on {', '.join(pivots)} would make more than {MAX_PIVOT_VALUES} columns.")

    groups: dict[object, list[dict]] = {}
    for row in rows:
        groups.setdefault(row.get(here) if here else None, []).append(row)
    out = []
    pivot_fields = [SEPARATOR.join([*combo, c["field"]]) for combo in combos for c in values]
    for key, members in groups.items():
        group = {here: key} if here else {}
        if combos:
            for combo in combos:
                inside = [m for m in members if tuple(str(m.get(p)) for p in pivots) == combo]
                for c in values:
                    group[SEPARATOR.join([*combo, c["field"]])] = _aggregate(c.get("aggFunc") or "sum", [m.get(c["field"]) for m in inside])
        else:
            for c in values:
                group[c["field"]] = _aggregate(c.get("aggFunc") or "sum", [m.get(c["field"]) for m in members])
        out.append(group)
    out = _sorted(sorted(out, key=lambda g: str(g.get(here, ""))), state.get("sortModel") or [], here)
    result = {**answer, "rowData": out[start:end], "rowCount": len(out)}
    if combos:
        result["pivotResultFields"] = pivot_fields
    return result


def price_moves(rng: random.Random, count: int = 20) -> list[dict]:
    moved = []
    for row in rng.sample(TRADES, count):
        price = round(max(1.0, row["price"] * (1 + rng.uniform(-0.01, 0.01))), 2)
        row.update(price=price, notional=round(row["quantity"] * price, 2))
        moved.append(dict(row))
    return moved
