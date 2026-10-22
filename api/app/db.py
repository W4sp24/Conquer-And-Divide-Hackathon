"""Database engine and the small helpers everything else calls.

SQLite (default) or Postgres/Supabase (set DATABASE_URL). With SQLite every
transaction is serialized by one asyncio lock, which also makes the guarded
status updates in orders/states.py trivially race-free. With Postgres, the guarded
UPDATE ... WHERE status IN (...) is atomic on its own.
"""
import asyncio
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from app.config import settings
from app.schema import (buyers, catalog_items, live_sessions, metadata, orders, sellers,
                        statement_uploads)

IS_SQLITE = settings.database_url.startswith("sqlite")

if IS_SQLITE:
    db_path = settings.database_url.split("///", 1)[-1]
    if db_path and db_path != ":memory:":
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)

# Supabase's pooler (pgbouncer, transaction mode) can't keep prepared statements,
# so asyncpg's statement cache is turned off for Postgres.
engine = create_async_engine(
    settings.database_url,
    connect_args={"timeout": 30} if IS_SQLITE else {"statement_cache_size": 0},
    pool_pre_ping=not IS_SQLITE,
    **({} if IS_SQLITE else {"pool_size": 5, "max_overflow": 5}),
)

if IS_SQLITE:
    @event.listens_for(engine.sync_engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

_lock = asyncio.Lock() if IS_SQLITE else None


def now() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid.uuid4())


async def create_all():
    async with engine.begin() as conn:
        await conn.run_sync(metadata.create_all)


@asynccontextmanager
async def tx():
    """One transaction. Never nest tx() calls (the SQLite lock is not re-entrant)."""
    if _lock:
        async with _lock:
            async with engine.begin() as conn:
                yield conn
    else:
        async with engine.begin() as conn:
            yield conn


def _d(row):
    return dict(row._mapping) if row is not None else None


async def fetch(stmt) -> list[dict]:
    async with tx() as c:
        return [_d(r) for r in (await c.execute(stmt)).fetchall()]


async def fetchone(stmt) -> dict | None:
    async with tx() as c:
        return _d((await c.execute(stmt)).first())


async def fetchval(stmt):
    async with tx() as c:
        return (await c.execute(stmt)).scalar()


async def execute(stmt) -> int:
    async with tx() as c:
        return (await c.execute(stmt)).rowcount


async def c_fetch(c: AsyncConnection, stmt) -> list[dict]:
    return [_d(r) for r in (await c.execute(stmt)).fetchall()]


async def c_fetchone(c: AsyncConnection, stmt) -> dict | None:
    return _d((await c.execute(stmt)).first())


# ---- named queries used in several modules -------------------------------------------

async def get_seller(seller_id: str | None = None) -> dict | None:
    q = select(sellers)
    q = q.where(sellers.c.id == seller_id) if seller_id else q.order_by(sellers.c.created_at).limit(1)
    return await fetchone(q)


async def get_session(session_id: str) -> dict | None:
    return await fetchone(select(live_sessions).where(live_sessions.c.id == session_id))


async def get_catalog(seller_id: str, include_inactive: bool = False) -> list[dict]:
    q = select(catalog_items).where(catalog_items.c.seller_id == seller_id)
    if not include_inactive:
        q = q.where(catalog_items.c.active.is_(True))
    rows = await fetch(q)
    return sorted(rows, key=lambda r: code_sort_key(r["code"]))


async def get_item(item_id: str) -> dict | None:
    return await fetchone(select(catalog_items).where(catalog_items.c.id == item_id))


async def item_by_code(seller_id: str, code: str) -> dict | None:
    return await fetchone(select(catalog_items).where(
        catalog_items.c.seller_id == seller_id, func.upper(catalog_items.c.code) == code.upper()))


async def get_order(order_id: str) -> dict | None:
    return await fetchone(select(orders).where(orders.c.id == order_id))


async def get_buyer(buyer_id: str) -> dict | None:
    return await fetchone(select(buyers).where(buyers.c.id == buyer_id))


async def statement_until(seller_id: str):
    return await fetchval(select(func.max(statement_uploads.c.covers_until))
                          .where(statement_uploads.c.seller_id == seller_id))


def code_sort_key(code: str):
    head = "".join(ch for ch in code if not ch.isdigit())
    digits = "".join(ch for ch in code if ch.isdigit())
    return (head.upper(), int(digits) if digits else 0, code)


def mask_name(name: str | None) -> str:
    """'Ana Reyes' -> 'Ana R.' Buyer names are masked on projected screens (RA 10173)."""
    parts = (name or "Viewer").split()
    if len(parts) == 1:
        return parts[0][:16]
    # surname particles: "Mark Dela Cruz" -> "Mark D.", "Rico De los Santos" -> "Rico D."
    surname = parts[-1]
    for i in range(1, len(parts) - 1):
        if parts[i].lower() in {"de", "dela", "del", "delos", "de la", "san", "sta.", "sto.", "santa"}:
            surname = parts[i]
            break
    return f"{parts[0][:16]} {surname[0].upper()}."
