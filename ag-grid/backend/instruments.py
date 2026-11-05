import asyncio
import json
import random

import trades

START_COUNT = 24
MAX_COUNT = 40
TICK_SECONDS = 0.4
TICK_ROWS = 4
LIST_EVERY = 10
DELIST_EVERY = 15
TRANSACTION_SECONDS = 1.0


def instrument(i: int, price: float) -> dict:
    return {"id": f"I{i:02d}", "name": f"Instrument {i:02d}", "price": round(price, 2), "change": 0.0, "ticks": 0}


def start() -> dict[str, dict]:
    rng = random.Random(7)
    return {f"I{i:02d}": instrument(i, 40 + rng.random() * 120) for i in range(START_COUNT)}


def snapshot_rows() -> list[dict]:
    return list(start().values())


def move(rows: dict[str, dict], rng: random.Random) -> list[dict]:
    moved = []
    for key in rng.sample(sorted(rows), min(TICK_ROWS, len(rows))):
        row = rows[key]
        price = round(max(1.0, row["price"] * (1 + rng.uniform(-0.01, 0.01))), 2)
        rows[key] = {**row, "price": price, "change": round(price - row["price"], 2), "ticks": row["ticks"] + 1}
        moved.append(rows[key])
    return moved


def step(rows: dict[str, dict], rng: random.Random, tick: int, next_id: int) -> tuple[list[dict], int]:
    messages = [{"op": "upsert", "rows": move(rows, rng)}]
    if tick % LIST_EVERY == 0 and len(rows) < MAX_COUNT:
        listed = instrument(next_id, 40 + rng.random() * 120)
        rows[listed["id"]] = listed
        messages.append({"op": "upsert", "rows": [listed]})
        next_id += 1
    if tick % DELIST_EVERY == 0 and len(rows) > 1:
        gone = rng.choice(sorted(rows))
        del rows[gone]
        messages.append({"op": "remove", "ids": [gone]})
    return messages, next_id


async def stream(websocket) -> None:
    await websocket.accept()
    rng = random.Random()
    rows = start()
    next_id = START_COUNT
    await websocket.send_text(json.dumps({"op": "snapshot", "rows": list(rows.values())}))
    tick = 0
    try:
        while True:
            await asyncio.sleep(TICK_SECONDS)
            tick += 1
            messages, next_id = step(rows, rng, tick, next_id)
            for message in messages:
                await websocket.send_text(json.dumps(message))
    except Exception:
        return


async def trade_updates(websocket) -> None:
    await websocket.accept()
    rng = random.Random()
    try:
        while True:
            await asyncio.sleep(TRANSACTION_SECONDS)
            await websocket.send_text(json.dumps({"op": "transaction", "route": [], "update": trades.price_moves(rng)}))
    except Exception:
        return
