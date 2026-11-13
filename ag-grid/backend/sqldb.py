import sqlite3
import time

import trades

MAX_ROWS = 1_000
MAX_SQL = 4096
TIMEOUT_SECONDS = 5
DESKS = [
    {"desk": "Rates", "head": "Ana", "floor": 3},
    {"desk": "Credit", "head": "Ben", "floor": 3},
    {"desk": "Equities", "head": "Chen", "floor": 4},
    {"desk": "Commodities", "head": "Dara", "floor": 5},
    {"desk": "FX", "head": "Eli", "floor": 5},
]


ALLOWED = {sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqlite3.SQLITE_FUNCTION, sqlite3.SQLITE_RECURSIVE}


class QueryError(ValueError):
    pass


def authorize(action: int, *_args) -> int:
    return sqlite3.SQLITE_OK if action in ALLOWED else sqlite3.SQLITE_DENY


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(":memory:", check_same_thread=False)
    connection.execute(
        "CREATE TABLE trades (id TEXT PRIMARY KEY, traded DATE, region TEXT, desk TEXT, trader TEXT,"
        " product TEXT, currency TEXT, quantity INTEGER, price REAL, notional REAL)"
    )
    connection.executemany(
        "INSERT INTO trades VALUES (:id, :traded, :region, :desk, :trader, :product, :currency, :quantity, :price, :notional)",
        trades.build(),
    )
    connection.execute("CREATE TABLE desks (desk TEXT PRIMARY KEY, head TEXT, floor INTEGER)")
    connection.executemany("INSERT INTO desks VALUES (:desk, :head, :floor)", DESKS)
    connection.commit()
    connection.execute("PRAGMA query_only = ON")
    return connection


DATABASE = connect()


def schema() -> dict:
    names = [row[0] for row in DATABASE.execute("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name")]
    tables = []
    for name in names:
        columns = DATABASE.execute("SELECT name, type FROM pragma_table_info(?)", (name,)).fetchall()
        tables.append({"name": name, "columns": [{"name": c, "type": t or "ANY"} for c, t in columns]})
    return {"engine": f"SQLite {sqlite3.sqlite_version}", "tables": tables}


def run(sql: str) -> dict:
    if not isinstance(sql, str) or not sql.strip():
        return {"schema": schema()}
    if len(sql) > MAX_SQL:
        raise QueryError(f"The query is longer than {MAX_SQL} characters.")
    deadline = time.monotonic() + TIMEOUT_SECONDS
    DATABASE.set_progress_handler(lambda: int(time.monotonic() > deadline), 10_000)
    DATABASE.set_authorizer(authorize)
    started = time.monotonic()
    try:
        cursor = DATABASE.execute(sql)
        rows = cursor.fetchmany(MAX_ROWS + 1)
    except sqlite3.Error as error:
        raise QueryError(str(error)) from error
    finally:
        DATABASE.set_authorizer(None)
        DATABASE.set_progress_handler(None, 0)
    columns = [{"name": d[0], "type": ""} for d in cursor.description or []]
    return {
        "schema": schema(),
        "columns": columns,
        "rows": [list(row) for row in rows[:MAX_ROWS]],
        "truncated": len(rows) > MAX_ROWS,
        "elapsedMs": round((time.monotonic() - started) * 1000),
    }


NUMBER_FILTERS = {
    "equals": "= ?",
    "notEqual": "<> ?",
    "lessThan": "< ?",
    "lessThanOrEqual": "<= ?",
    "greaterThan": "> ?",
    "greaterThanOrEqual": ">= ?",
}
TEXT_FILTERS = {
    "equals": ("= ?", "{}"),
    "notEqual": ("<> ?", "{}"),
    "contains": ("LIKE ?", "%{}%"),
    "notContains": ("NOT LIKE ?", "%{}%"),
    "startsWith": ("LIKE ?", "{}%"),
    "endsWith": ("LIKE ?", "%{}"),
}
MAX_PAGE = 5_000


def quoted(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def condition(column: str, model: dict, args: list) -> str:
    if isinstance(model.get("conditions"), list):
        joiner = " OR " if model.get("operator") == "OR" else " AND "
        parts = [condition(column, c, args) for c in model["conditions"] if isinstance(c, dict)]
        return "(" + joiner.join(parts) + ")" if parts else "1"
    kind, op = model.get("filterType"), model.get("type")
    target = quoted(column)
    if op == "blank":
        return f"({target} IS NULL OR {target} = '')"
    if op == "notBlank":
        return f"({target} IS NOT NULL AND {target} <> '')"
    if kind == "number" and op == "inRange":
        args += [model.get("filter"), model.get("filterTo")]
        return f"{target} BETWEEN ? AND ?"
    if kind == "number" and op in NUMBER_FILTERS:
        args.append(model.get("filter"))
        return f"{target} {NUMBER_FILTERS[op]}"
    if kind == "text" and op in TEXT_FILTERS:
        sql, pattern = TEXT_FILTERS[op]
        args.append(pattern.format(str(model.get("filter", "")).replace("%", "").replace("_", "")))
        return f"{target} {sql}"
    raise QueryError(f"The filter {kind} {op} is not supported here.")


def page(sql: str, state: dict) -> dict:
    """One page of a query for a server-side grid: the query is a subquery, with the grid's
    filters, sort and rows applied around it. Column names must be the query's own."""
    if not isinstance(sql, str) or not sql.strip():
        return {"schema": schema()}
    if len(sql) > MAX_SQL:
        raise QueryError(f"The query is longer than {MAX_SQL} characters.")
    if state.get("rowGroupCols") or state.get("pivotMode"):
        raise QueryError("This example pages, sorts and filters a query; it does not group or pivot it.")
    inner = sql.strip().rstrip(";")
    deadline = time.monotonic() + TIMEOUT_SECONDS
    DATABASE.set_progress_handler(lambda: int(time.monotonic() > deadline), 10_000)
    DATABASE.set_authorizer(authorize)
    try:
        columns = [d[0] for d in DATABASE.execute(f"SELECT * FROM ({inner}) LIMIT 0").description or []]
        args: list = []
        where = []
        for column, model in (state.get("filterModel") or {}).items():
            if column not in columns or not isinstance(model, dict):
                raise QueryError(f"The query has no column {column}.")
            where.append(condition(column, model, args))
        order = []
        for item in state.get("sortModel") or []:
            if item.get("colId") not in columns:
                raise QueryError(f"The query has no column {item.get('colId')}.")
            order.append(f"{quoted(item['colId'])} {'DESC' if item.get('sort') == 'desc' else 'ASC'}")
        clause = f" WHERE {' AND '.join(where)}" if where else ""
        total = DATABASE.execute(f"SELECT count(*) FROM ({inner}){clause}", args).fetchone()[0]
        start = max(0, int(state.get("startRow") or 0))
        end = min(start + MAX_PAGE, max(start, int(state.get("endRow") or start + 100)))
        ordered = f" ORDER BY {', '.join(order)}" if order else ""
        cursor = DATABASE.execute(f"SELECT * FROM ({inner}){clause}{ordered} LIMIT ? OFFSET ?", [*args, end - start, start])
        rows = [dict(zip(columns, row, strict=True)) for row in cursor.fetchall()]
    except sqlite3.Error as error:
        raise QueryError(str(error)) from error
    finally:
        DATABASE.set_authorizer(None)
        DATABASE.set_progress_handler(None, 0)
    return {"schema": schema(), "seq": state.get("seq"), "rowData": rows, "rowCount": total}
