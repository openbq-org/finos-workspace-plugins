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
